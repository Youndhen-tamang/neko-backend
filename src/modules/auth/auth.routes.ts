import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
import { env } from "../../config/env";
import { db } from "../../db/knex";
import { simpleRateLimit } from "../../middleware/rate-limit";
import { requireAuth, signToken } from "../../middleware/auth";
import { sendPasswordResetEmail } from "../../services/email";
import { asyncHandler, HttpError } from "../../utils/http";
import { storeUrlForSlug } from "../../utils/tenant";

const router = Router();

router.post(
  "/super-admin/login",
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        email: z.string().email(),
        password: z.string().min(1),
      })
      .parse(req.body);

    if (
      body.email.toLowerCase() !== env.superAdminEmail.toLowerCase() ||
      body.password !== env.superAdminPassword
    ) {
      throw new HttpError(401, "Invalid super admin credentials");
    }

    const token = signToken({
      id: "super-admin",
      email: env.superAdminEmail,
      role: "super_admin",
      name: "Super Admin",
    });

    res.json({
      token,
      user: { email: env.superAdminEmail, role: "super_admin", name: "Super Admin" },
    });
  })
);

router.post(
  "/admin/login",
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        email: z.string().email(),
        password: z.string().min(1),
        agencySlug: z.string().min(1),
      })
      .parse(req.body);

    const agency = await db("agencies").where({ slug: body.agencySlug }).first();
    if (!agency || agency.status !== "active") {
      throw new HttpError(401, "Invalid credentials");
    }

    const user = await db("users")
      .where({ agency_id: agency.id, email: body.email.toLowerCase(), role: "agency_admin" })
      .first();

    if (!user || !(await bcrypt.compare(body.password, user.password_hash))) {
      throw new HttpError(401, "Invalid credentials");
    }

    const token = signToken({
      id: user.id,
      email: user.email,
      role: "agency_admin",
      agencyId: agency.id,
      name: user.name,
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: "agency_admin",
        agencyId: agency.id,
        agencySlug: agency.slug,
      },
    });
  })
);

router.post(
  "/admin/forgot-password",
  simpleRateLimit({ windowMs: 15 * 60 * 1000, max: 5 }),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        email: z.string().email(),
        agencySlug: z.string().min(1),
      })
      .parse(req.body);

    const generic = { ok: true, message: "If that account exists, we sent a reset link to the admin email." };
    const agency = await db("agencies").where({ slug: body.agencySlug, status: "active" }).first();
    const user = agency
      ? await db("users")
          .where({ agency_id: agency.id, email: body.email.toLowerCase(), role: "agency_admin" })
          .first()
      : null;

    if (!agency || !user) {
      res.json(generic);
      return;
    }

    await db("password_reset_tokens").where({ user_id: user.id }).del();
    const rawToken = crypto.randomBytes(32).toString("base64url");
    await db("password_reset_tokens").insert({
      id: crypto.randomUUID(),
      user_id: user.id,
      token_hash: crypto.createHash("sha256").update(rawToken).digest("hex"),
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
    });

    const resetUrl = storeUrlForSlug(env.storeUrl, agency.slug, `/admin/reset-password?token=${rawToken}`);
    const sent = await sendPasswordResetEmail({
      to: user.email,
      name: user.name,
      agencyName: agency.brand_name || agency.name,
      resetUrl,
    });
    if (!sent) {
      await db("password_reset_tokens").where({ user_id: user.id }).del();
      throw new HttpError(503, "Password reset email is not available right now.");
    }

    res.json(generic);
  })
);

router.post(
  "/admin/reset-password",
  simpleRateLimit({ windowMs: 15 * 60 * 1000, max: 8 }),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        token: z.string().min(16),
        password: z.string().min(8, "Password must be at least 8 characters"),
      })
      .parse(req.body);

    const tokenHash = crypto.createHash("sha256").update(body.token).digest("hex");
    const row = await db("password_reset_tokens").where({ token_hash: tokenHash }).first();
    if (!row || new Date(row.expires_at).getTime() < Date.now()) {
      throw new HttpError(400, "This reset link is invalid or has expired.");
    }

    const passwordHash = await bcrypt.hash(body.password, 10);
    await db("users").where({ id: row.user_id }).update({
      password_hash: passwordHash,
      updated_at: new Date(),
    });
    await db("password_reset_tokens").where({ user_id: row.user_id }).del();

    res.json({ ok: true });
  })
);

router.get(
  "/me",
  requireAuth("super_admin", "agency_admin"),
  asyncHandler(async (req, res) => {
    res.json({ user: req.user });
  })
);

export default router;
