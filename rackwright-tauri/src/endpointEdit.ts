// Pure document operations for editing endpoint / VM members by hand. Each mutates the doc it is given;
// call them inside one edit() so each is one undo step.
import { RW, type Device, type Doc, type Port } from "./types";
import { fromTpl, nid, newCable, portOf } from "./edit";
import { groupTemplate } from "./auvik/plan";

export type Endpoint = NonNullable<Device["endpoints"]>[number];
export type EpField = "name" | "kind" | "type" | "model" | "ip" | "mac" | "port";
export const EP_FIELDS: EpField[] = ["name", "kind", "type", "model", "ip", "mac", "port"];
export const DEV_LOCKABLE = ["name", "type", "model", "ip", "serial", "notes", "mac"] as const;

export const portNameFor = (name: string) => name.slice(0, 28);
export const isGroup = (d: Device) => d.type === "Endpoints";
export const isVmBox = (d: Device) => d.type === "Virtual machines";
const cabled = (doc: Doc, pid: number) => doc.cables.some((c) => c.a === pid || c.b === pid);

/** The port that belongs to member i of a group: matched by name first, then by position. */
export function memberPort(d: Device, i: number): Port | undefined {
  const e = d.endpoints?.[i];
  if (!e) return undefined;
  const byName = d.ports.find((p) => p.name === portNameFor(e.name));
  return byName ?? d.ports[i];
}

/** The device on the other end of a group's cables (the switch it hangs off). */
export function groupSwitch(doc: Doc, g: Device): Device | null {
  for (const p of g.ports) {
    const c = doc.cables.find((x) => x.a === p.id || x.b === p.id);
    if (!c) continue;
    const far = portOf(doc, c.a === p.id ? c.b : c.a);
    if (far && far.d.id !== g.id) return far.d;
  }
  return null;
}

/** Ports of a device with no cable on them, copper first. */
export function freePorts(doc: Doc, dev: Device | null | undefined): Port[] {
  if (!dev) return [];
  const f = dev.ports.filter((p) => !cabled(doc, p.id) && p.type !== "Power" && p.type !== "Console");
  return [...f.filter((p) => p.type === "RJ45"), ...f.filter((p) => p.type !== "RJ45")];
}

/** Set fields on a member. Changed fields are added to its `locked` list so a later import leaves them alone. Keeps the port in step. */
export function setMember(doc: Doc, gid: number, i: number, patch: Partial<Record<EpField, string>>): void {
  const g = doc.devices.find((d) => d.id === gid), e = g?.endpoints?.[i];
  if (!g || !e) return;
  const port = isGroup(g) ? memberPort(g, i) : undefined;
  for (const k of Object.keys(patch) as EpField[]) {
    const v = patch[k] ?? "";
    if ((e as any)[k] === v) continue;
    (e as any)[k] = v;
    if (!e.locked) e.locked = [];
    if (!e.locked.includes(k)) e.locked.push(k);
    if (port && k === "name") port.name = portNameFor(v);
    if (port && k === "port") port.label = v;
  }
}

/** Add a member. For a group it also creates its port and, when swPort is given and free, a cable to it. */
export function addMember(doc: Doc, gid: number, init: Partial<Endpoint>, swPort?: number | null): Endpoint | null {
  const g = doc.devices.find((d) => d.id === gid);
  if (!g) return null;
  const vm = isVmBox(g);
  const e: Endpoint = {
    name: init.name || (vm ? "New VM" : "New endpoint"), type: init.type || "", model: init.model || "", ip: init.ip || "", mac: init.mac || "",
    port: vm ? "" : init.port || "", status: init.status || "", kind: init.kind ?? (vm ? "vm" : "other"), manual: true,
  };
  if (init.key) e.key = init.key;
  if (init.locked) e.locked = [...init.locked];
  if (!g.endpoints) g.endpoints = [];
  g.endpoints.push(e);
  if (!vm) {
    const p: Port = { id: nid(doc), name: portNameFor(e.name), type: "RJ45", label: e.port };
    g.ports.push(p);
    if (swPort != null && !cabled(doc, swPort) && portOf(doc, swPort)) {
      const k = newCable(doc, p.id, swPort);
      if (typeof k !== "string") k.type = "Cat6";
    }
  }
  return e;
}

/** Remove a member, its port and the cable on it. */
export function removeMember(doc: Doc, gid: number, i: number): void {
  const g = doc.devices.find((d) => d.id === gid);
  if (!g?.endpoints?.[i]) return;
  const port = isGroup(g) ? memberPort(g, i) : undefined;
  g.endpoints.splice(i, 1);
  if (port) {
    doc.cables = doc.cables.filter((c) => c.a !== port.id && c.b !== port.id);
    g.ports = g.ports.filter((p) => p.id !== port.id);
  }
}

/** Move a member to another group (or VM box), cabling it to swPort of the new group's switch. */
export function moveMember(doc: Doc, from: number, i: number, to: number, swPort?: number | null): boolean {
  const g = doc.devices.find((d) => d.id === from), t = doc.devices.find((d) => d.id === to);
  const e = g?.endpoints?.[i];
  if (!g || !t || !e || from === to || g.type !== t.type) return false;
  const copy: Endpoint = JSON.parse(JSON.stringify(e));
  removeMember(doc, from, i);
  const n = addMember(doc, to, copy, swPort);
  if (!n) return false;
  n.manual = copy.manual; if (!copy.manual) delete n.manual;
  if (swPort != null) { const sw = portOf(doc, swPort); if (sw) { n.port = n.port || sw.p.name; const p = t.ports[t.ports.length - 1]; if (p) p.label = n.port; } }
  return true;
}

/** Endpoints group of a switch (cabled to it), or null. */
export function groupOfSwitch(doc: Doc, swId: number): Device | null {
  return doc.devices.find((d) => isGroup(d) && groupSwitch(doc, d)?.id === swId) ?? null;
}

/** Turn an entry of doc.auvik.unplaced into a manual member of the switch's group (made if missing, off-rack). Returns the group id, or 0. */
export function placeUnplaced(doc: Doc, index: number, swId: number, swPort?: number | null): number {
  const u = doc.auvik?.unplaced?.[index], sw = doc.devices.find((d) => d.id === swId);
  if (!u || !sw) return 0;
  let g = groupOfSwitch(doc, swId);
  if (!g) {
    const tpl = groupTemplate(0);
    g = fromTpl(doc, { ...tpl, name: `Endpoints on ${sw.name}` });
    g.color = tpl.color; g.face = "front"; g.rack = null; g.model = ""; g.notes = `Endpoint group on ${sw.name}`;
    if (sw.auvik_id) g.auvik_id = `g:${sw.auvik_id}`;
    g.endpoints = [];
    const offs = doc.devices.filter((d) => d.rack == null);
    if (offs.length) { const last = offs[offs.length - 1]; g.fx = last.fx; g.fy = last.fy + last.u_size * 26 + 46; }
    else g.fx = Math.min(0, ...doc.racks.map((r) => r.x)) - RW - 80;
    doc.devices.push(g);
  }
  const kind = (u as any).kind ?? kindGuess(u);
  addMember(doc, g.id, { name: u.name, type: u.type, model: u.model, ip: u.ip, mac: u.mac, status: u.status, kind }, swPort);
  const sp = swPort != null ? portOf(doc, swPort) : null;
  if (sp) { const m = g.endpoints![g.endpoints!.length - 1]; m.port = sp.p.name; g.ports[g.ports.length - 1].label = sp.p.name; }
  doc.auvik!.unplaced.splice(index, 1);
  return g.id;
}

function kindGuess(u: { type?: string; model?: string }): Endpoint["kind"] {
  const t = `${u.type || ""} ${u.model || ""}`.toLowerCase();
  if (/phone|voip/.test(t)) return "phone";
  if (/printer|mfp/.test(t)) return "printer";
  if (/camera|iot|sensor/.test(t)) return "iot";
  if (/\bpc\b|computer|laptop|workstation|desktop/.test(t)) return "pc";
  return "other";
}

/** Ports: add, rename, retype, delete (with its cable). */
export function addPort(doc: Doc, did: number, type = "RJ45"): Port | null {
  const d = doc.devices.find((x) => x.id === did); if (!d) return null;
  const p: Port = { id: nid(doc), name: String(d.ports.length + 1), type, label: "" };
  d.ports.push(p); return p;
}
export function deletePort(doc: Doc, did: number, pid: number): void {
  const d = doc.devices.find((x) => x.id === did); if (!d) return;
  doc.cables = doc.cables.filter((c) => c.a !== pid && c.b !== pid);
  d.ports = d.ports.filter((p) => p.id !== pid);
}
