import { useEffect, useState } from "react";
import { type DeploymentRecord, fetchDeployments } from "../api";
import { StatusBadge } from "../components/StatusBadge";

export function Deployments() {
  const [deployments, setDeployments] = useState<DeploymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetchDeployments()
      .then(setDeployments)
      .catch(() => setDeployments([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="page"><div className="empty">Loading deployments...</div></div>;

  return (
    <div className="page">
      <h2>Deployments</h2>

      {deployments.length === 0 ? (
        <div className="card">
          <div className="empty">
            <div className="empty-icon">📦</div>
            <p>No deployments found. Use the chat to analyze a repo and deploy it.</p>
          </div>
        </div>
      ) : (
        deployments.map((d) => (
          <div className="card" key={d.id}>
            <div
              className="card-header"
              style={{ cursor: "pointer" }}
              onClick={() => setExpanded(expanded === d.id ? null : d.id)}
            >
              <span className="card-title">
                {d.repoUrl.replace("https://github.com/", "")}
              </span>
              <StatusBadge status={d.status} />
            </div>

            <div style={{ display: "flex", gap: 24, fontSize: 13, color: "var(--text-muted)" }}>
              <span>Platform: <strong style={{ color: "var(--text)" }}>{d.platform}</strong></span>
              <span>Region: <strong style={{ color: "var(--text)" }}>{d.region}</strong></span>
              <span>RG: <strong style={{ color: "var(--text)" }}>{d.resourceGroupName}</strong></span>
              <span>{new Date(d.createdAt).toLocaleString()}</span>
            </div>

            {expanded === d.id && (
              <div style={{ marginTop: 16, fontSize: 13 }}>
                <div style={{ marginBottom: 8 }}>
                  <strong>Subscription:</strong> {d.subscriptionId}
                </div>

                {Object.keys(d.outputs).length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <strong>Outputs:</strong>
                    <table style={{ marginTop: 4 }}>
                      <tbody>
                        {Object.entries(d.outputs).map(([key, val]) => (
                          <tr key={key}>
                            <td style={{ color: "var(--text-muted)", paddingRight: 16 }}>{key}</td>
                            <td>{val}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {d.error && (
                  <div style={{
                    background: "rgba(248, 81, 73, 0.1)",
                    border: "1px solid var(--danger)",
                    borderRadius: "var(--radius)",
                    padding: 12,
                    fontSize: 12,
                    fontFamily: "monospace",
                    whiteSpace: "pre-wrap",
                  }}>
                    {d.error}
                  </div>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
