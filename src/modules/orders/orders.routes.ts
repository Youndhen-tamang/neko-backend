import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env";
import { db } from "../../db/knex";
import { requireAuth } from "../../middleware/auth";
import { requireAgencyMatch, resolveTenant } from "../../middleware/tenant";
import { createNotification } from "../../services/notifications";
import { fulfillStripeSession } from "../../services/fulfillment";
import { getStripe } from "../../services/stripe";
import { ORDER_STATUSES } from "../../types";
import { asyncHandler, HttpError } from "../../utils/http";
import { storeUrlForSlug } from "../../utils/tenant";

const router = Router();

router.post(
  "/checkout",
  resolveTenant,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        customerName: z.string().min(2),
        customerEmail: z.string().email(),
        customerPhone: z.string().optional(),
        shippingAddress: z.string().min(4),
        items: z
          .array(
            z.object({
              productId: z.string().uuid(),
              quantity: z.number().int().positive(),
            })
          )
          .min(1),
      })
      .parse(req.body);

    const agency = req.agency!;
    const products = await db("products")
      .whereIn(
        "id",
        body.items.map((item) => item.productId)
      )
      .andWhere({ agency_id: agency.id, status: "published" });

    if (products.length !== body.items.length) {
      throw new HttpError(400, "One or more products are unavailable");
    }

    const lineItems = body.items.map((item) => {
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

    const subtotal = lineItems.reduce(
      (sum, item) => sum + item.unitPriceCents * item.quantity,
      0
    );

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: body.customerEmail,
      success_url: `${storeUrlForSlug(env.storeUrl, agency.slug, "/checkout/success")}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: storeUrlForSlug(env.storeUrl, agency.slug, "/cart"),
      line_items: lineItems.map((item) => ({
        quantity: item.quantity,
        price_data: {
          currency: "usd",
          unit_amount: item.unitPriceCents,
          product_data: {
            name: item.product.name,
            images: Array.isArray(item.product.images)
              ? item.product.images.filter((image: unknown) => typeof image === "string")
              : [],
          },
        },
      })),
      metadata: {
        agencyId: agency.id,
        agencySlug: agency.slug,
        customerName: body.customerName,
        customerEmail: body.customerEmail,
        customerPhone: body.customerPhone ?? "",
        shippingAddress: body.shippingAddress,
        items: JSON.stringify(
          lineItems.map((item) => ({
            productId: item.product.id,
            name: item.product.name,
            quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
            imageUrl: Array.isArray(item.product.images) ? item.product.images[0] : null,
          }))
        ),
        subtotalCents: String(subtotal),
      },
    });

    res.json({ checkoutUrl: session.url, sessionId: session.id });
  })
);

router.post(
  "/confirm",
  resolveTenant,
  asyncHandler(async (req, res) => {
    const { sessionId } = z.object({ sessionId: z.string().min(1) }).parse(req.body);
    const order = await fulfillStripeSession(sessionId);
    if (!order) throw new HttpError(404, "Payment session not found or unpaid");
    const items = await db("order_items").where({ order_id: order.id });
    res.json({ order: { ...order, items } });
  })
);

router.get(
  "/session/:sessionId",
  resolveTenant,
  asyncHandler(async (req, res) => {
    const order = await db("orders")
      .where({
        stripe_checkout_session_id: req.params.sessionId,
        agency_id: req.agency!.id,
      })
      .first();
    if (!order) throw new HttpError(404, "Order not found");
    const items = await db("order_items").where({ order_id: order.id });
    res.json({ order: { ...order, items } });
  })
);

router.use(resolveTenant, requireAuth("agency_admin"), requireAgencyMatch);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const status = req.query.status?.toString();
    const query = db("orders").where({ agency_id: req.agency!.id }).orderBy("created_at", "desc");
    if (status) query.andWhere({ status });
    const orders = await query;
    const withItems = await Promise.all(
      orders.map(async (order) => ({
        ...order,
        items: await db("order_items").where({ order_id: order.id }),
      }))
    );
    res.json({ orders: withItems });
  })
);

router.patch(
  "/:id/status",
  asyncHandler(async (req, res) => {
    const { status } = z
      .object({ status: z.enum(ORDER_STATUSES as [string, ...string[]]) })
      .parse(req.body);

    const [order] = await db("orders")
      .where({ id: req.params.id, agency_id: req.agency!.id })
      .update({ status, updated_at: new Date() })
      .returning("*");

    if (!order) throw new HttpError(404, "Order not found");

    await createNotification({
      agencyId: req.agency!.id,
      type: "order_status",
      title: `Order ${order.invoice_number} marked ${status}`,
      body: `${order.customer_name}'s order is now ${status}.`,
      meta: { orderId: order.id, status },
    });

    res.json({ order });
  })
);

export default router;
