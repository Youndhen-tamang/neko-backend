import cors from "cors";
import express from "express";
import { env } from "./config/env";
import { errorHandler } from "./middleware/error";
import authRoutes from "./modules/auth/auth.routes";
import agenciesRoutes from "./modules/agencies/agencies.routes";
import productsRoutes from "./modules/products/products.routes";
import ordersRoutes from "./modules/orders/orders.routes";
import chatbotRoutes from "./modules/chatbot/chatbot.routes";
import notificationsRoutes from "./modules/notifications/notifications.routes";
import settingsRoutes from "./modules/settings/settings.routes";
import webhooksRoutes from "./modules/webhooks/webhooks.routes";
import {
  adminDashboardRouter,
  superDashboardRouter,
} from "./modules/dashboard/dashboard.routes";

export const app = express();

function isAllowedOrigin(origin?: string) {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname.endsWith(".localhost")) {
      return true;
    }
    return origin === env.storeUrl || origin === env.superAdminUrl;
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
      callback(new Error("Not allowed by CORS"));
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
app.use("/api/orders", ordersRoutes);
app.use("/api/chat", chatbotRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/admin/dashboard", adminDashboardRouter);
app.use(errorHandler);
