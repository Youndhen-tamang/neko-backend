import { NextFunction, Request, Response } from "express";
import { HttpError } from "../utils/http";

type Bucket = { count: number; resetAt: number };

/**
 * Minimal in-memory rate limiter. State is per process and resets on restart;
 * good enough to keep a paid endpoint from being hammered from one address.
 */
export function simpleRateLimit(options: {
  windowMs: number;
  max: number;
  keyFn?: (req: Request) => string;
}) {
  const buckets = new Map<string, Bucket>();
  const keyFn = options.keyFn ?? ((req: Request) => req.ip || "unknown");

  return (req: Request, _res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = keyFn(req);
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }

    if (bucket.count >= options.max) {
      const seconds = Math.ceil((bucket.resetAt - now) / 1000);
      return next(new HttpError(429, `Too many requests. Try again in ${seconds}s.`));
    }

    bucket.count += 1;
    next();
  };
}
