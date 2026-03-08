import { execFile } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ResourceManagementClient } from "@azure/arm-resources";
import { DefaultAzureCredential } from "@azure/identity";
import type { GeneratedInfra } from "../infra-gen/generator.js";

// ── Types ───────────────────────────────────────────────────────────

export interface DeployRequest {
  subscriptionId: string;
  resourceGroupName: string;
  region: string;
  infra: GeneratedInfra;
}

export interface DeployResult {
  status: "succeeded" | "failed";
  resourceGroupName: string;
  subscriptionId: string;
  region: string;
  outputs: Record<string, string>;
  deploymentName: string;
  summary: string;
  error?: string;
}

// ── Deployer ────────────────────────────────────────────────────────

export class Deployer {
  private credential = new DefaultAzureCredential();

  /**
   * Deploy generated Bicep infrastructure to Azure.
   * 1. Ensures the resource group exists
   * 2. Writes Bicep files to a temp directory
   * 3. Runs `az deployment group create` with the main template
   * 4. Returns deployment result with outputs
   */
  async deploy(req: DeployRequest): Promise<DeployResult> {
    const deploymentName = `pe-agent-${Date.now()}`;
    const workDir = path.join(tmpdir(), `pe-deploy-${randomUUID()}`);

    try {
      // 1. Ensure resource group exists
      await this.ensureResourceGroup(req.subscriptionId, req.resourceGroupName, req.region);

      // 2. Write Bicep files to temp workspace
      await mkdir(path.join(workDir, "modules"), { recursive: true });
      await Promise.all([
        writeFile(path.join(workDir, "main.bicep"), req.infra.mainBicep, "utf-8"),
        writeFile(path.join(workDir, "modules", "monitoring.bicep"), req.infra.monitoringBicep, "utf-8"),
      ]);

      // 3. Deploy via az CLI
      const outputs = await this.runAzDeployment(
        req.subscriptionId,
        req.resourceGroupName,
        workDir,
        deploymentName,
      );

      return {
        status: "succeeded",
        resourceGroupName: req.resourceGroupName,
        subscriptionId: req.subscriptionId,
        region: req.region,
        outputs,
        deploymentName,
        summary: this.buildSummary("succeeded", req, deploymentName, outputs),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: "failed",
        resourceGroupName: req.resourceGroupName,
        subscriptionId: req.subscriptionId,
        region: req.region,
        outputs: {},
        deploymentName,
        summary: this.buildSummary("failed", req, deploymentName, {}, message),
        error: message,
      };
    } finally {
      // Clean up temp directory
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Create or verify existence of the target resource group.
   */
  private async ensureResourceGroup(
    subscriptionId: string,
    resourceGroupName: string,
    location: string,
  ): Promise<void> {
    const client = new ResourceManagementClient(this.credential, subscriptionId);
    await client.resourceGroups.createOrUpdate(resourceGroupName, { location });
  }

  /**
   * Shell out to `az deployment group create` to deploy the Bicep template.
   * Returns deployment outputs as key-value pairs.
   */
  private runAzDeployment(
    subscriptionId: string,
    resourceGroupName: string,
    workDir: string,
    deploymentName: string,
  ): Promise<Record<string, string>> {
    const templateFile = path.join(workDir, "main.bicep");
    const args = [
      "deployment",
      "group",
      "create",
      "--subscription", subscriptionId,
      "--resource-group", resourceGroupName,
      "--name", deploymentName,
      "--template-file", templateFile,
      "--output", "json",
      "--no-prompt",
    ];

    return new Promise((resolve, reject) => {
      execFile("az", args, { timeout: 600_000, maxBuffer: 5 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          const detail = stderr || error.message;
          reject(new Error(`az deployment failed: ${detail}`));
          return;
        }
        try {
          const result = JSON.parse(stdout);
          const outputs: Record<string, string> = {};
          if (result.properties?.outputs) {
            for (const [key, val] of Object.entries(result.properties.outputs)) {
              outputs[key] = (val as { value: string }).value;
            }
          }
          resolve(outputs);
        } catch {
          // Deployment succeeded but output wasn't parseable — still ok
          resolve({});
        }
      });
    });
  }

  private buildSummary(
    status: "succeeded" | "failed",
    req: DeployRequest,
    deploymentName: string,
    outputs: Record<string, string>,
    error?: string,
  ): string {
    const lines = [
      `## Deployment ${status === "succeeded" ? "Succeeded ✅" : "Failed ❌"}`,
      "",
      `| Field | Value |`,
      `|---|---|`,
      `| Deployment Name | ${deploymentName} |`,
      `| Subscription | ${req.subscriptionId} |`,
      `| Resource Group | ${req.resourceGroupName} |`,
      `| Region | ${req.region} |`,
    ];

    if (status === "succeeded" && Object.keys(outputs).length > 0) {
      lines.push("", "### Outputs");
      for (const [key, value] of Object.entries(outputs)) {
        lines.push(`- **${key}**: ${value}`);
      }
    }

    if (error) {
      lines.push("", "### Error", `\`\`\`\n${error}\n\`\`\``);
    }

    return lines.join("\n");
  }
}
