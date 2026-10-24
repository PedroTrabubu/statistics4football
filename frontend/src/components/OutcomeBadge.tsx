import { useTranslation } from "react-i18next";
import type { RecommendationOutcome } from "../api/types";

export function OutcomeBadge({ outcome }: { outcome: RecommendationOutcome }) {
  const { t } = useTranslation();
  return <span className={`badge outcome-${outcome}`}>{t(`common:outcome.${outcome}`)}</span>;
}
