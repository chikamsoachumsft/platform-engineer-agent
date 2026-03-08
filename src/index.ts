import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { PlatformEngineerAgent } from "./agent/agent.js";
import { store } from "./agent/store.js";
import { verifyWebhookSignature } from "./auth/webhook.js";
import { azureAuthRouter } from "./auth/azure-oauth.js";
import { handleWebhook } from "./github/webhook-handler.js";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve the React dashboard static files
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "..", "web", "dist")));

const agent = new PlatformEngineerAgent();

// ── Health check ────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", version: "0.1.0" });
});

// ── Chat endpoint — receives a message, returns agent response ─────
app.post("/api/chat", async (req, res) => {
  const { sessionId, message } = req.body as {
    sessionId?: string;
    message?: string;
  };

  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "message is required" });
    return;
  }

  // Use provided sessionId or generate one
  const key = sessionId || crypto.randomUUID();

  try {
    const response = await agent.chat(key, message);
    res.json(response);
  } catch (err) {
    console.error("[Server] Chat error:", err);
    res.status(500).json({ error: "Internal agent error" });
  }
});

// ── Azure OAuth onboarding flow ─────────────────────────────────────
app.use("/auth/azure", azureAuthRouter);
// Simple setup URL: /setup/owner/repo
app.use("/setup", azureAuthRouter);

// ── GitHub App webhook endpoint (Step 15) ──────────────────────────
app.post("/api/webhook", verifyWebhookSignature, handleWebhook);

// ── Dashboard API routes ────────────────────────────────────────────
app.get("/api/deployments", (_req, res) => {
  res.json(store.listDeployments());
});

app.get("/api/deployments/:id", (req, res) => {
  const record = store.getDeployment(req.params.id);
  if (!record) {
    res.status(404).json({ error: "Deployment not found" });
    return;
  }
  res.json(record);
});

// SPA fallback — serve index.html for all non-API routes
app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "web", "dist", "index.html"));
});

// ── Start server ────────────────────────────────────────────────────
async function main() {
  await agent.start();

  app.listen(config.port, () => {
    console.log(
      `[Server] Platform Engineer Agent running on http://localhost:${config.port}`,
    );
    console.log(`[Server] Environment: ${config.nodeEnv}`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n[Server] Shutting down...");
    await agent.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[Server] Fatal error:", err);
  process.exit(1);
});
