import { env } from "../config/env";
import { HttpError } from "../utils/http";

type ChatMessage = { role: "system" | "user" | "assistant"; content: unknown };

export type ProductDraft = {
  name: string;
  description: string;
  category: string;
  tags: string[];
  material?: string;
  color?: string;
  suggested_price_range?: string;
};

const DEFAULT_MODEL = "gpt-5.6-luna";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

async function openRouterRequest(path: string, body: Record<string, unknown>, timeoutMs: number) {
  if (!env.openRouterKey) {
    throw new HttpError(500, "OPENROUTER_API_KEY is not configured");
  }

  const response = await fetch(`${OPENROUTER_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.openRouterKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": env.storeUrl,
      "X-Title": "CS Ecommerce",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new HttpError(502, `OpenRouter error: ${text}`);
  }

  return response.json();
}

export async function openRouterChat(
  messages: ChatMessage[],
  json = false,
  opts: { model?: string } = {}
): Promise<string> {
  const data = (await openRouterRequest(
    "/chat/completions",
    {
      model: opts.model ?? DEFAULT_MODEL,
      temperature: json ? 0.2 : 0.4,
      messages,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    },
    60_000
  )) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

export type ImageRef = {
  url?: string;
  buffer?: Buffer;
  mime?: string;
  label?: string;
};

function mimeFromBuffer(buffer: Buffer) {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (buffer[0] === 0x52 && buffer[1] === 0x49) return "image/webp";
  return "image/jpeg";
}

function parseDataUrl(value: unknown): { imageBuffer: Buffer; mediaType: string } | null {
  if (typeof value !== "string" || !value.startsWith("data:image/")) return null;
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  return { imageBuffer: Buffer.from(match[2], "base64"), mediaType: match[1] };
}

async function toDataUrl(ref: ImageRef): Promise<string> {
  if (ref.buffer?.length) {
    return `data:${ref.mime || mimeFromBuffer(ref.buffer)};base64,${ref.buffer.toString("base64")}`;
  }
  if (ref.url?.startsWith("data:")) return ref.url;
  if (!ref.url) {
    throw new HttpError(400, "A reference image is required");
  }

  const response = await fetch(ref.url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new HttpError(502, "Could not load a try-on reference image");
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const mime = response.headers.get("content-type")?.split(";")[0] || mimeFromBuffer(buffer);
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

function extractChatImage(data: {
  choices?: { message?: { images?: unknown; content?: unknown } }[];
}): { imageBuffer: Buffer; mediaType: string } | null {
  const message = data.choices?.[0]?.message;
  if (!message) return null;

  const candidates: unknown[] = [];
  if (Array.isArray(message.images)) candidates.push(...message.images);
  if (Array.isArray(message.content)) candidates.push(...message.content);
  if (typeof message.content === "string") candidates.push(message.content);

  for (const part of candidates) {
    if (typeof part === "string") {
      const parsed = parseDataUrl(part);
      if (parsed) return parsed;
      continue;
    }
    if (!part || typeof part !== "object") continue;
    const record = part as {
      image_url?: { url?: string };
      imageUrl?: { url?: string };
      inline_data?: { data?: string; mime_type?: string };
      b64_json?: string;
      media_type?: string;
    };
    const parsed = parseDataUrl(record.image_url?.url || record.imageUrl?.url);
    if (parsed) return parsed;
    if (record.inline_data?.data) {
      return {
        imageBuffer: Buffer.from(record.inline_data.data, "base64"),
        mediaType: record.inline_data.mime_type || "image/png",
      };
    }
    if (record.b64_json) {
      return { imageBuffer: Buffer.from(record.b64_json, "base64"), mediaType: record.media_type || "image/png" };
    }
  }
  return null;
}

/**
 * Generate an image from labeled references. Prefers chat completions so each
 * photo can be named (customer vs garment). Falls back to the Images API.
 */
export async function openRouterGenerateImage(opts: {
  prompt: string;
  imageUrls?: string[];
  images?: ImageRef[];
  model?: string;
  aspectRatio?: string;
}): Promise<{ imageBuffer: Buffer; mediaType: string; model: string }> {
  const model = opts.model ?? env.tryon.model;
  const refs: ImageRef[] = (
    opts.images?.length ? opts.images : (opts.imageUrls || []).map((url): ImageRef => ({ url }))
  ).filter((ref) => Boolean(ref.buffer?.length || ref.url));
  if (!refs.length) {
    throw new HttpError(400, "At least one reference image is required");
  }

  const dataUrls = await Promise.all(refs.slice(0, 3).map((ref) => toDataUrl(ref)));
  const content: Array<Record<string, unknown>> = [{ type: "text", text: opts.prompt }];
  dataUrls.forEach((url, index) => {
    const label = refs[index]?.label || `Image ${index + 1}`;
    content.push({ type: "text", text: label });
    content.push({ type: "image_url", image_url: { url } });
  });

  try {
    const chat = (await openRouterRequest(
      "/chat/completions",
      {
        model,
        messages: [{ role: "user", content }],
        modalities: ["image", "text"],
        ...(opts.aspectRatio ? { image_config: { aspect_ratio: opts.aspectRatio } } : {}),
      },
      180_000
    )) as { choices?: { message?: { images?: unknown; content?: unknown } }[] };

    const fromChat = extractChatImage(chat);
    if (fromChat) {
      return { ...fromChat, model };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.warn("Try-on chat image path failed, using Images API", message.slice(0, 300));
  }

  const data = (await openRouterRequest(
    "/images",
    {
      model,
      prompt: opts.prompt,
      n: 1,
      ...(opts.aspectRatio ? { aspect_ratio: opts.aspectRatio } : {}),
      input_references: dataUrls.map((url) => ({
        type: "image_url",
        image_url: { url },
      })),
    },
    180_000
  )) as {
    data?: { b64_json?: string; media_type?: string }[];
  };

  const image = data.data?.[0];
  if (!image?.b64_json) {
    throw new HttpError(502, "The image model did not return an image");
  }

  return {
    imageBuffer: Buffer.from(image.b64_json, "base64"),
    mediaType: image.media_type || "image/png",
    model,
  };
}

export async function draftProductFromImage(imageUrl: string): Promise<ProductDraft> {
  const content = await openRouterChat(
    [
      {
        role: "system",
        content:
          "You extract ecommerce product details from a photo. Return JSON only with keys: name, description, category, tags (string array), material, color, suggested_price_range (Nepalese rupees / NPR).",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Create a shop-ready product draft from this image. Keep the description 2-3 sentences, customer facing, and specific.",
          },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
    true
  );

  try {
    const parsed = JSON.parse(content) as ProductDraft;
    return {
      name: parsed.name || "Untitled product",
      description: parsed.description || "",
      category: parsed.category || "General",
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      material: parsed.material,
      color: parsed.color,
      suggested_price_range: parsed.suggested_price_range,
    };
  } catch {
    return {
      name: "Untitled product",
      description: content.slice(0, 500),
      category: "General",
      tags: [],
    };
  }
}
