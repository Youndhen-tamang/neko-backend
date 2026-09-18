import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../.env") }); // backend/.env

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: required("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/ecommerce"),
  jwtSecret: required("JWT_SECRET", "dev-jwt-secret-change-me"),
  superAdminEmail: required("SUPER_ADMIN_LOGIN_EMAIL", "superadmin@local.test"),
  superAdminPassword: required("SUPER_ADMIN_PASS", "superadmin"),
  storeUrl: process.env.FRONTEND_STORE_URL ?? "http://localhost:3000",
  superAdminUrl: process.env.FRONTEND_SUPER_ADMIN_URL ?? "http://localhost:3004",
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
};
