# Platform Engineer Agent — Full Build Plan

## What It Is
A GitHub Copilot SDK-powered TypeScript agent for the **FY26 SDK Challenge** that acts as an automated platform engineer. Give it any repo (e.g. a vibe-coded app) and it will:
1. **Analyze** the code to understand the tech stack
2. **Recommend** the best Azure hosting platform via a weighted scoring matrix
3. **Generate** Bicep IaC and deploy to Azure
4. **Set up monitoring** with Application Insights + Log Analytics
5. **Continuously watch** for platform issues via GitHub Actions
6. **Auto-remediate** common problems (scaling, restarts, certs, etc.)

All shareable per-repo via GitHub App + GitHub Actions workflows.

---

## Stack
- **Language**: TypeScript (matches Copilot SDK)
- **Agent SDK**: `@github/copilot-sdk` (npm)
- **Server**: Express 5
- **IaC**: Bicep (generated per platform)
- **Deployment**: Azure Developer CLI (`azd`)
- **Auth**: OIDC (zero secrets) — auto-create Entra App + federated creds
- **CI/CD**: GitHub Actions (10 workflows for target repos)
- **Dashboard**: React + Vite
- **Azure SDKs**: `@azure/arm-appservice`, `@azure/arm-containerregistry`, `@azure/arm-monitor`, etc.

---

## Key Decisions
| Decision | Choice | Why |
|----------|--------|-----|
| Language | TypeScript | Copilot SDK is TS-native |
| IaC | Bicep over Terraform | Native Azure, simpler for generated templates |
| Deployment | azd | Handles build+push+provision in one command |
| Monitoring | App Insights + Log Analytics + KQL | Native Azure observability |
| Scoring | Weighted matrix | Transparent, explainable recommendations |
| Auth | OIDC federated creds | Zero secrets stored, best practice |
| Destructive ops | Approval gates | Agent asks before scaling down, deleting, etc. |
| Distribution | GitHub App (primary) + GitHub Action (secondary) | Works in GitHub.com chat + CI/CD |
| Config | Conversational (agent asks 2-3 questions) | No YAML files to configure |

---

## Architecture

### User Flow
```
Install GitHub App → @platform-engineer in chat → OAuth/OIDC consent
→ Agent analyzes repo → Recommends platform → User approves
→ Generates Bicep → Deploys via azd → Sets up monitoring
→ Installs GitHub Actions workflows → Continuous monitoring loop
→ Auto-remediation on issues (with approval for destructive ops)
```

### Agent Interfaces
1. **GitHub App / Copilot Extension** — `@platform-engineer` in GitHub.com, PRs, Issues
2. **VS Code Chat Agent** — Interactive in VS Code via Copilot Extension
3. **GitHub Actions** — Scheduled workflows for health checks, cost reports, drift detection
4. **Web Dashboard** — React + Vite UI showing platform health, costs, deployment status

### Core Modules
```
src/
├── index.ts                    # Express server + routes
├── config.ts                   # Environment config loader
├── agent/
│   ├── agent.ts                # CopilotClient wrapper, session management
│   ├── system-prompt.ts        # Agent persona + capabilities
│   └── tools.ts                # 7 tool definitions with Zod schemas
├── auth/                       # OAuth + OIDC + Entra App Registration
├── azure/                      # Azure SDK wrappers for resource provisioning
├── github/
│   └── templates/              # GitHub Actions workflow templates (10 workflows)
├── infra-gen/
│   └── templates/
│       ├── aks/                # AKS Bicep templates
│       ├── app-service/        # App Service Bicep templates
│       ├── container-apps/     # Container Apps Bicep templates
│       ├── functions/          # Azure Functions Bicep templates
│       ├── vm/                 # VM/VMSS Bicep templates
│       └── common/             # Shared modules (networking, identity, monitoring)
├── monitoring/                 # App Insights + Log Analytics + alert rules
web/
├── src/
│   ├── pages/                  # Dashboard pages
│   └── components/             # React components
infra/
└── modules/                    # Bicep for the agent's own Azure hosting
```

---

## Platform Scoring Matrix
The agent uses a weighted scoring matrix to recommend the best Azure platform:

| Factor | Weight | Functions | App Service | Container Apps | AKS | VMs |
|--------|--------|-----------|-------------|----------------|-----|-----|
| Stateless/event-driven | 20% | 10 | 5 | 7 | 6 | 3 |
| Container-ready | 15% | 3 | 5 | 10 | 10 | 7 |
| Expected scale | 15% | 8 (burst) | 5 | 9 | 10 | 6 |
| Cost sensitivity | 15% | 10 (pay-per-use) | 6 | 7 | 4 | 5 |
| Complexity tolerance | 10% | 9 (simple) | 8 | 7 | 3 | 4 |
| Startup time needs | 10% | 5 (cold starts) | 8 | 9 | 7 | 6 |
| Custom networking | 10% | 3 | 6 | 7 | 10 | 10 |
| GPU/ML workloads | 5% | 1 | 2 | 5 | 9 | 10 |

Agent classifies the app, scores each platform, and recommends with explanation.

---

## GitHub Actions Workflows (Generated for Target Repos)
The agent generates and installs these 10 workflows:

1. **health-check.yml** — Scheduled endpoint health + resource health checks
2. **cost-report.yml** — Weekly Azure cost breakdown + optimization suggestions
3. **drift-detection.yml** — Compare deployed infra vs Bicep (what-if)
4. **security-scan.yml** — Dependency vulns + Azure security posture
5. **performance-test.yml** — Automated load testing + regression detection
6. **backup-verification.yml** — Verify backup/restore for databases + storage
7. **certificate-renewal.yml** — TLS cert expiry monitoring + auto-renewal
8. **scale-monitor.yml** — Autoscale event tracking + capacity alerts
9. **log-analysis.yml** — KQL queries for error patterns + anomalies
10. **auto-remediate.yml** — Triggered by alerts, runs remediation playbooks

---

## Auto-Remediation Playbooks
| Issue | Action | Approval? |
|-------|--------|-----------|
| High CPU/memory | Scale up/out | No (auto) |
| Unhealthy instance | Restart | No (auto) |
| TLS cert expiring | Renew via Key Vault | No (auto) |
| Image pull failure | Re-push + redeploy | No (auto) |
| Cold start latency | Enable always-on / premium plan | Yes |
| Scale down after spike | Reduce instance count | Yes |
| Platform migration | Switch from AppService → ContainerApps | Yes |
| Resource deletion | Remove unused resources | Yes |

---

## OIDC / Auth Flow
```
User installs GitHub App
→ Agent detects new installation
→ Prompts user for Azure subscription
→ Auto-creates Entra App Registration (via Graph API)
→ Configures federated credentials (OIDC for GitHub Actions)
→ Stores subscription ID + tenant ID as GitHub repo secrets
→ Zero long-lived secrets — all auth via OIDC tokens
```

**Agent's own requirements**:
- Entra App Registration with `Application.ReadWrite.All` (Graph API)
- Azure-hosted Express API (Container Apps or App Service)
- GitHub App with repo admin + actions permissions

---

## Build Steps (Implementation Order)

### Phase 1: Foundation ✅
| Step | What | Status |
|------|------|--------|
| 1 | Scaffold project, install deps, directory structure | ✅ Done |
| 2 | Express server + Copilot SDK entry point (`CopilotClient`, sessions, tool stubs) | ✅ Done |

### Phase 2: Core Engine ✅
| Step | What | Status |
|------|------|--------|
| 3 | **System prompt refinement** — fine-tune the agent persona + platform-specific knowledge | ✅ Done |
| 4 | **App Analyzer Engine** — scan repo for: language, framework, Dockerfile, dependencies, ports, DB connections, queue usage, etc. Classify as: web app, API, worker, event-driven, static site, ML | ✅ Done |
| 5 | **Platform Recommender** — weighted scoring matrix, explain rationale, handle edge cases | ✅ Done |

### Phase 3: Infrastructure ✅
| Step | What | Status |
|------|------|--------|
| 6 | **IaC Generator** — per-platform Bicep template generation (parameterized), common modules for networking/identity/monitoring | ✅ Done |
| 7 | **Deployer Module** — run `azd up` or `az deployment` with error recovery, handle container builds + ACR push | ✅ Done |
| 8 | **OAuth + OIDC Auth Flow** — Entra App auto-creation, federated creds for GH Actions, token management | ✅ Done |

### Phase 4: Observability ✅
| Step | What | Status |
|------|------|--------|
| 9 | **Monitoring Setup** — provision App Insights + Log Analytics, configure alerts (CPU, memory, response time, 5xx), notification groups | ✅ Done |
| 10 | **Deployment Status Checker** — KQL queries for deployment health, resource metrics, live diagnostics | ✅ Done |

### Phase 5: Continuous Operations ✅
| Step | What | Status |
|------|------|--------|
| 11 | **GitHub Actions Workflow Generator** — generate + commit the 10 monitoring/maintenance workflows | ✅ Done |
| 12 | **Auto-Remediation Engine** — playbook execution, approval gates, issue triage | ✅ Done |
| 13 | **Orchestrator** — end-to-end flow: analyze → recommend → deploy → monitor → remediate | ✅ Done |

### Phase 6: Integration & Packaging ✅
| Step | What | Status |
|------|------|--------|
| 14 | **Web Dashboard** — React + Vite UI: deployment overview, health status, cost charts, alert feed | ✅ Done |
| 15 | **GitHub App Manifest** — webhook handlers, installation flow, Copilot Extension registration | ✅ Done |
| 16 | **Agent's Own Infra** — Bicep for hosting the agent itself on Azure (Container Apps + ACR) | ✅ Done |
| 17 | **Dockerfile + azure.yaml** — containerize agent, azd config for self-deployment | ✅ Done |

---

## Current State (as of last session)
- **Steps 1-2 complete**: Project scaffolded, Express server running, Copilot SDK integrated with `CopilotClient`, 7 tool stubs defined with Zod schemas, system prompt written
- **Step 2 partial**: Was reading Copilot SDK type definitions (`client.d.ts`, `session.d.ts`, `types.d.ts`) to understand the API surface
- **Next up**: Steps 3-5 (analyzer + recommender) are the core differentiator

## 7 Agent Tools (Already Defined)
1. `analyze_repo` — input: `repoUrl` → output: tech stack analysis
2. `recommend_platform` — input: `repoUrl` → output: scored platform recommendation
3. `generate_infra` — input: `repoUrl`, `platform` (functions/app-service/container-apps/aks/vm), `region`, `resourceGroupName` → output: Bicep files
4. `deploy` — input: `repoUrl`, `subscriptionId`, `resourceGroupName`, `region` → output: deployment result
5. `setup_monitoring` — input: `resourceGroupName`, `subscriptionId` → output: monitoring config
6. `setup_remediation` — input: `repoUrl`, `resourceGroupName`, `subscriptionId` → output: GitHub Actions workflows
7. `check_deployment_status` — input: `resourceGroupName`, `subscriptionId` → output: health report
