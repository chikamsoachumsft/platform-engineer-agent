/** Types for the App Analyzer engine (Step 4) */

export type Language =
  | "typescript"
  | "javascript"
  | "python"
  | "csharp"
  | "java"
  | "go"
  | "rust"
  | "ruby"
  | "php"
  | "unknown";

export type Framework =
  | "express"
  | "fastify"
  | "nextjs"
  | "remix"
  | "nuxt"
  | "angular"
  | "react-spa"
  | "vue-spa"
  | "django"
  | "flask"
  | "fastapi"
  | "spring-boot"
  | "aspnet"
  | "gin"
  | "fiber"
  | "rails"
  | "laravel"
  | "none"
  | "unknown";

export type AppType =
  | "static-site"
  | "web-api"
  | "full-stack"
  | "background-worker"
  | "event-driven"
  | "microservices";

export interface ContainerInfo {
  hasDockerfile: boolean;
  hasCompose: boolean;
  baseImage: string | null;
  exposedPorts: number[];
  /** Number of Dockerfiles found (>1 suggests microservices) */
  dockerfileCount: number;
}

export interface DependencyInfo {
  /** Total number of production dependencies */
  count: number;
  /** Key dependencies detected (databases, queues, caches, etc.) */
  notable: string[];
  /** Whether a lockfile was found */
  hasLockfile: boolean;
}

export interface DatabaseInfo {
  detected: boolean;
  types: string[]; // e.g. ["postgresql", "redis", "mongodb"]
}

export interface AppAnalysisReport {
  repoUrl: string;
  repoName: string;

  // Core detection
  languages: { language: Language; percentage: number }[];
  primaryLanguage: Language;
  framework: Framework;
  appType: AppType;

  // Infrastructure signals
  container: ContainerInfo;
  dependencies: DependencyInfo;
  databases: DatabaseInfo;

  // Runtime detection
  detectedPorts: number[];
  entryPoints: string[];
  hasTests: boolean;
  hasCi: boolean;

  // Metadata
  estimatedComplexity: "simple" | "moderate" | "complex";
  analysisTimestamp: string;
  warnings: string[];
}
