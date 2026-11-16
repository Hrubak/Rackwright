// Pure detection of parallel cable runs that can be drawn as one harness.
// Two cables bundle where they run along the same axis in adjacent lanes
// (fixed coordinate differs by at most GAP) and overlap for at least MIN_OVERLAP.
export interface RouteLike { cable: number; pts: [number, number][] }
export interface Bundle {
  axis: "v" | "h";      // v: vertical run (fixed = x, span = y); h: horizontal (fixed = y, span = x)
  fixedMin: number; fixedMax: number; // outer lane coordinates
  lo: number; hi: number;             // extent along the run
  cables: number[];
}
export const GAP = 6, MIN_OVERLAP = 30;

interface Seg { cable: number; axis: "v" | "h"; fixed: number; lo: number; hi: number }

export function segmentsOf(routes: RouteLike[]): Seg[] {
  const out: Seg[] = [];
  for (const r of routes) {
    for (let i = 1; i < r.pts.length; i++) {
      const [x0, y0] = r.pts[i - 1], [x1, y1] = r.pts[i];
      if (x0 === x1 && y0 !== y1) out.push({ cable: r.cable, axis: "v", fixed: x0, lo: Math.min(y0, y1), hi: Math.max(y0, y1) });
      else if (y0 === y1 && x0 !== x1) out.push({ cable: r.cable, axis: "h", fixed: y0, lo: Math.min(x0, x1), hi: Math.max(x0, x1) });
    }
  }
  return out;
}

export function findBundles(routes: RouteLike[]): Bundle[] {
  const segs = segmentsOf(routes), out: Bundle[] = [];
  for (const axis of ["v", "h"] as const) {
    const s = segs.filter((x) => x.axis === axis);
    // union-find over segments linked by "adjacent lane + enough overlap"
    const par = s.map((_, i) => i);
    const find = (i: number): number => (par[i] === i ? i : (par[i] = find(par[i])));
    for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) {
      if (s[i].cable === s[j].cable) continue;
      if (Math.abs(s[i].fixed - s[j].fixed) > GAP) continue;
      if (Math.min(s[i].hi, s[j].hi) - Math.max(s[i].lo, s[j].lo) < MIN_OVERLAP) continue;
      par[find(i)] = find(j);
    }
    const groups = new Map<number, Seg[]>();
    s.forEach((x, i) => { const k = find(i); (groups.get(k) ?? groups.set(k, []).get(k)!).push(x); });
    for (const g of groups.values()) {
      if (new Set(g.map((x) => x.cable)).size < 2) continue;
      // sweep along the run: keep stretches where at least two lanes are present
      const cuts = [...new Set(g.flatMap((x) => [x.lo, x.hi]))].sort((a, b) => a - b);
      const spans: { lo: number; hi: number; m: Seg[] }[] = [];
      for (let k = 1; k < cuts.length; k++) {
        const a = cuts[k - 1], b = cuts[k];
        const m = g.filter((x) => x.lo <= a && x.hi >= b);
        if (new Set(m.map((x) => x.cable)).size < 2) continue;
        const last = spans[spans.length - 1];
        if (last && last.hi === a) { last.hi = b; for (const x of m) if (!last.m.includes(x)) last.m.push(x); }
        else spans.push({ lo: a, hi: b, m: [...m] });
      }
      for (const sp of spans) {
        if (sp.hi - sp.lo < MIN_OVERLAP) continue;
        const f = sp.m.map((x) => x.fixed);
        out.push({ axis, fixedMin: Math.min(...f), fixedMax: Math.max(...f), lo: sp.lo, hi: sp.hi, cables: [...new Set(sp.m.map((x) => x.cable))].sort((a, b) => a - b) });
      }
    }
  }
  return out;
}
