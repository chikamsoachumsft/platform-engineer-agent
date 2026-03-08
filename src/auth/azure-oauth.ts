import { Router, type Request, type Response } from "express";
import { randomUUID, createHmac } from "node:crypto";
import { config } from "../config.js";
import { OidcOnboarding } from "./oidc-onboarding.js";
import { getInstallationOctokit, getAppOctokit } from "../github/webhook-handler.js";

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface PendingState {
  installationId: number;
  /** All repos in this installation (looked up during /start or provided directly) */
  repos: string[];
  nonce: string;
  createdAt: number;
  /** User's ARM access token (for listing subscriptions) */
  armAccessToken?: string;
  /** User's Graph access token (for creating Entra Apps) */
  graphAccessToken?: string;
}

// â”€â”€ State store (in-memory, short-lived) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Maps OAuth state param â†’ pending onboarding context
// Entries expire after 10 minutes
const pendingStates = new Map<string, PendingState>();
const STATE_TTL_MS = 10 * 60 * 1000;

function cleanExpiredStates(): void {
  const now = Date.now();
  for (const [key, val] of pendingStates) {
    if (now - val.createdAt > STATE_TTL_MS) pendingStates.delete(key);
  }
}

const oidcOnboarding = new OidcOnboarding();
export const azureAuthRouter = Router();

// â”€â”€ Step 1: Start OAuth flow â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Called as the GitHub App's "Setup URL" after installation.
// GitHub redirects here with: ?installation_id=123&setup_action=install
// Also supports direct navigation with: ?installation_id=123&repo=owner/repo
azureAuthRouter.get("/start", async (req: Request, res: Response): Promise<void> => {
  const installationId = parseInt(req.query.installation_id as string, 10);

  if (!installationId) {
    res.status(400).send("Missing installation_id parameter.");
    return;
  }

  cleanExpiredStates();

  // Look up repos from the installation (or use provided repo)
  let repos: string[] = [];
  const directRepo = req.query.repo as string;

  if (directRepo && /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(directRepo)) {
    repos = [directRepo];
  } else {
    try {
      const octokit = getInstallationOctokit(installationId);
      const { data } = await octokit.rest.apps.listReposAccessibleToInstallation({ per_page: 100 });
      repos = data.repositories.map((r: { full_name: string }) => r.full_name);
    } catch (err) {
      console.error("[AzureAuth] Failed to list installation repos:", err);
      res.status(500).send("Failed to look up repos for this installation. Please try again.");
      return;
    }
  }

  if (repos.length === 0) {
    res.status(400).send("No repositories found for this installation.");
    return;
  }

  // Generate a cryptographically random state parameter to prevent CSRF
  const state = randomUUID();
  const nonce = randomUUID();
  pendingStates.set(state, {
    installationId,
    repos,
    nonce,
    createdAt: Date.now(),
  });

  const redirectUri = `${config.agentBaseUrl}/auth/azure/callback`;

  // Azure AD OAuth 2.0 authorization endpoint
  const authUrl = new URL(`https://login.microsoftonline.com/${config.azureTenantId}/oauth2/v2.0/authorize`);
  authUrl.searchParams.set("client_id", config.azureOAuthClientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "https://management.azure.com/user_impersonation https://graph.microsoft.com/Application.ReadWrite.All https://graph.microsoft.com/AppRoleAssignment.ReadWrite.All openid profile offline_access");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("nonce", nonce);
  authUrl.searchParams.set("prompt", "select_account");

  res.redirect(authUrl.toString());
});

// â”€â”€ Step 2: OAuth callback â†’ list subscriptions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET /auth/azure/callback?code=...&state=...
azureAuthRouter.get("/callback", async (req: Request, res: Response): Promise<void> => {
  const code = req.query.code as string;
  const state = req.query.state as string;
  const error = req.query.error as string;

  if (error) {
    res.status(400).send(`Azure login failed: ${req.query.error_description || error}`);
    return;
  }

  if (!code || !state) {
    res.status(400).send("Missing code or state parameter.");
    return;
  }

  // Validate state to prevent CSRF
  const pending = pendingStates.get(state);
  if (!pending) {
    res.status(400).send("Invalid or expired state. Please start the setup again.");
    return;
  }
  pendingStates.delete(state);

  if (Date.now() - pending.createdAt > STATE_TTL_MS) {
    res.status(400).send("Session expired. Please start the setup again.");
    return;
  }

  try {
    // Exchange authorization code for access token
    const redirectUri = `${config.agentBaseUrl}/auth/azure/callback`;
    const tokenResponse = await fetch(
      `https://login.microsoftonline.com/${config.azureTenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.azureOAuthClientId,
          client_secret: config.azureOAuthClientSecret,
          code,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          scope: "https://management.azure.com/user_impersonation offline_access",
        }),
      },
    );

    if (!tokenResponse.ok) {
      const errBody = await tokenResponse.text();
      console.error("[AzureAuth] Token exchange failed:", errBody);
      res.status(500).send("Failed to exchange authorization code. Please try again.");
      return;
    }

    const tokenData = (await tokenResponse.json()) as { access_token: string; refresh_token?: string };

    // Get a separate Graph token using the refresh token
    let graphAccessToken = "";
    if (tokenData.refresh_token) {
      const graphTokenResponse = await fetch(
        `https://login.microsoftonline.com/${config.azureTenantId}/oauth2/v2.0/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: config.azureOAuthClientId,
            client_secret: config.azureOAuthClientSecret,
            refresh_token: tokenData.refresh_token,
            grant_type: "refresh_token",
            scope: "https://graph.microsoft.com/Application.ReadWrite.All https://graph.microsoft.com/AppRoleAssignment.ReadWrite.All",
          }),
        },
      );
      if (graphTokenResponse.ok) {
        const graphData = (await graphTokenResponse.json()) as { access_token: string };
        graphAccessToken = graphData.access_token;
      } else {
        console.warn("[AzureAuth] Could not get Graph token, will fall back to client credentials");
      }
    }

    // List subscriptions using the user's token
    const subsResponse = await fetch(
      "https://management.azure.com/subscriptions?api-version=2022-12-01",
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } },
    );

    if (!subsResponse.ok) {
      res.status(500).send("Failed to list Azure subscriptions. Please check your permissions.");
      return;
    }

    const subsData = (await subsResponse.json()) as {
      value: Array<{ subscriptionId: string; displayName: string; state: string }>;
    };

    const subscriptions = subsData.value
      .filter((s) => s.state === "Enabled")
      .map((s) => ({ id: s.subscriptionId, name: s.displayName }));

    if (subscriptions.length === 0) {
      res.status(400).send("No active Azure subscriptions found for your account.");
      return;
    }

    // Store tokens in a new pending state for the /complete step
    const completionState = randomUUID();
    pendingStates.set(completionState, {
      installationId: pending.installationId,
      repos: pending.repos,
      nonce: pending.nonce,
      createdAt: Date.now(),
      armAccessToken: tokenData.access_token,
      graphAccessToken,
    });

    const sessionToken = signSession(pending.installationId, pending.repos);

    // If there's only one subscription, skip the picker and auto-submit
    if (subscriptions.length === 1) {
      console.log(`[AzureAuth] Single subscription detected, auto-selecting: ${subscriptions[0].id}`);
      res.send(renderAutoSubmitPage(subscriptions[0], pending.repos, pending.installationId, sessionToken, completionState));
      return;
    }

    // Multiple subscriptions — show picker
    res.send(renderPickerPage(subscriptions, pending.repos, pending.installationId, sessionToken, completionState));
  } catch (err) {
    console.error("[AzureAuth] Callback error:", err);
    res.status(500).send("An error occurred during Azure authentication.");
  }
});

// â”€â”€ Step 3: User picks subscription â†’ run OIDC onboarding â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /auth/azure/complete
azureAuthRouter.post("/complete", async (req: Request, res: Response): Promise<void> => {
  const { subscriptionId, repos, installationId, sessionToken, completionState } = req.body as {
    subscriptionId?: string;
    repos?: string;
    installationId?: number;
    sessionToken?: string;
    completionState?: string;
  };

  // Validate inputs
  if (!subscriptionId || !repos || !installationId || !sessionToken) {
    res.status(400).send("Missing required parameters.");
    return;
  }

  if (!/^[a-f0-9-]{36}$/i.test(subscriptionId)) {
    res.status(400).send("Invalid subscription ID format.");
    return;
  }

  const repoList = repos.split(",").filter(Boolean);
  if (repoList.length === 0) {
    res.status(400).send("No repos specified.");
    return;
  }

  // Verify session token to prevent forgery
  const expectedToken = signSession(installationId, repoList);
  if (sessionToken !== expectedToken) {
    res.status(403).send("Invalid session. Please start the setup again.");
    return;
  }

  // Retrieve the stored tokens from the completion state
  let graphAccessToken: string | undefined;
  let armAccessToken: string | undefined;
  if (completionState) {
    const completionPending = pendingStates.get(completionState);
    if (completionPending) {
      graphAccessToken = completionPending.graphAccessToken;
      armAccessToken = completionPending.armAccessToken;
      pendingStates.delete(completionState);
    }
  }

  try {
    const octokit = getInstallationOctokit(installationId);
    const results: Array<{ repo: string; status: string; clientId?: string; error?: string }> = [];

    for (const repoFullName of repoList) {
      const result = await oidcOnboarding.onboard(
        { repoFullName, subscriptionId, installationId, graphAccessToken, armAccessToken },
        octokit,
      );
      results.push({
        repo: repoFullName,
        status: result.status,
        clientId: result.clientId,
        error: result.error,
      });
    }

    const allSucceeded = results.every((r) => r.status === "succeeded");
    if (allSucceeded) {
      res.send(renderSuccessPage(results, subscriptionId));
    } else {
      res.send(renderPartialPage(results, subscriptionId));
    }
  } catch (err) {
    console.error("[AzureAuth] Onboarding error:", err);
    res.send(renderErrorPage(repoList, err instanceof Error ? err.message : "Unknown error"));
  }
});

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function signSession(installationId: number, repos: string[]): string {
  const secret = config.githubWebhookSecret || config.azureOAuthClientSecret;
  return createHmac("sha256", secret)
    .update(`${installationId}:${repos.sort().join(",")}`)
    .digest("hex");
}

function renderPickerPage(
  subscriptions: Array<{ id: string; name: string }>,
  repos: string[],
  installationId: number,
  sessionToken: string,
  completionState: string,
): string {
  const options = subscriptions
    .map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} (${escapeHtml(s.id)})</option>`)
    .join("\n");

  const repoListHtml = repos.map((r) => `<li>${escapeHtml(r)}</li>`).join("\n");
  const repoCount = repos.length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Select Azure Subscription â€” Platform Engineer</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #e6edf3; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 40px; max-width: 520px; width: 100%; }
    h1 { font-size: 24px; margin-bottom: 8px; }
    .subtitle { color: #8b949e; font-size: 14px; margin-bottom: 20px; }
    .repos { background: #0d1117; border-radius: 6px; padding: 12px 16px; margin-bottom: 20px; }
    .repos ul { list-style: none; padding: 0; }
    .repos li { font-family: monospace; font-size: 14px; color: #58a6ff; padding: 4px 0; }
    .repos li::before { content: "ðŸ“¦ "; }
    label { display: block; font-size: 14px; color: #8b949e; margin-bottom: 8px; }
    select { width: 100%; padding: 10px 12px; border-radius: 6px; border: 1px solid #30363d; background: #0d1117; color: #e6edf3; font-size: 14px; margin-bottom: 24px; }
    button { width: 100%; padding: 12px; border-radius: 6px; border: none; background: #238636; color: #fff; font-size: 16px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
    button:hover { background: #2ea043; }
    button:disabled { background: #30363d; cursor: wait; }
    .info { font-size: 13px; color: #8b949e; margin-top: 16px; line-height: 1.5; }
    .lock { display: inline-block; margin-right: 4px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>ðŸš€ Connect Azure</h1>
    <div class="subtitle">Connecting ${repoCount} repo${repoCount > 1 ? "s" : ""} to Azure</div>
    <div class="repos">
      <ul>${repoListHtml}</ul>
    </div>
    <form method="POST" action="/auth/azure/complete" id="form">
      <label for="sub">Select your Azure subscription</label>
      <select name="subscriptionId" id="sub">${options}</select>
      <input type="hidden" name="repos" value="${escapeHtml(repos.join(","))}">
      <input type="hidden" name="installationId" value="${installationId}">
      <input type="hidden" name="sessionToken" value="${escapeHtml(sessionToken)}">
      <input type="hidden" name="completionState" value="${escapeHtml(completionState)}">
      <button type="submit" id="btn">Connect & Configure OIDC</button>
    </form>
    <div class="info">
      <span class="lock">ðŸ”’</span> This creates a dedicated Entra App per repo with OIDC federated credentials.
      No long-lived secrets â€” only short-lived OIDC tokens.
    </div>
  </div>
  <script>
    document.getElementById('form').addEventListener('submit', function() {
      var btn = document.getElementById('btn');
      btn.disabled = true;
      btn.textContent = 'Setting up OIDC... (â‰ˆ30s)';
    });
  </script>
</body>
</html>`;
}

function renderSuccessPage(
  results: Array<{ repo: string; clientId?: string }>,
  subscriptionId: string,
): string {
  const repoRows = results
    .map((r) => `<li>âœ… <code>${escapeHtml(r.repo)}</code> â†’ <code>${escapeHtml(r.clientId ?? "")}</code></li>`)
    .join("\n");

  const firstRepo = results[0]?.repo ?? "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Setup Complete â€” Platform Engineer</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #e6edf3; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: #161b22; border: 1px solid #238636; border-radius: 12px; padding: 40px; max-width: 560px; width: 100%; }
    h1 { font-size: 24px; margin-bottom: 8px; color: #3fb950; }
    .subtitle { font-size: 14px; color: #8b949e; margin-bottom: 20px; }
    .detail { font-size: 14px; color: #8b949e; margin-bottom: 8px; }
    .detail code { background: #0d1117; padding: 2px 6px; border-radius: 4px; color: #e6edf3; font-size: 13px; }
    .repos { margin: 16px 0; padding-left: 0; list-style: none; }
    .repos li { font-size: 14px; margin-bottom: 8px; color: #e6edf3; }
    .secrets { margin: 16px 0; padding-left: 20px; }
    .secrets li { font-size: 14px; margin-bottom: 4px; }
    .next { background: #0d1117; border-radius: 6px; padding: 16px; margin: 20px 0; font-size: 14px; line-height: 1.6; }
    .next code { background: #161b22; padding: 2px 6px; border-radius: 4px; }
    .actions { margin-top: 20px; }
    a.btn { display: inline-block; padding: 10px 20px; border-radius: 6px; background: #238636; color: #fff; text-decoration: none; font-weight: 600; margin-right: 12px; }
    a.btn:hover { background: #2ea043; }
    a.btn.secondary { background: #30363d; }
    a.btn.secondary:hover { background: #484f58; }
  </style>
</head>
<body>
  <div class="card">
    <h1>âœ… Azure Connected!</h1>
    <div class="subtitle">Subscription: <code>${escapeHtml(subscriptionId)}</code></div>
    <ul class="repos">${repoRows}</ul>
    <div class="detail">Each repo now has these encrypted secrets:</div>
    <ul class="secrets">
      <li>ðŸ”‘ AZURE_CLIENT_ID</li>
      <li>ðŸ”‘ AZURE_TENANT_ID</li>
      <li>ðŸ”‘ AZURE_SUBSCRIPTION_ID</li>
    </ul>
    <div class="next">
      <strong>What's next?</strong> Mention <code>@platform-engineer</code> in Copilot Chat:<br>
      <em>"Analyze and deploy my app to Azure"</em>
    </div>
    <div class="actions">
      <a class="btn" href="https://github.com/${escapeHtml(firstRepo)}">Go to Repo</a>
    </div>
  </div>
</body>
</html>`;
}

function renderPartialPage(
  results: Array<{ repo: string; status: string; clientId?: string; error?: string }>,
  subscriptionId: string,
): string {
  const rows = results
    .map((r) =>
      r.status === "succeeded"
        ? `<li>âœ… ${escapeHtml(r.repo)}</li>`
        : `<li>âŒ ${escapeHtml(r.repo)} â€” ${escapeHtml(r.error ?? "Unknown error")}</li>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Partial Setup â€” Platform Engineer</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #e6edf3; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: #161b22; border: 1px solid #d29922; border-radius: 12px; padding: 40px; max-width: 520px; width: 100%; }
    h1 { font-size: 24px; margin-bottom: 8px; color: #d29922; }
    .subtitle { font-size: 14px; color: #8b949e; margin-bottom: 16px; }
    ul { margin: 16px 0; padding-left: 0; list-style: none; }
    li { font-size: 14px; margin-bottom: 8px; }
    a.btn { display: inline-block; padding: 10px 20px; border-radius: 6px; background: #30363d; color: #fff; text-decoration: none; font-weight: 600; }
    a.btn:hover { background: #484f58; }
  </style>
</head>
<body>
  <div class="card">
    <h1>âš ï¸ Partial Setup</h1>
    <div class="subtitle">Some repos were configured, others had errors.</div>
    <ul>${rows}</ul>
    <a class="btn" href="https://github.com">Back to GitHub</a>
  </div>
</body>
</html>`;
}

function renderErrorPage(repos: string[], error: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Setup Failed â€” Platform Engineer</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #e6edf3; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: #161b22; border: 1px solid #f85149; border-radius: 12px; padding: 40px; max-width: 520px; width: 100%; }
    h1 { font-size: 24px; margin-bottom: 8px; color: #f85149; }
    .repo { color: #58a6ff; font-family: monospace; font-size: 15px; margin-bottom: 16px; }
    .error { background: #0d1117; padding: 12px; border-radius: 6px; font-size: 14px; color: #f85149; margin-bottom: 24px; word-break: break-word; }
    a.btn { display: inline-block; padding: 10px 20px; border-radius: 6px; background: #30363d; color: #fff; text-decoration: none; font-weight: 600; }
    a.btn:hover { background: #484f58; }
  </style>
</head>
<body>
  <div class="card">
    <h1>âŒ Setup Failed</h1>
    <div class="repo">${repos.map(escapeHtml).join(", ")}</div>
    <div class="error">${escapeHtml(error)}</div>
    <a class="btn" href="https://github.com">Back to GitHub</a>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Installation lookup ───────────────────────────────────────────

async function findInstallationForRepo(repoFullName: string): Promise<number | null> {
  try {
    const appOctokit = getAppOctokit();
    const [owner, repo] = repoFullName.split("/");
    const { data } = await appOctokit.rest.apps.getRepoInstallation({ owner, repo });
    return data.id;
  } catch {
    return null;
  }
}

// ── Auto-submit page (single subscription) ─────────────────────────

function renderAutoSubmitPage(
  subscription: { id: string; name: string },
  repos: string[],
  installationId: number,
  sessionToken: string,
  completionState: string,
): string {
  const repoListHtml = repos.map((r) => `<li>${escapeHtml(r)}</li>`).join("\n");
  const repoCount = repos.length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Setting Up \u2014 Platform Engineer</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #e6edf3; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 40px; max-width: 520px; width: 100%; text-align: center; }
    h1 { font-size: 24px; margin-bottom: 8px; }
    .subtitle { color: #8b949e; font-size: 14px; margin-bottom: 20px; }
    .repos { background: #0d1117; border-radius: 6px; padding: 12px 16px; margin-bottom: 20px; text-align: left; }
    .repos ul { list-style: none; padding: 0; }
    .repos li { font-family: monospace; font-size: 14px; color: #58a6ff; padding: 4px 0; }
    .spinner { display: inline-block; width: 24px; height: 24px; border: 3px solid #30363d; border-top-color: #58a6ff; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 16px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .sub-name { color: #8b949e; font-size: 13px; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h1>Setting up Azure OIDC</h1>
    <div class="subtitle">Configuring ${repoCount} repo${repoCount > 1 ? "s" : ""}</div>
    <div class="sub-name">Subscription: ${escapeHtml(subscription.name)}</div>
    <div class="repos"><ul>${repoListHtml}</ul></div>
    <form method="POST" action="/auth/azure/complete" id="autoForm">
      <input type="hidden" name="subscriptionId" value="${escapeHtml(subscription.id)}">
      <input type="hidden" name="repos" value="${escapeHtml(repos.join(","))}">
      <input type="hidden" name="installationId" value="${installationId}">
      <input type="hidden" name="sessionToken" value="${escapeHtml(sessionToken)}">
      <input type="hidden" name="completionState" value="${escapeHtml(completionState)}">
    </form>
  </div>
  <script>document.getElementById('autoForm').submit();</script>
</body>
</html>`;
}

// ── Already set up page ────────────────────────────────────────────

function renderAlreadySetupPage(repoFullName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Already Connected \u2014 Platform Engineer</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #e6edf3; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: #161b22; border: 1px solid #238636; border-radius: 12px; padding: 40px; max-width: 520px; width: 100%; text-align: center; }
    h1 { font-size: 24px; margin-bottom: 12px; color: #3fb950; }
    .subtitle { color: #8b949e; font-size: 14px; margin-bottom: 24px; line-height: 1.6; }
    .repo { font-family: monospace; color: #58a6ff; font-size: 16px; margin-bottom: 16px; }
    a.btn { display: inline-block; padding: 10px 20px; border-radius: 6px; background: #238636; color: #fff; text-decoration: none; font-weight: 600; margin: 4px; }
    a.btn:hover { background: #2ea043; }
    a.btn.secondary { background: #30363d; }
    a.btn.secondary:hover { background: #484f58; }
  </style>
</head>
<body>
  <div class="card">
    <h1>\u2705 Already Connected</h1>
    <div class="repo">${escapeHtml(repoFullName)}</div>
    <div class="subtitle">
      This repo already has Azure OIDC configured.<br>
      Mention <code>@platform-engineer</code> in Copilot Chat to analyze and deploy.
    </div>
    <a class="btn" href="https://github.com/${escapeHtml(repoFullName)}">Go to Repo</a>
  </div>
</body>
</html>`;
}
