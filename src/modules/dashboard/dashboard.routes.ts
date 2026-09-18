import { Router } from "express";
import { db } from "../../db/knex";
import { requireAuth } from "../../middleware/auth";
import { requireAgencyMatch, resolveTenant } from "../../middleware/tenant";
import { asyncHandler } from "../../utils/http";

const adminRouter = Router();
adminRouter.use(resolveTenant, requireAuth("agency_admin"), requireAgencyMatch);

adminRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const agencyId = req.agency!.id;
    const [{ count: productCount }] = await db("products").where({ agency_id: agencyId }).count("id as count");
    const [{ count: orderCount }] = await db("orders").where({ agency_id: agencyId }).count("id as count");
    const [{ sum: revenue }] = await db("orders")
      .where({ agency_id: agencyId })
      .whereNotIn("status", ["lead", "cancelled"])
      .sum("total_cents as sum");
    const lowStock = await db("products")
      .where({ agency_id: agencyId })
      .andWhereRaw("stock <= low_stock_threshold")
      .select("id", "name", "stock");
    const recentOrders = await db("orders")
      .where({ agency_id: agencyId })
      .orderBy("created_at", "desc")
      .limit(6);
    const unread = await db("notifications")
      .where({ agency_id: agencyId, read: false })
      .count("id as count")
      .first();

    res.json({
      stats: {
        productCount: Number(productCount),
        orderCount: Number(orderCount),
        revenueCents: Number(revenue ?? 0),
        unreadNotifications: Number(unread?.count ?? 0),
        lowStock,
        recentOrders,
      },
    });
  })
);

adminRouter.get(
  "/alerts",
  asyncHandler(async (req, res) => {
    const lowStock = await db("products")
      .where({ agency_id: req.agency!.id })
      .andWhereRaw("stock <= low_stock_threshold");
    const pending = await db("orders")
      .where({ agency_id: req.agency!.id })
      .whereIn("status", ["lead", "ordered"]);
    res.json({ alerts: { lowStock, pendingOrders: pending } });
  })
);

const superRouter = Router();
superRouter.use(requireAuth("super_admin"));

superRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const [{ count: agencyCount }] = await db("agencies").count("id as count");
    const [{ count: orderCount }] = await db("orders").count("id as count");
    const [{ sum: revenue }] = await db("orders")
      .whereNotIn("status", ["lead", "cancelled"])
      .sum("total_cents as sum");
    const agencies = await db("agencies").orderBy("created_at", "desc").limit(8);

    res.json({
      stats: {
        agencyCount: Number(agencyCount),
        orderCount: Number(orderCount),
        revenueCents: Number(revenue ?? 0),
        recentAgencies: agencies,
      },
    });
  })
);

export const adminDashboardRouter = adminRouter;
export const superDashboardRouter = superRouter;
