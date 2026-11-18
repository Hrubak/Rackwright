// CSV / TSV / semicolon reader. Ported from RackMap parseDelimited, looksDelimited and csvToSpec.
import { devFrom, nk } from "./spec";
import type { ImportLink, ImportSpec } from "./spec";

const stripBom = (s: string) => String(s).replace(/^﻿/, "");

interface Row { cells: string[]; line: number }
function readRows(text: string): Row[] {
  const s = stripBom(text);
  const first = s.split(/\r?\n/).find((l) => l.trim()) || "";
  const n = (re: RegExp) => (first.match(re) || []).length;
  const delim = n(/\t/g) > n(/,/g) ? "\t" : n(/;/g) > n(/,/g) ? ";" : ",";
  const rows: Row[] = [];
  let row: string[] = [], cell = "", q = false, line = 1, start = 1;
  const endRow = () => {
    row.push(cell);
    if (row.some((c) => c.trim())) rows.push({ cells: row, line: start });
    row = []; cell = "";
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else { if (ch === "\n") line++; cell += ch; }
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      endRow(); line++; start = line;
    } else cell += ch;
  }
  endRow();
  return rows;
}

export function parseDelimited(text: string): string[][] {
  return readRows(text).map((r) => r.cells);
}

export function looksDelimited(text: string): boolean {
  const lines = stripBom(text).split(/\r?\n/).filter((l) => l.trim()).slice(0, 6);
  if (lines.length < 2) return false;
  const cnt = (l: string) => Math.max((l.match(/,/g) || []).length, (l.match(/\t/g) || []).length, (l.match(/;/g) || []).length);
  const c0 = cnt(lines[0]);
  if (c0 < 1) return false;
  const hdr = nk(lines[0]);
  return /name|device|hostname|from|source|model|serial/.test(hdr) && lines.slice(1).filter((l) => Math.abs(cnt(l) - c0) <= 1).length >= Math.ceil((lines.length - 1) * 0.6);
}

export function csvToSpec(text: string): ImportSpec {
  const rows = readRows(text);
  const spec: ImportSpec = { kind: "inventory", racks: [], devices: [], links: [], notes: [], warnings: [] };
  if (rows.length < 2) { spec.warnings.push("The file has no data rows."); return spec; }
  const H = rows[0].cells.map((h) => h.trim()), K = H.map(nk);
  const col = (...names: string[]) => { for (const n of names) { const i = K.indexOf(n); if (i >= 0) return i; } return -1; };
  const fromI = col("fromdevice", "from", "source", "sourcedevice", "adevice", "sidea", "devicea", "enda");
  const toI = col("todevice", "to", "destination", "dest", "target", "destdevice", "bdevice", "sideb", "deviceb", "endb");
  const data = rows.slice(1);
  if (fromI >= 0 && toI >= 0) {
    spec.kind = "cabling";
    const fp = col("fromport", "sourceport", "aport", "porta", "fromportname", "fromintf", "frominterface");
    const tp = col("toport", "destport", "destinationport", "bport", "portb", "targetport", "tointerface");
    const ci = col("cable", "cabletype", "media", "type"), li = col("label", "cableid", "cablelabel", "tag", "id"), le = col("length", "len"), co = col("color", "colour");
    for (const { cells: r } of data) {
      let a = (r[fromI] || "").trim(), b = (r[toI] || "").trim();
      let ap = fp >= 0 ? (r[fp] || "").trim() : "", bp = tp >= 0 ? (r[tp] || "").trim() : "";
      if (!ap && a.includes(":")) { ap = a.slice(a.indexOf(":") + 1); a = a.slice(0, a.indexOf(":")); }
      if (!bp && b.includes(":")) { bp = b.slice(b.indexOf(":") + 1); b = b.slice(0, b.indexOf(":")); }
      if (!a || !b) continue;
      const l: ImportLink = { a, ap, b, bp };
      const set = (k: "type" | "label" | "length" | "color", i: number) => { const v = i >= 0 ? (r[i] || "").trim() : ""; if (v) l[k] = v; };
      set("type", ci); set("label", li); set("length", le); set("color", co);
      spec.links.push(l);
    }
    return spec;
  }
  const nameI = col("name", "device", "devicename", "hostname", "host", "equipment", "asset");
  if (nameI < 0) { spec.warnings.push("Couldn’t find a Name / Device / Hostname column."); return spec; }
  const rackI = col("rack", "rackname", "cabinet"), conI = col("connectedto", "connections");
  for (const { cells: r, line } of data) {
    const pairs = H.map((h, i) => [h, r[i]] as [string, string]).filter((_, i) => i !== conI && K[i] !== "room");
    // make sure the chosen name column wins over other name-ish columns
    pairs.sort((x, y) => (nk(x[0]) === K[nameI] ? -1 : 0) - (nk(y[0]) === K[nameI] ? -1 : 0));
    const d = devFrom(pairs, { line });
    if (!d.name) continue;
    if (rackI >= 0) { const rv = (r[rackI] || "").trim(); d.rack = /^unracked$/i.test(rv) || !rv ? null : rv; }
    if (d.rack && !spec.racks.some((x) => x.name.toLowerCase() === d.rack!.toLowerCase())) spec.racks.push({ name: d.rack, u: null });
    spec.devices.push(d);
  }
  return spec;
}
