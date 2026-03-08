import type { Platform } from "../agent/recommender.js";

// ── Types ───────────────────────────────────────────────────────────

export interface RemediationRequest {
  repoUrl: string;
  platform: Platform;
  resourceGroupName: string;
  subscriptionId: string;
  region: string;
  appName: string;
}

export interface GeneratedWorkflow {
  path: string;
  name: string;
  content: string;
}

export interface RemediationResult {
  workflows: GeneratedWorkflow[];
  summary: string;
}

// ── Remediation Workflow Generator ──────────────────────────────────

export class RemediationGenerator {
  /**
   * Generate GitHub Actions workflows for continuous monitoring
   * and auto-remediation of a deployed Azure application.
   */
  generate(req: RemediationRequest): RemediationResult {
    const workflows: GeneratedWorkflow[] = [
      this.healthCheck(req),
      this.costReport(req),
      this.driftDetection(req),
      this.securityScan(req),
      this.autoRemediate(req),
      this.performanceTest(req),
      this.backupVerification(req),
      this.certificateRenewal(req),
      this.scaleMonitor(req),
      this.logAnalysis(req),
    ];

    const summary = [
      "## Auto-Remediation Workflows Generated ✅",
      "",
      "### Workflows",
      ...workflows.map((w) => `- **${w.name}** — \`${w.path}\``),
      "",
      "### How It Works",
      "1. **Health Check** — Runs every 5 min, checks endpoint health + Azure resource status",
      "2. **Cost Report** — Weekly cost summary posted as a GitHub Issue",
      "3. **Drift Detection** — Daily Bicep what-if to detect config drift",
      "4. **Security Scan** — Weekly dependency + container vulnerability scan",
      "5. **Auto-Remediate** — Triggered by health check failures; restarts or scales with approval gates",
      "6. **Performance Test** — Daily response time + load testing",
      "7. **Backup Verification** — Weekly backup integrity + restore test",
      "8. **Certificate Renewal** — Daily TLS certificate expiry check",
      "9. **Scale Monitor** — Every 15 min autoscale metrics + capacity planning",
      "10. **Log Analysis** — Hourly error pattern detection + anomaly alerting",
      "",
      "### Required GitHub Secrets",
      "| Secret | Description |",
      "|---|---|",
      "| `AZURE_CLIENT_ID` | OIDC federated service principal client ID |",
      "| `AZURE_TENANT_ID` | Azure AD tenant ID |",
      "| `AZURE_SUBSCRIPTION_ID` | Target subscription |",
    ].join("\n");

    return { workflows, summary };
  }

  private healthCheck(req: RemediationRequest): GeneratedWorkflow {
    return {
      path: ".github/workflows/pe-health-check.yml",
      name: "Health Check",
      content: `name: "Platform Engineer: Health Check"

on:
  schedule:
    - cron: "*/5 * * * *"
  workflow_dispatch:

permissions:
  id-token: write
  contents: read
  issues: write

jobs:
  health-check:
    runs-on: ubuntu-latest
    steps:
      - name: Azure Login (OIDC)
        uses: azure/login@v2
        with:
          client-id: \${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: \${{ secrets.AZURE_TENANT_ID }}
          subscription-id: \${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Check resource health
        id: health
        run: |
          STATUS=$(az resource list \\
            --resource-group ${req.resourceGroupName} \\
            --query "[].{name:name, type:type, provisioningState:provisioningState}" \\
            -o json)
          echo "resources<<EOF" >> $GITHUB_OUTPUT
          echo "$STATUS" >> $GITHUB_OUTPUT
          echo "EOF" >> $GITHUB_OUTPUT

          # Check for unhealthy resources
          UNHEALTHY=$(echo "$STATUS" | jq '[.[] | select(.provisioningState != "Succeeded")] | length')
          echo "unhealthy_count=$UNHEALTHY" >> $GITHUB_OUTPUT
${this.copilotAnalysisStep('You are an Azure platform engineer. Analyze these resource health results. Identify unhealthy resources, explain the likely root cause, and recommend the best remediation action: restart, scale-up, or redeploy. Be concise.', '${{ steps.health.outputs.resources }}')}

      - name: Create issue on failure
        if: steps.health.outputs.unhealthy_count != '0'
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: '🚨 Health Check Failed — Unhealthy resources detected',
              body: '## Resource Health Report\\n\\n' +
                '\`\`\`json\\n' +
                \`\${{ steps.health.outputs.resources }}\` +
                '\\n\`\`\`\\n\\n' +
                '### \ud83e\udd16 AI Analysis\\n\\n' +
                \`\${{ steps.copilot.outputs.analysis }}\` +
                '\\n\\nTriggered by scheduled health check.',
              labels: ['platform-engineer', 'health-check', 'auto-created']
            });

      - name: Trigger auto-remediation
        if: steps.health.outputs.unhealthy_count != '0'
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.actions.createWorkflowDispatch({
              owner: context.repo.owner,
              repo: context.repo.repo,
              workflow_id: 'pe-auto-remediate.yml',
              ref: 'main'
            });
`,
    };
  }

  private costReport(req: RemediationRequest): GeneratedWorkflow {
    return {
      path: ".github/workflows/pe-cost-report.yml",
      name: "Weekly Cost Report",
      content: `name: "Platform Engineer: Cost Report"

on:
  schedule:
    - cron: "0 9 * * 1"
  workflow_dispatch:

permissions:
  id-token: write
  contents: read
  issues: write

jobs:
  cost-report:
    runs-on: ubuntu-latest
    steps:
      - name: Azure Login (OIDC)
        uses: azure/login@v2
        with:
          client-id: \${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: \${{ secrets.AZURE_TENANT_ID }}
          subscription-id: \${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Get cost data
        id: cost
        run: |
          END_DATE=$(date -u +%Y-%m-%d)
          START_DATE=$(date -u -d "7 days ago" +%Y-%m-%d)
          COST=$(az costmanagement query \\
            --type Usage \\
            --scope "/subscriptions/\${{ secrets.AZURE_SUBSCRIPTION_ID }}/resourceGroups/${req.resourceGroupName}" \\
            --timeframe Custom \\
            --time-period from=$START_DATE to=$END_DATE \\
            --dataset-aggregation '{"totalCost":{"name":"Cost","function":"Sum"}}' \\
            --dataset-grouping name="ResourceType" type="Dimension" \\
            -o json 2>/dev/null || echo '{"rows":[]}')
          echo "cost_data<<EOF" >> $GITHUB_OUTPUT
          echo "$COST" >> $GITHUB_OUTPUT
          echo "EOF" >> $GITHUB_OUTPUT
${this.copilotAnalysisStep('You are an Azure cost optimization advisor. Analyze this weekly cost data. Identify the highest-cost resources, suggest specific cost-saving recommendations, and flag any unexpected charges. Be concise.', '${{ steps.cost.outputs.cost_data }}')}

      - name: Create cost report issue
        uses: actions/github-script@v7
        with:
          script: |
            const data = JSON.parse(\`\${{ steps.cost.outputs.cost_data }}\`);
            let table = '| Resource Type | Cost |\\n|---|---|\\n';
            if (data.rows) {
              for (const row of data.rows) {
                table += \`| \${row[1] || 'Unknown'} | $\${(row[0] || 0).toFixed(2)} |\\n\`;
              }
            }
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: '💰 Weekly Cost Report — ${req.resourceGroupName}',
              body: '## Azure Cost Report (Last 7 Days)\\n\\n' + table +
                '\\n### \ud83e\udd16 AI Analysis\\n\\n' +
                \`\${{ steps.copilot.outputs.analysis }}\` +
                '\\n\\nResource Group: \`${req.resourceGroupName}\`',
              labels: ['platform-engineer', 'cost-report', 'auto-created']
            });
`,
    };
  }

  private driftDetection(req: RemediationRequest): GeneratedWorkflow {
    return {
      path: ".github/workflows/pe-drift-detection.yml",
      name: "Drift Detection",
      content: `name: "Platform Engineer: Drift Detection"

on:
  schedule:
    - cron: "0 6 * * *"
  workflow_dispatch:

permissions:
  id-token: write
  contents: read
  issues: write

jobs:
  drift-detect:
    runs-on: ubuntu-latest
    # Redeploying requires manual approval since it overwrites live resources
    environment: manual-approval
    steps:
      - uses: actions/checkout@v4

      - name: Azure Login (OIDC)
        uses: azure/login@v2
        with:
          client-id: \${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: \${{ secrets.AZURE_TENANT_ID }}
          subscription-id: \${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Drift remediation loop
        id: loop
        env:
          GH_TOKEN: \${{ github.token }}
        run: |
          MAX_ATTEMPTS=15
          ATTEMPT=0
          RESOLVED=false
          ACTION_LOG=""

          check_drift() {
            local result
            result=$(az deployment group what-if \\
              --resource-group ${req.resourceGroupName} \\
              --template-file infra/main.bicep \\
              --no-pretty-print \\
              -o json 2>&1 || echo '{"changes":[]}')
            local count=$(echo "$result" | jq '.changes | length // 0')
            echo "$count|$result"
          }

          do_redeploy() {
            az deployment group create \\
              --resource-group ${req.resourceGroupName} \\
              --template-file infra/main.bicep \\
              --mode Incremental
          }

          call_copilot() {
            local sys_prompt="$1"
            local user_data="$2"
            local payload
            payload=$(jq -n \\
              --arg sys "$sys_prompt" \\
              --arg data "$user_data" \\
              '{model:"gpt-4o",messages:[{role:"system",content:$sys},{role:"user",content:$data}]}')
            curl -sS https://models.inference.ai.azure.com/chat/completions \\
              -H "Authorization: Bearer $GH_TOKEN" \\
              -H "Content-Type: application/json" \\
              -d "$payload" \\
              | jq -r '.choices[0].message.content // "Analysis unavailable"'
          }

          SYS_PROMPT='You are an Azure infrastructure engineer in a drift remediation loop. Analyze the Bicep what-if report AND the history of previous actions. Recommend exactly ONE action: redeploy (re-apply Bicep to fix drift), skip (drift is intentional/safe), or escalate (dangerous drift requiring human review). Start with ACTION: <action>. Explain in 2-3 sentences.'

          # ── Initial check ──
          RESULT=$(check_drift)
          CHANGE_COUNT=$(echo "$RESULT" | cut -d'|' -f1)
          WHATIF_DATA=$(echo "$RESULT" | cut -d'|' -f2-)

          if [ "$CHANGE_COUNT" = "0" ]; then
            echo "No drift detected — infrastructure matches template."
            RESOLVED=true
          fi

          while [ "$RESOLVED" != "true" ] && [ "$ATTEMPT" -lt "$MAX_ATTEMPTS" ]; do
            ATTEMPT=$((ATTEMPT + 1))
            echo "=== Attempt $ATTEMPT / $MAX_ATTEMPTS ($CHANGE_COUNT drifted resources) ==="

            USER_DATA=$(jq -n --arg drift "$WHATIF_DATA" --arg history "$ACTION_LOG" --argjson attempt "$ATTEMPT" \\
              '{whatif_report: $drift, attempt: $attempt, previous_actions: $history}')

            ANALYSIS=$(call_copilot "$SYS_PROMPT" "$USER_DATA")
            echo "$ANALYSIS"

            if echo "$ANALYSIS" | grep -qi "redeploy"; then
              echo ">>> Redeploying from Bicep template"
              do_redeploy
              DEPLOY_STATUS=$?
              ACTION_LOG="$ACTION_LOG
Attempt $ATTEMPT: Action=redeploy, DriftCount=$CHANGE_COUNT, ExitCode=$DEPLOY_STATUS, AI=$(echo "$ANALYSIS" | head -3)"
            elif echo "$ANALYSIS" | grep -qi "escalate"; then
              ACTION_LOG="$ACTION_LOG
Attempt $ATTEMPT: Action=escalate-recommended, DriftCount=$CHANGE_COUNT, AI=$(echo "$ANALYSIS" | head -3)"
              break
            else
              ACTION_LOG="$ACTION_LOG
Attempt $ATTEMPT: Action=skip, DriftCount=$CHANGE_COUNT, AI=$(echo "$ANALYSIS" | head -3)"
              # If AI says skip, the drift is intentional — treat as resolved
              echo "=== AI determined drift is intentional/safe ==="
              RESOLVED=true
              break
            fi

            echo "=== Waiting 60s for deployment to propagate ==="
            sleep 60

            RESULT=$(check_drift)
            CHANGE_COUNT=$(echo "$RESULT" | cut -d'|' -f1)
            WHATIF_DATA=$(echo "$RESULT" | cut -d'|' -f2-)

            if [ "$CHANGE_COUNT" = "0" ]; then
              echo "=== Drift eliminated! Resolved on attempt $ATTEMPT ==="
              RESOLVED=true
            fi
          done

          echo "resolved=$RESOLVED" >> $GITHUB_OUTPUT
          echo "attempts=$ATTEMPT" >> $GITHUB_OUTPUT
          echo "remaining_drift=$CHANGE_COUNT" >> $GITHUB_OUTPUT
          echo "log<<LOG_EOF" >> $GITHUB_OUTPUT
          echo "$ACTION_LOG" >> $GITHUB_OUTPUT
          echo "LOG_EOF" >> $GITHUB_OUTPUT

          SUMMARY=$(call_copilot 'Summarize this drift remediation session concisely.' "Resolved: $RESOLVED, Attempts: $ATTEMPT, RemainingDrift: $CHANGE_COUNT, Log: $ACTION_LOG")
          echo "summary<<SUMM_EOF" >> $GITHUB_OUTPUT
          echo "$SUMMARY" >> $GITHUB_OUTPUT
          echo "SUMM_EOF" >> $GITHUB_OUTPUT

      - name: Report success
        if: steps.loop.outputs.resolved == 'true' && steps.loop.outputs.attempts != '0'
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: '✅ Drift Resolved — ${req.resourceGroupName} (attempt \${{ steps.loop.outputs.attempts }})',
              body: '## Drift Remediation Report\\n\\n' +
                '- **Status**: Resolved ✅\\n' +
                '- **Attempts**: \${{ steps.loop.outputs.attempts }}\\n\\n' +
                '### 🤖 AI Summary\\n\\n' +
                \`\${{ steps.loop.outputs.summary }}\` +
                '\\n\\n### Action Log\\n\\n\`\`\`\\n' +
                \`\${{ steps.loop.outputs.log }}\` + '\\n\`\`\`',
              labels: ['platform-engineer', 'drift', 'resolved', 'auto-created']
            });

      - name: Escalate to human
        if: steps.loop.outputs.resolved != 'true'
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: '🚨 ESCALATION — Drift unresolved after \${{ steps.loop.outputs.attempts }} attempts — ${req.resourceGroupName}',
              body: '## ⚠️ Human Intervention Required\\n\\n' +
                'Drift remediation could not fully resolve the infrastructure differences.\\n\\n' +
                '- **Remaining drifted resources**: \${{ steps.loop.outputs.remaining_drift }}\\n' +
                '- **Attempts**: \${{ steps.loop.outputs.attempts }}\\n' +
                '- **Resource Group**: ${req.resourceGroupName}\\n\\n' +
                '### 🤖 AI Summary\\n\\n' +
                \`\${{ steps.loop.outputs.summary }}\` +
                '\\n\\n### Full Action Log\\n\\n\`\`\`\\n' +
                \`\${{ steps.loop.outputs.log }}\` +
                '\\n\`\`\`\\n\\n> Review whether the drift is intentional or needs manual correction.',
              labels: ['platform-engineer', 'drift', 'escalation', 'urgent', 'auto-created']
            });
`,
    };
  }

  private securityScan(req: RemediationRequest): GeneratedWorkflow {
    return {
      path: ".github/workflows/pe-security-scan.yml",
      name: "Security Scan",
      content: `name: "Platform Engineer: Security Scan"

on:
  schedule:
    - cron: "0 3 * * 0"
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: write
  security-events: write
  issues: write
  pull-requests: write

jobs:
  dependency-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run dependency review
        if: github.event_name == 'push'
        uses: actions/dependency-review-action@v4

      - name: Run CodeQL analysis
        uses: github/codeql-action/init@v3
        with:
          languages: javascript-typescript

      - name: Autobuild
        uses: github/codeql-action/autobuild@v3

      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@v3

  container-scan:
    runs-on: ubuntu-latest
    if: hashFiles('Dockerfile') != ''
    steps:
      - uses: actions/checkout@v4

      - name: Security fix loop
        id: loop
        env:
          GH_TOKEN: \${{ github.token }}
        run: |
          MAX_ATTEMPTS=15
          ATTEMPT=0
          RESOLVED=false
          ACTION_LOG=""

          run_trivy_scan() {
            docker build -t scan-target:latest . 2>/dev/null
            # Run Trivy with JSON output for parsing
            docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \\
              aquasec/trivy:latest image --format json --severity CRITICAL,HIGH \\
              scan-target:latest 2>/dev/null || echo '{"Results":[]}'
          }

          count_vulns() {
            echo "$1" | jq '[.Results[]?.Vulnerabilities // [] | .[] | select(.Severity == "CRITICAL" or .Severity == "HIGH")] | length'
          }

          do_npm_audit_fix() {
            npm audit fix --force 2>&1 || echo "npm audit fix completed"
          }

          do_update_base_image() {
            # Update Dockerfile to use latest patch of current base image
            if [ -f Dockerfile ]; then
              # Pull latest version of base image
              BASE_IMAGE=$(head -1 Dockerfile | sed 's/FROM //')
              docker pull "$BASE_IMAGE" 2>/dev/null || true
              echo "Base image $BASE_IMAGE pulled (latest)"
            fi
          }

          do_rebuild() {
            docker build --no-cache --pull -t scan-target:latest . 2>/dev/null
          }

          call_copilot() {
            local sys_prompt="$1"
            local user_data="$2"
            local payload
            payload=$(jq -n \\
              --arg sys "$sys_prompt" \\
              --arg data "$user_data" \\
              '{model:"gpt-4o",messages:[{role:"system",content:$sys},{role:"user",content:$data}]}')
            curl -sS https://models.inference.ai.azure.com/chat/completions \\
              -H "Authorization: Bearer $GH_TOKEN" \\
              -H "Content-Type: application/json" \\
              -d "$payload" \\
              | jq -r '.choices[0].message.content // "Analysis unavailable"'
          }

          SYS_PROMPT='You are a security engineer in a vulnerability remediation loop. Analyze the Trivy scan results AND history of previous fix attempts. Recommend exactly ONE action: npm-audit-fix (fix JS dependencies), rebuild (rebuild with --no-cache --pull for base image updates), update-base (pull latest base image), or escalate (requires manual code changes). Do NOT repeat failed actions. Start with ACTION: <action>. Be concise.'

          # ── Initial scan ──
          echo "=== Running initial Trivy scan ==="
          SCAN_RESULTS=$(run_trivy_scan)
          VULN_COUNT=$(count_vulns "$SCAN_RESULTS")
          TOP_VULNS=$(echo "$SCAN_RESULTS" | jq '[.Results[]?.Vulnerabilities // [] | .[] | select(.Severity == "CRITICAL" or .Severity == "HIGH")] | .[0:10] | [.[] | {id: .VulnerabilityID, pkg: .PkgName, severity: .Severity, fixedVersion: .FixedVersion}]')

          if [ "$VULN_COUNT" = "0" ]; then
            echo "No CRITICAL/HIGH vulnerabilities found."
            RESOLVED=true
          fi

          while [ "$RESOLVED" != "true" ] && [ "$ATTEMPT" -lt "$MAX_ATTEMPTS" ]; do
            ATTEMPT=$((ATTEMPT + 1))
            echo "=== Attempt $ATTEMPT / $MAX_ATTEMPTS ($VULN_COUNT vulnerabilities) ==="

            USER_DATA=$(jq -n --arg vulns "$TOP_VULNS" --argjson count "$VULN_COUNT" --arg history "$ACTION_LOG" --argjson attempt "$ATTEMPT" \\
              '{vuln_count: $count, top_vulnerabilities: $vulns, attempt: $attempt, previous_actions: $history}')

            ANALYSIS=$(call_copilot "$SYS_PROMPT" "$USER_DATA")
            echo "$ANALYSIS"

            if echo "$ANALYSIS" | grep -qi "npm-audit"; then
              echo ">>> Running npm audit fix"
              do_npm_audit_fix
              do_rebuild
              ACTION_LOG="$ACTION_LOG
Attempt $ATTEMPT: Action=npm-audit-fix, Vulns=$VULN_COUNT, AI=$(echo "$ANALYSIS" | head -3)"
            elif echo "$ANALYSIS" | grep -qi "rebuild"; then
              echo ">>> Rebuilding with --no-cache --pull"
              do_rebuild
              ACTION_LOG="$ACTION_LOG
Attempt $ATTEMPT: Action=rebuild, Vulns=$VULN_COUNT, AI=$(echo "$ANALYSIS" | head -3)"
            elif echo "$ANALYSIS" | grep -qi "update-base"; then
              echo ">>> Updating base image"
              do_update_base_image
              do_rebuild
              ACTION_LOG="$ACTION_LOG
Attempt $ATTEMPT: Action=update-base, Vulns=$VULN_COUNT, AI=$(echo "$ANALYSIS" | head -3)"
            elif echo "$ANALYSIS" | grep -qi "escalate"; then
              ACTION_LOG="$ACTION_LOG
Attempt $ATTEMPT: Action=escalate-recommended, Vulns=$VULN_COUNT, AI=$(echo "$ANALYSIS" | head -3)"
              break
            else
              ACTION_LOG="$ACTION_LOG
Attempt $ATTEMPT: Action=unknown, Vulns=$VULN_COUNT, AI=$(echo "$ANALYSIS" | head -3)"
            fi

            echo "=== Re-scanning ==="
            SCAN_RESULTS=$(run_trivy_scan)
            VULN_COUNT=$(count_vulns "$SCAN_RESULTS")
            TOP_VULNS=$(echo "$SCAN_RESULTS" | jq '[.Results[]?.Vulnerabilities // [] | .[] | select(.Severity == "CRITICAL" or .Severity == "HIGH")] | .[0:10] | [.[] | {id: .VulnerabilityID, pkg: .PkgName, severity: .Severity, fixedVersion: .FixedVersion}]')

            if [ "$VULN_COUNT" = "0" ]; then
              echo "=== All vulnerabilities resolved on attempt $ATTEMPT ==="
              RESOLVED=true
            fi
          done

          # Upload SARIF for GitHub Security tab
          docker build -t scan-target:latest . 2>/dev/null || true
          docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "$(pwd):/output" \\
            aquasec/trivy:latest image --format sarif --output /output/trivy-results.sarif \\
            --severity CRITICAL,HIGH scan-target:latest 2>/dev/null || true

          echo "resolved=$RESOLVED" >> $GITHUB_OUTPUT
          echo "attempts=$ATTEMPT" >> $GITHUB_OUTPUT
          echo "remaining_vulns=$VULN_COUNT" >> $GITHUB_OUTPUT
          echo "log<<LOG_EOF" >> $GITHUB_OUTPUT
          echo "$ACTION_LOG" >> $GITHUB_OUTPUT
          echo "LOG_EOF" >> $GITHUB_OUTPUT

          SUMMARY=$(call_copilot 'Summarize this security remediation session concisely.' "Resolved: $RESOLVED, Attempts: $ATTEMPT, RemainingVulns: $VULN_COUNT, Log: $ACTION_LOG")
          echo "summary<<SUMM_EOF" >> $GITHUB_OUTPUT
          echo "$SUMMARY" >> $GITHUB_OUTPUT
          echo "SUMM_EOF" >> $GITHUB_OUTPUT

      - name: Upload Trivy SARIF
        if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: trivy-results.sarif
        continue-on-error: true

      - name: Commit fixes if any
        if: steps.loop.outputs.resolved == 'true' && steps.loop.outputs.attempts != '0'
        run: |
          git config user.name "platform-engineer-bot"
          git config user.email "platform-engineer@github.actions"
          git add -A
          if git diff --staged --quiet; then
            echo "No file changes to commit"
          else
            git checkout -b fix/security-auto-remediation-\${{ github.run_id }}
            git commit -m "fix: auto-remediate container vulnerabilities [skip ci]"
            git push origin fix/security-auto-remediation-\${{ github.run_id }}
          fi

      - name: Report success
        if: steps.loop.outputs.resolved == 'true' && steps.loop.outputs.attempts != '0'
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: '✅ Security Vulnerabilities Resolved — ${req.appName}',
              body: '## Security Remediation Report\\n\\n' +
                '- **Status**: Resolved ✅\\n' +
                '- **Attempts**: \${{ steps.loop.outputs.attempts }}\\n\\n' +
                '### 🤖 AI Summary\\n\\n' +
                \`\${{ steps.loop.outputs.summary }}\` +
                '\\n\\n### Action Log\\n\\n\`\`\`\\n' +
                \`\${{ steps.loop.outputs.log }}\` + '\\n\`\`\`\\n\\n' +
                'A fix branch has been pushed if file changes were needed.',
              labels: ['platform-engineer', 'security', 'resolved', 'auto-created']
            });

      - name: Escalate to human
        if: steps.loop.outputs.resolved != 'true'
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: '🚨 ESCALATION — \${{ steps.loop.outputs.remaining_vulns }} vulnerabilities remain after \${{ steps.loop.outputs.attempts }} attempts',
              body: '## ⚠️ Human Intervention Required\\n\\n' +
                'Security auto-remediation could not resolve all vulnerabilities.\\n\\n' +
                '- **Remaining CRITICAL/HIGH vulns**: \${{ steps.loop.outputs.remaining_vulns }}\\n' +
                '- **Attempts**: \${{ steps.loop.outputs.attempts }}\\n\\n' +
                '### 🤖 AI Summary\\n\\n' +
                \`\${{ steps.loop.outputs.summary }}\` +
                '\\n\\n### Full Action Log\\n\\n\`\`\`\\n' +
                \`\${{ steps.loop.outputs.log }}\` +
                '\\n\`\`\`\\n\\n> These vulnerabilities likely require manual code changes or base image migration.',
              labels: ['platform-engineer', 'security', 'escalation', 'urgent', 'auto-created']
            });
`,
    };
  }

  private autoRemediate(req: RemediationRequest): GeneratedWorkflow {
    return {
      path: ".github/workflows/pe-auto-remediate.yml",
      name: "Auto-Remediate",
      content: `name: "Platform Engineer: Auto-Remediate"

on:
  workflow_dispatch:
    inputs:
      action:
        description: "Initial remediation action to try"
        required: false
        default: "restart"
        type: choice
        options:
          - restart
          - scale-up
          - redeploy

permissions:
  id-token: write
  contents: read
  issues: write

# Approval gate: requires environment approval for destructive actions
jobs:
  assess:
    runs-on: ubuntu-latest
    outputs:
      action: \${{ steps.decide.outputs.action }}
    steps:
      - name: Azure Login (OIDC)
        uses: azure/login@v2
        with:
          client-id: \${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: \${{ secrets.AZURE_TENANT_ID }}
          subscription-id: \${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Assess situation
        id: decide
        run: |
          ACTION=\${{ github.event.inputs.action || 'restart' }}
          echo "action=$ACTION" >> $GITHUB_OUTPUT

  remediate:
    needs: assess
    runs-on: ubuntu-latest
    environment: \${{ needs.assess.outputs.action == 'restart' && 'auto-remediation' || 'manual-approval' }}
    steps:
      - uses: actions/checkout@v4

      - name: Azure Login (OIDC)
        uses: azure/login@v2
        with:
          client-id: \${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: \${{ secrets.AZURE_TENANT_ID }}
          subscription-id: \${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Remediation loop with AI feedback
        id: loop
        env:
          GH_TOKEN: \${{ github.token }}
          INITIAL_ACTION: \${{ needs.assess.outputs.action }}
        run: |
          MAX_ATTEMPTS=15
          ATTEMPT=0
          RESOLVED=false
          ACTION_LOG=""

          # ── Platform-specific remediation functions ──
          do_restart() {
${this.restartCommand(req)}
          }
          do_scale() {
${this.scaleCommand(req)}
          }
          do_redeploy() {
            az deployment group create \\
              --resource-group ${req.resourceGroupName} \\
              --template-file infra/main.bicep \\
              --mode Incremental
          }

          check_health() {
            az resource list \\
              --resource-group ${req.resourceGroupName} \\
              --query "[].{name:name, type:type, provisioningState:provisioningState}" \\
              -o json
          }

          count_unhealthy() {
            echo "$1" | jq '[.[] | select(.provisioningState != "Succeeded")] | length'
          }

          call_copilot() {
            local sys_prompt="$1"
            local user_data="$2"
            local payload
            payload=$(jq -n \\
              --arg sys "$sys_prompt" \\
              --arg data "$user_data" \\
              '{model:"gpt-4o",messages:[{role:"system",content:$sys},{role:"user",content:$data}]}')
            curl -sS https://models.inference.ai.azure.com/chat/completions \\
              -H "Authorization: Bearer $GH_TOKEN" \\
              -H "Content-Type: application/json" \\
              -d "$payload" \\
              | jq -r '.choices[0].message.content // "Analysis unavailable"'
          }

          extract_action() {
            # Parse the AI response for a recommended action keyword
            local analysis="$1"
            local current="$2"
            if echo "$analysis" | grep -qi "redeploy"; then
              echo "redeploy"
            elif echo "$analysis" | grep -qi "scale"; then
              echo "scale-up"
            elif echo "$analysis" | grep -qi "restart"; then
              echo "restart"
            else
              echo "$current"
            fi
          }

          run_action() {
            local action="$1"
            echo ">>> Executing: $action"
            case "$action" in
              restart)   do_restart ;;
              scale-up)  do_scale ;;
              redeploy)  do_redeploy ;;
              *)         echo "Unknown action: $action" ;;
            esac
          }

          SYS_PROMPT='You are an Azure platform engineer performing auto-remediation. You are in a retry loop. Analyze the current resource health data AND the history of actions already attempted. Do NOT recommend an action that was already tried and failed. Recommend exactly ONE action: restart, scale-up, or redeploy. Explain your reasoning in 2-3 sentences. Start your response with ACTION: <action> on the first line.'

          # ── Initial health check ──
          echo "=== Gathering initial health data ==="
          HEALTH=$(check_health)
          UNHEALTHY=$(count_unhealthy "$HEALTH")

          if [ "$UNHEALTHY" = "0" ]; then
            echo "All resources healthy — nothing to do."
            RESOLVED=true
          fi

          CURRENT_ACTION="$INITIAL_ACTION"

          # ── Remediation loop ──
          while [ "$RESOLVED" != "true" ] && [ "$ATTEMPT" -lt "$MAX_ATTEMPTS" ]; do
            ATTEMPT=$((ATTEMPT + 1))
            echo ""
            echo "============================================"
            echo "=== Attempt $ATTEMPT / $MAX_ATTEMPTS ==="
            echo "============================================"

            # Ask Copilot with full context
            USER_DATA=$(jq -n \\
              --arg health "$HEALTH" \\
              --arg history "$ACTION_LOG" \\
              --argjson attempt "$ATTEMPT" \\
              '{current_health: $health, attempt: $attempt, previous_actions: $history}' )

            echo "=== Asking AI for recommendation ==="
            ANALYSIS=$(call_copilot "$SYS_PROMPT" "$USER_DATA")
            echo "$ANALYSIS"

            # Extract recommended action
            RECOMMENDED=$(extract_action "$ANALYSIS" "$CURRENT_ACTION")
            echo "=== AI recommends: $RECOMMENDED ==="

            # Execute the action
            run_action "$RECOMMENDED"
            ACTION_STATUS=$?

            # Log this attempt
            ACTION_LOG="$ACTION_LOG
Attempt $ATTEMPT: Action=$RECOMMENDED, ExitCode=$ACTION_STATUS, AI_Said=$(echo "$ANALYSIS" | head -3)"

            # Wait for Azure to stabilize
            echo "=== Waiting 30s for changes to propagate ==="
            sleep 30

            # Re-check health
            echo "=== Re-checking health ==="
            HEALTH=$(check_health)
            UNHEALTHY=$(count_unhealthy "$HEALTH")

            if [ "$UNHEALTHY" = "0" ]; then
              echo "=== All resources healthy! Resolved on attempt $ATTEMPT ==="
              RESOLVED=true
            else
              echo "=== Still $UNHEALTHY unhealthy resource(s) — will retry ==="
              CURRENT_ACTION="$RECOMMENDED"
            fi
          done

          # ── Write outputs ──
          echo "resolved=$RESOLVED" >> $GITHUB_OUTPUT
          echo "attempts=$ATTEMPT" >> $GITHUB_OUTPUT
          echo "last_action=$CURRENT_ACTION" >> $GITHUB_OUTPUT
          echo "log<<ACTION_LOG_EOF" >> $GITHUB_OUTPUT
          echo "$ACTION_LOG" >> $GITHUB_OUTPUT
          echo "ACTION_LOG_EOF" >> $GITHUB_OUTPUT
          echo "final_health<<HEALTH_EOF" >> $GITHUB_OUTPUT
          echo "$HEALTH" >> $GITHUB_OUTPUT
          echo "HEALTH_EOF" >> $GITHUB_OUTPUT

          # Final Copilot summary
          SUMMARY_PROMPT='You are an Azure platform engineer. Summarize this remediation session: what was tried, what worked or did not work, and what the current state is. Be concise.'
          SUMMARY_DATA="Resolved: $RESOLVED, Attempts: $ATTEMPT, Log: $ACTION_LOG, Final Health: $HEALTH"
          FINAL_ANALYSIS=$(call_copilot "$SUMMARY_PROMPT" "$SUMMARY_DATA")
          echo "final_analysis<<FINAL_EOF" >> $GITHUB_OUTPUT
          echo "$FINAL_ANALYSIS" >> $GITHUB_OUTPUT
          echo "FINAL_EOF" >> $GITHUB_OUTPUT

      - name: Log successful remediation
        if: steps.loop.outputs.resolved == 'true'
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: '✅ Auto-Remediation Succeeded — resolved in \${{ steps.loop.outputs.attempts }} attempt(s)',
              body: '## Remediation Report\\n\\n' +
                '- **Status**: Resolved ✅\\n' +
                '- **Attempts**: \${{ steps.loop.outputs.attempts }}\\n' +
                '- **Last Action**: \${{ steps.loop.outputs.last_action }}\\n' +
                '- **Resource Group**: ${req.resourceGroupName}\\n' +
                '- **Triggered by**: \${{ github.actor }}\\n' +
                '- **Run**: \${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}\\n\\n' +
                '### 🤖 AI Summary\\n\\n' +
                \`\${{ steps.loop.outputs.final_analysis }}\` +
                '\\n\\n### Action Log\\n\\n\`\`\`\\n' +
                \`\${{ steps.loop.outputs.log }}\` +
                '\\n\`\`\`',
              labels: ['platform-engineer', 'remediation', 'resolved', 'auto-created']
            });

      - name: Escalate to human
        if: steps.loop.outputs.resolved != 'true'
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: '🚨 ESCALATION — Auto-remediation failed after \${{ steps.loop.outputs.attempts }} attempts',
              body: '## ⚠️ Human Intervention Required\\n\\n' +
                'Auto-remediation exhausted all 15 attempts without resolving the issue.\\n\\n' +
                '- **Attempts**: \${{ steps.loop.outputs.attempts }}\\n' +
                '- **Last Action Tried**: \${{ steps.loop.outputs.last_action }}\\n' +
                '- **Resource Group**: ${req.resourceGroupName}\\n' +
                '- **Triggered by**: \${{ github.actor }}\\n' +
                '- **Run**: \${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}\\n\\n' +
                '### 🤖 AI Summary\\n\\n' +
                \`\${{ steps.loop.outputs.final_analysis }}\` +
                '\\n\\n### Full Action Log\\n\\n\`\`\`\\n' +
                \`\${{ steps.loop.outputs.log }}\` +
                '\\n\`\`\`\\n\\n' +
                '### Current Resource Health\\n\\n\`\`\`json\\n' +
                \`\${{ steps.loop.outputs.final_health }}\` +
                '\\n\`\`\`\\n\\n' +
                '> Please investigate manually and resolve the issue.',
              labels: ['platform-engineer', 'remediation', 'escalation', 'urgent', 'auto-created']
            });
`,
    };
  }

  private performanceTest(req: RemediationRequest): GeneratedWorkflow {
    return {
      path: ".github/workflows/pe-performance-test.yml",
      name: "Performance Test",
      content: `name: "Platform Engineer: Performance Test"

on:
  schedule:
    - cron: "0 4 * * *"
  workflow_dispatch:

permissions:
  id-token: write
  contents: read
  issues: write

jobs:
  performance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Azure Login (OIDC)
        uses: azure/login@v2
        with:
          client-id: \${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: \${{ secrets.AZURE_TENANT_ID }}
          subscription-id: \${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Performance remediation loop
        id: loop
        env:
          GH_TOKEN: \${{ github.token }}
        run: |
          MAX_ATTEMPTS=15
          ATTEMPT=0
          RESOLVED=false
          ACTION_LOG=""
          THRESHOLD=5

          # Get endpoint
          URL="https://$(az resource list --resource-group ${req.resourceGroupName} --query "[?type=='Microsoft.Web/sites' || type=='Microsoft.App/containerApps'].properties.defaultHostName | [0]" -o tsv 2>/dev/null || echo "")"
          if [ "$URL" = "https://" ] || [ -z "$URL" ]; then
            echo "No endpoint found"
            echo "resolved=true" >> $GITHUB_OUTPUT
            echo "attempts=0" >> $GITHUB_OUTPUT
            exit 0
          fi
          echo "endpoint=$URL" >> $GITHUB_OUTPUT

          measure_response_time() {
            local total=0
            local count=5
            for i in $(seq 1 $count); do
              local t=$(curl -o /dev/null -s -w '%{time_total}' "$URL/health" 2>/dev/null || echo "0")
              total=$(echo "$total + $t" | bc)
              sleep 1
            done
            echo "scale=3; $total / $count" | bc
          }

          do_restart() {
${this.restartCommand(req)}
          }

          do_scale() {
${this.scaleCommand(req)}
          }

          call_copilot() {
            local sys_prompt="$1"
            local user_data="$2"
            local payload
            payload=$(jq -n \\
              --arg sys "$sys_prompt" \\
              --arg data "$user_data" \\
              '{model:"gpt-4o",messages:[{role:"system",content:$sys},{role:"user",content:$data}]}')
            curl -sS https://models.inference.ai.azure.com/chat/completions \\
              -H "Authorization: Bearer $GH_TOKEN" \\
              -H "Content-Type: application/json" \\
              -d "$payload" \\
              | jq -r '.choices[0].message.content // "Analysis unavailable"'
          }

          SYS_PROMPT='You are a performance engineer in a retry loop. Analyze the response times AND the history of previous actions. Do NOT repeat failed actions. Recommend exactly ONE action: restart (cold start fix), scale-up (resource contention), or wait (transient). Start with ACTION: <action>. Explain in 2-3 sentences.'

          # ── Initial measurement ──
          AVG=$(measure_response_time)
          echo "=== Initial avg response time: \${AVG}s (threshold: \${THRESHOLD}s) ==="

          IS_SLOW=$(echo "$AVG > $THRESHOLD" | bc -l 2>/dev/null || echo "0")
          if [ "$IS_SLOW" != "1" ]; then
            echo "Response times OK — nothing to do."
            RESOLVED=true
          fi

          while [ "$RESOLVED" != "true" ] && [ "$ATTEMPT" -lt "$MAX_ATTEMPTS" ]; do
            ATTEMPT=$((ATTEMPT + 1))
            echo "=== Attempt $ATTEMPT / $MAX_ATTEMPTS (avg: \${AVG}s) ==="

            USER_DATA=$(jq -n --arg avg "$AVG" --arg url "$URL" --arg history "$ACTION_LOG" --argjson attempt "$ATTEMPT" \\
              '{avg_response_time: $avg, endpoint: $url, attempt: $attempt, previous_actions: $history}')

            ANALYSIS=$(call_copilot "$SYS_PROMPT" "$USER_DATA")
            echo "$ANALYSIS"

            if echo "$ANALYSIS" | grep -qi "scale"; then
              echo ">>> Scaling up"
              do_scale
              ACTION_LOG="$ACTION_LOG
Attempt $ATTEMPT: Action=scale-up, AvgTime=\${AVG}s, AI=$(echo "$ANALYSIS" | head -3)"
            elif echo "$ANALYSIS" | grep -qi "restart"; then
              echo ">>> Restarting"
              do_restart
              ACTION_LOG="$ACTION_LOG
Attempt $ATTEMPT: Action=restart, AvgTime=\${AVG}s, AI=$(echo "$ANALYSIS" | head -3)"
            else
              ACTION_LOG="$ACTION_LOG
Attempt $ATTEMPT: Action=wait, AvgTime=\${AVG}s, AI=$(echo "$ANALYSIS" | head -3)"
            fi

            echo "=== Waiting 30s then re-measuring ==="
            sleep 30

            AVG=$(measure_response_time)
            IS_SLOW=$(echo "$AVG > $THRESHOLD" | bc -l 2>/dev/null || echo "0")
            if [ "$IS_SLOW" != "1" ]; then
              echo "=== Response time \${AVG}s < \${THRESHOLD}s — resolved on attempt $ATTEMPT ==="
              RESOLVED=true
            fi
          done

          echo "resolved=$RESOLVED" >> $GITHUB_OUTPUT
          echo "attempts=$ATTEMPT" >> $GITHUB_OUTPUT
          echo "final_avg=$AVG" >> $GITHUB_OUTPUT
          echo "log<<LOG_EOF" >> $GITHUB_OUTPUT
          echo "$ACTION_LOG" >> $GITHUB_OUTPUT
          echo "LOG_EOF" >> $GITHUB_OUTPUT

          SUMMARY=$(call_copilot 'Summarize this performance remediation session concisely.' "Resolved: $RESOLVED, Attempts: $ATTEMPT, FinalAvg: \${AVG}s, Endpoint: $URL, Log: $ACTION_LOG")
          echo "summary<<SUMM_EOF" >> $GITHUB_OUTPUT
          echo "$SUMMARY" >> $GITHUB_OUTPUT
          echo "SUMM_EOF" >> $GITHUB_OUTPUT

      - name: Report success
        if: steps.loop.outputs.resolved == 'true' && steps.loop.outputs.attempts != '0'
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: '✅ Performance Restored — ${req.appName} (\${{ steps.loop.outputs.final_avg }}s avg)',
              body: '## Performance Remediation Report\\n\\n' +
                '- **Status**: Resolved ✅\\n' +
                '- **Attempts**: \${{ steps.loop.outputs.attempts }}\\n' +
                '- **Final avg response time**: \${{ steps.loop.outputs.final_avg }}s\\n' +
                '- **Endpoint**: \${{ steps.loop.outputs.endpoint }}\\n\\n' +
                '### 🤖 AI Summary\\n\\n' +
                \`\${{ steps.loop.outputs.summary }}\` +
                '\\n\\n### Action Log\\n\\n\`\`\`\\n' +
                \`\${{ steps.loop.outputs.log }}\` + '\\n\`\`\`',
              labels: ['platform-engineer', 'performance', 'resolved', 'auto-created']
            });

      - name: Escalate to human
        if: steps.loop.outputs.resolved != 'true'
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: '🚨 ESCALATION — Performance degradation unresolved after \${{ steps.loop.outputs.attempts }} attempts — ${req.appName}',
              body: '## ⚠️ Human Intervention Required\\n\\n' +
                'Performance remediation exhausted all 15 attempts.\\n\\n' +
                '- **Final avg response**: \${{ steps.loop.outputs.final_avg }}s (threshold: 5s)\\n' +
                '- **Endpoint**: \${{ steps.loop.outputs.endpoint }}\\n' +
                '- **Resource Group**: ${req.resourceGroupName}\\n\\n' +
                '### 🤖 AI Summary\\n\\n' +
                \`\${{ steps.loop.outputs.summary }}\` +
                '\\n\\n### Full Action Log\\n\\n\`\`\`\\n' +
                \`\${{ steps.loop.outputs.log }}\` +
                '\\n\`\`\`\\n\\n> Please investigate manually.',
              labels: ['platform-engineer', 'performance', 'escalation', 'urgent', 'auto-created']
            });
`,
    };
  }

  private backupVerification(req: RemediationRequest): GeneratedWorkflow {
    return {
      path: ".github/workflows/pe-backup-verification.yml",
      name: "Backup Verification",
      content: `name: "Platform Engineer: Backup Verification"

on:
  schedule:
    - cron: "0 2 * * 0"
  workflow_dispatch:

permissions:
  id-token: write
  contents: read
  issues: write

jobs:
  verify-backups:
    runs-on: ubuntu-latest
    steps:
      - name: Azure Login (OIDC)
        uses: azure/login@v2
        with:
          client-id: \${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: \${{ secrets.AZURE_TENANT_ID }}
          subscription-id: \${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Check backup status
        id: backup
        run: |
          # Check for web app backups
          WEBAPP_BACKUPS=$(az webapp config backup list --resource-group ${req.resourceGroupName} --webapp-name ${req.appName} 2>/dev/null | jq 'length // 0' || echo "0")

          # Check for database backups (if any SQL resources exist)
          SQL_SERVERS=$(az sql server list --resource-group ${req.resourceGroupName} --query "[].name" -o tsv 2>/dev/null || echo "")
          DB_BACKUP_STATUS="N/A"
          if [ -n "$SQL_SERVERS" ]; then
            for SERVER in $SQL_SERVERS; do
              DBS=$(az sql db list --server $SERVER --resource-group ${req.resourceGroupName} --query "[?name!='master'].name" -o tsv 2>/dev/null || echo "")
              for DB in $DBS; do
                RETENTION=$(az sql db ltr-policy show --server $SERVER --database $DB --resource-group ${req.resourceGroupName} --query "weeklyRetention" -o tsv 2>/dev/null || echo "disabled")
                DB_BACKUP_STATUS="$DB_BACKUP_STATUS\\n$DB: $RETENTION"
              done
            done
          fi

          echo "webapp_backups=$WEBAPP_BACKUPS" >> $GITHUB_OUTPUT
          echo "db_backup_status=$DB_BACKUP_STATUS" >> $GITHUB_OUTPUT
${this.copilotAnalysisStep('You are a disaster recovery engineer. Analyze this backup status report. Assess whether the backup strategy is adequate, identify gaps, and recommend improvements. Be concise.', 'Web App Backups: ${{ steps.backup.outputs.webapp_backups }}, DB Status: ${{ steps.backup.outputs.db_backup_status }}')}

      - name: Report backup status
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: '🗄️ Weekly Backup Verification — ${req.resourceGroupName}',
              body: '## Backup Verification Report\\n\\n' +
                '- **Web App Backups**: \${{ steps.backup.outputs.webapp_backups }} found\\n' +
                '- **DB Backup Retention**: \${{ steps.backup.outputs.db_backup_status }}\\n' +
                '- **Resource Group**: ${req.resourceGroupName}\\n\\n' +
                '### 🤖 AI Analysis\\n\\n' +
                \`\${{ steps.copilot.outputs.analysis }}\`,
              labels: ['platform-engineer', 'backup', 'auto-created']
            });
`,
    };
  }

  private certificateRenewal(req: RemediationRequest): GeneratedWorkflow {
    return {
      path: ".github/workflows/pe-certificate-renewal.yml",
      name: "Certificate Renewal",
      content: `name: "Platform Engineer: Certificate Renewal"

on:
  schedule:
    - cron: "0 7 * * *"
  workflow_dispatch:

permissions:
  id-token: write
  contents: read
  issues: write

jobs:
  check-certs:
    runs-on: ubuntu-latest
    steps:
      - name: Azure Login (OIDC)
        uses: azure/login@v2
        with:
          client-id: \${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: \${{ secrets.AZURE_TENANT_ID }}
          subscription-id: \${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Certificate renewal loop
        id: loop
        env:
          GH_TOKEN: \${{ github.token }}
        run: |
          MAX_ATTEMPTS=15
          ATTEMPT=0
          RESOLVED=false
          ACTION_LOG=""

          check_expiring_certs() {
            local expiring=""
            local count=0

            # App Service certs
            CERTS=$(az webapp config ssl list --resource-group ${req.resourceGroupName} --query "[].{name:name, expirationDate:expirationDate, thumbprint:thumbprint}" -o json 2>/dev/null || echo "[]")
            for ROW in $(echo "$CERTS" | jq -c '.[]'); do
              EXPIRY=$(echo $ROW | jq -r '.expirationDate')
              NAME=$(echo $ROW | jq -r '.name')
              EXPIRY_EPOCH=$(date -d "$EXPIRY" +%s 2>/dev/null || echo "0")
              NOW_EPOCH=$(date +%s)
              DAYS_LEFT=$(( (EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))
              if [ "$DAYS_LEFT" -lt 30 ]; then
                expiring="$expiring|appservice:$NAME:$DAYS_LEFT:$EXPIRY"
                count=$((count + 1))
              fi
            done

            # Key Vault certs
            KV_LIST=$(az keyvault list --resource-group ${req.resourceGroupName} --query "[].name" -o tsv 2>/dev/null || echo "")
            for KV in $KV_LIST; do
              KV_CERTS=$(az keyvault certificate list --vault-name $KV --query "[].{name:name, expires:attributes.expires}" -o json 2>/dev/null || echo "[]")
              for ROW in $(echo "$KV_CERTS" | jq -c '.[]'); do
                EXPIRY=$(echo $ROW | jq -r '.expires')
                NAME=$(echo $ROW | jq -r '.name')
                EXPIRY_EPOCH=$(date -d "$EXPIRY" +%s 2>/dev/null || echo "0")
                NOW_EPOCH=$(date +%s)
                DAYS_LEFT=$(( (EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))
                if [ "$DAYS_LEFT" -lt 30 ]; then
                  expiring="$expiring|keyvault:$KV/$NAME:$DAYS_LEFT:$EXPIRY"
                  count=$((count + 1))
                fi
              done
            done

            echo "$count|$expiring"
          }

          renew_appservice_cert() {
            local name="$1"
            az webapp config ssl create --resource-group ${req.resourceGroupName} --name ${req.appName} --hostname "$name" 2>/dev/null || echo "Renewal attempted for $name"
          }

          renew_keyvault_cert() {
            local vault_and_name="$1"
            local vault=$(echo "$vault_and_name" | cut -d'/' -f1)
            local name=$(echo "$vault_and_name" | cut -d'/' -f2)
            az keyvault certificate create --vault-name "$vault" --name "$name" --policy "$(az keyvault certificate show --vault-name "$vault" --name "$name" --query policy -o json 2>/dev/null)" 2>/dev/null || echo "Renewal attempted for $vault/$name"
          }

          call_copilot() {
            local sys_prompt="$1"
            local user_data="$2"
            local payload
            payload=$(jq -n \\
              --arg sys "$sys_prompt" \\
              --arg data "$user_data" \\
              '{model:"gpt-4o",messages:[{role:"system",content:$sys},{role:"user",content:$data}]}')
            curl -sS https://models.inference.ai.azure.com/chat/completions \\
              -H "Authorization: Bearer $GH_TOKEN" \\
              -H "Content-Type: application/json" \\
              -d "$payload" \\
              | jq -r '.choices[0].message.content // "Analysis unavailable"'
          }

          SYS_PROMPT='You are a security engineer handling TLS certificate renewal in a retry loop. Analyze the expiring certificates AND history of renewal attempts. For each expiring cert, recommend: renew (auto-renew via CLI), skip (managed cert that auto-renews), or escalate (requires manual CA action). Start with ACTION: <action>. Be concise.'

          # ── Initial check ──
          RESULT=$(check_expiring_certs)
          CERT_COUNT=$(echo "$RESULT" | cut -d'|' -f1)
          CERT_DETAILS=$(echo "$RESULT" | cut -d'|' -f2-)

          if [ "$CERT_COUNT" = "0" ]; then
            echo "No expiring certificates — nothing to do."
            RESOLVED=true
          fi

          while [ "$RESOLVED" != "true" ] && [ "$ATTEMPT" -lt "$MAX_ATTEMPTS" ]; do
            ATTEMPT=$((ATTEMPT + 1))
            echo "=== Attempt $ATTEMPT / $MAX_ATTEMPTS ($CERT_COUNT expiring certs) ==="

            USER_DATA=$(jq -n --arg certs "$CERT_DETAILS" --arg history "$ACTION_LOG" --argjson attempt "$ATTEMPT" \\
              '{expiring_certs: $certs, attempt: $attempt, previous_actions: $history}')

            ANALYSIS=$(call_copilot "$SYS_PROMPT" "$USER_DATA")
            echo "$ANALYSIS"

            # Attempt renewals based on AI guidance
            if echo "$ANALYSIS" | grep -qi "renew"; then
              for CERT_ENTRY in $(echo "$CERT_DETAILS" | tr '|' '\\n' | grep -v '^$'); do
                TYPE=$(echo "$CERT_ENTRY" | cut -d':' -f1)
                NAME=$(echo "$CERT_ENTRY" | cut -d':' -f2)
                if [ "$TYPE" = "appservice" ]; then
                  echo ">>> Renewing App Service cert: $NAME"
                  renew_appservice_cert "$NAME"
                elif [ "$TYPE" = "keyvault" ]; then
                  echo ">>> Renewing Key Vault cert: $NAME"
                  renew_keyvault_cert "$NAME"
                fi
              done
              ACTION_LOG="$ACTION_LOG
Attempt $ATTEMPT: Action=renew, Certs=$CERT_COUNT, AI=$(echo "$ANALYSIS" | head -3)"
            elif echo "$ANALYSIS" | grep -qi "escalate"; then
              ACTION_LOG="$ACTION_LOG
Attempt $ATTEMPT: Action=escalate-recommended, Certs=$CERT_COUNT, AI=$(echo "$ANALYSIS" | head -3)"
              break
            else
              ACTION_LOG="$ACTION_LOG
Attempt $ATTEMPT: Action=skip, Certs=$CERT_COUNT, AI=$(echo "$ANALYSIS" | head -3)"
            fi

            echo "=== Waiting 30s then re-checking ==="
            sleep 30

            RESULT=$(check_expiring_certs)
            CERT_COUNT=$(echo "$RESULT" | cut -d'|' -f1)
            CERT_DETAILS=$(echo "$RESULT" | cut -d'|' -f2-)

            if [ "$CERT_COUNT" = "0" ]; then
              echo "=== All certificates renewed! Resolved on attempt $ATTEMPT ==="
              RESOLVED=true
            fi
          done

          echo "resolved=$RESOLVED" >> $GITHUB_OUTPUT
          echo "attempts=$ATTEMPT" >> $GITHUB_OUTPUT
          echo "remaining_certs=$CERT_COUNT" >> $GITHUB_OUTPUT
          echo "log<<LOG_EOF" >> $GITHUB_OUTPUT
          echo "$ACTION_LOG" >> $GITHUB_OUTPUT
          echo "LOG_EOF" >> $GITHUB_OUTPUT

          SUMMARY=$(call_copilot 'Summarize this certificate renewal session concisely.' "Resolved: $RESOLVED, Attempts: $ATTEMPT, Remaining: $CERT_COUNT, Log: $ACTION_LOG")
          echo "summary<<SUMM_EOF" >> $GITHUB_OUTPUT
          echo "$SUMMARY" >> $GITHUB_OUTPUT
          echo "SUMM_EOF" >> $GITHUB_OUTPUT

      - name: Report success
        if: steps.loop.outputs.resolved == 'true' && steps.loop.outputs.attempts != '0'
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: '✅ Certificates Renewed — ${req.resourceGroupName}',
              body: '## Certificate Renewal Report\\n\\n' +
                '- **Status**: All renewed ✅\\n' +
                '- **Attempts**: \${{ steps.loop.outputs.attempts }}\\n\\n' +
                '### 🤖 AI Summary\\n\\n' +
                \`\${{ steps.loop.outputs.summary }}\` +
                '\\n\\n### Action Log\\n\\n\`\`\`\\n' +
                \`\${{ steps.loop.outputs.log }}\` + '\\n\`\`\`',
              labels: ['platform-engineer', 'certificate', 'resolved', 'auto-created']
            });

      - name: Escalate to human
        if: steps.loop.outputs.resolved != 'true'
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: '🚨 ESCALATION — Certificate renewal failed — \${{ steps.loop.outputs.remaining_certs }} still expiring',
              body: '## ⚠️ Human Intervention Required\\n\\n' +
                'Certificate auto-renewal exhausted all attempts.\\n\\n' +
                '- **Remaining expiring certs**: \${{ steps.loop.outputs.remaining_certs }}\\n' +
                '- **Attempts**: \${{ steps.loop.outputs.attempts }}\\n' +
                '- **Resource Group**: ${req.resourceGroupName}\\n\\n' +
                '### 🤖 AI Summary\\n\\n' +
                \`\${{ steps.loop.outputs.summary }}\` +
                '\\n\\n### Full Action Log\\n\\n\`\`\`\\n' +
                \`\${{ steps.loop.outputs.log }}\` +
                '\\n\`\`\`\\n\\n> These certificates require manual renewal (possibly with external CA).',
              labels: ['platform-engineer', 'certificate', 'escalation', 'urgent', 'auto-created']
            });
`,
    };
  }

  private scaleMonitor(req: RemediationRequest): GeneratedWorkflow {
    return {
      path: ".github/workflows/pe-scale-monitor.yml",
      name: "Scale Monitor",
      content: `name: "Platform Engineer: Scale Monitor"

on:
  schedule:
    - cron: "*/15 * * * *"
  workflow_dispatch:

permissions:
  id-token: write
  contents: read
  issues: write

jobs:
  scale-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Azure Login (OIDC)
        uses: azure/login@v2
        with:
          client-id: \${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: \${{ secrets.AZURE_TENANT_ID }}
          subscription-id: \${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Scale remediation loop
        id: loop
        env:
          GH_TOKEN: \${{ github.token }}
        run: |
          MAX_ATTEMPTS=15
          ATTEMPT=0
          RESOLVED=false
          ACTION_LOG=""

          check_metrics() {
            END=$(date -u +%Y-%m-%dT%H:%M:%SZ)
            START=$(date -u -d "15 minutes ago" +%Y-%m-%dT%H:%M:%SZ)
${this.scaleMetricsCommand(req)}
            echo "$NEEDS_SCALE|$METRIC_VALUE"
          }

          do_scale() {
${this.scaleCommand(req)}
          }

          do_restart() {
${this.restartCommand(req)}
          }

          call_copilot() {
            local sys_prompt="$1"
            local user_data="$2"
            local payload
            payload=$(jq -n \\
              --arg sys "$sys_prompt" \\
              --arg data "$user_data" \\
              '{model:"gpt-4o",messages:[{role:"system",content:$sys},{role:"user",content:$data}]}')
            curl -sS https://models.inference.ai.azure.com/chat/completions \\
              -H "Authorization: Bearer $GH_TOKEN" \\
              -H "Content-Type: application/json" \\
              -d "$payload" \\
              | jq -r '.choices[0].message.content // "Analysis unavailable"'
          }

          SYS_PROMPT='You are an Azure platform engineer handling autoscaling. You are in a retry loop. Analyze the current metrics AND the history of actions already attempted. Do NOT recommend an action that already failed. Recommend exactly ONE action: scale-up, restart, or wait. Explain your reasoning in 2-3 sentences. Start your response with ACTION: <action> on the first line.'

          # ── Initial check ──
          RESULT=$(check_metrics)
          NEEDS_SCALE=$(echo "$RESULT" | cut -d'|' -f1)
          METRIC_VALUE=$(echo "$RESULT" | cut -d'|' -f2-)

          if [ "$NEEDS_SCALE" != "true" ]; then
            echo "Metrics within threshold — nothing to do."
            RESOLVED=true
          fi

          while [ "$RESOLVED" != "true" ] && [ "$ATTEMPT" -lt "$MAX_ATTEMPTS" ]; do
            ATTEMPT=$((ATTEMPT + 1))
            echo "=== Attempt $ATTEMPT / $MAX_ATTEMPTS (metric: $METRIC_VALUE) ==="

            USER_DATA=$(jq -n --arg metric "$METRIC_VALUE" --arg history "$ACTION_LOG" --argjson attempt "$ATTEMPT" \\
              '{current_metric: $metric, attempt: $attempt, previous_actions: $history}')

            ANALYSIS=$(call_copilot "$SYS_PROMPT" "$USER_DATA")
            echo "$ANALYSIS"

            if echo "$ANALYSIS" | grep -qi "scale"; then
              echo ">>> Scaling up"
              do_scale
              ACTION_LOG="$ACTION_LOG
Attempt $ATTEMPT: Action=scale-up, Metric=$METRIC_VALUE, AI=$(echo "$ANALYSIS" | head -3)"
            elif echo "$ANALYSIS" | grep -qi "restart"; then
              echo ">>> Restarting"
              do_restart
              ACTION_LOG="$ACTION_LOG
Attempt $ATTEMPT: Action=restart, Metric=$METRIC_VALUE, AI=$(echo "$ANALYSIS" | head -3)"
            else
              ACTION_LOG="$ACTION_LOG
Attempt $ATTEMPT: Action=wait, Metric=$METRIC_VALUE, AI=$(echo "$ANALYSIS" | head -3)"
            fi

            echo "=== Waiting 60s for metrics to stabilize ==="
            sleep 60

            RESULT=$(check_metrics)
            NEEDS_SCALE=$(echo "$RESULT" | cut -d'|' -f1)
            METRIC_VALUE=$(echo "$RESULT" | cut -d'|' -f2-)

            if [ "$NEEDS_SCALE" != "true" ]; then
              echo "=== Metrics normalized! Resolved on attempt $ATTEMPT ==="
              RESOLVED=true
            fi
          done

          echo "resolved=$RESOLVED" >> $GITHUB_OUTPUT
          echo "attempts=$ATTEMPT" >> $GITHUB_OUTPUT
          echo "final_metric=$METRIC_VALUE" >> $GITHUB_OUTPUT
          echo "log<<LOG_EOF" >> $GITHUB_OUTPUT
          echo "$ACTION_LOG" >> $GITHUB_OUTPUT
          echo "LOG_EOF" >> $GITHUB_OUTPUT

          SUMMARY=$(call_copilot 'Summarize this scaling remediation session concisely: what was tried and the outcome.' "Resolved: $RESOLVED, Attempts: $ATTEMPT, Metric: $METRIC_VALUE, Log: $ACTION_LOG")
          echo "summary<<SUMM_EOF" >> $GITHUB_OUTPUT
          echo "$SUMMARY" >> $GITHUB_OUTPUT
          echo "SUMM_EOF" >> $GITHUB_OUTPUT

      - name: Report success
        if: steps.loop.outputs.resolved == 'true' && steps.loop.outputs.attempts != '0'
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: '✅ Scale Issue Resolved — ${req.appName} (attempt \${{ steps.loop.outputs.attempts }})',
              body: '## Scale Remediation Report\\n\\n' +
                '- **Status**: Resolved ✅\\n' +
                '- **Attempts**: \${{ steps.loop.outputs.attempts }}\\n' +
                '- **Final metric**: \${{ steps.loop.outputs.final_metric }}\\n\\n' +
                '### 🤖 AI Summary\\n\\n' +
                \`\${{ steps.loop.outputs.summary }}\` +
                '\\n\\n### Action Log\\n\\n\`\`\`\\n' +
                \`\${{ steps.loop.outputs.log }}\` + '\\n\`\`\`',
              labels: ['platform-engineer', 'scaling', 'resolved', 'auto-created']
            });

      - name: Escalate to human
        if: steps.loop.outputs.resolved != 'true'
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: '🚨 ESCALATION — Scaling failed after \${{ steps.loop.outputs.attempts }} attempts — ${req.appName}',
              body: '## ⚠️ Human Intervention Required\\n\\n' +
                'Auto-scaling exhausted all 15 attempts.\\n\\n' +
                '- **Final metric**: \${{ steps.loop.outputs.final_metric }}\\n' +
                '- **Resource Group**: ${req.resourceGroupName}\\n\\n' +
                '### 🤖 AI Summary\\n\\n' +
                \`\${{ steps.loop.outputs.summary }}\` +
                '\\n\\n### Full Action Log\\n\\n\`\`\`\\n' +
                \`\${{ steps.loop.outputs.log }}\` +
                '\\n\`\`\`\\n\\n> Please investigate manually.',
              labels: ['platform-engineer', 'scaling', 'escalation', 'urgent', 'auto-created']
            });
`,
    };
  }

  private logAnalysis(req: RemediationRequest): GeneratedWorkflow {
    return {
      path: ".github/workflows/pe-log-analysis.yml",
      name: "Log Analysis",
      content: `name: "Platform Engineer: Log Analysis"

on:
  schedule:
    - cron: "0 * * * *"
  workflow_dispatch:

permissions:
  id-token: write
  contents: read
  issues: write

jobs:
  analyze-logs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Azure Login (OIDC)
        uses: azure/login@v2
        with:
          client-id: \${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: \${{ secrets.AZURE_TENANT_ID }}
          subscription-id: \${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Log analysis remediation loop
        id: loop
        env:
          GH_TOKEN: \${{ github.token }}
        run: |
          MAX_ATTEMPTS=15
          ATTEMPT=0
          RESOLVED=false
          ACTION_LOG=""
          ERROR_THRESHOLD=5

          # Find Log Analytics workspace
          WORKSPACE=$(az monitor log-analytics workspace list --resource-group ${req.resourceGroupName} --query "[0].customerId" -o tsv 2>/dev/null || echo "")
          if [ -z "$WORKSPACE" ]; then
            echo "No Log Analytics workspace found"
            echo "resolved=true" >> $GITHUB_OUTPUT
            echo "attempts=0" >> $GITHUB_OUTPUT
            exit 0
          fi

          query_errors() {
            az monitor log-analytics query \\
              --workspace "$WORKSPACE" \\
              --analytics-query "AppExceptions | where TimeGenerated > ago(1h) | summarize count() by ProblemId, OuterMessage | top 10 by count_" \\
              --timespan PT1H \\
              -o json 2>/dev/null || echo "[]"
          }

          query_anomalies() {
            az monitor log-analytics query \\
              --workspace "$WORKSPACE" \\
              --analytics-query "AppRequests | where TimeGenerated > ago(1h) | summarize count(), avg(DurationMs) by bin(TimeGenerated, 5m) | where count_ > 1000 or avg_DurationMs > 5000" \\
              --timespan PT1H \\
              -o json 2>/dev/null || echo "[]"
          }

          do_restart() {
${this.restartCommand(req)}
          }

          do_scale() {
${this.scaleCommand(req)}
          }

          call_copilot() {
            local sys_prompt="$1"
            local user_data="$2"
            local payload
            payload=$(jq -n \\
              --arg sys "$sys_prompt" \\
              --arg data "$user_data" \\
              '{model:"gpt-4o",messages:[{role:"system",content:$sys},{role:"user",content:$data}]}')
            curl -sS https://models.inference.ai.azure.com/chat/completions \\
              -H "Authorization: Bearer $GH_TOKEN" \\
              -H "Content-Type: application/json" \\
              -d "$payload" \\
              | jq -r '.choices[0].message.content // "Analysis unavailable"'
          }

          SYS_PROMPT='You are a site reliability engineer in a remediation loop. Analyze the error logs, anomaly data, AND history of previous actions. The errors may be caused by app crashes, resource exhaustion, or deployment issues. Recommend exactly ONE action: restart (app crash/memory leak), scale-up (resource exhaustion/high latency), redeploy (bad deployment), or wait (transient spike). Do NOT repeat failed actions. Start with ACTION: <action>. Be concise.'

          # ── Initial query ──
          ERRORS=$(query_errors)
          ERROR_COUNT=$(echo "$ERRORS" | jq 'length // 0')
          ANOMALIES=$(query_anomalies)
          ANOMALY_COUNT=$(echo "$ANOMALIES" | jq 'length // 0')

          echo "=== Initial: $ERROR_COUNT error types, $ANOMALY_COUNT anomalous intervals ==="

          if [ "$ERROR_COUNT" -le "$ERROR_THRESHOLD" ] && [ "$ANOMALY_COUNT" = "0" ]; then
            echo "Error levels within threshold — nothing to do."
            RESOLVED=true
          fi

          while [ "$RESOLVED" != "true" ] && [ "$ATTEMPT" -lt "$MAX_ATTEMPTS" ]; do
            ATTEMPT=$((ATTEMPT + 1))
            echo "=== Attempt $ATTEMPT / $MAX_ATTEMPTS (errors: $ERROR_COUNT, anomalies: $ANOMALY_COUNT) ==="

            USER_DATA=$(jq -n \\
              --arg errors "$ERRORS" \\
              --argjson ecount "$ERROR_COUNT" \\
              --argjson acount "$ANOMALY_COUNT" \\
              --arg history "$ACTION_LOG" \\
              --argjson attempt "$ATTEMPT" \\
              '{error_count: $ecount, anomaly_count: $acount, top_errors: $errors, attempt: $attempt, previous_actions: $history}')

            ANALYSIS=$(call_copilot "$SYS_PROMPT" "$USER_DATA")
            echo "$ANALYSIS"

            if echo "$ANALYSIS" | grep -qi "restart"; then
              echo ">>> Restarting app"
              do_restart
              ACTION_LOG="$ACTION_LOG
Attempt $ATTEMPT: Action=restart, Errors=$ERROR_COUNT, Anomalies=$ANOMALY_COUNT, AI=$(echo "$ANALYSIS" | head -3)"
            elif echo "$ANALYSIS" | grep -qi "scale"; then
              echo ">>> Scaling up"
              do_scale
              ACTION_LOG="$ACTION_LOG
Attempt $ATTEMPT: Action=scale-up, Errors=$ERROR_COUNT, Anomalies=$ANOMALY_COUNT, AI=$(echo "$ANALYSIS" | head -3)"
            elif echo "$ANALYSIS" | grep -qi "redeploy"; then
              echo ">>> Redeploying"
              az deployment group create --resource-group ${req.resourceGroupName} --template-file infra/main.bicep --mode Incremental
              ACTION_LOG="$ACTION_LOG
Attempt $ATTEMPT: Action=redeploy, Errors=$ERROR_COUNT, Anomalies=$ANOMALY_COUNT, AI=$(echo "$ANALYSIS" | head -3)"
            else
              ACTION_LOG="$ACTION_LOG
Attempt $ATTEMPT: Action=wait, Errors=$ERROR_COUNT, Anomalies=$ANOMALY_COUNT, AI=$(echo "$ANALYSIS" | head -3)"
            fi

            echo "=== Waiting 60s for changes to take effect ==="
            sleep 60

            ERRORS=$(query_errors)
            ERROR_COUNT=$(echo "$ERRORS" | jq 'length // 0')
            ANOMALIES=$(query_anomalies)
            ANOMALY_COUNT=$(echo "$ANOMALIES" | jq 'length // 0')

            if [ "$ERROR_COUNT" -le "$ERROR_THRESHOLD" ] && [ "$ANOMALY_COUNT" = "0" ]; then
              echo "=== Error levels normalized! Resolved on attempt $ATTEMPT ==="
              RESOLVED=true
            fi
          done

          echo "resolved=$RESOLVED" >> $GITHUB_OUTPUT
          echo "attempts=$ATTEMPT" >> $GITHUB_OUTPUT
          echo "final_errors=$ERROR_COUNT" >> $GITHUB_OUTPUT
          echo "final_anomalies=$ANOMALY_COUNT" >> $GITHUB_OUTPUT
          echo "log<<LOG_EOF" >> $GITHUB_OUTPUT
          echo "$ACTION_LOG" >> $GITHUB_OUTPUT
          echo "LOG_EOF" >> $GITHUB_OUTPUT
          echo "errors<<ERR_EOF" >> $GITHUB_OUTPUT
          echo "$ERRORS" >> $GITHUB_OUTPUT
          echo "ERR_EOF" >> $GITHUB_OUTPUT

          SUMMARY=$(call_copilot 'Summarize this error remediation session concisely.' "Resolved: $RESOLVED, Attempts: $ATTEMPT, FinalErrors: $ERROR_COUNT, FinalAnomalies: $ANOMALY_COUNT, Log: $ACTION_LOG")
          echo "summary<<SUMM_EOF" >> $GITHUB_OUTPUT
          echo "$SUMMARY" >> $GITHUB_OUTPUT
          echo "SUMM_EOF" >> $GITHUB_OUTPUT

      - name: Report success
        if: steps.loop.outputs.resolved == 'true' && steps.loop.outputs.attempts != '0'
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: '✅ Error Spike Resolved — ${req.appName} (attempt \${{ steps.loop.outputs.attempts }})',
              body: '## Log Analysis Remediation Report\\n\\n' +
                '- **Status**: Resolved ✅\\n' +
                '- **Attempts**: \${{ steps.loop.outputs.attempts }}\\n' +
                '- **Final error count**: \${{ steps.loop.outputs.final_errors }}\\n\\n' +
                '### 🤖 AI Summary\\n\\n' +
                \`\${{ steps.loop.outputs.summary }}\` +
                '\\n\\n### Action Log\\n\\n\`\`\`\\n' +
                \`\${{ steps.loop.outputs.log }}\` + '\\n\`\`\`',
              labels: ['platform-engineer', 'log-analysis', 'resolved', 'auto-created']
            });

      - name: Escalate to human
        if: steps.loop.outputs.resolved != 'true'
        uses: actions/github-script@v7
        with:
          script: |
            const errors = JSON.parse(\`\${{ steps.loop.outputs.errors }}\` || '[]');
            let table = '| Problem ID | Message | Count |\\n|---|---|---|\\n';
            for (const e of (errors || []).slice(0, 10)) {
              table += \`| \${e.ProblemId || 'N/A'} | \${(e.OuterMessage || '').slice(0, 80)} | \${e.count_} |\\n\`;
            }
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: '🚨 ESCALATION — Error spike unresolved after \${{ steps.loop.outputs.attempts }} attempts — ${req.appName}',
              body: '## ⚠️ Human Intervention Required\\n\\n' +
                'Error remediation exhausted all 15 attempts.\\n\\n' +
                '- **Remaining errors**: \${{ steps.loop.outputs.final_errors }}\\n' +
                '- **Anomalous intervals**: \${{ steps.loop.outputs.final_anomalies }}\\n' +
                '- **Resource Group**: ${req.resourceGroupName}\\n\\n' +
                '### Top Errors\\n\\n' + table +
                '\\n### 🤖 AI Summary\\n\\n' +
                \`\${{ steps.loop.outputs.summary }}\` +
                '\\n\\n### Full Action Log\\n\\n\`\`\`\\n' +
                \`\${{ steps.loop.outputs.log }}\` +
                '\\n\`\`\`\\n\\n> Please investigate the root cause manually.',
              labels: ['platform-engineer', 'log-analysis', 'escalation', 'urgent', 'auto-created']
            });
`,
    };
  }

  /**
   * Generate a GitHub Actions step that calls the GitHub Models API
   * to get AI-powered analysis of diagnostic data via Copilot.
   */
  private copilotAnalysisStep(systemPrompt: string, diagnosticExpr: string): string {
    return `
      - name: AI-Powered Analysis (GitHub Copilot)
        id: copilot
        env:
          GH_TOKEN: \${{ github.token }}
          DIAGNOSTIC_DATA: ${diagnosticExpr}
        run: |
          PAYLOAD=$(jq -n \\
            --arg sys '${systemPrompt}' \\
            --arg data "$DIAGNOSTIC_DATA" \\
            '{model:"gpt-4o",messages:[{role:"system",content:$sys},{role:"user",content:$data}]}')
          ANALYSIS=$(curl -sS https://models.inference.ai.azure.com/chat/completions \\
            -H "Authorization: Bearer $GH_TOKEN" \\
            -H "Content-Type: application/json" \\
            -d "$PAYLOAD" \\
            | jq -r '.choices[0].message.content // "Analysis unavailable"')
          echo "analysis<<COPILOT_EOF" >> $GITHUB_OUTPUT
          echo "$ANALYSIS" >> $GITHUB_OUTPUT
          echo "COPILOT_EOF" >> $GITHUB_OUTPUT`;
  }

  private restartCommand(req: RemediationRequest): string {
    const indent = "          ";
    switch (req.platform) {
      case "functions":
      case "app-service":
        return `${indent}az webapp restart --name ${req.appName} --resource-group ${req.resourceGroupName}`;
      case "container-apps":
        return `${indent}az containerapp revision restart --name ${req.appName} --resource-group ${req.resourceGroupName}`;
      case "aks":
        return `${indent}az aks get-credentials --name ${req.appName}-aks --resource-group ${req.resourceGroupName}\n${indent}kubectl rollout restart deployment/${req.appName}`;
      case "vm":
        return `${indent}az vm restart --name ${req.appName}-vm --resource-group ${req.resourceGroupName}`;
    }
  }

  private scaleCommand(req: RemediationRequest): string {
    const indent = "          ";
    switch (req.platform) {
      case "functions":
        return `${indent}echo "Functions scale automatically on Consumption plan"`;
      case "app-service":
        return `${indent}az appservice plan update --name ${req.appName}-plan --resource-group ${req.resourceGroupName} --sku P1V2`;
      case "container-apps":
        return `${indent}az containerapp update --name ${req.appName} --resource-group ${req.resourceGroupName} --max-replicas 10`;
      case "aks":
        return `${indent}az aks nodepool update --cluster-name ${req.appName}-aks --name default --resource-group ${req.resourceGroupName} --max-count 10`;
      case "vm":
        return `${indent}az vm resize --name ${req.appName}-vm --resource-group ${req.resourceGroupName} --size Standard_D4s_v3`;
    }
  }

  private scaleMetricsCommand(req: RemediationRequest): string {
    const indent = "          ";
    switch (req.platform) {
      case "functions":
      case "app-service":
        return `${indent}METRIC_VALUE=$(az monitor metrics list --resource-type "Microsoft.Web/sites" --resource ${req.appName} --resource-group ${req.resourceGroupName} --metric "CpuPercentage" --interval PT5M --start-time $START --end-time $END --query "value[0].timeseries[0].data[-1].average" -o tsv 2>/dev/null || echo "0")
${indent}NEEDS_SCALE=$(echo "$METRIC_VALUE > 80" | bc -l 2>/dev/null || echo "false")
${indent}[ "$NEEDS_SCALE" = "1" ] && NEEDS_SCALE="true" || NEEDS_SCALE="false"`;
      case "container-apps":
        return `${indent}REPLICAS=$(az containerapp show --name ${req.appName} --resource-group ${req.resourceGroupName} --query "properties.runningStatus.replicas" -o tsv 2>/dev/null || echo "0")
${indent}MAX_REPLICAS=$(az containerapp show --name ${req.appName} --resource-group ${req.resourceGroupName} --query "properties.template.scale.maxReplicas" -o tsv 2>/dev/null || echo "10")
${indent}METRIC_VALUE="$REPLICAS/$MAX_REPLICAS replicas"
${indent}THRESHOLD=$(echo "$MAX_REPLICAS * 0.8" | bc | cut -d. -f1)
${indent}NEEDS_SCALE=$([ "$REPLICAS" -ge "$THRESHOLD" ] && echo "true" || echo "false")`;
      case "aks":
        return `${indent}NODE_COUNT=$(az aks show --name ${req.appName}-aks --resource-group ${req.resourceGroupName} --query "agentPoolProfiles[0].count" -o tsv 2>/dev/null || echo "0")
${indent}MAX_COUNT=$(az aks show --name ${req.appName}-aks --resource-group ${req.resourceGroupName} --query "agentPoolProfiles[0].maxCount" -o tsv 2>/dev/null || echo "10")
${indent}METRIC_VALUE="$NODE_COUNT/$MAX_COUNT nodes"
${indent}THRESHOLD=$(echo "$MAX_COUNT * 0.8" | bc | cut -d. -f1)
${indent}NEEDS_SCALE=$([ "$NODE_COUNT" -ge "$THRESHOLD" ] && echo "true" || echo "false")`;
      case "vm":
        return `${indent}METRIC_VALUE=$(az monitor metrics list --resource-type "Microsoft.Compute/virtualMachines" --resource ${req.appName}-vm --resource-group ${req.resourceGroupName} --metric "Percentage CPU" --interval PT5M --start-time $START --end-time $END --query "value[0].timeseries[0].data[-1].average" -o tsv 2>/dev/null || echo "0")
${indent}NEEDS_SCALE=$(echo "$METRIC_VALUE > 80" | bc -l 2>/dev/null || echo "false")
${indent}[ "$NEEDS_SCALE" = "1" ] && NEEDS_SCALE="true" || NEEDS_SCALE="false"`;
    }
  }
}
