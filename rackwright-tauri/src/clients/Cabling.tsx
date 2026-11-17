// Client cabling: every cable across a client's racks, with search and CSV.
import { useMemo, useState } from "react";
import { v } from "../theme";
import { backend } from "../backend";
import type { Doc } from "../types";
import type { ClientItem, RackItem } from "./store";
import { CableRow, cablingCsv, cablingRows } from "./util";

const btn = { background: v("control"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "4px 10px", marginRight: 5, cursor: "pointer", fontSize: 12 } as const;
const inp = { background: v("bg"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "4px 6px", fontSize: 12 } as const;
const MAX = 500;

export default function Cabling({ client, docs, onOpen }: {
  client: ClientItem;
  docs: Record<string, Doc | string>;
  onOpen: (r: RackItem, cableId: number) => void;
}) {
  const [q, setQ] = useState("");
  const racks = useMemo(() => new Map(client.sites.flatMap((s) => s.racks.map((r) => [r.key, r] as const))), [client]);
  const all = useMemo(() => cablingRows(client, docs), [client, docs]);
  const rows = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return all;
    return all.filter((r) => { const hay = [r.site, r.rack, r.from, r.fromPort, r.to, r.toPort, r.kind, r.label, r.length].join(" ").toLowerCase(); return words.every((w) => hay.includes(w)); });
  }, [all, q]);
  const loading = client.sites.some((s) => s.racks.some((r) => docs[r.key] === undefined));
  const failed = client.sites.flatMap((s) => s.racks.filter((r) => typeof docs[r.key] === "string").map((r) => r.name));

  const exportCsv = async () => {
    const name = `${client.name.replace(/[<>:"/\\|?*]+/g, " ").trim() || "client"} cabling.csv`;
    await backend.saveBytes(name, "text/csv", new TextEncoder().encode("﻿" + cablingCsv(rows)));
  };
  const open = (r: CableRow) => { const rk = racks.get(r.rackKey); if (rk) onOpen(rk, r.cableId); };
  const th = { textAlign: "left", padding: "4px 6px", opacity: 0.7, position: "sticky", top: 0, background: v("panel"), whiteSpace: "nowrap" } as const;
  const td = { padding: "3px 6px", borderTop: `1px solid ${v("panel-2")}`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 220 } as const;

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <input style={{ ...inp, width: 320 }} placeholder="Search device, port, label, kind..." value={q} onChange={(e) => setQ(e.target.value)} />
        <button style={btn} onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
        <span style={{ fontSize: 12, opacity: 0.8 }}>{rows.length} cable{rows.length === 1 ? "" : "s"}{q ? ` (of ${all.length})` : ""}</span>
        {loading && <span style={{ fontSize: 12, opacity: 0.7 }}>Loading racks...</span>}
      </div>
      {failed.length > 0 && <div style={{ fontSize: 12, color: v("error-text"), marginBottom: 6 }}>Could not read: {failed.join(", ")}</div>}
      {!client.sites.some((s) => s.racks.length) && <div style={{ opacity: 0.7 }}>No racks to show. Add racks to a site first.</div>}
      {rows.length > 0 && (
        <div style={{ overflow: "auto", maxHeight: "calc(100vh - 260px)", border: `1px solid ${v("border-subtle")}`, borderRadius: 4 }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
            <thead><tr>{["Site", "Rack", "From", "Port", "To", "Port", "Kind", "Label", "Length"].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.slice(0, MAX).map((r) => (
                <tr key={`${r.rackKey}:${r.cableId}`} onClick={() => open(r)} title="Open this rack with the cable selected" style={{ cursor: "pointer" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = v("row-hover-blue"))} onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                  <td style={td}>{r.site}</td><td style={td}>{r.rack}</td><td style={td}>{r.from}</td><td style={td}>{r.fromPort}</td>
                  <td style={td}>{r.to}</td><td style={td}>{r.toPort}</td>
                  <td style={td}><span aria-hidden="true" style={{ display: "inline-block", width: 9, height: 9, borderRadius: 5, background: r.colour || v("text-faint"), marginRight: 5 }} />{r.kind}</td>
                  <td style={td}>{r.label}</td><td style={td}>{r.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > MAX && <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>Showing the first {MAX} of {rows.length}. Search to narrow it down; Export CSV has them all.</div>}
      {!rows.length && all.length > 0 && <div style={{ opacity: 0.7 }}>Nothing matches.</div>}
      {!all.length && client.sites.some((s) => s.racks.length) && !loading && <div style={{ opacity: 0.7 }}>No cables drawn in these racks yet.</div>}
    </div>
  );
}
