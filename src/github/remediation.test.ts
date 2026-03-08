import { describe, it, expect } from "vitest";
import { RemediationGenerator } from "./remediation.js";
import type { Platform } from "../agent/recommender.js";

describe("RemediationGenerator", () => {
  const gen = new RemediationGenerator();

  const baseRequest = {
    repoUrl: "https://github.com/contoso/app",
    platform: "container-apps" as Platform,
    resourceGroupName: "rg-app",
    subscriptionId: "sub-123",
    region: "eastus2",
    appName: "my-app",
  };

  it("generates 10 workflows", () => {
    const result = gen.generate(baseRequest);
    expect(result.workflows).toHaveLength(10);
  });

  it("generates workflows with valid YAML-like names and paths", () => {
    const result = gen.generate(baseRequest);
    for (const wf of result.workflows) {
      expect(wf.path).toMatch(/^\.github\/workflows\/pe-/);
      expect(wf.path).toMatch(/\.yml$/);
      expect(wf.name).toBeTruthy();
      expect(wf.content.length).toBeGreaterThan(50);
    }
  });

  it("includes health check workflow with cron schedule", () => {
    const result = gen.generate(baseRequest);
    const health = result.workflows.find((w) => w.path.includes("health-check"));
    expect(health).toBeDefined();
    expect(health!.content).toContain("schedule");
    expect(health!.content).toContain("cron");
  });

  it("includes cost report workflow", () => {
    const result = gen.generate(baseRequest);
    const cost = result.workflows.find((w) => w.path.includes("cost-report"));
    expect(cost).toBeDefined();
    expect(cost!.content).toContain("schedule");
  });

  it("includes drift detection workflow", () => {
    const result = gen.generate(baseRequest);
    const drift = result.workflows.find((w) => w.path.includes("drift"));
    expect(drift).toBeDefined();
    expect(drift!.content).toContain("what-if");
  });

  it("includes security scan workflow", () => {
    const result = gen.generate(baseRequest);
    const sec = result.workflows.find((w) => w.path.includes("security"));
    expect(sec).toBeDefined();
  });

  it("includes auto-remediate workflow", () => {
    const result = gen.generate(baseRequest);
    const remediate = result.workflows.find((w) => w.path.includes("remediate"));
    expect(remediate).toBeDefined();
  });

  it("includes performance test workflow", () => {
    const result = gen.generate(baseRequest);
    const perf = result.workflows.find((w) => w.path.includes("performance"));
    expect(perf).toBeDefined();
    expect(perf!.content).toContain("curl");
  });

  it("includes backup verification workflow", () => {
    const result = gen.generate(baseRequest);
    const backup = result.workflows.find((w) => w.path.includes("backup"));
    expect(backup).toBeDefined();
  });

  it("includes certificate renewal workflow", () => {
    const result = gen.generate(baseRequest);
    const cert = result.workflows.find((w) => w.path.includes("certificate"));
    expect(cert).toBeDefined();
    expect(cert!.content).toContain("ssl");
  });

  it("includes scale monitor workflow", () => {
    const result = gen.generate(baseRequest);
    const scale = result.workflows.find((w) => w.path.includes("scale"));
    expect(scale).toBeDefined();
    expect(scale!.content).toContain("*/15");
  });

  it("includes log analysis workflow", () => {
    const result = gen.generate(baseRequest);
    const logs = result.workflows.find((w) => w.path.includes("log-analysis"));
    expect(logs).toBeDefined();
    expect(logs!.content).toContain("AppExceptions");
  });

  it("produces a markdown summary", () => {
    const result = gen.generate(baseRequest);
    expect(result.summary).toContain("Auto-Remediation Workflows");
    expect(result.summary).toContain("Health Check");
    expect(result.summary).toContain("AZURE_CLIENT_ID");
  });

  it("generates different content for different platforms", () => {
    const containerApps = gen.generate({ ...baseRequest, platform: "container-apps" });
    const aks = gen.generate({ ...baseRequest, platform: "aks" });

    const caRemediate = containerApps.workflows.find((w) => w.path.includes("remediate"))!;
    const aksRemediate = aks.workflows.find((w) => w.path.includes("remediate"))!;

    // Content should differ since platform-specific commands are used
    expect(caRemediate.content).not.toBe(aksRemediate.content);
  });

  it("includes permissions block in workflow content", () => {
    const result = gen.generate(baseRequest);
    for (const wf of result.workflows) {
      expect(wf.content).toContain("permissions:");
    }
  });
});
