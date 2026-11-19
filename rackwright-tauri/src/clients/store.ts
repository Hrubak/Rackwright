// Clients and sites, the same screens on both targets:
//  - web: clients and sites live in the server database; each shared rack can belong to one site.
//  - desktop: one `.client.json` file per client lists its sites and the `.rack.json` files in each.
//    Rack paths inside the client folder are stored relative to it, so the folder can be moved or synced.
import * as A from "../api";
import { IS_WEB } from "../backend";
import type { Doc } from "../types";
import type { Room } from "../rooms/types";
import { readPlan, type MigrationPlan } from "../migration/types";
import type { ReportOptions } from "../report/types";
import { absPath, baseOf, relPath } from "./util";

export interface RackItem { key: string; name: string; id?: number; path?: string; updated?: string; by?: string }
export interface SiteItem { id: number; name: string; address: string; notes: string; rooms?: Room[]; migration?: MigrationPlan; racks: RackItem[] }
export type LinkEnd = A.LinkEnd;
export type LinkBody = A.LinkBody;
export interface LinkItem { id: number; site_a: number; site_b: number | null; kind: string; provider: string; circuit: string; bandwidth: string; notes: string; a_end: LinkEnd | null; b_end: LinkEnd | null }
export interface ClientItem { key: string; name: string; notes: string; sites: SiteItem[]; links: LinkItem[] }
export interface ClientListItem { key: string; name: string; sub: string }
export type SitePatch = { name?: string; address?: string; notes?: string };

export interface ClientStore {
  web: boolean;
  list(): Promise<ClientListItem[]>;
  get(key: string): Promise<ClientItem>;
  /** Web: new client in the database. Desktop: asks where to save the new client file. Returns its key, or null if cancelled. */
  create(name: string): Promise<string | null>;
  /** Desktop only: open an existing client file. */
  open?(): Promise<string | null>;
  update(key: string, p: { name?: string; notes?: string }): Promise<void>;
  /** Web: delete the client (only when it has no sites). Desktop: remove it from the list; the file stays. */
  remove(key: string): Promise<void>;
  addSite(key: string, s: SitePatch & { name: string }): Promise<void>;
  updateSite(key: string, siteId: number, p: SitePatch): Promise<void>;
  /** The racks are kept (web: they become Unassigned; desktop: the files stay). */
  removeSite(key: string, siteId: number): Promise<void>;
  setRooms(key: string, siteId: number, rooms: Room[]): Promise<void>;
  /** Save the VM migration plan; null removes it. */
  setMigration(key: string, siteId: number, plan: MigrationPlan | null): Promise<void>;
  addLink(key: string, body: LinkBody): Promise<void>;
  updateLink(key: string, id: number, body: Partial<LinkBody>): Promise<void>;
  removeLink(key: string, id: number): Promise<void>;
  /** Take a rack out of a site (the rack itself is kept). */
  removeRack(key: string, siteId: number, r: RackItem): Promise<void>;
  /** Web: shared racks that are in no site. */
  unassigned?(): Promise<RackItem[]>;
  /** Web: put a shared rack in a site. Desktop: add .rack.json files (asks with a dialog when `paths` is empty). */
  addRacks(key: string, siteId: number, items?: RackItem[], paths?: string[]): Promise<void>;
  loadDoc(r: RackItem): Promise<Doc>;
  /** Saved report options, or null when none were saved yet. */
  getReport(key: string): Promise<ReportOptions | null>;
  setReport(key: string, o: ReportOptions): Promise<void>;
}

// ---------------------------------------------------------------- web

const rackItem = (m: A.RackMeta): RackItem => ({ key: `r${m.id}`, id: m.id, name: m.name, updated: m.updated_at, by: m.updated_by });

function webStore(): ClientStore {
  return {
    web: true,
    async list() {
      return (await A.listClients()).map((c) => ({ key: String(c.id), name: c.name, sub: `${c.sites} site${c.sites === 1 ? "" : "s"}, ${c.racks} rack${c.racks === 1 ? "" : "s"}` }));
    },
    async get(key) {
      const c = await A.getClient(Number(key));
      return {
        key, name: c.name, notes: c.notes,
        sites: c.sites.map((s) => ({ id: s.id, name: s.name, address: s.address, notes: s.notes, rooms: s.rooms ?? [], migration: readPlan(s.migration), racks: s.racks.map(rackItem) })),
        links: (c.links ?? []).map((l) => ({ id: l.id, site_a: l.site_a, site_b: l.site_b, kind: l.kind, provider: l.provider || "", circuit: l.circuit || "", bandwidth: l.bandwidth || "", notes: l.notes || "", a_end: l.a_end ?? null, b_end: l.b_end ?? null })),
      };
    },
    async create(name) { return String((await A.createClient(name)).id); },
    async update(key, p) { await A.patchClient(Number(key), p); },
    async remove(key) { await A.deleteClient(Number(key)); },
    async addSite(key, s) { await A.createSite(Number(key), s); },
    async updateSite(_key, id, p) { await A.patchSite(id, p); },
    async removeSite(_key, id) { await A.deleteSite(id); },
    async setRooms(_key, id, rooms) { await A.patchSite(id, { rooms }); },
    async setMigration(_key, id, plan) { await A.patchSite(id, { migration: plan ?? {} }); },
    async addLink(key, b) { await A.createLink(Number(key), b); },
    async updateLink(_key, id, b) { await A.patchLink(id, b); },
    async removeLink(_key, id) { await A.deleteLink(id); },
    async removeRack(_key, _site, r) { if (r.id != null) await A.setRackSite(r.id, null); },
    async unassigned() { return (await A.listRacks()).filter((m) => m.site_id == null).map(rackItem); },
    async addRacks(_key, siteId, items = []) { for (const r of items) if (r.id != null) await A.setRackSite(r.id, siteId); },
    async loadDoc(r) { return (await A.getRack(r.id!)).doc; },
    async getReport(key) { const o = await A.getClientReport(Number(key)); return o && Object.keys(o).length ? (o as unknown as ReportOptions) : null; },
    async setReport(key, o) { await A.putClientReport(Number(key), o); },
  };
}

// ---------------------------------------------------------------- desktop

interface ClientFile {
  rackwright: "client"; v: 1; name: string; notes: string; nid: number;
  sites: { id: number; name: string; address: string; notes: string; rooms?: Room[]; migration?: unknown; racks: { path: string; name: string }[] }[];
  links?: LinkItem[];
  report?: unknown;
}

const RECENT = "rw.clientFiles";
const recent = (): string[] => { try { const a = JSON.parse(localStorage.getItem(RECENT) || "[]"); return Array.isArray(a) ? a.filter((x) => typeof x === "string") : []; } catch { return []; } };
const setRecent = (a: string[]) => { try { localStorage.setItem(RECENT, JSON.stringify(a.slice(0, 50))); } catch { /* ignore */ } };
const remember = (p: string) => setRecent([p, ...recent().filter((x) => x !== p)]);

const rackName = (p: string) => baseOf(p).replace(/\.rack\.json$/i, "").replace(/\.json$/i, "");

function desktopStore(): ClientStore {
  const core = () => import("@tauri-apps/api/core");
  const dialog = () => import("@tauri-apps/plugin-dialog");
  const read = async (path: string): Promise<ClientFile> => {
    const text = await (await core()).invoke<string>("read_text", { path });
    const f = JSON.parse(text) as ClientFile;
    if (!f || f.rackwright !== "client" || !Array.isArray(f.sites)) throw new Error(`${baseOf(path)} is not a Rackwright client file.`);
    return f;
  };
  const write = async (path: string, f: ClientFile) => (await core()).invoke("write_text", { path, text: JSON.stringify(f, null, 2) });
  const change = async (path: string, fn: (f: ClientFile) => void) => { const f = await read(path); fn(f); await write(path, f); };
  const site = (f: ClientFile, id: number) => { const s = f.sites.find((x) => x.id === id); if (!s) throw new Error("That site is gone. Reload the client."); return s; };
  const filters = [{ name: "Rackwright client", extensions: ["json"] }];
  return {
    web: false,
    async list() {
      const out: ClientListItem[] = [];
      for (const p of recent()) {
        try {
          const f = await read(p);
          const racks = f.sites.reduce((n, s) => n + s.racks.length, 0);
          out.push({ key: p, name: f.name, sub: `${f.sites.length} site${f.sites.length === 1 ? "" : "s"}, ${racks} rack${racks === 1 ? "" : "s"}` });
        } catch { out.push({ key: p, name: baseOf(p), sub: "File not found or unreadable" }); }
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    },
    async get(key) {
      const f = await read(key);
      return {
        key, name: f.name, notes: f.notes || "",
        sites: [...f.sites].sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({
          id: s.id, name: s.name, address: s.address || "", notes: s.notes || "", rooms: s.rooms ?? [], migration: readPlan(s.migration),
          racks: s.racks.map((r) => ({ key: r.path, path: absPath(key, r.path), name: r.name || rackName(r.path) })),
        })),
        links: (f.links ?? []).map((l) => ({ ...l, provider: l.provider || "", circuit: l.circuit || "", bandwidth: l.bandwidth || "", notes: l.notes || "", a_end: l.a_end ?? null, b_end: l.b_end ?? null })),
      };
    },
    async create(name) {
      const safe = name.replace(/[<>:"/\\|?*]+/g, " ").trim() || "client";
      const p = await (await dialog()).save({ filters, defaultPath: `${safe}.client.json` });
      if (!p) return null;
      await write(p, { rackwright: "client", v: 1, name, notes: "", nid: 1, sites: [] });
      remember(p);
      return p;
    },
    async open() {
      const p = await (await dialog()).open({ filters });
      if (typeof p !== "string") return null;
      await read(p);
      remember(p);
      return p;
    },
    async update(key, p) { await change(key, (f) => { if (p.name != null) f.name = p.name; if (p.notes != null) f.notes = p.notes; }); },
    async remove(key) { setRecent(recent().filter((x) => x !== key)); },
    async addSite(key, s) {
      await change(key, (f) => {
        if (f.sites.some((x) => x.name.toLowerCase() === s.name.toLowerCase())) throw new Error(`This client already has a site called "${s.name}".`);
        f.sites.push({ id: f.nid++, name: s.name, address: s.address || "", notes: s.notes || "", racks: [] });
      });
    },
    async updateSite(key, id, p) {
      await change(key, (f) => {
        const s = site(f, id);
        if (p.name != null && f.sites.some((x) => x !== s && x.name.toLowerCase() === p.name!.toLowerCase())) throw new Error(`This client already has a site called "${p.name}".`);
        Object.assign(s, p);
      });
    },
    async setRooms(key, id, rooms) { await change(key, (f) => { site(f, id).rooms = rooms; }); },
    async setMigration(key, id, plan) { await change(key, (f) => { const s = site(f, id); if (plan) s.migration = plan; else delete s.migration; }); },
    async removeSite(key, id) { await change(key, (f) => { f.sites = f.sites.filter((x) => x.id !== id); f.links = (f.links ?? []).filter((l) => l.site_a !== id && l.site_b !== id); }); },
    async addLink(key, b) {
      await change(key, (f) => {
        site(f, b.site_a);
        if (b.site_b != null) site(f, b.site_b);
        if (b.site_a === b.site_b) throw new Error("A link needs two different sites.");
        f.links = f.links ?? [];
        f.links.push({ id: f.nid++, site_a: b.site_a, site_b: b.site_b, kind: b.kind, provider: b.provider || "", circuit: b.circuit || "", bandwidth: b.bandwidth || "", notes: b.notes || "", a_end: b.a_end ?? null, b_end: b.b_end ?? null });
      });
    },
    async updateLink(key, id, b) {
      await change(key, (f) => {
        const l = (f.links ?? []).find((x) => x.id === id);
        if (!l) throw new Error("That link is gone. Reload the client.");
        const n = { ...l, ...b } as LinkItem;
        site(f, n.site_a);
        if (n.site_b != null) site(f, n.site_b);
        if (n.site_a === n.site_b) throw new Error("A link needs two different sites.");
        Object.assign(l, n);
      });
    },
    async removeLink(key, id) { await change(key, (f) => { f.links = (f.links ?? []).filter((l) => l.id !== id); }); },
    async removeRack(key, id, r) { await change(key, (f) => { const s = site(f, id); s.racks = s.racks.filter((x) => x.path !== r.key); }); },
    async addRacks(key, id, _items, paths) {
      let ps = paths ?? [];
      if (!ps.length) {
        const sel = await (await dialog()).open({ multiple: true, filters: [{ name: "Rack", extensions: ["json"] }] });
        ps = Array.isArray(sel) ? sel : typeof sel === "string" ? [sel] : [];
      }
      if (!ps.length) return;
      await change(key, (f) => {
        const s = site(f, id);
        for (const p of ps) {
          const rel = relPath(key, p);
          if (!s.racks.some((x) => absPath(key, x.path).toLowerCase() === p.toLowerCase())) s.racks.push({ path: rel, name: rackName(p) });
        }
      });
    },
    async getReport(key) { const o = (await read(key)).report; return o && typeof o === "object" && Object.keys(o).length ? (o as ReportOptions) : null; },
    async setReport(key, o) { await change(key, (f) => { f.report = o; }); },
    async loadDoc(r) {
      if (!r.path) throw new Error("No file for this rack.");
      return (await core()).invoke<Doc>("open_doc", { path: r.path });
    },
  };
}

let store: ClientStore | null = null;
export const clientStore = (): ClientStore => (store ??= IS_WEB ? webStore() : desktopStore());
