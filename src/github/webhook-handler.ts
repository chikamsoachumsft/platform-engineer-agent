import type { Request, Response } from "express";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { readFileSync } from "node:fs";
import { config } from "../config.js";

interface WebhookPayload {
  action?: string;
  installation?: { id: number; account?: { login?: string } };
  repositories?: Array<{ full_name?: string }>;
  repository?: { full_name?: string };
  issue?: { number?: number; title?: string; body?: string };
  sender?: { login?: string };
}

/**
 * Handle incoming GitHub App webhook events.
 */
export async function handleWebhook(req: Request, res: Response): Promise<void> {
  const event = req.headers["x-github-event"] as string;
  const payload = req.body as WebhookPayload;

  console.log(`[Webhook] Event: ${event}, Action: ${payload.action ?? "n/a"}`);

  switch (event) {
    case "installation":
      handleInstallation(payload);
      break;

    case "installation_repositories":
      console.log(
        `[Webhook] Repos changed for installation ${payload.installation?.id}`,
      );
      break;

    case "issues":
      if (payload.action === "opened" && isMentioned(payload.issue?.body)) {
        console.log(
          `[Webhook] Mentioned in issue #${payload.issue?.number} on ${payload.repository?.full_name}`,
        );
      }
      break;

    case "ping":
      console.log("[Webhook] Ping received — webhook is configured correctly");
      break;

    default:
      console.log(`[Webhook] Unhandled event: ${event}`);
  }

  res.status(200).json({ ok: true });
}

/**
 * Resolve the GitHub App private key from env var (base64 or raw PEM) or file path.
 */
function resolvePrivateKey(): string {
  if (config.githubAppPrivateKey) {
    // Try base64 decode first
    try {
      const decoded = Buffer.from(config.githubAppPrivateKey, "base64").toString("utf-8");
      if (decoded.includes("-----BEGIN")) return decoded;
    } catch { /* not base64 */ }
    // Raw PEM
    if (config.githubAppPrivateKey.includes("-----BEGIN")) return config.githubAppPrivateKey;
  }
  if (config.githubAppPrivateKeyPath) {
    return readFileSync(config.githubAppPrivateKeyPath, "utf-8");
  }
  throw new Error("No GitHub App private key configured (set GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH)");
}

/**
 * Get an authenticated Octokit instance for a GitHub App installation.
 */
export function getInstallationOctokit(installationId: number): Octokit {
  const privateKey = resolvePrivateKey();
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: config.githubAppId,
      privateKey,
      installationId,
    },
  });
}

/**
 * Get an app-level Octokit (not installation-scoped) for admin API calls.
 */
export function getAppOctokit(): Octokit {
  const privateKey = resolvePrivateKey();
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: config.githubAppId,
      privateKey,
    },
  });
}

function handleInstallation(payload: WebhookPayload): void {
  const action = payload.action;
  const account = payload.installation?.account?.login ?? "unknown";
  const installId = payload.installation?.id;

  if (action === "created") {
    // The user's browser is redirected to /auth/azure/start (the GitHub App's Setup URL)
    // immediately after installation — no issue needed.
    console.log(
      `[Webhook] New installation #${installId} by ${account} — Azure OAuth flow handles onboarding`,
    );
  } else if (action === "deleted") {
    console.log(`[Webhook] Installation #${installId} removed by ${account}`);
  }
}

function isMentioned(text?: string | null): boolean {
  if (!text) return false;
  return text.includes("@platform-engineer");
}
