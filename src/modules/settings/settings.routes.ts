import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { env } from "../../config/env";
import { db } from "../../db/knex";
import { requireAuth } from "../../middleware/auth";
import { requireAgencyMatch, resolveTenant } from "../../middleware/tenant";
import { uploadImage } from "../../services/cloudinary";
import { fetchPhoneProfile } from "../../services/whatsapp";
import { DEFAULT_LANDING_TEMPLATE, LANDING_TEMPLATES } from "../../types";
import { asyncHandler, HttpError } from "../../utils/http";
import { decryptSecret, encryptSecret } from "../../utils/secrets";

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
        landingTemplate: agency.landing_template || DEFAULT_LANDING_TEMPLATE,
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
        landingTemplate: z.enum(LANDING_TEMPLATES).optional(),
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
    if (body.landingTemplate) updates.landing_template = body.landingTemplate;
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

function apiBaseUrl(req: { protocol: string; get: (name: string) => string | undefined }) {
  return process.env.PUBLIC_API_URL || `${req.protocol}://${req.get("host")}`;
}

function whatsappView(row: Record<string, unknown> | undefined, webhookUrl: string) {
  return {
    enabled: Boolean(row?.enabled),
    phoneNumberId: (row?.phone_number_id as string | null) ?? "",
    displayPhone: (row?.display_phone as string | null) ?? "",
    hasAccessToken: Boolean(row?.access_token_enc),
    accessTokenLast4: (row?.access_token_last4 as string | null) ?? null,
    webhookUrl,
    verifyTokenConfigured: Boolean(env.whatsapp.verifyToken),
  };
}

router.get(
  "/whatsapp",
  asyncHandler(async (req, res) => {
    const row = await db("agency_integrations")
      .where({ agency_id: req.agency!.id, provider: "whatsapp" })
      .first();
    res.json({ whatsapp: whatsappView(row, `${apiBaseUrl(req)}/api/webhooks/whatsapp`) });
  })
);

router.put(
  "/whatsapp",
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        enabled: z.boolean(),
        phoneNumberId: z.string().trim().optional(),
        displayPhone: z.string().trim().optional(),
        accessToken: z.string().trim().optional(),
      })
      .parse(req.body);

    const existing = await db("agency_integrations")
      .where({ agency_id: req.agency!.id, provider: "whatsapp" })
      .first();

    const phoneNumberId = body.phoneNumberId ?? existing?.phone_number_id ?? null;
    const hasToken = Boolean(body.accessToken) || Boolean(existing?.access_token_enc);
    if (body.enabled && (!phoneNumberId || !hasToken)) {
      throw new HttpError(400, "Add the phone number ID and access token before enabling WhatsApp");
    }

    if (phoneNumberId) {
      const clash = await db("agency_integrations")
        .where({ phone_number_id: phoneNumberId })
        .whereNot({ agency_id: req.agency!.id })
        .first();
      if (clash) throw new HttpError(409, "That phone number ID is already connected to another store");
    }

    const record: Record<string, unknown> = {
      enabled: body.enabled,
      phone_number_id: phoneNumberId,
      updated_at: new Date(),
    };
    if (body.displayPhone !== undefined) record.display_phone = body.displayPhone || null;
    if (body.accessToken) {
      record.access_token_enc = encryptSecret(body.accessToken);
      record.access_token_last4 = body.accessToken.slice(-4);
    }

    const [row] = await db("agency_integrations")
      .insert({ id: crypto.randomUUID(), agency_id: req.agency!.id, provider: "whatsapp", ...record })
      .onConflict(["agency_id", "provider"])
      .merge(record)
      .returning("*");

    res.json({ whatsapp: whatsappView(row, `${apiBaseUrl(req)}/api/webhooks/whatsapp`) });
  })
);

router.post(
  "/whatsapp/test",
  asyncHandler(async (req, res) => {
    const row = await db("agency_integrations")
      .where({ agency_id: req.agency!.id, provider: "whatsapp" })
      .first();
    if (!row?.access_token_enc || !row.phone_number_id) {
      throw new HttpError(400, "Save a phone number ID and access token first");
    }
    const profile = await fetchPhoneProfile({
      accessToken: decryptSecret(row.access_token_enc),
      phoneNumberId: row.phone_number_id,
    });
    res.json({
      ok: true,
      displayPhoneNumber: profile.display_phone_number ?? null,
      verifiedName: profile.verified_name ?? null,
      qualityRating: profile.quality_rating ?? null,
    });
  })
);

export default router;
