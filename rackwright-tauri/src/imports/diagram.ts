// Turns diagram models (Visio, SVG, picture readers) into an ImportSpec. Port of RackMap diagramToSpec.
import type { ImportDevice, ImportLink, ImportRack, ImportSpec } from "./spec";
import { devFrom, guessType, nk } from "./spec";

export interface DiagramNode { id: string; title: string; label: string; data: Record<string, string>; x: number; y: number; w: number; h: number }
export interface DiagramLink { a: string; b: string; text: string }
export interface DiagramModel { source: string; nodes: DiagramNode[]; links: DiagramLink[]; yUp: boolean; words?: number }

const RACK_RE = /\b(rack|cabinet|enclosure)\b/i;
const END_USER_RE = /\b(pc|workstation|desktop|laptop|notebook|printer|mfp|copier|phone|ip ?phone|voip|tablet|users?|camera|tv|display|monitor|client)\b/i;
const NON_DEVICE_RE = /connector|\bline\b|arrow|callout|legend|title|^text|annotation|container|swimlane|border|background|frame|banner|^page|cloud|internet|^sheet|^rectangle|^ellipse|^circle|^square|^triangle|^box/i;
const IP_RE = /\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b/;

const nodeLines = (n: DiagramNode): string[] => String(n.label || "").split("\n").map((t) => t.trim()).filter(Boolean);

export function diagramToSpec(input: DiagramModel[], opts: { endUsers: boolean }): ImportSpec {
  const models = [...input].sort((a, b) => (b.yUp ? 1 : 0) - (a.yUp ? 1 : 0)); // Visio pages first: they carry shape data and port labels
  const racks: ImportRack[] = [], devices: ImportDevice[] = [], links: ImportLink[] = [];
  const byKey = new Map<string, ImportDevice>();
  const used = new Set<ImportLink>(), matched = new Set<ImportLink>();
  let skippedUsers = 0, skippedOther = 0;

  models.forEach((md) => {
    const linked = new Set(md.links.flatMap((l) => [l.a, l.b]));
    const rackNodes = md.nodes.filter((n) => RACK_RE.test(n.title + " " + n.label) && n.h > n.w * 1.3);
    const rks = rackNodes.map((n, i) => {
      const lines = nodeLines(n);
      const um = (n.label + " " + Object.values(n.data || {}).join(" ")).match(/\b(\d{1,2})\s*U\b/i);
      let units = um ? +um[1] : 0;
      if (!units && md.yUp) { const est = Math.round(n.h / 1.75); if (est >= 6 && est <= 60) units = est; }
      units = units || 42;
      const name = (lines.find((l) => !/^\d{1,2}\s*U$/i.test(l)) || "RACK-" + String(i + 1).padStart(2, "0")).slice(0, 40);
      return { n, name, units };
    });
    rks.forEach((r) => { if (!racks.some((x) => nk(x.name) === nk(r.name))) racks.push({ name: r.name, u: r.units }); });

    const idToName = new Map<string, string>();
    md.nodes.forEach((n, i) => {
      if (rackNodes.includes(n)) return;
      const lines = nodeLines(n), dataPairs = Object.entries(n.data || {});
      const hay = [n.title, ...lines, ...Object.values(n.data || {})].join(" ");
      const t = guessType(n.title, lines[0], n.data?.["Product Description"] || n.data?.["Device Type"] || n.data?.["Type"], hay);
      if (/^(the )?internet$|^cloud$/i.test(lines[0] || "") || /cloud|internet/i.test(n.title)) { skippedOther++; return; }
      if (END_USER_RE.test(n.title + " " + (lines[0] || "")) && (!t || t === "Other") && !opts.endUsers) { skippedUsers++; return; }
      const hostLike = !!lines[0] && lines[0].length <= 40 && !/\s/.test(lines[0]) && /[a-z]/i.test(lines[0]) && (/\d/.test(lines[0]) || /[-_]/.test(lines[0]));
      if (!t && !dataPairs.length && !(linked.has(n.id) && lines.length) && !hostLike) { skippedOther++; return; }
      if (!t && NON_DEVICE_RE.test(n.title) && !dataPairs.length && !linked.has(n.id)) { skippedOther++; return; }
      const dn = dataPairs.find(([k]) => /^(network name|host ?name|device name|name|asset (name|number))$/i.test(k));
      let name = (dn && dn[1]) || lines.find((l) => !IP_RE.test(l) && !/^(vlan|mac|s\/?n|serial)\b/i.test(l) && l.length <= 48) || "";
      if (!name) name = ((t || "Other").split(" ")[0] + "-" + (i + 1)).toUpperCase();
      name = name.replace(/\s+/g, " ").trim();
      const pairs: [string, string][] = [...dataPairs];
      const ip = (lines.join(" ").match(IP_RE) || [])[0];
      if (ip && !dataPairs.some(([k]) => /ip/i.test(k))) pairs.push(["ip", ip.replace(/\/\d+$/, "")]);
      const rest = lines.filter((l) => l !== name && !(ip && l.includes(ip)));
      const d = devFrom(pairs, { name, type: t || null, line: i + 1 });
      if (rest.length && !d.fields.role) d.fields.role = rest.join(" · ").slice(0, 160);
      d.rack = undefined; d.u = null; d.height = null; // devFrom may read a rack/u from shape data; geometry decides here
      const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
      const rk = rks.find((r) => cx >= r.n.x && cx <= r.n.x + r.n.w && cy >= r.n.y && cy <= r.n.y + r.n.h);
      if (rk) {
        const us = rk.n.h / rk.units;
        const fromBottom = md.yUp ? n.y - rk.n.y : rk.n.y + rk.n.h - (n.y + n.h);
        d.rack = rk.name;
        d.u = Math.max(1, Math.min(rk.units, Math.round(fromBottom / us) + 1));
        d.height = Math.max(1, Math.min(rk.units, Math.round(n.h / us)));
      }
      const key = nk(d.name);
      idToName.set(n.id, d.name);
      const ex = byKey.get(key);
      if (ex) {
        for (const [k, v] of Object.entries(d.fields)) if (v && !(ex.fields as Record<string, unknown>)[k]) (ex.fields as Record<string, unknown>)[k] = v;
        for (const [k, v] of Object.entries(d.specs)) if (!ex.specs[k]) ex.specs[k] = v;
        if (ex.rack === undefined && d.rack) { ex.rack = d.rack; ex.u = d.u; ex.height = d.height; }
        if ((!ex.type || ex.type === "Other") && d.type && d.type !== "Other") ex.type = d.type;
      } else { byKey.set(key, d); devices.push(d); }
    });

    md.links.forEach((l) => {
      const A = idToName.get(l.a), B = idToName.get(l.b);
      if (!A || !B || A === B) return;
      const parts = String(l.text || "").split(/\s*(?:<->|<-->|->|→|↔|–|—|\s-\s|\bto\b)\s*/i).map((s) => s.trim()).filter(Boolean);
      const portish = (s: string) => !!s && s.length <= 24 && /\d/.test(s);
      const ap = parts.length === 2 && portish(parts[0]) ? parts[0] : "", bp = parts.length === 2 && portish(parts[1]) ? parts[1] : "";
      const label = !ap && parts.length === 1 && parts[0].length <= 30 ? parts[0] : "";
      // the same cable often appears in several files (Visio with port labels, SVG without): merge, don't duplicate
      const same = (x: ImportLink) => (nk(x.a) === nk(A) && nk(x.b) === nk(B)) || (nk(x.a) === nk(B) && nk(x.b) === nk(A));
      const portsOf = (x: ImportLink) => (nk(x.a) === nk(A) ? [x.ap, x.bp] : [x.bp, x.ap]);
      if (links.find((x) => same(x) && ap && portsOf(x)[0] === ap && portsOf(x)[1] === bp)) return;
      const bare = links.find((x) => same(x) && !x.ap && !x.bp && !used.has(x));
      if (bare) {
        if (ap) { if (nk(bare.a) === nk(A)) { bare.ap = ap; bare.bp = bp; } else { bare.ap = bp; bare.bp = ap; } }
        used.add(bare);
        if (label && !bare.label) bare.label = label;
        return;
      }
      if (!ap && links.some(same)) { const un = links.find((x) => same(x) && x.ap && !matched.has(x)); if (un) { matched.add(un); return; } }
      const nl: ImportLink = { a: A, ap, b: B, bp };
      if (label) nl.label = label;
      links.push(nl);
      if (ap) used.add(nl);
    });
  });

  const warnings: string[] = [];
  if (skippedUsers) warnings.push(`Left out ${skippedUsers} end-user device(s) (PCs, printers, phones…). Tick “Include end-user devices” to bring them in.`);
  if (skippedOther) warnings.push(`Ignored ${skippedOther} shape(s) that look like labels, titles, clouds or decoration.`);
  return { kind: "diagram", racks, devices, links, notes: [], warnings };
}
