import type { AppAnalysisReport, AppType, Framework } from "./types.js";

// ── Platform types ──────────────────────────────────────────────────

export type Platform = "functions" | "app-service" | "container-apps" | "aks" | "vm";

export interface PlatformScore {
  platform: Platform;
  score: number;
  breakdown: { factor: string; score: number; reason: string }[];
  pros: string[];
  cons: string[];
  suggestedSku: string;
}

export interface RecommendationResult {
  repoUrl: string;
  recommendations: PlatformScore[];
  topPick: Platform;
  summary: string;
}

// ── Scoring factors ─────────────────────────────────────────────────

type ScoringFactor = {
  name: string;
  weight: number;
  score: (report: AppAnalysisReport) => Record<Platform, { value: number; reason: string }>;
};

const FACTORS: ScoringFactor[] = [
  {
    name: "Event-driven / triggers",
    weight: 1,
    score: (r) => {
      const isEventDriven = r.appType === "event-driven";
      return {
        functions:      { value: isEventDriven ? 3 : 0, reason: isEventDriven ? "Native trigger model" : "No event-driven signals" },
        "app-service":  { value: 0, reason: "Not optimized for event-driven" },
        "container-apps": { value: isEventDriven ? 1 : 0, reason: isEventDriven ? "KEDA scaling rules" : "No event-driven signals" },
        aks:            { value: 0, reason: "Overkill for event-driven" },
        vm:             { value: 0, reason: "Manual event handling" },
      };
    },
  },
  {
    name: "Already containerized",
    weight: 1.2,
    score: (r) => {
      const has = r.container.hasDockerfile;
      return {
        functions:      { value: has ? -1 : 0, reason: has ? "Custom container support limited" : "No container needed" },
        "app-service":  { value: has ? 1 : 0, reason: has ? "Supports custom containers" : "No container" },
        "container-apps": { value: has ? 3 : 0, reason: has ? "Container-native platform" : "Would need Dockerfile" },
        aks:            { value: has ? 3 : 0, reason: has ? "Full container orchestration" : "Would need containerization" },
        vm:             { value: has ? 1 : 0, reason: has ? "Can run Docker" : "Runs directly" },
      };
    },
  },
  {
    name: "Scale to zero",
    weight: 0.8,
    score: (r) => {
      const lowLoad = r.estimatedComplexity === "simple";
      return {
        functions:      { value: lowLoad ? 3 : 1, reason: "Consumption plan scales to zero" },
        "app-service":  { value: 0, reason: "Always-on or min 1 instance" },
        "container-apps": { value: lowLoad ? 3 : 1, reason: "Scales to zero with KEDA" },
        aks:            { value: 0, reason: "Min 1 node required" },
        vm:             { value: 0, reason: "Always running" },
      };
    },
  },
  {
    name: "Microservices",
    weight: 1.3,
    score: (r) => {
      const isMicro = r.appType === "microservices" || r.container.dockerfileCount > 2;
      return {
        functions:      { value: isMicro ? -1 : 0, reason: isMicro ? "Not ideal for multi-service" : "N/A" },
        "app-service":  { value: isMicro ? 0 : 0, reason: isMicro ? "Separate apps or slots needed" : "N/A" },
        "container-apps": { value: isMicro ? 2 : 0, reason: isMicro ? "Built for microservices, Dapr support" : "N/A" },
        aks:            { value: isMicro ? 3 : 0, reason: isMicro ? "Full Kubernetes orchestration" : "N/A" },
        vm:             { value: isMicro ? 0 : 0, reason: isMicro ? "Manual service management" : "N/A" },
      };
    },
  },
  {
    name: "Simple web app",
    weight: 1,
    score: (r) => {
      const simple = r.appType === "web-api" || r.appType === "full-stack" || r.appType === "static-site";
      const isSimple = simple && r.estimatedComplexity !== "complex";
      return {
        functions:      { value: isSimple && r.appType !== "full-stack" ? 1 : 0, reason: isSimple ? "HTTP trigger works" : "Not simple" },
        "app-service":  { value: isSimple ? 3 : 1, reason: isSimple ? "Perfect fit: managed web hosting" : "Works but may be overkill" },
        "container-apps": { value: isSimple ? 1 : 0, reason: isSimple ? "Works but more setup than needed" : "N/A" },
        aks:            { value: isSimple ? -1 : 0, reason: isSimple ? "Overkill for simple apps" : "N/A" },
        vm:             { value: 0, reason: "Manual setup required" },
      };
    },
  },
  {
    name: "Complexity / scale expectations",
    weight: 1.1,
    score: (r) => {
      const c = r.estimatedComplexity;
      return {
        functions:      { value: c === "simple" ? 2 : c === "complex" ? -2 : 0, reason: `Complexity: ${c}` },
        "app-service":  { value: c === "moderate" ? 2 : 1, reason: `Complexity: ${c}` },
        "container-apps": { value: c === "moderate" ? 2 : c === "complex" ? 2 : 0, reason: `Complexity: ${c}` },
        aks:            { value: c === "complex" ? 3 : c === "simple" ? -2 : 0, reason: `Complexity: ${c}` },
        vm:             { value: c === "complex" ? 1 : 0, reason: `Complexity: ${c}` },
      };
    },
  },
  {
    name: "Database needs",
    weight: 0.7,
    score: (r) => {
      const hasDb = r.databases.detected;
      const hasState = hasDb || r.dependencies.notable.some((d) =>
        ["redis", "ioredis", "@azure/cosmos", "mongoose", "pg", "prisma", "@prisma/client"].includes(d),
      );
      return {
        functions:      { value: hasState ? -1 : 1, reason: hasState ? "Stateless preferred, needs external state" : "Stateless fits well" },
        "app-service":  { value: hasState ? 1 : 0, reason: hasState ? "Easy service connector support" : "N/A" },
        "container-apps": { value: hasState ? 1 : 0, reason: hasState ? "Service connector + Dapr state" : "N/A" },
        aks:            { value: hasState ? 2 : 0, reason: hasState ? "Can run databases in-cluster or connect" : "N/A" },
        vm:             { value: hasState ? 2 : 0, reason: hasState ? "Full control over data layer" : "N/A" },
      };
    },
  },
  {
    name: "Framework alignment",
    weight: 0.9,
    score: (r) => {
      const fw = r.framework;
      // Functions-native frameworks
      const functionsNative = fw === "none" || r.dependencies.notable.includes("@azure/functions");
      // PaaS-friendly frameworks
      const paasNative: Framework[] = ["express", "fastify", "nextjs", "remix", "nuxt", "django", "flask", "fastapi", "aspnet", "spring-boot", "rails", "laravel"];
      const isPaas = paasNative.includes(fw);

      return {
        functions:      { value: functionsNative ? 3 : isPaas ? 0 : -1, reason: functionsNative ? "Azure Functions SDK detected" : `Framework: ${fw}` },
        "app-service":  { value: isPaas ? 2 : 0, reason: isPaas ? "First-class framework support" : `Framework: ${fw}` },
        "container-apps": { value: 1, reason: "Any framework works in containers" },
        aks:            { value: 1, reason: "Any framework works in containers" },
        vm:             { value: 1, reason: "Any framework runs on VMs" },
      };
    },
  },
  {
    name: "Language runtime support",
    weight: 0.6,
    score: (r) => {
      const lang = r.primaryLanguage;
      // Functions supports: JS/TS, Python, C#, Java, Go (custom handler), Rust (custom)
      const functionsFirst = ["typescript", "javascript", "python", "csharp", "java"].includes(lang);
      // App Service supports all major languages natively
      const appServiceFirst = ["typescript", "javascript", "python", "csharp", "java", "ruby", "php"].includes(lang);

      return {
        functions:      { value: functionsFirst ? 2 : 0, reason: functionsFirst ? "First-class language support" : "Custom handler needed" },
        "app-service":  { value: appServiceFirst ? 2 : 0, reason: appServiceFirst ? "Native runtime" : "Custom container needed" },
        "container-apps": { value: 1, reason: "Any language in container" },
        aks:            { value: 1, reason: "Any language in container" },
        vm:             { value: 1, reason: "Any language" },
      };
    },
  },
];

// ── Pros/cons per platform ──────────────────────────────────────────

const PLATFORM_PROS: Record<Platform, string[]> = {
  functions: [
    "Pay-per-execution pricing (scale to zero)",
    "Built-in trigger bindings (HTTP, timer, queue, blob, etc.)",
    "Fastest time to deploy for simple workloads",
    "Automatic scaling",
  ],
  "app-service": [
    "Managed platform with deployment slots",
    "Built-in authentication, custom domains, SSL",
    "Supports most languages natively",
    "Easy CI/CD integration",
  ],
  "container-apps": [
    "Container-native with built-in scale-to-zero",
    "Dapr integration for microservices",
    "KEDA-based autoscaling",
    "No cluster management overhead",
  ],
  aks: [
    "Full Kubernetes orchestration",
    "Maximum flexibility and control",
    "Best for complex multi-service architectures",
    "Rich ecosystem of Helm charts and operators",
  ],
  vm: [
    "Full OS-level control",
    "Best for legacy or custom runtime applications",
    "GPU support for ML workloads",
    "No containerization required",
  ],
};

const PLATFORM_CONS: Record<Platform, string[]> = {
  functions: [
    "Cold start latency on consumption plan",
    "Execution time limits (5-10 min default)",
    "Limited to supported language runtimes",
    "Not ideal for stateful or long-running processes",
  ],
  "app-service": [
    "Always-on (no scale-to-zero on standard plans)",
    "Less flexible than containers for custom runtimes",
    "Scaling limited to plan tier",
  ],
  "container-apps": [
    "Newer service, smaller community",
    "Limited networking customization vs AKS",
    "Requires containerization",
  ],
  aks: [
    "Highest operational complexity",
    "Significant cost for cluster infrastructure",
    "Requires Kubernetes expertise",
    "Overkill for simple applications",
  ],
  vm: [
    "Full management responsibility (patching, updates)",
    "No auto-scaling without VMSS setup",
    "Highest operational burden",
    "Manual deployment pipeline required",
  ],
};

const SUGGESTED_SKU: Record<Platform, (r: AppAnalysisReport) => string> = {
  functions: (r) => r.estimatedComplexity === "complex" ? "Premium EP1" : "Consumption Y1",
  "app-service": (r) => r.estimatedComplexity === "complex" ? "P1v3" : r.estimatedComplexity === "moderate" ? "B2" : "B1",
  "container-apps": (r) => r.estimatedComplexity === "complex" ? "Dedicated D4 (workload profile)" : "Consumption",
  aks: (r) => r.estimatedComplexity === "complex" ? "Standard_D4s_v5 (3 nodes)" : "Standard_D2s_v5 (2 nodes)",
  vm: (r) => r.estimatedComplexity === "complex" ? "Standard_D4s_v5" : "Standard_B2s",
};

// ── Recommender ─────────────────────────────────────────────────────

export class Recommender {
  recommend(report: AppAnalysisReport): RecommendationResult {
    const platforms: Platform[] = ["functions", "app-service", "container-apps", "aks", "vm"];

    const scores: PlatformScore[] = platforms.map((platform) => {
      const breakdown: PlatformScore["breakdown"] = [];
      let totalScore = 0;

      for (const factor of FACTORS) {
        const result = factor.score(report);
        const platformResult = result[platform];
        const weighted = platformResult.value * factor.weight;
        totalScore += weighted;
        breakdown.push({
          factor: factor.name,
          score: Math.round(weighted * 10) / 10,
          reason: platformResult.reason,
        });
      }

      return {
        platform,
        score: Math.round(totalScore * 10) / 10,
        breakdown,
        pros: PLATFORM_PROS[platform],
        cons: PLATFORM_CONS[platform],
        suggestedSku: SUGGESTED_SKU[platform](report),
      };
    });

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);
    const topPick = scores[0].platform;

    // Build human-readable summary
    const top3 = scores.slice(0, 3);
    const summary = [
      `## Platform Recommendation for ${report.repoName}`,
      "",
      `**App type**: ${report.appType} | **Framework**: ${report.framework} | **Language**: ${report.primaryLanguage} | **Complexity**: ${report.estimatedComplexity}`,
      "",
      `### Top Pick: **${this.platformDisplayName(topPick)}** (score: ${scores[0].score})`,
      `SKU: ${scores[0].suggestedSku}`,
      "",
      "### Scoring Breakdown",
      "",
      "| Rank | Platform | Score | Suggested SKU |",
      "|------|----------|-------|---------------|",
      ...top3.map((s, i) =>
        `| ${i + 1} | ${this.platformDisplayName(s.platform)} | ${s.score} | ${s.suggestedSku} |`,
      ),
      "",
      `### Why ${this.platformDisplayName(topPick)}?`,
      "",
      "**Pros:**",
      ...scores[0].pros.map((p) => `- ${p}`),
      "",
      "**Cons:**",
      ...scores[0].cons.map((c) => `- ${c}`),
      "",
      "### Factor Details",
      "",
      "| Factor | Score | Reason |",
      "|--------|-------|--------|",
      ...scores[0].breakdown
        .filter((b) => b.score !== 0)
        .map((b) => `| ${b.factor} | ${b.score > 0 ? "+" : ""}${b.score} | ${b.reason} |`),
    ].join("\n");

    return { repoUrl: report.repoUrl, recommendations: scores, topPick, summary };
  }

  private platformDisplayName(p: Platform): string {
    const names: Record<Platform, string> = {
      functions: "Azure Functions",
      "app-service": "Azure App Service",
      "container-apps": "Azure Container Apps",
      aks: "Azure Kubernetes Service (AKS)",
      vm: "Azure Virtual Machines",
    };
    return names[p];
  }
}
