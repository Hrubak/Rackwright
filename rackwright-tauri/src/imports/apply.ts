// Carries out the checked rows of an ImportPlan on a Doc: racks, devices, fields, positions, notes and cables.
import { addRack, catalogFind, checkPlace, findFree, fromTpl, newCable, nid, resizeRack, setOffRack, smartTemplate } from "../edit";
import type { Tpl } from "../edit";
import { guessHeight } from "./layout";
import type { Device, Doc, Port, Rack } from "../types";
import type { ImportLink } from "./spec";
import { nk } from "./spec";
import type { ImportOpts, ImportPlan, Row } from "./plan";

export interface ApplyLog { racksAdded: number; added: number; moved: number; changed: number; cables: number; ports: number; warnings: string[] }

const low = (s: unknown) => String(s ?? "").trim().toLowerCase();

/** Find a port the way RackMap does: exact name, then a bare number matching a trailing number, then a suffix match. */
function findPortByName(d: Device, name: string): Port | null {
  if (!name) return null;
  const want = nk(String(name).replace(/tengigabitethernet/i, "te").replace(/gigabitethernet/i, "gi").replace(/fastethernet/i, "fa").replace(/^(port|interface|int)\s*/i, ""));
  let p = d.ports.find((x) => nk(x.name) === want);
  if (p) return p;
  if (/^\d+$/.test(want)) {
    const re = new RegExp("(^|\\D)" + +want + "$");
    p = d.ports.find((x) => x.type !== "Power" && re.test(x.name)) || d.ports.find((x) => re.test(x.name));
    if (p) return p;
  }
  return d.ports.find((x) => nk(x.name).endsWith(want) && want.length >= 3) || null;
}
const guessPortType = (name: string) => /power|psu|pwr|^out\d|^in(put)?$|outlet|inlet/i.test(name.trim()) ? "Power" : /sfp/i.test(name) ? "SFP+" : "RJ45";

export function applyImport(doc: Doc, plan: ImportPlan, opts: ImportOpts): ApplyLog {
  const log: ApplyLog = { racksAdded: 0, added: 0, moved: 0, changed: 0, cables: 0, ports: 0, warnings: [] };
  const rows = plan.rows.filter((r) => r.on && r.dev.kind !== "empty" && r.action !== "same");

  // ---- racks
  let target: Rack | null = null;
  const rackByName = (name: string): Rack => {
    let r = doc.racks.find((x) => low(x.name) === low(name));
    if (!r) {
      const spec = plan.racks.find((x) => low(x.name) === low(name));
      r = addRack(doc, name, spec?.u ?? 42);
      if (spec?.circuit) r.circuit = spec.circuit;
      if (spec?.notes) r.notes = spec.notes;
      log.racksAdded++;
    }
    return r;
  };
  const ensureTarget = (): Rack => {
    if (target) return target;
    const hit = opts.rackId != null ? doc.racks.find((x) => x.id === opts.rackId) : undefined;
    if (hit) target = hit;
    else { target = addRack(doc, opts.newRackName, opts.newRackU); log.racksAdded++; }
    if (opts.growRack && plan.needU > target.u) {
      const why = resizeRack(doc, target, plan.needU);
      if (why) log.warnings.push(why);
    }
    return target;
  };
  const rackOf = (name: string | null | undefined): Rack | null => name === undefined ? ensureTarget() : name === null ? null : rackByName(name);

  // ---- fields
  const setField = (d: Device, k: string, v: unknown) => {
    const t = String(v ?? "").trim();
    if (!t) return;
    if (k === "power_w") { const n = Number(t); if (Number.isFinite(n)) d.power_w = n; return; }
    (d as unknown as Record<string, unknown>)[k] = t;
  };
  const mergeExtras = (d: Device, row: Row) => {
    const { specs, services } = row.dev;
    if (Object.keys(specs).length) d.specs = { ...(d.specs || {}), ...specs };
    for (const s of services) {
      d.services = d.services || [];
      if (!d.services.some((x) => low(x.name) === low(s.name) && String(x.port) === String(s.port))) d.services.push({ ...s });
    }
  };
  const makeDevice = (row: Row): Device => {
    const x = row.dev, label = (x.name + " " + (x.fields.model || "")).trim(), h = x.height ?? guessHeight(label).height;
    let tpl: Tpl = smartTemplate(label, h);
    if (x.type && tpl.type !== x.type && !catalogFind(label)) tpl = smartTemplate(x.type + " " + x.name, h);
    const d = fromTpl(doc, tpl);
    if (x.type) d.type = x.type;
    d.name = x.name;
    if (x.cols && x.cols > 1) { d.half = true; if (x.cols > 2) d.cols = x.cols; else delete d.cols; }
    for (const [k, v] of Object.entries(x.fields)) setField(d, k, v);
    mergeExtras(d, row);
    const face = x.face ?? "front";
    d.face = d.plate && face === "front" ? "both" : face;
    d.side = x.side ?? 0;
    return d;
  };

  // ---- gather
  interface Job { row: Row; d: Device; r: Rack | null; u: number | null; fresh: boolean }
  const jobs: Job[] = [];
  for (const row of rows) {
    const x = row.dev;
    if (x.kind === "note") {
      const r = rackOf(x.rack);
      if (!r) continue;
      const lines = (r.notes || "").split(/\r?\n/);
      if (!lines.some((l) => l.trim() === x.name.trim())) r.notes = lines.filter((l) => l.trim()).concat(x.name.trim()).join("\n");
      continue;
    }
    if (row.match) {
      const m = doc.devices.find((x) => x.id === row.match!.id) ?? row.match; // the plan may come from another copy of the doc (dry run on a clone)
      for (const df of row.diffs) if (!df.kept) setField(m, df.field, df.to);
      mergeExtras(m, row);
      if (row.action === "change") { log.changed++; continue; }
      const r = rackOf(x.rack);
      const same = r != null && m.rack === r.id;
      jobs.push({ row, d: m, r, u: x.u ?? (same ? m.u : null), fresh: false });
      continue;
    }
    const offRack = !!x.offRackIfNew && x.rack === undefined && x.u == null; // drawn outside any rack: off-rack, not the target rack
    jobs.push({ row, d: makeDevice(row), r: offRack ? null : rackOf(x.rack), u: x.u, fresh: true });
  }

  // ---- lift every moved device off its slot, then place from the top down
  for (const j of jobs) if (!j.fresh) j.d.rack = null;
  const top = (j: Job) => (j.u ?? 0) + j.d.u_size - 1;
  const put = (j: Job, u: number, side: number) => { j.d.rack = j.r!.id; j.d.u = u; j.d.side = side; if (j.fresh) doc.devices.push(j.d); };
  const off = (j: Job) => { setOffRack(doc, j.d); if (j.fresh) doc.devices.push(j.d); };
  const noRoom = (j: Job) => { log.warnings.push(`${j.d.name}: no free space in ${j.r!.name} — placed off-rack.`); off(j); };
  const prepare = (j: Job) => {
    const x = j.row.dev;
    if (!j.fresh && x.face && !(x.face === "front" && j.d.face === "both") && x.face !== j.d.face) j.d.face = x.face;
    if (x.side != null) j.d.side = x.side;
  };
  for (const j of jobs.filter((k) => k.r && k.u != null).sort((a, b) => top(b) - top(a))) {
    prepare(j);
    const r = j.r!, u = j.u!;
    if (u >= 1 && checkPlace(doc, j.d, r, u, j.d.side).ok) { put(j, u, j.d.side); continue; }
    if (u < 1) { noRoom(j); continue; }
    const s = findFree(doc, r, j.d);
    if (!s) { noRoom(j); continue; }
    log.warnings.push(`${j.d.name}: U${u} in ${r.name} is taken — placed at U${s[0]} instead.`);
    put(j, s[0], s[1]);
  }
  for (const j of jobs.filter((k) => k.r && k.u == null)) {
    prepare(j);
    const s = findFree(doc, j.r!, j.d);
    if (s) put(j, s[0], s[1]); else noRoom(j);
  }
  for (const j of jobs.filter((k) => !k.r)) off(j);
  for (const j of jobs) { if (j.fresh) log.added++; else log.moved++; }

  // ---- cables
  const findDev = (n: string) => doc.devices.find((x) => low(x.name) === low(n)) || doc.devices.find((x) => !!x.hostname && low(x.hostname) === low(n));
  const cabled = (id: number) => doc.cables.some((c) => c.a === id || c.b === id);
  const pick = (d: Device, name: string): Port => {
    let p = findPortByName(d, name);
    if (!p && !name) p = d.ports.find((x) => x.type !== "Power" && !cabled(x.id)) || null;
    if (!p) {
      p = { id: nid(doc), name: name.trim() || "Port " + (d.ports.length + 1), type: name ? guessPortType(name) : "RJ45", label: "" };
      d.ports.push(p);
      log.ports++;
    }
    return p;
  };
  const link = (l: ImportLink) => {
    const A = findDev(l.a), B = findDev(l.b);
    if (!A || !B || A === B) { log.warnings.push(`${l.a} ↔ ${l.b}: ${A && A === B ? "same device" : "device not found"} — skipped.`); return; }
    const pa = pick(A, l.ap), pb = pick(B, l.bp);
    if (doc.cables.some((c) => (c.a === pa.id && c.b === pb.id) || (c.a === pb.id && c.b === pa.id))) return; // already there
    const label = `${A.name} ${pa.name} ↔ ${B.name} ${pb.name}`;
    if (cabled(pa.id) || cabled(pb.id)) { log.warnings.push(`${label}: already connected — skipped.`); return; }
    const c = newCable(doc, pa.id, pb.id);
    if (typeof c === "string") { log.warnings.push(`${label}: ${c} — skipped.`); return; }
    if (l.type) c.type = l.type;
    if (l.label) c.label = l.label;
    const len = parseFloat(l.length || "");
    if (Number.isFinite(len)) c.length = len;
    if (l.color && /^#[0-9a-f]{3,8}$/i.test(l.color)) c.color = l.color;
    log.cables++;
  };
  for (const l of plan.links) link(l);
  return log;
}
