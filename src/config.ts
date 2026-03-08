import "dotenv/config";

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  nodeEnv: process.env.NODE_ENV || "development",

  // GitHub App
  githubAppId: process.env.GITHUB_APP_ID || "",
  githubAppPrivateKeyPath: process.env.GITHUB_APP_PRIVATE_KEY_PATH || "",
  githubAppPrivateKey: process.env.GITHUB_APP_PRIVATE_KEY || "", // base64-encoded PEM or raw PEM
  githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET || "",

  // Azure (agent's own identity for provisioning)
  azureTenantId: process.env.AZURE_TENANT_ID || "",
  azureClientId: process.env.AZURE_CLIENT_ID || "",
  azureClientSecret: process.env.AZURE_CLIENT_SECRET || "",

  // Azure OAuth (for user-facing Azure login during onboarding)
  // Can be the same Entra App as above, or a separate one with user_impersonation scope
  azureOAuthClientId: process.env.AZURE_OAUTH_CLIENT_ID || process.env.AZURE_CLIENT_ID || "",
  azureOAuthClientSecret: process.env.AZURE_OAUTH_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET || "",

  // Agent's public URL (for OAuth redirect URIs)
  agentBaseUrl: process.env.AGENT_BASE_URL || "http://localhost:3000",

  // Copilot SDK
  copilotModel: process.env.COPILOT_MODEL || "gpt-4o",
} as const;
