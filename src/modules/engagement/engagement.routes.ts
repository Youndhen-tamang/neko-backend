import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { requireAgencyMatch, resolveTenant } from "../../middleware/tenant";
import {
  createComment,
  deleteComment,
  getAdminProductEngagement,
  getPublicEngagement,
  listAdminComments,
  toggleLike,
} from "../../services/engagement";
import { createNotification } from "../../services/notifications";
import { asyncHandler } from "../../utils/http";

const router = Router();

const sessionSchema = z.string().uuid("A valid session is required");

function param(req: Request, key: string) {
  const value = req.params[key];
  return (Array.isArray(value) ? value[0] : value) || "";
}

function sessionFromRequest(req: Request) {
  return (req.header("x-session-id") || req.body?.sessionId || req.query.sessionId || "").toString().trim();
}

router.get(
  "/public/:productId",
  resolveTenant,
  asyncHandler(async (req, res) => {
    const sessionId = sessionFromRequest(req) || undefined;
    if (sessionId) sessionSchema.parse(sessionId);
    const engagement = await getPublicEngagement(param(req, "productId"), req.agency!.id, sessionId);
    res.json({ engagement });
  })
);

router.post(
  "/public/:productId/like",
  resolveTenant,
  asyncHandler(async (req, res) => {
    const { sessionId } = z.object({ sessionId: sessionSchema }).parse({
      sessionId: sessionFromRequest(req),
    });
    const result = await toggleLike(param(req, "productId"), req.agency!.id, sessionId);
    res.json(result);
  })
);

router.post(
  "/public/:productId/comments",
  resolveTenant,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        sessionId: sessionSchema,
        invoiceNumber: z.string().min(3, "Invoice number is required"),
        authorName: z.string().max(80).optional(),
        body: z.string().trim().min(2, "Comment is too short").max(2000),
        parentId: z.string().uuid().optional(),
      })
      .parse({
        ...req.body,
        sessionId: sessionFromRequest(req) || req.body?.sessionId,
      });

    const productId = param(req, "productId");
    const result = await createComment({
      productId,
      agencyId: req.agency!.id,
      sessionId: body.sessionId,
      invoiceNumber: body.invoiceNumber,
      authorName: body.authorName,
      body: body.body,
      parentId: body.parentId,
    });

    try {
      await createNotification({
        agencyId: req.agency!.id,
        type: "product_comment",
        title: "New product comment",
        body: `${result.comment.author_name} commented on a product`,
        meta: { productId, commentId: result.comment.id },
      });
    } catch {
      // Comment should still succeed if alerting fails.
    }

    res.status(201).json(result);
  })
);

function requireEngagementAccess(req: Request, res: Response, next: NextFunction) {
  requireAuth("agency_admin", "super_admin")(req, res, (authErr) => {
    if (authErr) return next(authErr);

    if (req.user?.role === "super_admin") {
      const slug = (req.header("x-agency-slug") || req.query.agency || "").toString().trim();
      if (!slug) return next();
      return resolveTenant(req, res, next);
    }

    resolveTenant(req, res, (tenantErr) => {
      if (tenantErr) return next(tenantErr);
      requireAgencyMatch(req, res, next);
    });
  });
}

router.use(requireEngagementAccess);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const agencyId = req.user?.role === "agency_admin" ? req.agency!.id : req.query.agencyId?.toString();
    const comments = await listAdminComments({
      agencyId,
      productId: req.query.productId?.toString(),
      q: req.query.q?.toString().trim(),
    });
    res.json({ comments });
  })
);

router.get(
  "/products/:productId",
  asyncHandler(async (req, res) => {
    const agencyId = req.user?.role === "agency_admin" ? req.agency!.id : undefined;
    const engagement = await getAdminProductEngagement(param(req, "productId"), agencyId);
    res.json({ engagement });
  })
);

router.delete(
  "/comments/:commentId",
  asyncHandler(async (req, res) => {
    const agencyId = req.user?.role === "agency_admin" ? req.agency!.id : undefined;
    await deleteComment(param(req, "commentId"), agencyId);
    res.status(204).send();
  })
);

export default router;
