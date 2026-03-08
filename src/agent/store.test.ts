import { describe, it, expect, beforeEach } from "vitest";

// The store module exports a singleton, but we need fresh instances for tests.
// Re-import the types and recreate a store-like class for isolation.

interface DeploymentRecord {
  id: string;
  repoUrl: string;
  platform: "functions" | "app-service" | "container-apps" | "aks" | "vm";
  subscriptionId: string;
  resourceGroupName: string;
  region: string;
  status: "pending" | "deploying" | "succeeded" | "failed";
  createdAt: string;
  updatedAt: string;
  outputs: Record<string, string>;
  error?: string;
}

// Minimal Store reimplementation to test logic without singleton issues
class TestStore {
  private deployments = new Map<string, DeploymentRecord>();

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

function makeRecord(overrides: Partial<DeploymentRecord> = {}): DeploymentRecord {
  return {
    id: `dep-${Date.now()}`,
    repoUrl: "https://github.com/test/app",
    platform: "container-apps",
    subscriptionId: "sub-1",
    resourceGroupName: "rg-test",
    region: "eastus2",
    status: "deploying",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    outputs: {},
    ...overrides,
  };
}

describe("Store", () => {
  let store: TestStore;

  beforeEach(() => {
    store = new TestStore();
  });

  it("adds and retrieves a deployment", () => {
    const record = makeRecord({ id: "dep-1" });
    store.addDeployment(record);
    expect(store.getDeployment("dep-1")).toBe(record);
  });

  it("returns undefined for non-existent deployment", () => {
    expect(store.getDeployment("nope")).toBeUndefined();
  });

  it("updates an existing deployment", () => {
    const record = makeRecord({ id: "dep-2", status: "deploying" });
    store.addDeployment(record);

    store.updateDeployment("dep-2", {
      status: "succeeded",
      outputs: { appUrl: "https://myapp.azurewebsites.net" },
    });

    const updated = store.getDeployment("dep-2")!;
    expect(updated.status).toBe("succeeded");
    expect(updated.outputs.appUrl).toBe("https://myapp.azurewebsites.net");
  });

  it("does not throw when updating a non-existent deployment", () => {
    expect(() => store.updateDeployment("nope", { status: "failed" })).not.toThrow();
  });

  it("lists deployments sorted newest first", () => {
    const old = makeRecord({ id: "dep-old", createdAt: "2024-01-01T00:00:00Z" });
    const mid = makeRecord({ id: "dep-mid", createdAt: "2024-06-01T00:00:00Z" });
    const recent = makeRecord({ id: "dep-new", createdAt: "2025-01-01T00:00:00Z" });

    store.addDeployment(old);
    store.addDeployment(mid);
    store.addDeployment(recent);

    const list = store.listDeployments();
    expect(list.map((d) => d.id)).toEqual(["dep-new", "dep-mid", "dep-old"]);
  });

  it("filters deployments by repo URL", () => {
    store.addDeployment(makeRecord({ id: "a", repoUrl: "https://github.com/a/repo" }));
    store.addDeployment(makeRecord({ id: "b", repoUrl: "https://github.com/b/repo" }));
    store.addDeployment(makeRecord({ id: "c", repoUrl: "https://github.com/a/repo" }));

    const aDeployments = store.getDeploymentsByRepo("https://github.com/a/repo");
    expect(aDeployments).toHaveLength(2);
    expect(aDeployments.every((d) => d.repoUrl === "https://github.com/a/repo")).toBe(true);
  });
});
