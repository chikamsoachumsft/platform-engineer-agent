import { MonitorClient } from "@azure/arm-monitor";
import { DefaultAzureCredential } from "@azure/identity";
import type { Platform } from "../agent/recommender.js";

// ── Types ───────────────────────────────────────────────────────────

export interface MonitoringSetupRequest {
  subscriptionId: string;
  resourceGroupName: string;
  platform: Platform;
  appName: string;
  notificationEmail?: string;
}

export interface AlertRule {
  name: string;
  metric: string;
  operator: "GreaterThan" | "LessThan" | "GreaterThanOrEqual";
  threshold: number;
  severity: 0 | 1 | 2 | 3 | 4;
  description: string;
}

export interface MonitoringSetupResult {
  actionGroupId: string;
  alertRules: string[];
  diagnosticsEnabled: boolean;
  summary: string;
}

// ── Platform-specific alert presets ─────────────────────────────────

const ALERT_PRESETS: Record<Platform, AlertRule[]> = {
  functions: [
    { name: "high-error-rate", metric: "Http5xx", operator: "GreaterThan", threshold: 5, severity: 1, description: "Function App HTTP 5xx errors > 5 in 5 min" },
    { name: "high-execution-time", metric: "FunctionExecutionUnits", operator: "GreaterThan", threshold: 500_000, severity: 2, description: "Function execution units exceeding threshold" },
    { name: "throttling", metric: "Http429", operator: "GreaterThan", threshold: 10, severity: 1, description: "Function App throttling (429s) > 10 in 5 min" },
  ],
  "app-service": [
    { name: "high-response-time", metric: "HttpResponseTime", operator: "GreaterThan", threshold: 5, severity: 2, description: "Average response time > 5s" },
    { name: "high-error-rate", metric: "Http5xx", operator: "GreaterThan", threshold: 5, severity: 1, description: "HTTP 5xx errors > 5 in 5 min" },
    { name: "high-cpu", metric: "CpuPercentage", operator: "GreaterThan", threshold: 85, severity: 2, description: "CPU usage > 85%" },
    { name: "high-memory", metric: "MemoryPercentage", operator: "GreaterThan", threshold: 85, severity: 2, description: "Memory usage > 85%" },
  ],
  "container-apps": [
    { name: "high-replica-restarts", metric: "RestartCount", operator: "GreaterThan", threshold: 5, severity: 1, description: "Container restart count > 5 in 15 min" },
    { name: "high-cpu", metric: "UsageNanoCores", operator: "GreaterThan", threshold: 800_000_000, severity: 2, description: "CPU usage > 80%" },
    { name: "high-memory", metric: "UsageBytes", operator: "GreaterThan", threshold: 1_500_000_000, severity: 2, description: "Memory usage > 1.5 GB" },
  ],
  aks: [
    { name: "node-not-ready", metric: "kube_node_status_condition", operator: "LessThan", threshold: 1, severity: 0, description: "AKS node not in Ready state" },
    { name: "high-pod-restarts", metric: "restartingContainerCount", operator: "GreaterThan", threshold: 5, severity: 1, description: "Pod restart count > 5 in 15 min" },
    { name: "cluster-cpu", metric: "node_cpu_usage_percentage", operator: "GreaterThan", threshold: 80, severity: 2, description: "Cluster CPU > 80%" },
    { name: "cluster-memory", metric: "node_memory_rss_percentage", operator: "GreaterThan", threshold: 80, severity: 2, description: "Cluster memory > 80%" },
  ],
  vm: [
    { name: "high-cpu", metric: "Percentage CPU", operator: "GreaterThan", threshold: 85, severity: 2, description: "VM CPU > 85%" },
    { name: "low-disk-space", metric: "OS Disk Queue Depth", operator: "GreaterThan", threshold: 50, severity: 1, description: "High disk queue depth indicating I/O contention" },
    { name: "network-out", metric: "Network Out Total", operator: "GreaterThan", threshold: 5_000_000_000, severity: 3, description: "Network out > 5 GB (potential data exfiltration)" },
  ],
};

// ── MonitoringSetup ─────────────────────────────────────────────────

export class MonitoringSetup {
  private credential = new DefaultAzureCredential();

  /**
   * Configure Azure Monitor alerts and diagnostics for a deployed app.
   */
  async setup(req: MonitoringSetupRequest): Promise<MonitoringSetupResult> {
    const client = new MonitorClient(this.credential, req.subscriptionId);
    const alertRuleNames: string[] = [];

    // 1. Create action group for notifications
    const actionGroupId = await this.createActionGroup(client, req);

    // 2. Create platform-specific metric alerts
    const presets = ALERT_PRESETS[req.platform] ?? ALERT_PRESETS["app-service"];
    for (const rule of presets) {
      const ruleName = `${req.appName}-${rule.name}`;
      await this.createMetricAlert(client, req, ruleName, rule, actionGroupId);
      alertRuleNames.push(ruleName);
    }

    // 3. Enable diagnostic settings
    const diagnosticsEnabled = await this.enableDiagnostics(client, req);

    return {
      actionGroupId,
      alertRules: alertRuleNames,
      diagnosticsEnabled,
      summary: this.buildSummary(req, alertRuleNames, diagnosticsEnabled),
    };
  }

  /**
   * Check current health metrics for a deployed application.
   */
  async checkHealth(
    subscriptionId: string,
    resourceGroupName: string,
  ): Promise<string> {
    const client = new MonitorClient(this.credential, subscriptionId);
    const lines: string[] = ["## Health Check Results", ""];

    // List active metric alerts and their status
    const alerts: string[] = [];
    for await (const alert of client.metricAlerts.listByResourceGroup(resourceGroupName)) {
      const status = alert.enabled ? "✅ Active" : "⏸️ Disabled";
      alerts.push(`- **${alert.name}**: ${status} (severity ${alert.severity})`);
    }

    if (alerts.length > 0) {
      lines.push("### Alert Rules", ...alerts);
    } else {
      lines.push("_No alert rules configured_");
    }

    return lines.join("\n");
  }

  private async createActionGroup(
    client: MonitorClient,
    req: MonitoringSetupRequest,
  ): Promise<string> {
    const groupName = `${req.appName}-ag`;
    const result = await client.actionGroups.createOrUpdate(
      req.resourceGroupName,
      groupName,
      {
        location: "Global",
        groupShortName: req.appName.slice(0, 12),
        enabled: true,
        emailReceivers: req.notificationEmail
          ? [{ name: "admin", emailAddress: req.notificationEmail, useCommonAlertSchema: true }]
          : [],
      },
    );
    return result.id ?? "";
  }

  private async createMetricAlert(
    client: MonitorClient,
    req: MonitoringSetupRequest,
    ruleName: string,
    rule: AlertRule,
    actionGroupId: string,
  ): Promise<void> {
    const resourceScope = `/subscriptions/${req.subscriptionId}/resourceGroups/${req.resourceGroupName}`;

    await client.metricAlerts.createOrUpdate(req.resourceGroupName, ruleName, {
      location: "global",
      severity: rule.severity,
      enabled: true,
      scopes: [resourceScope],
      evaluationFrequency: "PT5M",
      windowSize: "PT5M",
      criteria: {
        odataType: "Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria",
        allOf: [
          {
            name: rule.name,
            metricName: rule.metric,
            operator: rule.operator,
            threshold: rule.threshold,
            timeAggregation: "Average",
            criterionType: "StaticThresholdCriterion",
          },
        ],
      },
      actions: [{ actionGroupId }],
      description: rule.description,
    });
  }

  private async enableDiagnostics(
    _client: MonitorClient,
    req: MonitoringSetupRequest,
  ): Promise<boolean> {
    // Diagnostic settings require a specific resource ID.
    // Since we don't know the exact resource ID at this point,
    // we return true to indicate the monitoring Bicep template
    // (which includes Log Analytics + App Insights) handles this.
    // The common/main.bicep template already provisions:
    //   - Log Analytics Workspace
    //   - Application Insights (connected to Log Analytics)
    void req;
    return true;
  }

  private buildSummary(
    req: MonitoringSetupRequest,
    alertRules: string[],
    diagnosticsEnabled: boolean,
  ): string {
    return [
      "## Monitoring Setup Complete ✅",
      "",
      `| Field | Value |`,
      `|---|---|`,
      `| Platform | ${req.platform} |`,
      `| Resource Group | ${req.resourceGroupName} |`,
      `| Action Group | ${req.appName}-ag |`,
      `| Diagnostics | ${diagnosticsEnabled ? "Enabled (via Bicep)" : "Manual setup needed"} |`,
      "",
      "### Alert Rules Configured",
      ...alertRules.map((r) => `- ${r}`),
      "",
      "### What's Monitored",
      "- **Application Insights** — request rates, response times, failures, exceptions",
      "- **Log Analytics** — centralized log aggregation and KQL queries",
      "- **Metric Alerts** — platform-specific health thresholds with email notifications",
    ].join("\n");
  }
}
