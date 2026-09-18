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

const DEFAULT_MODEL = "google/gemini-2.5-flash-lite";

async function openRouterRequest(body: Record<string, unknown>, timeoutMs: number) {
  if (!env.openRouterKey) {
    throw new HttpError(500, "OPENROUTER_API_KEY is not configured");
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
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

/**
 * Image-output request. OpenRouter returns generated images as base64 data URLs
 * under message.images[] when `modalities` includes "image".
 */
export async function openRouterGenerateImage(
  messages: ChatMessage[],
  opts: { model?: string } = {}
): Promise<{ imageDataUrl: string; text: string; model: string }> {
  const model = opts.model ?? env.tryon.model;
  const data = (await openRouterRequest({ model, messages, modalities: ["image", "text"] }, 120_000)) as {
    choices?: {
      message?: {
        content?: string;
        images?: { type?: string; image_url?: { url?: string } }[];
      };
    }[];
  };

  const message = data.choices?.[0]?.message;
  const imageDataUrl = message?.images?.[0]?.image_url?.url;
  if (!imageDataUrl) {
    throw new HttpError(502, "The image model did not return an image");
  }
  return { imageDataUrl, text: message?.content ?? "", model };
}

export async function draftProductFromImage(imageUrl: string): Promise<ProductDraft> {
  const content = await openRouterChat(
    [
      {
        role: "system",
        content:
          "You extract ecommerce product details from a photo. Return JSON only with keys: name, description, category, tags (string array), material, color, suggested_price_range.",
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
