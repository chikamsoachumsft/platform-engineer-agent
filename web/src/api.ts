export interface DeploymentRecord {
  id: string;
  repoUrl: string;
  platform: string;
  subscriptionId: string;
  resourceGroupName: string;
  region: string;
  status: "pending" | "deploying" | "succeeded" | "failed";
  createdAt: string;
  updatedAt: string;
  outputs: Record<string, string>;
  error?: string;
}

export interface ChatMessage {
  role: "user" | "agent";
  content: string;
}

export interface ChatResponse {
  content: string;
  sessionId: string;
}

const BASE = "/api";

export async function fetchDeployments(): Promise<DeploymentRecord[]> {
  const res = await fetch(`${BASE}/deployments`);
  if (!res.ok) throw new Error("Failed to fetch deployments");
  return res.json();
}

export async function fetchDeployment(id: string): Promise<DeploymentRecord> {
  const res = await fetch(`${BASE}/deployments/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error("Deployment not found");
  return res.json();
}

export async function sendMessage(sessionId: string, message: string): Promise<ChatResponse> {
  const res = await fetch(`${BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, message }),
  });
  if (!res.ok) throw new Error("Chat request failed");
  return res.json();
}

export async function fetchHealth(): Promise<{ status: string; version: string }> {
  const res = await fetch(`${BASE}/../health`);
  if (!res.ok) throw new Error("Health check failed");
  return res.json();
}
