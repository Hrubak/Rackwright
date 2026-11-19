// What a new Auvik export would change in a document that already holds an Auvik import. Pure; nothing is modified.
//
// Every change has a stable id. The review dialog ticks ids; applyInPlace does exactly the ticked ones.
//   new:<unit>              add a device               newm:<box>|<member>   add an endpoint / VM to a box
//   fld:<unit>:<field>      change a device field      fldm:<member>:<field> change a member field
//   cn:<cable>              add a cable                mv:<cable>            move a cable (member: also move it to the new box)
//   mvm:<member>            move a member to another box (no cable involved)
//   gone:<cable id>         remove a cable             rmdev:<device id>     remove a device    rmm:<box id>:<member>  remove a member
// <cable> is the plan cable key, <unit> the plan unit key, <box> the plan group / VM box key.
import { Cable, Device, Doc } from "../types";
import { isManual } from "../source";
import { ImportPlan, PlanCable, PlanItem, PlanUnit, PortRef, identOf, locatePort, matchesDevice } from "./plan";
import { normMac } from "./parse";

export type X = Device & { auvik_id?: string; auvik_name?: string; auvik_macs?: string[]; auvik_model?: string };
export type Ep = NonNullable<Device["endpoints"]>[number];
type Port = Device["ports"][number];

export type Cat = "new" | "field" | "newCable" | "moved" | "gone" | "missingDev" | "missingMember";
export interface Change {
  id: string; cat: Cat; title: string; detail?: string;
  from?: string; to?: string;
  locked?: boolean;     // you edited this by hand: Auvik's value is kept unless ticked
  defaultOn: boolean;
}
export interface MemberLoc { kind: "same" | "moved" | "new"; dev?: Device; ep?: Ep; port?: Port }
export interface CableStatus { kind: "existing" | "new" | "moved"; from?: Cable }
export interface Diff {
  changes: Change[];
  matched: Map<string, Device>;        // plan unit key -> device already in the document
  cable: Map<string, CableStatus>;     // plan cable key -> what to do about it
  members: Map<string, MemberLoc>;     // `${box key}|${member key}` -> where that member is in the document now
  missingEp: { id: string; dev: Device; ep: Ep }[];   // members in a rebuilt box that the export no longer lists
}

const has = (a: string[] | undefined, f: string) => !!a?.includes(f);
export const epId = (e: Ep) => e.key || e.mac || e.name;

/** Devices in the document that came from Auvik but are not in `items` (matched by serial, MAC, name). */
export function findMissing(doc: Doc, items: PlanItem[]): Device[] {
  const ids = items.map((i) => identOf(i.dev, i.key));
  return doc.devices.filter((d: X) => {
    if (!d.auvik_id) return false;
    if (d.auvik_id.startsWith("vm:")) return false;   // VM boxes are rebuilt from the export, never "missing"
    if (d.auvik_id.startsWith("g:")) {
      const base = d.auvik_id.slice(2).split("#")[0];
      if (ids.some((i) => i.key === base)) return false;
      // An API import keys devices by Auvik id. An endpoint group from an older .xlsx import is still there when its
      // switch has that old key (serial, MAC, name), or when one of its members is still in Auvik.
      return !items.some((i) => {
        if (!i.dev.apiId) return false;
        const old = { key: i.dev.serial || i.dev.macs[0] || i.dev.name, mac: i.dev.macs[0] || "", name: i.dev.name };
        return old.key === base || (d.endpoints ?? []).some((e) => e.key === "api:" + i.dev.apiId || findEp([e], old) === 0);
      });
    }
    return !ids.some((i) => matchesDevice(d, i) || d.auvik_id!.split("#")[0] === i.key);
  });
}

/** Units in the order they are placed and matched: heavy gear first. */
export function orderUnits(plan: ImportPlan): PlanUnit[] {
  const heavy = plan.units.filter((u) => u.item.kind === "ups" || u.item.kind === "storage");
  return [...heavy, ...plan.units.filter((u) => !heavy.includes(u))];
}

/** Which device in the document is each plan unit? Placeholders are always new; an OOBM host chosen from the document is that device. */
export function matchUnits(doc: Doc, plan: ImportPlan): Map<string, Device> {
  const out = new Map<string, Device>(), used = new Set<number>();
  for (const o of plan.oobms) if (o.unit.existingId != null) { const d = doc.devices.find((x) => x.id === o.unit.existingId); if (d) { out.set(o.unit.key, d); used.add(d.id); } }
  // first pass: exact Auvik id, so a fallback never takes a device that belongs to another unit
  for (const u of orderUnits(plan)) {
    if (u.placeholder || out.has(u.key) || u.unit != null || !u.key.startsWith("api:")) continue;
    const e = (doc.devices as X[]).find((d) => !used.has(d.id) && d.auvik_id === u.key);
    if (e) { used.add(e.id); out.set(u.key, e); }
  }
  for (const u of orderUnits(plan)) {
    if (u.placeholder || out.has(u.key)) continue;
    const id = identOf(u.item.dev, u.item.key);
    const found = (doc.devices as X[]).find((d) => !used.has(d.id) && !d.auvik_id?.startsWith("g:") && !d.auvik_id?.startsWith("vm:") && (u.unit != null
      ? d.auvik_id === u.key || (d.auvik_name || "").toLowerCase() === u.name.toLowerCase()
      : matchesDevice(d, id)));
    if (found) { used.add(found.id); out.set(u.key, found); }
  }
  return out;
}

/** Index of the endpoint in `list` that is this member: stable key, then MAC, then name. Manual members never match. */
export function findEp(list: Ep[], m: { key: string; mac: string; name: string }, skip?: Set<Ep>): number {
  const ok = (e: Ep) => !e.manual && !skip?.has(e);
  let i = list.findIndex((e) => ok(e) && !!e.key && e.key === m.key);
  if (i >= 0) return i;
  const mac = normMac(m.mac || "");
  if (mac) { i = list.findIndex((e) => ok(e) && !!e.mac && normMac(e.mac) === mac); if (i >= 0) return i; }
  const nm = (m.name || "").toLowerCase();
  return nm ? list.findIndex((e) => ok(e) && e.name.toLowerCase() === nm) : -1;
}

export interface FieldChange { field: string; from: string; to: string; kept: boolean }
export interface DiffOpts { fill?: "empty" | "overwrite" }
/** Field differences between a document device and what Auvik says now. */
export function deviceFields(d: X, u: PlanUnit): FieldChange[] {
  if (u.placeholder) return [];
  const a = u.item.dev, out: FieldChange[] = [];
  const add = (field: string, from: string, to: string, kept = false) => out.push({ field, from, to, kept: kept || has(d.locked, field) || d.source?.[field] === "manual" });
  const ip = a.ips[0] || "";
  if (ip && ip !== (d.ip || "")) add("ip", d.ip || "", ip);
  if (a.serial && a.serial !== (d.serial || "")) add("serial", d.serial || "", a.serial);
  const model = u.item.modelOver || a.model;   // API import: a picked catalog model or a Virtual Machine model
  if (model && model !== (d.model || "")) add("model", d.model || "", model, !!d.model && d.model !== d.auvik_model);
  if (u.name !== d.name && d.auvik_name && u.name.toLowerCase() !== d.auvik_name.toLowerCase()) add("name", d.name, u.name);   // only when Auvik renamed it
  const typeOver = u.item.typeOver ?? (u.item.kindOver ? u.tpl.type : undefined);   // API import: the person's Type, or the type of the Kind they picked
  if (typeOver) { if (typeOver !== (d.type || "")) add("type", d.type || "", typeOver); }
  else if (u.tpl.type && d.type && u.tpl.type !== d.type && d.auvik_model !== undefined && a.model !== d.auvik_model) add("type", d.type, u.tpl.type);
  return out;
}
const MEMBER_FIELDS = ["name", "ip", "mac", "kind", "model", "type"] as const;

// ---------------------------------------------------------------- cables
interface End { id: string; port: string; kind: string; name: string; managed: boolean }
interface Conn { a: End; b: End; cable?: Cable; plan?: PlanCable; exists?: boolean }
const NONE: End = { id: "", port: "", kind: "", name: "", managed: false };
const isLeafKind = (k: string) => k === "member" || k === "ipmi";

function leafOf(c: Conn): string | null {
  if (isLeafKind(c.a.kind)) return c.a.id;
  if (isLeafKind(c.b.kind)) return c.b.id;
  if (c.a.kind !== "switch" && c.b.kind === "switch") return c.a.id;
  if (c.b.kind !== "switch" && c.a.kind === "switch") return c.b.id;
  return null;
}
function compat(p: Conn, d: Conn, strict: boolean): boolean {
  if (!((p.a.id === d.a.id && p.b.id === d.b.id) || (p.a.id === d.b.id && p.b.id === d.a.id))) return false;
  const [da, db] = p.a.id === d.a.id ? [d.a, d.b] : [d.b, d.a];
  const same = (x: string, y: string) => (strict ? x === y : !x || !y || x === y);
  return same(p.a.port, da.port) && same(p.b.port, db.port);
}
const describe = (c: Conn) => {
  const side = (e: End) => (e.port ? `${e.name} ${e.port}` : e.name);
  return `${side(c.a)} to ${side(c.b)}`;
};

export function computeDiff(doc: Doc, plan: ImportPlan, items: PlanItem[] = [], opts?: DiffOpts): Diff {
  const changes: Change[] = [];
  const matched = matchUnits(doc, plan);
  const members = new Map<string, MemberLoc>();
  const cableStatus = new Map<string, CableStatus>();
  const missingEp: Diff["missingEp"] = [];
  const out: Diff = { changes, matched, cable: cableStatus, members, missingEp };
  const all = doc.devices as X[];

  // ---- devices
  for (const u of plan.units) {
    const d = matched.get(u.key) as X | undefined;
    if (!d) {
      changes.push({ id: `new:${u.key}`, cat: "new", title: u.placeholder ? `${u.name} (placeholder server)` : u.name, detail: u.placeholder ? `for ${u.item.dev.name}` : u.tpl.name, defaultOn: true });
      continue;
    }
    for (const f of deviceFields(d, u)) {
      if (opts?.fill) {
        const manual = isManual(d, f.field);
        const on = opts.fill === "overwrite" ? !manual : (f.from === "" && !manual);
        const src = d.source?.[f.field] ?? "manual";
        changes.push({ id: `fld:${u.key}:${f.field}`, cat: "field", title: d.name, detail: on ? f.field : `${f.field} - kept (${d.source?.[f.field] ? "from " + src : "existing value"})`, from: f.from, to: f.to, locked: manual, defaultOn: on });
        continue;
      }
      changes.push({ id: `fld:${u.key}:${f.field}`, cat: "field", title: d.name, detail: f.field, from: f.from, to: f.to, locked: f.kept, defaultOn: !f.kept });
    }
  }

  // ---- members of endpoint groups and VM boxes
  const boxes: { key: string; name: string; members: ImportPlan["groups"][number]["members"]; family: "g:" | "vm:" }[] = [
    ...plan.groups.map((g) => ({ key: g.key, name: g.name, members: g.members, family: "g:" as const })),
    ...plan.vmBoxes.map((b) => ({ key: b.key, name: b.name, members: b.members, family: "vm:" as const })),
  ];
  const planMemberKeys = new Set(boxes.flatMap((b) => b.members.map((m) => m.key)));
  const allMembers = boxes.flatMap((b) => b.members);
  for (const b of boxes) {
    const dev = all.find((x) => x.auvik_id === b.key);
    const peers = all.filter((x) => x.auvik_id?.startsWith(b.family) && x.endpoints);
    for (const m of b.members) {
      let loc: MemberLoc = { kind: "new" };
      const here = dev?.endpoints ? findEp(dev.endpoints, m) : -1;
      const at = (dv: Device, i: number, kind: "same" | "moved"): MemberLoc => ({ kind, dev: dv, ep: dv.endpoints![i], port: b.family === "g:" && dv.ports.length === dv.endpoints!.length ? dv.ports[i] : undefined });
      if (dev && here >= 0) loc = at(dev, here, "same");
      else for (const o of peers) { if (o === dev) continue; const i = findEp(o.endpoints!, m); if (i >= 0) { loc = at(o, i, "moved"); break; } }
      members.set(`${b.key}|${m.key}`, loc);
      if (loc.kind === "new") {
        changes.push({ id: `newm:${b.key}|${m.key}`, cat: "new", title: m.name, detail: `in ${b.name}`, defaultOn: true });
        continue;
      }
      const ep = loc.ep!;
      for (const f of MEMBER_FIELDS) {
        const to = (m as any)[f] as string, from = ((ep as any)[f] as string) || "";
        if (to && to !== from) changes.push({ id: `fldm:${m.key}:${f}`, cat: "field", title: ep.name, detail: f, from, to, locked: has(ep.locked, f), defaultOn: !has(ep.locked, f) });
      }
    }
  }

  // ---- cables
  const kinds = new Map<string, string>(), names = new Map<string, string>();
  for (const u of plan.units) { kinds.set(u.key, u.item.kind); names.set(u.key, u.name); }
  for (const m of allMembers) { kinds.set(m.key, "member"); names.set(m.key, m.name); }
  for (const o of plan.oobms) { kinds.set(o.key, "ipmi"); names.set(o.key, o.name); }
  const oobmBy = new Map(plan.oobms.map((o) => [o.key, o]));

  const planEnd = (r: PortRef): End => {
    if (r.target.isGroup) { const m = r.target.members[r.member!]; return { id: m.key, port: "", kind: "member", name: m.name, managed: true }; }
    if (r.oobm) { const o = oobmBy.get(r.oobm)!; return { id: o.key, port: "", kind: "ipmi", name: o.name, managed: true }; }
    const u = r.target as PlanUnit, dev = matched.get(u.key);
    let port = r.iface;
    if (port && dev) { const hit = locatePort(dev, r.iface, u); port = hit?.port?.name ?? hit?.create?.name ?? r.iface; }
    return { id: u.key, port, kind: u.item.kind, name: u.name, managed: true };
  };
  const planExists = (r: PortRef) => {
    if (r.target.isGroup) { const m = r.target.members[r.member!]; return members.get(`${r.target.key}|${m.key}`)?.kind !== "new"; }
    if (r.oobm) return matched.has((r.target as PlanUnit).key);
    return matched.has((r.target as PlanUnit).key);
  };
  const P: Conn[] = plan.cables.map((c) => ({ a: planEnd(c.a), b: planEnd(c.b), plan: c, exists: planExists(c.a) && planExists(c.b) }));

  const portIdx = new Map<number, { dev: X; i: number }>();
  for (const d of all) d.ports.forEach((p, i) => portIdx.set(p.id, { dev: d, i }));
  const docKey = (e: Ep) => e.key || (allMembers.find((m) => findEp([e], m) === 0)?.key ?? epId(e));
  const docEnd = (pid: number): End => {
    const at = portIdx.get(pid); if (!at) return NONE;
    const { dev, i } = at, port = dev.ports[i];
    if (dev.oobm?.portId === pid) return { id: dev.oobm.key, port: "", kind: "ipmi", name: dev.oobm.name, managed: true };
    if (dev.auvik_id?.startsWith("g:")) {
      const ep = dev.endpoints?.[i];
      if (!ep || ep.manual || dev.endpoints!.length !== dev.ports.length) return NONE;
      const id = docKey(ep);
      return { id, port: "", kind: "member", name: ep.name, managed: true };
    }
    if (!dev.auvik_id || dev.auvik_id.startsWith("vm:")) return NONE;
    return { id: dev.auvik_id, port: port.name, kind: kinds.get(dev.auvik_id) ?? "", name: dev.name, managed: true };
  };
  const D: Conn[] = [];
  for (const c of doc.cables) {
    const a = docEnd(c.a), b = docEnd(c.b);
    if (!a.managed || !b.managed || !kinds.has(a.id) || !kinds.has(b.id)) continue;   // hand-made, manual, or not in this export: never touched
    a.kind = kinds.get(a.id)!; b.kind = kinds.get(b.id)!;
    D.push({ a, b, cable: c });
  }
  const left = new Set(D);
  const pairs = new Map<Conn, Conn>();
  for (const strict of [true, false]) {
    for (const p of P) {
      if (!p.exists || pairs.has(p)) continue;
      const d = D.find((x) => left.has(x) && compat(p, x, strict));
      if (d) { left.delete(d); pairs.set(p, d); }
    }
  }
  for (const p of P) {
    const c = p.plan!;
    if (pairs.has(p)) { cableStatus.set(c.key, { kind: "existing" }); continue; }
    const leaf = p.exists ? leafOf(p) : null;
    const d = leaf ? D.find((x) => left.has(x) && leafOf(x) === leaf) : undefined;
    if (d) {
      left.delete(d);
      cableStatus.set(c.key, { kind: "moved", from: d.cable });
      const memberEnd = p.a.kind === "member" ? p.a : p.b.kind === "member" ? p.b : null;
      const g = c.a.target.isGroup ? c.a.target : c.b.target.isGroup ? c.b.target : null;
      const loc = g && memberEnd ? members.get(`${g.key}|${memberEnd.id}`) : undefined;
      const lockedPort = !!(loc?.ep && has(loc.ep.locked, "port"));
      changes.push({ id: `mv:${c.key}`, cat: "moved", title: names.get(leaf!) ?? leaf!, from: describe(d), to: describe(p), detail: loc?.kind === "moved" ? `moves to ${g!.name}` : undefined, locked: lockedPort, defaultOn: !lockedPort });
    } else {
      cableStatus.set(c.key, { kind: "new" });
      changes.push({ id: `cn:${c.key}`, cat: "newCable", title: describe(p), detail: c.label, defaultOn: true });
    }
  }
  for (const d of D) {
    if (!left.has(d)) continue;
    changes.push({ id: `gone:${d.cable!.id}`, cat: "gone", title: describe(d), detail: "Auvik no longer lists this connection", defaultOn: false });
  }
  // a member that changed box but has no cable to move
  for (const b of boxes) for (const m of b.members) {
    const loc = members.get(`${b.key}|${m.key}`)!;
    if (loc.kind !== "moved") continue;
    if (cableStatus.get(`${b.key}|${m.key}`)?.kind === "moved") continue;
    changes.push({ id: `mvm:${m.key}`, cat: "moved", title: m.name, from: loc.dev!.name, to: b.name, defaultOn: true });
  }

  // ---- missing
  if (items.length) {
    for (const d of findMissing(doc, items)) changes.push({ id: `rmdev:${d.id}`, cat: "missingDev", title: d.name, detail: (opts?.fill ? "No longer in Auvik" : "Not in this export") + ". Kept unless you tick it.", defaultOn: false });
  }
  const boxKeys = new Set(boxes.map((b) => b.key));
  for (const d of all) {
    if (!d.auvik_id || !boxKeys.has(d.auvik_id) || !d.endpoints) continue;
    for (const ep of d.endpoints) {
      if (ep.manual) continue;
      const stillThere = allMembers.some((m) => findEp([ep], m) === 0) || planMemberKeys.has(docKey(ep));
      if (!stillThere) missingEp.push({ id: `rmm:${d.id}:${docKey(ep)}`, dev: d, ep });
      if (!stillThere) changes.push({ id: `rmm:${d.id}:${docKey(ep)}`, cat: "missingMember", title: ep.name, detail: `in ${d.name}. Kept unless you tick it.`, defaultOn: false });
    }
  }
  return out;
}

export const defaultSelection = (d: Diff): Set<string> => new Set(d.changes.filter((c) => c.defaultOn).map((c) => c.id));
