// The device table on a site's tab in Import from Auvik: filter, select all / none, bulk kind, sortable columns,
// and the Kind, Type and Model pickers. A picker writes an override only when the person changes the value.
import { useEffect, useMemo, useRef, useState } from "react";
import { v } from "../../theme";
import { CATALOG } from "../../edit";
import { StatusChip } from "../Panels";
import { hostsOf, type Kind } from "../plan";
import { KIND_FAMILY, KIND_LABEL, VM_MODELS, defaultModelChoice, kindsFor, type ApiPlanItem } from "./map";
import type { SitePlan } from "./sync";
import type { SiteState } from "./SitePreview";
import { destOf, deviceRowTypes, filterRows, headState, modelLabel, setPick, setTicked, sortRows, type Row, type SortCol } from "./table";
import { btn, inp } from "./ui";

const KINDS = Object.keys(KIND_LABEL) as Kind[];
const COLS: [SortCol | null, string][] = [[null, "Import"], ["name", "Name"], ["kind", "Kind"], ["type", "Type"], ["model", "Model"], ["template", "Template"], ["u", "U"], ["rack", "Rack"], [null, "Host"], ["ip", "IP"], ["status", "Status"]];
const sel = { ...inp, maxWidth: 140 } as const;
const isDev = (i: ApiPlanItem) => i.mode === "rack" || i.mode === "off";

export default function DeviceTable({ view, eff, st, setSt }: {
  view: SitePlan; eff: SitePlan;
  st: SiteState; setSt: (f: (s: SiteState) => SiteState) => void;
}) {
  const [bulk, setBulk] = useState<Kind>("switch");
  const [skipNote, setSkipNote] = useState("");
  const head = useRef<HTMLInputElement>(null);
  const hosts = hostsOf(view.items);
  const hostName = (k: string) => view.items.find((i) => i.key === k)?.dev.name ?? k;
  const byType = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const t of CATALOG) m.set(t.type, [...(m.get(t.type) ?? []), t.name]);
    return m;
  }, []);

  // Per row: the computed defaults and the display strings the sort and filter use.
  const info = useMemo(() => view.items.map((i) => {
    const units = view.plan.units.filter((u) => u.itemKey === i.key);
    const hd = view.held[i.key];
    // a matched device shows the type it has now (maybe set by hand); a kind pick shows the type it will get
    const tplType = !i.kindOver && hd?.type ? hd.type : units[0]?.tpl.type ?? "";
    const type = isDev(i) ? i.typeOver ?? tplType : i.mode === "vm" ? "Virtual machines" : i.mode === "skip" ? "" : "Endpoints";
    const model = st.models[i.key] ?? defaultModelChoice(i);
    const held = units.map((u) => view.heldIn[u.key]).find(Boolean);
    const row: Row = {
      key: i.key, id: i.dev.apiId ?? i.key, name: i.dev.name, kind: KIND_LABEL[i.kind], type, model: modelLabel(model, i.dev.model),
      template: isDev(i) ? i.tplName : "", u: isDev(i) && units.length ? String(units.reduce((a, u) => a + u.tpl.u_size, 0)) : "",
      rack: i.mode === "skip" ? "" : held ?? eff.target.name, dest: held ? "" : destOf(i.mode, i.kind),
      ip: i.dev.ips[0] ?? "", status: i.dev.status,
    };
    return { i, row, tplType, model, baseKind: i.baseKind ?? i.kind, hd };
  }), [view, eff.target.name, st.models]);

  const shown = useMemo(() => {
    const byKey = new Map(info.map((x) => [x.row.key, x]));
    return sortRows(filterRows(info.map((x) => x.row), st.filter), st.sort).map((r) => byKey.get(r.key)!);
  }, [info, st.filter, st.sort]);
  const visibleIds = shown.map((x) => x.row.id);
  const hs = headState(st.excluded, visibleIds);
  useEffect(() => { if (head.current) head.current.indeterminate = hs === "some"; }, [hs]);
  const bulkRows = shown.filter((x) => !st.excluded.has(x.row.id));

  const tick = (ids: string[], on: boolean) => setSt((s) => ({ ...s, excluded: setTicked(s.excluded, ids, on) }));
  // a row the site already holds only takes a kind of its own family (see Family in map.ts): the rest are skipped
  const fits = (x: (typeof info)[number], k: Kind) => !x.hd || KIND_FAMILY[k] === x.hd.family;
  const setKind = (list: typeof info, k: Kind) => {
    const skipped = list.filter((x) => !fits(x, k)).length;
    setSkipNote(skipped ? `Skipped ${skipped} row${skipped === 1 ? "" : "s"} already in a rack document. Move those by hand.` : "");
    setSt((s) => {
      let kinds = s.kinds;
      for (const x of list) if (x.i.kind !== k && fits(x, k)) kinds = setPick(kinds, x.i.key, k, x.baseKind);
      return { ...s, kinds };
    });
  };
  const sortBy = (col: SortCol) => setSt((s) => ({ ...s, sort: s.sort?.col === col ? { col, dir: s.sort.dir === 1 ? -1 : 1 } : { col, dir: 1 } }));

  return (
    <>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "6px 0" }}>
        <input style={{ ...inp, width: 180 }} placeholder="Filter devices" aria-label="Filter devices" value={st.filter} onChange={(e) => { const f = e.target.value; setSt((s) => ({ ...s, filter: f })); }} />
        <button style={{ ...btn, marginRight: 0 }} disabled={!visibleIds.length} onClick={() => tick(visibleIds, true)}>Select all</button>
        <button style={{ ...btn, marginRight: 0 }} disabled={!visibleIds.length} onClick={() => tick(visibleIds, false)}>Select none</button>
        <span style={{ marginLeft: 8 }}>Set kind for the {bulkRows.length} ticked rows shown:</span>
        <select style={inp} aria-label="Kind for the ticked rows" value={bulk} onChange={(e) => setBulk(e.target.value as Kind)}>
          {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <button style={{ ...btn, marginRight: 0 }} disabled={!bulkRows.length} onClick={() => setKind(bulkRows, bulk)}>Apply</button>
        {skipNote && <span style={{ opacity: 0.75 }}>{skipNote}</span>}
      </div>
      <div style={{ overflow: "auto", border: `1px solid ${v("border-subtle")}`, borderRadius: 4, flex: 1, minHeight: 200 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ position: "sticky", top: 0, background: v("border-faint"), zIndex: 1 }}>
            <tr style={{ textAlign: "left" }}>
              {COLS.map(([col, label]) => (
                <th key={label} style={{ padding: 4, whiteSpace: "nowrap" }} aria-sort={col && st.sort?.col === col ? (st.sort.dir === 1 ? "ascending" : "descending") : undefined}>
                  {label === "Import" ? (
                    <label><input ref={head} type="checkbox" aria-label="Tick all rows shown" checked={hs === "all"} disabled={!visibleIds.length} onChange={(e) => tick(visibleIds, e.target.checked)} /> Import</label>
                  ) : col ? (
                    <button onClick={() => sortBy(col)} style={{ background: "none", border: "none", color: v("text"), font: "inherit", fontWeight: 600, padding: 0, cursor: "pointer" }}>
                      {label}{st.sort?.col === col ? (st.sort.dir === 1 ? " ▲" : " ▼") : ""}
                    </button>
                  ) : label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map(({ i, row, tplType, model, baseKind, hd }) => {
              const off = st.excluded.has(row.id);
              const tpls = isDev(i) ? byType.get(row.type) ?? [] : [];
              const extraTpl = model.startsWith("tpl:") && !tpls.includes(model.slice(4)) ? model.slice(4) : null;
              const kinds = kindsFor(hd?.family);
              return (
                <tr key={i.key} style={{ borderTop: `1px solid ${v("border-faint")}`, opacity: off ? 0.45 : 1 }}>
                  <td style={{ padding: "2px 4px" }}><input type="checkbox" aria-label={`Import ${i.dev.name}`} checked={!off} onChange={(e) => tick([row.id], e.target.checked)} /></td>
                  <td>{i.dev.name}{i.units.length > 1 && <span style={{ opacity: 0.6 }}> (stack of {i.units.length})</span>}</td>
                  <td>
                    <select style={sel} aria-label={`Kind of ${i.dev.name}`} title={hd ? `Already in ${hd.rack}. Move it by hand to change where it goes.` : undefined} value={i.kind} onChange={(e) => { const k = e.target.value as Kind; setSt((s) => ({ ...s, kinds: setPick(s.kinds, i.key, k, baseKind) })); }}>
                      {!kinds.includes(i.kind) && <option value={i.kind}>{KIND_LABEL[i.kind]}</option>}
                      {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                    </select>
                  </td>
                  <td>
                    {isDev(i) ? (
                      <select style={sel} aria-label={`Type of ${i.dev.name}`} value={row.type} onChange={(e) => { const ty = e.target.value; setSt((s) => ({ ...s, types: setPick(s.types, i.key, ty, tplType) })); }}>
                        {!row.type && <option value="">(none)</option>}
                        {deviceRowTypes(row.type).map((ty) => <option key={ty} value={ty}>{ty}</option>)}
                      </select>
                    ) : row.type}
                  </td>
                  <td>
                    <select style={sel} aria-label={`Model of ${i.dev.name}`} value={model} onChange={(e) => { const m = e.target.value; setSt((s) => ({ ...s, models: setPick(s.models, i.key, m, defaultModelChoice(i)) })); }}>
                      <option value="">{i.dev.model || "(no model)"}</option>
                      {(tpls.length > 0 || extraTpl) && <optgroup label="Catalog">
                        {extraTpl && <option value={"tpl:" + extraTpl}>{extraTpl}</option>}
                        {tpls.map((n, k) => <option key={k} value={"tpl:" + n}>{n}</option>)}
                      </optgroup>}
                      <optgroup label="Virtual Machine">
                        {Object.entries(VM_MODELS).map(([k, label]) => <option key={k} value={"vm:" + k}>{label}</option>)}
                      </optgroup>
                    </select>
                  </td>
                  <td style={{ opacity: i.generic ? 0.6 : 1 }}>{row.template}</td>
                  <td>{row.u}</td>
                  <td>{row.rack}{row.dest && <div style={{ fontSize: 11, opacity: 0.6 }}>{row.dest}</div>}</td>
                  <td>
                    {i.mode === "vm" && (
                      <select style={{ ...inp, maxWidth: 170 }} value={i.host ?? ""} onChange={(e) => { const h = e.target.value; setSt((s) => ({ ...s, hosts: { ...s.hosts, [i.key]: h } })); }}>
                        <option value="">No host</option>
                        {hosts.map((h) => <option key={h.key} value={h.key}>{h.dev.name}</option>)}
                        {i.host && !hosts.some((h) => h.key === i.host) && <option value={i.host}>{hostName(i.host)}</option>}
                      </select>
                    )}
                    {i.mode === "vm" && i.hostGuessed && !(i.key in st.hosts) && <span style={{ color: v("warn"), marginLeft: 6 }}>Guessed host — check</span>}
                  </td>
                  <td>{row.ip}</td><td><StatusChip s={i.dev.status} /></td>
                </tr>
              );
            })}
            {!shown.length && <tr><td colSpan={COLS.length} style={{ padding: 8, opacity: 0.7 }}>No device matches the filter.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
