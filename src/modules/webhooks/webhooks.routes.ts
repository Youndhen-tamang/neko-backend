import { Router } from "express";
import Stripe from "stripe";
import { env } from "../../config/env";
import { getStripe } from "../../services/stripe";
import { asyncHandler, HttpError } from "../../utils/http";
import { fulfillStripeSession } from "../../services/fulfillment";

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

export default router;
