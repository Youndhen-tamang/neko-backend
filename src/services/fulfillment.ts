import { db } from "../db/knex";
import { Agency } from "../types";
import { HttpError } from "../utils/http";
import { sendInvoiceEmail } from "./email";
import { createNotification } from "./notifications";
import { getStripe } from "./stripe";
import { notifyWhatsAppOrderPaid } from "./whatsapp-inbound";

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100
  );
}

function productImages(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((image): image is string => typeof image === "string");
  return [];
}

export type OrderLine = {
  productId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  imageUrl?: string | null;
};

export type PlacedOrder = {
  id: string;
  agency_id: string;
  invoice_number: string;
  status: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  shipping_address: string | null;
  subtotal_cents: number;
  total_cents: number;
  payment_method: string;
  created_at: string;
  items: {
    name: string;
    quantity: number;
    unit_price_cents: number;
    image_url?: string | null;
    product_id?: string | null;
  }[];
};

async function placeAgencyOrder(input: {
  agency: Agency;
  customerName: string;
  customerEmail: string;
  customerPhone?: string | null;
  shippingAddress: string;
  items: OrderLine[];
  paymentMethod: "stripe" | "cod";
  stripeCheckoutSessionId?: string | null;
  stripePaymentIntentId?: string | null;
  channel?: string;
  waUser?: string;
}): Promise<PlacedOrder> {
  const totalCents = input.items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
  const invoiceNumber = `INV-${input.agency.slug.toUpperCase()}-${Date.now()}`;
  const orderId = crypto.randomUUID();

  const row = {
    id: orderId,
    agency_id: input.agency.id,
    invoice_number: invoiceNumber,
    status: "ordered",
    customer_name: input.customerName,
    customer_email: input.customerEmail,
    customer_phone: input.customerPhone || null,
    shipping_address: input.shippingAddress,
    subtotal_cents: totalCents,
    total_cents: totalCents,
    payment_method: input.paymentMethod,
    stripe_checkout_session_id: input.stripeCheckoutSessionId ?? null,
    stripe_payment_intent_id: input.stripePaymentIntentId ?? null,
  };

  let order;
  try {
    [order] = await db("orders").insert(row).returning("*");
  } catch {
    const { payment_method: _paymentMethod, ...legacy } = row;
    if (input.paymentMethod === "cod") legacy.stripe_payment_intent_id = legacy.stripe_payment_intent_id || "cod";
    [order] = await db("orders").insert(legacy).returning("*");
  }

  if (input.items.length) {
    await db("order_items").insert(
      input.items.map((item) => ({
        id: crypto.randomUUID(),
        order_id: orderId,
        product_id: item.productId,
        name: item.name,
        quantity: item.quantity,
        unit_price_cents: item.unitPriceCents,
        image_url: item.imageUrl ?? null,
      }))
    );
  }

  for (const item of input.items) {
    await db("products")
      .where({ id: item.productId, agency_id: input.agency.id })
      .decrement("stock", item.quantity);
  }

  const lowStock = await db("products")
    .where({ agency_id: input.agency.id })
    .andWhereRaw("stock <= low_stock_threshold");

  for (const product of lowStock) {
    await createNotification({
      agencyId: input.agency.id,
      type: "low_stock",
      title: `${product.name} is low on stock`,
      body: `Only ${product.stock} left in inventory.`,
      meta: { productId: product.id },
    });
  }

  const payNote = input.paymentMethod === "cod" ? "Cash on delivery" : "Paid with Stripe";
  await createNotification({
    agencyId: input.agency.id,
    type: "order",
    title: `New order ${invoiceNumber}`,
    body: `${input.customerName} placed an order for ${money(totalCents)}. ${payNote}.`,
    meta: { orderId, paymentMethod: input.paymentMethod },
  });

  try {
    const sent = await sendInvoiceEmail({
      to: input.customerEmail,
      agencyName: input.agency.brand_name,
      logoUrl: input.agency.logo_url,
      primaryColor: input.agency.primary_color,
      invoiceNumber,
      customerName: input.customerName,
      items: input.items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
      })),
      totalCents,
      currency: "usd",
    });
    if (sent) {
      await db("orders").where({ id: orderId }).update({ email_sent: true });
    }
  } catch (error) {
    console.error("Failed to send invoice email", error);
  }

  if (input.channel === "whatsapp" && input.waUser) {
    try {
      const lines = input.items
        .map((item) => `- ${item.name} × ${item.quantity} — ${money(item.unitPriceCents * item.quantity)}`)
        .join("\n");
      await notifyWhatsAppOrderPaid({
        agencyId: input.agency.id,
        waUser: input.waUser,
        text: `Thank you for the purchase, ma'am. Your order is confirmed.\n\nInvoice: ${invoiceNumber}\n${lines}\nTotal: ${money(
          totalCents
        )}\nShip to: ${input.shippingAddress}\nPayment: ${payNote}\n\nA confirmation email is on the way.`,
      });
    } catch (error) {
      console.error("Failed to send WhatsApp order confirmation", error);
    }
  }

  const items = await db("order_items").where({ order_id: orderId });
  return {
    ...order,
    payment_method: order.payment_method ?? input.paymentMethod,
    items,
  };
}

export async function createCodOrder(input: {
  agency: Agency;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  shippingAddress: string;
  items: { productId: string; quantity: number }[];
  channel?: string;
  waUser?: string;
}): Promise<PlacedOrder> {
  const products = await db("products")
    .whereIn(
      "id",
      input.items.map((item) => item.productId)
    )
    .andWhere({ agency_id: input.agency.id, status: "published" });

  if (products.length !== input.items.length) {
    throw new HttpError(400, "One or more products are unavailable");
  }

  const lines: OrderLine[] = input.items.map((item) => {
    const product = products.find((row) => row.id === item.productId)!;
    if (product.stock < item.quantity) {
      throw new HttpError(400, `${product.name} does not have enough stock`);
    }
    return {
      productId: product.id,
      name: product.name,
      quantity: item.quantity,
      unitPriceCents: product.price_cents as number,
      imageUrl: productImages(product.images)[0] ?? null,
    };
  });

  return placeAgencyOrder({
    agency: input.agency,
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    customerPhone: input.customerPhone,
    shippingAddress: input.shippingAddress,
    items: lines,
    paymentMethod: "cod",
    channel: input.channel,
    waUser: input.waUser,
  });
}

export async function fulfillStripeSession(sessionId: string) {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.payment_status !== "paid" || !session.metadata?.agencyId) return null;

  const existing = await db("orders")
    .where({ stripe_checkout_session_id: session.id })
    .first();
  if (existing) {
    const items = await db("order_items").where({ order_id: existing.id });
    return { ...existing, items };
  }

  const agency = await db("agencies").where({ id: session.metadata.agencyId }).first();
  if (!agency) return null;

  const items = JSON.parse(session.metadata.items || "[]") as OrderLine[];

  return placeAgencyOrder({
    agency,
    customerName: session.metadata.customerName,
    customerEmail: session.metadata.customerEmail,
    customerPhone: session.metadata.customerPhone,
    shippingAddress: session.metadata.shippingAddress,
    items,
    paymentMethod: "stripe",
    stripeCheckoutSessionId: session.id,
    stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
    channel: session.metadata.channel,
    waUser: session.metadata.waUser,
  });
}
