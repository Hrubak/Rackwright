// One site's tab in the Import from Auvik preview: device table, Changes, rack layout.
import { useState } from "react";
import { v } from "../../theme";
import type { ImportSpec } from "../../imports/spec";
import { readImport } from "../../imports/read";
import { ChangesList } from "../ChangeList";
import type { Kind } from "../plan";
import DeviceTable from "./DeviceTable";
import { leftOutNote } from "./links";
import type { SitePlan } from "./sync";
import type { SortCol } from "./table";
import { btn, inp } from "./ui";

export interface SiteState {
  excluded: Set<string>;                 // device ids the person unticked
  fill: "empty" | "overwrite";
  layout: ImportSpec | null;
  hosts: Record<string, string>;         // VM key -> chosen host key
  over: Record<string, boolean>;         // the person's own tick choices by change id; the rest follow defaultOn
  view: "devices" | "changes";
  kinds: Record<string, Kind>;           // the person's picks by plan item key (see Overrides in map.ts); a default is never stored
  types: Record<string, string>;
  models: Record<string, string>;        // "" = Auvik's text, "tpl:<catalog name>", "vm:hyperv|vmware|kvm"
  sort: { col: SortCol; dir: 1 | -1 } | null;   // null = Auvik's order
  filter: string;
}
export const newSiteState = (): SiteState => ({ excluded: new Set(), fill: "empty", layout: null, hosts: {}, over: {}, view: "devices", kinds: {}, types: {}, models: {}, sort: null, filter: "" });

/** The ticked change ids, keyed exactly as they appear in the diffs (other racks carry a "<rackId>:" prefix).
 *  The person's choices win; a change that is new after a re-plan follows its default. */
export const ticksOf = (p: SitePlan, over: Record<string, boolean>): Set<string> =>
  new Set([...(p.diff?.changes ?? []), ...p.other.flatMap((o) => o.diff.changes)].filter((c) => over[c.id] ?? c.defaultOn).map((c) => c.id));

export default function SitePreview({ view, eff, st, setSt, targetName, isNew, linkNote = "" }: {
  view: SitePlan;          // every device, for the table
  eff: SitePlan;           // without the unticked devices: what will be saved
  st: SiteState; setSt: (f: (s: SiteState) => SiteState) => void;
  targetName: string; isNew: boolean;
  linkNote?: string;       // why the cables were not read, or ""
}) {
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [allNotes, setAllNotes] = useState(false);
  const ticks = ticksOf(eff, st.over);
  const edit = (f: (s: SiteState) => SiteState) => setSt(f);   // the plan is redone; the person's tick choices stay
  const changes = [...(eff.diff?.changes ?? []), ...eff.other.flatMap((o) => o.diff.changes)];
  const isOn = (c: { id: string }) => ticks.has(c.id);
  const setOn = (ids: string[], on: boolean) => setSt((s) => { const o = { ...s.over }; for (const id of ids) o[id] = on; return { ...s, over: o }; });
  const notes = [linkNote, leftOutNote(view.inv, view.links), ...view.plan.warnings, ...eff.notes].filter(Boolean);
  const shown = allNotes ? notes : notes.slice(0, 3);
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
      {shown.map((w, i) => <div key={i} style={{ opacity: 0.7 }}>Note: {w}</div>)}
      {notes.length > 3 && <a style={{ cursor: "pointer", textDecoration: "underline", opacity: 0.85 }} onClick={() => setAllNotes((o) => !o)}>{allNotes ? "Show fewer" : `Show all ${notes.length} notes`}</a>}
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
      {st.view === "changes" && changes.length > 0 && (
        <div style={{ overflow: "auto", flex: 1, minHeight: 200 }}>
          {(eff.diff?.changes.length ?? 0) > 0 && <ChangesList changes={eff.diff!.changes} isOn={isOn} setOn={setOn} />}
          {eff.other.map((o) => (
            <div key={o.rackId}>
              <div style={{ fontWeight: 600, margin: "10px 0 4px" }}>In {o.rackName}</div>
              <ChangesList changes={o.diff.changes} isOn={isOn} setOn={setOn} />
            </div>
          ))}
        </div>
      )}
      <div style={{ display: st.view === "changes" && changes.length > 0 ? "none" : "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <DeviceTable view={view} eff={eff} st={st} setSt={setSt} />
      </div>
    </div>
  );
}
