import { describe, it, expect } from "vitest";
import { Recommender, type Platform } from "./recommender.js";
import type { AppAnalysisReport } from "./types.js";

function makeReport(overrides: Partial<AppAnalysisReport> = {}): AppAnalysisReport {
  return {
    repoUrl: "https://github.com/test/app",
    repoName: "test/app",
    languages: [{ language: "typescript", percentage: 100 }],
    primaryLanguage: "typescript",
    framework: "express",
    appType: "web-api",
    container: {
      hasDockerfile: false,
      hasCompose: false,
      baseImage: null,
      exposedPorts: [],
      dockerfileCount: 0,
    },
    dependencies: { count: 15, notable: ["express"], hasLockfile: true },
    databases: { detected: false, types: [] },
    detectedPorts: [3000],
    entryPoints: ["src/index.ts"],
    hasTests: true,
    hasCi: true,
    estimatedComplexity: "simple",
    analysisTimestamp: new Date().toISOString(),
    warnings: [],
    ...overrides,
  };
}

describe("Recommender", () => {
  const recommender = new Recommender();

  it("returns 5 platform scores sorted by score descending", () => {
    const result = recommender.recommend(makeReport());
    expect(result.recommendations).toHaveLength(5);
    for (let i = 1; i < result.recommendations.length; i++) {
      expect(result.recommendations[i].score).toBeLessThanOrEqual(
        result.recommendations[i - 1].score,
      );
    }
  });

  it("ranks app-service top-3 for a simple Express web API", () => {
    const result = recommender.recommend(
      makeReport({ framework: "express", appType: "web-api", estimatedComplexity: "simple" }),
    );
    const top3 = result.recommendations.slice(0, 3).map((r) => r.platform);
    expect(top3).toContain("app-service");
  });

  it("ranks container-apps in top-3 for a containerized app", () => {
    const result = recommender.recommend(
      makeReport({
        container: {
          hasDockerfile: true,
          hasCompose: false,
          baseImage: "node:22-alpine",
          exposedPorts: [8080],
          dockerfileCount: 1,
        },
        estimatedComplexity: "moderate",
      }),
    );
    const top3 = result.recommendations.slice(0, 3).map((r) => r.platform);
    expect(top3).toContain("container-apps");
  });

  it("recommends functions for event-driven workloads", () => {
    const result = recommender.recommend(
      makeReport({
        appType: "event-driven",
        framework: "none",
        dependencies: { count: 5, notable: ["@azure/functions"], hasLockfile: true },
        estimatedComplexity: "simple",
      }),
    );
    expect(result.topPick).toBe("functions");
  });

  it("ranks AKS higher for complex microservices", () => {
    const result = recommender.recommend(
      makeReport({
        appType: "microservices",
        estimatedComplexity: "complex",
        container: {
          hasDockerfile: true,
          hasCompose: true,
          baseImage: "node:22",
          exposedPorts: [3000, 4000, 5000],
          dockerfileCount: 4,
        },
      }),
    );
    // AKS or container-apps should be top for complex microservices
    const topTwo = result.recommendations.slice(0, 2).map((r) => r.platform);
    expect(topTwo).toContain("aks");
  });

  it("includes pros, cons, and SKU for each platform", () => {
    const result = recommender.recommend(makeReport());
    for (const rec of result.recommendations) {
      expect(rec.pros.length).toBeGreaterThan(0);
      expect(rec.cons.length).toBeGreaterThan(0);
      expect(rec.suggestedSku).toBeTruthy();
    }
  });

  it("generates a markdown summary", () => {
    const result = recommender.recommend(makeReport());
    expect(result.summary).toContain("## Platform Recommendation");
    expect(result.summary).toContain("Top Pick");
    expect(result.summary).toContain("Scoring Breakdown");
  });

  it("suggests appropriate SKUs based on complexity", () => {
    const simple = recommender.recommend(makeReport({ estimatedComplexity: "simple" }));
    const complex = recommender.recommend(makeReport({ estimatedComplexity: "complex" }));

    const simpleFunc = simple.recommendations.find((r) => r.platform === "functions")!;
    const complexFunc = complex.recommendations.find((r) => r.platform === "functions")!;

    expect(simpleFunc.suggestedSku).toContain("Consumption");
    expect(complexFunc.suggestedSku).toContain("Premium");
  });

  it("each recommendation has a breakdown with all scoring factors", () => {
    const result = recommender.recommend(makeReport());
    for (const rec of result.recommendations) {
      // Should have 9 factors
      expect(rec.breakdown.length).toBe(9);
      for (const entry of rec.breakdown) {
        expect(entry.factor).toBeTruthy();
        expect(entry.reason).toBeTruthy();
        expect(typeof entry.score).toBe("number");
      }
    }
  });

  it("all 5 platforms are represented", () => {
    const result = recommender.recommend(makeReport());
    const platforms = result.recommendations.map((r) => r.platform);
    const expected: Platform[] = ["functions", "app-service", "container-apps", "aks", "vm"];
    for (const p of expected) {
      expect(platforms).toContain(p);
    }
  });
});
