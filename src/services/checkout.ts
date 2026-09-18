import { env } from "../config/env";
import { db } from "../db/knex";
import { Agency } from "../types";
import { HttpError } from "../utils/http";
import { storeUrlForSlug } from "../utils/tenant";
import { getStripe } from "./stripe";

export type CheckoutItemInput = {
  productId: string;
  quantity: number;
};

export type CreateCheckoutInput = {
  agency: Agency;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  shippingAddress: string;
  items: CheckoutItemInput[];
  successPath?: string;
  cancelPath?: string;
  successQuery?: string;
  metadata?: Record<string, string>;
};

function productImages(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((image): image is string => typeof image === "string");
  return [];
}

export async function createCheckoutSession(input: CreateCheckoutInput) {
  const products = await db("products")
    .whereIn(
      "id",
      input.items.map((item) => item.productId)
    )
    .andWhere({ agency_id: input.agency.id, status: "published" });

  if (products.length !== input.items.length) {
    throw new HttpError(400, "One or more products are unavailable");
  }

  const lineItems = input.items.map((item) => {
    const product = products.find((row) => row.id === item.productId)!;
    if (product.stock < item.quantity) {
      throw new HttpError(400, `${product.name} does not have enough stock`);
    }
    return {
      product,
      quantity: item.quantity,
      unitPriceCents: product.price_cents as number,
    };
  });

  const subtotal = lineItems.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
  const successPath = input.successPath ?? "/checkout/success";
  const extraQuery = input.successQuery ? `&${input.successQuery.replace(/^\?/, "").replace(/^&/, "")}` : "";

  const session = await getStripe().checkout.sessions.create({
    mode: "payment",
    customer_email: input.customerEmail,
    success_url: `${storeUrlForSlug(env.storeUrl, input.agency.slug, successPath)}?session_id={CHECKOUT_SESSION_ID}${extraQuery}`,
    cancel_url: storeUrlForSlug(env.storeUrl, input.agency.slug, input.cancelPath ?? "/cart"),
    line_items: lineItems.map((item) => ({
      quantity: item.quantity,
      price_data: {
        currency: "usd",
        unit_amount: item.unitPriceCents,
        product_data: {
          name: item.product.name,
          images: productImages(item.product.images),
        },
      },
    })),
    metadata: {
      ...(input.metadata ?? {}),
      agencyId: input.agency.id,
      agencySlug: input.agency.slug,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerPhone: input.customerPhone ?? "",
      shippingAddress: input.shippingAddress,
      items: JSON.stringify(
        lineItems.map((item) => ({
          productId: item.product.id,
          name: item.product.name,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          imageUrl: productImages(item.product.images)[0] ?? null,
        }))
      ),
      subtotalCents: String(subtotal),
    },
  });

  if (!session.url) {
    throw new HttpError(502, "Stripe did not return a payment link");
  }

  return {
    checkoutUrl: session.url,
    sessionId: session.id,
    subtotal,
    lineItems: lineItems.map((item) => ({
      productId: item.product.id as string,
      name: item.product.name as string,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
    })),
  };
}
