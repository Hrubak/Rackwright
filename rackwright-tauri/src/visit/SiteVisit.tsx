import { v } from "../theme";
import { useEffect, useRef, useState } from "react";
import type { Doc } from "../types";
import { STATUSES, statusOf } from "../device/info";
import { VISIT_FIELDS, applyStep, finishVisit, posLabel, visitList } from "./model";
import type { VisitField } from "./model";

const btn = { background: v("control"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "5px 12px", marginRight: 5, cursor: "pointer" } as const;
const primary = { ...btn, background: v("focus"), color: v("bg"), fontWeight: 600 } as const;
const inp = { background: v("bg"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "3px 5px", width: "100%", boxSizing: "border-box" } as const;

type Counts = { confirmed: number; corrected: number; missing: number; skipped: number };
type Result = "confirmed" | "corrected" | "missing" | "skipped";
type Drafts = { id: number; values: Record<VisitField, string> };

const ZERO: Counts = { confirmed: 0, corrected: 0, missing: 0, skipped: 0 };

export default function SiteVisit({ doc, rackId, edit, today, onClose }: {
  doc: Doc; rackId: number; edit: (fn: (d: Doc) => string | void) => boolean; today: string; onClose: () => void;
}) {
  const [list] = useState(() => visitList(doc, rackId));
  const [i, setI] = useState(0);
  const [counts, setCounts] = useState<Counts>(ZERO);
  const [history, setHistory] = useState<{ i: number; res: Result }[]>([]);
  const [markedMissing, setMarkedMissing] = useState<number[]>([]);
  const [drafts, setDrafts] = useState<Drafts | null>(null);
  const matchRef = useRef<HTMLButtonElement>(null);
  const rack = doc.racks.find((r) => r.id === rackId);
  const rackName = rack?.name ?? "this rack";

  // A device is walked only if it still exists in this rack (or was marked missing in this walk, so Back can show it).
  const walkable = (id: number) => {
    const d = doc.devices.find((x) => x.id === id);
    return !!d && (d.rack === rackId || markedMissing.includes(id));
  };
  // Skip ahead over devices that are gone or moved away.
  let idx = i;
  while (idx < list.length && !walkable(list[idx])) idx++;
  const done = idx >= list.length;
  const curId = done ? null : list[idx];
  const dev = curId == null ? null : doc.devices.find((x) => x.id === curId) ?? null;
  const firstIdx = list.findIndex(walkable);
  const canBack = history.length > 0;

  // Reset the field drafts from the live device when the step changes.
  useEffect(() => {
    const d = curId == null ? null : doc.devices.find((x) => x.id === curId);
    if (!d) { setDrafts(null); return; }
    setDrafts({ id: d.id, values: {
      name: d.name ?? "", status: statusOf(d), manufacturer: d.manufacturer ?? "", model: d.model ?? "",
      serial: d.serial ?? "", asset_tag: d.asset_tag ?? "", ip: d.ip ?? "",
    } });
    matchRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curId]);

  // Stamp the rack once when the finish screen is reached, so how it is closed does not matter.
  const stamped = useRef(false);
  const worked = counts.confirmed + counts.corrected + counts.missing > 0;
  useEffect(() => {
    if (!done) { stamped.current = false; return; }
    if (list.length === 0 || !worked || stamped.current) return;
    stamped.current = true;
    edit((d) => { finishVisit(d, rackId, counts, today); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, worked]);

  const push = (res: Result) => {
    setHistory((h) => [...h, { i: idx, res }]);
    setCounts((c) => ({ ...c, [res]: c[res] + 1 }));
    setI(idx + 1);
  };
  const act = (action: "ok" | "missing") => {
    if (curId == null || !drafts || drafts.id !== curId) return;
    let res: ReturnType<typeof applyStep> = "gone";
    const ok = edit((d) => { res = applyStep(d, curId, action, drafts.values, today); });
    if (!ok) return;
    if (res === "gone") { setI(idx + 1); return; } // nothing counted
    if (res === "missing") setMarkedMissing((m) => [...m, curId]);
    push(res);
  };
  const skip = () => push("skipped");
  const back = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory((h) => h.slice(0, -1));
    setCounts((c) => ({ ...c, [last.res]: c[last.res] - 1 }));
    setI(last.i);
  };

  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation(); // keep Ctrl+Z, Delete etc. from reaching the app behind the dialog
    if (e.key === "Escape") { onClose(); return; }
    if (e.key !== "Enter" || done || e.defaultPrevented) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "SELECT" || tag === "BUTTON") return;
    e.preventDefault();
    act("ok");
  };

  const counter = `${counts.confirmed} confirmed · ${counts.corrected} corrected · ${counts.missing} not found`;
  const total = list.filter(walkable).length;
  const stepNo = Math.min(history.length + 1, Math.max(total, 1));

  return (
    <div style={{ position: "fixed", inset: 0, background: v("overlay"), display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }} onKeyDown={onKey}>
      <div style={{ background: v("panel"), padding: 14, borderRadius: 6, width: 520, maxWidth: "96vw", maxHeight: "92vh", overflow: "auto", display: "flex", flexDirection: "column", border: `1px solid ${v("border")}`, color: v("text"), fontSize: 12 }}>
        <div style={{ display: "flex", marginBottom: 10 }}>
          <b style={{ flex: 1, fontSize: 14 }}>Site visit · {rackName}</b>
          {!done && list.length > 0 && <button style={{ ...btn, marginRight: 0 }} onClick={onClose}>Exit visit</button>}
        </div>

        {list.length === 0 && <>
          <div style={{ marginBottom: 12 }}>This rack has no devices to check.</div>
          <div style={{ textAlign: "right" }}><button style={{ ...btn, marginRight: 0 }} onClick={onClose}>Close</button></div>
        </>}

        {list.length > 0 && done && <>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Visit complete — {rackName}</div>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 14px", marginBottom: 10 }}>
            <span>Confirmed</span><b>{counts.confirmed}</b>
            <span>Corrected</span><b>{counts.corrected}</b>
            <span>Not found</span><b>{counts.missing}</b>
            <span>Skipped</span><b>{counts.skipped}</b>
          </div>
          <div style={{ marginBottom: 12, opacity: 0.8 }}>
            {counts.confirmed + counts.corrected + counts.missing > 0
              ? "The rack is marked as checked today. Each confirmed or corrected device has today's date in Last checked on site."
              : "Everything was skipped, so the rack is not marked as checked."}
          </div>
          <div style={{ textAlign: "right" }}>
            {canBack && <button style={btn} onClick={back}>Back</button>}
            <button style={{ ...primary, marginRight: 0 }} autoFocus onClick={onClose}>Close</button>
          </div>
        </>}

        {list.length > 0 && !done && dev && drafts && drafts.id === curId && <>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span>{stepNo} of {total}</span>
            <span style={{ opacity: 0.8 }}>{counter}</span>
          </div>
          <div style={{ marginBottom: 6 }}>
            <b>{posLabel(dev)}</b>
            <span style={{ opacity: 0.7 }}> · {dev.last_verified ? `Last checked ${dev.last_verified}` : "Never checked on site"}</span>
          </div>
          <div style={{ opacity: 0.8, marginBottom: 8 }}>Look at the device in this spot. If the record is right, press Matches. If not, fix the fields, then press Matches.</div>
          <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: 6, alignItems: "center", marginBottom: 12 }}>
            {VISIT_FIELDS.map((f) => <label key={f.key} style={{ display: "contents" }}>
              <span>{f.label}</span>
              {f.key === "status"
                ? <select style={inp} value={drafts.values.status} onChange={(e) => setDrafts({ ...drafts, values: { ...drafts.values, status: e.target.value } })}>
                    {STATUSES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
                  </select>
                : <input style={inp} value={drafts.values[f.key]} onChange={(e) => setDrafts({ ...drafts, values: { ...drafts.values, [f.key]: e.target.value } })} />}
            </label>)}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            <button ref={matchRef} autoFocus style={{ ...primary, marginRight: 0 }} onClick={() => act("ok")}>Matches</button>
            <button style={{ ...btn, marginRight: 0 }} title="It isn't here: moves it off-rack and sets it to Offline" onClick={() => act("missing")}>Not in the rack</button>
            <button style={{ ...btn, marginRight: 0 }} onClick={skip}>Skip</button>
            {canBack && idx !== firstIdx && <button style={{ ...btn, marginRight: 0 }} onClick={back}>Back</button>}
          </div>
        </>}
      </div>
    </div>
  );
}
