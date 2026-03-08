import { useEffect, useState } from "react";
import { type DeploymentRecord, fetchDeployments } from "../api";
import { StatusBadge } from "../components/StatusBadge";

export function Dashboard() {
  const [deployments, setDeployments] = useState<DeploymentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDeployments()
      .then(setDeployments)
      .catch(() => setDeployments([]))
      .finally(() => setLoading(false));
  }, []);

  const succeeded = deployments.filter((d) => d.status === "succeeded").length;
  const failed = deployments.filter((d) => d.status === "failed").length;
  const inProgress = deployments.filter((d) => d.status === "deploying" || d.status === "pending").length;
  const platforms = new Set(deployments.map((d) => d.platform));

  return (
    <div className="page">
      <h2>Dashboard</h2>

      <div className="grid grid-4">
        <div className="card stat">
          <div className="stat-value">{deployments.length}</div>
          <div className="stat-label">Total Deployments</div>
        </div>
        <div className="card stat">
          <div className="stat-value" style={{ color: "var(--success)" }}>{succeeded}</div>
          <div className="stat-label">Succeeded</div>
        </div>
        <div className="card stat">
          <div className="stat-value" style={{ color: "var(--danger)" }}>{failed}</div>
          <div className="stat-label">Failed</div>
        </div>
        <div className="card stat">
          <div className="stat-value" style={{ color: "var(--accent)" }}>{platforms.size}</div>
          <div className="stat-label">Platforms Used</div>
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <div className="card">
          <div className="card-header">
            <span className="card-title">Recent Deployments</span>
          </div>
          {loading ? (
            <div className="empty">Loading...</div>
          ) : deployments.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">🚀</div>
              <p>No deployments yet. Start by chatting with the agent!</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Repository</th>
                    <th>Platform</th>
                    <th>Region</th>
                    <th>Status</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {deployments.slice(0, 10).map((d) => (
                    <tr key={d.id}>
                      <td>{d.repoUrl.replace("https://github.com/", "")}</td>
                      <td>{d.platform}</td>
                      <td>{d.region}</td>
                      <td><StatusBadge status={d.status} /></td>
                      <td>{new Date(d.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {inProgress > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title">⏳ {inProgress} deployment{inProgress > 1 ? "s" : ""} in progress</div>
        </div>
      )}
    </div>
  );
}
