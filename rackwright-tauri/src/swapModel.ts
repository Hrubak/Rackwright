// Change a device's size, or swap it for another catalog model. Pure document edits; call inside one edit() for one undo step.
import { Device, Doc, Port, Rack } from "./types";
import { Tpl, checkPlace, clone, fromTpl, placeOnShelf, sidesOf, widthLabel } from "./edit";

export interface EditResult { ok: boolean; msg: string }
const fail = (msg: string): EditResult => ({ ok: false, msg });

/** Slots to try for `dev` (fields already updated): keep the top edge, then the bottom edge. */
function slots(old: { u: number; u_size: number; side: number }, dev: Device): [number, number][] {
  const top = old.u + old.u_size - 1;
  const us = Array.from(new Set([top - dev.u_size + 1, old.u])).filter((u) => u >= 1);
  const sides = Array.from(new Set([old.side, ...sidesOf(dev)])).filter((s) => sidesOf(dev).includes(s));
  return us.flatMap((u) => sides.map((s) => [u, s] as [number, number]));
}

/** Nearest free slot (same rack) by distance from `u0`, same side first. */
function nearest(doc: Doc, dev: Device, r: Rack, u0: number, side0: number): [number, number] | null {
  const max = r.u - dev.u_size + 1;
  const us = Array.from({ length: Math.max(0, max) }, (_, i) => i + 1).sort((a, b) => Math.abs(a - u0) - Math.abs(b - u0) || b - a);
  const sides = sidesOf(dev).sort((a, b) => Math.abs(a - side0) - Math.abs(b - side0));
  for (const u of us) for (const s of sides)
    if (checkPlace(doc, dev, r, u, s).ok) return [u, s];
  return null;
}

/** Move `dev` (already carrying its new size / half / plate) to a slot in its rack. Returns an error text, or "". */
function refit(doc: Doc, dev: Device, old: { rack: number | null; u: number; u_size: number; side: number }, nearby: boolean): { why: string; warn?: string } {
  if (old.rack == null) { dev.rack = null; return { why: "" }; }
  const r = doc.racks.find((x) => x.id === old.rack);
  if (!r) return { why: "" };
  let first = "";
  for (const [u, s] of slots(old, dev)) {
    const p = checkPlace(doc, dev, r, u, s);
    if (p.ok) { dev.rack = r.id; dev.u = u; dev.side = s; return { why: "", warn: p.warn }; }
    if (!first) first = p.why || "";
  }
  if (dev.plate?.off) {
    // Desktop gear stands on a shelf: use one nearby, or add a Shelf under it.
    // Free the unit's own old slot first, so a new shelf can go where the unit stood.
    dev.rack = null;
    const probe = { ...dev };
    if (placeOnShelf(doc, probe, r, old.u)) { dev.rack = r.id; dev.u = probe.u; dev.side = probe.side; return { why: "" }; }
    return { why: `No room in ${r.name} for ${dev.name} on a shelf. Free some U first.` };
  }
  if (nearby) {
    const s = nearest(doc, dev, r, old.u, old.side);
    if (s) { dev.rack = r.id; dev.u = s[0]; dev.side = s[1]; return { why: "" }; }
    return { why: `No room in ${r.name} for ${dev.name} (${dev.u_size}U${widthLabel(dev) ? "," + widthLabel(dev) + " width" : ""}).` };
  }
  return { why: first || `${dev.name} does not fit there` };
}

/** Change a device's height (U) and/or half-width flag. The top edge stays put when it can, else the bottom edge. */
export function resizeDevice(doc: Doc, id: number, uSize: number, half?: boolean): EditResult {
  const work = clone(doc);
  const dev = work.devices.find((x) => x.id === id);
  if (!dev) return fail("No such device");
  const rack = work.racks.find((r) => r.id === dev.rack);
  const max = rack ? rack.u : 99;
  const n = Math.round(uSize);
  if (!(n >= 1)) return fail("Height must be at least 1U");
  if (n > max) return fail(`${dev.name} can be at most ${max}U in ${rack!.name}`);
  const old = { rack: dev.rack, u: dev.u, u_size: dev.u_size, side: dev.side };
  if (half != null && half !== !!dev.half && dev.plate) return fail("This model has a fixed width");
  if (n === dev.u_size && (half == null || half === !!dev.half)) return { ok: true, msg: "" };
  dev.u_size = n;
  if (half != null) { dev.half = half; delete dev.cols; if (!half) dev.side = 0; }
  const r = refit(work, dev, old, false);
  if (r.why) return fail(r.why);
  Object.assign(doc, work);
  return { ok: true, msg: r.warn || "" };
}

const sameClass = (a: string, b: string) => (a === "Power") === (b === "Power");

export interface PortMap { from: number; to: number; kept?: boolean }

/**
 * Build the new port list. Cabled ports (and the management port of the OOB link) move to a new port:
 * same name first (ignoring case), then the same type in order. Anything left over stays as an extra port.
 * Mapped ports keep their id, so cables keep their ids, colours and labels without edits.
 */
export function mapPorts(doc: Doc, dev: Device, newPorts: Port[]): { ports: Port[]; extra: number; maps: PortMap[] } {
  const used = (p: Port) => doc.cables.some((c) => c.a === p.id || c.b === p.id) || dev.oobm?.portId === p.id;
  const fresh = newPorts.map((p) => ({ ...p }));
  const taken = new Set<number>(); // indexes into fresh
  const maps: PortMap[] = [];
  const todo = dev.ports.filter(used);
  const placed = new Map<number, Port>(); // old port id -> new slot (carrying the old id)
  const give = (old: Port, i: number) => {
    taken.add(i);
    fresh[i].id = old.id;
    if (old.label) fresh[i].label = old.label;
    placed.set(old.id, fresh[i]);
    maps.push({ from: old.id, to: old.id });
  };
  for (const old of todo) { // pass 1: same name
    const i = fresh.findIndex((f, k) => !taken.has(k) && f.name.toLowerCase() === old.name.toLowerCase() && sameClass(f.type, old.type));
    if (i >= 0) give(old, i);
  }
  for (const old of todo) { // pass 2: same type, in order
    if (placed.has(old.id)) continue;
    const i = fresh.findIndex((f, k) => !taken.has(k) && f.type === old.type);
    if (i >= 0) give(old, i);
  }
  const ports: Port[] = [];
  let extra = 0;
  for (const f of fresh) ports.push(f);
  const names = new Set(fresh.map((f) => f.name.toLowerCase()));
  for (const old of todo) {
    if (placed.has(old.id)) continue;
    const keep = { ...old };
    if (names.has(keep.name.toLowerCase())) keep.name = keep.name + " (old)";
    names.add(keep.name.toLowerCase());
    ports.push(keep); extra++;
    maps.push({ from: old.id, to: old.id, kept: true });
  }
  return { ports, extra, maps };
}

export interface SwapResult extends EditResult { extra: number; moved: number }

/** Swap a device for catalog template `tpl`. Identity, notes, Auvik fields, OOB link, endpoints and position are kept. */
export function swapModel(doc: Doc, id: number, tpl: Tpl): SwapResult {
  const work = clone(doc);
  const bad = (m: string): SwapResult => ({ ok: false, msg: m, extra: 0, moved: 0 });
  const dev = work.devices.find((x) => x.id === id);
  if (!dev) return bad("No such device");
  const old = { rack: dev.rack, u: dev.u, u_size: dev.u_size, side: dev.side };
  const was = { type: dev.type, model: dev.model };
  const had = !!dev.plate;

  const fresh = fromTpl(work, tpl); // gives new ids to the template ports
  const pm = mapPorts(work, dev, fresh.ports);

  dev.u_size = fresh.u_size; dev.half = fresh.half; dev.color = fresh.color; dev.rows = fresh.rows;
  if (fresh.cols) dev.cols = fresh.cols; else delete dev.cols;
  if (dev.side >= sidesOf(dev).length) dev.side = sidesOf(dev).length - 1;
  dev.type = tpl.type;
  if (tpl.model) dev.model = tpl.model;
  // A rear or short mount stays as it was; a new faceplate on a front-only plain box becomes full depth.
  if (fresh.plate) { dev.plate = fresh.plate; if (!dev.rev && dev.face === "front" && !had) dev.face = "both"; } else delete dev.plate;
  dev.ports = pm.ports;
  if (dev.auvik_id) {
    const lock = new Set(dev.locked ?? []);
    if (dev.type !== was.type) lock.add("type");
    if (dev.model !== was.model) lock.add("model");
    if (lock.size) dev.locked = Array.from(lock);
  }
  if (!dev.half) dev.side = 0;

  const r = refit(work, dev, old, true);
  if (r.why) return bad(r.why);
  Object.assign(doc, work);
  let msg = `Changed to ${tpl.name}.`;
  if (pm.extra) msg += ` ${pm.extra} cable${pm.extra === 1 ? "" : "s"} kept on extra ports you can move.`;
  if (old.rack != null && (dev.u !== old.u || dev.side !== old.side)) msg += ` Moved to U${dev.u}.`;
  return { ok: true, msg: r.warn ? msg + " " + r.warn : msg, extra: pm.extra, moved: pm.maps.length - pm.extra };
}
