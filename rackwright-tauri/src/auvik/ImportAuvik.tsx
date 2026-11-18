import { v } from "../theme";
import { useMemo, useState } from "react";
import { Doc } from "../types";
import { GENERIC_MAX_U, GENERIC_MIN_U, RACK_MODELS, modelById, specOf } from "../racks";
import { applyInPlace, findMissing } from "./apply";
import { Change, computeDiff } from "./diff";
import { ChangesList } from "./ChangeList";
import { Mode, Mount, PlanItem, hostCtxOf, hostsOf, oobmHostsOf, resolvePlan, retype, setMode as setItemMode } from "./plan";
import type { ParsedAuvik } from "./parse";
import { StatusChip, UnplacedDialog } from "./Panels";

const btn = { background: v("control"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "5px 12px", marginRight: 5, cursor: "pointer" } as const;
const inp = { background: v("bg"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "3px 5px" } as const;
const MODES: [Mode, string][] = [["rack", "Rack"], ["off", "Off-rack"], ["endpoint", "Endpoint"], ["phone", "Phone"], ["iot", "IoT"], ["vm", "Virtual machine"], ["skip", "Skip"]];
const TYPES = ["Access Point", "Controller", "Firewall", "Generic Device", "Hypervisor", "Intelligent Platform Management Interface", "IP Phone", "Layer 3 Switch", "Printer",
  "Router", "Server", "Storage", "Switch", "Telecommunications Device", "UPS", "PDU", "Virtual Machine", "Workstation", "Unknown"];

export default function ImportAuvik({ doc, rackId, onApply, onClose }: {
  doc: Doc; rackId: number | null; onApply: (fn: (d: Doc) => string | void) => boolean; onClose: () => void;
}) {
  const [parsed, setParsed] = useState<ParsedAuvik | null>(null);
  const [items, setItems] = useState<PlanItem[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const hasAuvik = doc.devices.some((d) => d.auvik_id);
  const [target, setTarget] = useState<"new" | "current">(hasAuvik && doc.racks.length ? "current" : "new");
  const [modelId, setModelId] = useState("apc-ar3100");
  const [gu, setGu] = useState("42");
  const [showUnplaced, setShowUnplaced] = useState(false);
  const [tab, setTab] = useState<"devices" | "changes">("devices");
  const [ovr, setOvr] = useState<Record<string, boolean>>({});
  const ctx = useMemo(() => hostCtxOf(doc), [doc]);

  const load = async (f: File | undefined) => {
    if (!f) return;
    setErr(""); setBusy(true);
    try {
      const [{ readXlsx }, { parseAuvik }, { buildItems }] = await Promise.all([import("./xlsx"), import("./parse"), import("./plan")]);
      const p = parseAuvik(await readXlsx(await f.arrayBuffer()));
      setParsed(p); setItems(buildItems(p, ctx)); setOvr({}); setTab("devices");
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  const plan = useMemo(() => (parsed ? resolvePlan(parsed, items) : null), [parsed, items]);
  const missing = useMemo(() => (parsed ? findMissing(doc, items) : []), [parsed, items, doc]);
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const i of items) c.set(i.dev.type || "Unknown", (c.get(i.dev.type || "Unknown") || 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);
  const model = modelById(modelId);
  const guN = parseInt(gu);
  const guOk = !model?.generic || (guN >= GENERIC_MIN_U && guN <= GENERIC_MAX_U);
  const setMode = (key: string, mode: Mode) => setItems((l) => setItemMode(l, key, mode, ctx));
  const setType = (key: string, type: string) => parsed && setItems((l) => retype(parsed, l, key, type, ctx));
  const setHost = (key: string, host: string) => setItems((l) => l.map((i) => (i.key === key ? { ...i, host } : i)));
  const setMount = (key: string, mount: Mount) => setItems((l) => l.map((i) => (i.key === key ? { ...i, mount } : i)));
  const hosts = useMemo(() => hostsOf(items), [items]);
  const oobmHosts = useMemo(() => oobmHostsOf(items), [items]);
  const docHosts = useMemo(() => ctx.servers.filter((s) => !oobmHosts.some((h) => h.key === s.auvikKey)), [ctx, oobmHosts]);
  const review = target === "current" && hasAuvik;
  const diff = useMemo(() => (review && plan ? computeDiff(doc, plan, items) : null), [review, doc, plan, items]);
  const isOn = (c: Change) => ovr[c.id] ?? c.defaultOn;
  const tickedCount = diff ? diff.changes.filter(isOn).length : 0;

  const doImport = () => {
    if (!parsed || !plan) return;
    const ok = onApply((d) => {
      const sel = diff ? new Set(diff.changes.filter(isOn).map((c) => c.id)) : undefined;
      const r = applyInPlace(d, plan, { target, spec: model ? specOf(model) : undefined, rackU: model ? (model.generic ? guN : model.u) : 42, rackId }, items, sel);
      return r.message;
    });
    if (ok) onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: v("overlay"), display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
      onKeyDown={(e) => e.key === "Escape" && !showUnplaced && onClose()}>
      <div style={{ background: v("panel"), padding: 14, borderRadius: 6, width: 1100, maxWidth: "96vw", maxHeight: "92vh", display: "flex", flexDirection: "column", border: `1px solid ${v("border")}`, color: v("text"), fontSize: 12 }}>
        <div style={{ display: "flex", marginBottom: 10 }}>
          <b style={{ flex: 1, fontSize: 14 }}>Import Auvik</b>
          <button style={{ ...btn, marginRight: 0, padding: "1px 8px" }} onClick={onClose}>x</button>
        </div>
        {!parsed && (
          <div style={{ padding: "10px 0" }}>
            <div style={{ marginBottom: 8 }}>Choose the device export from Auvik (.xlsx). The file stays on this computer.</div>
            <input type="file" accept=".xlsx" disabled={busy} onChange={(e) => load(e.target.files?.[0])} />
            {busy && <span style={{ marginLeft: 8 }}>Reading...</span>}
            {err && <div style={{ color: v("danger"), marginTop: 8 }}>{err}</div>}
          </div>
        )}
        {parsed && plan && <>
          <div style={{ marginBottom: 6 }}>
            <b>{parsed.site}</b>: {items.length} devices. {counts.map(([t, n]) => `${n} ${t}`).join(", ")}.
          </div>
          {plan.warnings.slice(0, 3).map((w, i) => <div key={i} style={{ opacity: 0.7 }}>Note: {w}</div>)}
          {!review && missing.length > 0 && (
            <div style={{ background: v("warn-bg"), border: `1px solid ${v("warn")}`, borderRadius: 4, padding: "4px 8px", margin: "6px 0" }}>
              Missing from this export (kept in the rack, not deleted): {missing.map((d) => d.name).join(", ")}
            </div>
          )}
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", margin: "6px 0" }}>
            <label>Target:{" "}
              <select style={inp} value={target} onChange={(e) => setTarget(e.target.value as "new" | "current")}>
                <option value="new">New layout (new racks)</option>
                <option value="current" disabled={!doc.racks.length}>Add to current</option>
              </select></label>
            {target === "new" && <>
              <label>Rack:{" "}
                <select style={{ ...inp, maxWidth: 260 }} value={modelId} onChange={(e) => { setModelId(e.target.value); const m = modelById(e.target.value); if (m?.generic) setGu(String(m.u)); }}>
                  {RACK_MODELS.map((m) => <option key={m.id} value={m.id}>{m.generic ? m.name : `${m.name} (${m.u}U)`}</option>)}
                </select></label>
              {model?.generic && <label>U: <input type="number" style={{ ...inp, width: 56, borderColor: guOk ? v("border") : v("danger") }} value={gu} onChange={(e) => setGu(e.target.value)} /></label>}
            </>}
            <span>{plan.groups.length} endpoint group(s), {plan.vmBoxes.length} VM box(es), {plan.cables.length} cable(s)</span>
            <button style={btn} onClick={() => setShowUnplaced(true)}>Unplaced endpoints ({plan.unplaced.length})</button>
            {plan.virtual.length > 0 && <span style={{ opacity: 0.7 }}>Not drawn (virtual): {plan.virtual.join(", ")}</span>}
          </div>
          {diff && (
            <div style={{ margin: "4px 0" }}>
              {(["devices", "changes"] as const).map((k) => (
                <button key={k} style={{ ...btn, background: tab === k ? v("border") : v("control") }} onClick={() => setTab(k)}>{k === "devices" ? "Devices" : `Changes (${tickedCount} of ${diff.changes.length} ticked)`}</button>
              ))}
            </div>
          )}
          {diff && tab === "changes" && <ChangesList changes={diff.changes} isOn={isOn} setOn={(ids, v) => setOvr((o) => { const n = { ...o }; for (const id of ids) n[id] = v; return n; })} />}
          <div style={{ overflow: "auto", border: `1px solid ${v("border-subtle")}`, borderRadius: 4, flex: 1, minHeight: 200, display: diff && tab === "changes" ? "none" : undefined }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ position: "sticky", top: 0, background: v("border-faint") }}>
                <tr style={{ textAlign: "left" }}><th style={{ padding: 4 }}>Include as</th><th>Name</th><th>Type</th><th>Make &amp; model</th><th>Matched template</th><th>Host / mount</th><th>IP</th><th>Status</th><th>Connected to</th></tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.key} style={{ borderTop: `1px solid ${v("border-faint")}`, opacity: i.mode === "skip" ? 0.55 : 1 }}>
                    <td style={{ padding: "2px 4px" }}>
                      <select style={inp} value={i.mode} onChange={(e) => setMode(i.key, e.target.value as Mode)}>
                        {MODES.map(([m, l]) => <option key={m} value={m}>{l}</option>)}
                      </select>
                      {i.virtual && i.mode === "skip" && <div style={{ fontSize: 10, opacity: 0.7 }}>virtual, not drawn</div>}
                    </td>
                    <td>{i.dev.name}{i.units.length > 1 && <span style={{ opacity: 0.6 }}> (stack of {i.units.length})</span>}</td>
                    <td>
                      <select style={{ ...inp, maxWidth: 150 }} value={i.type} title="Change this if Auvik got the type wrong" onChange={(e) => setType(i.key, e.target.value)}>
                        {(TYPES.includes(i.type) ? TYPES : [i.type, ...TYPES]).map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td><td>{i.dev.model}</td>
                    <td style={{ opacity: i.generic ? 0.6 : 1 }}>{["rack", "off"].includes(i.mode) ? (i.desktop && i.mount === "kit" ? i.kitName : i.tplName) : ""}</td>
                    <td>
                      {i.mode === "vm" && (
                        <select style={{ ...inp, maxWidth: 170 }} value={i.host ?? ""} onChange={(e) => setHost(i.key, e.target.value)}>
                          <option value="">No host</option>
                          {hosts.map((h) => <option key={h.key} value={h.key}>{h.dev.name}</option>)}
                        </select>
                      )}
                      {i.kind === "ipmi" && ["rack", "off"].includes(i.mode) && (
                        <select style={{ ...inp, maxWidth: 190 }} value={i.host ?? "new"} title="The server this controller belongs to. Its port shows on the back of that server." onChange={(e) => setHost(i.key, e.target.value)}>
                          {oobmHosts.length > 0 && <optgroup label="Servers in this export">{oobmHosts.map((h) => <option key={h.key} value={h.key}>{h.dev.name}</option>)}</optgroup>}
                          {docHosts.length > 0 && <optgroup label="Servers already in the rack">{docHosts.map((s) => <option key={s.id} value={`doc:${s.id}`}>{s.name}</option>)}</optgroup>}
                          <option value="new">New server</option>
                          <option value="off">Off-rack (no host)</option>
                        </select>
                      )}
                      {i.desktop && ["rack", "off"].includes(i.mode) && (
                        <select style={inp} value={i.mount} onChange={(e) => setMount(i.key, e.target.value as Mount)}>
                          <option value="kit">Mount kit (front ports)</option>
                          <option value="shelf">Shelf</option>
                        </select>
                      )}
                    </td>
                    <td>{i.dev.ips[0]}</td><td><StatusChip s={i.dev.status} /></td>
                    <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={i.connectedTo}>{i.connectedTo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 10, textAlign: "right" }}>
            <button style={btn} onClick={onClose}>Cancel</button>
            <button style={{ ...btn, marginRight: 0, opacity: guOk ? 1 : 0.5 }} disabled={!guOk} onClick={doImport}>{diff ? `Apply ${tickedCount} change${tickedCount === 1 ? "" : "s"}` : "Import"}</button>
          </div>
        </>}
        {showUnplaced && plan && <UnplacedDialog items={plan.unplaced} onClose={() => setShowUnplaced(false)} />}
      </div>
    </div>
  );
}
