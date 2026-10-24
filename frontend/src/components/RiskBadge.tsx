import { useTranslation } from "react-i18next";
import type { RiskLevel } from "../api/types";

export function RiskBadge({ level }: { level: RiskLevel }) {
  const { t } = useTranslation();
  return <span className={`badge badge-${level}`}>{t(`common:risk.${level}`)}</span>;
}
