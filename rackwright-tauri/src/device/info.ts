import type { Device, DevStatus, Doc } from "../types";
import { portOf, isOutlet } from "../edit";
import { isPowerCable } from "../views/infra";

export const STATUSES: { v: DevStatus; label: string }[] = [
  { v: "active", label: "Active" }, { v: "spare", label: "Spare" }, { v: "offline", label: "Offline" }, { v: "planned", label: "Planned" },
];
export const statusOf = (d: Device): DevStatus => d.status ?? "active";

type SpecField = { key: keyof Device; label: string; kind: "text" | "date" | "number" };
export const SPEC_FIELDS: SpecField[] = [
  { key: "manufacturer", label: "Manufacturer", kind: "text" }, { key: "model", label: "Model", kind: "text" },
  { key: "serial", label: "Serial", kind: "text" }, { key: "asset_tag", label: "Asset tag", kind: "text" },
  { key: "hostname", label: "Hostname", kind: "text" }, { key: "ip", label: "IP", kind: "text" },
  { key: "mac", label: "MAC", kind: "text" }, { key: "os", label: "OS", kind: "text" },
  { key: "role", label: "Role", kind: "text" }, { key: "owner", label: "Owner", kind: "text" },
  { key: "purchase_date", label: "Purchase date", kind: "date" }, { key: "warranty_exp", label: "Warranty ends", kind: "date" },
  { key: "power_w", label: "Power (W)", kind: "number" },
];
export const UPS_FIELDS: SpecField[] = [
  { key: "battery_date", label: "Battery installed", kind: "date" }, { key: "rated_w", label: "Rated (W)", kind: "number" },
];
/** Fields to show for a device: UPS units also get battery date and rating. */
export const specFieldsFor = (d: Device): SpecField[] =>
  d.type === "UPS" ? [...SPEC_FIELDS, ...UPS_FIELDS] : d.type === "PDU" ? [...SPEC_FIELDS, UPS_FIELDS[1]] : SPEC_FIELDS;

export function setField(d: Device, key: keyof Device, value: string | number | undefined): void {
  const r = d as any;
  if (value === undefined || value === "" || (typeof value === "number" && Number.isNaN(value))) delete r[key];
  else r[key] = value;
}

export function connectedTo(doc: Doc, devId: number): { dev: Device; links: number }[] {
  const m = new Map<number, number>();
  for (const c of doc.cables) {
    if (isPowerCable(doc, c)) continue;
    const a = portOf(doc, c.a), b = portOf(doc, c.b);
    if (!a || !b) continue;
    const other = a.d.id === devId ? b.d : b.d.id === devId ? a.d : null;
    if (other && other.id !== devId) m.set(other.id, (m.get(other.id) || 0) + 1);
  }
  return [...m].map(([id, links]) => ({ dev: doc.devices.find((d) => d.id === id)!, links }))
    .sort((x, y) => x.dev.name.localeCompare(y.dev.name));
}

export function powerPath(doc: Doc, devId: number): { port: string; chain: { dev: string; port: string }[] }[] {
  const dev = doc.devices.find((d) => d.id === devId);
  if (!dev) return [];
  const peer = (portId: number): { d: Device; p: { name: string; type: string } } | null => {
    const c = doc.cables.find((x) => x.a === portId || x.b === portId);
    return c ? portOf(doc, c.a === portId ? c.b : c.a) as any : null;
  };
  const out: { port: string; chain: { dev: string; port: string }[] }[] = [];
  for (const inlet of dev.ports.filter((p) => p.type === "Power" && !isOutlet(p))) {
    const chain: { dev: string; port: string }[] = [];
    const seen = new Set<number>([dev.id]);
    let cur: Device | null = dev, portId = inlet.id;
    for (let hop = 0; hop < 6 && cur; hop++) {
      const far = peer(portId);
      if (!far || !isOutlet(far.p) || seen.has(far.d.id)) break;
      chain.push({ dev: far.d.name, port: far.p.name });
      seen.add(far.d.id);
      cur = far.d;
      const next = cur.ports.find((p) => p.type === "Power" && !isOutlet(p));
      if (!next) break;
      portId = next.id;
    }
    out.push({ port: inlet.name, chain });
  }
  return out;
}

export function copyAsText(doc: Doc, devId: number): string {
  const d = doc.devices.find((x) => x.id === devId);
  if (!d) return "";
  const rack = doc.racks.find((r) => r.id === d.rack);
  const lines = [`${d.name} — ${d.type}`];
  if (d.model) lines.push(`Model: ${d.model}`);
  if (rack) lines.push(`Rack: ${rack.name}, U${d.u}`);
  if (d.ip) lines.push(`IP: ${d.ip}`);
  if (d.serial) lines.push(`Serial: ${d.serial}`);
  for (const c of connectedTo(doc, devId)) lines.push(`Connected to: ${c.dev.name} (${c.links} ${c.links === 1 ? "cable" : "cables"})`);
  return lines.join("\n");
}
