import { Router } from "express";
import { z } from "zod";
import { simpleRateLimit } from "../../middleware/rate-limit";
import { elevenLabsEnabled, synthesizeSpeech } from "../../services/elevenlabs";
import { asyncHandler } from "../../utils/http";

const router = Router();

router.get("/status", (_req, res) => {
  res.json({ enabled: elevenLabsEnabled() });
});

router.post(
  "/",
  simpleRateLimit({ windowMs: 10 * 60 * 1000, max: 120 }),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        text: z.string().min(1).max(800),
      })
      .parse(req.body);

    const result = await synthesizeSpeech(body.text);
    res.setHeader("Content-Type", result.contentType);
    res.setHeader("Cache-Control", "no-store");
    res.send(result.audio);
  })
);

export default router;
