import { env } from "../config/env";
import { HttpError } from "../utils/http";

const MAX_CHARS = 500;
const cache = new Map<string, Buffer>();
const CACHE_LIMIT = 40;

function apiKeys(): string[] {
  const keys = [env.elevenLabs.apiKey, env.elevenLabs.secondaryApiKey].filter(Boolean);
  return [...new Set(keys)];
}

export function elevenLabsEnabled() {
  return apiKeys().length > 0;
}

async function requestSpeech(apiKey: string, spoken: string): Promise<Buffer> {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${env.elevenLabs.voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: spoken,
        model_id: env.elevenLabs.model,
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.8,
          speed: 1.15,
        },
      }),
      signal: AbortSignal.timeout(30_000),
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    console.warn("ElevenLabs TTS failed", response.status, detail.slice(0, 300));
    throw new HttpError(502, "Voice generation is unavailable right now");
  }

  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length) {
    throw new HttpError(502, "Voice generation returned no audio");
  }

  return audio;
}

export async function synthesizeSpeech(text: string): Promise<{ audio: Buffer; contentType: string }> {
  const spoken = text.replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
  if (!spoken) {
    throw new HttpError(400, "Nothing to speak");
  }

  const keys = apiKeys();
  if (!keys.length) {
    throw new HttpError(503, "ElevenLabs is not configured");
  }

  const cacheKey = `${env.elevenLabs.voiceId}:1.15:${spoken}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return { audio: cached, contentType: "audio/mpeg" };
  }

  let lastError: unknown;
  for (let i = 0; i < keys.length; i++) {
    try {
      const audio = await requestSpeech(keys[i], spoken);
      cache.set(cacheKey, audio);
      if (cache.size > CACHE_LIMIT) {
        const first = cache.keys().next().value;
        if (first) cache.delete(first);
      }
      return { audio, contentType: "audio/mpeg" };
    } catch (error) {
      lastError = error;
      if (i < keys.length - 1) {
        console.warn("ElevenLabs primary key failed, retrying with secondary key");
      }
    }
  }

  throw lastError;
}
