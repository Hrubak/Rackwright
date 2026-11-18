// Per-site Auvik sync: plan, fill rules across the site's rack documents, layout auto-place, safe save.
// Pure except saveSite. Must not import backend.ts at load (tests run under tsx); the API and the site creator are injected.
import * as A from "../../api";
import type { AuvikInventory, AuvikTenant } from "../../api";
import type { ClientItem } from "../../clients/store";
import { addRack, clone, fromTpl, setOffColumn } from "../../edit";
import { modelById, specOf } from "../../racks";
import { setSource } from "../../source";
import type { Device, Doc } from "../../types";
import { applyImport } from "../../imports/apply";
import { planImport, type Row } from "../../imports/plan";
import type { ImportSpec } from "../../imports/spec";
import { applyInPlace } from "../apply";
import { Diff, computeDiff, defaultSelection, deviceFields, findEp, orderUnits, type Ep, type X } from "../diff";
import type { ParsedAuvik } from "../parse";
import { epKindOf, groupTemplate, hostCtxOf, isEndpointMode, resolvePlan, summarize, type EpKind, type ImportPlan } from "../plan";
import { TO_PLACE_KINDS, apiItems, type ApiPlanItem } from "./map";

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
  layoutRows?: Row[];
}

const isFld = (id: string) => id.startsWith("fld:");
/** A device found in another rack document is left where it is: it is not offered as new here. */
const dropElsewhere = (d: Diff, keys: Set<string>): Diff => ({ ...d, changes: d.changes.filter((c) => !(c.id.startsWith("new:") && keys.has(c.id.slice(4)))) });

export function planSite(inv: AuvikInventory, tenant: AuvikTenant, siteDocs: SiteDocs, defaults: Defaults, fill: Fill, layout?: ImportSpec, hosts?: Record<string, string>): SitePlan {
  const found = findAuvikDoc(siteDocs, tenant.id);
  const mine = found ? siteDocs.racks.find((r) => r.id === found.id)! : null;
  const { parsed, items: raw } = apiItems(inv.devices, tenant.name, hostCtxOf(mine?.doc ?? { devices: [] }));
  const items = hosts ? raw.map((i) => (i.mode === "vm" && hosts[i.key] !== undefined ? { ...i, host: hosts[i.key] } : i)) : raw;   // the person's host choices from the preview
  const plan = resolvePlan(parsed, items);
  const other: SitePlan["other"] = [];
  const elsewhere = new Set<string>();
  for (const r of siteDocs.racks) {
    if (r.id === mine?.id) continue;
    const d = computeDiff(r.doc, plan, items, { fill });
    for (const k of d.matched.keys()) elsewhere.add(k);
    const changes = d.changes.filter((c) => isFld(c.id));
    if (changes.length) other.push({ rackId: r.id, rackName: r.name, diff: { ...d, changes: changes.map((c) => ({ ...c, id: `${r.id}:${c.id}` })) } });   // ids carry the rack so one shared selection can tell the documents apart
  }
  const p: SitePlan = {
    tenant, inv, siteDocs, defaults, fill, layout, hosts, parsed, items, plan, other, elsewhere,
    target: { docId: mine?.id ?? null, version: mine?.version ?? null, name: mine?.name ?? tenant.name + " (Auvik)", legacy: found?.legacy ?? false },
    diff: mine ? dropElsewhere(computeDiff(mine.doc, plan, items, { fill }), elsewhere) : null,
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
function heldElsewhere(it: SitePlan["items"][number], doc: Doc, others: Doc[]): { ep: Ep; mine: boolean } | null {
  const a = it.dev, apiKey = "api:" + (a.apiId ?? it.key);
  const look = (d: Doc, mine: boolean): { ep: Ep; mine: boolean } | null => {
    for (const x of d.devices) {
      if ((x as any).auvik_epbox || !x.endpoints?.length) continue;
      const byId = x.endpoints.find((e) => e.key === apiKey);
      if (byId) return { ep: byId, mine };
      const i = findEp(x.endpoints, { key: a.serial || a.macs[0] || a.name, mac: a.macs[0] || "", name: a.name });
      if (i >= 0) return { ep: x.endpoints[i], mine };
    }
    return null;
  };
  return look(doc, true) ?? others.reduce<{ ep: Ep; mine: boolean } | null>((hit, d) => hit ?? look(d, false), null);
}

/** The API has no neighbours, so endpoints cannot hang off a switch. They go in one unattached box per kind in the Inventory column.
 *  An endpoint the site already holds somewhere else stays where it is (in this document its Auvik id is recorded); it is never added twice. */
function fillEndpointBoxes(doc: Doc, items: SitePlan["items"], others: Doc[]) {
  const byKind = new Map<EpKind, SitePlan["items"]>();
  for (const it of items) {
    if (!isEndpointMode(it.mode)) continue;
    const held = heldElsewhere(it, doc, others);
    if (held) { if (held.mine) { held.ep.key = "api:" + (it.dev.apiId ?? it.key); held.ep.status = it.dev.status; } continue; }
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
      if (have) { have.status = a.status; continue; }
      eps.push({ name: a.name, type: it.type, model: a.model, ip: a.ips[0] || "", mac: a.macs[0] || "", port: "", status: a.status, kind, key });
    }
    d.name = EP_WORD[kind]; d.model = summarize(eps.map((e) => e.kind ?? "other")); d.u_size = 1; d.rows = 0; d.half = false;
    d.notes = "Auvik endpoints that are not attached to a switch";
  }
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
  const diff0 = dropElsewhere(computeDiff(doc, p.plan, p.items, { fill: p.fill }), p.elsewhere);
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

  fillEndpointBoxes(doc, p.items, p.siteDocs.racks.filter((r) => r.id !== mine?.id).map((r) => r.doc));

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
    const diff = computeDiff(od, p.plan, p.items, { fill: p.fill });
    const pre = `${r.id}:`;
    const pick = sel ? new Set([...sel].filter((x) => x.startsWith(pre)).map((x) => x.slice(pre.length))) : new Set(diff.changes.filter((c) => isFld(c.id) && c.defaultOn).map((c) => c.id));
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
    if (changed) others.push({ rackId: r.id, doc: od });
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
        const np = planSite(p.inv, p.tenant, docs, p.defaults, p.fill, p.layout, p.hosts);
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
