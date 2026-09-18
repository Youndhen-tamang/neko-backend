import { Request, Router } from "express";
import type { Knex } from "knex";
import { db } from "../../db/knex";
import { requireAuth } from "../../middleware/auth";
import { requireAgencyMatch, resolveTenant } from "../../middleware/tenant";
import { asyncHandler } from "../../utils/http";

const PAID_STATUSES = ["ordered", "dispatched", "delivered"];

function parseDateRange(req: Request) {
  const toRaw = req.query.to?.toString();
  const fromRaw = req.query.from?.toString();
  const to = toRaw ? new Date(toRaw) : new Date();
  const from = fromRaw ? new Date(fromRaw) : new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);
  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

function applyOrderFilters(
  query: Knex.QueryBuilder,
  opts: { agencyId?: string; from: Date; to: Date; status?: string }
) {
  query.whereBetween("orders.created_at", [opts.from, opts.to]);
  if (opts.agencyId) query.andWhere("orders.agency_id", opts.agencyId);
  if (opts.status) query.andWhere("orders.status", opts.status);
  return query;
}

async function buildAnalytics(opts: {
  agencyId?: string;
  from: Date;
  to: Date;
  status?: string;
  category?: string;
}) {
  const ordersQuery = applyOrderFilters(db("orders"), opts);
  let orders = (await ordersQuery.select(
    "id",
    "agency_id",
    "status",
    "total_cents",
    "created_at"
  )) as {
    id: string;
    agency_id: string;
    status: string;
    total_cents: number;
    created_at: string | Date;
  }[];

  const orderIds = orders.map((order) => order.id);

  let items: {
    order_id: string;
    product_id: string | null;
    name: string;
    quantity: number;
    unit_price_cents: number;
    category?: string | null;
  }[] = [];

  if (orderIds.length) {
    const itemQuery = db("order_items")
      .select(
        "order_items.order_id",
        "order_items.product_id",
        "order_items.name",
        "order_items.quantity",
        "order_items.unit_price_cents",
        "products.category"
      )
      .leftJoin("products", "products.id", "order_items.product_id")
      .whereIn("order_items.order_id", orderIds);

    if (opts.category) {
      itemQuery.andWhere("products.category", opts.category);
    }

    items = await itemQuery;
  }

  if (opts.category) {
    const matchingOrderIds = new Set(items.map((item) => item.order_id));
    orders = orders.filter((order) => matchingOrderIds.has(order.id));
  }

  const paidOrders = orders.filter((order) => PAID_STATUSES.includes(order.status));
  const revenueCents = paidOrders.reduce((sum, order) => sum + Number(order.total_cents || 0), 0);

  const paidOrderIds = new Set(paidOrders.map((order) => order.id));
  const paidItems = items.filter((item) => paidOrderIds.has(item.order_id));

  const unitsSold = paidItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const avgOrderCents = paidOrders.length ? Math.round(revenueCents / paidOrders.length) : 0;

  const byDayMap = new Map<string, { date: string; orderCount: number; revenueCents: number }>();
  for (const order of orders) {
    const date = new Date(order.created_at).toISOString().slice(0, 10);
    const current = byDayMap.get(date) || { date, orderCount: 0, revenueCents: 0 };
    current.orderCount += 1;
    if (PAID_STATUSES.includes(order.status)) {
      current.revenueCents += Number(order.total_cents || 0);
    }
    byDayMap.set(date, current);
  }
  const revenueByDay = [...byDayMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  const byStatusMap = new Map<string, { status: string; count: number; revenueCents: number }>();
  for (const order of orders) {
    const current = byStatusMap.get(order.status) || { status: order.status, count: 0, revenueCents: 0 };
    current.count += 1;
    current.revenueCents += Number(order.total_cents || 0);
    byStatusMap.set(order.status, current);
  }
  const ordersByStatus = [...byStatusMap.values()].sort((a, b) => b.count - a.count);

  const productMap = new Map<
    string,
    { productId: string | null; name: string; quantity: number; revenueCents: number }
  >();
  for (const item of paidItems) {
    const key = item.product_id || item.name;
    const current = productMap.get(key) || {
      productId: item.product_id,
      name: item.name,
      quantity: 0,
      revenueCents: 0,
    };
    current.quantity += Number(item.quantity || 0);
    current.revenueCents += Number(item.quantity || 0) * Number(item.unit_price_cents || 0);
    productMap.set(key, current);
  }
  const topProducts = [...productMap.values()].sort((a, b) => b.revenueCents - a.revenueCents).slice(0, 8);

  const categoryMap = new Map<string, { category: string; quantity: number; revenueCents: number }>();
  for (const item of paidItems) {
    const category = item.category?.trim() || "Uncategorized";
    const current = categoryMap.get(category) || { category, quantity: 0, revenueCents: 0 };
    current.quantity += Number(item.quantity || 0);
    current.revenueCents += Number(item.quantity || 0) * Number(item.unit_price_cents || 0);
    categoryMap.set(category, current);
  }
  const byCategory = [...categoryMap.values()].sort((a, b) => b.revenueCents - a.revenueCents);

  const agencyMap = new Map<
    string,
    { agencyId: string; orderCount: number; revenueCents: number }
  >();
  for (const order of orders) {
    const current = agencyMap.get(order.agency_id) || {
      agencyId: order.agency_id,
      orderCount: 0,
      revenueCents: 0,
    };
    current.orderCount += 1;
    if (PAID_STATUSES.includes(order.status)) {
      current.revenueCents += Number(order.total_cents || 0);
    }
    agencyMap.set(order.agency_id, current);
  }

  const agencies = agencyMap.size
    ? await db("agencies")
        .whereIn(
          "id",
          [...agencyMap.keys()]
        )
        .select("id", "name", "slug", "brand_name")
    : [];

  const byAgency = [...agencyMap.values()]
    .map((row) => {
      const agency = agencies.find((item) => item.id === row.agencyId);
      return {
        ...row,
        name: agency?.brand_name || agency?.name || "Unknown",
        slug: agency?.slug || "",
      };
    })
    .sort((a, b) => b.revenueCents - a.revenueCents);

  const productScope = db("products");
  if (opts.agencyId) productScope.where({ agency_id: opts.agencyId });
  const products = await productScope.select("id", "status", "stock", "low_stock_threshold", "category");

  const inventory = {
    total: products.length,
    published: products.filter((product) => product.status === "published").length,
    draft: products.filter((product) => product.status === "draft").length,
    lowStock: products.filter((product) => Number(product.stock) <= Number(product.low_stock_threshold)).length,
    categories: [...new Set(products.map((product) => product.category).filter(Boolean))],
  };

  return {
    range: { from: opts.from.toISOString(), to: opts.to.toISOString() },
    summary: {
      orderCount: orders.length,
      paidOrderCount: paidOrders.length,
      revenueCents,
      unitsSold,
      avgOrderCents,
    },
    inventory,
    revenueByDay,
    ordersByStatus,
    topProducts,
    byCategory,
    byAgency,
  };
}

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

adminRouter.get(
  "/analytics",
  asyncHandler(async (req, res) => {
    const { from, to } = parseDateRange(req);
    const analytics = await buildAnalytics({
      agencyId: req.agency!.id,
      from,
      to,
      status: req.query.status?.toString() || undefined,
      category: req.query.category?.toString() || undefined,
    });
    res.json({ analytics });
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

superRouter.get(
  "/analytics",
  asyncHandler(async (req, res) => {
    const { from, to } = parseDateRange(req);
    const analytics = await buildAnalytics({
      agencyId: req.query.agencyId?.toString() || undefined,
      from,
      to,
      status: req.query.status?.toString() || undefined,
      category: req.query.category?.toString() || undefined,
    });
    res.json({ analytics });
  })
);

export const adminDashboardRouter = adminRouter;
export const superDashboardRouter = superRouter;
