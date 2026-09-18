import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../.env") }); // backend/.env

export const isProduction = process.env.NODE_ENV === "production";

/**
 * In production the variable must be set explicitly. In development the
 * localhost-friendly fallback is used so the app boots with an empty .env.
 */
function requiredInProd(name: string, devFallback: string): string {
  const value = process.env[name];
  if (value !== undefined && value !== "") return value;
  if (isProduction) {
    throw new Error(`Missing required environment variable: ${name} (NODE_ENV=production)`);
  }
  return devFallback;
}

function publicUrl(name: string, devFallback: string): string {
  const value = requiredInProd(name, devFallback);
  let hostname: string;
  try {
    hostname = new URL(value).hostname;
  } catch {
    throw new Error(`${name} must be a full URL like https://example.com (got "${value}")`);
  }
  if (isProduction && (hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".localhost"))) {
    throw new Error(`${name} points at ${hostname}; set it to the real public domain in production`);
  }
  return value;
}

const storeUrl = publicUrl("FRONTEND_STORE_URL", "http://localhost:3000");
const superAdminUrl = publicUrl("FRONTEND_SUPER_ADMIN_URL", "http://localhost:3004");

export const env = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction,
  databaseUrl: requiredInProd("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/ecommerce"),
  jwtSecret: requiredInProd("JWT_SECRET", "dev-jwt-secret-change-me"),
  superAdminEmail: requiredInProd("SUPER_ADMIN_LOGIN_EMAIL", "superadmin@local.test"),
  superAdminPassword: requiredInProd("SUPER_ADMIN_PASS", "superadmin"),
  storeUrl,
  /** Hostname of the storefront, e.g. "localhost" or "yourdomain.com". Tenants live on `{slug}.{storeHost}`. */
  storeHost: new URL(storeUrl).hostname,
  superAdminUrl,
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? "",
    uploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET ?? "",
    workspaceUploadPreset: process.env.CLOUDINARY_WORKSPACE_UPLOAD_PRESET ?? "",
    apiKey: process.env.CLOUDINARY_API_KEY ?? "",
    apiSecret: process.env.CLOUDINARY_API_SECRET ?? "",
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  },
  smtp: {
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: String(process.env.SMTP_SECURE ?? "false") === "true",
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
  },
  openRouterKey: process.env.OPENROUTER_API_KEY ?? "",
  whatsapp: {
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? "",
    appSecret: process.env.WHATSAPP_APP_SECRET ?? "",
    graphVersion: process.env.WHATSAPP_GRAPH_VERSION ?? "v21.0",
  },
  integrationSecretKey: process.env.INTEGRATION_SECRET_KEY ?? "",
  tryon: {
    model: process.env.TRYON_MODEL ?? "google/gemini-2.5-flash-image",
  },
};
