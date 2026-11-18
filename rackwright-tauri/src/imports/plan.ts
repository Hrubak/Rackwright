// Matches imported rows to devices already in the document and decides what each row would do. Changes nothing.
import { normMac } from "../auvik/parse";
import type { Device, Doc, Rack } from "../types";
import { placeLayout } from "./layout";
import type { ImportDevice, ImportLink, ImportRack, ImportSpec } from "./spec";

export interface ImportOpts { rackId: number | null; newRackName: string; newRackU: number; growRack: boolean }
export type Action = "add" | "move" | "change" | "same";
export interface FieldDiff { field: string; from: string; to: string; kept: boolean }
export interface Row { id: string; dev: ImportDevice; match: Device | null; action: Action; diffs: FieldDiff[]; on: boolean; reason?: string }
export interface ImportPlan { rows: Row[]; notInImport: Device[]; links: ImportLink[]; racks: ImportRack[]; needU: number; rackU: number }

export const POSSIBLE_REASON = "Possible match — check before importing";
const low = (s: unknown) => String(s ?? "").trim().toLowerCase();
const alnum = (s: string) => low(s).replace(/[^a-z0-9]/g, "");

/** Stem of a stack name: lowercase, non-alphanumerics gone, trailing member<n>, stack/stk<n> and digits removed. */
export function stackStem(s: string): string {
  return alnum(s).replace(/member\d+$/, "").replace(/(stack|stk)\d*$/, "").replace(/\d+$/, "");
}
const memberNo = (name: string): number | null => { const m = /member\s*(\d+)\s*$/i.exec(name); return m ? +m[1] : null; };
const hasToken = (line: string, name: string) => {
  const esc = name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${esc}($|[^a-z0-9])`).test(line.toLowerCase());
};

const GENERIC = new Set(["ups", "pdu", "smart", "rack", "mount", "power", "battery", "backup", "device", "unit", "network", "managed", "metered", "switched"]);
const brandWords = (...s: (string | undefined)[]) =>
  new Set(s.join(" ").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !GENERIC.has(w)));

const rackOrder = (a: Device, b: Device) =>
  (a.rack == null ? 1 : 0) - (b.rack == null ? 1 : 0) || (a.rack ?? 0) - (b.rack ?? 0) || (b.u + b.u_size) - (a.u + a.u_size) || (a.side ?? 0) - (b.side ?? 0) || a.id - b.id;

interface Target { id: number | null; name: string; u: number; rack?: Rack }

export function planImport(doc: Doc, input: ImportSpec, opts: ImportOpts): ImportPlan {
  const first = planOnce(doc, input, opts);
  if (input.kind !== "layout") return first;
  // A matched device's real size beats a guessed height: use it and place again so the rows below shift.
  let adjusted: ImportSpec | null = null;
  for (const row of first.rows) {
    if (!row.match || !row.dev.heightGuessed || row.match.u_size === row.dev.height) continue;
    adjusted = adjusted ?? { ...input, devices: input.devices.map((d) => ({ ...d })) };
    const d = adjusted.devices[+row.id.slice(1)];
    d.height = row.match.u_size; d.heightGuessed = false;
  }
  return adjusted ? planOnce(doc, adjusted, opts) : first;
}

function planOnce(doc: Doc, input: ImportSpec, opts: ImportOpts): ImportPlan {
  const spec: ImportSpec = { ...input, devices: input.devices.map((d) => ({ ...d })) }; // placed on a copy; the input stays untouched
  const docTarget = opts.rackId != null ? doc.racks.find((r) => r.id === opts.rackId) : undefined;
  const target: Target = docTarget ? { id: docTarget.id, name: docTarget.name, u: docTarget.u, rack: docTarget } : { id: null, name: opts.newRackName, u: opts.newRackU };
  const named = new Map<string, Target>();
  const rackFor = (name: string | null | undefined): Target | null => {
    if (name === undefined) return target;
    if (name === null) return null;
    const k = low(name);
    if (!named.has(k)) {
      const r = doc.racks.find((x) => low(x.name) === k);
      named.set(k, r ? { id: r.id, name: r.name, u: r.u, rack: r } : { id: null, name, u: opts.newRackU });
    }
    return named.get(k)!;
  };

  let rackU = target.u, needU = 0;
  if (spec.kind === "layout") {
    needU = placeLayout(spec, rackU);
    if (opts.growRack && needU > rackU) { rackU = needU; placeLayout(spec, rackU); }
  }

  const rows: Row[] = [];
  const claimed = new Map<number, number>(); // device id -> line of the row that took it
  const devs = doc.devices;
  const groupSeen = new Map<string, number>();

  const findMatch = (d: ImportDevice, ord: number): { hit: Device | null; conflict: Device[] } => {
    const stages: ((x: Device) => boolean)[] = [];
    let nameStage = -1;
    const f = d.fields;
    if (f.serial) stages.push((x) => !!x.serial && low(x.serial) === low(f.serial));
    if (f.mac && normMac(f.mac)) stages.push((x) => (!!x.mac && normMac(x.mac) === normMac(f.mac!)) || !!x.auvik_macs?.some((m) => normMac(m) === normMac(f.mac!)));
    if (f.hostname || d.name) stages.push((x) => !!x.hostname && (low(x.hostname) === low(f.hostname) || low(x.hostname) === low(d.name)));
    if (d.name) { nameStage = stages.length; stages.push((x) => low(x.name) === low(d.name)); }
    if (spec.kind === "layout") stages.push((x) => (x.name.length >= 4 && hasToken(d.name, x.name)) || (!!x.hostname && x.hostname.length >= 4 && hasToken(d.name, x.hostname)));
    for (let si = 0; si < stages.length; si++) {
      const hits = devs.filter(stages[si]);
      if (hits.length === 1) return { hit: hits[0], conflict: [] };
      if (hits.length > 1) {
        // Repeated names: the rows with that name take the devices in rack order, top of the rack first, off-rack last.
        if (si === nameStage && hits.every((x) => low(x.name) === low(hits[0].name))) {
          const free = hits.filter((x) => !claimed.has(x.id)).sort(rackOrder);
          if (free.length) return { hit: free[0], conflict: [] };
        }
        return { hit: null, conflict: hits };
      }
    }
    if (d.group) {
      const stem = stackStem(d.group);
      const members = devs.filter((x) => stem && memberNo(x.name) != null && stackStem(x.name) === stem).sort((a, b) => memberNo(a.name)! - memberNo(b.name)!);
      if (members[ord] && !claimed.has(members[ord].id)) return { hit: members[ord], conflict: [] };
    }
    return { hit: null, conflict: [] };
  };

  const diffsFor = (d: ImportDevice, m: Device): FieldDiff[] => {
    const out: FieldDiff[] = [];
    for (const [k, v] of Object.entries(d.fields)) {
      const to = String(v ?? "").trim();
      if (!to) continue;
      if (k === "model" && d.modelGuessed && m.model) continue; // a catalog guess never replaces a real model
      const raw = (m as unknown as Record<string, unknown>)[k];
      const from = raw == null ? "" : String(raw).trim();
      if (k === "mac" ? normMac(from) === normMac(to) : from === to) continue;
      if (k === "notes" && from) { // notes are added to, not replaced
        if (from.includes(to)) continue;
        out.push({ field: k, from, to: from + "\n" + to, kept: !!m.locked?.includes(k) });
        continue;
      }
      out.push({ field: k, from, to, kept: !!m.locked?.includes(k) });
    }
    return out;
  };

  // A row moves when its rack, U, side or face differs; anything the row leaves unspecified is ignored.
  const moved = (d: ImportDevice, m: Device): boolean => {
    if (spec.kind !== "layout" && d.rack === undefined && d.u == null) return false; // no position given: fields only, never a move
    const r = rackFor(d.rack);
    if (r === null) return m.rack !== null;
    if (r.id === null || m.rack !== r.id) return true;
    if (d.u != null && d.u !== m.u) return true;
    if (d.side != null && d.side !== (m.side ?? 0)) return true;
    return d.face != null && d.face !== (m.face || "front") && !(d.face === "front" && m.face === "both"); // a faceplate device is stored as "both"
  };

  const finish = (row: Row): Row => {
    const m = row.match!;
    row.diffs = diffsFor(row.dev, m);
    row.action = moved(row.dev, m) ? "move" : row.diffs.some((x) => !x.kept) ? "change" : "same";
    row.on = row.action !== "same";
    return row;
  };

  const pending: Row[] = [];
  spec.devices.forEach((d, i) => {
    if (d.kind === "empty") return;
    const id = "r" + i;
    if (d.kind === "note") {
      const notes = rackFor(d.rack)?.rack?.notes || "";
      const same = notes.split(/\r?\n/).some((l) => l.trim() === d.name.trim());
      rows.push({ id, dev: d, match: null, action: same ? "same" : "add", diffs: [], on: !same });
      return;
    }
    const gk = d.group ? low(d.rack === undefined ? "" : String(d.rack)) + "|" + d.group : "";
    const ord = d.group ? groupSeen.get(gk) ?? 0 : 0;
    if (d.group) groupSeen.set(gk, ord + 1);
    const { hit, conflict } = findMatch(d, ord);
    if (conflict.length) {
      rows.push({ id, dev: d, match: null, action: "add", diffs: [], on: false, reason: "Matches more than one device: " + conflict.map((x) => x.name).join(", ") });
      return;
    }
    if (!hit) {
      const row: Row = { id, dev: d, match: null, action: "add", diffs: [], on: true };
      rows.push(row);
      pending.push(row);
      return;
    }
    if (claimed.has(hit.id)) {
      rows.push({ id, dev: d, match: null, action: "add", diffs: [], on: false, reason: "Same device as line " + claimed.get(hit.id) });
      return;
    }
    claimed.set(hit.id, d.line);
    rows.push(finish({ id, dev: d, match: hit, action: "same", diffs: [], on: false }));
  });

  // Possible matches: a UPS / PDU row with exactly one unmatched device of that type in the target rack or off-rack.
  for (const row of pending) {
    const d = row.dev;
    if (d.type !== "UPS" && d.type !== "PDU") continue;
    const cands = devs.filter((x) => !claimed.has(x.id) && x.type === d.type && (x.rack === null || x.rack === target.id));
    if (cands.length !== 1) continue;
    const c = cands[0];
    const a = brandWords(d.name, d.fields.model, d.fields.manufacturer), b = brandWords(c.name, c.model, c.manufacturer, c.auvik_model);
    if (![...a].some((w) => b.has(w))) continue;
    claimed.set(c.id, d.line);
    row.match = c;
    finish(row);
    row.on = false;
    row.reason = POSSIBLE_REASON;
  }

  const racks = new Set<number>();
  if (target.id != null) racks.add(target.id);
  for (const r of named.values()) if (r.id != null) racks.add(r.id);
  const notInImport = devs.filter((x) => x.rack != null && racks.has(x.rack) && !claimed.has(x.id));
  return { rows, notInImport, links: spec.links, racks: spec.racks.map((r) => ({ ...r })), needU, rackU };
}
