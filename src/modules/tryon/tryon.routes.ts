import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { db } from "../../db/knex";
import { simpleRateLimit } from "../../middleware/rate-limit";
import { resolveTenant } from "../../middleware/tenant";
import { generateTryOn } from "../../services/tryon";
import { asyncHandler, HttpError } from "../../utils/http";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

const router = Router();

const tryOnLimit = simpleRateLimit({ windowMs: 10 * 60 * 1000, max: 5 });

router.post(
  "/",
  resolveTenant,
  tryOnLimit,
  upload.single("photo"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "A full-body photo is required");
    if (!req.file.mimetype.startsWith("image/")) throw new HttpError(400, "Please upload an image file");

    const body = z
      .object({
        productId: z.string().uuid(),
        heightCm: z.coerce.number().min(100).max(230),
        weightKg: z.coerce.number().min(30).max(250),
        phone: z.string().trim().max(32).optional(),
      })
      .parse(req.body);

    const product = await db("products")
      .where({ id: body.productId, agency_id: req.agency!.id, status: "published" })
      .first();
    if (!product) throw new HttpError(404, "Product not found");

    const result = await generateTryOn({
      agency: req.agency!,
      product,
      personBuffer: req.file.buffer,
      personMime: req.file.mimetype,
      heightCm: body.heightCm,
      weightKg: body.weightKg,
      channel: "web",
      phone: body.phone,
      ip: req.ip,
    });

    res.json({
      session: {
        id: result.id,
        resultUrl: result.resultUrl,
        sizeHint: result.sizeHint,
        product: {
          id: product.id,
          name: product.name,
          price_cents: product.price_cents,
          images: product.images,
          stock: product.stock,
        },
      },
    });
  })
);

router.get(
  "/:id",
  resolveTenant,
  asyncHandler(async (req, res) => {
    const session = await db("tryon_sessions")
      .where({ id: req.params.id, agency_id: req.agency!.id })
      .first();
    if (!session) throw new HttpError(404, "Try-on session not found");
    const product = session.product_id
      ? await db("products").where({ id: session.product_id }).first()
      : null;
    res.json({
      session: {
        id: session.id,
        status: session.status,
        resultUrl: session.result_url,
        sizeHint: session.size_hint,
        product: product
          ? { id: product.id, name: product.name, price_cents: product.price_cents, images: product.images, stock: product.stock }
          : null,
      },
    });
  })
);

export default router;
