import type { RecommendationOutcome } from "../api/types";

const LABELS: Record<RecommendationOutcome, string> = {
  won: "Acertó",
  lost: "Falló",
  pending: "Pendiente",
};

export function OutcomeBadge({ outcome }: { outcome: RecommendationOutcome }) {
  return <span className={`badge outcome-${outcome}`}>{LABELS[outcome]}</span>;
}
