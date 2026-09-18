import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { env } from "../../config/env";
import { db } from "../../db/knex";
import { requireAuth, signToken } from "../../middleware/auth";
import { asyncHandler, HttpError } from "../../utils/http";

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

router.get(
  "/me",
  requireAuth("super_admin", "agency_admin"),
  asyncHandler(async (req, res) => {
    res.json({ user: req.user });
  })
);

export default router;
