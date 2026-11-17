import { useState } from "react";
import type { ReactNode } from "react";
import { v } from "../theme";
import type { Device, Doc, Service } from "../types";
import { STATUSES, statusOf, specFieldsFor, setField, connectedTo, powerPath, copyAsText } from "../device/info";
import PortsEditor from "../PortsEditor";
import { EndpointTable } from "../auvik/Panels";
import { deviceAlerts, todayIso, type IpEntry } from "../attention/model";
import { devWatts, feedFor, fmtLoad, isPdu, isUnpowered, isUps, type PowerBudget } from "../power/model";

type Edit = (fn: (d: Doc) => string | void, key?: string) => boolean;
const TABS = ["overview", "specs", "ports", "services", "notes"] as const;
type Tab = (typeof TABS)[number];
const LOCKABLE = new Set(["name", "type", "model", "ip", "serial", "notes", "mac"]);

const btn = { background: v("control"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "4px 8px", cursor: "pointer", fontSize: 12 } as const;
const inp = { background: v("bg"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "4px 6px", boxSizing: "border-box" } as const;

function loadTab(): Tab {
  try { const t = localStorage.getItem("rw.devTab"); if (t && (TABS as readonly string[]).includes(t)) return t as Tab; } catch { /* ignore */ }
  return "overview";
}

export default function DevicePanel({ doc, dev, edit, epFocus, onSelect, onClose, onLocate, onDuplicate, onChangeModel, onDelete, onCopied, placement, lockIcon, devSet, budget, clashes }: {
  budget: PowerBudget; clashes: Map<string, IpEntry[]>;
  doc: Doc; dev: Device; edit: Edit; epFocus: number | null;
  onSelect: (id: number) => void; onClose: () => void; onLocate: () => void; onDuplicate: () => void;
  onChangeModel: () => void; onDelete: () => void; onCopied: (ok: boolean) => void;
  placement: ReactNode; lockIcon: (k: string) => ReactNode;
  devSet: (k: "name" | "type" | "ip" | "model" | "serial" | "notes" | "mac", value: string) => void;
}) {
  const [tab, setTabState] = useState<Tab>(loadTab);
  const setTab = (t: Tab) => { setTabState(t); try { localStorage.setItem("rw.devTab", t); } catch { /* ignore */ } };
  const rack = doc.racks.find((r) => r.id === dev.rack);
  const services = dev.services ?? [];
  const setSvc = (i: number, patch: Partial<Service>) => edit((d) => {
    const x = d.devices.find((y) => y.id === dev.id)!;
    const list = (x.services ??= []);
    list[i] = { ...list[i], ...patch };
  }, `svc${dev.id}-${i}`);
  const setDev = (key: keyof Device, value: string | number | undefined) =>
    edit((d) => { setField(d.devices.find((y) => y.id === dev.id)!, key, value); }, `df${dev.id}${String(key)}`);
  const copy = async () => {
    try { await navigator.clipboard.writeText(copyAsText(doc, dev.id)); onCopied(true); } catch { onCopied(false); }
  };
  const status = statusOf(dev);
  const label = { display: "block", fontSize: 11, color: v("text-dim") } as const;
  const sub = { fontSize: 11, color: v("text-dim"), textTransform: "uppercase", letterSpacing: 0.5, margin: "10px 0 4px" } as const;
  const conns = connectedTo(doc, dev.id), power = powerPath(doc, dev.id);
  const tabLabel: Record<Tab, string> = {
    overview: "Overview", specs: "Specs", ports: `Ports ${dev.ports.length}`, services: `Services ${services.length}`, notes: "Notes",
  };
  const alerts = deviceAlerts(doc, dev, todayIso(), clashes.get(`current:${dev.id}`) ?? []);
  const own = devWatts(dev), feed = isUps(dev) || isPdu(dev) ? feedFor(budget, dev.id) : undefined;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ background: v("accent-soft"), border: `1px solid ${v("accent-border")}`, borderRadius: 10, padding: "1px 8px", fontSize: 11 }}>{dev.type}</span>
        <select aria-label="Status" value={status} style={{ ...inp, borderRadius: 10, padding: "1px 6px", fontSize: 11 }}
          onChange={(e) => setDev("status", e.target.value === "active" ? undefined : e.target.value)}>
          {STATUSES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
        </select>
        <span style={{ flex: 1 }} />
        <button aria-label="Close" title="Close" style={{ ...btn, padding: "0 8px", fontSize: 16 }} onClick={onClose}>{"×"}</button>
      </div>
      <div>
        <div style={{ fontSize: 17, fontWeight: 600, overflowWrap: "anywhere" }}>{dev.name}</div>
        <div style={{ color: v("text-dim") }}>{[dev.model, rack?.name, rack ? `U${dev.u}` : "Off-rack"].filter(Boolean).join(" · ")}</div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        <button style={btn} disabled={dev.rack == null} title={dev.rack == null ? "This device is not in a rack" : "Show it in the rack"} onClick={onLocate}>Locate in rack</button>
        <button style={btn} onClick={onDuplicate}>Duplicate</button>
        <button style={btn} onClick={copy}>Copy as text</button>
        <button style={btn} onClick={onChangeModel}>Change model…</button>
        <button style={{ ...btn, color: v("danger") }} onClick={onDelete}>Delete</button>
      </div>
      <div role="tablist" style={{ display: "flex", borderBottom: `1px solid ${v("border-subtle")}` }}>
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            style={{ background: "none", border: "none", borderBottom: `2px solid ${tab === t ? v("accent") : "transparent"}`, color: tab === t ? v("text") : v("text-dim"),
              padding: "5px 7px", cursor: "pointer", fontSize: 12 }}>{tabLabel[t]}</button>
        ))}
      </div>
      {tab === "overview" && <div>
        {alerts.length > 0 && <div style={{ marginBottom: 4 }}>
          {alerts.map((a, i) => <div key={i} style={{ color: a.level === "critical" ? v("danger") : a.level === "warning" ? v("warn") : v("text-dim") }}>{a.msg}</div>)}
        </div>}
        <div style={sub}>Power</div>
        {!feed && <div>{own != null ? `${own.toLocaleString("en-US")} W` : isUnpowered(dev) ? "Power: none (no power inlet)" : <span style={{ opacity: 0.7 }}>Unknown {"—"} set Power (W) in Specs</span>}</div>}
        {feed && <div>Load: {fmtLoad(feed)}</div>}
        {feed && dev.specs?.runtime && <div>Runtime: {String(dev.specs.runtime)}</div>}
        <div style={sub}>Connected to</div>
        {conns.length ? <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {conns.map((c) => <button key={c.dev.id} style={{ ...btn, borderRadius: 10, padding: "1px 8px" }} onClick={() => onSelect(c.dev.id)}>{c.dev.name} {"×"}{c.links}</button>)}
        </div> : <div style={{ opacity: 0.6 }}>Nothing is cabled to this device yet.</div>}
        <div style={sub}>Power path</div>
        {power.length ? power.map((p, i) => (
          <div key={i}>{[p.port, ...p.chain.map((c) => `${c.dev} ${c.port}`)].join(" ← ")}{!p.chain.length && <span style={{ opacity: 0.6 }}> (not connected)</span>}</div>
        )) : <div style={{ opacity: 0.6 }}>No power inlets.</div>}
        <div style={sub}>Location</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{placement}</div>
      </div>}
      {tab === "specs" && <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={label}>Name{lockIcon("name")}<br /><input style={{ ...inp, width: "100%" }} value={dev.name} onChange={(e) => devSet("name", e.target.value)} /></label>
        <label style={label}>Type{lockIcon("type")}<br /><input style={{ ...inp, width: "100%" }} value={dev.type} onChange={(e) => devSet("type", e.target.value)} /></label>
        {specFieldsFor(dev).map((f) => {
          const raw = (dev as any)[f.key];
          const val = raw == null ? "" : String(raw);
          const key = String(f.key);
          const lockable = LOCKABLE.has(key);
          return (
            <label key={key} style={label}>{f.label}{lockable && lockIcon(key)}<br />
              <input style={{ ...inp, width: "100%" }} type={f.kind === "date" ? "date" : f.kind === "number" ? "number" : "text"} value={val}
                onChange={(e) => {
                  const t = e.target.value;
                  if (lockable) devSet(key as any, t);
                  else setDev(f.key, f.kind === "number" ? (t === "" ? undefined : Number(t)) : t);
                }} />
            </label>
          );
        })}
      </div>}
      {tab === "ports" && <div>
        <div style={{ opacity: 0.7, marginBottom: 6 }}>
          {dev.u_size}U, {dev.ports.length} ports ({dev.ports.filter((p) => doc.cables.some((c) => c.a === p.id || c.b === p.id)).length} cabled). Drag to move; click a port, then another, to cable.
        </div>
        <PortsEditor key={dev.id} dev={dev} doc={doc} edit={edit} />
        {(dev.type === "Endpoints" || dev.type === "Virtual machines") && <EndpointTable dev={dev} doc={doc} edit={edit} focusIdx={epFocus} />}
      </div>}
      {tab === "services" && <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {!services.length && <div style={{ opacity: 0.6 }}>No services yet. Add one to note what runs here.</div>}
        {services.map((s, i) => (
          <div key={i} style={{ border: `1px solid ${v("border-subtle")}`, borderRadius: 4, padding: 6, display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", gap: 4 }}>
              <input aria-label="Service name" placeholder="Name" style={{ ...inp, flex: 1, minWidth: 0 }} value={s.name} onChange={(e) => setSvc(i, { name: e.target.value })} />
              <input aria-label="Port" placeholder="Port" style={{ ...inp, width: 56 }} value={s.port} onChange={(e) => setSvc(i, { port: e.target.value })} />
              <button aria-label="Remove service" title="Remove service" style={{ ...btn, padding: "0 8px" }}
                onClick={() => edit((d) => { const x = d.devices.find((y) => y.id === dev.id)!; x.services!.splice(i, 1); if (!x.services!.length) delete x.services; })}>{"×"}</button>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <select aria-label="Protocol" style={inp} value={s.proto} onChange={(e) => setSvc(i, { proto: e.target.value })}>
                {["", "TCP", "UDP", "HTTP", "HTTPS", "SSH", "RDP"].map((p) => <option key={p} value={p}>{p || "Protocol"}</option>)}
              </select>
              <select aria-label="Service status" style={inp} value={s.status} onChange={(e) => setSvc(i, { status: e.target.value })}>
                {["", "Running", "Stopped", "Planned"].map((p) => <option key={p} value={p}>{p || "Status"}</option>)}
              </select>
              <input aria-label="Notes" placeholder="Notes" style={{ ...inp, flex: 1, minWidth: 0 }} value={s.notes} onChange={(e) => setSvc(i, { notes: e.target.value })} />
            </div>
          </div>
        ))}
        <div><button style={btn} onClick={() => edit((d) => { const x = d.devices.find((y) => y.id === dev.id)!; (x.services ??= []).push({ name: "", port: "", proto: "", status: "", notes: "" }); })}>Add service</button></div>
      </div>}
      {tab === "notes" && <label style={label}>Notes{lockIcon("notes")}<br />
        <textarea style={{ ...inp, width: "100%", height: 140 }} value={dev.notes ?? ""} onChange={(e) => devSet("notes", e.target.value)} /></label>}
    </div>
  );
}
