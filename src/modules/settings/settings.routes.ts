import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { env } from "../../config/env";
import { db } from "../../db/knex";
import { requireAuth } from "../../middleware/auth";
import { requireAgencyMatch, resolveTenant } from "../../middleware/tenant";
import { uploadImage } from "../../services/cloudinary";
import { asyncHandler, HttpError } from "../../utils/http";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const router = Router();

router.get(
  "/branding",
  resolveTenant,
  asyncHandler(async (req, res) => {
    const agency = req.agency!;
    res.json({
      branding: {
        name: agency.name,
        slug: agency.slug,
        brandName: agency.brand_name,
        logoUrl: agency.logo_url,
        primaryColor: agency.primary_color,
        tagline: agency.tagline,
        email: agency.email,
        phone: agency.phone,
        address: agency.address,
      },
    });
  })
);

router.use(resolveTenant, requireAuth("agency_admin"), requireAgencyMatch);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json({ settings: req.agency });
  })
);

router.patch(
  "/",
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        brandName: z.string().min(2).optional(),
        tagline: z.string().optional(),
        primaryColor: z.string().optional(),
        email: z
          .string()
          .optional()
          .transform((value) => value?.trim() || undefined)
          .pipe(z.string().email().optional()),
        phone: z.string().optional(),
        address: z.string().optional(),
      })
      .parse(req.body);

    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (body.brandName) updates.brand_name = body.brandName;
    if (body.tagline !== undefined) updates.tagline = body.tagline;
    if (body.primaryColor) updates.primary_color = body.primaryColor;
    if (body.email !== undefined) updates.email = body.email;
    if (body.phone !== undefined) updates.phone = body.phone;
    if (body.address !== undefined) updates.address = body.address;

    const [agency] = await db("agencies")
      .where({ id: req.agency!.id })
      .update(updates)
      .returning("*");

    res.json({ settings: agency });
  })
);

router.post(
  "/logo",
  upload.single("logo"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "Logo file is required");
    const logoUrl = await uploadImage(
      req.file.buffer,
      `agencies/${req.agency!.id}/branding`,
      env.cloudinary.workspaceUploadPreset || undefined
    );
    const [agency] = await db("agencies")
      .where({ id: req.agency!.id })
      .update({ logo_url: logoUrl, updated_at: new Date() })
      .returning("*");
    res.json({ settings: agency, logoUrl });
  })
);

export default router;
