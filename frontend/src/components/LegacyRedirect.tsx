import { Navigate, useLocation } from "react-router-dom";
import { getLeagues } from "../api/client";
import { legacyNeedsLeagues, legacyTarget } from "../lib/legacyRoutes";
import { useApi } from "../lib/useApi";

/** Una ruta antigua: a la nueva, sin dejar la vieja en el historial. Con un
 * id de liga en la URL espera a la lista de ligas para traducirlo; si no
 * llega, a la ruta base. */
export function LegacyRedirect() {
  const { pathname, search, hash } = useLocation();
  const needsLeagues = legacyNeedsLeagues(search);
  const leagues = useApi(() => (needsLeagues ? getLeagues() : Promise.resolve([])), [needsLeagues]);
  if (leagues.loading) return null;
  return <Navigate to={legacyTarget(pathname, search, hash, leagues.data ?? [])} replace />;
}
