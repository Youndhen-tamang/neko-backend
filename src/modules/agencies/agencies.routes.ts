import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "../../db/knex";
import { requireAuth } from "../../middleware/auth";
import { asyncHandler, HttpError } from "../../utils/http";

const router = Router();
router.use(requireAuth("super_admin"));

const optionalText = z.string().optional().transform((value) => value?.trim() || undefined);
const optionalEmail = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined)
  .pipe(z.string().email().optional());

const agencySchema = z.object({
  name: z.string().min(2),
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and dashes"),
  brandName: z.string().min(2),
  email: optionalEmail,
  phone: optionalText,
  address: optionalText,
  tagline: optionalText,
  primaryColor: z.string().optional(),
  adminName: z.string().min(2),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(6),
});

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const agencies = await db("agencies").orderBy("created_at", "desc");
    const withAdmins = await Promise.all(
      agencies.map(async (agency) => {
        const admin = await db("users")
          .where({ agency_id: agency.id, role: "agency_admin" })
          .first();
        const [{ count: productCount }] = await db("products")
          .where({ agency_id: agency.id })
          .count("id as count");
        const [{ count: orderCount }] = await db("orders")
          .where({ agency_id: agency.id })
          .count("id as count");
        return {
          ...agency,
          adminEmail: admin?.email ?? null,
          productCount: Number(productCount),
          orderCount: Number(orderCount),
        };
      })
    );
    res.json({ agencies: withAdmins });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const agency = await db("agencies").where({ id: req.params.id }).first();
    if (!agency) throw new HttpError(404, "Agency not found");
    const admin = await db("users")
      .where({ agency_id: agency.id, role: "agency_admin" })
      .first();
    res.json({ agency: { ...agency, adminEmail: admin?.email, adminName: admin?.name } });
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = agencySchema.parse(req.body);
    const existing = await db("agencies").where({ slug: body.slug }).first();
    if (existing) throw new HttpError(409, "Slug already in use");

    const agencyId = crypto.randomUUID();
    const [agency] = await db("agencies")
      .insert({
        id: agencyId,
        name: body.name,
        slug: body.slug,
        brand_name: body.brandName,
        email: body.email ?? null,
        phone: body.phone ?? null,
        address: body.address ?? null,
        tagline: body.tagline ?? null,
        primary_color: body.primaryColor ?? "#1f6b4a",
        status: "active",
      })
      .returning("*");

    await db("users").insert({
      id: crypto.randomUUID(),
      agency_id: agencyId,
      email: body.adminEmail.toLowerCase(),
      password_hash: await bcrypt.hash(body.adminPassword, 10),
      name: body.adminName,
      role: "agency_admin",
    });

    res.status(201).json({ agency });
  })
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        name: z.string().min(2).optional(),
        brandName: z.string().min(2).optional(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
        tagline: z.string().optional(),
        primaryColor: z.string().optional(),
        status: z.enum(["active", "suspended"]).optional(),
      })
      .parse(req.body);

    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (body.name) updates.name = body.name;
    if (body.brandName) updates.brand_name = body.brandName;
    if (body.email !== undefined) updates.email = body.email;
    if (body.phone !== undefined) updates.phone = body.phone;
    if (body.address !== undefined) updates.address = body.address;
    if (body.tagline !== undefined) updates.tagline = body.tagline;
    if (body.primaryColor) updates.primary_color = body.primaryColor;
    if (body.status) updates.status = body.status;

    const [agency] = await db("agencies")
      .where({ id: req.params.id })
      .update(updates)
      .returning("*");

    if (!agency) throw new HttpError(404, "Agency not found");
    res.json({ agency });
  })
);

export default router;
