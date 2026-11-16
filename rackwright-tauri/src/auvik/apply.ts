// Apply an ImportPlan to a document (mutates the doc it is given; call it inside one edit() for a single undo step).
import { CATALOG, addRack, applySpec, checkPlace, clone, findFree, fromTpl, newCable, nid, portOf } from "../edit";
import { Device, Doc, Rack, RW } from "../types";
import { RACK_MODELS, RackSpec, modelById, specOf } from "../racks";
import { ImportPlan, PlanGroup, PlanItem, PlanUnit, PortRef, identOf, locatePort, matchesDevice } from "./plan";
import type { AuvikDevice } from "./parse";

export interface ApplyOptions {
  target: "new" | "current";
  spec?: RackSpec; rackU?: number;   // for "new": the rack model
  rackId?: number | null;            // for "current": preferred rack
}
export interface ApplyResult { added: number; updated: number; groups: number; cablesAdded: number; cablesSkipped: number; racksAdded: number; missing: string[]; message: string }

type X = Device & { auvik_id?: string; auvik_name?: string; auvik_macs?: string[]; auvik_model?: string; endpoints?: unknown[] };

export const noteLine = (d: AuvikDevice) =>
  "Auvik: " + [d.type, `status ${d.status}`, d.software && `software ${d.software}`, d.firmware && `firmware ${d.firmware}`, d.macs[0] && `MAC ${d.macs[0]}`, d.description].filter(Boolean).join("; ");
const mergeNotes = (old: string | undefined, line: string) => {
  const keep = (old || "").split("\n").filter((l) => !l.startsWith("Auvik:"));
  return [line, ...keep].filter((l, i) => i === 0 || l.trim()).join("\n");
};

/** Devices in the document that came from Auvik but are not in `items` (matched by serial, MAC, name). */
export function findMissing(doc: Doc, items: PlanItem[]): Device[] {
  const ids = items.map((i) => identOf(i.dev, i.key));
  return doc.devices.filter((d: X) => {
    if (!d.auvik_id) return false;
    if (d.auvik_id.startsWith("g:")) { const base = d.auvik_id.slice(2).split("#")[0]; return !ids.some((i) => i.key === base); }
    return !ids.some((i) => matchesDevice(d, i) || d.auvik_id!.split("#")[0] === i.key);
  });
}

const cabled = (doc: Doc, pid: number) => doc.cables.some((c) => c.a === pid || c.b === pid);
const PREF = ["RJ45", "SFP+", "SFP", "QSFP", "Fiber LC", "Other", "Mgmt"], PREF_FAST = ["SFP+", "SFP", "QSFP", "Fiber LC", "RJ45", "Other", "Mgmt"];

function autoPort(doc: Doc, dev: Device, fast: boolean) {
  for (const t of fast ? PREF_FAST : PREF) {
    const p = dev.ports.find((x) => x.type === t && !cabled(doc, x.id));
    if (p) return p;
  }
  const p = { id: nid(doc), name: fast ? `SFP+${dev.ports.length + 1}` : `Eth${dev.ports.length + 1}`, type: fast ? "SFP+" : "RJ45", label: "" };
  dev.ports.push(p);
  return p;
}

function resolvePort(doc: Doc, dev: Device, ref: PortRef, unit: PlanUnit | null) {
  if (ref.iface) {
    const hit = locatePort(dev, ref.iface, unit);
    if (hit?.port) return hit.port;
    if (hit?.create) { const p = { id: nid(doc), name: hit.create.name, type: hit.create.type, label: "" }; dev.ports.push(p); return p; }
  }
  return autoPort(doc, dev, ref.fast);
}

function rackSpecOf(r: Rack): RackSpec | undefined {
  return r.kind && r.model ? { kind: r.kind as any, model: r.model, model_name: r.model_name || "", width_mm: r.width_mm, depth_mm: r.depth_mm } : undefined;
}

export function applyInPlace(doc: Doc, plan: ImportPlan, opt: ApplyOptions, items: PlanItem[] = []): ApplyResult {
  const res: ApplyResult = { added: 0, updated: 0, groups: 0, cablesAdded: 0, cablesSkipped: 0, racksAdded: 0, missing: [], message: "" };
  const devOf = new Map<string, Device>();
  const used = new Set<number>();
  const existing = doc.devices as X[];

  // --- racks to fill
  let racks: Rack[] = [];
  let spec: RackSpec | undefined, rackU = 42;
  const mkRack = () => {
    const n = doc.racks.length + 1;
    const r = addRack(doc, plan.site && opt.target === "new" ? `${plan.site} rack ${racks.length + 1}` : `Rack ${n}`, rackU, spec);
    racks.push(r); res.racksAdded++;
    return r;
  };
  if (opt.target === "current") {
    const r = doc.racks.find((x) => x.id === opt.rackId) ?? doc.racks[0];
    if (r) { racks = [r]; rackU = r.u; spec = rackSpecOf(r); }
  }
  if (opt.target === "new" || !racks.length) {
    const m = modelById("apc-ar3100") ?? RACK_MODELS[0];
    spec = opt.spec ?? specOf(m); rackU = opt.rackU ?? m.u;
  }
  const needRack = () => { if (!racks.length) mkRack(); };

  // --- off-rack layout cursor: columns to the left of everything
  const offs = doc.devices.filter((d) => d.rack == null);
  let colX = Math.min(...doc.racks.map((r) => r.x), ...offs.map((d) => d.fx), 0) - RW - 80;
  if (!doc.racks.length && !offs.length) colX = 0;
  let colY = 0;
  const colH = Math.max(1100, ...doc.racks.map((r) => r.u * 26 + 60));
  const putOff = (d: Device) => {
    const h = Math.max(1, d.u_size) * 26 + 36;
    const isBlob = d.type === "Wireless" && d.plate;
    const hh = isBlob ? 100 : h;
    if (colY + hh > colH && colY > 0) { colX -= RW + 60; colY = 0; }
    d.rack = null; d.fx = colX; d.fy = colY; colY += hh;
    doc.devices.push(d);
  };
  const placeShelf = (d: Device): boolean => {
    for (const r of racks) {
      for (const sh of doc.devices.filter((x) => x.rack === r.id && x.type === "Shelf")) {
        for (const side of d.half ? [0, 1] : [0]) {
          const p = { ...d, rack: r.id, u: sh.u };
          if (checkPlace(doc, p, r, sh.u, side).ok) { d.rack = r.id; d.u = sh.u; d.side = side; doc.devices.push(d); return true; }
        }
      }
      const shelf = fromTpl(doc, CATALOG.find((c) => c.type === "Shelf")!);
      shelf.face = "front";
      const f = findFree(doc, r, shelf);
      if (f) {
        shelf.rack = r.id; shelf.u = f[0]; shelf.side = 0; shelf.name = "Shelf"; doc.devices.push(shelf);
        d.rack = r.id; d.u = f[0]; d.side = 0; doc.devices.push(d); return true;
      }
    }
    return false;
  };
  const placeRack = (d: Device) => {
    needRack();
    d.face = d.plate ? "both" : "front";
    for (let tries = 0; tries < 2; tries++) {
      if (d.plate?.off) { if (d.u_size === 1 && placeShelf(d)) return; }
      else for (const r of racks) {
        const s = findFree(doc, r, d);
        if (s) { d.rack = r.id; d.u = s[0]; d.side = s[1]; doc.devices.push(d); return; }
      }
      if (d.plate?.off && d.u_size !== 1) break;
      if (d.u_size > rackU) break;
      mkRack();
    }
    putOff(d);
  };

  const fill = (d: X, key: string, it: PlanItem, name: string, tplModel: string) => {
    const a = it.dev;
    d.name = name; d.ip = a.ips[0] || d.ip || ""; if (a.serial) d.serial = a.serial;
    d.notes = mergeNotes(d.notes, noteLine(a));
    if (a.model && (!d.model || d.model === d.auvik_model || !d.auvik_id)) d.model = a.model; else if (!d.model) d.model = tplModel;
    d.auvik_id = key; d.auvik_name = a.name; d.auvik_macs = a.macs; d.auvik_model = a.model;
  };

  // --- devices
  const kindsHeavyFirst = plan.units.filter((u) => u.item.kind === "ups" || u.item.kind === "storage");
  const order = [...kindsHeavyFirst, ...plan.units.filter((u) => !kindsHeavyFirst.includes(u))];
  for (const u of order) {
    const id = identOf(u.item.dev, u.item.key);
    const found = existing.find((d) => !used.has(d.id) && !d.auvik_id?.startsWith("g:") && (u.unit != null
      ? d.auvik_id === u.key || (d.auvik_name || "").toLowerCase() === u.name.toLowerCase()
      : matchesDevice(d, id)));
    if (found) {
      used.add(found.id); devOf.set(u.key, found);
      fill(found, u.key, u.item, found.name, u.tpl.model || "");
      res.updated++;
      continue;
    }
    const d = fromTpl(doc, u.tpl) as X;
    fill(d, u.key, u.item, u.name, u.tpl.model || "");
    d.auvik_name = u.name;
    devOf.set(u.key, d);
    if (u.mode === "off") { d.face = d.plate ? "both" : "front"; putOff(d); } else placeRack(d);
    res.added++;
  }

  // --- endpoint groups (rebuilt; position kept)
  const groupDev = new Map<string, Device>();
  for (const g of plan.groups) {
    const sw = devOf.get(g.unit.key)!;
    const gid = `g:${g.unit.key}`;
    let d = existing.find((x) => x.auvik_id === gid) as X | undefined;
    if (d) {
      const old = new Set(d.ports.map((p) => p.id));
      doc.cables = doc.cables.filter((c) => !old.has(c.a) && !old.has(c.b));
      d.ports = [];
    } else {
      d = fromTpl(doc, { ...g.tpl, name: g.name }) as X;
      d.color = g.tpl.color; d.auvik_id = gid; d.face = "front";
      putOff(d);
      void sw;
    }
    d.name = g.name; d.model = g.summary; d.u_size = g.tpl.u_size; d.rows = g.tpl.rows || 0; d.half = false; d.type = "Endpoints";
    d.notes = `Auvik endpoint group on ${g.unit.name}`;
    d.endpoints = g.members.map((m) => ({ name: m.name, type: m.type, model: m.model, ip: m.ip, mac: m.mac, port: m.port, status: m.status }));
    for (const m of g.members) d.ports.push({ id: nid(doc), name: m.name.slice(0, 28), type: "RJ45", label: m.port });
    groupDev.set(g.key, d);
    res.groups++;
  }

  // --- cables
  const dev = (t: PlanUnit | PlanGroup) => (t.isGroup ? groupDev.get(t.key)! : devOf.get(t.key)!);
  for (const c of plan.cables) {
    const da = dev(c.a.target), db = dev(c.b.target);
    if (!da || !db) continue;
    const pairCabled = (c.a.target.isGroup ? false : doc.cables.some((k) => {
      const pa = portOf(doc, k.a), pb = portOf(doc, k.b);
      return pa && pb && ((pa.d.id === da.id && pb.d.id === db.id) || (pa.d.id === db.id && pb.d.id === da.id));
    }));
    if (pairCabled) { res.cablesSkipped++; continue; }
    const pa = c.a.target.isGroup ? da.ports[c.a.member!] : resolvePort(doc, da, c.a, c.a.target);
    const pb = c.b.target.isGroup ? db.ports[c.b.member!] : resolvePort(doc, db, c.b, c.b.target as PlanUnit);
    if (!pa || !pb || cabled(doc, pa.id) || cabled(doc, pb.id)) { res.cablesSkipped++; continue; }
    const k = newCable(doc, pa.id, pb.id);
    if (typeof k === "string") { res.cablesSkipped++; continue; }
    k.label = c.label; k.type = "Cat6";
    res.cablesAdded++;
  }

  // --- document-level info
  (doc as any).auvik = { site: plan.site, imported: new Date().toISOString().slice(0, 10), unplaced: plan.unplaced, virtual: plan.virtual };
  res.missing = items.length ? findMissing(doc, items).map((d) => d.name) : [];
  res.message = `Imported from Auvik: ${res.added} added, ${res.updated} updated, ${res.groups} endpoint group(s), ${res.cablesAdded} cable(s)` +
    (res.missing.length ? `, ${res.missing.length} missing from this export` : "");
  return res;
}

/** Pure version: returns a new document. */
export function applyPlan(doc: Doc, plan: ImportPlan, opt: ApplyOptions, items: PlanItem[] = []): { doc: Doc; result: ApplyResult } {
  const d = clone(doc);
  const result = applyInPlace(d, plan, opt, items);
  return { doc: d, result };
}
export { applySpec };
