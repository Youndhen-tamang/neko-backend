import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/knex";
import { requireAuth } from "../../middleware/auth";
import { simpleRateLimit } from "../../middleware/rate-limit";
import { asyncHandler, HttpError } from "../../utils/http";

const router = Router();

const optionalText = z.string().optional().transform((value) => value?.trim() || undefined);
const optionalEmail = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined)
  .pipe(z.string().email().optional());

const createSchema = z.object({
  name: z.string().min(2),
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase letters, numbers, and dashes"),
  brandName: optionalText,
  email: optionalEmail,
  phone: optionalText,
  address: optionalText,
  tagline: optionalText,
  adminName: z.string().min(2),
  adminEmail: z.string().email(),
  message: optionalText,
});

function serialize(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    brandName: row.brand_name,
    email: row.email || "",
    phone: row.phone || "",
    address: row.address || "",
    tagline: row.tagline || "",
    adminName: row.admin_name,
    adminEmail: row.admin_email,
    message: row.message || "",
    status: row.status,
    createdAt: row.created_at,
  };
}

router.post(
  "/",
  simpleRateLimit({ windowMs: 15 * 60 * 1000, max: 8 }),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const [row] = await db("tenant_requests")
      .insert({
        id: crypto.randomUUID(),
        name: body.name.trim(),
        slug: body.slug,
        brand_name: body.brandName || body.name.trim(),
        email: body.email || body.adminEmail.toLowerCase(),
        phone: body.phone ?? null,
        address: body.address ?? null,
        tagline: body.tagline ?? null,
        admin_name: body.adminName.trim(),
        admin_email: body.adminEmail.toLowerCase(),
        message: body.message ?? null,
        status: "pending",
      })
      .returning("*");

    res.status(201).json({ request: serialize(row) });
  })
);

router.get(
  "/",
  requireAuth("super_admin"),
  asyncHandler(async (_req, res) => {
    const rows = await db("tenant_requests").orderBy("created_at", "desc");
    res.json({ requests: rows.map(serialize) });
  })
);

router.get(
  "/:id",
  requireAuth("super_admin"),
  asyncHandler(async (req, res) => {
    const row = await db("tenant_requests").where({ id: req.params.id }).first();
    if (!row) throw new HttpError(404, "Request not found");
    res.json({ request: serialize(row) });
  })
);

router.patch(
  "/:id",
  requireAuth("super_admin"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        status: z.enum(["pending", "approved", "rejected"]),
      })
      .parse(req.body);

    const [row] = await db("tenant_requests")
      .where({ id: req.params.id })
      .update({ status: body.status, updated_at: new Date() })
      .returning("*");

    if (!row) throw new HttpError(404, "Request not found");
    res.json({ request: serialize(row) });
  })
);

export default router;
