import { z } from "zod";
import { env } from "../config/env";
import { db } from "../db/knex";
import { Agency } from "../types";
import { HttpError } from "../utils/http";
import { storeUrlForSlug } from "../utils/tenant";
import { createCheckoutSession } from "./checkout";
import { createCodOrder, fulfillStripeSession } from "./fulfillment";
import { openRouterChat } from "./openrouter";
import { sizeHint } from "./tryon";
import { money } from "../utils/money";

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type ChatOrderSummary = {
  id: string;
  invoice_number: string;
  status: string;
  customer_name: string;
  customer_email: string;
  shipping_address: string | null;
  total_cents: number;
  payment_method?: string;
  created_at: string;
  items: { name: string; quantity: number; unit_price_cents: number }[];
};

export type ChatChannel = "web" | "whatsapp";

export type ChatProductLink = {
  id: string;
  name: string;
  price_cents: number;
  url: string;
  tryOnUrl: string;
};

export type PendingCheckout = {
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  shippingAddress: string;
  items: { productId?: string; productName?: string; quantity: number }[];
};

export type ChatResult = {
  answer: string;
  checkoutUrl?: string;
  checkoutSessionId?: string;
  order?: ChatOrderSummary;
  /** Catalog products the assistant recommended or the customer asked about. */
  products?: ChatProductLink[];
  /** Order drafted, waiting for the customer to say place order. */
  pendingCheckout?: PendingCheckout;
};

const EMAIL_DOMAINS: Record<string, string> = {
  gmail: "gmail.com",
  yahoo: "yahoo.com",
  hotmail: "hotmail.com",
  outlook: "outlook.com",
  icloud: "icloud.com",
  live: "live.com",
  proton: "proton.me",
  protonmail: "protonmail.com",
};

const EMAIL_DOMAIN_TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com",
  "gmal.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gmaill.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gmil.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.con": "gmail.com",
  "gmail.comm": "gmail.com",
  "gmail.cpm": "gmail.com",
  "googlemail.com": "gmail.com",
  "yaho.com": "yahoo.com",
  "yahooo.com": "yahoo.com",
  "yahoo.co": "yahoo.com",
  "hotmial.com": "hotmail.com",
  "hotmal.com": "hotmail.com",
  "outlok.com": "outlook.com",
  "outloo.com": "outlook.com",
  "iclod.com": "icloud.com",
  "icloud.co": "icloud.com",
};

const TLD_TYPOS: Record<string, string> = {
  con: "com",
  comm: "com",
  cpm: "com",
  coom: "com",
  om: "com",
};

function editDistance(left: string, right: string) {
  const rows = left.length;
  const cols = right.length;
  const grid: number[][] = Array.from({ length: rows + 1 }, () => Array(cols + 1).fill(0));
  for (let i = 0; i <= rows; i += 1) grid[i][0] = i;
  for (let j = 0; j <= cols; j += 1) grid[0][j] = j;
  for (let i = 1; i <= rows; i += 1) {
    for (let j = 1; j <= cols; j += 1) {
      grid[i][j] =
        left[i - 1] === right[j - 1]
          ? grid[i - 1][j - 1]
          : 1 + Math.min(grid[i - 1][j], grid[i][j - 1], grid[i - 1][j - 1]);
    }
  }
  return grid[rows][cols];
}

function closeEnough(left: string, right: string, extra = 1) {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const allow = Math.max(extra, Math.floor(Math.max(a.length, b.length) / 4));
  return editDistance(a, b) <= allow;
}

function fixEmailDomain(domain: string) {
  let value = domain.toLowerCase().replace(/^\.+|\.+$/g, "");
  if (!value.includes(".")) value = EMAIL_DOMAINS[value] ?? `${value}.com`;
  const parts = value.split(".");
  const tld = parts[parts.length - 1];
  if (TLD_TYPOS[tld]) parts[parts.length - 1] = TLD_TYPOS[tld];
  value = parts.join(".");
  if (EMAIL_DOMAIN_TYPOS[value]) return EMAIL_DOMAIN_TYPOS[value];
  const known = Object.values(EMAIL_DOMAINS);
  const nearest = known
    .map((item) => ({ item, distance: editDistance(value, item) }))
    .sort((a, b) => a.distance - b.distance)[0];
  if (nearest && nearest.distance <= 2) return nearest.item;
  return value;
}

function normalizeEmail(raw: string): string | null {
  const spoken = raw
    .trim()
    .toLowerCase()
    .replace(/\s*\(at\)\s*/g, "@")
    .replace(/\s+at\s+/g, "@")
    .replace(/\s+dot\s+/g, ".")
    .replace(/\s+/g, "");
  const withAt = spoken.includes("@")
    ? spoken
    : spoken.replace(/([a-z0-9._%+-]+)(gmail|yahoo|hotmail|outlook|icloud|live|proton)/, "$1@$2");
  const match = withAt.match(/^([a-z0-9._%+-]+)@([a-z0-9.-]+)$/);
  if (!match) return null;
  const email = `${match[1]}@${fixEmailDomain(match[2])}`;
  return z.string().email().safeParse(email).success ? email : null;
}

function emailsIn(text: string) {
  const spoken = text
    .replace(/\s*\(at\)\s*/gi, "@")
    .replace(/\s+at\s+/gi, "@")
    .replace(/\s+dot\s+/gi, ".");
  const loose = spoken.replace(/\s+([a-z0-9-]+\.[a-z]{2,})/gi, "@$1");
  const found = new Set<string>();
  for (const source of [text, spoken, loose]) {
    for (const match of source.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+/gi)) {
      const email = normalizeEmail(match[0]);
      if (email) found.add(email);
    }
  }
  return [...found];
}

const checkoutActionSchema = z.object({
  customerName: z.string().trim().min(2),
  customerEmail: z.preprocess(
    (value) => (typeof value === "string" ? normalizeEmail(value) ?? value.trim() : value),
    z.string().email()
  ),
  customerPhone: z.string().optional(),
  shippingAddress: z.string().trim().min(2),
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

export { money };

export function productLinks(agency: Agency, product: { id: string }) {
  return {
    url: storeUrlForSlug(env.storeUrl, agency.slug, `/products/${product.id}`),
    tryOnUrl: storeUrlForSlug(env.storeUrl, agency.slug, `/try-on?product=${product.id}`),
  };
}

function parseModelJson(content: string): { reply: string; checkout: unknown; products: string[] } {
  const trimmed = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return { reply: content.trim(), checkout: null, products: [] };
  }
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as {
      reply?: string;
      checkout?: unknown;
      products?: unknown;
    };
    const products = Array.isArray(parsed.products)
      ? parsed.products.filter((id): id is string => typeof id === "string")
      : [];
    return {
      reply: parsed.reply?.trim() || content.trim(),
      checkout: parsed.checkout ?? null,
      products,
    };
  } catch {
    return { reply: content.trim(), checkout: null, products: [] };
  }
}

function resolveCatalogProduct(catalog: CatalogProduct[], item: { productId?: string; productName?: string }) {
  if (item.productId) {
    const byId = catalog.find((product) => product.id === item.productId);
    if (byId) return byId;
  }

  const needle = item.productName?.trim().toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!needle) return null;

  const exact = catalog.filter((product) => product.name.toLowerCase() === needle);
  if (exact.length === 1) return exact[0];

  const partial = catalog.filter((product) => {
    const name = product.name.toLowerCase();
    return name.includes(needle) || needle.includes(name);
  });
  if (partial.length === 1) return partial[0];

  const tokens = needle.split(" ").filter((token) => token.length > 2);
  const scored = catalog
    .map((product) => {
      const name = product.name.toLowerCase();
      const nameTokens = name.split(/[^a-z0-9]+/).filter(Boolean);
      const tokenHits = tokens.filter((token) => nameTokens.some((part) => closeEnough(token, part, 1))).length;
      const distance = editDistance(needle, name);
      const score = tokenHits * 24 + (closeEnough(needle, name, 2) ? 30 : 0) + Math.max(0, 12 - distance);
      return { product, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const next = scored[1];
  if (best && best.score >= 36 && (!next || best.score - next.score >= 8)) return best.product;
  return null;
}

async function loadOrderSummary(orderId: string, agencyId: string): Promise<ChatOrderSummary | null> {
  const order = await db("orders").where({ id: orderId, agency_id: agencyId }).first();
  if (!order) return null;
  const items = await db("order_items").where({ order_id: order.id });
  return {
    id: order.id,
    invoice_number: order.invoice_number,
    status: order.status,
    customer_name: order.customer_name,
    customer_email: order.customer_email,
    shipping_address: order.shipping_address,
    total_cents: order.total_cents,
    payment_method: order.payment_method,
    created_at: order.created_at,
    items: items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      unit_price_cents: item.unit_price_cents,
    })),
  };
}

function thankYouMessage(order: ChatOrderSummary) {
  return `Thank you for ordering, sir or ma'am. Your order is confirmed.

${formatOrderDetails(order)}

A confirmation email is on the way.`.trim();
}

export function formatOrderDetails(order: ChatOrderSummary) {
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

const CONFIRM_RE =
  /^(yes|yep|yeah|ok|okay|confirm|confirmed|place order|place the order|please order|pay now|pay|that's right|thats right|that is right|correct|go ahead|proceed)(\s*[.!])?$/i;
const CHANGE_RE = /\b(change|wait|cancel|nope|wrong|not yet|hold on|edit|update)\b/i;

export function isChangeOrder(text: string) {
  return CHANGE_RE.test(text.trim());
}

export function detectPaymentChoice(text: string): "cod" | "stripe" | null {
  const compact = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (
    /\b(cash on delivery|cash|cod|pay (on|at) delivery|pay when (it )?arrives|pay later)\b/.test(compact) ||
    closeEnough(compact, "cash on delivery", 2) ||
    closeEnough(compact, "cod", 0)
  ) {
    return "cod";
  }
  if (
    /\b(stripe|card|credit|debit|pay (online|now|by card)|payment link|apple pay|google pay)\b/.test(compact) ||
    closeEnough(compact, "stripe", 1)
  ) {
    return "stripe";
  }
  return null;
}

export function isConfirmOrder(text: string) {
  const value = text.trim();
  if (isChangeOrder(value)) return false;
  if (CONFIRM_RE.test(value) || /^place (the )?order\b/i.test(value)) return true;
  if (
    /\b(please order|place (the )?order|confirm( this| the)? order|you can proceed|proceed with (this |the )?order|go ahead|i confirm|come from this order)\b/i.test(
      value
    )
  ) {
    return true;
  }
  const compact = value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (/\b(pls|plz|please|place|plac|plese|pleace)\b/.test(compact) && /\b(order|oder|ordr|odrer)\b/.test(compact)) {
    return true;
  }
  return ["place order", "please order", "place the order", "proceed", "confirm order"].some((phrase) =>
    closeEnough(compact, phrase, 2)
  );
}

function extractFitHint(text: string) {
  const height = text.match(/\b(\d{3})\s*cm\b/i);
  const weight = text.match(/\b(\d{2,3})\s*kg\b/i);
  if (!height || !weight) return null;
  const heightCm = Number(height[1]);
  const weightKg = Number(weight[1]);
  if (heightCm < 100 || heightCm > 230 || weightKg < 30 || weightKg > 250) return null;
  return sizeHint(heightCm, weightKg);
}

function isCollectingOrder(history: ChatTurn[], message?: string) {
  const blob = [...history.map((turn) => turn.content), message ?? ""].join("\n");
  if (
    /\b(full name|email address|shipping address|i have your|i've selected|i have one|may i have your)\b/i.test(
      blob
    )
  ) {
    return true;
  }
  return Boolean(message && /^(1|2|3|4|5|one|two|three|four|five)\b/i.test(message.trim()));
}

function offeredProducts(history: ChatTurn[], catalog: CatalogProduct[]): CatalogProduct[] {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].role !== "assistant") continue;
    const ordered: CatalogProduct[] = [];
    for (const row of history[index].content.matchAll(/^\s*(\d+)\.\s+([^\n—:-]+)/gm)) {
      const product = resolveCatalogProduct(catalog, { productName: row[2].trim() });
      if (product) ordered.push(product);
    }
    if (ordered.length) return ordered;
  }
  return [];
}

function inferCheckout(
  history: ChatTurn[],
  message: string | undefined,
  catalog: CatalogProduct[]
): PendingCheckout | null {
  const turns: ChatTurn[] = message?.trim()
    ? [...history, { role: "user", content: message }]
    : history;
  const userTurns = turns.filter((turn) => turn.role === "user").map((turn) => turn.content);
  const blob = turns.map((turn) => turn.content).join("\n");
  const offered = offeredProducts(history, catalog);

  let product: CatalogProduct | null = null;
  const selected = blob.match(
    /(?:selected|choosing|go with|order(?:ing)?(?: the)?)\s+(?:the\s+)?([A-Za-z][A-Za-z0-9 &'/-]{2,60})/i
  );
  if (selected) product = resolveCatalogProduct(catalog, { productName: selected[1] });
  if (!product) {
    for (const text of userTurns) {
      const named = resolveCatalogProduct(catalog, { productName: text });
      if (named) product = named;
      const choiceMap: Record<string, number> = {
        "1": 1,
        one: 1,
        won: 1,
        "2": 2,
        two: 2,
        too: 2,
        "3": 3,
        three: 3,
        "4": 4,
        four: 4,
        "5": 5,
        five: 5,
      };
      const choices = text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .map((token) => choiceMap[token])
        .filter((value): value is number => Boolean(value));
      if (choices.length && offered.length) product = offered[choices[choices.length - 1] - 1] ?? product;
    }
  }

  const emails = emailsIn(blob);
  const email = emails[emails.length - 1];

  let name: string | undefined;
  for (const text of userTurns) {
    if (/^yes\b/i.test(text.trim()) && /\bma'?a?m\b/i.test(text)) continue;
    const phrase = text.match(
      /(?:full name|my name|name is)\s+([A-Za-z][A-Za-z.'-]+(?:\s+[A-Za-z][A-Za-z.'-]+)+)/i
    );
    if (phrase) name = phrase[1].trim();
    const line = text
      .trim()
      .match(
        /^(?:my (?:full )?name is|i am|it's|it is|this is)?\s*([A-Za-z][A-Za-z.'-]+(?:\s+[A-Za-z][A-Za-z.'-]+){1,3})\.?$/i
      );
    if (line) name = line[1].trim();
  }

  let address: string | undefined;
  for (let index = 0; index < turns.length - 1; index += 1) {
    if (turns[index].role !== "assistant") continue;
    if (!/\b(shipping|deliver|city|neighborhood|landmark|location|address)\b/i.test(turns[index].content)) {
      continue;
    }
    const next = turns[index + 1];
    if (next.role !== "user") continue;
    const cleaned = next.content
      .replace(/^(okay[,.]?\s*)?(please\s+)?(use|it's|it is|deliver (to|at)|shipping (address|location) (is|will be))\s+/i, "")
      .replace(/\s+is the shipping address\.?$/i, "")
      .trim();
    if (
      cleaned.length >= 2 &&
      !cleaned.includes("@") &&
      !isConfirmOrder(cleaned) &&
      !/^(yes|yep|yeah)\b/i.test(cleaned)
    ) {
      address = cleaned;
    }
  }

  if (!product || !name || !email || !address) return null;
  return {
    customerName: name,
    customerEmail: email,
    shippingAddress: address,
    items: [{ productId: product.id, productName: product.name, quantity: 1 }],
  };
}

function mergeCheckout(
  ...candidates: Array<unknown>
): PendingCheckout | null {
  const merged: Record<string, unknown> = {};
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const row = candidate as Record<string, unknown>;
    if (row.customerName) merged.customerName = row.customerName;
    if (row.customerEmail) merged.customerEmail = row.customerEmail;
    if (row.customerPhone) merged.customerPhone = row.customerPhone;
    if (row.shippingAddress) merged.shippingAddress = row.shippingAddress;
    if (Array.isArray(row.items) && row.items.length) merged.items = row.items;
  }
  const parsed = checkoutActionSchema.safeParse(merged);
  return parsed.success ? parsed.data : null;
}

function stripChoicePrompts(text: string) {
  return text
    .replace(/\n*Say \d+ for the [^\n]+/gi, "")
    .replace(/\n*which item would you like to order\??/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function payInstructions(channel: ChatChannel) {
  return channel === "whatsapp"
    ? "Tap Pay now. On Stripe you must type your own card details, or use Apple Pay, Google Pay, or Link. I cannot enter card numbers for you."
    : "I will open Stripe for you. You must type your card details yourself, or use Apple Pay, Google Pay, or Link. I cannot enter card numbers on your behalf.";
}

function paymentChoicePrompt(action: PendingCheckout, products: CatalogProduct[]) {
  const lines = action.items.map((item, index) => {
    const product = resolveCatalogProduct(products, item);
    const label = product?.name || item.productName || "item";
    const price = product ? ` — ${money(product.price_cents * item.quantity)}` : "";
    return `${index + 1}. ${label} × ${item.quantity}${price}`;
  });
  const total = action.items.reduce((sum, item) => {
    const product = resolveCatalogProduct(products, item);
    return sum + (product ? product.price_cents * item.quantity : 0);
  }, 0);

  return `Your order is ready.

${lines.join("\n")}
Ship to: ${action.shippingAddress}
Email: ${action.customerEmail}${action.customerPhone ? `\nPhone: ${action.customerPhone}` : ""}
Total: ${money(total)}

How would you like to pay? Say cash on delivery, or say Stripe.
If you choose Stripe, you will need to type your card details yourself on the Stripe page. I cannot enter card numbers for you. Cash on delivery means you pay when the dress arrives.`;
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

async function startStripeCheckout(
  agency: Agency,
  action: PendingCheckout,
  products: CatalogProduct[],
  channel: ChatChannel,
  checkoutMetadata?: Record<string, string>
): Promise<ChatResult> {
  const resolvedItems: { productId: string; quantity: number }[] = [];
  const missing: string[] = [];

  for (const item of action.items) {
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
    return {
      answer: `I couldn't start checkout yet: ${missing.join(", ") || "no matching catalog items"}.`,
    };
  }

  const checkout = await createCheckoutSession({
    agency,
    customerName: action.customerName,
    customerEmail: action.customerEmail,
    customerPhone: action.customerPhone,
    shippingAddress: action.shippingAddress,
    items: resolvedItems,
    cancelPath: "/",
    successQuery: channel === "whatsapp" ? "from=whatsapp" : "from=chat",
    metadata: { channel, ...(checkoutMetadata ?? {}) },
  });

  const summary = checkout.lineItems
    .map((item) => `${item.name} × ${item.quantity} (${money(item.unitPriceCents * item.quantity)})`)
    .join(", ");

  return {
    answer: `Your Stripe payment link for ${summary} is ready. Total ${money(checkout.subtotal)}. ${payInstructions(channel)}`,
    checkoutUrl: checkout.checkoutUrl,
    checkoutSessionId: checkout.sessionId,
    products: checkout.lineItems.map((item) => ({
      id: item.productId,
      name: item.name,
      price_cents: item.unitPriceCents,
      ...productLinks(agency, { id: item.productId }),
    })),
  };
}

async function startCodCheckout(
  agency: Agency,
  action: PendingCheckout,
  products: CatalogProduct[],
  channel: ChatChannel,
  checkoutMetadata?: Record<string, string>
): Promise<ChatResult> {
  const resolvedItems: { productId: string; quantity: number }[] = [];
  const missing: string[] = [];

  for (const item of action.items) {
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
    return {
      answer: `I couldn't place the cash-on-delivery order yet: ${missing.join(", ") || "no matching catalog items"}.`,
    };
  }

  const placed = await createCodOrder({
    agency,
    customerName: action.customerName,
    customerEmail: action.customerEmail,
    customerPhone: action.customerPhone,
    shippingAddress: action.shippingAddress,
    items: resolvedItems,
    channel,
    waUser: checkoutMetadata?.waUser,
  });

  const order = await loadOrderSummary(placed.id, agency.id);
  const details = order ? thankYouMessage(order) : `Thank you for ordering. Invoice ${placed.invoice_number} is confirmed.`;
  return {
    answer: `${details}\n\nPayment is cash on delivery. Please keep ${money(placed.total_cents)} ready when the order arrives.`,
    order: order ?? {
      id: placed.id,
      invoice_number: placed.invoice_number,
      status: placed.status,
      customer_name: placed.customer_name,
      customer_email: placed.customer_email,
      shipping_address: placed.shipping_address,
      total_cents: placed.total_cents,
      payment_method: placed.payment_method,
      created_at: placed.created_at,
      items: placed.items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        unit_price_cents: item.unit_price_cents,
      })),
    },
  };
}

function readBackOrder(action: PendingCheckout, products: CatalogProduct[]) {
  return paymentChoicePrompt(action, products);
}

export async function handleStoreChat(options: {
  agency: Agency;
  message?: string;
  history?: ChatTurn[];
  checkoutSessionId?: string;
  pendingCheckout?: PendingCheckout;
  /** Public URL of a photo the customer sent (WhatsApp media re-hosted on Cloudinary). */
  imageUrl?: string;
  channel?: ChatChannel;
  /** Extra Stripe metadata, e.g. the WhatsApp number to notify after payment. */
  checkoutMetadata?: Record<string, string>;
}): Promise<ChatResult> {
  const { agency, message, history = [], checkoutSessionId, imageUrl, checkoutMetadata } = options;
  const channel: ChatChannel = options.channel ?? "web";

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

  if (!message?.trim() && !imageUrl) {
    throw new HttpError(400, "Message is required");
  }

  const invoiceLookup = message ? await lookupInvoices(agency, message) : null;
  if (invoiceLookup) return invoiceLookup;

  const products = (await db("products")
    .where({ agency_id: agency.id, status: "published" })
    .select("id", "name", "description", "category", "price_cents", "stock")) as CatalogProduct[];

  const inferred = inferCheckout(history, message, products);
  const pending = mergeCheckout(options.pendingCheckout, inferred);

  if (pending && message && !isChangeOrder(message)) {
    const choice = detectPaymentChoice(message);
    if (choice === "cod") {
      try {
        return await startCodCheckout(agency, pending, products, channel, checkoutMetadata);
      } catch (error) {
        const reason = error instanceof HttpError ? error.message : "I couldn't place the cash-on-delivery order just now.";
        return { answer: reason, pendingCheckout: pending };
      }
    }
    if (choice === "stripe") {
      try {
        return await startStripeCheckout(agency, pending, products, channel, checkoutMetadata);
      } catch (error) {
        const reason = error instanceof HttpError ? error.message : "I couldn't create the payment link just now.";
        return { answer: reason, pendingCheckout: pending };
      }
    }
    if (isConfirmOrder(message)) {
      return { answer: paymentChoicePrompt(pending, products), pendingCheckout: pending };
    }
  }

  const catalog = products
    .map(
      (product, index) =>
        `${index + 1}. id: ${product.id} | ${product.name} | category: ${product.category} | price: ${money(
          product.price_cents
        )} | stock: ${product.stock} | ${product.description ?? ""}`
    )
    .join("\n");

  const paymentRule =
    "5. Never invent payment URLs and never put URLs in reply text. Never ask for card numbers, CVC, or expiry. The backend creates the Stripe link after the customer confirms.";

  const photoRule = imageUrl
    ? `
The customer sent a photo. Look at it carefully and identify the closest matching catalog products by garment type, colour, pattern, and style. Put their ids in "products". Describe each match in spoken language: colour, neckline, length, fabric or feel, and how formal it is. If nothing in the catalog is close, say so honestly and suggest the nearest alternatives.`
    : "";

  const userContent: unknown = imageUrl
    ? [
        { type: "text", text: message?.trim() || "Which of your products look like this?" },
        { type: "image_url", image_url: { url: imageUrl } },
      ]
    : message;

  const raw = await openRouterChat(
    [
      {
        role: "system",
        content: `You are the live assistant for ${agency.brand_name}, a women's clothing boutique. Be warm, concise, and easy to hear out loud. Address the customer as ma'am when it feels natural.

Answer the customer's actual question first. They may ask anything — styling, sizing, fabrics, returns, how the shop works, or just chat. How they use you is up to them. Do not dump the catalog, list stock, or start a sales script unless they ask what is available, want help choosing, or want to order.

Let them know, without pushing, that they can order dresses from this live inventory whenever they want. Mention that once on a greeting or "what can you do" question, then wait. Never invent products, prices, IDs, or stock. If something is missing or out of stock, say so.

If the customer typos an email, product name, number, or confirmation, silently correct it and continue. Do not ask them to retype. Examples: "saurabh@gmail" or "saurabh at gmial" → saurabh@gmail.com, "silk slp" → Silk Slip Dress, "plese oder" → place order.

Live catalog (use only when they ask about products, stock, or ordering):
${catalog || "No published products yet."}

When they want to shop or you recommend pieces, number them starting at 1 ("Say 1 for the silk slip, NPR 148") and describe colour, cut, length, fabric or feel, and occasion in one or two sentences. If the customer answers with a number, pick that catalog row. Always quote prices in Nepalese rupees (NPR), never USD or dollars.

The store has a virtual try-on page. Mention it only if they want to see a look on themselves. If they give height in cm and weight in kg, you may mention a rough size (XS–XL) as a guide, not a guarantee.
${photoRule}

If they want to order:
1. After they pick a piece, remember that choice. Never ask which item they want again, never say "Say 1" again, and set "products" to [].
2. Ask for order details one or two at a time: full name, email, then a shipping location.
3. Accept any location they give — a city, municipality, landmark, neighborhood, or rough description is enough. Do not validate, complete, or ask for street, ward, postal code, or country. Do not call an address incomplete.
4. As soon as you have an in-stock product, quantity, full name, email, and any location they stated, set "checkout" to that draft using their location as shippingAddress. The backend will read it back and ask cash on delivery or Stripe. Do not send a payment link yourself.
${paymentRule}
6. If they ask about an order or invoice but have not given an invoice number, ask for it (for example INV-LUMINA-1001). Do not invent order details.
7. Do not emit checkout again unless they change the order.
8. Never ask for card numbers or payment details. If they choose Stripe, tell them they must type card details themselves. If they choose cash on delivery, they pay when the order arrives.
9. "products" lists up to 5 catalog ids only while they are still choosing. After they pick an item, always return []. Never write product URLs yourself.

Return JSON only:
{"reply":"message for the customer","checkout":null,"products":["<catalog uuid>"]}
or
{"reply":"I have everything I need.","checkout":{"customerName":"...","customerEmail":"...","customerPhone":"...","shippingAddress":"...","items":[{"productId":"<catalog uuid>","productName":"<exact catalog name>","quantity":1}]},"products":[]}`,
      },
      ...history.slice(-10).map((item) => ({
        role: item.role,
        content: item.content,
      })),
      { role: "user", content: userContent },
    ],
    true
  );

  const parsed = parseModelJson(raw);
  let answer = parsed.reply;
  let checkoutUrl: string | undefined;
  let sessionId: string | undefined;

  const seen = new Set<string>();
  const recommended: ChatProductLink[] = [];
  for (const id of parsed.products) {
    if (seen.has(id) || recommended.length >= 5) continue;
    const product = products.find((row) => row.id === id);
    if (!product) continue;
    seen.add(id);
    recommended.push({
      id: product.id,
      name: product.name,
      price_cents: product.price_cents,
      ...productLinks(agency, product),
    });
  }

  let pendingCheckout: PendingCheckout | undefined;
  const draft = mergeCheckout(parsed.checkout, inferred, pending);

  if (draft) {
    const choice = message && !isChangeOrder(message) ? detectPaymentChoice(message) : null;
    if (choice === "cod") {
      try {
        return await startCodCheckout(agency, draft, products, channel, checkoutMetadata);
      } catch (error) {
        const reason = error instanceof HttpError ? error.message : "I couldn't place the cash-on-delivery order just now.";
        answer = `${answer}\n\n${reason}`.trim();
        pendingCheckout = draft;
      }
    } else if (choice === "stripe") {
      try {
        return await startStripeCheckout(agency, draft, products, channel, checkoutMetadata);
      } catch (error) {
        const reason = error instanceof HttpError ? error.message : "I couldn't create the payment link just now.";
        answer = `${answer}\n\n${reason}`.trim();
        pendingCheckout = draft;
      }
    } else {
      pendingCheckout = draft;
      answer = readBackOrder(draft, products);
    }
  }

  const fit = message ? extractFitHint(message) : null;
  if (fit) {
    answer = `${answer}\n\nSuggested size for that height and weight: ${fit}. This is a guide, not a fit guarantee.`.trim();
  }

  const collecting = isCollectingOrder(history, message);
  if (collecting && !pendingCheckout) {
    answer = stripChoicePrompts(answer);
    recommended.length = 0;
  } else if (recommended.length && !/say \d+\b/i.test(answer) && !pendingCheckout) {
    const options = recommended
      .map((product, index) => `Say ${index + 1} for the ${product.name}, ${money(product.price_cents)}.`)
      .join("\n");
    answer = `${answer}\n\n${options}`.trim();
  }

  return {
    answer,
    checkoutUrl,
    checkoutSessionId: sessionId ?? checkoutSessionId,
    products: recommended,
    pendingCheckout,
  };
}
