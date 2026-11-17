// Site-to-site links of a client: a diagram, a table and an add/edit form.
import { useMemo, useState } from "react";
import type { Doc } from "../types";
import type { ClientItem, LinkBody, LinkEnd, LinkItem, RackItem, SiteItem, ClientStore } from "./store";
import { LINK_KINDS, layoutSites, linkColor, linkLabel } from "./util";

const btn = { background: "#2a2d33", color: "#e6e8eb", border: "1px solid #3a3d42", borderRadius: 4, padding: "4px 10px", marginRight: 5, cursor: "pointer", fontSize: 12 } as const;
const inp = { background: "#14161a", color: "#e6e8eb", border: "1px solid #3a3d42", borderRadius: 4, padding: "4px 6px", fontSize: 12 } as const;
const errOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

const W = 1000, H = 560, BW = 210, BH = 76, CW = 190, CH = 70;
/** What a link end stores for a rack: the rack id on the web, the stored file key on the desktop. */
const rackRef = (r: RackItem): number | string => r.id ?? r.key;
const endKey = (e: LinkEnd | null) => (e ? `${e.rack}:${e.dev}` : "");

interface Form { id: number | null; site_a: number; site_b: number; kind: string; provider: string; circuit: string; bandwidth: string; notes: string; a_end: LinkEnd | null; b_end: LinkEnd | null }

function endOptions(site: SiteItem | undefined, docs: Record<string, Doc | string>, cur: LinkEnd | null): { key: string; end: LinkEnd; label: string; first: boolean }[] {
  const out: { key: string; end: LinkEnd; label: string; first: boolean }[] = [];
  for (const r of site?.racks ?? []) {
    const d = docs[r.key];
    if (typeof d !== "object") continue;
    for (const dev of d.devices) {
      const end = { rack: rackRef(r), dev: dev.id, name: dev.name || `Device ${dev.id}` };
      out.push({ key: endKey(end), end, label: `${end.name} (${dev.type || "device"}, ${r.name})`, first: /firewall|router/i.test(dev.type || "") });
    }
  }
  out.sort((a, b) => Number(b.first) - Number(a.first) || a.label.localeCompare(b.label));
  if (cur && !out.some((o) => o.key === endKey(cur))) out.unshift({ key: endKey(cur), end: cur, label: `${cur.name} (not found in this site)`, first: false });
  return out;
}

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

export default function Links({ client, docs, store, onChanged }: {
  client: ClientItem;
  docs: Record<string, Doc | string>;
  store: ClientStore;
  onChanged: () => Promise<unknown> | void;
}) {
  const [form, setForm] = useState<Form | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const siteMap = useMemo(() => new Map(client.sites.map((s) => [s.id, s])), [client]);
  const links = useMemo(() => client.links.filter((l) => siteMap.has(l.site_a) && (l.site_b == null || siteMap.has(l.site_b))), [client, siteMap]);
  const hasNet = links.some((l) => l.site_b == null);
  const lay = useMemo(() => layoutSites(client.sites.map((s) => s.id), hasNet, W, H), [client, hasNet]);

  const counts = (s: SiteItem) => {
    let devs = 0;
    for (const r of s.racks) { const d = docs[r.key]; if (typeof d === "object") devs += d.devices.length; }
    return `${s.racks.length} rack${s.racks.length === 1 ? "" : "s"}, ${devs} device${devs === 1 ? "" : "s"}`;
  };
  const siteName = (id: number | null) => (id == null ? "Internet / provider" : siteMap.get(id)?.name ?? "?");

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr("");
    try { await fn(); await onChanged(); return true; } catch (e) { setErr(errOf(e)); return false; } finally { setBusy(false); }
  };
  const startNew = () => setForm({ id: null, site_a: client.sites[0]?.id ?? 0, site_b: 0, kind: "VPN", provider: "", circuit: "", bandwidth: "", notes: "", a_end: null, b_end: null });
  const startEdit = (l: LinkItem) => { setSel(l.id); setForm({ id: l.id, site_a: l.site_a, site_b: l.site_b ?? 0, kind: l.kind, provider: l.provider, circuit: l.circuit, bandwidth: l.bandwidth, notes: l.notes, a_end: l.a_end, b_end: l.b_end }); };
  const save = async () => {
    if (!form) return;
    if (!form.site_a) { setErr("Pick site A."); return; }
    if (form.site_b === form.site_a) { setErr("Pick two different sites, or Internet / provider."); return; }
    const body: LinkBody = { site_a: form.site_a, site_b: form.site_b || null, kind: form.kind, provider: form.provider.trim(), circuit: form.circuit.trim(), bandwidth: form.bandwidth.trim(), notes: form.notes, a_end: form.a_end, b_end: form.b_end };
    if (await run(() => (form.id == null ? store.addLink(client.key, body) : store.updateLink(client.key, form.id, body)))) setForm(null);
  };
  const remove = async (l: LinkItem) => {
    if (!confirm(`Delete the ${linkLabel(l)} link between ${siteName(l.site_a)} and ${siteName(l.site_b)}?`)) return;
    if (await run(() => store.removeLink(client.key, l.id))) { setForm(null); setSel(null); }
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

  const th = { textAlign: "left", padding: "4px 6px", opacity: 0.7, whiteSpace: "nowrap" } as const;
  const td = { padding: "4px 6px", borderTop: "1px solid #24272c", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 180 } as const;
  const kinds = [...new Set(links.map((l) => l.kind))];

  if (!client.sites.length) return <div style={{ opacity: 0.7 }}>Add at least one site on the Sites tab first. Then you can show how the sites are connected.</div>;

  const endSel = (which: "a_end" | "b_end", siteId: number) => {
    const f = form!;
    const opts = endOptions(siteMap.get(siteId), docs, f[which]);
    return (
      <select style={{ ...inp, maxWidth: 320 }} value={endKey(f[which])} onChange={(e) => setForm({ ...f, [which]: opts.find((o) => o.key === e.target.value)?.end ?? null })}>
        <option value="">Not set</option>
        {opts.some((o) => o.first) && <optgroup label="Firewalls and routers">{opts.filter((o) => o.first).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</optgroup>}
        <optgroup label="Other devices">{opts.filter((o) => !o.first).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</optgroup>
      </select>
    );
  };

  return (
    <div>
      {err && <div style={{ background: "#3a1d1d", color: "#ffb4ab", padding: "6px 10px", marginBottom: 8, borderRadius: 4 }}>{err}</div>}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 12, opacity: 0.75, flex: 1 }}>{links.length ? "Click a line or a row to edit it." : "No links yet. Add the WAN links between this client's sites."}</span>
        <button style={{ ...btn, marginRight: 0 }} onClick={startNew} disabled={busy}>Add link</button>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 1100, height: "auto", background: "#14161a", border: "1px solid #2c2f35", borderRadius: 6, display: "block", fontFamily: "system-ui, sans-serif" }}>
        {links.map((l) => {
          const g = geo.get(l.id); if (!g) return null;
          const c = linkColor(l.kind), on = sel === l.id;
          const label = linkLabel(l), lw = Math.max(60, label.length * 6.6 + 14);
          return (
            <g key={l.id} style={{ cursor: "pointer" }} onClick={() => startEdit(l)}>
              <line x1={g.a.x} y1={g.a.y} x2={g.b.x} y2={g.b.y} stroke="transparent" strokeWidth={16} />
              <line x1={g.a.x} y1={g.a.y} x2={g.b.x} y2={g.b.y} stroke={c} strokeWidth={on ? 4.5 : 2.5} strokeDasharray={l.kind === "VPN" ? "8 5" : undefined} />
              <rect x={g.m.x - lw / 2} y={g.m.y - 11} width={lw} height={22} rx={11} fill="#1b1d21" stroke={c} strokeWidth={on ? 2 : 1} />
              <text x={g.m.x} y={g.m.y + 4} textAnchor="middle" fontSize={12} fill="#e6e8eb">{label}</text>
              {l.a_end && <text x={g.ta.x} y={g.ta.y} textAnchor="middle" fontSize={11} fill="#b6bcc4" stroke="#14161a" strokeWidth={3} paintOrder="stroke">{clip(l.a_end.name, 18)}</text>}
              {l.b_end && <text x={g.tb.x} y={g.tb.y} textAnchor="middle" fontSize={11} fill="#b6bcc4" stroke="#14161a" strokeWidth={3} paintOrder="stroke">{clip(l.b_end.name, 18)}</text>}
              <title>{`${siteName(l.site_a)} to ${siteName(l.site_b)}: ${label}${l.provider ? `, ${l.provider}` : ""}${l.circuit ? `, circuit ${l.circuit}` : ""}`}</title>
            </g>
          );
        })}
        {lay.internet && (
          <g>
            <path d={cloud(lay.internet.x, lay.internet.y)} fill="#202a38" stroke="#5b8bd0" strokeWidth={1.5} />
            <text x={lay.internet.x} y={lay.internet.y + 5} textAnchor="middle" fontSize={14} fill="#e6e8eb">Internet</text>
          </g>
        )}
        {client.sites.map((s) => {
          const p = lay.sites[s.id]; if (!p) return null;
          return (
            <g key={s.id}>
              <rect x={p.x - BW / 2} y={p.y - BH / 2} width={BW} height={BH} rx={10} fill="#202328" stroke="#4a4f57" strokeWidth={1.5} />
              <text x={p.x} y={p.y - 10} textAnchor="middle" fontSize={14} fontWeight={600} fill="#e6e8eb">{clip(s.name, 24)}</text>
              {s.address && <text x={p.x} y={p.y + 8} textAnchor="middle" fontSize={11} fill="#9aa0a8">{clip(s.address, 32)}</text>}
              <text x={p.x} y={p.y + 25} textAnchor="middle" fontSize={11} fill="#7d838c">{counts(s)}</text>
            </g>
          );
        })}
      </svg>
      {kinds.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12, margin: "8px 0 12px" }}>
          {kinds.map((k) => <span key={k}><span style={{ display: "inline-block", width: 18, height: 3, background: linkColor(k), verticalAlign: "middle", marginRight: 5 }} />{k}</span>)}
        </div>
      )}

      {form && (
        <div style={{ border: "1px solid #3a3d42", borderRadius: 6, padding: 10, margin: "12px 0", maxWidth: 640, background: "#202328" }}>
          <b>{form.id == null ? "New link" : "Edit link"}</b>
          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 6, marginTop: 8, alignItems: "center" }}>
            <span>Site A</span>
            <select style={inp} value={form.site_a} onChange={(e) => setForm({ ...form, site_a: Number(e.target.value), a_end: null })}>
              {client.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <span>Device at site A</span>{endSel("a_end", form.site_a)}
            <span>Site B</span>
            <select style={inp} value={form.site_b} onChange={(e) => setForm({ ...form, site_b: Number(e.target.value), b_end: null })}>
              <option value={0}>Internet / provider</option>
              {client.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {form.site_b !== 0 && <><span>Device at site B</span>{endSel("b_end", form.site_b)}</>}
            <span>Kind</span>
            <select style={inp} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {[...LINK_KINDS, ...(LINK_KINDS.includes(form.kind as never) ? [] : [form.kind])].map((k) => <option key={k}>{k}</option>)}
            </select>
            <span>Provider</span><input style={inp} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} />
            <span>Circuit ID</span><input style={inp} value={form.circuit} onChange={(e) => setForm({ ...form, circuit: e.target.value })} />
            <span>Bandwidth</span><input style={inp} placeholder="For example 500 Mbps" value={form.bandwidth} onChange={(e) => setForm({ ...form, bandwidth: e.target.value })} />
            <span>Notes</span><textarea style={{ ...inp, minHeight: 40 }} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div style={{ marginTop: 8 }}>
            <button style={btn} onClick={save} disabled={busy}>Save link</button>
            <button style={btn} onClick={() => { setForm(null); setSel(null); }}>Cancel</button>
            {form.id != null && <button style={{ ...btn, color: "#f85149", marginRight: 0 }} onClick={() => { const l = links.find((x) => x.id === form.id); if (l) remove(l); }}>Delete</button>}
          </div>
        </div>
      )}

      {links.length > 0 && (
        <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
          <thead><tr>{["Site A", "Device", "Site B / Internet", "Device", "Kind", "Provider", "Circuit ID", "Bandwidth"].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {links.map((l) => (
              <tr key={l.id} onClick={() => startEdit(l)} style={{ cursor: "pointer", background: sel === l.id ? "#2a3a52" : undefined }}>
                <td style={td}>{siteName(l.site_a)}</td><td style={td}>{l.a_end?.name || ""}</td>
                <td style={td}>{siteName(l.site_b)}</td><td style={td}>{l.b_end?.name || ""}</td>
                <td style={{ ...td, color: linkColor(l.kind) }}>{l.kind}</td><td style={td}>{l.provider}</td><td style={td}>{l.circuit}</td><td style={td}>{l.bandwidth}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
