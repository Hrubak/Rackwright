// Pure version comparison for update banners. No backend imports.
export type Release = { tag_name: string; draft: boolean; prerelease: boolean; html_url: string; published_at: string };

const parts = (v: string): number[] =>
  v.trim().replace(/^v/i, "").split(".").map((p) => { const n = parseInt(p, 10); return Number.isFinite(n) ? n : 0; });

export function cmpVer(a: string, b: string): number {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

export function newestDesktop(releases: Release[], current: string, skip: string | null): { version: string; url: string } | null {
  let best: { version: string; url: string } | null = null;
  for (const r of releases) {
    if (r.draft || r.prerelease || !r.tag_name.startsWith("desktop-v")) continue;
    const version = r.tag_name.slice("desktop-v".length);
    if (cmpVer(version, current) <= 0) continue;
    if (skip && cmpVer(version, skip) === 0) continue;
    if (!best || cmpVer(version, best.version) > 0) best = { version, url: r.html_url };
  }
  return best;
}

export const serverNewer = (server: string, page: string): boolean => cmpVer(server, page) > 0;

export function adminOffer(check: { version: string; latest_version: string; update_available: boolean }): string | null {
  if (!check.update_available) return null;
  return cmpVer(check.latest_version, check.version) > 0 ? check.latest_version : null;
}

export function due(lastIso: string | null, now: Date, hours = 24): boolean {
  if (!lastIso) return true;
  const t = Date.parse(lastIso);
  if (Number.isNaN(t)) return true;
  return now.getTime() - t >= hours * 3600_000;
}
