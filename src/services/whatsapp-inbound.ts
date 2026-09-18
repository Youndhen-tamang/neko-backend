import { db } from "../db/knex";
import { ChatTurn, handleStoreChat } from "./chatbot";
import { uploadImage } from "./cloudinary";
import {
  WaConfig,
  downloadMedia,
  formatWhatsAppReply,
  loadConfigByPhoneNumberId,
  markRead,
  sendCtaUrl,
  sendText,
} from "./whatsapp";

const STALE_MS = 15 * 60 * 1000;
const HISTORY_LIMIT = 12;

type WaInboundMessage = {
  id: string;
  from: string;
  timestamp?: string;
  type: string;
  text?: { body?: string };
  image?: { id?: string; caption?: string; mime_type?: string };
};

type WaChangeValue = {
  messaging_product?: string;
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: WaInboundMessage[];
  statuses?: unknown[];
};

export type WaWebhookPayload = {
  object?: string;
  entry?: { changes?: { field?: string; value?: WaChangeValue }[] }[];
};

async function upsertConversation(cfg: WaConfig, waUser: string, profileName?: string) {
  const [row] = await db("wa_conversations")
    .insert({
      id: crypto.randomUUID(),
      agency_id: cfg.agency.id,
      wa_user: waUser,
      profile_name: profileName ?? null,
      last_inbound_at: new Date(),
    })
    .onConflict(["agency_id", "wa_user"])
    .merge({
      ...(profileName ? { profile_name: profileName } : {}),
      last_inbound_at: new Date(),
      updated_at: new Date(),
    })
    .returning("*");
  return row;
}

async function loadHistory(conversationId: string, excludeId: string): Promise<ChatTurn[]> {
  const rows = await db("wa_messages")
    .where({ conversation_id: conversationId })
    .whereNot({ id: excludeId })
    .orderBy("created_at", "desc")
    .limit(HISTORY_LIMIT);

  return rows.reverse().map((row) => ({
    role: row.direction === "in" ? ("user" as const) : ("assistant" as const),
    content:
      row.type === "image" && row.direction === "in"
        ? `[Customer sent a photo]${row.text ? ` ${row.text}` : ""}`
        : row.text ?? "",
  }));
}

async function recordOutbound(conversationId: string, agencyId: string, text: string, waMessageId?: string, type = "text") {
  await db("wa_messages").insert({
    id: crypto.randomUUID(),
    conversation_id: conversationId,
    agency_id: agencyId,
    direction: "out",
    wa_message_id: waMessageId ?? null,
    type,
    text,
  });
}

async function handleMessage(cfg: WaConfig, msg: WaInboundMessage, profileName?: string) {
  if (msg.timestamp && Number(msg.timestamp) * 1000 < Date.now() - STALE_MS) return;

  const conversation = await upsertConversation(cfg, msg.from, profileName);
  const rowId = crypto.randomUUID();
  const inserted = await db("wa_messages")
    .insert({
      id: rowId,
      conversation_id: conversation.id,
      agency_id: cfg.agency.id,
      direction: "in",
      wa_message_id: msg.id,
      type: msg.type === "text" || msg.type === "image" ? msg.type : "unsupported",
      text: msg.type === "text" ? msg.text?.body ?? "" : msg.image?.caption ?? "",
      meta: JSON.stringify({ raw_type: msg.type }),
    })
    .onConflict("wa_message_id")
    .ignore()
    .returning("id");
  if (!inserted.length) return; // Meta redelivered a message we already handled

  void markRead(cfg, msg.id);

  let text = "";
  let imageUrl: string | undefined;

  if (msg.type === "text") {
    text = msg.text?.body?.trim() ?? "";
  } else if (msg.type === "image" && msg.image?.id) {
    const media = await downloadMedia(cfg, msg.image.id);
    imageUrl = await uploadImage(media.buffer, `agencies/${cfg.agency.id}/whatsapp`);
    await db("wa_messages").where({ id: rowId }).update({ media_url: imageUrl });
    text = msg.image.caption?.trim() ?? "";
  } else {
    const note = "I can read text and photos for now, ma'am. Send me a picture of something you like or tell me what you're looking for.";
    const sentId = await sendText(cfg, msg.from, note);
    await recordOutbound(conversation.id, cfg.agency.id, note, sentId);
    return;
  }

  const history = await loadHistory(conversation.id, rowId);
  const result = await handleStoreChat({
    agency: cfg.agency,
    message: text || undefined,
    imageUrl,
    history,
    channel: "whatsapp",
    checkoutSessionId: conversation.checkout_session_id ?? undefined,
    checkoutMetadata: { waUser: msg.from },
  });

  const reply = formatWhatsAppReply(result);
  const sentId = await sendText(cfg, msg.from, reply);
  await recordOutbound(conversation.id, cfg.agency.id, reply, sentId);

  if (result.checkoutUrl) {
    const ctaId = await sendCtaUrl(cfg, msg.from, "Your secure payment link is ready.", "Pay now", result.checkoutUrl);
    await recordOutbound(conversation.id, cfg.agency.id, result.checkoutUrl, ctaId, "interactive");
  }

  const updates: Record<string, unknown> = { last_outbound_at: new Date(), updated_at: new Date() };
  if (result.order) updates.checkout_session_id = null;
  else if (result.checkoutSessionId) updates.checkout_session_id = result.checkoutSessionId;
  await db("wa_conversations").where({ id: conversation.id }).update(updates);
}

export async function processWhatsAppPayload(payload: WaWebhookPayload) {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages" || !change.value) continue;
      const value = change.value;
      const phoneNumberId = value.metadata?.phone_number_id;
      const messages = value.messages ?? [];
      if (!phoneNumberId || !messages.length) continue;

      const cfg = await loadConfigByPhoneNumberId(phoneNumberId);
      if (!cfg) {
        console.warn(`WhatsApp webhook for unknown/disabled phone_number_id ${phoneNumberId}`);
        continue;
      }

      for (const msg of messages) {
        const profileName = value.contacts?.find((c) => c.wa_id === msg.from)?.profile?.name;
        try {
          await handleMessage(cfg, msg, profileName);
        } catch (error) {
          console.error("WhatsApp message handling failed", { messageId: msg.id, error });
          try {
            await sendText(cfg, msg.from, "Sorry, something went wrong on my side. Please try again in a moment.");
          } catch (sendError) {
            console.error("WhatsApp error reply failed", sendError);
          }
        }
      }
    }
  }
}

/** Notifies the WhatsApp customer once Stripe confirms payment for a chat-initiated order. */
export async function notifyWhatsAppOrderPaid(input: {
  agencyId: string;
  waUser: string;
  text: string;
}) {
  const { loadConfigForAgency } = await import("./whatsapp");
  const cfg = await loadConfigForAgency(input.agencyId);
  if (!cfg) return;
  const sentId = await sendText(cfg, input.waUser, input.text);
  const conversation = await db("wa_conversations")
    .where({ agency_id: input.agencyId, wa_user: input.waUser })
    .first();
  if (conversation) {
    await recordOutbound(conversation.id, input.agencyId, input.text, sentId);
    await db("wa_conversations")
      .where({ id: conversation.id })
      .update({ checkout_session_id: null, last_outbound_at: new Date(), updated_at: new Date() });
  }
}
