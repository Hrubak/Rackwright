// Auvik "Devices" sheet rows -> devices and their neighbour links. Pure; no file or DOM access.
import type { Sheets } from "./xlsx";

export interface Neighbor { name: string; iface: string }
export interface AuvikDevice {
  name: string;          // display name (made unique when two different devices share one)
  rawName: string;       // name as exported (neighbours refer to this)
  unnamed: boolean;      // "Device@192.0.2.10"
  org: string; status: string; type: string; model: string;
  macs: string[]; ips: string[]; networks: string;
  neighbors: Neighbor[]; // "<name> through <interface of that neighbour>"
  software: string; serial: string; firmware: string; description: string;
  apiId?: string; hostname?: string;
  rows: number;          // export rows merged into this device
}
export interface ParsedAuvik { site: string; devices: AuvikDevice[]; warnings: string[] }

const HEADERS: Record<string, string[]> = {
  org: ["organization name"], status: ["status"], name: ["device name"], type: ["type"], model: ["make & model", "make and model"],
  mac: ["mac address(es)", "mac addresses", "mac address"], ip: ["ip address(es)", "ip addresses", "ip address"], networks: ["network(s)", "networks"],
  conn: ["connected to"], sw: ["software version"], serial: ["serial number"], fw: ["firmware version"], desc: ["description"],
};

const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
export const normMac = (m: string) => m.toLowerCase().replace(/[^0-9a-f]/g, "");

/** "A through X, B through Y". Splits on commas only where the next piece still holds " through ". */
export function parseConnected(s: string): Neighbor[] {
  const v = (s || "").trim();
  if (!v || v === "0") return [];
  const parts: string[] = [];
  for (const p of v.split(",")) {
    if (parts.length && !/ through /i.test(p)) parts[parts.length - 1] += "," + p;
    else parts.push(p);
  }
  const out: Neighbor[] = [];
  for (const p of parts) {
    const i = p.toLowerCase().lastIndexOf(" through ");
    if (i < 0) { const n = p.trim(); if (n && n !== "0") out.push({ name: n, iface: "" }); continue; }
    out.push({ name: p.slice(0, i).trim(), iface: p.slice(i + 9).trim() });
  }
  return out;
}

export function parseAuvik(sheets: Sheets): ParsedAuvik {
  const warnings: string[] = [];
  const sh = sheets.find((s) => s.name.trim().toLowerCase() === "devices");
  if (!sh) throw new Error('This file has no "Devices" sheet. Export the device list from Auvik as .xlsx.');
  const hi = sh.rows.findIndex((r, i) => i < 6 && r.some((c) => (c || "").trim().toLowerCase() === "device name"));
  if (hi < 0) {
    if (sh.rows.some((r) => /no data available/i.test(r.join(" ")))) throw new Error("The Devices sheet is empty.");
    throw new Error('The Devices sheet has no "Device Name" column.');
  }
  const head = sh.rows[hi].map((c) => (c || "").trim().toLowerCase());
  const col: Record<string, number> = {};
  for (const [k, names] of Object.entries(HEADERS)) col[k] = head.findIndex((h) => names.includes(h));
  const get = (r: string[], k: string) => (col[k] >= 0 ? (r[col[k]] ?? "").trim() : "");

  const devices: AuvikDevice[] = [];
  const used = new Map<string, number>();
  for (const r of sh.rows.slice(hi + 1)) {
    if (!r.some((c) => (c || "").trim())) continue;
    const rawName = get(r, "name");
    if (!rawName || /^no data available/i.test(rawName)) continue;
    const d: AuvikDevice = {
      name: rawName, rawName, unnamed: /@\d+\.\d+\.\d+\.\d+/.test(rawName), org: get(r, "org"), status: get(r, "status") || "Up", type: get(r, "type"),
      model: get(r, "model"), macs: split(get(r, "mac")), ips: split(get(r, "ip")), networks: get(r, "networks"),
      neighbors: parseConnected(get(r, "conn")), software: get(r, "sw"), serial: get(r, "serial"), firmware: get(r, "fw"), description: get(r, "desc"), rows: 1,
    };
    // Same name AND (same serial or a shared MAC) = the same device listed twice. Otherwise keep both.
    const dup = devices.find((o) => o.rawName.toLowerCase() === rawName.toLowerCase() && (
      (o.serial && o.serial === d.serial) || o.macs.some((m) => d.macs.some((n) => normMac(m) === normMac(n))) ||
      (!o.serial && !d.serial && !o.macs.length && !d.macs.length && o.ips.join() === d.ips.join() && o.type === d.type)));
    if (dup) {
      dup.rows++;
      if (/^up$/i.test(d.status) && !/^up$/i.test(dup.status)) dup.status = d.status;
      for (const m of d.macs) if (!dup.macs.some((x) => normMac(x) === normMac(m))) dup.macs.push(m);
      for (const i of d.ips) if (!dup.ips.includes(i)) dup.ips.push(i);
      for (const n of d.neighbors) if (!dup.neighbors.some((x) => x.name === n.name && x.iface === n.iface)) dup.neighbors.push(n);
      for (const k of ["serial", "model", "software", "firmware", "description", "type", "networks"] as const) if (!dup[k] && d[k]) dup[k] = d[k];
      continue;
    }
    const k = rawName.toLowerCase();
    const n = (used.get(k) || 0) + 1;
    used.set(k, n);
    if (n > 1) { d.name = `${rawName} (${n})`; warnings.push(`"${rawName}" appears more than once with different details; kept as "${d.name}".`); }
    devices.push(d);
  }
  if (!devices.length) throw new Error("The Devices sheet has no devices.");
  const org = devices.find((d) => d.org)?.org || "";
  const site = org || sheets.find((s) => s.name.toLowerCase() === "sites")?.rows.slice(2).map((r) => r[0]).find((x) => x && !/no data/i.test(x)) || "Auvik import";
  return { site, devices, warnings };
}
