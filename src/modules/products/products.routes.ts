import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { env } from "../../config/env";
import { db } from "../../db/knex";
import { requireAuth } from "../../middleware/auth";
import { requireAgencyMatch, resolveTenant } from "../../middleware/tenant";
import { uploadImage } from "../../services/cloudinary";
import { draftProductFromImage } from "../../services/openrouter";
import { asyncHandler, HttpError } from "../../utils/http";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

const router = Router();

router.get(
  "/public",
  resolveTenant,
  asyncHandler(async (req, res) => {
    const products = await db("products")
      .where({ agency_id: req.agency!.id, status: "published" })
      .orderBy("created_at", "desc");
    res.json({ products });
  })
);

router.get(
  "/public/:id",
  resolveTenant,
  asyncHandler(async (req, res) => {
    const product = await db("products")
      .where({ id: req.params.id, agency_id: req.agency!.id, status: "published" })
      .first();
    if (!product) throw new HttpError(404, "Product not found");
    res.json({ product });
  })
);

router.use(resolveTenant, requireAuth("agency_admin"), requireAgencyMatch);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const products = await db("products")
      .where({ agency_id: req.agency!.id })
      .orderBy("created_at", "desc");
    res.json({ products });
  })
);

router.post(
  "/draft-from-image",
  upload.single("image"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "Image file is required");

    const imageUrl = await uploadImage(
      req.file.buffer,
      `agencies/${req.agency!.id}/products`,
      env.cloudinary.uploadPreset || undefined
    );
    const draft = await draftProductFromImage(imageUrl);
    res.json({ imageUrl, draft });
  })
);

const confirmSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  images: z.array(z.string()).min(1),
  priceCents: z.number().int().nonnegative(),
  stock: z.number().int().nonnegative(),
  status: z.enum(["draft", "published"]).default("published"),
  aiDraft: z.record(z.unknown()).optional(),
});

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = confirmSchema.parse(req.body);
    const [product] = await db("products")
      .insert({
        id: crypto.randomUUID(),
        agency_id: req.agency!.id,
        name: body.name,
        description: body.description ?? "",
        category: body.category ?? "General",
        tags: body.tags ?? [],
        images: body.images,
        price_cents: body.priceCents,
        stock: body.stock,
        status: body.status,
        ai_draft: body.aiDraft ?? null,
      })
      .returning("*");

    res.status(201).json({ product });
  })
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        category: z.string().optional(),
        tags: z.array(z.string()).optional(),
        images: z.array(z.string()).optional(),
        priceCents: z.number().int().nonnegative().optional(),
        stock: z.number().int().nonnegative().optional(),
        status: z.enum(["draft", "published"]).optional(),
      })
      .parse(req.body);

    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (body.name) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.category !== undefined) updates.category = body.category;
    if (body.tags) updates.tags = body.tags;
    if (body.images) updates.images = body.images;
    if (body.priceCents !== undefined) updates.price_cents = body.priceCents;
    if (body.stock !== undefined) updates.stock = body.stock;
    if (body.status) updates.status = body.status;

    const [product] = await db("products")
      .where({ id: req.params.id, agency_id: req.agency!.id })
      .update(updates)
      .returning("*");

    if (!product) throw new HttpError(404, "Product not found");
    res.json({ product });
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const deleted = await db("products")
      .where({ id: req.params.id, agency_id: req.agency!.id })
      .delete();
    if (!deleted) throw new HttpError(404, "Product not found");
    res.status(204).send();
  })
);

export default router;
