import { Router } from "express";
import { db } from "../../db/knex";
import { requireAuth } from "../../middleware/auth";
import { requireAgencyMatch, resolveTenant } from "../../middleware/tenant";
import { asyncHandler, HttpError } from "../../utils/http";

const router = Router();
router.use(resolveTenant, requireAuth("agency_admin"), requireAgencyMatch);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const notifications = await db("notifications")
      .where({ agency_id: req.agency!.id })
      .orderBy("created_at", "desc")
      .limit(100);
    res.json({ notifications });
  })
);

router.patch(
  "/:id/read",
  asyncHandler(async (req, res) => {
    const [notification] = await db("notifications")
      .where({ id: req.params.id, agency_id: req.agency!.id })
      .update({ read: true, updated_at: new Date() })
      .returning("*");
    if (!notification) throw new HttpError(404, "Notification not found");
    res.json({ notification });
  })
);

router.post(
  "/read-all",
  asyncHandler(async (req, res) => {
    await db("notifications").where({ agency_id: req.agency!.id, read: false }).update({
      read: true,
      updated_at: new Date(),
    });
    res.json({ ok: true });
  })
);

export default router;
