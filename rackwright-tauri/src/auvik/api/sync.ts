// Per-site Auvik sync: plan, fill rules across the site's rack documents, layout auto-place, safe save.
// Pure except saveSite. Must not import backend.ts at load (tests run under tsx); the API and the site creator are injected.
import * as A from "../../api";
import type { AuvikInventory, AuvikLinks, AuvikTenant } from "../../api";
import type { ClientItem } from "../../clients/store";
import { addRack, clone, fromTpl, newCable, nid, setOffColumn } from "../../edit";
import { modelById, specOf } from "../../racks";
import { isManual, markManual, setSource } from "../../source";
import type { Device, Doc } from "../../types";
import { applyImport } from "../../imports/apply";
import { planImport, type Row } from "../../imports/plan";
import type { ImportSpec } from "../../imports/spec";
import { applyInPlace } from "../apply";
import { Change, Diff, computeDiff, defaultSelection, deviceFields, findEp, orderUnits, type Ep, type X } from "../diff";
import type { ParsedAuvik } from "../parse";
import { classify, epKindOf, groupTemplate, hostCtxOf, isEndpointMode, locatePort, resolvePlan, summarize, type EpKind, type HostCtx, type ImportPlan, type Kind, type PlanCable, type PlanUnit, type PortRef } from "../plan";
import { NO_PORT, endpointPorts } from "./links";
import { KIND_FAMILY, TO_PLACE_KINDS, apiItems, type ApiPlanItem, type Family, type Overrides } from "./map";

export interface SiteDocs { siteId: number; racks: { id: number; name: string; version: number; doc: Doc }[] }
type Fill = "empty" | "overwrite";
export interface Defaults { model: string; u: number }

/** The rack document that holds this tenant's import: by tenant id (survives a rename), else the one old .xlsx import. */
export function findAuvikDoc(s: SiteDocs, tenantId: string): { id: number; legacy: boolean } | null {
  const hit = s.racks.find((r) => r.doc.auvik?.tenant === tenantId);
  if (hit) return { id: hit.id, legacy: false };
  const old = s.racks.filter((r) => r.doc.auvik && !r.doc.auvik.tenant);
  return old.length === 1 ? { id: old[0].id, legacy: true } : null;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
/** Tenant link first, then the site's name, else a new site. */
export function mapTenantToSite(t: AuvikTenant, client: ClientItem, docsBySite: Map<number, SiteDocs>): { siteId: number | null; name: string; isNew: boolean } {
  for (const [id, sd] of docsBySite) if (sd.racks.some((r) => r.doc.auvik?.tenant === t.id)) return { siteId: id, name: client.sites.find((s) => s.id === id)?.name ?? t.name, isNew: false };
  const byName = client.sites.find((s) => same(s.name, t.name));
  return byName ? { siteId: byName.id, name: byName.name, isNew: false } : { siteId: null, name: t.name, isNew: true };
}

export interface SitePlan {
  tenant: AuvikTenant;
  target: { docId: number | null; version: number | null; name: string; legacy: boolean };
  inv: AuvikInventory; siteDocs: SiteDocs; defaults: Defaults; fill: Fill; layout?: ImportSpec; hosts?: Record<string, string>;
  parsed: ParsedAuvik; items: ApiPlanItem[]; plan: ImportPlan;
  diff: Diff | null;                                          // null when the site has no Auvik document yet
  other: { rackId: number; rackName: string; diff: Diff }[]; // fill-only changes in the site's other rack documents
  elsewhere: Set<string>;                                      // plan unit keys already held by another rack document: never added to "(Auvik)"
  heldIn: Record<string, string>;                              // the same keys -> the name of the rack document that holds the device
  held: Record<string, Held>;                                  // plan item keys the site's documents already hold (any document, "(Auvik)" too)
  layoutRows?: Row[];
  foreign: Set<string>;                                        // plan cable keys with an end outside the "(Auvik)" document
  notes: string[];                                             // "Not drawn: ..." lines: cables the import cannot draw (the two devices are in different rack documents)
  links?: AuvikLinks;                                          // the site's cables, when read
  over?: Overrides;                                            // the person's kind / type / model picks, by plan item key
  epPorts?: Map<string, { sw: string; port: string; attach: boolean }>;   // the switch and port of each endpoint that has one (see endpointPorts)
}

const isFld = (id: string) => id.startsWith("fld:");

/** The fields the person picked by hand, by plan item key: a kind or a type -> "type", a model (not Auvik's) -> "model".
 *  A Virtual Machine pre-pick is not in here: it is an Auvik value. */
export function handPicks(over?: Overrides): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (k: string, f: string) => out.set(k, (out.get(k) ?? new Set<string>()).add(f));
  for (const k of Object.keys(over?.kinds ?? {})) add(k, "type");
  for (const [k, v] of Object.entries(over?.types ?? {})) if (v) add(k, "type");
  for (const [k, v] of Object.entries(over?.models ?? {})) if (v) add(k, "model");
  return out;
}
/** A hand pick's field change on a matched device or box member is ticked by default: the person chose it.
 *  Ids may carry a rack prefix ("<rackId>:fld:..."). */
function tickHand(d: Diff, plan: ImportPlan, picks: Map<string, Set<string>>): Diff {
  if (!picks.size) return d;
  const itemOf = new Map(plan.units.map((u) => [u.key, u.itemKey]));
  const hand = (c: Change): boolean => {
    const m = /^(?:\d+:)?(fldm?):(.+):([^:]+)$/.exec(c.id);
    if (!m) return false;
    const key = m[1] === "fld" ? itemOf.get(m[2]) : m[2];
    return !!key && !!picks.get(key)?.has(m[3]);
  };
  const detail = (c: Change) => { const f = c.id.split(":").pop()!; return c.locked ? `${f} – replaces your earlier value` : f; };   // a kept (hand-set) value: say so
  return { ...d, changes: d.changes.map((c) => (hand(c) ? { ...c, defaultOn: true, detail: detail(c) } : c)) };
}
/** Device.type -> the kind it stands for. Types that name no kind (Patch panel, Shelf, ...) give none, so a Type pick never moves a row.
 *  Only device kinds: a device's Type never makes it a VM, an Endpoint or an OOBM (that would add it a second time). */
const TYPE_KIND: Record<string, Kind> = { Firewall: "firewall", Router: "router", Switch: "switch", Server: "server", Storage: "storage", UPS: "ups", PDU: "pdu", Wireless: "ap" };
const kindOfType = (type: string): Kind | null => {
  if (TYPE_KIND[type]) return TYPE_KIND[type];
  const k = classify({ type, name: "", model: "" });
  return KIND_FAMILY[k] === "device" ? k : null;
};
/** Kinds an earlier import's hand pick left in the site's documents, by plan key "api:<id>": a device whose type is
 *  manual or locked, a member of an Endpoints box ("endpoint") or a VM box ("vm") whose `locked` has "type".
 *  They keep a picked kind on the next import. They are not new hand picks: never marked again, never ticked. */
export function keptKinds(s: SiteDocs): Record<string, Kind> {
  const out: Record<string, Kind> = {};
  for (const r of s.racks) for (const d of r.doc.devices as X[]) {
    const id = (d.auvik_id ?? "").split("#")[0];
    if (id.startsWith("api:") && !d.endpoints && isManual(d, "type")) { const k = kindOfType(d.type || ""); if (k) out[id] = k; }
    const box = (d as any).auvik_epbox ? "endpoint" : d.auvik_id?.startsWith("vm:") ? "vm" : null;
    if (box) for (const e of d.endpoints ?? []) if (e.key?.startsWith("api:") && e.locked?.includes("type")) out[e.key] = box;
  }
  return out;
}
/** After saving: every hand-picked field the document now holds is marked manual (and locked); a box member gets it in its `locked`.
 *  An OOBM (kind ipmi) sits on its host, with no unit or member of its own, so a pick that makes a row an OOBM is not marked and
 *  not kept on the next import. That is fine: a held row never changes family (see Family in map.ts). */
function markHand(doc: Doc, p: SitePlan, picks: Map<string, Set<string>>) {
  for (const [key, fields] of picks) {
    const it = p.items.find((i) => i.key === key);
    if (!it) continue;
    const id = "api:" + (it.dev.apiId ?? key);
    const unit = p.plan.units.find((u) => u.itemKey === key);
    const devWant = (f: string) => (f === "type" ? it.typeOver ?? unit?.tpl.type : it.modelOver);
    const epWant = (f: string) => (f === "type" ? it.type : it.modelOver);
    for (const d of doc.devices as X[]) {
      if ((d.auvik_id ?? "").split("#")[0] === id) for (const f of fields) { const w = devWant(f); if (w && (d as any)[f] === w) markManual(d, f); }
      for (const e of d.endpoints ?? []) {
        if (e.key !== id) continue;
        for (const f of fields) { const w = epWant(f); if (w && (e as any)[f] === w && !e.locked?.includes(f)) e.locked = [...(e.locked ?? []), f]; }
      }
    }
  }
}
const isCableChange = (id: string) => /^(?:\d+:)?(?:cn|mv):/.test(id);
/** The two devices a plan cable joins, or null when an end is an endpoint-group member or an OOBM. */
const unitEnds = (c: PlanCable): [PlanUnit, PlanUnit] | null =>
  c.a.target.isGroup || c.b.target.isGroup || c.a.oobm || c.b.oobm ? null : [c.a.target as PlanUnit, c.b.target as PlanUnit];
const cableOf = (plan: ImportPlan, id: string) => { const k = /^(?:\d+:)?(?:cn|mv):(.+)$/.exec(id)?.[1]; return plan.cables.find((c) => c.key === k); };
const endsOf = (plan: ImportPlan, id: string) => { const c = cableOf(plan, id); return c ? unitEnds(c) : null; };
/** The "(Auvik)" document lists no cable with an end held in another rack document: that cable belongs there, or is not drawn. */
const dropCablesElsewhere = (d: Diff, foreign: Set<string>): Diff => ({
  ...d,
  changes: d.changes.filter((c) => !isCableChange(c.id) || !foreign.has(/^(?:\d+:)?(?:cn|mv):(.+)$/.exec(c.id)![1])),
});
/** Another rack document: field changes, and cable changes whose two ends it holds and the "(Auvik)" document does not. */
const otherChanges = (d: Diff, plan: ImportPlan, mineM: Map<string, Device>): Change[] => d.changes.filter((c) => {
  if (isFld(c.id)) return true;
  if (!isCableChange(c.id)) return false;
  const e = endsOf(plan, c.id);
  return !!e && e.every((u) => d.matched.has(u.key) && !mineM.has(u.key));
});
/** Where each end of every plan cable lives: "m" the "(Auvik)" document (also where a device held nowhere is added), "o<i>" the i-th other rack document.
 *  A device end lives where the device is held; an endpoint-group end where the group's box is (else in "(Auvik)"); an OOBM end on its host server.
 *  `foreign` = cables with an end outside "(Auvik)" (the Auvik document lists no change for them); `notes` = one "Not drawn" line per pair whose ends are in different documents. */
function cableHomes(plan: ImportPlan, mine: SiteDocs["racks"][number] | undefined, mineM: Map<string, Device>, others: { doc: Doc; name: string }[], otherM: Map<string, Device>[]): { foreign: Set<string>; notes: string[] } {
  const unitHome = (k: string) => { if (mineM.has(k)) return "m"; const i = otherM.findIndex((m) => m.has(k)); return i >= 0 ? "o" + i : "m"; };
  const boxHome = (k: string) => {
    if (mine?.doc.devices.some((d) => (d as X).auvik_id === k)) return "m";
    const i = others.findIndex((o) => o.doc.devices.some((d) => (d as X).auvik_id === k));
    return i >= 0 ? "o" + i : "m";
  };
  const end = (r: PortRef): { home: string; name: string; id: string; leaf: boolean } => {
    if (r.oobm) { const o = plan.oobms.find((x) => x.key === r.oobm); return o ? { home: unitHome(o.unit.key), name: o.unit.name, id: r.oobm, leaf: true } : { home: "m", name: "", id: r.oobm, leaf: true }; }
    if (r.target.isGroup) return { home: boxHome(r.target.key), name: r.target.name, id: r.target.key, leaf: true };
    return { home: unitHome(r.target.key), name: r.target.name, id: r.target.key, leaf: false };
  };
  const foreign = new Set<string>(), seen = new Set<string>(), notes: string[] = [];
  for (const c of plan.cables) {
    const a = end(c.a), b = end(c.b);
    if (a.home !== "m" || b.home !== "m") foreign.add(c.key);
    if (a.home === b.home) {
      // an endpoint box or OOBM cable inside one other rack document: not drawn there, but never lost silently
      if (a.home === "m" || !(a.leaf || b.leaf)) continue;
      const k = "same|" + a.id + "|" + b.id;
      if (seen.has(k)) continue;
      seen.add(k); notes.push(`Not drawn: ${a.name} and ${b.name} are in ${others[+a.home.slice(1)].name}; add this cable there by hand.`);
      continue;
    }
    const k = a.id + "|" + b.id;
    if (seen.has(k)) continue;
    seen.add(k); notes.push(`Not drawn: ${a.name} and ${b.name} are in different racks`);
  }
  return { foreign, notes };
}
/** Draws the ticked cable changes (cn / mv) in a rack document that holds both ends. Uses the ports the devices have (a named port that is missing is made);
 *  never moves a device. A port that is already cabled is left alone. */
function drawCables(doc: Doc, plan: ImportPlan, diff: Diff, pick: Set<string>): boolean {
  const used = (pid: number, except?: number) => doc.cables.some((k) => k.id !== except && (k.a === pid || k.b === pid));
  let changed = false;
  for (const c of plan.cables) {
    const e = unitEnds(c), st = diff.cable.get(c.key);
    if (!e || !st || st.kind === "existing" || !c.a.iface || !c.b.iface) continue;
    if (!pick.has((st.kind === "new" ? "cn:" : "mv:") + c.key)) continue;
    const da = diff.matched.get(e[0].key), db = diff.matched.get(e[1].key);
    if (!da || !db) continue;
    const ha = locatePort(da, c.a.iface, e[0]), hb = locatePort(db, c.b.iface, e[1]), old = st.kind === "moved" ? st.from : undefined;
    if (!ha || !hb || (!ha.port && !ha.create) || (!hb.port && !hb.create)) continue;
    if ((ha.port && used(ha.port.id, old?.id)) || (hb.port && used(hb.port.id, old?.id))) continue;
    const make = (h: typeof ha, dv: Device) => h.port ?? (() => { const p = { id: nid(doc), name: h.create!.name, type: h.create!.type, label: "" }; dv.ports.push(p); return p; })();
    if (old) doc.cables = doc.cables.filter((k) => k.id !== old.id);
    const k = newCable(doc, make(ha, da).id, make(hb, db).id);
    if (typeof k === "string") continue;
    if (old) for (const f of ["color", "style", "type", "length", "unit", "notes", "logical"]) if ((old as any)[f] !== undefined) (k as any)[f] = (old as any)[f];
    k.label = c.label; if (!old) k.type = "Cat6";
    changed = true;
  }
  return changed;
}

/** A device found in another rack document is left where it is: it is not offered as new here. */
const dropElsewhere = (d: Diff, keys: Set<string>): Diff => ({ ...d, changes: d.changes.filter((c) => !(c.id.startsWith("new:") && keys.has(c.id.slice(4)))) });

/** A row the site already holds: where (see Family), in which rack document, and a device's current type there. */
export interface Held { family: Family; rack: string; type?: string }

/** The rows the site's rack documents already hold, by plan item key. By Auvik id first (devices, box members, OOBMs on a
 *  host), then by the import's own matching (serial, MAC, name) for documents made by hand or by an older .xlsx import. */
function heldOf(inv: AuvikInventory, org: string, siteDocs: SiteDocs, ctx: HostCtx, kept: Record<string, Kind>): Record<string, Held> {
  const out: Record<string, Held> = {};
  const { parsed, items } = apiItems(inv.devices, org, ctx, undefined, kept);   // without the person's picks
  const kindOf = new Map(items.map((i) => [i.key, i.kind]));
  const set = (k: string, family: Family, rack: string, type?: string) => {
    if (!kindOf.has(k) || out[k]) return;
    if (family === "device" && kindOf.get(k) === "ipmi") family = "ipmi";   // an OOBM that is a device of its own: no cross moves either
    out[k] = type === undefined ? { family, rack } : { family, rack, type };
  };
  for (const r of siteDocs.racks) for (const d of r.doc.devices as X[]) {
    if (!d.endpoints) set((d.auvik_id ?? "").split("#")[0], "device", r.name, d.type ?? "");
    if (d.oobm?.key) set(d.oobm.key, "ipmi", r.name);
    for (const e of d.endpoints ?? []) if (e.key) set(e.key, isVmBox(d) ? "vm" : "endpoint", r.name);
  }
  const plan = resolvePlan(parsed, items);
  for (const r of siteDocs.racks) {
    const m = computeDiff(r.doc, plan, items).matched;
    for (const u of plan.units) { const d = m.get(u.key); if (d) set(u.itemKey, "device", r.name, d.type ?? ""); }
    for (const it of items) {
      if (!isEndpointMode(it.mode) && it.mode !== "vm") continue;
      const h = heldElsewhere(it, r.doc, []);
      if (h) set(it.key, isVmBox(h.box) ? "vm" : "endpoint", r.name);
    }
  }
  return out;
}
const isVmBox = (d: Device) => !!(d as X).auvik_id?.startsWith("vm:") || d.type === "Virtual machines";

export function planSite(inv: AuvikInventory, tenant: AuvikTenant, siteDocs: SiteDocs, defaults: Defaults, fill: Fill, layout?: ImportSpec, hosts?: Record<string, string>, over?: Overrides, links?: AuvikLinks): SitePlan {
  const found = findAuvikDoc(siteDocs, tenant.id);
  const mine = found ? siteDocs.racks.find((r) => r.id === found.id)! : null;
  const ctx = hostCtxOf(mine?.doc ?? { devices: [] }), kept = keptKinds(siteDocs);
  const held = heldOf(inv, tenant.name, siteDocs, ctx, kept);
  const fam: Record<string, Family> = Object.fromEntries(Object.entries(held).map(([k, h]) => [k, h.family]));
  if (over?.kinds) over = { ...over, kinds: Object.fromEntries(Object.entries(over.kinds).filter(([k, kind]) => !fam[k] || KIND_FAMILY[kind] === fam[k])) };   // a cross-family pick on a held row is no pick
  const { parsed, items: raw } = apiItems(inv.devices, tenant.name, ctx, over, kept, fam, links?.links);
  const items = hosts ? raw.map((i) => (i.mode === "vm" && hosts[i.key] !== undefined ? { ...i, host: hosts[i.key] } : i)) : raw;   // the person's host choices from the preview
  // Endpoints that hang off a switch move onto it, unless the port looks like an uplink or is shared, or the site already holds
  // the endpoint somewhere else (a hand-made group, an older .xlsx group, another rack document): those keep their place.
  const epPorts = links?.links.length ? endpointPorts(parsed, items) : new Map<string, { sw: string; port: string; attach: boolean }>();
  if (epPorts.size) {
    const others = siteDocs.racks.filter((r) => r.id !== mine?.id).map((r) => r.doc);
    const stay = new Set<string>();
    for (const it of items) {
      if (!epPorts.has(it.key)) continue;
      const h = heldElsewhere(it, mine?.doc ?? { devices: [] } as unknown as Doc, others);
      const own = !!h && h.mine && !!(h.box as X).auvik_id?.startsWith("g:api:");   // a group this import made: it keeps its members
      if (!own && (h || !epPorts.get(it.key)!.attach)) stay.add(it.dev.rawName.toLowerCase());
    }
    for (const d of parsed.devices) d.neighbors = d.neighbors.filter((n) => !stay.has(n.name.toLowerCase()) && !stay.has(d.rawName.toLowerCase()));
  }
  const plan = resolvePlan(parsed, items);
  const other: SitePlan["other"] = [];
  const picks = handPicks(over);
  const mineRaw = mine ? tickHand(computeDiff(mine.doc, plan, items, { fill }), plan, picks) : null;
  const mineM = mineRaw?.matched ?? new Map<string, Device>();
  const otherM: Map<string, Device>[] = [];
  const elsewhere = new Set<string>();
  const heldIn: Record<string, string> = {};
  for (const r of siteDocs.racks) {
    if (r.id === mine?.id) continue;
    const d = tickHand(computeDiff(r.doc, plan, items, { fill, byMatch: true }), plan, picks);
    otherM.push(d.matched);
    for (const k of d.matched.keys()) { elsewhere.add(k); heldIn[k] ??= r.name; }
    const changes = otherChanges(d, plan, mineM);
    if (changes.length) other.push({ rackId: r.id, rackName: r.name, diff: { ...d, changes: changes.map((c) => ({ ...c, id: `${r.id}:${c.id}` })) } });   // ids carry the rack so one shared selection can tell the documents apart
  }
  const homes = cableHomes(plan, mine ?? undefined, mineM, siteDocs.racks.filter((r) => r.id !== mine?.id), otherM);
  const p: SitePlan = {
    tenant, inv, siteDocs, defaults, fill, layout, hosts, over, links, epPorts, parsed, items, plan, other, elsewhere, heldIn, held, foreign: homes.foreign, notes: homes.notes,
    target: { docId: mine?.id ?? null, version: mine?.version ?? null, name: mine?.name ?? tenant.name + " (Auvik)", legacy: found?.legacy ?? false },
    diff: mineRaw ? dropCablesElsewhere(dropElsewhere(mineRaw, elsewhere), homes.foreign) : null,
  };
  if (layout) p.layoutRows = build(p, null).rows;
  return p;
}

const specKinds = new Set<string>(TO_PLACE_KINDS);

/** Spec keys the device does not have yet; never overwrites a value. */
function fillSpecs(d: Device, specs: Record<string, string>) {
  for (const [k, v] of Object.entries(specs)) {
    if (d.specs?.[k]) continue;
    (d.specs ??= {})[k] = v; setSource(d, "specs." + k, "auvik");
  }
}

const EP_WORD: Record<EpKind, string> = { pc: "PCs", phone: "Phones", iot: "IoT devices", printer: "Printers", vm: "VMs", other: "Other endpoints" };

/** An endpoint the site already holds outside the Endpoints boxes: in an endpoint group or VM box from an older
 *  .xlsx import, or in another rack document. Matched by Auvik id, then the .xlsx key (serial, MAC, name), MAC, name. */
type HeldEp = { ep: Ep; mine: boolean; box: Device };
function heldElsewhere(it: SitePlan["items"][number], doc: Doc, others: Doc[]): HeldEp | null {
  const a = it.dev, apiKey = "api:" + (a.apiId ?? it.key);
  const look = (d: Doc, mine: boolean): HeldEp | null => {
    for (const x of d.devices) {
      if ((x as any).auvik_epbox || !x.endpoints?.length) continue;
      const byId = x.endpoints.find((e) => e.key === apiKey);
      if (byId) return { ep: byId, mine, box: x };
      const i = findEp(x.endpoints, { key: a.serial || a.macs[0] || a.name, mac: a.macs[0] || "", name: a.name });
      if (i >= 0) return { ep: x.endpoints[i], mine, box: x };
    }
    return null;
  };
  return look(doc, true) ?? others.reduce<HeldEp | null>((hit, d) => hit ?? look(d, false), null);
}

/** Endpoints the plan puts on a switch go in its "Endpoints on" group. The rest (no cable data, an uplink or shared port) go in one unattached
 *  box per kind in the Inventory column, with the switch and port in the Port column. A member that is in such a box stays there until its
 *  move is ticked. An endpoint the site already holds somewhere else stays where it is (in this document its Auvik id is recorded); it is never added twice. */
function fillEndpointBoxes(doc: Doc, p: SitePlan, others: Doc[], picks: Map<string, Set<string>>) {
  const items = p.items, inGroup = new Set(p.plan.groups.flatMap((g) => g.members.map((m) => m.key)));
  const portText = (key: string) => { const e = p.epPorts?.get(key); return e ? (e.port ? `${e.sw} ${e.port}` : `${e.sw} (${NO_PORT})`) : null; };
  const boxed = (key: string) => doc.devices.some((x) => (x as any).auvik_epbox && x.endpoints?.some((e) => e.key === key));
  const byKind = new Map<EpKind, SitePlan["items"]>();
  for (const it of items) {
    if (!isEndpointMode(it.mode)) continue;
    const held = heldElsewhere(it, doc, others);
    if (held) { if (held.mine) { held.ep.key = "api:" + (it.dev.apiId ?? it.key); held.ep.status = it.dev.status; } continue; }
    if (inGroup.has(it.key) && !boxed("api:" + (it.dev.apiId ?? it.key))) continue;   // the switch's group takes it
    const k = epKindOf(it); byKind.set(k, [...(byKind.get(k) ?? []), it]);
  }
  for (const [kind, list] of byKind) {
    let d = doc.devices.find((x) => (x as any).auvik_epbox === kind) as X | undefined;
    if (!d) {
      const g = groupTemplate(0);
      d = fromTpl(doc, { ...g, name: EP_WORD[kind], ports: [] }) as X;
      (d as any).auvik_epbox = kind; d.face = "front"; d.color = g.color; d.type = "Endpoints";
      doc.devices.push(d);
      setOffColumn(doc, d, 1);
    }
    const eps = d.endpoints ?? (d.endpoints = []);
    for (const it of list) {
      const a = it.dev, key = "api:" + (a.apiId ?? it.key);
      const have = eps.find((e) => e.key === key);
      if (have) {
        have.status = a.status;
        const pt = portText(it.key);
        if (pt !== null && !have.locked?.includes("port")) have.port = pt;
        // a hand pick on a member that is already there applies without a tick, by design: these boxes are not part of the diff
        if (picks.get(it.key)?.has("type")) have.type = it.type;
        if (picks.get(it.key)?.has("model") && it.modelOver) have.model = it.modelOver;
        continue;
      }
      eps.push({ name: a.name, type: it.type, model: it.modelOver || a.model, ip: a.ips[0] || "", mac: a.macs[0] || "", port: portText(it.key) ?? "", status: a.status, kind, key });
    }
    d.name = EP_WORD[kind]; d.model = summarize(eps.map((e) => e.kind ?? "other")); d.u_size = 1; d.rows = 0; d.half = false;
    d.notes = "Auvik endpoints that are not attached to a switch";
  }
  doc.devices = doc.devices.filter((x) => !((x as any).auvik_epbox && x.endpoints && !x.endpoints.length));   // every member moved onto its switch
}

function build(p: SitePlan, sel: Set<string> | null): { auvikDoc: Doc; others: { rackId: number; doc: Doc }[]; rows: Row[] } {
  const mine = p.target.docId != null ? p.siteDocs.racks.find((r) => r.id === p.target.docId) : undefined;
  let doc: Doc;
  if (mine) doc = clone(mine.doc);
  else doc = { v: 1, nid: 1, racks: [], devices: [], cables: [] };
  if (!doc.racks.length) { const m = modelById(p.defaults.model); addRack(doc, "Rack 1", p.defaults.u, m ? specOf(m) : undefined); }
  const rackId = doc.racks[0].id;
  const before = new Set(doc.devices.map((d) => d.id));
  const ticked = new Set(sel ?? []);
  const picks = handPicks(p.over);
  const raw0 = tickHand(computeDiff(doc, p.plan, p.items, { fill: p.fill }), p.plan, picks);
  const diff0 = dropCablesElsewhere(dropElsewhere(raw0, p.elsewhere), p.foreign);
  if (!mine || !sel) for (const id of defaultSelection(diff0)) ticked.add(id);
  for (const k of p.elsewhere) ticked.delete(`new:${k}`);
  // A matched device is imported when it has nothing to tick, or one of its changes is ticked.
  const hasKey = (id: string, key: string) => id.includes(":" + key + ":") || id.endsWith(":" + key);
  const wanted = (key: string) => { const mine = diff0.changes.filter((c) => hasKey(c.id, key)); return !mine.length || mine.some((c) => ticked.has(c.id)); };
  applyInPlace(doc, p.plan, { target: "current", rackId }, p.items, ticked, { fill: p.fill });

  const itemOf = (d: Device) => p.items.find((i) => i.dev.apiId && (d as X).auvik_id === "api:" + i.dev.apiId);
  for (const d of doc.devices) {
    const it = itemOf(d);
    if (it?.specs && it.mode !== "skip" && (!before.has(d.id) || wanted(it.key))) fillSpecs(d, it.specs);
    if (before.has(d.id) || d.rack != null) continue;   // only devices made by this run, and never one that sits in a rack
    setOffColumn(doc, d, it && specKinds.has(it.kind) ? 0 : 1);
  }

  fillEndpointBoxes(doc, p, p.siteDocs.racks.filter((r) => r.id !== mine?.id).map((r) => r.doc), picks);
  markHand(doc, p, picks);

  let rows: Row[] = [];
  if (p.layout) {
    const opts = { rackId, newRackName: "Rack 1", newRackU: p.defaults.u, growRack: false };
    const ip = planImport(doc, p.layout, opts);
    rows = ip.rows.filter((r) => r.match && r.match.rack == null && r.action === "move");   // place devices that exist; never add the list's own rows
    if (rows.length) applyImport(doc, { ...ip, rows: rows.map((r) => ({ ...r, on: true })) }, opts);
  }
  doc.auvik = { ...doc.auvik, tenant: p.tenant.id, source: "api", unplaced: [], site: p.tenant.name, imported: new Date().toISOString().slice(0, 10) } as Doc["auvik"];

  const others: { rackId: number; doc: Doc }[] = [];
  for (const r of p.siteDocs.racks) {
    if (r.id === mine?.id) continue;
    const od = clone(r.doc);
    const diff = tickHand(computeDiff(od, p.plan, p.items, { fill: p.fill, byMatch: true }), p.plan, picks);
    const pre = `${r.id}:`;
    const listed = new Set(otherChanges(diff, p.plan, raw0.matched).map((c) => c.id));   // only what the preview lists for this document
    const pick = sel ? new Set([...sel].filter((x) => x.startsWith(pre)).map((x) => x.slice(pre.length)).filter((x) => listed.has(x))) : new Set(otherChanges(diff, p.plan, raw0.matched).filter((c) => c.defaultOn).map((c) => c.id));
    let changed = false;
    for (const u of orderUnits(p.plan)) {
      const dev = diff.matched.get(u.key) as X | undefined;
      if (!dev) continue;
      for (const f of deviceFields(dev, u)) {
        if (!pick.has(`fld:${u.key}:${f.field}`)) continue;
        (dev as any)[f.field] = f.to; setSource(dev, f.field, "auvik");
        if (!dev.auvik_id && u.item.dev.apiId) dev.auvik_id = "api:" + u.item.dev.apiId;
        if (dev.locked) dev.locked = dev.locked.filter((x) => x !== f.field);
        changed = true;
      }
    }
    if (drawCables(od, p.plan, diff, pick)) changed = true;
    if (changed) { markHand(od, p, picks); others.push({ rackId: r.id, doc: od }); }
  }
  return { auvikDoc: doc, others, rows };
}

/** The documents to save. `sel` = the ticked change ids (see diff.ts). */
export function applySite(p: SitePlan, sel: Set<string>): { auvikDoc: Doc; others: { rackId: number; doc: Doc }[] } {
  const { auvikDoc, others } = build(p, sel);
  return { auvikDoc, others };
}

type RackApi = Pick<typeof A, "createRack" | "updateRack" | "getRack">;
export type AddSite = (clientKey: string, name: string) => Promise<number>;

/** Creates the site through the clients store. Loaded on demand: the store pulls in backend.ts. */
const addSiteDefault: AddSite = async (clientKey, name) => {
  const { clientStore } = await import("../../clients/store");
  const s = clientStore();
  await s.addSite(clientKey, { name });
  const ids = (await s.get(clientKey)).sites.filter((x) => x.name === name).map((x) => x.id);
  if (!ids.length) throw new Error("The new site could not be found.");
  return Math.max(...ids);   // the one just made is the newest
};

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The preview and result line for a site that is not imported, or "" when the site is read and has devices.
 *  `got` is what reading the site gave: its inventory, or the error it failed with. */
export function skipLine(name: string, got: AuvikInventory | unknown): string {
  const inv = got && typeof got === "object" && "status" in got && "devices" in got ? (got as AuvikInventory) : null;
  if (!inv) return `${name}: skipped. ${msg(got)}`;
  if (inv.status === "denied") return `Auvik denied access to site ${name}, skipped.`;
  if (inv.status !== "ok" || !inv.devices.length) return `${name}: skipped. ${inv.note || "No devices in this site."}`;
  return "";
}

export interface SaveResult { line: string; siteId: number | null; created: boolean }
export interface SaveCtx { clientKey: string; siteId: number | null; siteName: string }

/** Saves one site and returns one result line. Never throws. */
export async function saveSite(p: SitePlan, sel: Set<string>, ctx: SaveCtx, api: RackApi = A, addSite: AddSite = addSiteDefault): Promise<SaveResult> {
  const head = ctx.siteName || p.tenant.name;
  let siteId = ctx.siteId, created = false;
  try {
    if (siteId == null) { siteId = await addSite(ctx.clientKey, ctx.siteName || p.tenant.name); created = true; }
    const first = applySite(p, sel);
    const notes: string[] = [];
    let saved = 0;

    const saveOne = async (id: number, name: string, version: number, doc: Doc) => {
      try { await api.updateRack(id, name, doc, version); saved++; return; }
      catch (e) {
        if (!(e instanceof A.ApiError && e.status === 409)) { notes.push(`Could not save ${name}: ${msg(e)}`); return; }
      }
      // Someone saved it while we worked: load their version, plan again against it, try once more.
      try {
        const r = await api.getRack(id);
        const docs: SiteDocs = { ...p.siteDocs, racks: p.siteDocs.racks.map((x) => (x.id === id ? { id, name: r.name, version: r.version, doc: r.doc } : x)) };
        const np = planSite(p.inv, p.tenant, docs, p.defaults, p.fill, p.layout, p.hosts, p.over, p.links);
        const out = applySite(np, sel);
        const nd = np.target.docId === id ? out.auvikDoc : out.others.find((o) => o.rackId === id)?.doc;
        if (!nd) return;   // their version needs nothing from us
        await api.updateRack(id, r.name, nd, r.version);
        saved++;
      } catch (e) {
        if (e instanceof A.ApiError && e.status === 409) notes.push(`Skipped ${name}: someone is editing it`);
        else notes.push(`Could not save ${name}: ${msg(e)}`);
      }
    };

    if (p.target.docId == null) {
      try { await api.createRack(p.target.name, first.auvikDoc, siteId); saved++; }
      catch (e) { notes.push(`Could not save ${p.target.name}: ${msg(e)}`); }
    } else await saveOne(p.target.docId, p.target.name, p.target.version ?? 0, first.auvikDoc);
    for (const o of first.others) {
      const r = p.siteDocs.racks.find((x) => x.id === o.rackId)!;
      await saveOne(o.rackId, r.name, r.version, o.doc);
    }
    const fl = [...(p.diff?.changes ?? []), ...p.other.flatMap((o) => o.diff.changes)].filter((c) => c.cat === "field");
    const updated = fl.filter((c) => sel.has(c.id)).length, kept = fl.length - updated;
    const mineDoc = p.target.docId != null ? p.siteDocs.racks.find((r) => r.id === p.target.docId) : undefined;
    const added = Math.max(0, first.auvikDoc.devices.length - (mineDoc?.doc.devices.length ?? 0));
    const skipped = p.items.filter((i) => i.mode === "skip").length;
    return { line: `${head}: saved ${saved} rack document${saved === 1 ? "" : "s"}. Added ${added}, updated ${updated}, kept ${kept}, skipped ${skipped}.` + (notes.length ? " " + notes.join(". ") + "." : ""), siteId, created };
  } catch (e) {
    return { line: `${head}: could not save. ${msg(e)}`, siteId, created };
  }
}
