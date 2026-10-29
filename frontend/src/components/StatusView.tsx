import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

export function LoadingView({ label }: { label?: string }) {
  const { t } = useTranslation();
  return <p className="status-view status-loading">{label ?? t("common:loading.default")}</p>;
}

export function ErrorView({ message }: { message: string }) {
  return <p className="status-view status-error">{message}</p>;
}

/** `action`: un botón para seguir desde ahí (p. ej., ir al histórico). */
export function EmptyView({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <p className="status-view status-empty">
      {message}
      {action && <> {action}</>}
    </p>
  );
}
