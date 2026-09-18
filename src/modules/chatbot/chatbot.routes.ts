import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/knex";
import { resolveTenant } from "../../middleware/tenant";
import { openRouterChat } from "../../services/openrouter";
import { asyncHandler } from "../../utils/http";

const router = Router();

router.post(
  "/",
  resolveTenant,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        message: z.string().min(1),
        history: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string(),
            })
          )
          .optional(),
      })
      .parse(req.body);

    const products = await db("products")
      .where({ agency_id: req.agency!.id, status: "published" })
      .select("id", "name", "description", "category", "price_cents", "stock", "tags");

    const catalog = products
      .map(
        (product) =>
          `- ${product.name} | category: ${product.category} | price: $${(
            product.price_cents / 100
          ).toFixed(2)} | stock: ${product.stock} | ${product.description ?? ""}`
      )
      .join("\n");

    const answer = await openRouterChat([
      {
        role: "system",
        content: `You are the live shopping assistant for ${req.agency!.brand_name}. Answer only from the current catalog and stock numbers below. If something is out of stock, say so. If a product is not in the catalog, say you cannot find it. Do not invent prices or quantities.

Live catalog:
${catalog || "No published products yet."}`,
      },
      ...(body.history ?? []).map((item) => ({
        role: item.role,
        content: item.content,
      })),
      { role: "user", content: body.message },
    ]);

    res.json({ answer });
  })
);

export default router;
