// IP entries of the other racks of the open rack's client, so the editor can flag duplicate addresses across racks.
import { useEffect, useState } from "react";
import { clientStore, type RackItem } from "../clients/store";
import type { RackLocation } from "../location";
import { ipEntries, type IpEntry } from "./model";

export function useClientIps(loc: RackLocation | "unassigned" | null, isCurrent: (r: RackItem) => boolean, rev: number): IpEntry[] {
  const [out, setOut] = useState<IpEntry[]>([]);
  const clientKey = loc && loc !== "unassigned" ? loc.clientKey : null;
  useEffect(() => {
    let stop = false;
    setOut([]);
    if (!clientKey) return;
    (async () => {
      try {
        const st = clientStore();
        const client = await st.get(clientKey);
        const racks = client.sites.flatMap((s) => s.racks).filter((r) => !isCurrent(r));
        const lists = await Promise.all(racks.map(async (r) => {
          try { return ipEntries(r.key, await st.loadDoc(r)); } catch { return []; }
        }));
        if (!stop) setOut(lists.flat());
      } catch { if (!stop) setOut([]); }
    })();
    return () => { stop = true; };
  }, [clientKey, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  return out;
}
