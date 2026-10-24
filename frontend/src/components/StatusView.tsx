import { useTranslation } from "react-i18next";

export function LoadingView({ label }: { label?: string }) {
  const { t } = useTranslation();
  return <p className="status-view status-loading">{label ?? t("common:loading.default")}</p>;
}

export function ErrorView({ message }: { message: string }) {
  return <p className="status-view status-error">{message}</p>;
}

export function EmptyView({ message }: { message: string }) {
  return <p className="status-view status-empty">{message}</p>;
}
