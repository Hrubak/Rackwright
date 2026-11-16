// Port-by-port view of one switch: what is plugged into each port. Pure.
import type { Device, Doc, Port } from "../types";
import { portOf } from "../edit";
import { EpKind, kindOf } from "./kinds";

export type PortKind = EpKind | "infra" | "empty";
export interface PortInfo {
  port: Port; kind: PortKind; cableId: number | null;
  far: string;            // name of what is on the other end
  farPort: string;        // its port name
  farDevId: number | null;
  type: string; ip: string; mac: string; model: string; status: string;
}
export interface PortGroup { label: string; rows: PortInfo[][] }

/** Numbers inside a port name, so "1/1/10" sorts after "1/1/9". */
export const numKey = (s: string) => (s.match(/\d+/g) || []).map(Number);
export function cmpNames(a: string, b: string): number {
  const x = numKey(a), y = numKey(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length || a.localeCompare(b);
}
/** 0 = copper, 1 = fibre and uplink cages, 2 = management and console. Power ports are not shown. */
export function groupRank(t: string): number {
  if (t === "RJ45") return 0;
  if (/SFP|QSFP|Fiber|LC|SC/i.test(t)) return 1;
  return 2;
}

export function portInfo(doc: Doc, port: Port): PortInfo {
  const empty: PortInfo = { port, kind: "empty", cableId: null, far: "", farPort: "", farDevId: null, type: "", ip: "", mac: "", model: "", status: "" };
  const c = doc.cables.find((x) => x.a === port.id || x.b === port.id);
  if (!c) return empty;
  const f = portOf(doc, c.a === port.id ? c.b : c.a);
  if (!f) return { ...empty, cableId: c.id, far: "(unknown)" };
  const base = { ...empty, cableId: c.id, farDevId: f.d.id, farPort: f.p.name };
  if (f.d.type === "Endpoints") {
    // one port per member: the port name is the member name, the label is the switch interface
    const ep = f.d.endpoints?.find((e) => e.name === f.p.name);
    if (!ep) return { ...base, kind: "other", far: f.p.name, farPort: f.p.label, type: "Endpoint" };
    return { ...base, kind: kindOf(ep), far: ep.name, farPort: ep.port || f.p.label, type: ep.type, ip: ep.ip, mac: ep.mac, model: ep.model, status: ep.status };
  }
  return { ...base, kind: "infra", far: f.d.name, type: f.d.type, ip: f.d.ip || "", mac: f.d.auvik_macs?.[0] || "", model: f.d.model || "" };
}

export function switchPorts(doc: Doc, dev: Device): PortInfo[] {
  return dev.ports.filter((p) => p.type !== "Power").map((p) => portInfo(doc, p))
    .sort((a, b) => groupRank(a.port.type) - groupRank(b.port.type) || (a.port.type === b.port.type ? 0 : a.port.type.localeCompare(b.port.type)) || cmpNames(a.port.name, b.port.name));
}

/** Front-panel style rows: copper ports in two rows (odd on top) when there are many, fibre and management ports as one row each. */
export function portGroups(infos: PortInfo[]): PortGroup[] {
  const out: PortGroup[] = [];
  for (const [rank, label] of [[0, "Ports"], [1, "Uplinks"], [2, "Management"]] as [number, string][]) {
    const list = infos.filter((i) => groupRank(i.port.type) === rank);
    if (!list.length) continue;
    if (rank === 0 && list.length > 12) out.push({ label, rows: [list.filter((_, i) => i % 2 === 0), list.filter((_, i) => i % 2 === 1)] });
    else out.push({ label, rows: [list] });
  }
  return out;
}

export const switchesOf = (doc: Doc) => doc.devices.filter((d) => d.type === "Switch").sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
