import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env";
import { resolveTenant } from "../../middleware/tenant";
import { buildEsewaForm, decodeEsewaData, esewaEnabled } from "../../services/esewa";
import { createEsewaPayment, fulfillEsewaPayment } from "../../services/fulfillment";
import { asyncHandler, HttpError } from "../../utils/http";
import { storeUrlForSlug } from "../../utils/tenant";

const router = Router();

const checkoutSchema = z.object({
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
});

router.get("/status", (_req, res) => {
  res.json({ enabled: esewaEnabled(), mode: env.esewa.mode });
});

// Validates the cart, stores a pending payment, and returns the signed form the browser POSTs to eSewa.
router.post(
  "/initiate",
  resolveTenant,
  asyncHandler(async (req, res) => {
    if (!esewaEnabled()) throw new HttpError(503, "eSewa is not configured");
    const body = checkoutSchema.parse(req.body);
    const agency = req.agency!;

    const payment = await createEsewaPayment({ agency, ...body, channel: "web" });
    const form = buildEsewaForm({
      transactionUuid: payment.id,
      amountCents: payment.amountCents,
      successUrl: storeUrlForSlug(env.storeUrl, agency.slug, "/payment/success"),
      failureUrl: storeUrlForSlug(env.storeUrl, agency.slug, "/payment/failed"),
    });
    res.json(form);
  })
);

// Called by the success page with the base64 `data` eSewa appended to the redirect.
router.post(
  "/verify",
  resolveTenant,
  asyncHandler(async (req, res) => {
    const { data } = z.object({ data: z.string().min(1) }).parse(req.body);
    const callback = decodeEsewaData(data);
    if (!callback.transaction_uuid) throw new HttpError(400, "Missing eSewa transaction id");

    const order = await fulfillEsewaPayment(callback.transaction_uuid, req.agency!.id);
    if (!order) throw new HttpError(402, "Payment not completed");
    res.json({ order });
  })
);

export default router;
