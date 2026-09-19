import { Router } from "express";
import { z } from "zod";
import { resolveTenant } from "../../middleware/tenant";
import { handleStoreChat } from "../../services/chatbot";
import { asyncHandler } from "../../utils/http";

const router = Router();

router.post(
  "/",
  resolveTenant,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        message: z.string().min(1).optional(),
        checkoutSessionId: z.string().min(1).optional(),
        history: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string(),
            })
          )
          .optional(),
        pendingCheckout: z
          .object({
            customerName: z.string().min(2),
            customerEmail: z.string().email(),
            customerPhone: z.string().optional(),
            shippingAddress: z.string().min(4),
            items: z
              .array(
                z.object({
                  productId: z.string().optional(),
                  productName: z.string().optional(),
                  quantity: z.coerce.number().int().positive(),
                })
              )
              .min(1),
          })
          .optional(),
      })
      .refine((value) => Boolean(value.message || value.checkoutSessionId), {
        message: "Message or checkoutSessionId is required",
      })
      .parse(req.body);

    const result = await handleStoreChat({
      agency: req.agency!,
      message: body.message,
      history: body.history,
      checkoutSessionId: body.checkoutSessionId,
      pendingCheckout: body.pendingCheckout,
    });

    res.json(result);
  })
);

export default router;
