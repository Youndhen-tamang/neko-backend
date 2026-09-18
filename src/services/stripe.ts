import Stripe from "stripe";
import { env } from "../config/env";
import { HttpError } from "../utils/http";

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (!env.stripe.secretKey) {
    throw new HttpError(500, "STRIPE_SECRET_KEY is not configured");
  }
  if (!stripeClient) {
    stripeClient = new Stripe(env.stripe.secretKey);
  }
  return stripeClient;
}
