# Platform Engineer Agent Instructions

## Code Conventions
- TypeScript with strict mode, ES2022 target, Node16 module resolution
- ESM modules (`"type": "module"` in package.json, `.js` extensions in imports)
- Zod v4 for schema validation (import from `zod/v4`)
- GitHub Copilot SDK for agent tools (`@github/copilot-sdk`)
- Express 5 for HTTP server

## Architecture
- `src/agent/` — Core agent logic (analyzer, recommender, tools, store)
- `src/infra-gen/` — Bicep template generation engine
- `src/azure/` — Azure deployment via ARM SDK + az CLI
- `src/monitoring/` — Azure Monitor alert configuration
- `src/github/` — GitHub API client, webhook handlers, remediation workflows
- `src/auth/` — Webhook signature verification
- `web/` — React 19 + Vite 6 dashboard

## Testing
- vitest for unit tests
- Test files colocated with source: `*.test.ts`
- Run: `npm test`

## Build
- Backend: `npm run build` (tsc)
- Frontend: `cd web && npm run build` (vite)
- Docker: `docker build -t platform-engineer-agent .`
- Deploy: `azd up`
