import { Octokit } from "@octokit/rest";

export interface RepoFile {
  path: string;
  type: "file" | "dir";
  size: number;
}

export interface RepoFileContent {
  path: string;
  content: string;
}

export class GitHubClient {
  private octokit: Octokit;

  constructor(token?: string) {
    this.octokit = new Octokit(token ? { auth: token } : undefined);
  }

  /** Parse "https://github.com/owner/repo" → { owner, repo } */
  static parseRepoUrl(url: string): { owner: string; repo: string } {
    const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) throw new Error(`Invalid GitHub repo URL: ${url}`);
    return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
  }

  /** List all files in the repo root (non-recursive) */
  async listRootContents(owner: string, repo: string): Promise<RepoFile[]> {
    const { data } = await this.octokit.repos.getContent({ owner, repo, path: "" });
    if (!Array.isArray(data)) return [];
    return data.map((item) => ({
      path: item.path,
      type: item.type === "dir" ? "dir" : "file",
      size: item.size ?? 0,
    }));
  }

  /** List files recursively via the Git tree API (up to ~100k files) */
  async listAllFiles(owner: string, repo: string): Promise<RepoFile[]> {
    const { data: refData } = await this.octokit.git.getRef({
      owner,
      repo,
      ref: "heads/main",
    }).catch(() =>
      // fallback to master
      this.octokit.git.getRef({ owner, repo, ref: "heads/master" })
    );
    const sha = refData.object.sha;

    const { data: treeData } = await this.octokit.git.getTree({
      owner,
      repo,
      tree_sha: sha,
      recursive: "true",
    });

    return treeData.tree
      .filter((item) => item.path && item.type)
      .map((item) => ({
        path: item.path!,
        type: item.type === "tree" ? "dir" as const : "file" as const,
        size: item.size ?? 0,
      }));
  }

  /** Get a single file's text content (base64-decoded) */
  async getFileContent(owner: string, repo: string, path: string): Promise<string | null> {
    try {
      const { data } = await this.octokit.repos.getContent({ owner, repo, path });
      if ("content" in data && data.encoding === "base64") {
        return Buffer.from(data.content, "base64").toString("utf-8");
      }
      return null;
    } catch {
      return null;
    }
  }

  /** Batch-fetch multiple files */
  async getMultipleFiles(
    owner: string,
    repo: string,
    paths: string[],
  ): Promise<RepoFileContent[]> {
    const results: RepoFileContent[] = [];
    // Fetch in parallel batches of 10
    for (let i = 0; i < paths.length; i += 10) {
      const batch = paths.slice(i, i + 10);
      const fetched = await Promise.all(
        batch.map(async (path) => {
          const content = await this.getFileContent(owner, repo, path);
          return content !== null ? { path, content } : null;
        }),
      );
      for (const item of fetched) {
        if (item) results.push(item);
      }
    }
    return results;
  }

  /** Get repo metadata (default branch, description, topics, etc.) */
  async getRepoInfo(owner: string, repo: string) {
    const { data } = await this.octokit.repos.get({ owner, repo });
    return {
      defaultBranch: data.default_branch,
      description: data.description,
      language: data.language,
      topics: data.topics ?? [],
      isPrivate: data.private,
      size: data.size,
    };
  }
}
