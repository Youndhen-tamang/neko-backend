import { NextFunction, Request, Response } from "express";
import { db } from "../db/knex";
import { HttpError } from "../utils/http";
import { agencySlugFromHost } from "../utils/tenant";

function slugFromRequest(req: Request) {
  const headerSlug = (req.header("x-agency-slug") || "").trim();
  if (headerSlug) return headerSlug;

  const origin = req.header("origin") || req.header("referer") || "";
  if (origin) {
    try {
      const fromOrigin = agencySlugFromHost(new URL(origin).host);
      if (fromOrigin) return fromOrigin;
    } catch {
      // ignore invalid origin
    }
  }

  const fromHost = agencySlugFromHost(req.header("host") || "");
  if (fromHost) return fromHost;

  return (req.query.agency || "").toString().trim();
}

export async function resolveTenant(req: Request, _res: Response, next: NextFunction) {
  try {
    const slug = slugFromRequest(req);

    if (!slug) {
      throw new HttpError(400, "Agency slug is required");
    }

    const agency = await db("agencies").where({ slug }).first();
    if (!agency || agency.status !== "active") {
      throw new HttpError(404, "Agency not found or inactive");
    }

    req.agency = agency;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAgencyMatch(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.role === "super_admin") return next();
  if (!req.user?.agencyId || !req.agency?.id || req.user.agencyId !== req.agency.id) {
    return next(new HttpError(403, "You cannot access this agency"));
  }
  next();
}
