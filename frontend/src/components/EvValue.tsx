import { useTranslation } from "react-i18next";
import { formatEv } from "../lib/format";
import { isEvOutlier } from "../lib/sampleLevel";

export function EvValue({ ev }: { ev: number | null }) {
  const { t } = useTranslation();
  if (ev === null) return <>—</>;

  return (
    <>
      <span className={ev >= 0 ? "ev-positive" : "ev-negative"}>{formatEv(ev)}</span>
      {isEvOutlier(ev) && (
        <span className="ev-flag" title={t("common:evFlag.title")}>
          {t("common:evFlag.label")}
        </span>
      )}
    </>
  );
}
