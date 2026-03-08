import { ClientSecretCredential } from "@azure/identity";
import { Client as GraphClient } from "@microsoft/microsoft-graph-client";
import { Octokit } from "@octokit/rest";
import { config } from "../config.js";
import sodium from "libsodium-wrappers";

// ── Types ───────────────────────────────────────────────────────────

export interface OnboardingRequest {
  /** GitHub owner/repo — e.g. "octo-org/my-app" */
  repoFullName: string;
  /** Azure subscription ID the repo will deploy to */
  subscriptionId: string;
  /** GitHub installation ID for the App (used to get an installation token) */
  installationId: number;
  /** Optional user-delegated Graph access token (used instead of client credentials) */
  graphAccessToken?: string;
  /** Optional user-delegated ARM access token (used for role assignments when agent SP lacks Owner) */
  armAccessToken?: string;
}

export interface OnboardingResult {
  status: "succeeded" | "failed";
  /** Entra Application (client) ID */
  clientId?: string;
  /** Entra tenant ID */
  tenantId?: string;
  /** Whether the 3 repo secrets were created */
  secretsConfigured: boolean;
  summary: string;
  error?: string;
}

interface EntraApp {
  appId: string;       // Application (client) ID
  objectId: string;    // Object ID of the application
  spObjectId: string;  // Object ID of the service principal
}

// ── Service ─────────────────────────────────────────────────────────

export class OidcOnboarding {
  private tenantId = config.azureTenantId;

  /**
   * Full onboarding flow:
   * 1. Create Entra App Registration
   * 2. Create service principal for the app
   * 3. Add OIDC federated credential (GitHub Actions → Azure)
   * 4. Assign Contributor role on the subscription
   * 5. Store AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_SUBSCRIPTION_ID as GitHub repo secrets
   */
  async onboard(req: OnboardingRequest, octokit: Octokit): Promise<OnboardingResult> {
    const [owner, repo] = req.repoFullName.split("/");
    if (!owner || !repo) {
      return { status: "failed", secretsConfigured: false, summary: "", error: "Invalid repo name" };
    }

    try {
      // 1-3. Create Entra App + SP + federated credential
      const graphClient = this.getGraphClient(req.graphAccessToken);
      const entraApp = await this.createEntraApp(graphClient, req.repoFullName);
      await this.addFederatedCredential(graphClient, entraApp.objectId, req.repoFullName);

      // 4. Assign Contributor role on the subscription
      await this.assignSubscriptionRole(req.subscriptionId, entraApp.spObjectId, req.armAccessToken);

      // 5. Write secrets to the repo
      await this.setRepoSecrets(octokit, owner, repo, {
        AZURE_CLIENT_ID: entraApp.appId,
        AZURE_TENANT_ID: this.tenantId,
        AZURE_SUBSCRIPTION_ID: req.subscriptionId,
      });

      const summary = [
        "## Azure OIDC Onboarding Complete ✅\n",
        `- **Entra App**: \`${entraApp.appId}\` (${req.repoFullName})`,
        `- **Tenant**: \`${this.tenantId}\``,
        `- **Subscription**: \`${req.subscriptionId}\``,
        `- **Federated credential**: GitHub Actions OIDC for \`${req.repoFullName}\``,
        `- **Role**: Contributor on subscription`,
        `- **Repo secrets**: AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_SUBSCRIPTION_ID ✅`,
        "",
        "All 10 monitoring workflows can now authenticate to Azure via OIDC — zero long-lived secrets.",
      ].join("\n");

      return {
        status: "succeeded",
        clientId: entraApp.appId,
        tenantId: this.tenantId,
        secretsConfigured: true,
        summary,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: "failed",
        secretsConfigured: false,
        summary: `Azure OIDC onboarding failed: ${message}`,
        error: message,
      };
    }
  }

  /**
   * Check if a repo already has OIDC secrets configured.
   */
  async isAlreadyOnboarded(octokit: Octokit, owner: string, repo: string): Promise<boolean> {
    try {
      // GitHub API returns secret names (not values) — check if all 3 exist
      const { data } = await octokit.rest.actions.listRepoSecrets({ owner, repo });
      const names = new Set(data.secrets.map((s) => s.name));
      return names.has("AZURE_CLIENT_ID") && names.has("AZURE_TENANT_ID") && names.has("AZURE_SUBSCRIPTION_ID");
    } catch {
      return false;
    }
  }

  // ── Graph Client ────────────────────────────────────────────────

  private getGraphClient(userAccessToken?: string): GraphClient {
    if (userAccessToken) {
      // Use the delegated user token — works even without admin consent on the agent's SP
      return GraphClient.initWithMiddleware({
        authProvider: {
          getAccessToken: async () => userAccessToken,
        },
      });
    }

    // Fallback: client credentials (requires Application.ReadWrite.All app role on the agent's SP)
    const credential = new ClientSecretCredential(
      config.azureTenantId,
      config.azureClientId,
      config.azureClientSecret,
    );

    return GraphClient.initWithMiddleware({
      authProvider: {
        getAccessToken: async () => {
          const token = await credential.getToken("https://graph.microsoft.com/.default");
          return token.token;
        },
      },
    });
  }

  // ── Step 1-2: Create Entra App + Service Principal ──────────────

  private async createEntraApp(graph: GraphClient, repoFullName: string): Promise<EntraApp> {
    const displayName = `platform-engineer-${repoFullName.replace("/", "-")}`;

    // Create the application
    const app = await graph.api("/applications").post({
      displayName,
      signInAudience: "AzureADMyOrg",
    });

    // Create the service principal for the app
    const sp = await graph.api("/servicePrincipals").post({
      appId: app.appId,
    });

    console.log(`[OIDC] Created Entra App: ${app.appId} (${displayName})`);

    return {
      appId: app.appId,
      objectId: app.id,
      spObjectId: sp.id,
    };
  }

  // ── Step 3: Add OIDC Federated Credential ──────────────────────

  private async addFederatedCredential(
    graph: GraphClient,
    appObjectId: string,
    repoFullName: string,
  ): Promise<void> {
    await graph
      .api(`/applications/${appObjectId}/federatedIdentityCredentials`)
      .post({
        name: `github-actions-${repoFullName.replace("/", "-")}`,
        issuer: "https://token.actions.githubusercontent.com",
        subject: `repo:${repoFullName}:ref:refs/heads/main`,
        audiences: ["api://AzureADTokenExchange"],
        description: `OIDC for GitHub Actions on ${repoFullName}`,
      });

    // Also add a credential for any branch (workflow_dispatch, PRs, schedules)
    await graph
      .api(`/applications/${appObjectId}/federatedIdentityCredentials`)
      .post({
        name: `github-actions-${repoFullName.replace("/", "-")}-env`,
        issuer: "https://token.actions.githubusercontent.com",
        subject: `repo:${repoFullName}:environment:production`,
        audiences: ["api://AzureADTokenExchange"],
        description: `OIDC for GitHub Actions (production env) on ${repoFullName}`,
      });

    console.log(`[OIDC] Added federated credentials for ${repoFullName}`);
  }

  // ── Step 4: Assign Contributor Role ─────────────────────────────

  private async assignSubscriptionRole(
    subscriptionId: string,
    spObjectId: string,
    userArmToken?: string,
  ): Promise<void> {
    const { AuthorizationManagementClient } = await import("@azure/arm-authorization");

    // Use the user's ARM token if available (user has Owner, agent SP only has Contributor)
    const credential = userArmToken
      ? { getToken: async () => ({ token: userArmToken, expiresOnTimestamp: Date.now() + 3600_000 }) }
      : new (await import("@azure/identity")).DefaultAzureCredential();

    const authClient = new AuthorizationManagementClient(
      credential as any,
      subscriptionId,
    );

    const contributorRoleId = "b24988ac-6180-42a0-ab88-20f7382dd24c";
    const scope = `/subscriptions/${subscriptionId}`;
    const roleAssignmentName = crypto.randomUUID();

    try {
      await authClient.roleAssignments.create(scope, roleAssignmentName, {
        roleDefinitionId: `${scope}/providers/Microsoft.Authorization/roleDefinitions/${contributorRoleId}`,
        principalId: spObjectId,
        principalType: "ServicePrincipal",
      });
      console.log(`[OIDC] Assigned Contributor role to SP ${spObjectId} on subscription ${subscriptionId}`);
    } catch (err: any) {
      // If role assignment already exists, that's OK
      if (err?.code === "RoleAssignmentExists") {
        console.log(`[OIDC] Contributor role already assigned`);
      } else {
        throw err;
      }
    }
  }

  // ── Step 5: Set GitHub Repo Secrets ─────────────────────────────

  private async setRepoSecrets(
    octokit: Octokit,
    owner: string,
    repo: string,
    secrets: Record<string, string>,
  ): Promise<void> {
    // Get the repo's public key for secret encryption
    const { data: publicKey } = await octokit.rest.actions.getRepoPublicKey({
      owner,
      repo,
    });

    await sodium.ready;

    for (const [name, value] of Object.entries(secrets)) {
      const keyBytes = sodium.from_base64(publicKey.key, sodium.base64_variants.ORIGINAL);
      const messageBytes = sodium.from_string(value);
      const encrypted = sodium.crypto_box_seal(messageBytes, keyBytes);
      const encryptedBase64 = sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);

      await octokit.rest.actions.createOrUpdateRepoSecret({
        owner,
        repo,
        secret_name: name,
        encrypted_value: encryptedBase64,
        key_id: publicKey.key_id,
      });
    }

    console.log(`[OIDC] Set ${Object.keys(secrets).length} repo secrets on ${owner}/${repo}`);
  }
}
