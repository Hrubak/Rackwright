// Site-links diagram: pure SVG, shared by the Links screen and the client report.
import { v } from "../theme";
import { useMemo } from "react";
import type { Doc } from "../types";
import type { ClientItem, LinkItem, SiteItem } from "./store";
import { layoutSites, linkColor, linkLabel } from "./util";

export const W = 1000, H = 560;
const BW = 210, BH = 76, CW = 190, CH = 70;

/** Point where the line from the box centre towards `to` leaves the box. */
function edge(c: { x: number; y: number }, to: { x: number; y: number }, hw: number, hh: number) {
  const dx = to.x - c.x, dy = to.y - c.y;
  if (!dx && !dy) return c;
  const s = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

const cloud = (x: number, y: number) =>
  `M${x - 70},${y + 26} C${x - 100},${y + 26} ${x - 100},${y - 8} ${x - 66},${y - 8} C${x - 66},${y - 40} ${x - 20},${y - 44} ${x - 4},${y - 22} C${x + 14},${y - 44} ${x + 62},${y - 36} ${x + 58},${y - 6} C${x + 98},${y - 8} ${x + 100},${y + 26} ${x + 66},${y + 26} Z`;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** Links whose ends are both known sites (or the Internet). */
export const shownLinks = (client: ClientItem): LinkItem[] => {
  const ids = new Set(client.sites.map((s) => s.id));
  return client.links.filter((l) => ids.has(l.site_a) && (l.site_b == null || ids.has(l.site_b)));
};

export default function LinksDiagram({ client, docs, sel = null, onPick }: {
  client: ClientItem;
  docs: Record<string, Doc | string>;
  sel?: number | null;
  onPick?: (l: LinkItem) => void;
}) {
  const links = useMemo(() => shownLinks(client), [client]);
  const siteName = (id: number | null) => (id == null ? "Internet / provider" : client.sites.find((s) => s.id === id)?.name ?? "?");
  const hasNet = links.some((l) => l.site_b == null);
  const lay = useMemo(() => layoutSites(client.sites.map((s) => s.id), hasNet, W, H), [client, hasNet]);
  const counts = (s: SiteItem) => {
    let devs = 0;
    for (const r of s.racks) { const d = docs[r.key]; if (typeof d === "object") devs += d.devices.length; }
    return `${s.racks.length} rack${s.racks.length === 1 ? "" : "s"}, ${devs} device${devs === 1 ? "" : "s"}`;
  };
  // Parallel links between the same pair are spread out.
  const geo = useMemo(() => {
    const groups = new Map<string, LinkItem[]>();
    for (const l of links) { const k = [l.site_a, l.site_b ?? "net"].sort().join("-"); groups.set(k, [...(groups.get(k) ?? []), l]); }
    const out = new Map<number, { a: { x: number; y: number }; b: { x: number; y: number }; m: { x: number; y: number }; ta: { x: number; y: number }; tb: { x: number; y: number } }>();
    for (const g of groups.values()) g.forEach((l, i) => {
      const ca = lay.sites[l.site_a], cb = l.site_b == null ? lay.internet : lay.sites[l.site_b];
      if (!ca || !cb) return;
      const dx = cb.x - ca.x, dy = cb.y - ca.y, len = Math.hypot(dx, dy) || 1;
      const off = (i - (g.length - 1) / 2) * 30;
      const ox = (-dy / len) * off, oy = (dx / len) * off;
      const A = { x: ca.x + ox, y: ca.y + oy }, B = { x: cb.x + ox, y: cb.y + oy };
      const a = edge(A, B, BW / 2, BH / 2);
      const b = edge(B, A, l.site_b == null ? CW / 2 : BW / 2, l.site_b == null ? CH / 2 : BH / 2);
      const ux = dx / len, uy = dy / len;
      out.set(l.id, { a, b, m: l.site_b == null ? { x: a.x + (b.x - a.x) * 0.7, y: a.y + (b.y - a.y) * 0.7 } : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, ta: { x: a.x + ux * 12, y: a.y + uy * 12 }, tb: { x: b.x - ux * 12, y: b.y - uy * 12 } });
    });
    return out;
  }, [links, lay]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 1100, height: "auto", background: v("bg"), border: `1px solid ${v("border-subtle")}`, borderRadius: 6, display: "block", fontFamily: "system-ui, sans-serif" }}>
      <g>
        {links.map((l) => {
          const g = geo.get(l.id); if (!g) return null;
          const c = linkColor(l.kind), on = sel === l.id;
          const label = linkLabel(l), lw = Math.max(60, label.length * 6.6 + 14);
          return (
            <g key={l.id} style={{ cursor: onPick ? "pointer" : undefined }} onClick={onPick ? () => onPick(l) : undefined}>
              <line x1={g.a.x} y1={g.a.y} x2={g.b.x} y2={g.b.y} stroke="transparent" strokeWidth={16} />
              <line x1={g.a.x} y1={g.a.y} x2={g.b.x} y2={g.b.y} stroke={c} strokeWidth={on ? 4.5 : 2.5} strokeDasharray={l.kind === "VPN" ? "8 5" : undefined} />
              <rect x={g.m.x - lw / 2} y={g.m.y - 11} width={lw} height={22} rx={11} fill={v("panel")} stroke={c} strokeWidth={on ? 2 : 1} />
              <text x={g.m.x} y={g.m.y + 4} textAnchor="middle" fontSize={12} fill={v("text")}>{label}</text>
              {l.a_end && <text x={g.ta.x} y={g.ta.y} textAnchor="middle" fontSize={11} fill={v("link-end-text")} stroke={v("bg")} strokeWidth={3} paintOrder="stroke">{clip(l.a_end.name, 18)}</text>}
              {l.b_end && <text x={g.tb.x} y={g.tb.y} textAnchor="middle" fontSize={11} fill={v("link-end-text")} stroke={v("bg")} strokeWidth={3} paintOrder="stroke">{clip(l.b_end.name, 18)}</text>}
              <title>{`${siteName(l.site_a)} to ${siteName(l.site_b)}: ${label}${l.provider ? `, ${l.provider}` : ""}${l.circuit ? `, circuit ${l.circuit}` : ""}`}</title>
            </g>
        );
      })}
      {lay.internet && (
        <g>
          <path d={cloud(lay.internet.x, lay.internet.y)} fill={v("cloud-fill")} stroke={v("accent-border")} strokeWidth={1.5} />
          <text x={lay.internet.x} y={lay.internet.y + 5} textAnchor="middle" fontSize={14} fill={v("text")}>Internet</text>
        </g>
      )}
      {client.sites.map((s) => {
        const p = lay.sites[s.id]; if (!p) return null;
        return (
          <g key={s.id}>
            <rect x={p.x - BW / 2} y={p.y - BH / 2} width={BW} height={BH} rx={10} fill={v("card")} stroke={v("diagram-edge")} strokeWidth={1.5} />
            <text x={p.x} y={p.y - 10} textAnchor="middle" fontSize={14} fontWeight={600} fill={v("text")}>{clip(s.name, 24)}</text>
            {s.address && <text x={p.x} y={p.y + 8} textAnchor="middle" fontSize={11} fill={v("text-muted-alt")}>{clip(s.address, 32)}</text>}
            <text x={p.x} y={p.y + 25} textAnchor="middle" fontSize={11} fill={v("diagram-subtext")}>{counts(s)}</text>
          </g>
        );
      })}
      </g>
    </svg>
  );
}
