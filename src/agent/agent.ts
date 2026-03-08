import {
  CopilotClient,
  CopilotSession,
  approveAll,
  type AssistantMessageEvent,
} from "@github/copilot-sdk";
import { config } from "../config.js";
import { agentTools } from "./tools.js";
import { SYSTEM_PROMPT } from "./system-prompt.js";

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentResponse {
  content: string;
  sessionId: string;
}

export class PlatformEngineerAgent {
  private client: CopilotClient;
  private sessions = new Map<string, CopilotSession>();

  constructor() {
    this.client = new CopilotClient({
      logLevel: config.nodeEnv === "development" ? "debug" : "warning",
      ...(process.env.GITHUB_TOKEN ? { githubToken: process.env.GITHUB_TOKEN } : {}),
    });
  }

  /** Start the underlying Copilot CLI server */
  async start(): Promise<void> {
    await this.client.start();
    console.log("[Agent] Copilot SDK client started");
  }

  /** Stop the client and clean up all sessions */
  async stop(): Promise<void> {
    const errors = await this.client.stop();
    if (errors.length > 0) {
      console.error("[Agent] Cleanup errors:", errors);
    }
    this.sessions.clear();
    console.log("[Agent] Copilot SDK client stopped");
  }

  /**
   * Handle a user message — creates or reuses a session, sends the prompt,
   * and returns the assistant's response.
   */
  async chat(
    sessionKey: string,
    userMessage: string,
  ): Promise<AgentResponse> {
    let session = this.sessions.get(sessionKey);

    if (!session) {
      session = await this.client.createSession({
        model: config.copilotModel,
        tools: agentTools,
        systemMessage: {
          mode: "append",
          content: SYSTEM_PROMPT,
        },
        onPermissionRequest: approveAll,
      });
      this.sessions.set(sessionKey, session);
      console.log(`[Agent] Created session ${session.sessionId} for key=${sessionKey}`);
    }

    const response = await session.sendAndWait(
      { prompt: userMessage },
      120_000,
    );

    const content = response?.data?.content ?? "(no response)";

    return {
      content,
      sessionId: session.sessionId,
    };
  }

  /** Destroy a specific session */
  async destroySession(sessionKey: string): Promise<void> {
    const session = this.sessions.get(sessionKey);
    if (session) {
      await session.destroy();
      this.sessions.delete(sessionKey);
    }
  }
}
