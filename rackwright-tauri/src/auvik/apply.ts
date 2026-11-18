// Apply an ImportPlan to a document (mutates the doc it is given; call it inside one edit() for a single undo step).
import { CATALOG, addRack, applySpec, checkPlace, clone, deleteDevice, findFree, fromTpl, isHeavy, newCable, nid, placeOnShelf } from "../edit";
import { Device, Doc, Rack, RW } from "../types";
import { RACK_MODELS, RackSpec, modelById, specOf } from "../racks";
import { ImportPlan, PlanGroup, PlanItem, PlanUnit, PortRef, groupTemplate, locatePort, summarize } from "./plan";
import type { AuvikDevice } from "./parse";
import { setSource } from "../source";
import { Ep, X, computeDiff, defaultSelection, deviceFields, findMissing, orderUnits } from "./diff";
export { findMissing };

export interface ApplyOptions {
  target: "new" | "current";
  spec?: RackSpec; rackU?: number;   // for "new": the rack model
  rackId?: number | null;            // for "current": preferred rack
}
export interface ApplyResult { managers: number; added: number; updated: number; groups: number; vmBoxes: number; cablesAdded: number; cablesSkipped: number; racksAdded: number; missing: string[]; message: string }

export const noteLine = (d: AuvikDevice) =>
  "Auvik: " + [d.type, `status ${d.status}`, d.software && `software ${d.software}`, d.firmware && `firmware ${d.firmware}`, d.macs[0] && `MAC ${d.macs[0]}`, d.description].filter(Boolean).join("; ");
const mergeNotes = (old: string | undefined, line: string) => {
  const keep = (old || "").split("\n").filter((l) => !l.startsWith("Auvik:"));
  return [line, ...keep].filter((l, i) => i === 0 || l.trim()).join("\n");
};

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

/** `sel` = ids of the changes to apply (see diff.ts). Without it, everything the review ticks by default is applied. */
export function applyInPlace(doc: Doc, plan: ImportPlan, opt: ApplyOptions, items: PlanItem[] = [], sel?: Set<string>): ApplyResult {
  const res: ApplyResult = { managers: 0, added: 0, updated: 0, groups: 0, vmBoxes: 0, cablesAdded: 0, cablesSkipped: 0, racksAdded: 0, missing: [], message: "" };
  const devOf = new Map<string, Device>();
  const diff = computeDiff(doc, plan, items);
  const ticked = sel ?? defaultSelection(diff);
  const on = (id: string) => ticked.has(id);
  res.missing = diff.changes.filter((c) => c.cat === "missingDev").map((c) => c.title);

  // ---- removals first: gone cables, cables that move, devices and members the user chose to remove
  const carry = new Map<string, any>();
  for (const [key, st] of diff.cable) {
    if (st.kind === "moved" && st.from && on(`mv:${key}`)) { carry.set(key, st.from); doc.cables = doc.cables.filter((c) => c.id !== st.from!.id); }
  }
  for (const c of diff.changes) {
    if (c.cat === "gone" && on(c.id)) { const id = parseInt(c.id.slice(5)); doc.cables = doc.cables.filter((k) => k.id !== id); }
    if (c.cat === "missingDev" && on(c.id)) deleteDevice(doc, parseInt(c.id.slice(6)));
  }
  const removedEp = new Set<Ep>();
  for (const m of diff.missingEp) if (on(m.id)) removedEp.add(m.ep);
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

  // --- off-rack items: added now, laid out at the end, in columns to the left of every rack (racks may still be created)
  const offs = doc.devices.filter((d) => d.rack == null);
  const pendingOff: Device[] = [];
  const putOff = (d: Device) => { d.rack = null; doc.devices.push(d); pendingOff.push(d); };
  const layoutOff = () => {
    if (!pendingOff.length) return;
    let colX = Math.min(...doc.racks.map((r) => r.x), ...offs.map((d) => d.fx), 0) - RW - 80;
    if (!doc.racks.length && !offs.length) colX = 0;
    let colY = 0;
    const colH = Math.max(1100, ...doc.racks.map((r) => r.u * 26 + 60));
    for (const d of pendingOff) {
      const hh = d.type === "Wireless" && d.plate ? 100 : Math.max(1, d.u_size) * 26 + 36;
      if (colY + hh > colH && colY > 0) { colX -= RW + 60; colY = 0; }
      d.fx = colX; d.fy = colY; colY += hh;
    }
  };
  const placeShelf = (d: Device): boolean => {
    for (const r of racks) if (placeOnShelf(doc, d, r)) { doc.devices.push(d); return true; }
    return false;
  };
  // Cable managers: the router wants one within 3U of every port whose cable runs sideways. Put a 1U manager
  // below each piece of network gear, and below every second other device, while the rack has U to spare
  // for the rest of the import. Off-rack and shelf gear is left alone.
  let restU = 0;                      // U still needed by rack devices not placed yet
  const sinceMgr = new Map<number, number>();
  const usedU = (r: Rack) => doc.devices.filter((x) => x.rack === r.id).reduce((n, x) => n + (x.half ? 0.5 : x.u_size), 0);
  const addMgr = (r: Rack, u: number) => {
    if (u < 1 || u > r.u || r.u - usedU(r) - 1 < restU) return false;
    const m = fromTpl(doc, CATALOG.find((c) => c.type === "Cable manager" && c.u_size === 1)!);
    m.name = "Cable manager"; m.face = "both";
    if (!checkPlace(doc, m, r, u, 0).ok) return false;
    m.rack = r.id; m.u = u; m.side = 0; doc.devices.push(m); res.managers++; sinceMgr.set(r.id, 0);
    return true;
  };
  const afterPlace = (d: Device, r: Rack, network: boolean, midStack: boolean) => {
    if (!d.ports.length || midStack) return;   // stack members stay together; the manager goes below the last one
    const n = (sinceMgr.get(r.id) ?? 0) + 1;
    sinceMgr.set(r.id, n);
    if (!network && n < 2 && !isHeavy(d)) return;
    // heavy gear fills from the bottom, so its manager goes above it; everything else fills from the top
    if (isHeavy(d)) addMgr(r, d.u + d.u_size); else addMgr(r, d.u - 1);
  };
  const placeRack = (d: Device, network = false, midStack = false) => {
    needRack();
    d.face = d.plate ? "both" : "front";
    restU = Math.max(0, restU - d.u_size);
    for (let tries = 0; tries < 2; tries++) {
      if (d.plate?.off) { if (placeShelf(d)) { const r = racks.find((x) => x.id === d.rack); if (r && network) addMgr(r, d.u - 1); return; } }
      else for (const r of racks) {
        const s = findFree(doc, r, d);
        if (s) { d.rack = r.id; d.u = s[0]; d.side = s[1]; doc.devices.push(d); afterPlace(d, r, network, midStack); return; }
      }
      if (d.u_size > rackU) break;
      mkRack();
    }
    putOff(d);
  };

  const unlock = (list: { locked?: string[] }, f: string) => { if (list.locked) { list.locked = list.locked.filter((x) => x !== f); if (!list.locked.length) delete list.locked; } };
  const fill = (d: X, u: PlanUnit, tplModel: string) => {
    const a = u.item.dev;
    for (const f of deviceFields(d, u)) {
      if (!on(`fld:${u.key}:${f.field}`)) continue;
      (d as any)[f.field] = f.to; unlock(d, f.field); setSource(d, f.field, "auvik");
    }
    if (!d.model) d.model = tplModel;
    const oldNotes = d.notes;
    d.notes = mergeNotes(d.notes, noteLine(a));
    if (d.notes !== oldNotes && d.source?.notes !== "manual") setSource(d, "notes", "auvik");
    d.auvik_id = u.key; d.auvik_name = u.name; d.auvik_macs = a.macs; d.auvik_model = a.model;
  };

  // --- devices
  const order = orderUnits(plan);
  restU = order.filter((u) => u.mode === "rack").reduce((n, u) => n + u.tpl.u_size, 0);
  for (const u of order) {
    const found = diff.matched.get(u.key) as X | undefined;
    if (found) {
      devOf.set(u.key, found);
      fill(found, u, u.tpl.model || "");
      res.updated++;
      continue;
    }
    if (!on(`new:${u.key}`)) continue;
    const d = fromTpl(doc, u.tpl) as X;
    if (u.placeholder) {
      d.name = u.name; d.notes = `Placeholder: created for ${u.item.dev.name}`;
    } else {
      const a = u.item.dev;
      fill(d, u, u.tpl.model || "");
      d.name = u.name; setSource(d, "name", "auvik"); d.ip = a.ips[0] || d.ip || ""; if (a.ips[0]) setSource(d, "ip", "auvik");
      if (a.serial) { d.serial = a.serial; setSource(d, "serial", "auvik"); }
      if (a.model) { d.model = a.model; setSource(d, "model", "auvik"); }
    }
    devOf.set(u.key, d);
    if (u.mode === "off") { d.face = d.plate ? "both" : "front"; putOff(d); }
    else {
      const next = order[order.indexOf(u) + 1];
      placeRack(d, ["switch", "firewall", "router"].includes(u.item.kind), u.unit != null && next?.itemKey === u.itemKey);
    }
    res.added++;
  }
  for (const o of plan.oobms) if (o.unit.existingId != null) { const d = diff.matched.get(o.unit.key); if (d) devOf.set(o.unit.key, d); }

  // --- endpoint groups and VM boxes: rebuilt, but members are matched by key so edits, manual members and cables survive
  type Pt = Device["ports"][number];
  const summaryOf = (eps: Ep[]) => summarize(eps.map((e) => e.kind ?? "other"));
  const memberPorts = new Map<string, (Pt | undefined)[]>();
  const groupDev = new Map<string, Device>();
  const dropFrom = (dev: Device, ep: Ep) => {
    const i = dev.endpoints!.indexOf(ep);
    if (i < 0) return;
    if (dev.ports.length === dev.endpoints!.length) dev.ports.splice(i, 1);
    dev.endpoints!.splice(i, 1);
  };
  /** Member list of one box: plan members first, then what the plan does not cover (manual, missing, moved-out and not ticked). */
  const rebuild = (boxKey: string, d: X | undefined, members: PlanGroup["members"], withPorts: boolean) => {
    const keepEps: Ep[] = d?.endpoints ?? [];
    const aligned = !!d && d.ports.length === keepEps.length;
    const portOfEp = new Map<Ep, Pt | undefined>(keepEps.map((e, i) => [e, aligned ? d!.ports[i] : undefined]));
    const slots: { ep: Ep; port?: Pt }[] = [];
    const mp: (Pt | undefined)[] = [];
    const taken = new Set<Ep>();
    members.forEach((m, i) => {
      const cid = `${boxKey}|${m.key}`;
      const loc = diff.members.get(cid)!;
      let ep: Ep | undefined, port: Pt | undefined;
      if (loc.kind === "same") { ep = loc.ep; port = loc.port; }
      else if (loc.kind === "moved") {
        if (on(`mv:${cid}`) || on(`mvm:${m.key}`)) { ep = loc.ep; port = loc.port; dropFrom(loc.dev!, ep!); }
      } else if (on(`newm:${cid}`)) {
        ep = { name: m.name, type: m.type, model: m.model, ip: m.ip, mac: m.mac, port: "", status: m.status, kind: m.kind, key: m.key };
        if (withPorts) port = { id: nid(doc), name: m.name.slice(0, 28), type: "RJ45", label: "" };
      }
      if (!ep) { mp[i] = undefined; return; }
      if (loc.kind !== "new") {
        ep.key = m.key; ep.status = m.status;
        for (const f of ["name", "ip", "mac", "kind", "model", "type"] as const) {
          const to = (m as any)[f] as string;
          if (to && to !== ((ep as any)[f] || "") && on(`fldm:${m.key}:${f}`)) { (ep as any)[f] = to; unlock(ep, f); if (f === "name" && port) port.name = to.slice(0, 28); }
        }
      }
      if (withPorts) {
        const st = diff.cable.get(cid);
        const ok = !st || st.kind === "existing" || (st.kind === "new" ? on(`cn:${cid}`) : on(`mv:${cid}`));
        if (m.port && ok) { ep.port = m.port; if (port) port.label = m.port; if (st?.kind === "moved") unlock(ep, "port"); }
        if (!port) port = { id: nid(doc), name: ep.name.slice(0, 28), type: "RJ45", label: ep.port };
      }
      taken.add(ep);
      slots.push({ ep, port }); mp[i] = port;
    });
    for (const e of keepEps) {
      if (taken.has(e)) continue;
      if (removedEp.has(e)) { const p = portOfEp.get(e); if (p) doc.cables = doc.cables.filter((c) => c.a !== p.id && c.b !== p.id); continue; }
      slots.push({ ep: e, port: withPorts ? portOfEp.get(e) ?? { id: nid(doc), name: e.name.slice(0, 28), type: "RJ45", label: e.port } : undefined });
    }
    return { slots, mp };
  };

  for (const g of plan.groups) {
    let d = existing.find((x) => x.auvik_id === g.key) as X | undefined;
    const { slots, mp } = rebuild(g.key, d, g.members, true);
    if (!d && !slots.length) continue;
    if (!d) {
      d = fromTpl(doc, { ...g.tpl, name: g.name }) as X;
      d.color = g.tpl.color; d.auvik_id = g.key; d.face = "front";
      putOff(d);
    }
    const tpl = groupTemplate(slots.length);
    d.name = g.name; d.model = summaryOf(slots.map((s) => s.ep)); d.u_size = tpl.u_size; d.rows = tpl.rows || 0; d.half = false; d.type = "Endpoints";
    d.notes = `Auvik endpoint group on ${g.unit.name}`;
    d.endpoints = slots.map((s) => s.ep);
    d.ports = slots.map((s) => s.port!);
    memberPorts.set(g.key, mp);
    groupDev.set(g.key, d);
    res.groups++;
  }

  const vmIds = new Set(plan.vmBoxes.map((b) => b.key));
  for (const b of plan.vmBoxes) {
    const host = b.hostUnit ? devOf.get(b.hostUnit.key) : undefined;
    let d = existing.find((x) => x.auvik_id === b.key) as X | undefined;
    const { slots } = rebuild(b.key, d, b.members, false);
    if (!d && !slots.length) continue;
    if (!d) {
      d = fromTpl(doc, { ...b.tpl, name: b.name }) as X;
      d.auvik_id = b.key; d.face = "front";
      putOff(d);
    }
    d.name = b.name; d.model = summaryOf(slots.map((s) => s.ep)); d.u_size = b.tpl.u_size; d.rows = 0; d.half = false; d.type = "Virtual machines"; d.color = b.tpl.color;
    d.notes = host ? `Auvik virtual machines on ${host.name}` : "Auvik virtual machines with no known host";
    d.endpoints = slots.map((s) => s.ep);
    if (host) d.vm_host = host.id; else delete d.vm_host;
    res.vmBoxes++;
  }
  // a box from an earlier import whose host changed is rebuilt under its new name; the old one goes once it is empty
  if (items.length) doc.devices = doc.devices.filter((x: X) => !(x.auvik_id?.startsWith("vm:") && !vmIds.has(x.auvik_id) && !x.endpoints?.length));
  doc.devices = doc.devices.filter((x: X) => !(x.auvik_id?.startsWith("g:") && x.endpoints && !x.endpoints.length));   // a group whose last member moved away

  // --- OOBM controllers: a port on the host's rear panel (the server's own iDRAC port, or a new one), kept on re-import
  const oobmPort = new Map<string, Pt>();
  const OOBM_RE = /idrac|ilo|bmc|oobm|ipmi/i;
  for (const o of plan.oobms) {
    const host = devOf.get(o.unit.key) as X | undefined;
    if (!host) continue;
    let port = host.oobm?.key === o.key ? host.ports.find((p) => p.id === host.oobm!.portId) : undefined;
    if (!port) {
      const claimed = new Set([...oobmPort.values()].map((p) => p.id));
      const free = (p: Pt) => !cabled(doc, p.id) && !claimed.has(p.id);
      port = host.ports.find((p) => free(p) && OOBM_RE.test(p.name)) ?? host.ports.find((p) => free(p) && p.type === "Mgmt");
      if (!port) {
        port = { id: nid(doc), name: o.port, type: "RJ45", label: "" };
        const at = host.ports.findIndex((p) => p.type === "Power");   // next to the NICs, before the power inlets
        host.ports.splice(at < 0 ? host.ports.length : at, 0, port);
      }
    }
    host.oobm = { name: o.name, ip: o.ip, mac: o.mac, key: o.key, portId: port.id };
    const line = `OOBM: ${o.port} ${o.name}` + [o.ip && `IP ${o.ip}`, o.mac && `MAC ${o.mac}`, o.serial && `serial ${o.serial}`].filter(Boolean).map((x) => "; " + x).join("");
    host.notes = [...(host.notes || "").split("\n").filter((l) => !l.startsWith("OOBM:")), line].filter((l, i) => l.trim() || i === 0).join("\n");
    if (host.rack != null && host.face === "front" && !host.plate) host.face = "both";   // so the rear view shows the port
    oobmPort.set(o.key, port);
  }

  layoutOff();

  // --- cables
  const dev = (t: PlanUnit | PlanGroup) => (t.isGroup ? groupDev.get(t.key)! : devOf.get(t.key)!);
  for (const c of plan.cables) {
    const st = diff.cable.get(c.key);
    if (st?.kind === "existing" || (st?.kind === "new" && !on(`cn:${c.key}`)) || (st?.kind === "moved" && !on(`mv:${c.key}`))) { res.cablesSkipped++; continue; }
    const da = dev(c.a.target), db = dev(c.b.target);
    if (!da || !db) continue;
    const get = (r: PortRef, dv: Device) => (r.target.isGroup ? memberPorts.get(r.target.key)?.[r.member!] : r.oobm ? oobmPort.get(r.oobm) : resolvePort(doc, dv, r, r.target as PlanUnit));
    // find the named end first: if that port is taken the cable exists already, and no spare port gets made for the other end
    const aFirst = !!c.a.iface || !c.b.iface;
    const p1 = aFirst ? get(c.a, da) : get(c.b, db);
    if (!p1 || cabled(doc, p1.id)) { res.cablesSkipped++; continue; }
    const p2 = aFirst ? get(c.b, db) : get(c.a, da);
    if (!p2 || cabled(doc, p2.id)) { res.cablesSkipped++; continue; }
    const pa = aFirst ? p1 : p2, pb = aFirst ? p2 : p1;
    const k = newCable(doc, pa.id, pb.id);
    if (typeof k === "string") { res.cablesSkipped++; continue; }
    const old = carry.get(c.key);
    if (old) for (const f of ["color", "style", "type", "length", "unit", "notes", "logical"]) if (old[f] !== undefined) (k as any)[f] = old[f];
    k.label = c.label; if (!old) k.type = "Cat6";
    res.cablesAdded++;
  }

  // --- document-level info
  (doc as any).auvik = { site: plan.site, imported: new Date().toISOString().slice(0, 10), unplaced: plan.unplaced, virtual: plan.virtual, source: "xlsx" };
  res.message = `Imported from Auvik: ${res.added} added, ${res.updated} updated, ${res.groups} endpoint group(s), ${res.vmBoxes} VM box(es), ${res.cablesAdded} cable(s)` +
    (res.managers ? `, ${res.managers} cable manager(s)` : "") +
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
