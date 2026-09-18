import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AuthUser, Role } from "../types";
import { HttpError } from "../utils/http";

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      agency?: {
        id: string;
        name: string;
        slug: string;
        brand_name: string;
        logo_url: string | null;
        primary_color: string;
        email: string | null;
        phone: string | null;
        address: string | null;
        tagline: string | null;
        status: string;
      };
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, env.jwtSecret, { expiresIn: "7d" });
}

export function requireAuth(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return next(new HttpError(401, "Authentication required"));
    }

    try {
      const payload = jwt.verify(header.slice(7), env.jwtSecret) as AuthUser;
      if (roles.length && !roles.includes(payload.role)) {
        return next(new HttpError(403, "Insufficient permissions"));
      }
      req.user = payload;
      next();
    } catch {
      next(new HttpError(401, "Invalid or expired token"));
    }
  };
}
