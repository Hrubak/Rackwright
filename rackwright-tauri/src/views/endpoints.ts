// One flat list of every endpoint in the document. Pure.
import type { Doc } from "../types";
import { portOf } from "../edit";
import { EpKind, kindOf } from "./kinds";

export interface EpRow {
  key: string; name: string; kind: EpKind; type: string; model: string; ip: string; mac: string;
  switch: string; port: string; status: string; devId: number | null; source: "group" | "vm" | "unplaced";
}
export type EpSort = "name" | "kind" | "type" | "model" | "ip" | "mac" | "switch" | "port" | "status";

export function flattenEndpoints(doc: Doc): EpRow[] {
  const rows: EpRow[] = [];
  const byId = new Map(doc.devices.map((d) => [d.id, d]));
  const farOf = (pid: number) => {
    const c = doc.cables.find((x) => x.a === pid || x.b === pid);
    return c ? portOf(doc, c.a === pid ? c.b : c.a) : null;
  };
  for (const d of doc.devices) {
    if (d.type !== "Endpoints" && d.type !== "Virtual machines") continue;
    const vm = d.type === "Virtual machines";
    const host = vm && d.vm_host != null ? byId.get(d.vm_host) : undefined;
    // The switch a whole group is cabled to, for members whose own port is not cabled.
    let groupSw = "";
    if (!vm) for (const q of d.ports) { const f = farOf(q.id); if (f) { groupSw = f.d.name; break; } }
    (d.endpoints || []).forEach((e, i) => {
      let sw = vm ? host?.name || "" : groupSw, port = e.port || "";
      if (!vm) {
        const p = d.ports.find((x) => x.name === e.name) ?? d.ports[i];
        const f = p ? farOf(p.id) : null;
        if (f) { sw = f.d.name; port = f.p.name || port; }
      }
      rows.push({
        key: `${d.id}:${i}`, name: e.name, kind: vm && !e.kind ? "vm" : kindOf(e), type: e.type || "", model: e.model || "", ip: e.ip || "", mac: e.mac || "",
        switch: sw, port, status: e.status || "", devId: d.id, source: vm ? "vm" : "group",
      });
    });
  }
  (doc.auvik?.unplaced || []).forEach((u, i) => rows.push({
    key: `u:${i}`, name: u.name, kind: kindOf(u), type: u.type || "", model: u.model || "", ip: u.ip || "", mac: u.mac || "",
    switch: "", port: "", status: u.status || "", devId: null, source: "unplaced",
  }));
  return rows;
}

const ipKey = (s: string) => (s.match(/\d+/g) || []).map((n) => n.padStart(5, "0")).join(".");
export function sortEndpoints(rows: EpRow[], by: EpSort, dir: 1 | -1 = 1): EpRow[] {
  const k = (r: EpRow) => (by === "ip" ? ipKey(r.ip) : (r[by] as string).toLowerCase());
  return rows.slice().sort((a, b) => {
    const x = k(a), y = k(b);
    if (!x !== !y) return x ? -1 : 1; // empty values go last whichever way we sort
    return (x < y ? -1 : x > y ? 1 : 0) * dir || a.name.localeCompare(b.name, undefined, { numeric: true });
  });
}

export function filterEndpoints(rows: EpRow[], kinds: Set<EpKind>, text: string): EpRow[] {
  const t = text.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (kinds.size && !kinds.has(r.kind)) return false;
    const hay = `${r.name} ${r.kind} ${r.type} ${r.model} ${r.ip} ${r.mac} ${r.switch} ${r.port} ${r.status}`.toLowerCase();
    return t.every((w) => hay.includes(w));
  });
}

export function endpointsCsv(rows: EpRow[]): string {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = ["Name", "Kind", "Type", "Model", "IP", "MAC", "Switch", "Port", "Status"];
  return [head, ...rows.map((r) => [r.name, r.kind, r.type, r.model, r.ip, r.mac, r.switch, r.port, r.status])].map((l) => l.map(q).join(",")).join("\n");
}
