// One site's tab in the Import from Auvik preview: device table, Changes, rack layout.
import { useState } from "react";
import { v } from "../../theme";
import type { ImportSpec } from "../../imports/spec";
import { readImport } from "../../imports/read";
import { StatusChip } from "../Panels";
import { ChangesList } from "../ChangeList";
import { hostsOf } from "../plan";
import { TO_PLACE_KINDS } from "./map";
import type { SitePlan } from "./sync";
import { btn, inp } from "./ui";

export interface SiteState {
  excluded: Set<string>;                 // device ids the person unticked
  fill: "empty" | "overwrite";
  layout: ImportSpec | null;
  hosts: Record<string, string>;         // VM key -> chosen host key
  ticks: Set<string> | null;             // ticked change ids; null = the defaults
  view: "devices" | "changes";
}
export const newSiteState = (): SiteState => ({ excluded: new Set(), fill: "empty", layout: null, hosts: {}, ticks: null, view: "devices" });

/** Default ticks, keyed exactly as the ids appear in the diffs (other racks carry a "<rackId>:" prefix). */
export const defaultTicks = (p: SitePlan): Set<string> =>
  new Set([...(p.diff?.changes ?? []), ...p.other.flatMap((o) => o.diff.changes)].filter((c) => c.defaultOn).map((c) => c.id));

export default function SitePreview({ view, eff, st, setSt, targetName, isNew }: {
  view: SitePlan;          // every device, for the table
  eff: SitePlan;           // without the unticked devices: what will be saved
  st: SiteState; setSt: (f: (s: SiteState) => SiteState) => void;
  targetName: string; isNew: boolean;
}) {
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const ticks = st.ticks ?? defaultTicks(eff);
  // Anything that changes the plan starts the ticks again from the defaults.
  const edit = (f: (s: SiteState) => SiteState) => setSt((s) => ({ ...f(s), ticks: null }));
  const changes = [...(eff.diff?.changes ?? []), ...eff.other.flatMap((o) => o.diff.changes)];
  const isOn = (c: { id: string }) => ticks.has(c.id);
  const setOn = (ids: string[], on: boolean) => setSt((s) => { const n = new Set(s.ticks ?? ticks); for (const id of ids) { if (on) n.add(id); else n.delete(id); } return { ...s, ticks: n }; });
  const hosts = hostsOf(view.items);
  const hostName = (k: string) => view.items.find((i) => i.key === k)?.dev.name ?? k;
  const heightOf = (key: string) => { const us = view.plan.units.filter((u) => u.itemKey === key); return us.length ? String(us.reduce((a, u) => a + u.tpl.u_size, 0)) : ""; };
  const destOf = (i: SitePlan["items"][number]) => (i.mode === "skip" ? "" : i.mode === "off" && TO_PLACE_KINDS.includes(i.kind) ? "To place" : "Inventory");
  const used = view.items.filter((i) => !st.excluded.has(i.dev.apiId ?? i.key)).length;

  const readLayout = (t: string) => {
    try { setErr(""); const sp = readImport(t, "auto"); edit((s) => ({ ...s, layout: sp })); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  const loadFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { setErr("That file is over 5 MB."); return; }
    try { const t = await f.text(); setText(t); readLayout(t); } catch { setErr("That file could not be read."); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ marginBottom: 6 }}>
        Goes to <b>{targetName}</b>{isNew ? " (new site)" : ""}: {used} of {view.items.length} devices ticked.
        {eff.target.docId == null ? ` A new document "${eff.target.name}" will be made.` : ` "${eff.target.name}" will be updated.`}
      </div>
      {view.plan.warnings.slice(0, 3).map((w, i) => <div key={i} style={{ opacity: 0.7 }}>Note: {w}</div>)}
      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", margin: "6px 0" }}>
        <label title="Off: only empty fields are filled. On: Auvik values replace yours (fields you edited by hand are still kept)."><input type="checkbox" checked={st.fill === "overwrite"} onChange={(e) => edit((s) => ({ ...s, fill: e.target.checked ? "overwrite" : "empty" }))} /> Overwrite existing values</label>
        <button style={{ ...btn, marginRight: 0 }} onClick={() => setLayoutOpen((o) => !o)}>{st.layout ? "Rack layout added" : "Add rack layout"}</button>
        {st.layout && <a style={{ cursor: "pointer", textDecoration: "underline" }} onClick={() => { setText(""); edit((s) => ({ ...s, layout: null })); }}>Remove layout</a>}
        {changes.length > 0 && (["devices", "changes"] as const).map((k) => (
          <button key={k} style={{ ...btn, marginRight: 0, background: st.view === k ? v("border") : v("control") }} onClick={() => setSt((s) => ({ ...s, view: k }))}>
            {k === "devices" ? "Devices" : `Changes (${changes.filter(isOn).length} of ${changes.length} ticked)`}
          </button>
        ))}
      </div>
      {layoutOpen && (
        <div style={{ border: `1px solid ${v("border-subtle")}`, borderRadius: 4, padding: 8, marginBottom: 6 }}>
          <div style={{ marginBottom: 4 }}>Paste the rack layout (top of rack first), or choose a text or CSV file. Devices that match are placed in the rack. The rest stay in To place.</div>
          <textarea style={{ ...inp, width: "100%", minHeight: 70, boxSizing: "border-box" }} value={text} onChange={(e) => setText(e.target.value)} />
          <div style={{ marginTop: 4 }}>
            <button style={btn} disabled={!text.trim()} onClick={() => readLayout(text)}>Use this layout</button>
            <input type="file" accept=".txt,.csv,.tsv,text/plain" onChange={(e) => loadFile(e.target.files?.[0])} />
          </div>
          {err && <div style={{ color: v("danger"), marginTop: 4 }}>{err}</div>}
        </div>
      )}
      {st.layout && <div style={{ marginBottom: 6, opacity: 0.85 }}>
        {eff.layoutRows?.length ? <>Will be placed in the rack: {eff.layoutRows.map((r) => `${r.match?.name ?? r.dev.name} (U${r.dev.u ?? "?"})`).join(", ")}.</> : "No device matched the layout, so nothing will be placed."}
      </div>}
      {st.view === "changes" && changes.length > 0 && <ChangesList changes={changes} isOn={isOn} setOn={setOn} />}
      <div style={{ overflow: "auto", border: `1px solid ${v("border-subtle")}`, borderRadius: 4, flex: 1, minHeight: 200, display: st.view === "changes" && changes.length > 0 ? "none" : undefined }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ position: "sticky", top: 0, background: v("border-faint") }}>
            <tr style={{ textAlign: "left" }}><th style={{ padding: 4 }}>Import</th><th>Name</th><th>Kind</th><th>Make &amp; model</th><th>Template</th><th>U</th><th>Goes to</th><th>Host</th><th>IP</th><th>Status</th></tr>
          </thead>
          <tbody>
            {view.items.map((i) => {
              const id = i.dev.apiId ?? i.key;
              const off = st.excluded.has(id);
              return (
                <tr key={i.key} style={{ borderTop: `1px solid ${v("border-faint")}`, opacity: off ? 0.45 : 1 }}>
                  <td style={{ padding: "2px 4px" }}><input type="checkbox" checked={!off} onChange={(e) => edit((s) => { const n = new Set(s.excluded); if (e.target.checked) n.delete(id); else n.add(id); return { ...s, excluded: n }; })} /></td>
                  <td>{i.dev.name}{i.units.length > 1 && <span style={{ opacity: 0.6 }}> (stack of {i.units.length})</span>}</td>
                  <td>{i.type}</td><td>{i.dev.model}</td>
                  <td style={{ opacity: i.generic ? 0.6 : 1 }}>{["rack", "off"].includes(i.mode) ? i.tplName : ""}</td>
                  <td>{["rack", "off"].includes(i.mode) ? heightOf(i.key) : ""}</td>
                  <td>{destOf(i)}</td>
                  <td>
                    {i.mode === "vm" && (
                      <select style={{ ...inp, maxWidth: 170 }} value={i.host ?? ""} onChange={(e) => edit((s) => ({ ...s, hosts: { ...s.hosts, [i.key]: e.target.value } }))}>
                        <option value="">No host</option>
                        {hosts.map((h) => <option key={h.key} value={h.key}>{h.dev.name}</option>)}
                        {i.host && !hosts.some((h) => h.key === i.host) && <option value={i.host}>{hostName(i.host)}</option>}
                      </select>
                    )}
                    {i.mode === "vm" && i.hostGuessed && !(i.key in st.hosts) && <span style={{ color: v("warn"), marginLeft: 6 }}>Guessed host — check</span>}
                  </td>
                  <td>{i.dev.ips[0]}</td><td><StatusChip s={i.dev.status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
