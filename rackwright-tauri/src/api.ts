import type { Room } from "./rooms/types";
// HTTP client for the web build (see web/API.md). Only used when VITE_TARGET === "web".
import { Doc } from "./types";
import type { AuvikApiDevice } from "./auvik/api/map";

export interface User { id: number; email: string; name: string; is_admin: boolean }
export interface RackMeta { id: number; name: string; version: number; updated_at: string; updated_by: string; site_id?: number | null; site?: string; client_id?: number | null; client?: string }

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: any = {}) { super(message); }
}

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (f: () => void) => { onUnauthorized = f; };

export async function api<T = any>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, {
      method, credentials: "same-origin",
      cache: "no-store",   // API answers are live (an edited auvik.env shows after a restart without a reload)
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (e) { throw new ApiError(0, signal?.aborted ? "Stopped waiting for the server" : "Cannot reach the server"); }
  let j: any = {};
  try { j = await r.json(); } catch { /* empty or non-JSON body */ }
  if (!r.ok) {
    if (r.status === 401) onUnauthorized();
    throw new ApiError(r.status, j?.error || `Request failed (${r.status})`, j);
  }
  return j as T;
}

export const getVersion = () => api<{ version: string }>("GET", "/api/version");
export const getSetup = () => api<{ needs_setup: boolean }>("GET", "/api/setup");
export const getMe = () => api<User>("GET", "/api/me");
export const setup = (email: string, name: string, password: string) => api<User>("POST", "/api/setup", { email, name, password });
export const login = (email: string, password: string) => api<User>("POST", "/api/login", { email, password });
export const logout = () => api("POST", "/api/logout");
export const changePassword = (current: string, next: string) => api("POST", "/api/me/password", { current, new: next });

export const listUsers = () => api<User[]>("GET", "/api/users");
export const addUser = (u: { email: string; name: string; password: string; is_admin: boolean }) => api<User>("POST", "/api/users", u);
export const patchUser = (id: number, p: { name?: string; is_admin?: boolean; password?: string }) => api<User>("PATCH", `/api/users/${id}`, p);
export const deleteUser = (id: number) => api("DELETE", `/api/users/${id}`);

export interface UpdateStatus {
  available: boolean; reason: string; version: string; commit: string; branch: string; repo: string;
  state: "idle" | "running" | "ok" | "failed"; since: string; log: string;
}
export interface UpdateCheck {
  version: string; commit: string; latest_version: string; latest_commit: string; latest_date: string;
  latest_subject: string; update_available: boolean; changes: string;
}
export const getUpdate = () => api<UpdateStatus>("GET", "/api/admin/update");
export const checkUpdate = () => api<UpdateCheck>("POST", "/api/admin/update/check");
export const startUpdate = () => api("POST", "/api/admin/update");

export const listRacks = () => api<RackMeta[]>("GET", "/api/racks");
export const getRack = (id: number) => api<RackMeta & { doc: Doc }>("GET", `/api/racks/${id}`);
export const createRack = (name: string, doc: Doc, site_id: number | null = null) => api<RackMeta>("POST", "/api/racks", { name, doc, site_id });
export const setRackSite = (id: number, site_id: number | null) => api<RackMeta>("PUT", `/api/racks/${id}/site`, { site_id });

export interface ClientMeta { id: number; name: string; notes: string; sites: number; racks: number; updated_at: string }
export interface SiteRow { id: number; client_id: number; name: string; address: string; notes: string; rooms?: Room[]; migration?: unknown; updated_at: string }
export interface LinkEnd { rack: number | string; dev: number; name: string }
export interface LinkBody { site_a: number; site_b: number | null; kind: string; provider?: string; circuit?: string; bandwidth?: string; notes?: string; a_end?: LinkEnd | null; b_end?: LinkEnd | null }
export interface Link { id: number; client_id: number; site_a: number; site_b: number | null; kind: string; provider: string; circuit: string; bandwidth: string; notes: string; a_end: LinkEnd | null; b_end: LinkEnd | null; updated_at: string }
export type ClientFull = Omit<ClientMeta, "sites"> & { sites: (SiteRow & { racks: RackMeta[] })[]; links: Link[] };
export const listClients = () => api<ClientMeta[]>("GET", "/api/clients");
export const getClient = (id: number) => api<ClientFull>("GET", `/api/clients/${id}`);
export const createClient = (name: string, notes = "") => api<ClientMeta>("POST", "/api/clients", { name, notes });
export const patchClient = (id: number, p: { name?: string; notes?: string }) => api<ClientMeta>("PATCH", `/api/clients/${id}`, p);
export const deleteClient = (id: number) => api("DELETE", `/api/clients/${id}`);
export const createSite = (clientId: number, s: { name: string; address?: string; notes?: string }) => api<SiteRow>("POST", `/api/clients/${clientId}/sites`, s);
export const patchSite = (id: number, p: { name?: string; address?: string; notes?: string; client_id?: number; rooms?: Room[]; migration?: unknown }) => api<SiteRow>("PATCH", `/api/sites/${id}`, p);
export const deleteSite = (id: number) => api("DELETE", `/api/sites/${id}`);
export const createLink = (clientId: number, b: LinkBody) => api<Link>("POST", `/api/clients/${clientId}/links`, b);
export const patchLink = (id: number, b: Partial<LinkBody>) => api<Link>("PATCH", `/api/links/${id}`, b);
export const deleteLink = (id: number) => api("DELETE", `/api/links/${id}`);
export const updateRack = (id: number, name: string, doc: Doc, version: number) => api<RackMeta>("PUT", `/api/racks/${id}`, { name, doc, version });
export const deleteRack = (id: number) => api("DELETE", `/api/racks/${id}`);

/** Browser file input -> parsed .rack.json. Resolves null when cancelled. */
export function importFile(): Promise<{ name: string; doc: Doc } | null> {
  return new Promise((resolve, reject) => {
    const i = document.createElement("input");
    i.type = "file"; i.accept = ".json,application/json";
    i.onchange = async () => {
      const f = i.files?.[0];
      if (!f) { resolve(null); return; }
      try {
        const doc = JSON.parse(await f.text());
        if (!doc || !Array.isArray(doc.racks) || !Array.isArray(doc.devices) || !Array.isArray(doc.cables)) throw new Error("Not a Rackwright file");
        resolve({ name: f.name.replace(/\.rack\.json$|\.json$/i, ""), doc });
      } catch (e) { reject(new Error("Could not read that file: " + (e instanceof Error ? e.message : String(e)))); }
    };
    i.oncancel = () => resolve(null);
    i.click();
  });
}

/** Download the document as <name>.rack.json. */
export function exportFile(name: string, doc: Doc) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 1)], { type: "application/json" }));
  a.download = `${name.replace(/[\/:*?"<>|]+/g, "_") || "rack"}.rack.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Settings and branding (web/API.md)
export interface AssetInfo { name: string; mime: string; size: number; updated_at: string }
export const getSettings = () => api<{ settings: Record<string, unknown>; assets: AssetInfo[] }>("GET", "/api/settings");
export const putSettings = (s: Record<string, unknown>) => api<Record<string, unknown>>("PUT", "/api/settings", s);
export const getBrandingApi = () => api<{ company_name: string; accent: string | null; has_logo: boolean }>("GET", "/api/branding");
export const getMyPrefs = () => api<Record<string, unknown>>("GET", "/api/me/prefs");
export const putMyPrefs = (p: Record<string, unknown>) => api<Record<string, unknown>>("PUT", "/api/me/prefs", p);
export const patchMe = (p: { name?: string; email?: string; current_password?: string }) => api<User>("PATCH", "/api/me", p);
export const deleteAsset = (name: string) => api("DELETE", `/api/assets/${name}`);

/** Raw body upload (not JSON): sends the file bytes with the file's own Content-Type. */
export async function apiRaw<T = any>(method: string, path: string, file: File): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, { method, credentials: "same-origin", headers: { "Content-Type": file.type }, body: file });
  } catch { throw new ApiError(0, "Cannot reach the server"); }
  let j: any = {};
  try { j = await r.json(); } catch { /* empty body */ }
  if (!r.ok) {
    if (r.status === 401) onUnauthorized();
    throw new ApiError(r.status, j?.error || `Request failed (${r.status})`, j);
  }
  return j as T;
}
export const putAsset = (name: string, file: File) => apiRaw<AssetInfo>("PUT", `/api/assets/${name}`, file);

/** GET a binary asset. 404 -> null. */
export async function getAsset(name: string): Promise<Blob | null> {
  let r: Response;
  try { r = await fetch(`/api/assets/${name}`, { credentials: "same-origin" }); } catch { throw new ApiError(0, "Cannot reach the server"); }
  if (r.status === 404) return null;
  if (!r.ok) {
    if (r.status === 401) onUnauthorized();
    let j: any = {};
    try { j = await r.json(); } catch { /* ignore */ }
    throw new ApiError(r.status, j?.error || `Request failed (${r.status})`, j);
  }
  return r.blob();
}
export const getClientReport = (id: number) => api<Record<string, unknown>>("GET", `/api/clients/${id}/report`);
export const putClientReport = (id: number, o: unknown) => api("PUT", `/api/clients/${id}/report`, o);

// Auvik (web only, see web/API.md)
export interface AuvikTenant { id: string; name: string; type: "multiClient" | "client"; parent: string | null }
export interface AuvikInventory { status: "ok" | "denied" | "empty"; note: string; devices: AuvikApiDevice[] }
export interface AuvikLink { device: string; iface: string; peerDevice: string; peerIface: string; portless: boolean }
export interface AuvikLinks { status: "ok" | "denied" | "empty"; note: string; links: AuvikLink[]; dropped: number }
export const auvikStatus = () => api<{ configured: boolean; region: string; username: string }>("GET", "/api/auvik");
export const auvikTest = () => api<{ ok: boolean; error?: string }>("POST", "/api/auvik/test");
export const auvikTenants = () => api<AuvikTenant[]>("GET", "/api/auvik/tenants");
/** One site can take a while: wait up to 4 minutes, or until the caller cancels. */
export function auvikInventory(id: string, signal?: AbortSignal): Promise<AuvikInventory> {
  const limit = AbortSignal.timeout(4 * 60 * 1000);
  const both = signal ? AbortSignal.any([limit, signal]) : limit;
  return api<AuvikInventory>("GET", `/api/auvik/tenants/${encodeURIComponent(id)}/inventory`, undefined, both);
}
/** The site's cables. Waits up to 4 minutes, like the inventory. */
export function auvikLinks(id: string, signal?: AbortSignal): Promise<AuvikLinks> {
  const limit = AbortSignal.timeout(4 * 60 * 1000);
  const both = signal ? AbortSignal.any([limit, signal]) : limit;
  return api<AuvikLinks>("GET", `/api/auvik/tenants/${encodeURIComponent(id)}/links`, undefined, both);
}
