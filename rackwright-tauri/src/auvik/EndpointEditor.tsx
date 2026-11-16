// Editable member list for the selected "Endpoints on ..." or "Virtual machines" device.
import { useEffect, useRef, useState } from "react";
import type { Device, Doc } from "../types";
import { EpField, Endpoint, addMember, freePorts, groupSwitch, isGroup, isVmBox, memberPort, moveMember, removeMember, setMember } from "../endpointEdit";
import { isDown } from "./Panels";

type Edit = (fn: (d: Doc) => string | void, key?: string) => boolean;
const inp = { background: "#14161a", color: "#e6e8eb", border: "1px solid #3a3d42", borderRadius: 4, padding: "2px 4px", width: "100%", boxSizing: "border-box", fontSize: 11 } as const;
const btn = { background: "#2a2d33", color: "#e6e8eb", border: "1px solid #3a3d42", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontSize: 11 } as const;
const KINDS: [string, string][] = [["pc", "PC"], ["phone", "Phone"], ["iot", "IoT"], ["printer", "Printer"], ["vm", "VM"], ["other", "Other"]];

function Lbl({ t, locked, children }: { t: string; locked?: boolean; children: React.ReactNode }) {
  return <label style={{ display: "block", marginBottom: 3 }}><span style={{ opacity: 0.65 }}>{t}{locked ? " \u{1F512}" : ""}</span>{children}</label>;
}

/** Port choice: a select of the free ports of a switch. */
export function PortSelect({ doc, sw, value, onChange }: { doc: Doc; sw: Device | null; value: number | null; onChange: (id: number | null) => void }) {
  const free = freePorts(doc, sw);
  return (
    <select style={inp} value={value ?? ""} disabled={!sw} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}>
      <option value="">{sw ? "(no cable)" : "(no switch yet)"}</option>
      {free.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.type})</option>)}
    </select>
  );
}

function Member({ dev, doc, i, e, edit, others }: { dev: Device; doc: Doc; i: number; e: Endpoint; edit: Edit; others: Device[] }) {
  const vm = isVmBox(dev), lk = (k: string) => !!e.locked?.includes(k);
  const set = (k: EpField, v: string) => edit((d) => setMember(d, dev.id, i, { [k]: v }), `ep${dev.id}:${i}${k}`);
  const [to, setTo] = useState<number | "">("");
  const [toPort, setToPort] = useState<number | null>(null);
  const target = to === "" ? null : doc.devices.find((d) => d.id === to) ?? null;
  const tsw = target && isGroup(target) ? groupSwitch(doc, target) : null;
  const text = (k: EpField, t: string) => <Lbl t={t} locked={lk(k)}><input style={inp} value={(e as any)[k] ?? ""} onChange={(ev) => set(k, ev.target.value)} /></Lbl>;
  return (
    <div style={{ padding: "4px 2px 6px 8px", borderLeft: "2px solid #3a3d42", marginBottom: 4 }}>
      {text("name", "Name")}
      <Lbl t="Kind" locked={lk("kind")}>
        <select style={inp} value={e.kind ?? "other"} onChange={(ev) => set("kind", ev.target.value)}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </Lbl>
      {text("type", "Type")}{text("model", "Model")}{text("ip", "IP")}{text("mac", "MAC")}
      {!vm && text("port", "Switch port")}
      <div style={{ opacity: 0.7, margin: "2px 0" }}>{e.manual ? "Added by hand. " : ""}{e.status && <span style={{ color: isDown(e.status) ? "#ff7b72" : undefined }}>Status {e.status}</span>}</div>
      {others.length > 0 && (
        <div style={{ margin: "4px 0" }}>
          <Lbl t="Move to">
            <select style={inp} value={to} onChange={(ev) => { setTo(ev.target.value === "" ? "" : Number(ev.target.value)); setToPort(null); }}>
              <option value="">(choose)</option>
              {others.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Lbl>
          {target && !vm && <Lbl t="Switch port"><PortSelect doc={doc} sw={tsw} value={toPort} onChange={setToPort} /></Lbl>}
          {target && <button style={btn} onClick={() => edit((d) => { if (!moveMember(d, dev.id, i, target.id, toPort)) return "!Could not move it"; return `Moved ${e.name} to ${target.name}`; })}>Move</button>}
        </div>
      )}
      <button style={{ ...btn, color: "#f85149" }} onClick={() => { if (confirm(vm ? `Remove ${e.name}?` : `Remove ${e.name}, its port and its cable?`)) edit((d) => { removeMember(d, dev.id, i); return `Removed ${e.name}`; }); }}>Remove</button>
    </div>
  );
}

export function EndpointTable({ dev, doc, edit, focusIdx }: { dev: Device; doc: Doc; edit: Edit; focusIdx?: number | null }) {
  const vm = isVmBox(dev), rows = dev.endpoints ?? [];
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState(false);
  const [nm, setNm] = useState(""), [port, setPort] = useState<number | null>(null);
  const fRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusIdx == null) return;
    setOpen((s) => new Set(s).add(focusIdx));
    setTimeout(() => fRef.current?.scrollIntoView({ block: "nearest" }), 30);
  }, [focusIdx, dev.id]);
  useEffect(() => { setOpen(new Set()); setAdding(false); }, [dev.id]);
  const sw = vm ? null : groupSwitch(doc, dev);
  const others = doc.devices.filter((d) => d.id !== dev.id && d.type === dev.type);
  const hosts = doc.devices.filter((d) => d.type === "Server" || d.id === dev.vm_host);
  const toggle = (i: number) => setOpen((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const startAdd = () => { setAdding(true); setNm(""); setPort(freePorts(doc, sw)[0]?.id ?? null); };
  return (
    <div style={{ margin: "8px 0", fontSize: 11 }}>
      <b style={{ fontSize: 12 }}>{vm ? "Virtual machines" : "Endpoints"} ({rows.length})</b>
      {vm && (
        <label style={{ display: "block", margin: "4px 0" }}><span style={{ opacity: 0.65 }}>Host</span>
          <select style={inp} value={dev.vm_host ?? ""} onChange={(ev) => edit((d) => { const x = d.devices.find((y) => y.id === dev.id)!; if (ev.target.value === "") delete x.vm_host; else x.vm_host = Number(ev.target.value); })}>
            <option value="">(none)</option>
            {hosts.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </label>
      )}
      {!vm && <div style={{ opacity: 0.7, margin: "2px 0" }}>{sw ? `On ${sw.name}.` : "Not cabled to a switch yet."}</div>}
      <div style={{ maxHeight: 360, overflow: "auto", marginTop: 3 }}>
        {rows.map((e, i) => (
          <div key={i} ref={i === focusIdx ? fRef : undefined} style={{ background: i === focusIdx ? "#2a3a52" : undefined }}>
            <div onClick={() => toggle(i)} style={{ cursor: "pointer", padding: "1px 3px", borderTop: "1px solid #2c2f35", overflowWrap: "anywhere" }}>
              {open.has(i) ? "▾" : "▸"} {e.name} <span style={{ opacity: 0.6 }}>{e.ip}{!vm && memberPort(dev, i)?.label ? ` (${memberPort(dev, i)!.label.replace(/^.*Ethernet/i, "")})` : ""}</span>
            </div>
            {open.has(i) && <Member dev={dev} doc={doc} i={i} e={e} edit={edit} others={others} />}
          </div>
        ))}
      </div>
      {adding ? (
        <div style={{ borderTop: "1px solid #2c2f35", paddingTop: 4, marginTop: 4 }}>
          <Lbl t="Name"><input style={inp} value={nm} autoFocus onChange={(ev) => setNm(ev.target.value)} /></Lbl>
          {!vm && <Lbl t="Switch port"><PortSelect doc={doc} sw={sw} value={port} onChange={setPort} /></Lbl>}
          <button style={btn} onClick={() => { if (edit((d) => { addMember(d, dev.id, { name: nm.trim() || undefined }, port); return "Endpoint added"; })) { setAdding(false); setOpen((s) => new Set(s).add(rows.length)); } }}>Add</button>{" "}
          <button style={btn} onClick={() => setAdding(false)}>Cancel</button>
        </div>
      ) : <button style={{ ...btn, marginTop: 4 }} onClick={startAdd}>{vm ? "Add VM" : "Add endpoint"}</button>}
    </div>
  );
}
