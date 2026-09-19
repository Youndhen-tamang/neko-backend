import crypto from "crypto";
import { env } from "../config/env";
import { db } from "../db/knex";
import { Agency } from "../types";
import { HttpError } from "../utils/http";
import { decryptSecret } from "../utils/secrets";
import { ChatResult, money } from "./chatbot";

export type WaConfig = {
  agency: Agency;
  phoneNumberId: string;
  accessToken: string;
  displayPhone: string | null;
};

const WA_TEXT_LIMIT = 4096;

function graph(path: string) {
  return `https://graph.facebook.com/${env.whatsapp.graphVersion}/${path}`;
}

/** Validates Meta's X-Hub-Signature-256 header against the raw request body. */
export function verifyWebhookSignature(raw: Buffer, header?: string): boolean {
  if (!env.whatsapp.appSecret) {
    if (env.nodeEnv === "production") return false;
    console.warn("WHATSAPP_APP_SECRET is not set; skipping webhook signature check (development only)");
    return true;
  }
  if (!header?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", env.whatsapp.appSecret).update(raw).digest("hex");
  const received = header.slice("sha256=".length);
  if (expected.length !== received.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}

function toConfig(row: Record<string, unknown> | undefined): WaConfig | null {
  if (!row || !row.enabled || !row.access_token_enc || !row.phone_number_id) return null;
  const agency = row.agency as Agency;
  if (!agency || agency.status !== "active") return null;
  return {
    agency,
    phoneNumberId: String(row.phone_number_id),
    accessToken: decryptSecret(String(row.access_token_enc)),
    displayPhone: (row.display_phone as string | null) ?? null,
  };
}

async function loadIntegration(where: Record<string, unknown>) {
  const row = await db("agency_integrations")
    .where({ provider: "whatsapp", ...where })
    .first();
  if (!row) return null;
  const agency = await db("agencies").where({ id: row.agency_id }).first();
  return toConfig({ ...row, agency });
}

export function loadConfigByPhoneNumberId(phoneNumberId: string) {
  return loadIntegration({ phone_number_id: phoneNumberId });
}

export function loadConfigForAgency(agencyId: string) {
  return loadIntegration({ agency_id: agencyId });
}

async function graphRequest<T>(cfg: { accessToken: string }, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(graph(path), {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new HttpError(502, `WhatsApp API error (${response.status}): ${body}`);
  }
  return (await response.json()) as T;
}

type SendResponse = { messages?: { id?: string }[] };

async function sendMessage(cfg: WaConfig, payload: Record<string, unknown>) {
  const data = await graphRequest<SendResponse>(cfg, `${cfg.phoneNumberId}/messages`, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
  });
  return data.messages?.[0]?.id;
}

export function sendText(cfg: WaConfig, to: string, body: string) {
  return sendMessage(cfg, {
    to,
    type: "text",
    text: { body: body.slice(0, WA_TEXT_LIMIT), preview_url: true },
  });
}

export function sendImage(cfg: WaConfig, to: string, link: string, caption?: string) {
  return sendMessage(cfg, {
    to,
    type: "image",
    image: { link, ...(caption ? { caption: caption.slice(0, 1024) } : {}) },
  });
}

/** Interactive call-to-action button; falls back to a plain text link if Meta rejects it. */
export async function sendCtaUrl(cfg: WaConfig, to: string, bodyText: string, buttonText: string, url: string) {
  try {
    return await sendMessage(cfg, {
      to,
      type: "interactive",
      interactive: {
        type: "cta_url",
        body: { text: bodyText.slice(0, 1024) },
        action: { name: "cta_url", parameters: { display_text: buttonText.slice(0, 20), url } },
      },
    });
  } catch (error) {
    console.warn("cta_url message failed, falling back to text", error);
    return sendText(cfg, to, `${bodyText}\n${url}`);
  }
}

export async function markRead(cfg: WaConfig, messageId: string) {
  try {
    await sendMessage(cfg, { status: "read", message_id: messageId });
  } catch {
    // best effort
  }
}

/** Downloads customer media. Both the metadata call and the CDN URL need the bearer token. */
export async function downloadMedia(cfg: WaConfig, mediaId: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const meta = await graphRequest<{ url?: string; mime_type?: string }>(cfg, mediaId);
  if (!meta.url) throw new HttpError(502, "WhatsApp media URL missing");

  const response = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${cfg.accessToken}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new HttpError(502, `WhatsApp media download failed (${response.status})`);
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mimeType: meta.mime_type || response.headers.get("content-type") || "application/octet-stream",
  };
}

/** Verifies stored credentials by reading the phone number's profile. */
export function fetchPhoneProfile(cfg: { accessToken: string; phoneNumberId: string }) {
  return graphRequest<{ display_phone_number?: string; verified_name?: string; quality_rating?: string }>(
    cfg,
    `${cfg.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`
  );
}

/** Turns a chat result into WhatsApp text. Checkout links are sent separately as a CTA. */
export function formatWhatsAppReply(result: ChatResult): string {
  let text = result.answer.trim();
  const products = result.products ?? [];
  if (products.length) {
    const block = products
      .map((p, index) => `${index + 1}. ${p.name} — ${money(p.price_cents)}\n${p.url}`)
      .join("\n\n");
    text = `${text}\n\n${block}\n\nSee it on you: ${products[0].tryOnUrl}`;
  }
  return text.slice(0, WA_TEXT_LIMIT);
}
