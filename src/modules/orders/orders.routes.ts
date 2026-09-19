import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/knex";
import { requireAuth } from "../../middleware/auth";
import { requireAgencyMatch, resolveTenant } from "../../middleware/tenant";
import { createCheckoutSession } from "../../services/checkout";
import { createNotification } from "../../services/notifications";
import { createCodOrder, fulfillStripeSession } from "../../services/fulfillment";
import { ORDER_STATUSES } from "../../types";
import { asyncHandler, HttpError } from "../../utils/http";

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
    const checkout = await createCheckoutSession({
      agency,
      customerName: body.customerName,
      customerEmail: body.customerEmail,
      customerPhone: body.customerPhone,
      shippingAddress: body.shippingAddress,
      items: body.items,
    });

    res.json({ checkoutUrl: checkout.checkoutUrl, sessionId: checkout.sessionId });
  })
);

router.post(
  "/cod",
  resolveTenant,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        customerName: z.string().min(2),
        customerEmail: z.string().email(),
        customerPhone: z.string().optional(),
        shippingAddress: z.string().min(2),
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

    const order = await createCodOrder({
      agency: req.agency!,
      customerName: body.customerName,
      customerEmail: body.customerEmail,
      customerPhone: body.customerPhone,
      shippingAddress: body.shippingAddress,
      items: body.items,
      channel: "web",
    });

    res.json({ order });
  })
);

router.get(
  "/placed/:id",
  resolveTenant,
  asyncHandler(async (req, res) => {
    const order = await db("orders")
      .where({ id: req.params.id, agency_id: req.agency!.id })
      .first();
    if (!order) throw new HttpError(404, "Order not found");
    const items = await db("order_items").where({ order_id: order.id });
    res.json({ order: { ...order, items } });
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

router.use(resolveTenant, requireAuth("agency_admin", "super_admin"), requireAgencyMatch);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const status = req.query.status?.toString();
    const q = req.query.q?.toString().trim();
    const from = req.query.from?.toString();
    const to = req.query.to?.toString();
    const query = db("orders").where({ agency_id: req.agency!.id }).orderBy("created_at", "desc");
    if (status) query.andWhere({ status });
    if (from) query.andWhere("created_at", ">=", new Date(from));
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      query.andWhere("created_at", "<=", end);
    }
    if (q) {
      query.andWhere((builder) => {
        builder
          .whereILike("invoice_number", `%${q}%`)
          .orWhereILike("customer_name", `%${q}%`)
          .orWhereILike("customer_email", `%${q}%`);
      });
    }
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
