import { env } from "../config/env";
import { db } from "../db/knex";
import { Agency } from "../types";
import { HttpError } from "../utils/http";
import { uploadImage } from "./cloudinary";
import { openRouterGenerateImage } from "./openrouter";

export type SizeHint = "XS" | "S" | "M" | "L" | "XL";

const SIZES: SizeHint[] = ["XS", "S", "M", "L", "XL"];

/**
 * Generic size estimate from height/weight. Products carry no size chart, so this is
 * a rough guide (BMI buckets nudged by height), not a fit guarantee.
 */
export function sizeHint(heightCm: number, weightKg: number): SizeHint {
  const meters = heightCm / 100;
  const bmi = weightKg / (meters * meters);
  let index = bmi < 18.5 ? 0 : bmi < 21 ? 1 : bmi < 24.5 ? 2 : bmi < 28.5 ? 3 : 4;
  if (heightCm >= 178) index += 1;
  if (heightCm < 158) index -= 1;
  return SIZES[Math.min(SIZES.length - 1, Math.max(0, index))];
}

function imageList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function generateTryOn(input: {
  agency: Agency;
  product: { id: string; name: string; description: string | null; category: string | null; images: unknown };
  personBuffer: Buffer;
  personMime?: string;
  heightCm: number;
  weightKg: number;
  channel?: string;
  phone?: string;
  ip?: string;
}) {
  const productImages = imageList(input.product.images).slice(0, 2);
  if (!productImages.length) {
    throw new HttpError(400, "This product has no photos to try on");
  }

  const inputPhotoUrl = await uploadImage(input.personBuffer, `agencies/${input.agency.id}/tryon/input`);
  const hint = sizeHint(input.heightCm, input.weightKg);
  const sessionId = crypto.randomUUID();

  await db("tryon_sessions").insert({
    id: sessionId,
    agency_id: input.agency.id,
    product_id: input.product.id,
    channel: input.channel ?? "web",
    phone: input.phone ?? null,
    ip: input.ip ?? null,
    input_photo_url: inputPhotoUrl,
    height_cm: Math.round(input.heightCm),
    weight_kg: Math.round(input.weightKg),
    size_hint: hint,
    status: "pending",
    model: env.tryon.model,
  });

  const prompt = `Virtual try-on. Edit the customer photograph only.

Keep the same person from the customer photo: same face, hair, skin tone, body, pose, shoes if visible, and background. Do not replace them with the model from the product photo. Do not copy the product photo's studio, chair, lighting, or composition.

Take only the garment from the product photo and dress the customer in it. Match that garment's colour, fabric, neckline, sleeves, cut, and length. The catalog name is "${
    input.product.name
  }"${input.product.category ? ` (${input.product.category})` : ""} — use it as a label, not as a reason to invent a different outfit.

The customer is about ${Math.round(input.heightCm)} cm and ${Math.round(
    input.weightKg
  )} kg; drape the garment realistically for that build. Photorealistic. Output a single edited photo of the customer wearing the garment.`;

  try {
    const generated = await openRouterGenerateImage({
      prompt,
      images: [
        {
          buffer: input.personBuffer,
          mime: input.personMime,
          label: "CUSTOMER PHOTO — this is the person to keep. Edit this image.",
        },
        ...productImages.map((url) => ({
          url,
          label: "PRODUCT PHOTO — extract the garment only. Do not output this person or scene.",
        })),
      ],
      aspectRatio: "3:4",
    });

    const resultUrl = await uploadImage(
      generated.imageBuffer,
      `agencies/${input.agency.id}/tryon/results`
    );

    await db("tryon_sessions")
      .where({ id: sessionId })
      .update({ status: "done", result_url: resultUrl, model: generated.model, updated_at: new Date() });

    return { id: sessionId, inputPhotoUrl, resultUrl, sizeHint: hint };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await db("tryon_sessions")
      .where({ id: sessionId })
      .update({ status: "failed", error: message.slice(0, 2000), updated_at: new Date() });
    console.error("Try-on generation failed", { sessionId, message });
    throw new HttpError(502, "We couldn't generate your try-on right now. Please try another photo in a moment.");
  }
}
