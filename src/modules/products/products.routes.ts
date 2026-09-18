import { NextFunction, Request, Response, Router } from "express";
import multer from "multer";
import { z } from "zod";
import { env } from "../../config/env";
import { db } from "../../db/knex";
import { requireAuth } from "../../middleware/auth";
import { requireAgencyMatch, resolveTenant } from "../../middleware/tenant";
import { uploadImage } from "../../services/cloudinary";
import { engagementCountSelects } from "../../services/engagement";
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

function requireProductAccess(req: Request, res: Response, next: NextFunction) {
  requireAuth("agency_admin", "super_admin")(req, res, (authErr) => {
    if (authErr) return next(authErr);

    if (req.user?.role === "super_admin") {
      const slug = (req.header("x-agency-slug") || req.query.agency || "").toString().trim();
      if (!slug) return next();
      return resolveTenant(req, res, next);
    }

    resolveTenant(req, res, (tenantErr) => {
      if (tenantErr) return next(tenantErr);
      requireAgencyMatch(req, res, next);
    });
  });
}

router.use(requireProductAccess);

function scopedProducts(req: Request) {
  const query = db("products")
    .select(
      "products.*",
      "agencies.name as agency_name",
      "agencies.slug as agency_slug",
      ...engagementCountSelects()
    )
    .leftJoin("agencies", "agencies.id", "products.agency_id");

  if (req.user?.role === "agency_admin") {
    query.where("products.agency_id", req.agency!.id);
  } else if (req.query.agencyId) {
    query.where("products.agency_id", req.query.agencyId.toString());
  } else if (req.agency?.id) {
    query.where("products.agency_id", req.agency.id);
  }

  return query;
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = req.query.q?.toString().trim();
    const category = req.query.category?.toString().trim();
    const status = req.query.status?.toString().trim();
    const query = scopedProducts(req).orderBy("products.created_at", "desc");

    if (q) {
      query.andWhere((builder) => {
        builder
          .whereILike("products.name", `%${q}%`)
          .orWhereILike("products.description", `%${q}%`)
          .orWhereILike("products.category", `%${q}%`);
      });
    }
    if (category) query.andWhere("products.category", category);
    if (status) query.andWhere("products.status", status);

    const products = await query;
    res.json({ products });
  })
);

router.post(
  "/draft-from-image",
  upload.single("image"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "Image file is required");
    const folder = `agencies/${req.agency?.id || "platform"}/products`;
    const imageUrl = await uploadImage(
      req.file.buffer,
      folder,
      env.cloudinary.uploadPreset || undefined
    );
    const draft = await draftProductFromImage(imageUrl);
    res.json({ imageUrl, draft });
  })
);

router.post(
  "/upload-image",
  upload.single("image"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "Image file is required");
    const folder = `agencies/${req.agency?.id || "platform"}/products`;
    const imageUrl = await uploadImage(
      req.file.buffer,
      folder,
      env.cloudinary.uploadPreset || undefined
    );
    res.json({ imageUrl });
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
  lowStockThreshold: z.number().int().nonnegative().optional(),
  status: z.enum(["draft", "published"]).default("published"),
  aiDraft: z.record(z.unknown()).optional(),
  agencyId: z.string().uuid().optional(),
});

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = confirmSchema.parse(req.body);
    const agencyId =
      req.user?.role === "super_admin" ? body.agencyId || req.agency?.id : req.agency?.id;
    if (!agencyId) throw new HttpError(400, "Agency is required");

    const [product] = await db("products")
      .insert({
        id: crypto.randomUUID(),
        agency_id: agencyId,
        name: body.name,
        description: body.description ?? "",
        category: body.category ?? "General",
        tags: body.tags ?? [],
        images: body.images,
        price_cents: body.priceCents,
        stock: body.stock,
        low_stock_threshold: body.lowStockThreshold ?? 5,
        status: body.status,
        ai_draft: body.aiDraft ?? null,
      })
      .returning("*");

    res.status(201).json({ product });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const query = db("products")
      .select(
        "products.*",
        "agencies.name as agency_name",
        "agencies.slug as agency_slug",
        ...engagementCountSelects()
      )
      .leftJoin("agencies", "agencies.id", "products.agency_id")
      .where("products.id", req.params.id);

    if (req.user?.role !== "super_admin") {
      query.andWhere("products.agency_id", req.agency!.id);
    }

    const product = await query.first();
    if (!product) throw new HttpError(404, "Product not found");
    res.json({ product });
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
        lowStockThreshold: z.number().int().nonnegative().optional(),
        status: z.enum(["draft", "published"]).optional(),
      })
      .parse(req.body);

    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (body.name) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.category !== undefined) updates.category = body.category;
    if (body.tags !== undefined) updates.tags = body.tags;
    if (body.images !== undefined) updates.images = body.images;
    if (body.priceCents !== undefined) updates.price_cents = body.priceCents;
    if (body.stock !== undefined) updates.stock = body.stock;
    if (body.lowStockThreshold !== undefined) updates.low_stock_threshold = body.lowStockThreshold;
    if (body.status) updates.status = body.status;

    const query = db("products").where({ id: req.params.id });
    if (req.user?.role !== "super_admin") {
      query.andWhere({ agency_id: req.agency!.id });
    }

    const [product] = await query.update(updates).returning("*");
    if (!product) throw new HttpError(404, "Product not found");
    res.json({ product });
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const query = db("products").where({ id: req.params.id });
    if (req.user?.role !== "super_admin") {
      query.andWhere({ agency_id: req.agency!.id });
    }
    const deleted = await query.delete();
    if (!deleted) throw new HttpError(404, "Product not found");
    res.status(204).send();
  })
);

export default router;
