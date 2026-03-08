import type { Platform } from "./recommender.js";

// ── Tracked deployment record ───────────────────────────────────────

export interface DeploymentRecord {
  id: string;
  repoUrl: string;
  platform: Platform;
  subscriptionId: string;
  resourceGroupName: string;
  region: string;
  status: "pending" | "deploying" | "succeeded" | "failed";
  createdAt: string;
  updatedAt: string;
  outputs: Record<string, string>;
  error?: string;
}

// ── In-memory store ─────────────────────────────────────────────────
// In production this would be backed by Cosmos DB or similar.

class Store {
  private deployments = new Map<string, DeploymentRecord>();

  // ── Deployments ─────────────────────────────────────────────────

  addDeployment(record: DeploymentRecord): void {
    this.deployments.set(record.id, record);
  }

  updateDeployment(id: string, patch: Partial<DeploymentRecord>): void {
    const existing = this.deployments.get(id);
    if (existing) {
      Object.assign(existing, patch, { updatedAt: new Date().toISOString() });
    }
  }

  getDeployment(id: string): DeploymentRecord | undefined {
    return this.deployments.get(id);
  }

  listDeployments(): DeploymentRecord[] {
    return [...this.deployments.values()].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  getDeploymentsByRepo(repoUrl: string): DeploymentRecord[] {
    return this.listDeployments().filter((d) => d.repoUrl === repoUrl);
  }
}

export const store = new Store();
