import { useMemo, useState } from "react";
import type { Doc } from "../types";
import { groupOfSwitch, placeUnplaced } from "../endpointEdit";
import { PortSelect } from "../auvik/EndpointEditor";
import type { Sel } from "../RackView";
import { endpointsCsv, EpSort, filterEndpoints, flattenEndpoints, sortEndpoints } from "./endpoints";
import { EP_KINDS, EpKind, KIND_COLOR, KIND_LABEL } from "./kinds";

const inp = { background: "#14161a", color: "#e6e8eb", border: "1px solid #3a3d42", borderRadius: 4, padding: "4px 6px" } as const;
const COLS: [EpSort, string][] = [["name", "Name"], ["kind", "Kind"], ["type", "Type"], ["model", "Model"], ["ip", "IP"], ["mac", "MAC"], ["switch", "Switch / host"], ["port", "Port"], ["status", "Status"]];

type Edit = (fn: (d: Doc) => string | void, key?: string) => boolean;
const SW_TYPES = ["Switch", "Router", "Firewall"];

/** Small dialog: put an unplaced endpoint on a switch. */
function PlaceDialog({ doc, index, edit, onClose }: { doc: Doc; index: number; edit: Edit; onClose: () => void }) {
  const u = doc.auvik?.unplaced?.[index];
  const sws = doc.devices.filter((d) => SW_TYPES.includes(d.type) && d.ports.length);
  const [sw, setSw] = useState<number | "">(sws[0]?.id ?? "");
  const swDev = sw === "" ? null : doc.devices.find((d) => d.id === sw) ?? null;
  const [port, setPort] = useState<number | null>(null);
  if (!u) return null;
  const grp = swDev ? groupOfSwitch(doc, swDev.id) : null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000a", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 120 }}>
      <div style={{ background: "#1b1d21", padding: 14, borderRadius: 6, width: 340, border: "1px solid #3a3d42", fontSize: 12.5 }}>
        <b>Place {u.name} on a switch</b>
        <label style={{ display: "block", margin: "8px 0" }}>Switch<br />
          <select style={{ ...inp, width: "100%" }} value={sw} onChange={(e) => { setSw(e.target.value === "" ? "" : Number(e.target.value)); setPort(null); }}>
            <option value="">(choose)</option>
            {sws.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select></label>
        <label style={{ display: "block", margin: "8px 0" }}>Switch port<br /><PortSelect doc={doc} sw={swDev} value={port} onChange={setPort} /></label>
        <div style={{ opacity: 0.7, marginBottom: 8 }}>{swDev ? (grp ? `Joins ${grp.name}.` : `Makes a new group, Endpoints on ${swDev.name}.`) : "Pick a switch first."}</div>
        <button style={{ ...inp, cursor: "pointer" }} disabled={!swDev} onClick={() => { if (swDev && edit((d) => { placeUnplaced(d, index, swDev.id, port); return `Placed ${u.name} on ${swDev.name}`; })) onClose(); }}>Place</button>{" "}
        <button style={{ ...inp, cursor: "pointer" }} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

export default function EndpointsView({ doc, selected, onSelect, edit, onMember }: { doc: Doc; selected: Sel; onSelect: (s: Sel) => void; edit?: Edit; onMember?: (dev: number, idx: number) => void }) {
  const [placing, setPlacing] = useState<number | null>(null);
  const all = useMemo(() => flattenEndpoints(doc), [doc]);
  const [kinds, setKinds] = useState<Set<EpKind>>(new Set());
  const [text, setText] = useState("");
  const [sort, setSort] = useState<EpSort>("name");
  const [dir, setDir] = useState<1 | -1>(1);
  const [note, setNote] = useState("");
  const rows = useMemo(() => sortEndpoints(filterEndpoints(all, kinds, text), sort, dir), [all, kinds, text, sort, dir]);
  const count = (k: EpKind) => all.filter((r) => r.kind === k).length;
  const toggle = (k: EpKind) => setKinds((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const copy = async () => {
    try { await navigator.clipboard.writeText(endpointsCsv(rows)); setNote(`Copied ${rows.length} rows as CSV`); } catch { setNote("Could not copy"); }
    setTimeout(() => setNote(""), 2500);
  };
  const selId = selected?.kind === "dev" ? selected.id : null;

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "auto", background: "#14161a", padding: 14, fontSize: 12.5 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <input style={{ ...inp, width: 240 }} placeholder="Search name, IP, MAC, switch..." value={text} onChange={(e) => setText(e.target.value)} />
        {EP_KINDS.filter((k) => count(k) > 0 || kinds.has(k)).map((k) => (
          <button key={k} onClick={() => toggle(k)} style={{ background: kinds.has(k) ? KIND_COLOR[k] : "#2a2d33", color: kinds.has(k) ? "#101113" : "#e6e8eb", border: `1px solid ${KIND_COLOR[k]}`, borderRadius: 12, padding: "2px 10px", cursor: "pointer" }}>
            {KIND_LABEL[k][1]} {count(k)}
          </button>
        ))}
        {kinds.size > 0 && <button onClick={() => setKinds(new Set())} style={{ ...inp, cursor: "pointer" }}>Clear filter</button>}
        <span style={{ flex: 1 }} />
        <span style={{ opacity: 0.7 }}>{rows.length} of {all.length}{note && ` | ${note}`}</span>
        <button onClick={copy} disabled={!rows.length} style={{ ...inp, cursor: "pointer" }}>Copy as CSV</button>
      </div>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead><tr style={{ textAlign: "left", background: "#1b1d21" }}>
          {COLS.map(([k, h]) => (
            <th key={k} onClick={() => { if (sort === k) setDir((d) => (d === 1 ? -1 : 1)); else { setSort(k); setDir(1); } }}
              style={{ padding: "5px 8px", borderBottom: "1px solid #2c2f35", cursor: "pointer", whiteSpace: "nowrap", position: "sticky", top: -14, background: "#1b1d21" }}>
              {h}{sort === k ? (dir === 1 ? " ▲" : " ▼") : ""}
            </th>
          ))}
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} onClick={() => { if (r.devId == null) return; onSelect({ kind: "dev", id: r.devId }); onMember?.(r.devId, Number(r.key.split(":")[1])); }}
              style={{ cursor: r.devId != null ? "pointer" : "default", borderBottom: "1px solid #24272c", background: r.devId != null && r.devId === selId ? "#2a3a52" : undefined }}>
              <td style={{ padding: "4px 8px" }}>{r.name}</td>
              <td style={{ padding: "4px 8px" }}><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: KIND_COLOR[r.kind], marginRight: 6 }} />{KIND_LABEL[r.kind][0]}</td>
              <td style={{ padding: "4px 8px" }}>{r.type}</td>
              <td style={{ padding: "4px 8px" }}>{r.model}</td>
              <td style={{ padding: "4px 8px" }}>{r.ip}</td>
              <td style={{ padding: "4px 8px", fontFamily: "Consolas, monospace" }}>{r.mac}</td>
              <td style={{ padding: "4px 8px" }}>{r.switch}</td>
              <td style={{ padding: "4px 8px" }}>{r.port}</td>
              <td style={{ padding: "4px 8px" }}>{r.status}{r.source === "unplaced" && <span style={{ opacity: 0.5 }}> (not placed)</span>}{r.source === "unplaced" && edit && <> <button style={{ ...inp, cursor: "pointer", padding: "1px 6px" }} onClick={(e) => { e.stopPropagation(); setPlacing(Number(r.key.slice(2))); }}>Place on switch...</button></>}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={9} style={{ padding: 12, opacity: 0.6 }}>{all.length ? "No endpoints match. Clear the search or the filter." : "There are no endpoints yet. Import from Auvik to add them."}</td></tr>}
        </tbody>
      </table>
    {placing != null && edit && <PlaceDialog doc={doc} index={placing} edit={edit} onClose={() => setPlacing(null)} />}
    </div>
  );
}
