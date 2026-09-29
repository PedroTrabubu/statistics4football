import { sampleLabel, sampleTier } from "../lib/sampleLevel";

export function SampleBadge({ matchesUsed }: { matchesUsed: number }) {
  return (
    <span className={`sample-badge sample-${sampleTier(matchesUsed)}`}>
      {sampleLabel(matchesUsed)} <span className="sample-n">n={matchesUsed}</span>
    </span>
  );
}
