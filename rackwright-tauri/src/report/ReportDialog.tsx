// "Client report" dialog: pick a client, detail level and sites, then export the PDF.
import { useEffect, useState } from "react";
import { v } from "../theme";
import { clientStore, type ClientItem, type ClientListItem } from "../clients/store";
import { useSettings } from "../settings/context";
import { exportClientReport } from "./index";
import type { ReportOptions } from "./types";

const inp = { background: v("bg"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "4px 6px", fontSize: 12, boxSizing: "border-box" } as const;
const btn = { background: v("control"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "4px 12px", marginLeft: 6, cursor: "pointer", fontSize: 12 } as const;
const lbl = { display: "block", fontSize: 12, opacity: 0.8, margin: "10px 0 3px" } as const;
const errOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export default function ReportDialog({ clientKey, onClose }: { clientKey?: string; onClose: () => void }) {
  const store = clientStore();
  const { system } = useSettings();
  const [list, setList] = useState<ClientListItem[]>([]);
  const [key, setKey] = useState(clientKey ?? "");
  const [client, setClient] = useState<ClientItem | null>(null);
  const [level, setLevel] = useState<ReportOptions["level"]>("overview");
  const [sites, setSites] = useState<number[]>([]);
  const [date, setDate] = useState(today());
  const [prepared, setPrepared] = useState("");
  const [summary, setSummary] = useState("");
  const [recs, setRecs] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { store.list().then(setList, (e) => setErr(errOf(e))); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!key) { setClient(null); return; }
    let live = true;
    (async () => {
      try {
        const [c, o] = await Promise.all([store.get(key), store.getReport(key)]);
        if (!live) return;
        setClient(c);
        const all = c.sites.map((s) => s.id);
        setSites(o && o.sites !== "all" ? all.filter((id) => (o.sites as number[]).includes(id)) : all);
        setLevel(o?.level === "detailed" ? "detailed" : "overview");
        setSummary(o?.summary ?? ""); setRecs(o?.recommendations ?? "");
        setDate(o?.date || today());
        setPrepared(o?.prepared_for || c.name);
        setErr("");
      } catch (e) { if (live) { setClient(null); setErr(errOf(e)); } }
    })();
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = async () => {
    if (!client) return;
    setBusy(true); setErr("");
    try {
      const o: ReportOptions = {
        level, sites: sites.length === client.sites.length ? "all" : sites, summary, recommendations: recs,
        date: date || today(), prepared_for: prepared.trim() || client.name,
      };
      await store.setReport(client.key, o);
      if (await exportClientReport(client.key, o, system)) onClose();
    } catch (e) { setErr(errOf(e)); } finally { setBusy(false); }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: v("overlay"), display: "flex", alignItems: "center", justifyContent: "center", zIndex: 120 }}>
      <div style={{ background: v("panel"), padding: 14, borderRadius: 6, width: 560, maxWidth: "94vw", maxHeight: "90vh", overflow: "auto", border: `1px solid ${v("border")}`, color: v("text"), fontSize: 13 }}>
        <b style={{ fontSize: 14 }}>Client report</b>
        <label style={lbl}>Client</label>
        <select style={{ ...inp, width: "100%" }} value={key} disabled={busy} onChange={(e) => setKey(e.target.value)}>
          <option value="">Pick a client</option>
          {list.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
        </select>
        {client && <>
          <label style={lbl}>Detail</label>
          <label style={{ marginRight: 14 }}><input type="radio" checked={level === "overview"} disabled={busy} onChange={() => setLevel("overview")} /> Overview</label>
          <label><input type="radio" checked={level === "detailed"} disabled={busy} onChange={() => setLevel("detailed")} /> Detailed</label>
          <div style={{ fontSize: 11, opacity: 0.7, marginTop: 3 }}>Overview: diagrams and totals. Detailed: adds rear views, switch ports, device tables and the full inventory.</div>
          <label style={lbl}>Sites</label>
          {!client.sites.length && <div style={{ opacity: 0.7 }}>This client has no sites yet.</div>}
          {client.sites.map((s) => (
            <label key={s.id} style={{ display: "block" }}>
              <input type="checkbox" checked={sites.includes(s.id)} disabled={busy} onChange={(e) => setSites(e.target.checked ? [...sites, s.id] : sites.filter((x) => x !== s.id))} /> {s.name}
            </label>
          ))}
          <label style={lbl}>Report date</label>
          <input type="date" style={inp} value={date} disabled={busy} onChange={(e) => setDate(e.target.value)} />
          <label style={lbl}>Prepared for</label>
          <input style={{ ...inp, width: "100%" }} value={prepared} disabled={busy} onChange={(e) => setPrepared(e.target.value)} />
          <label style={lbl}>Executive summary</label>
          <textarea style={{ ...inp, width: "100%" }} rows={6} value={summary} disabled={busy} onChange={(e) => setSummary(e.target.value)} />
          <label style={lbl}>Recommendations</label>
          <textarea style={{ ...inp, width: "100%" }} rows={6} value={recs} disabled={busy} onChange={(e) => setRecs(e.target.value)} />
        </>}
        {busy && <div style={{ marginTop: 10 }}>Building the report…</div>}
        {err && <div style={{ marginTop: 10, color: v("danger") }}>{err}</div>}
        <div style={{ marginTop: 12, textAlign: "right" }}>
          <button style={btn} disabled={busy} onClick={onClose}>Cancel</button>
          <button style={btn} disabled={busy || !client || !sites.length} onClick={go}>Export PDF</button>
        </div>
      </div>
    </div>
  );
}
