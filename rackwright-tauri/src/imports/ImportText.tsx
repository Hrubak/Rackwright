import { v } from "../theme";
import type { Token } from "../theme";
import { useMemo, useRef, useState } from "react";
import { IS_WEB } from "../backend";
import type { Doc } from "../types";
import { clone } from "../edit";
import { readImport } from "./read";
import { switchKind } from "./layout";
import type { ReadMode } from "./read";
import { planImport } from "./plan";
import type { Action, ImportOpts, ImportPlan, Row } from "./plan";
import { applyImport } from "./apply";
import type { ImportSpec } from "./spec";

const btn = { background: v("control"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "5px 12px", marginRight: 5, cursor: "pointer" } as const;
const inp = { background: v("bg"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "3px 5px" } as const;
const FORMATS: [ReadMode, string][] = [["auto", "Automatic"], ["layout", "Rack layout list (top of rack first)"], ["rackmap", "RackMap text format"], ["csv", "CSV or spreadsheet"]];
const MAX_BYTES = 5 * 1024 * 1024;
const CHIP: Record<Action, { label: string; bg: Token; fg: Token }> = {
  add: { label: "Add", bg: "ok-bg", fg: "ok-text" },
  move: { label: "Move", bg: "warn-bg", fg: "warn" },
  change: { label: "Change", bg: "row-hover-blue", fg: "link" },
  same: { label: "Same", bg: "card", fg: "text-muted" },
};
const KINDS: [string, string][] = [["device", "Device"], ["empty", "Empty"], ["note", "Note"]];

export default function ImportText({ doc, rackId, onApply, onClose }: {
  doc: Doc; rackId: number | null; onApply: (fn: (d: Doc) => string | void) => boolean; onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<ReadMode>("auto");
  const [rackSel, setRackSel] = useState<string>(rackId != null && doc.racks.some((r) => r.id === rackId) ? String(rackId) : doc.racks[0] ? String(doc.racks[0].id) : "new");
  const [newU, setNewU] = useState("42");
  const [spec, setSpec] = useState<ImportSpec | null>(null);
  const [grow, setGrow] = useState(true);
  const [ovr, setOvr] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState("");
  const [drag, setDrag] = useState(false);
  const [showWarn, setShowWarn] = useState(false);
  const [showLeft, setShowLeft] = useState(false);

  const newUn = Math.max(1, parseInt(newU) || 42);
  const opts: ImportOpts = useMemo(() => ({ rackId: rackSel === "new" ? null : +rackSel, newRackName: "Imported rack", newRackU: newUn, growRack: grow }), [rackSel, newUn, grow]);

  const base: ImportPlan | null = useMemo(() => (spec ? planImport(doc, spec, opts) : null), [doc, spec, opts]);
  const plan: ImportPlan | null = useMemo(() => (base ? { ...base, rows: base.rows.map((r) => (r.id in ovr ? { ...r, on: ovr[r.id] } : r)) } : null), [base, ovr]);
  const rowById = useMemo(() => new Map<string, Row>((plan?.rows ?? []).map((r) => [r.id, r])), [plan]);
  const dry = useMemo(() => (plan ? applyImport(clone(doc), plan, opts) : null), [plan, doc, opts]);

  const fileRef = useRef<HTMLInputElement>(null);
  const loadFile = async (f: File | undefined) => {
    if (fileRef.current) fileRef.current.value = ""; // so the same file can be picked again
    if (!f) return;
    if (f.size > MAX_BYTES) { setErr("That file is over 5 MB."); return; }
    try { setErr(""); setText(await f.text()); }
    catch { setErr("That file couldn't be read."); }
  };
  const preview = () => {
    if (text.length > MAX_BYTES) { setErr("That text is over 5 MB."); return; }
    try { setErr(""); setSpec(readImport(text, mode)); setOvr({}); setGrow(true); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  const editDev = (i: number, patch: Partial<ImportSpec["devices"][number]>) => {
    setSpec((s) => s && { ...s, devices: s.devices.map((d, j) => (j === i ? { ...d, ...patch } : d)) });
    setOvr((o) => { if (!("r" + i in o)) return o; const c = { ...o }; delete c["r" + i]; return c; });
  };
  const setKind = (i: number, kind: "device" | "empty" | "note") => {
    setSpec((s) => s && { ...s, devices: s.devices.map((d, j) => (j === i ? switchKind(d, kind) : d)) });
    setOvr((o) => { const c = { ...o }; delete c["r" + i]; return c; });
  };

  const n = plan ? plan.rows.filter((r) => r.on && r.action !== "same").length : 0;
  const count = (a: Action) => (plan ? plan.rows.filter((r) => r.action === a).length : 0);
  const sel = doc.racks.find((r) => r.id === +rackSel);
  const baseU = rackSel === "new" ? newUn : sel?.u ?? 0;
  const rackName = rackSel === "new" ? "the new rack" : sel?.name ?? "";
  const isLayout = spec?.kind === "layout";
  const tooShort = !!plan && isLayout && plan.needU > baseU;
  const showTarget = mode === "layout" || mode === "auto";

  const doImport = () => {
    if (!plan) return;
    const ok = onApply((d) => {
      const log = applyImport(d, plan, opts);
      return `Imported: ${log.added} added, ${log.moved} moved, ${log.changed} changed`;
    });
    if (ok) onClose();
  };

  const where = (r: Row) => {
    const d = r.dev;
    const rk = d.rack === null ? "Off-rack" : d.rack ?? (rackSel === "new" ? "New rack" : rackName);
    return d.u != null ? `${rk} U${d.u}${d.side ? " side" : ""}${d.face && d.face !== "front" ? " " + d.face : ""}` : rk;
  };
  const rowOf = (id: string) => rowById.get(id);
  const td = { padding: "3px 6px" } as const;

  return (
    <div style={{ position: "fixed", inset: 0, background: v("overlay"), display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
      onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div style={{ background: v("panel"), padding: 14, borderRadius: 6, width: 1000, maxWidth: "96vw", maxHeight: "92vh", display: "flex", flexDirection: "column", border: `1px solid ${v("border")}`, color: v("text"), fontSize: 12 }}>
        <div style={{ display: "flex", marginBottom: 10 }}>
          <b style={{ flex: 1, fontSize: 14 }}>Import text or CSV</b>
          <button style={{ ...btn, marginRight: 0, padding: "1px 8px" }} onClick={onClose}>x</button>
        </div>

        {!plan && <div style={{ overflow: "auto" }}>
          <div {...(IS_WEB ? { onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDrag(true); }, onDragLeave: () => setDrag(false),
              onDrop: (e: React.DragEvent) => { e.preventDefault(); setDrag(false); loadFile(e.dataTransfer.files[0]); } } : {})}
            style={{ border: `1px dashed ${drag ? v("focus") : v("border")}`, borderRadius: 4, padding: 8, marginBottom: 8 }}>
            {IS_WEB ? "Drop a file here, or choose one: " : "Choose a file: "}<input ref={fileRef} type="file" accept=".txt,.csv,.tsv,.md" onChange={(e) => loadFile(e.target.files?.[0])} />
            <div style={{ opacity: 0.7, marginTop: 4 }}>The file stays on this computer. Or paste the text below.</div>
          </div>
          <textarea style={{ ...inp, width: "100%", height: 240, boxSizing: "border-box" }} value={text} onChange={(e) => setText(e.target.value)} />
          <div style={{ margin: "8px 0" }}>
            {FORMATS.map(([k, l]) => <label key={k} style={{ marginRight: 14 }}><input type="radio" name="fmt" checked={mode === k} onChange={() => setMode(k)} /> {l}</label>)}
          </div>
          {showTarget && <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 8 }}>
            <label>Into rack{" "}
              <select style={inp} value={rackSel} onChange={(e) => setRackSel(e.target.value)}>
                {doc.racks.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                <option value="new">New rack</option>
              </select></label>
            {rackSel === "new" && <label>Rack height <input type="number" style={{ ...inp, width: 56 }} value={newU} onChange={(e) => setNewU(e.target.value)} /></label>}
          </div>}
          {err && <div style={{ color: v("danger"), marginBottom: 8 }}>{err}</div>}
          <div style={{ textAlign: "right" }}>
            <button style={btn} onClick={onClose}>Cancel</button>
            <button style={{ ...btn, marginRight: 0 }} disabled={!text.trim()} onClick={preview}>Preview</button>
          </div>
        </div>}

        {plan && spec && <>
          <div style={{ marginBottom: 6 }}>
            {count("add")} to add · {count("move")} to move · {count("change")} to change · {count("same")} unchanged
          </div>
          {spec.warnings.map((w, i) => <div key={i} style={{ opacity: 0.7 }}>Note: {w}</div>)}
          {tooShort && <label style={{ display: "block", background: v("warn-bg"), border: `1px solid ${v("warn")}`, borderRadius: 4, padding: "4px 8px", margin: "4px 0" }}>
            <input type="checkbox" checked={grow} onChange={(e) => setGrow(e.target.checked)} /> The list needs {plan.needU} U but {rackName} is {baseU} U. Make it {plan.needU} U?
          </label>}
          <div style={{ overflow: "auto", flex: 1, minHeight: 0, border: `1px solid ${v("border-subtle")}`, borderRadius: 4 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ textAlign: "left", position: "sticky", top: 0, background: v("panel") }}>
                {["", "Action", "Line", "Name", "Matched device", "Where", "Changes"].map((h, i) => <th key={i} style={td}>{h}</th>)}
              </tr></thead>
              <tbody>
                {spec.devices.map((d, i) => {
                  const r = rowOf("r" + i);
                  if (!r && d.kind !== "empty") return null;
                  const c = r ? CHIP[r.action] : null;
                  const shown = r ? r.dev : d; // the planned row knows the matched device's real size
                  return <tr key={i} style={{ borderTop: `1px solid ${v("border-subtle")}`, opacity: r && !r.on ? 0.65 : 1, verticalAlign: "top" }}>
                    <td style={td}>{r && <input type="checkbox" checked={r.on} disabled={r.action === "same"} onChange={(e) => setOvr((o) => ({ ...o, [r.id]: e.target.checked }))} />}</td>
                    <td style={td}>{c ? <span style={{ background: v(c.bg), color: v(c.fg), borderRadius: 3, padding: "1px 6px" }}>{c.label}</span> : <span style={{ opacity: 0.6 }}>Empty</span>}</td>
                    <td style={td}>{d.line}</td>
                    <td style={td}>
                      {d.name || "(gap)"}
                      {isLayout && <div style={{ marginTop: 2 }}>
                        <select style={inp} value={d.kind ?? "device"} onChange={(e) => setKind(i, e.target.value as "device" | "empty" | "note")}>
                          {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>{" "}
                        {d.kind !== "note" && <>
                          <HeightInput value={shown.height ?? 1} onCommit={(h) => editDev(i, { height: h, heightGuessed: false })} /> U{" "}
                          {d.kind !== "empty" && <select style={inp} value={d.side ?? 0} onChange={(e) => editDev(i, { side: +e.target.value })}>
                            <option value={0}>Full width</option><option value={1}>Left</option><option value={2}>Right</option>
                          </select>}
                        </>}
                      </div>}
                      {shown.heightGuessed && <span style={{ marginLeft: 6, opacity: 0.7 }}>height guessed</span>}
                      {r?.reason && <div style={{ color: v("warn") }}>{r.reason}</div>}
                    </td>
                    <td style={td}>{r?.match?.name ?? ""}</td>
                    <td style={td}>{r ? where(r) : ""}</td>
                    <td style={td}>{r?.diffs.map((x) => <div key={x.field} style={{ opacity: x.kept ? 0.6 : 1 }}>{x.field}: {x.from || "(blank)"} → {x.to}{x.kept ? " (kept)" : ""}</div>)}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          {plan.notInImport.length > 0 && <div style={{ marginTop: 6 }}>
            <a style={{ cursor: "pointer", color: v("link") }} onClick={() => setShowLeft((s) => !s)}>{showLeft ? "▾" : "▸"} Not in this import (left alone) ({plan.notInImport.length})</a>
            {showLeft && <div style={{ opacity: 0.8, maxHeight: 100, overflow: "auto" }}>{plan.notInImport.map((d) => <div key={d.id}>{d.name}</div>)}</div>}
          </div>}
          {dry && dry.warnings.length > 0 && <div style={{ marginTop: 6 }}>
            <a style={{ cursor: "pointer", color: v("warn") }} onClick={() => setShowWarn((s) => !s)}>{showWarn ? "▾" : "▸"} Warnings ({dry.warnings.length})</a>
            {showWarn && <div style={{ maxHeight: 100, overflow: "auto" }}>{dry.warnings.map((w, i) => <div key={i}>{w}</div>)}</div>}
          </div>}
          <div style={{ textAlign: "right", marginTop: 10 }}>
            <button style={btn} onClick={() => setSpec(null)}>Back</button>
            <button style={btn} onClick={onClose}>Cancel</button>
            <button style={{ ...btn, marginRight: 0 }} disabled={n === 0} onClick={doImport}>{n === 0 ? "Nothing to import" : n === 1 ? "Import 1 change" : `Import ${n} changes`}</button>
          </div>
        </>}
      </div>
    </div>
  );
}

/** Height box that keeps a local draft while typing and commits on blur or Enter. */
function HeightInput({ value, onCommit }: { value: number; onCommit: (h: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const done = () => {
    if (draft == null) return;
    const h = Math.max(1, parseInt(draft) || value);
    setDraft(null);
    if (h !== value) onCommit(h);
  };
  return <input type="number" min={1} style={{ ...inp, width: 44 }} value={draft ?? String(value)}
    onChange={(e) => setDraft(e.target.value)} onBlur={done} onKeyDown={(e) => e.key === "Enter" && done()} />;
}
