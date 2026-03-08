import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";

/**
 * Express middleware that verifies the GitHub webhook signature (X-Hub-Signature-256).
 * Rejects requests with invalid or missing signatures.
 */
export function verifyWebhookSignature(req: Request, res: Response, next: NextFunction): void {
  const signature = req.headers["x-hub-signature-256"] as string | undefined;
  const secret = config.githubWebhookSecret;

  if (!secret) {
    // If no secret is configured, skip verification (dev mode)
    next();
    return;
  }

  if (!signature) {
    res.status(401).json({ error: "Missing X-Hub-Signature-256 header" });
    return;
  }

  // req.body has already been parsed by express.json(), so we need the raw body
  // We'll compute against the JSON-serialized body
  const body = JSON.stringify(req.body);
  const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }

  next();
}
