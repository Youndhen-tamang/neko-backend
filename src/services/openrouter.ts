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

export async function openRouterChat(messages: ChatMessage[], json = false): Promise<string> {
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
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      temperature: json ? 0.2 : 0.4,
      messages,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new HttpError(502, `OpenRouter error: ${body}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content ?? "";
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
