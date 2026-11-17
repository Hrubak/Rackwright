// Client inventory: every device (and optionally every endpoint) across a client's sites, with search, totals and CSV.
import { v } from "../theme";
import { useEffect, useMemo, useRef, useState } from "react";
import { backend } from "../backend";
import type { Doc } from "../types";
import type { ClientItem, RackItem } from "./store";
import { InvRow, inventoryCsv, inventoryRows, matchRow, typeTotals } from "./util";

const btn = { background: v("control"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "4px 10px", marginRight: 5, cursor: "pointer", fontSize: 12 } as const;
const inp = { background: v("bg"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "4px 6px", fontSize: 12 } as const;
const MAX = 500;

export default function Inventory({ client, docs, onOpen }: {
  client: ClientItem;
  docs: Record<string, Doc | string>;
  onOpen: (r: RackItem, devId: number) => void;
}) {
  const [q, setQ] = useState("");
  const [eps, setEps] = useState(false);
  const [site, setSite] = useState<number | 0>(0);
  const [type, setType] = useState("");
  const qRef = useRef<HTMLInputElement>(null);
  useEffect(() => { qRef.current?.focus(); }, []);

  const racks = useMemo(() => new Map(client.sites.flatMap((s) => s.racks.map((r) => [r.key, r] as const))), [client]);
  const all = useMemo(() => client.sites.flatMap((s) => s.racks.flatMap((r) => {
    const d = docs[r.key];
    return typeof d === "object" ? inventoryRows(s.id, s.name, r.key, r.name, d, eps) : [];
  })), [client, docs, eps]);
  const loading = client.sites.some((s) => s.racks.some((r) => docs[r.key] === undefined));
  const failed = client.sites.flatMap((s) => s.racks.filter((r) => typeof docs[r.key] === "string").map((r) => r.name));
  const inScope = useMemo(() => all.filter((r) => (!site || r.siteId === site) && matchRow(r, q)), [all, site, q]);
  const rows = useMemo(() => (type ? inScope.filter((r) => (r.type || "Other") === type) : inScope), [inScope, type]);
  const totals = useMemo(() => typeTotals(inScope), [inScope]);

  const exportCsv = async () => {
    const name = `${client.name.replace(/[<>:"/\\|?*]+/g, " ").trim() || "client"} inventory.csv`;
    await backend.saveBytes(name, "text/csv", new TextEncoder().encode("﻿" + inventoryCsv(rows)));
  };
  const open = (r: InvRow) => { const rk = racks.get(r.rackKey); if (rk) onOpen(rk, r.devId); };
  const th = { textAlign: "left", padding: "4px 6px", opacity: 0.7, position: "sticky", top: 0, background: v("panel"), whiteSpace: "nowrap" } as const;
  const td = { padding: "3px 6px", borderTop: `1px solid ${v("panel-2")}`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 220 } as const;

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <input ref={qRef} style={{ ...inp, width: 320 }} placeholder="Search name, IP, MAC, serial, model..." value={q} onChange={(e) => setQ(e.target.value)} />
        <select style={inp} value={site} onChange={(e) => setSite(Number(e.target.value))}>
          <option value={0}>All sites</option>
          {client.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <label style={{ fontSize: 12 }} title="PCs, phones, printers and other endpoints Auvik saw on device ports">
          <input type="checkbox" checked={eps} onChange={(e) => setEps(e.target.checked)} /> Include endpoints
        </label>
        <button style={btn} onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
        {loading && <span style={{ fontSize: 12, opacity: 0.7 }}>Loading racks...</span>}
      </div>
      {failed.length > 0 && <div style={{ fontSize: 12, color: v("error-text"), marginBottom: 6 }}>Could not read: {failed.join(", ")}</div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8, fontSize: 12 }}>
        <span style={{ opacity: 0.8, marginRight: 4 }}>{inScope.length} {eps ? "items" : "devices"}{q || site ? ` (of ${all.length})` : ""}:</span>
        {totals.map(([t, n]) => (
          <button key={t} onClick={() => setType(type === t ? "" : t)}
            style={{ ...btn, padding: "1px 8px", marginRight: 0, background: type === t ? v("accent-soft") : btn.background, borderColor: type === t ? v("accent-border") : v("border") }}>
            {t} {n}
          </button>
        ))}
      </div>
      {!client.sites.some((s) => s.racks.length) && <div style={{ opacity: 0.7 }}>This client has no racks yet. Add racks to its sites first.</div>}
      {rows.length > 0 && (
        <div style={{ overflow: "auto", maxHeight: "calc(100vh - 330px)", border: `1px solid ${v("border-subtle")}`, borderRadius: 4 }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
            <thead><tr>{["Site", "Rack", "Name", "Type", "Model", "IP", "MAC", "Serial", "Location"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.slice(0, MAX).map((r, i) => (
                <tr key={`${r.rackKey}:${r.devId}:${i}`} onClick={() => open(r)} title="Open this rack with the device selected"
                  style={{ cursor: "pointer", opacity: r.kind === "endpoint" ? 0.8 : 1 }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = v("row-hover-blue"))} onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                  <td style={td}>{r.site}</td><td style={td}>{r.rackFile}</td>
                  <td style={{ ...td, fontWeight: r.kind === "device" ? 600 : 400 }}>{r.kind === "endpoint" ? "↳ " : ""}{r.name}</td>
                  <td style={td}>{r.type}</td><td style={td}>{r.model}</td><td style={td}>{r.ip}</td>
                  <td style={td}>{r.mac}</td><td style={td}>{r.serial}</td><td style={td}>{r.where}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > MAX && <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>Showing the first {MAX} of {rows.length}. Search to narrow it down; Export CSV has them all.</div>}
      {!rows.length && all.length > 0 && <div style={{ opacity: 0.7 }}>Nothing matches.</div>}
    </div>
  );
}
