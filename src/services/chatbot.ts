import { z } from "zod";
import { db } from "../db/knex";
import { Agency } from "../types";
import { HttpError } from "../utils/http";
import { createCheckoutSession } from "./checkout";
import { fulfillStripeSession } from "./fulfillment";
import { openRouterChat } from "./openrouter";

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type ChatOrderSummary = {
  invoice_number: string;
  status: string;
  customer_name: string;
  customer_email: string;
  shipping_address: string | null;
  total_cents: number;
  items: { name: string; quantity: number; unit_price_cents: number }[];
};

export type ChatResult = {
  answer: string;
  checkoutUrl?: string;
  checkoutSessionId?: string;
  order?: ChatOrderSummary;
};

const checkoutActionSchema = z.object({
  customerName: z.string().min(2),
  customerEmail: z.string().email(),
  customerPhone: z.string().optional(),
  shippingAddress: z.string().min(4),
  items: z
    .array(
      z.object({
        productId: z.string().optional(),
        productName: z.string().optional(),
        quantity: z.coerce.number().int().positive(),
      })
    )
    .min(1),
});

type CatalogProduct = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  price_cents: number;
  stock: number;
};

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function parseModelJson(content: string): { reply: string; checkout: unknown } {
  const trimmed = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return { reply: content.trim(), checkout: null };
  }
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as {
      reply?: string;
      checkout?: unknown;
    };
    return {
      reply: parsed.reply?.trim() || content.trim(),
      checkout: parsed.checkout ?? null,
    };
  } catch {
    return { reply: content.trim(), checkout: null };
  }
}

function resolveCatalogProduct(catalog: CatalogProduct[], item: { productId?: string; productName?: string }) {
  if (item.productId) {
    const byId = catalog.find((product) => product.id === item.productId);
    if (byId) return byId;
  }

  const needle = item.productName?.trim().toLowerCase();
  if (!needle) return null;

  const exact = catalog.filter((product) => product.name.toLowerCase() === needle);
  if (exact.length === 1) return exact[0];

  const partial = catalog.filter(
    (product) => product.name.toLowerCase().includes(needle) || needle.includes(product.name.toLowerCase())
  );
  if (partial.length === 1) return partial[0];
  return null;
}

async function loadOrderSummary(orderId: string, agencyId: string): Promise<ChatOrderSummary | null> {
  const order = await db("orders").where({ id: orderId, agency_id: agencyId }).first();
  if (!order) return null;
  const items = await db("order_items").where({ order_id: order.id });
  return {
    invoice_number: order.invoice_number,
    status: order.status,
    customer_name: order.customer_name,
    customer_email: order.customer_email,
    shipping_address: order.shipping_address,
    total_cents: order.total_cents,
    items: items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      unit_price_cents: item.unit_price_cents,
    })),
  };
}

function thankYouMessage(order: ChatOrderSummary) {
  return `Thank you for the purchase, ma'am. Your order is confirmed.

${formatOrderDetails(order)}

A confirmation email is on the way.`.trim();
}

function formatOrderDetails(order: ChatOrderSummary) {
  const lines = order.items
    .map((item) => `- ${item.name} × ${item.quantity} — ${money(item.unit_price_cents * item.quantity)}`)
    .join("\n");
  return `Invoice: ${order.invoice_number}
Status: ${order.status}
Customer: ${order.customer_name}
Email: ${order.customer_email}

${lines}
Total: ${money(order.total_cents)}${order.shipping_address ? `\nShip to: ${order.shipping_address}` : ""}`;
}

function extractInvoiceNumbers(text: string) {
  const matches = text.match(/\bINV-[A-Z0-9]+-\d+\b/gi) ?? [];
  return [...new Set(matches.map((value) => value.toUpperCase()))];
}

async function loadOrderByInvoice(agencyId: string, invoiceNumber: string) {
  const order = await db("orders")
    .where({ agency_id: agencyId })
    .whereRaw("upper(invoice_number) = ?", [invoiceNumber.toUpperCase()])
    .first();
  if (!order) return null;
  return loadOrderSummary(order.id, agencyId);
}

async function lookupInvoices(agency: Agency, message: string): Promise<ChatResult | null> {
  const invoices = extractInvoiceNumbers(message);
  if (!invoices.length) return null;

  const orders = (
    await Promise.all(invoices.map((invoice) => loadOrderByInvoice(agency.id, invoice)))
  ).filter((order): order is ChatOrderSummary => Boolean(order));

  if (!orders.length) {
    return {
      answer: `I couldn't find ${invoices.join(" or ")} in ${agency.brand_name}'s orders. Please double-check the invoice number, ma'am.`,
    };
  }

  const details = orders.map((order) => formatOrderDetails(order)).join("\n\n");
  return {
    answer: `Here ${orders.length === 1 ? "are the details for your order" : "are the details for those orders"}, ma'am.\n\n${details}`,
    order: orders[0],
  };
}

async function thankIfPaid(agency: Agency, checkoutSessionId: string): Promise<ChatResult | null> {
  const existing = await db("orders")
    .where({
      stripe_checkout_session_id: checkoutSessionId,
      agency_id: agency.id,
    })
    .first();

  const fulfilled = existing ?? (await fulfillStripeSession(checkoutSessionId));
  if (!fulfilled || fulfilled.agency_id !== agency.id) return null;

  const order = await loadOrderSummary(fulfilled.id, agency.id);
  if (!order) return null;
  return {
    answer: thankYouMessage(order),
    checkoutSessionId,
    order,
  };
}

export async function handleStoreChat(options: {
  agency: Agency;
  message?: string;
  history?: ChatTurn[];
  checkoutSessionId?: string;
}): Promise<ChatResult> {
  const { agency, message, history = [], checkoutSessionId } = options;

  if (checkoutSessionId) {
    const paid = await thankIfPaid(agency, checkoutSessionId);
    if (paid) return paid;
    if (!message?.trim()) {
      return {
        answer: "I still have your payment link ready. Once Stripe confirms the payment, I'll share your order details here.",
        checkoutSessionId,
      };
    }
  }

  if (!message?.trim()) {
    throw new HttpError(400, "Message is required");
  }

  const invoiceLookup = await lookupInvoices(agency, message);
  if (invoiceLookup) return invoiceLookup;

  const products = (await db("products")
    .where({ agency_id: agency.id, status: "published" })
    .select("id", "name", "description", "category", "price_cents", "stock")) as CatalogProduct[];

  const catalog = products
    .map(
      (product) =>
        `- id: ${product.id} | ${product.name} | category: ${product.category} | price: ${money(
          product.price_cents
        )} | stock: ${product.stock} | ${product.description ?? ""}`
    )
    .join("\n");

  const raw = await openRouterChat(
    [
      {
        role: "system",
        content: `You are the live shopping assistant for ${agency.brand_name}, a women's clothing boutique. Be warm, concise, and sales-minded. Address the customer as ma'am when it feels natural.

You can only sell products from this live catalog. Never invent products, prices, IDs, or stock. If something is missing or out of stock, say so.

Live catalog:
${catalog || "No published products yet."}

Sales flow:
1. Help the customer pick a product and quantity from the catalog.
2. Then collect checkout details one or two at a time if needed: full name, email, phone (optional), and shipping address.
3. When you have a valid in-stock product, quantity, full name, email, and shipping address, set "checkout" to that order. Otherwise checkout must be null.
4. Never invent payment URLs and never put URLs in reply text. The backend creates the Stripe link and the UI shows a Pay button.
5. If the customer asks about an order or invoice but has not given an invoice number, ask them to paste it (for example INV-LUMINA-1001). Do not invent order details.
6. Do not emit checkout again unless the customer changes the order.

Return JSON only:
{"reply":"message for the customer","checkout":null}
or
{"reply":"I've prepared your payment link.","checkout":{"customerName":"...","customerEmail":"...","customerPhone":"...","shippingAddress":"...","items":[{"productId":"<catalog uuid>","productName":"<exact catalog name>","quantity":1}]}}`,
      },
      ...history.slice(-10).map((item) => ({
        role: item.role,
        content: item.content,
      })),
      { role: "user", content: message },
    ],
    true
  );

  const parsed = parseModelJson(raw);
  let answer = parsed.reply;
  let checkoutUrl: string | undefined;
  let sessionId: string | undefined;

  if (parsed.checkout) {
    const action = checkoutActionSchema.safeParse(parsed.checkout);
    if (!action.success) {
      answer = `${answer}\n\nI still need a complete name, email, shipping address, and product before I can send a payment link.`.trim();
    } else {
      const resolvedItems: { productId: string; quantity: number }[] = [];
      const missing: string[] = [];

      for (const item of action.data.items) {
        const product = resolveCatalogProduct(products, item);
        if (!product) {
          missing.push(item.productName || item.productId || "that item");
          continue;
        }
        if (product.stock < item.quantity) {
          missing.push(`${product.name} (only ${product.stock} left)`);
          continue;
        }
        resolvedItems.push({ productId: product.id, quantity: item.quantity });
      }

      if (missing.length || !resolvedItems.length) {
        answer = `${answer}\n\nI couldn't start checkout yet: ${missing.join(", ") || "no matching catalog items"}.`.trim();
      } else {
        try {
          const checkout = await createCheckoutSession({
            agency,
            customerName: action.data.customerName,
            customerEmail: action.data.customerEmail,
            customerPhone: action.data.customerPhone,
            shippingAddress: action.data.shippingAddress,
            items: resolvedItems,
            cancelPath: "/",
            successQuery: "from=chat",
          });
          checkoutUrl = checkout.checkoutUrl;
          sessionId = checkout.sessionId;
          const summary = checkout.lineItems
            .map((item) => `${item.name} × ${item.quantity} (${money(item.unitPriceCents * item.quantity)})`)
            .join(", ");
          answer = `${answer}\n\nYour payment link for ${summary} is ready. Total ${money(
            checkout.subtotal
          )}. Use the button below to pay securely.`.trim();
        } catch (error) {
          const reason = error instanceof HttpError ? error.message : "I couldn't create the payment link just now.";
          answer = `${answer}\n\n${reason}`.trim();
        }
      }
    }
  }

  return {
    answer,
    checkoutUrl,
    checkoutSessionId: sessionId ?? checkoutSessionId,
  };
}
