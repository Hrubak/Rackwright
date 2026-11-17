// The bar under the top bar on a client's pages: client picker, site picker, tabs, Client report.
import { useEffect, useState } from "react";
import { v } from "../theme";
import type { ClientTab } from "../home/Dashboard";
import { ClientItem, ClientListItem, clientStore } from "./store";

const sel = { background: v("bg"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "3px 6px", fontSize: 12, maxWidth: 200 } as const;
export const CLIENT_TABS: [ClientTab, string][] = [["sites", "Sites"], ["racks", "Racks"], ["inventory", "Inventory"], ["cabling", "Cabling"], ["links", "Links"]];

export default function ClientBar({ clientKey, tab, site, rev, onClient, onSite, onTab, onReport }: {
  clientKey: string; tab: ClientTab; site?: number; rev: number;
  onClient: (key: string) => void; onSite: (id: number | undefined) => void; onTab: (t: ClientTab) => void; onReport: () => void;
}) {
  const store = clientStore();
  const [list, setList] = useState<ClientListItem[]>([]);
  const [client, setClient] = useState<ClientItem | null>(null);
  useEffect(() => { store.list().then(setList, () => setList([])); }, [store, rev]);
  useEffect(() => { store.get(clientKey).then(setClient, () => setClient(null)); }, [store, clientKey, rev]);
  const noSites = !!client && !client.sites.length;
  return (
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, padding: "4px 10px", background: v("panel-2"), borderBottom: `1px solid ${v("border-subtle")}`, fontSize: 12, color: v("text") }}>
      <select style={sel} value={clientKey} onChange={(e) => onClient(e.target.value)} aria-label="Client">
        {!list.some((c) => c.key === clientKey) && <option value={clientKey}>{client?.name ?? "Client"}</option>}
        {list.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
      </select>
      <select style={sel} value={site ?? 0} onChange={(e) => onSite(Number(e.target.value) || undefined)} aria-label="Site" disabled={noSites}>
        <option value={0}>All sites</option>
        {(client?.sites ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <div style={{ display: "flex", marginLeft: 6 }}>
        {CLIENT_TABS.map(([id, label]) => (
          <button key={id} onClick={() => onTab(id)} aria-pressed={tab === id}
            style={{ background: "none", color: tab === id ? v("text") : v("text-muted-alt"), border: "none", cursor: "pointer", fontSize: 13, padding: "4px 12px",
              borderBottom: tab === id ? `2px solid ${v("accent-border")}` : "2px solid transparent" }}>{label}</button>
        ))}
      </div>
      <span style={{ flex: 1 }} />
      <button style={{ background: v("control"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "3px 10px", cursor: "pointer", fontSize: 12 }} onClick={onReport}>Client report</button>
    </div>
  );
}
