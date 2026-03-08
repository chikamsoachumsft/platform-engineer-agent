import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AppAnalysisReport } from "../agent/types.js";
import type { Platform, PlatformScore } from "../agent/recommender.js";

// ── Template context passed to Bicep templates ──────────────────────

export interface InfraContext {
  appName: string;
  region: string;
  resourceGroupName: string;
  platform: Platform;
  sku: string;
  language: string;
  framework: string;
  ports: number[];
  hasDatabase: boolean;
  databaseTypes: string[];
  hasDockerfile: boolean;
  baseImage: string | null;
  isContainerized: boolean;
}

export interface GeneratedInfra {
  /** Platform-specific main.bicep content */
  mainBicep: string;
  /** Shared monitoring module */
  monitoringBicep: string;
  /** azure.yaml content for azd */
  azureYaml: string;
  /** Summary of what was generated */
  summary: string;
}

// Resolve template directory relative to this file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_DIR = path.join(__dirname, "templates");

export class InfraGenerator {
  /**
   * Generate Bicep infrastructure for a given analysis + platform selection.
   */
  async generate(
    report: AppAnalysisReport,
    recommendation: PlatformScore,
    region: string = "eastus2",
    resourceGroupName?: string,
  ): Promise<GeneratedInfra> {
    const appName = this.sanitizeName(report.repoName.split("/").pop() ?? "app");
    const rgName = resourceGroupName ?? `rg-${appName}`;
    const ctx: InfraContext = {
      appName,
      region,
      resourceGroupName: rgName,
      platform: recommendation.platform,
      sku: recommendation.suggestedSku,
      language: report.primaryLanguage,
      framework: report.framework,
      ports: report.detectedPorts.length > 0 ? report.detectedPorts : [8080],
      hasDatabase: report.databases.detected,
      databaseTypes: report.databases.types,
      hasDockerfile: report.container.hasDockerfile,
      baseImage: report.container.baseImage,
      isContainerized: report.container.hasDockerfile,
    };

    // Load templates
    const [mainBicep, monitoringBicep] = await Promise.all([
      this.loadAndRender(recommendation.platform, ctx),
      this.loadAndRender("common", ctx),
    ]);

    const azureYaml = this.generateAzureYaml(ctx);

    const summary = [
      `## Generated Infrastructure`,
      "",
      `**Platform**: ${recommendation.platform} | **SKU**: ${recommendation.suggestedSku} | **Region**: ${region}`,
      `**Resource Group**: ${rgName}`,
      "",
      "### Files Generated",
      "- `infra/main.bicep` — Platform-specific resources",
      "- `infra/modules/monitoring.bicep` — Application Insights + Log Analytics",
      "- `azure.yaml` — Azure Developer CLI config",
      "",
      "### Resources That Will Be Provisioned",
      ...this.listResources(ctx),
    ].join("\n");

    return { mainBicep, monitoringBicep, azureYaml, summary };
  }

  private async loadAndRender(templateName: string, ctx: InfraContext): Promise<string> {
    const templatePath = path.join(TEMPLATES_DIR, templateName, "main.bicep");
    let template = await readFile(templatePath, "utf-8");
    return this.interpolate(template, ctx);
  }

  /** Simple {{variable}} interpolation */
  private interpolate(template: string, ctx: InfraContext): string {
    return template
      .replace(/\{\{appName\}\}/g, ctx.appName)
      .replace(/\{\{region\}\}/g, ctx.region)
      .replace(/\{\{resourceGroupName\}\}/g, ctx.resourceGroupName)
      .replace(/\{\{sku\}\}/g, ctx.sku)
      .replace(/\{\{language\}\}/g, ctx.language)
      .replace(/\{\{framework\}\}/g, ctx.framework)
      .replace(/\{\{port\}\}/g, String(ctx.ports[0] ?? 8080))
      .replace(/\{\{baseImage\}\}/g, ctx.baseImage ?? "mcr.microsoft.com/devcontainers/javascript-node:20");
  }

  private generateAzureYaml(ctx: InfraContext): string {
    const serviceType = {
      functions: "function",
      "app-service": "web",
      "container-apps": "containerapp",
      aks: "aks",
      vm: "vm",
    }[ctx.platform] ?? "web";

    return [
      `name: ${ctx.appName}`,
      `metadata:`,
      `  template: platform-engineer-agent@0.1.0`,
      ``,
      `services:`,
      `  ${ctx.appName}:`,
      `    project: .`,
      `    language: ${ctx.language}`,
      `    host: ${serviceType}`,
      "",
    ].join("\n");
  }

  private listResources(ctx: InfraContext): string[] {
    const common = [
      "- Application Insights",
      "- Log Analytics Workspace",
      "- Managed Identity",
    ];

    const platformResources: Record<Platform, string[]> = {
      functions: [
        "- Function App",
        "- App Service Plan (Consumption/Premium)",
        "- Storage Account",
      ],
      "app-service": [
        "- App Service Plan",
        "- Web App",
      ],
      "container-apps": [
        "- Container Apps Environment",
        "- Container App",
        "- Container Registry",
      ],
      aks: [
        "- AKS Cluster",
        "- Container Registry",
        "- Node Pool",
      ],
      vm: [
        "- Virtual Machine",
        "- Network Interface",
        "- Network Security Group",
        "- Virtual Network + Subnet",
        "- Public IP Address",
      ],
    };

    return [...common, ...platformResources[ctx.platform]];
  }

  private sanitizeName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 24);
  }
}
