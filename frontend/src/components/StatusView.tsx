export function LoadingView({ label = "Cargando..." }: { label?: string }) {
  return <p className="status-view status-loading">{label}</p>;
}

export function ErrorView({ message }: { message: string }) {
  return <p className="status-view status-error">{message}</p>;
}

export function EmptyView({ message }: { message: string }) {
  return <p className="status-view status-empty">{message}</p>;
}
