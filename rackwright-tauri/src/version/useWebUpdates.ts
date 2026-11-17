import { useCallback, useEffect, useState } from "react";
import pkg from "../../package.json";
import * as A from "../api";
import { adminOffer, due, serverNewer } from "./check";

const KEY = "rw.updCheckAt";
const store = {
  get: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
  set: (s: string) => { try { localStorage.setItem(KEY, s); } catch { /* ignore */ } },
};

/** Web only. Failures are silent. `reload` = server newer than this page; `admin` = a newer release is available (admins only). */
export function useWebUpdates(active: boolean, isAdmin: boolean) {
  const [reload, setReload] = useState<string | null>(null);
  const [admin, setAdmin] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    const poll = () => { A.getVersion().then((r) => setReload(serverNewer(r.version, pkg.version) ? r.version : null)).catch(() => {}); };
    poll();
    const id = setInterval(poll, 10 * 60_000);
    const onVis = () => { if (document.visibilityState === "visible") poll(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", poll);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); window.removeEventListener("focus", poll); };
  }, [active]);

  useEffect(() => {
    if (!active || !isAdmin || !due(store.get(), new Date())) return;
    A.checkUpdate().then((c) => { store.set(new Date().toISOString()); setAdmin(adminOffer(c)); }).catch(() => {});
  }, [active, isAdmin]);

  const later = useCallback(() => setAdmin(null), []);
  return { reload, admin, later };
}
