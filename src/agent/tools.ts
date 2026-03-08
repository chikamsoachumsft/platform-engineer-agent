import { defineTool, type Tool } from "@github/copilot-sdk";
import { z } from "zod/v4";
import { Analyzer } from "./analyzer.js";
import { Recommender } from "./recommender.js";
import { InfraGenerator } from "../infra-gen/generator.js";
import { Deployer } from "../azure/deployer.js";
import { MonitoringSetup } from "../monitoring/monitor.js";
import { RemediationGenerator } from "../github/remediation.js";
import { OidcOnboarding } from "../auth/oidc-onboarding.js";
import { Octokit } from "@octokit/rest";
import type { AppAnalysisReport } from "./types.js";
import type { GeneratedInfra } from "../infra-gen/generator.js";
import { store } from "./store.js";

// ── Shared state: cache analysis results so recommend_platform can use them ──
const analysisCache = new Map<string, AppAnalysisReport>();
const infraCache = new Map<string, GeneratedInfra>();
const analyzer = new Analyzer(process.env.GITHUB_TOKEN);
const recommender = new Recommender();
const infraGenerator = new InfraGenerator();
const deployer = new Deployer();
const monitoringSetup = new MonitoringSetup();
const remediationGen = new RemediationGenerator();
const oidcOnboarding = new OidcOnboarding();

/** Get a cached analysis (used by recommender and other tools) */
export function getCachedAnalysis(repoUrl: string): AppAnalysisReport | undefined {
  return analysisCache.get(repoUrl);
}

// ── Analyze Repository ──────────────────────────────────────────────
const analyzeRepoParams = z.object({
  repoUrl: z.string().describe("Full GitHub repository URL (e.g. https://github.com/owner/repo)"),
});

const analyzeRepo = defineTool("analyze_repo", {
  description:
    "Analyze a GitHub repository to detect language, framework, dependencies, Dockerfiles, database needs, and architectural patterns. Returns a structured analysis report.",
  parameters: analyzeRepoParams,
  handler: async (args) => {
    const report = await analyzer.analyze(args.repoUrl);
    analysisCache.set(args.repoUrl, report);
    return JSON.stringify(report, null, 2);
  },
});

// ── Recommend Platform ──────────────────────────────────────────────
const recommendPlatformParams = z.object({
  repoUrl: z.string().describe("GitHub repository URL that was previously analyzed"),
});

const recommendPlatform = defineTool("recommend_platform", {
  description:
    "Recommend the best Azure hosting platform (Functions, App Service, Container Apps, AKS, or VMs) based on a prior repository analysis. Returns a weighted scoring matrix.",
  parameters: recommendPlatformParams,
  handler: async (args) => {
    const report = analysisCache.get(args.repoUrl);
    if (!report) {
      return JSON.stringify({ error: "Repository not analyzed yet. Run analyze_repo first." });
    }
    const result = recommender.recommend(report);
    return result.summary;
  },
});

// ── Generate Infrastructure ─────────────────────────────────────────
const generateInfraParams = z.object({
  repoUrl: z.string().describe("GitHub repository URL"),
  platform: z
    .enum(["functions", "app-service", "container-apps", "aks", "vm"])
    .describe("Target Azure hosting platform"),
  region: z.string().optional().describe("Azure region (defaults to eastus2)"),
  resourceGroupName: z.string().optional().describe("Azure resource group name"),
});

const generateInfra = defineTool("generate_infra", {
  description:
    "Generate Bicep infrastructure-as-code templates for deploying the application to the selected Azure platform. Returns the generated file paths.",
  parameters: generateInfraParams,
  handler: async (args) => {
    const report = analysisCache.get(args.repoUrl);
    if (!report) {
      return JSON.stringify({ error: "Repository not analyzed yet. Run analyze_repo first." });
    }
    const recResult = recommender.recommend(report);
    const selected = recResult.recommendations.find((r) => r.platform === args.platform)
      ?? recResult.recommendations[0];
    const infra = await infraGenerator.generate(
      report,
      selected,
      args.region ?? "eastus2",
      args.resourceGroupName,
    );
    infraCache.set(args.repoUrl, infra);
    return infra.summary;
  },
});

// ── Deploy ──────────────────────────────────────────────────────────
const deployParams = z.object({
  repoUrl: z.string().describe("GitHub repository URL"),
  subscriptionId: z.string().describe("Azure subscription ID"),
  resourceGroupName: z.string().describe("Azure resource group name"),
  region: z.string().optional().describe("Azure region (defaults to eastus2)"),
});

const deploy = defineTool("deploy", {
  description:
    "Deploy the application to Azure using previously generated Bicep templates. Provisions resources and deploys the code. Requires Azure subscription and resource group.",
  parameters: deployParams,
  handler: async (args) => {
    const infra = infraCache.get(args.repoUrl);
    if (!infra) {
      return JSON.stringify({ error: "Infrastructure not generated yet. Run generate_infra first." });
    }
    const report = analysisCache.get(args.repoUrl);
    const recResult = report ? recommender.recommend(report) : undefined;
    const deployId = `dep-${Date.now()}`;
    store.addDeployment({
      id: deployId,
      repoUrl: args.repoUrl,
      platform: recResult?.topPick ?? "app-service",
      subscriptionId: args.subscriptionId,
      resourceGroupName: args.resourceGroupName,
      region: args.region ?? "eastus2",
      status: "deploying",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      outputs: {},
    });
    const result = await deployer.deploy({
      subscriptionId: args.subscriptionId,
      resourceGroupName: args.resourceGroupName,
      region: args.region ?? "eastus2",
      infra,
    });
    store.updateDeployment(deployId, {
      status: result.status,
      outputs: result.outputs,
      error: result.error,
    });
    return result.summary;
  },
});

// ── Setup Monitoring ────────────────────────────────────────────────
const setupMonitoringParams = z.object({
  resourceGroupName: z.string().describe("Azure resource group of the deployed app"),
  subscriptionId: z.string().describe("Azure subscription ID"),
  repoUrl: z.string().describe("GitHub repository URL (used to determine platform and app name)"),
  notificationEmail: z.string().optional().describe("Email address for alert notifications"),
});

const setupMonitoring = defineTool("setup_monitoring", {
  description:
    "Set up Azure Monitor, Application Insights, alerts, and a dashboard for the deployed application. Returns the dashboard URL and configured alert rules.",
  parameters: setupMonitoringParams,
  handler: async (args) => {
    const report = analysisCache.get(args.repoUrl);
    if (!report) {
      return JSON.stringify({ error: "Repository not analyzed yet. Run analyze_repo first." });
    }
    const recResult = recommender.recommend(report);
    const appName = report.repoName.split("/").pop() ?? "app";
    const result = await monitoringSetup.setup({
      subscriptionId: args.subscriptionId,
      resourceGroupName: args.resourceGroupName,
      platform: recResult.topPick,
      appName,
      notificationEmail: args.notificationEmail,
    });
    return result.summary;
  },
});

// ── Setup Auto-Remediation ──────────────────────────────────────────
const setupRemediationParams = z.object({
  repoUrl: z.string().describe("GitHub repository URL to install monitoring workflows"),
  resourceGroupName: z.string().describe("Azure resource group to monitor"),
  subscriptionId: z.string().describe("Azure subscription ID"),
  region: z.string().optional().describe("Azure region (defaults to eastus2)"),
});

const setupRemediation = defineTool("setup_remediation", {
  description:
    "Install GitHub Actions workflows for continuous monitoring and auto-remediation. Includes health checks, cost reporting, drift detection, and auto-scaling with approval gates for destructive actions.",
  parameters: setupRemediationParams,
  handler: async (args) => {
    const report = analysisCache.get(args.repoUrl);
    if (!report) {
      return JSON.stringify({ error: "Repository not analyzed yet. Run analyze_repo first." });
    }
    const recResult = recommender.recommend(report);
    const appName = report.repoName.split("/").pop() ?? "app";
    const result = remediationGen.generate({
      repoUrl: args.repoUrl,
      platform: recResult.topPick,
      resourceGroupName: args.resourceGroupName,
      subscriptionId: args.subscriptionId,
      region: args.region ?? "eastus2",
      appName,
    });
    return result.summary;
  },
});

// ── Check Deployment Status ─────────────────────────────────────────
const checkStatusParams = z.object({
  resourceGroupName: z.string().describe("Azure resource group name"),
  subscriptionId: z.string().describe("Azure subscription ID"),
});

const checkStatus = defineTool("check_deployment_status", {
  description:
    "Check the health and status of a deployed application. Returns resource status, active alerts, and key metrics.",
  parameters: checkStatusParams,
  handler: async (args) => {
    const result = await monitoringSetup.checkHealth(
      args.subscriptionId,
      args.resourceGroupName,
    );
    return result;
  },
});

// ── Setup Azure OIDC ────────────────────────────────────────────────
const setupAzureParams = z.object({
  repoUrl: z.string().describe("GitHub repository URL (e.g. https://github.com/owner/repo)"),
  subscriptionId: z.string().describe("Azure subscription ID (UUID format, e.g. 12345678-abcd-1234-abcd-1234567890ab)"),
  githubToken: z.string().optional().describe("GitHub personal access token (if not using GitHub App installation)"),
});

const setupAzure = defineTool("setup_azure", {
  description:
    "Connect a GitHub repository to Azure by creating an Entra App Registration with OIDC federated credentials. " +
    "This enables all monitoring and remediation workflows to authenticate to Azure without storing any long-lived secrets. " +
    "Creates: Entra App, service principal, OIDC trust, Contributor role assignment, and stores AZURE_CLIENT_ID/TENANT_ID/SUBSCRIPTION_ID as repo secrets.",
  parameters: setupAzureParams,
  handler: async (args) => {
    // Extract owner/repo from URL
    const urlMatch = args.repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
    if (!urlMatch) {
      return JSON.stringify({ error: "Invalid GitHub URL. Expected format: https://github.com/owner/repo" });
    }
    const repoFullName = urlMatch[1].replace(/\.git$/, "");

    // Validate subscription ID format
    if (!/^[a-f0-9-]{36}$/i.test(args.subscriptionId)) {
      return JSON.stringify({ error: "Invalid subscription ID format. Expected a UUID like 12345678-abcd-1234-abcd-1234567890ab" });
    }

    // Create Octokit — prefer GitHub App installation, fall back to PAT
    let octokit: Octokit;
    if (args.githubToken) {
      octokit = new Octokit({ auth: args.githubToken });
    } else if (process.env.GITHUB_TOKEN) {
      octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    } else {
      return JSON.stringify({
        error: "No GitHub token available. Please provide a githubToken parameter or set GITHUB_TOKEN env var.",
      });
    }

    // Check if already onboarded
    const [owner, repo] = repoFullName.split("/");
    const already = await oidcOnboarding.isAlreadyOnboarded(octokit, owner, repo);
    if (already) {
      return JSON.stringify({
        status: "already_configured",
        message: `${repoFullName} already has Azure OIDC secrets configured. No action needed.`,
      });
    }

    const result = await oidcOnboarding.onboard(
      { repoFullName, subscriptionId: args.subscriptionId, installationId: 0 },
      octokit,
    );

    return result.summary;
  },
});

/** All agent tools — registered with each Copilot session */
export const agentTools: Tool<any>[] = [
  analyzeRepo,
  recommendPlatform,
  generateInfra,
  deploy,
  setupMonitoring,
  setupRemediation,
  checkStatus,
  setupAzure,
];
