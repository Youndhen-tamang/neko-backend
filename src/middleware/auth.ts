import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { Agency, AuthUser, Role } from "../types";
import { HttpError } from "../utils/http";

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      agency?: Agency;
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
