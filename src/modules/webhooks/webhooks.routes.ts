import { Router } from "express";
import Stripe from "stripe";
import { env } from "../../config/env";
import { getStripe } from "../../services/stripe";
import { asyncHandler, HttpError } from "../../utils/http";
import { fulfillStripeSession } from "../../services/fulfillment";
import { verifyWebhookSignature } from "../../services/whatsapp";
import { processWhatsAppPayload } from "../../services/whatsapp-inbound";

const router = Router();

router.post(
  "/stripe",
  asyncHandler(async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (!signature || !env.stripe.webhookSecret) {
      throw new HttpError(400, "Missing Stripe webhook signature");
    }

    let event: Stripe.Event;
    try {
      event = getStripe().webhooks.constructEvent(
        req.body,
        signature,
        env.stripe.webhookSecret
      );
    } catch {
      throw new HttpError(400, "Invalid Stripe signature");
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      await fulfillStripeSession(session.id);
    }

    res.json({ received: true });
  })
);

// Meta webhook verification handshake
router.get("/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && env.whatsapp.verifyToken && token === env.whatsapp.verifyToken) {
    res.status(200).send(String(challenge ?? ""));
    return;
  }
  res.sendStatus(403);
});

// Inbound messages. Body is a raw Buffer (see app.ts) so the HMAC can be checked.
router.post("/whatsapp", (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
  if (!verifyWebhookSignature(raw, req.header("x-hub-signature-256"))) {
    res.sendStatus(401);
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    res.sendStatus(400);
    return;
  }

  // Meta retries anything that is not a fast 200, so acknowledge first and process after.
  res.sendStatus(200);
  void processWhatsAppPayload(payload as Parameters<typeof processWhatsAppPayload>[0]).catch((error) => {
    console.error("WhatsApp webhook processing failed", error);
  });
});

export default router;
