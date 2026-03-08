interface StatusBadgeProps {
  status: "pending" | "deploying" | "succeeded" | "failed";
}

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "badge badge-info" },
  deploying: { label: "Deploying", className: "badge badge-warning" },
  succeeded: { label: "Succeeded", className: "badge badge-success" },
  failed: { label: "Failed", className: "badge badge-danger" },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const cfg = STATUS_MAP[status] ?? STATUS_MAP.pending;
  return <span className={cfg.className}>{cfg.label}</span>;
}
