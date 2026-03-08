import { GitHubClient, type RepoFile } from "../github/client.js";
import type {
  AppAnalysisReport,
  AppType,
  ContainerInfo,
  DatabaseInfo,
  DependencyInfo,
  Framework,
  Language,
} from "./types.js";

// ── Extension → Language mapping ────────────────────────────────────
const EXT_LANGUAGE: Record<string, Language> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".cs": "csharp",
  ".java": "java",
  ".go": "go",
  ".rs": "rust",
  ".rb": "ruby",
  ".php": "php",
};

// ── Framework detection patterns ────────────────────────────────────
interface FrameworkPattern {
  framework: Framework;
  /** Files that must exist (any) */
  files?: string[];
  /** Dependency names in package.json / requirements.txt / *.csproj etc. */
  deps?: string[];
}

const FRAMEWORK_PATTERNS: FrameworkPattern[] = [
  { framework: "nextjs", files: ["next.config.js", "next.config.mjs", "next.config.ts"], deps: ["next"] },
  { framework: "remix", deps: ["@remix-run/react", "@remix-run/node"] },
  { framework: "nuxt", files: ["nuxt.config.ts", "nuxt.config.js"], deps: ["nuxt"] },
  { framework: "angular", files: ["angular.json"], deps: ["@angular/core"] },
  { framework: "fastify", deps: ["fastify"] },
  { framework: "express", deps: ["express"] },
  { framework: "fastapi", deps: ["fastapi"] },
  { framework: "flask", deps: ["flask", "Flask"] },
  { framework: "django", files: ["manage.py"], deps: ["django", "Django"] },
  { framework: "spring-boot", deps: ["spring-boot-starter-web"] },
  { framework: "aspnet", deps: ["Microsoft.AspNetCore"] },
  { framework: "gin", deps: ["github.com/gin-gonic/gin"] },
  { framework: "fiber", deps: ["github.com/gofiber/fiber"] },
  { framework: "rails", files: ["Gemfile"], deps: ["rails"] },
  { framework: "laravel", files: ["artisan"], deps: ["laravel/framework"] },
];

// ── Database indicator patterns ─────────────────────────────────────
const DB_INDICATORS: Record<string, string[]> = {
  postgresql: ["pg", "psycopg2", "psycopg", "Npgsql", "postgresql", "postgres", "typeorm", "prisma", "drizzle-orm"],
  mysql: ["mysql", "mysql2", "mysqlclient", "pymysql"],
  mongodb: ["mongoose", "mongodb", "mongoid", "Motor"],
  redis: ["redis", "ioredis", "aioredis", "StackExchange.Redis"],
  sqlite: ["better-sqlite3", "sqlite3", "rusqlite"],
  cosmosdb: ["@azure/cosmos", "azure-cosmos"],
  dynamodb: ["@aws-sdk/client-dynamodb", "boto3"],
};

export class Analyzer {
  private github: GitHubClient;

  constructor(githubToken?: string) {
    this.github = new GitHubClient(githubToken);
  }

  async analyze(repoUrl: string): Promise<AppAnalysisReport> {
    const { owner, repo } = GitHubClient.parseRepoUrl(repoUrl);
    const warnings: string[] = [];

    // 1. Fetch file tree + repo info in parallel
    const [files, repoInfo] = await Promise.all([
      this.github.listAllFiles(owner, repo),
      this.github.getRepoInfo(owner, repo),
    ]);

    // 2. Detect languages from file extensions
    const languages = this.detectLanguages(files);
    const primaryLanguage = languages[0]?.language ?? "unknown";

    // 3. Identify key config files to fetch
    const filePaths = files.map((f) => f.path);
    const configFiles = this.identifyConfigFiles(filePaths, primaryLanguage);

    // 4. Fetch config file contents in parallel
    const contents = await this.github.getMultipleFiles(owner, repo, configFiles);
    const contentMap = new Map(contents.map((c) => [c.path, c.content]));

    // 5. Detect framework & dependencies
    const allDeps = this.extractDependencies(filePaths, contentMap, primaryLanguage);
    const framework = this.detectFramework(filePaths, allDeps);

    // 6. Container detection
    const container = this.detectContainer(filePaths, contentMap);

    // 7. Database detection
    const databases = this.detectDatabases(allDeps);

    // 8. Port detection
    const detectedPorts = [
      ...container.exposedPorts,
      ...this.detectPortsFromConfig(contentMap),
    ];
    const uniquePorts = [...new Set(detectedPorts)];

    // 9. Entry points
    const entryPoints = this.detectEntryPoints(filePaths, primaryLanguage);

    // 10. CI & Tests
    const hasCi = filePaths.some(
      (p) =>
        p.startsWith(".github/workflows/") ||
        p === ".gitlab-ci.yml" ||
        p === "Jenkinsfile" ||
        p === ".circleci/config.yml" ||
        p === "azure-pipelines.yml",
    );
    const hasTests = filePaths.some(
      (p) =>
        p.includes("test") ||
        p.includes("spec") ||
        p.includes("__tests__") ||
        p.includes("tests/"),
    );

    // 11. Classify app type
    const appType = this.classifyAppType(
      framework,
      container,
      filePaths,
      allDeps,
      primaryLanguage,
    );

    // 12. Estimate complexity
    const fileCount = files.filter((f) => f.type === "file").length;
    const estimatedComplexity =
      fileCount > 200 || container.dockerfileCount > 2
        ? "complex"
        : fileCount > 50
          ? "moderate"
          : "simple";

    return {
      repoUrl,
      repoName: `${owner}/${repo}`,
      languages,
      primaryLanguage,
      framework,
      appType,
      container,
      dependencies: {
        count: allDeps.length,
        notable: allDeps.filter((d) => this.isNotableDep(d)),
        hasLockfile: filePaths.some(
          (p) =>
            p === "package-lock.json" ||
            p === "yarn.lock" ||
            p === "pnpm-lock.yaml" ||
            p === "Pipfile.lock" ||
            p === "poetry.lock" ||
            p === "go.sum" ||
            p === "Cargo.lock" ||
            p === "Gemfile.lock" ||
            p === "composer.lock",
        ),
      },
      databases,
      detectedPorts: uniquePorts,
      entryPoints,
      hasTests,
      hasCi,
      estimatedComplexity,
      analysisTimestamp: new Date().toISOString(),
      warnings,
    };
  }

  // ── Language detection ──────────────────────────────────────────────

  private detectLanguages(
    files: RepoFile[],
  ): { language: Language; percentage: number }[] {
    const counts = new Map<Language, number>();
    let total = 0;

    for (const file of files) {
      if (file.type !== "file") continue;
      const ext = this.getExtension(file.path);
      const lang = EXT_LANGUAGE[ext];
      if (lang) {
        counts.set(lang, (counts.get(lang) ?? 0) + file.size);
        total += file.size;
      }
    }

    if (total === 0) return [{ language: "unknown", percentage: 100 }];

    return [...counts.entries()]
      .map(([language, bytes]) => ({
        language,
        percentage: Math.round((bytes / total) * 100),
      }))
      .sort((a, b) => b.percentage - a.percentage);
  }

  // ── Config file identification ──────────────────────────────────────

  private identifyConfigFiles(filePaths: string[], primaryLang: Language): string[] {
    const candidates = [
      "package.json",
      "requirements.txt",
      "Pipfile",
      "pyproject.toml",
      "go.mod",
      "Cargo.toml",
      "pom.xml",
      "build.gradle",
      "Gemfile",
      "composer.json",
      "Dockerfile",
      "docker-compose.yml",
      "docker-compose.yaml",
      ".env.example",
      ".env",
      "next.config.js",
      "next.config.mjs",
      "next.config.ts",
      "nuxt.config.ts",
      "angular.json",
      "vite.config.ts",
      "tsconfig.json",
    ];

    // Also pick up any extra Dockerfiles
    const dockerfiles = filePaths.filter(
      (p) => p === "Dockerfile" || p.match(/^[^/]+\/Dockerfile$/),
    );

    // .csproj files
    const csprojFiles = filePaths.filter((p) => p.endsWith(".csproj")).slice(0, 5);

    const allCandidates = [...new Set([...candidates, ...dockerfiles, ...csprojFiles])];
    return allCandidates.filter((c) => filePaths.includes(c));
  }

  // ── Dependency extraction ───────────────────────────────────────────

  private extractDependencies(
    filePaths: string[],
    contentMap: Map<string, string>,
    primaryLang: Language,
  ): string[] {
    const deps: string[] = [];

    // package.json
    const packageJson = contentMap.get("package.json");
    if (packageJson) {
      try {
        const pkg = JSON.parse(packageJson);
        deps.push(
          ...Object.keys(pkg.dependencies ?? {}),
          ...Object.keys(pkg.devDependencies ?? {}),
        );
      } catch { /* malformed */ }
    }

    // requirements.txt
    const requirements = contentMap.get("requirements.txt");
    if (requirements) {
      for (const line of requirements.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const name = trimmed.split(/[>=<!\[;]/)[0].trim();
          if (name) deps.push(name);
        }
      }
    }

    // pyproject.toml (basic extraction)
    const pyproject = contentMap.get("pyproject.toml");
    if (pyproject) {
      const depsSection = pyproject.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
      if (depsSection) {
        const matches = depsSection[1].matchAll(/"([^">=<!\[]+)/g);
        for (const m of matches) deps.push(m[1].trim());
      }
    }

    // go.mod
    const goMod = contentMap.get("go.mod");
    if (goMod) {
      const requireBlock = goMod.match(/require\s*\(([\s\S]*?)\)/);
      if (requireBlock) {
        for (const line of requireBlock[1].split("\n")) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith("//")) {
            const parts = trimmed.split(/\s+/);
            if (parts[0]) deps.push(parts[0]);
          }
        }
      }
    }

    // Cargo.toml
    const cargoToml = contentMap.get("Cargo.toml");
    if (cargoToml) {
      const depsMatch = cargoToml.match(/\[dependencies\]([\s\S]*?)(\[|$)/);
      if (depsMatch) {
        for (const line of depsMatch[1].split("\n")) {
          const name = line.split("=")[0]?.trim();
          if (name && !name.startsWith("[") && !name.startsWith("#")) deps.push(name);
        }
      }
    }

    // .csproj files
    for (const [path, content] of contentMap) {
      if (path.endsWith(".csproj")) {
        const matches = content.matchAll(/PackageReference\s+Include="([^"]+)"/g);
        for (const m of matches) deps.push(m[1]);
      }
    }

    // Gemfile
    const gemfile = contentMap.get("Gemfile");
    if (gemfile) {
      const matches = gemfile.matchAll(/gem\s+['"]([^'"]+)['"]/g);
      for (const m of matches) deps.push(m[1]);
    }

    // composer.json
    const composerJson = contentMap.get("composer.json");
    if (composerJson) {
      try {
        const composer = JSON.parse(composerJson);
        deps.push(...Object.keys(composer.require ?? {}));
      } catch { /* malformed */ }
    }

    return [...new Set(deps)];
  }

  // ── Framework detection ─────────────────────────────────────────────

  private detectFramework(filePaths: string[], deps: string[]): Framework {
    const fileSet = new Set(filePaths);

    for (const pattern of FRAMEWORK_PATTERNS) {
      const hasFile = pattern.files?.some((f) => fileSet.has(f));
      const hasDep = pattern.deps?.some((d) => deps.includes(d));
      if (hasFile || hasDep) return pattern.framework;
    }

    // SPA detection
    if (deps.includes("react") || deps.includes("react-dom")) return "react-spa";
    if (deps.includes("vue")) return "vue-spa";

    return "unknown";
  }

  // ── Container detection ─────────────────────────────────────────────

  private detectContainer(
    filePaths: string[],
    contentMap: Map<string, string>,
  ): ContainerInfo {
    const dockerfiles = filePaths.filter(
      (p) => p.endsWith("Dockerfile") || p.match(/Dockerfile\./),
    );
    const hasCompose = filePaths.some(
      (p) => p === "docker-compose.yml" || p === "docker-compose.yaml",
    );

    let baseImage: string | null = null;
    const exposedPorts: number[] = [];

    const dfContent = contentMap.get("Dockerfile");
    if (dfContent) {
      // Base image: first FROM line
      const fromMatch = dfContent.match(/^FROM\s+(\S+)/m);
      if (fromMatch) baseImage = fromMatch[1];

      // Exposed ports
      const exposeMatches = dfContent.matchAll(/^EXPOSE\s+(.+)/gm);
      for (const m of exposeMatches) {
        for (const token of m[1].split(/\s+/)) {
          const port = parseInt(token, 10);
          if (!isNaN(port)) exposedPorts.push(port);
        }
      }
    }

    return {
      hasDockerfile: dockerfiles.length > 0,
      hasCompose,
      baseImage,
      exposedPorts,
      dockerfileCount: dockerfiles.length,
    };
  }

  // ── Database detection ──────────────────────────────────────────────

  private detectDatabases(deps: string[]): DatabaseInfo {
    const types: string[] = [];

    for (const [dbType, indicators] of Object.entries(DB_INDICATORS)) {
      if (indicators.some((ind) => deps.includes(ind))) {
        types.push(dbType);
      }
    }

    return { detected: types.length > 0, types };
  }

  // ── Port detection from config files ────────────────────────────────

  private detectPortsFromConfig(contentMap: Map<string, string>): number[] {
    const ports: number[] = [];

    for (const [path, content] of contentMap) {
      // .env files
      if (path.endsWith(".env") || path.endsWith(".env.example")) {
        const match = content.match(/PORT\s*=\s*(\d+)/);
        if (match) ports.push(parseInt(match[1], 10));
      }

      // package.json scripts with --port
      if (path === "package.json") {
        try {
          const pkg = JSON.parse(content);
          const scripts = Object.values(pkg.scripts ?? {}) as string[];
          for (const s of scripts) {
            const match = s.match(/--port\s+(\d+)|-p\s+(\d+)/);
            if (match) ports.push(parseInt(match[1] || match[2], 10));
          }
        } catch { /* ignore */ }
      }
    }

    return ports;
  }

  // ── Entry point detection ───────────────────────────────────────────

  private detectEntryPoints(filePaths: string[], lang: Language): string[] {
    const candidates: string[] = [];
    const common: Record<Language, string[]> = {
      typescript: ["src/index.ts", "src/main.ts", "src/app.ts", "src/server.ts", "index.ts"],
      javascript: ["src/index.js", "src/main.js", "src/app.js", "src/server.js", "index.js"],
      python: ["app.py", "main.py", "manage.py", "wsgi.py", "asgi.py", "src/main.py"],
      csharp: ["Program.cs"],
      java: ["src/main/java"],
      go: ["main.go", "cmd/main.go"],
      rust: ["src/main.rs"],
      ruby: ["config.ru", "app.rb"],
      php: ["index.php", "public/index.php"],
      unknown: [],
    };

    const fileSet = new Set(filePaths);
    for (const entry of common[lang] ?? common.unknown) {
      if (fileSet.has(entry)) candidates.push(entry);
    }
    return candidates;
  }

  // ── App type classification ─────────────────────────────────────────

  private classifyAppType(
    framework: Framework,
    container: ContainerInfo,
    filePaths: string[],
    deps: string[],
    lang: Language,
  ): AppType {
    // Microservices: multiple Dockerfiles or docker-compose with multiple services
    if (container.dockerfileCount > 2) return "microservices";

    // Static site frameworks
    const staticFrameworks: Framework[] = ["react-spa", "vue-spa", "angular"];
    if (staticFrameworks.includes(framework)) {
      // Could be full-stack if it also has server-side code
      const hasServer = deps.some((d) =>
        ["express", "fastify", "koa", "hapi"].includes(d),
      );
      return hasServer ? "full-stack" : "static-site";
    }

    // Full-stack frameworks
    if (["nextjs", "remix", "nuxt"].includes(framework)) return "full-stack";

    // Event-driven signals
    const eventDeps = [
      "@azure/functions",
      "aws-lambda",
      "@google-cloud/functions-framework",
      "bull",
      "bullmq",
      "amqplib",
      "kafkajs",
    ];
    if (eventDeps.some((d) => deps.includes(d))) return "event-driven";

    // Background worker: no web framework, has queue/scheduler deps
    const workerDeps = ["node-cron", "agenda", "celery", "rq", "sidekiq"];
    const hasWebFramework = [
      "express", "fastify", "flask", "django", "fastapi",
      "spring-boot", "aspnet", "gin", "fiber", "rails", "laravel",
    ].includes(framework);

    if (!hasWebFramework && workerDeps.some((d) => deps.includes(d))) {
      return "background-worker";
    }

    // Web API: has a server framework but no frontend
    if (hasWebFramework) {
      const hasFrontend = filePaths.some(
        (p) =>
          p.startsWith("public/") ||
          p.startsWith("static/") ||
          p.startsWith("client/") ||
          p.startsWith("frontend/") ||
          p.startsWith("web/"),
      );
      return hasFrontend ? "full-stack" : "web-api";
    }

    // Fallback: look at file patterns for HTML
    const hasHtml = filePaths.some((p) => p.endsWith(".html") && !p.includes("test"));
    return hasHtml ? "static-site" : "web-api";
  }

  // ── Utility ─────────────────────────────────────────────────────────

  private getExtension(path: string): string {
    const lastDot = path.lastIndexOf(".");
    return lastDot >= 0 ? path.substring(lastDot) : "";
  }

  private isNotableDep(dep: string): boolean {
    const notable = new Set([
      // Databases
      "pg", "mysql2", "mongoose", "mongodb", "redis", "ioredis", "prisma",
      "@prisma/client", "typeorm", "drizzle-orm", "sequelize", "@azure/cosmos",
      // Queues
      "bullmq", "bull", "amqplib", "kafkajs",
      // Auth
      "passport", "next-auth", "@auth/core",
      // Azure
      "@azure/functions", "@azure/storage-blob", "@azure/keyvault-secrets",
      "@azure/identity", "@azure/service-bus", "@azure/event-hubs",
      // Infra
      "docker-compose", "kubernetes-client",
      // Monitoring
      "applicationinsights", "@opentelemetry/sdk-node", "prom-client",
    ]);
    return notable.has(dep);
  }
}
