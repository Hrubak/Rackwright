import { useCallback, useEffect, useRef, useState } from "react";
import pkg from "../../package.json";
import { IS_WEB } from "../backend";
import { due, newestDesktop } from "./check";

const AT = "rw.verCheckAt", SKIP = "rw.verSkip";
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, val: string) => { try { localStorage.setItem(k, val); } catch { /* ignore */ } };
const URL_ = "https://api.github.com/repos/Hrubak/Rackwright/releases?per_page=30";

export type Offer = { version: string; url: string };
export type ManualResult = { ok: true; offer: Offer | null } | { ok: false };

async function fetchOffer(ignoreSkip: boolean): Promise<Offer | null> {
  const r = await fetch(URL_, { headers: { Accept: "application/vnd.github+json" } });
  if (!r.ok) throw new Error(String(r.status));
  return newestDesktop(await r.json(), pkg.version, ignoreSkip ? null : get(SKIP));
}

/** Desktop only. Silent on failure, except for the manual check. */
export function useDesktopUpdates() {
  const [offer, setOffer] = useState<Offer | null>(null);
  const live = useRef(true);

  useEffect(() => {
    if (IS_WEB) return;
    live.current = true;
    const run = async () => {
      if (!due(get(AT), new Date())) return;
      try { const o = await fetchOffer(false); set(AT, new Date().toISOString()); if (live.current) setOffer(o); } catch { /* silent */ }
    };
    const t = setTimeout(run, 5000);
    const i = setInterval(run, 3600_000); // re-checks the 24 h gate while the app stays open
    return () => { live.current = false; clearTimeout(t); clearInterval(i); };
  }, []);

  const download = useCallback(async () => {
    if (!offer) return;
    try { await (await import("@tauri-apps/plugin-opener")).openUrl(offer.url); } catch { /* ignore */ }
  }, [offer]);
  const skip = useCallback(() => { if (offer) set(SKIP, offer.version); setOffer(null); }, [offer]);
  const hide = useCallback(() => setOffer(null), []);
  const checkNow = useCallback(async (): Promise<ManualResult> => {
    try {
      const o = await fetchOffer(true);
      set(AT, new Date().toISOString());
      if (o) setOffer(o);
      return { ok: true, offer: o };
    } catch { return { ok: false }; }
  }, []);

  return { offer, download, skip, hide, checkNow };
}
