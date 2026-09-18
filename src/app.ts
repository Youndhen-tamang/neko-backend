import cors from "cors";
import express from "express";
import { env } from "./config/env";
import { errorHandler } from "./middleware/error";
import authRoutes from "./modules/auth/auth.routes";
import agenciesRoutes from "./modules/agencies/agencies.routes";
import productsRoutes from "./modules/products/products.routes";
import engagementRoutes from "./modules/engagement/engagement.routes";
import ordersRoutes from "./modules/orders/orders.routes";
import chatbotRoutes from "./modules/chatbot/chatbot.routes";
import notificationsRoutes from "./modules/notifications/notifications.routes";
import settingsRoutes from "./modules/settings/settings.routes";
import webhooksRoutes from "./modules/webhooks/webhooks.routes";
import tryonRoutes from "./modules/tryon/tryon.routes";
import {
  adminDashboardRouter,
  superDashboardRouter,
} from "./modules/dashboard/dashboard.routes";
import { HttpError } from "./utils/http";

export const app = express();

function isAllowedOrigin(origin?: string) {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    const host = url.hostname;

    // Local development only: any localhost origin, including tenant subdomains.
    if (!env.isProduction && (host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost"))) {
      return true;
    }

    // The storefront apex and every tenant subdomain of it, e.g. https://lumina.yourdomain.com
    const store = new URL(env.storeUrl);
    if (url.protocol === store.protocol && (host === store.hostname || host.endsWith(`.${store.hostname}`))) {
      return true;
    }

    return origin === env.superAdminUrl;
  } catch {
    return false;
  }
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new HttpError(403, "Origin not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use("/api/webhooks", express.raw({ type: "application/json" }), webhooksRoutes);
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "cs-ecommerce-api" });
});

app.use("/api/auth", authRoutes);
app.use("/api/super-admin/agencies", agenciesRoutes);
app.use("/api/super-admin/dashboard", superDashboardRouter);
app.use("/api/products", productsRoutes);
app.use("/api/engagement", engagementRoutes);
app.use("/api/orders", ordersRoutes);
app.use("/api/chat", chatbotRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/tryon", tryonRoutes);
app.use("/api/admin/dashboard", adminDashboardRouter);
app.use(errorHandler);
