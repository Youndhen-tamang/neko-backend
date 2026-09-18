import { db } from "../db/knex";
import { sendInvoiceEmail } from "./email";
import { createNotification } from "./notifications";
import { getStripe } from "./stripe";

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100
  );
}

export async function fulfillStripeSession(sessionId: string) {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.payment_status !== "paid" || !session.metadata?.agencyId) return null;

  const existing = await db("orders")
    .where({ stripe_checkout_session_id: session.id })
    .first();
  if (existing) return existing;

  const agency = await db("agencies").where({ id: session.metadata.agencyId }).first();
  if (!agency) return null;

  const items = JSON.parse(session.metadata.items || "[]") as {
    productId: string;
    name: string;
    quantity: number;
    unitPriceCents: number;
    imageUrl?: string | null;
  }[];

  const invoiceNumber = `INV-${agency.slug.toUpperCase()}-${Date.now()}`;
  const totalCents = Number(session.metadata.subtotalCents ?? session.amount_total ?? 0);
  const orderId = crypto.randomUUID();

  const [order] = await db("orders")
    .insert({
      id: orderId,
      agency_id: agency.id,
      invoice_number: invoiceNumber,
      status: "ordered",
      customer_name: session.metadata.customerName,
      customer_email: session.metadata.customerEmail,
      customer_phone: session.metadata.customerPhone || null,
      shipping_address: session.metadata.shippingAddress,
      subtotal_cents: totalCents,
      total_cents: totalCents,
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id:
        typeof session.payment_intent === "string" ? session.payment_intent : null,
    })
    .returning("*");

  if (items.length) {
    await db("order_items").insert(
      items.map((item) => ({
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

  for (const item of items) {
    await db("products")
      .where({ id: item.productId, agency_id: agency.id })
      .decrement("stock", item.quantity);
  }

  const lowStock = await db("products")
    .where({ agency_id: agency.id })
    .andWhereRaw("stock <= low_stock_threshold");

  for (const product of lowStock) {
    await createNotification({
      agencyId: agency.id,
      type: "low_stock",
      title: `${product.name} is low on stock`,
      body: `Only ${product.stock} left in inventory.`,
      meta: { productId: product.id },
    });
  }

  await createNotification({
    agencyId: agency.id,
    type: "order",
    title: `New order ${invoiceNumber}`,
    body: `${session.metadata.customerName} placed an order for ${money(totalCents)}.`,
    meta: { orderId },
  });

  try {
    const sent = await sendInvoiceEmail({
      to: session.metadata.customerEmail,
      agencyName: agency.brand_name,
      logoUrl: agency.logo_url,
      primaryColor: agency.primary_color,
      invoiceNumber,
      customerName: session.metadata.customerName,
      items: items.map((item) => ({
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

  return order;
}
