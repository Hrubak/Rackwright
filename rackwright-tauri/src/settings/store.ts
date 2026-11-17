import { IS_WEB } from "../backend";
import * as api from "../api";
import type { AssetName, Branding, Prefs, SystemSettings } from "./types";
import { idbDelete, idbGet, idbPut } from "./assets";

export interface SettingsStore {
  getPrefs(): Promise<Prefs>;
  setPrefs(p: Prefs): Promise<Prefs>;
  getSystem(): Promise<SystemSettings>;
  setSystem(s: SystemSettings): Promise<SystemSettings>;
  getBranding(): Promise<Branding>;
  setLogo(file: File | null): Promise<void>;
  getAsset(name: AssetName): Promise<Blob | null>;
  setAsset(name: AssetName, file: File | null): Promise<void>;
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];
const MB = 1024 * 1024;
const isFont = (n: AssetName) => n === "font_regular" || n === "font_bold";

async function checkAsset(name: AssetName, file: File) {
  if (isFont(name)) {
    const h = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    const m = String.fromCharCode(...h);
    const ok = (h[0] === 0 && h[1] === 1 && h[2] === 0 && h[3] === 0) || m === "OTTO" || m === "true";
    if (!ok) throw new Error("Upload a TTF or OTF font file.");
  } else if (!IMAGE_TYPES.includes(file.type)) throw new Error("Upload a PNG, JPG, SVG or WebP image.");
  const max = name === "logo" ? 2 : 5;
  if (file.size > max * MB) throw new Error(`That file is too large (${max} MB at most).`);
}

let logoUrl: string | null = null;
let logoBlob: Blob | null = null;
let migrated = false;
async function migrateLogo() {
  if (migrated) return;
  migrated = true;
  try {
    const old = localStorage.getItem("rw.logo");
    if (!old) return;
    try {
      if (!(await idbGet("logo"))) await idbPut("logo", await (await fetch(old)).blob());
    } catch { /* could not convert; drop the old copy anyway */ }
    localStorage.removeItem("rw.logo");
  } catch { /* storage unavailable */ }
}

function lsGet<T>(key: string, fallback: T): T {
  try { const s = localStorage.getItem(key); return s ? (JSON.parse(s) as T) : fallback; } catch { return fallback; }
}
function lsSet(key: string, val: unknown) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage unavailable */ } }

const webStore: SettingsStore = {
  getPrefs: () => api.getMyPrefs() as Promise<Prefs>,
  setPrefs: (p) => api.putMyPrefs(p) as Promise<Prefs>,
  async getSystem() { return (await api.getSettings()).settings as SystemSettings; },
  setSystem: (s) => api.putSettings(s) as Promise<SystemSettings>,
  async getBranding() {
    const b = await api.getBrandingApi();
    let logo_url: string | null = null;
    if (b.has_logo) {
      let ver = "";
      try { ver = (await api.getSettings()).assets.find((a) => a.name === "logo")?.updated_at ?? ""; } catch { /* keep no version */ }
      logo_url = `/api/branding/logo${ver ? `?v=${encodeURIComponent(ver)}` : ""}`;
    }
    return { company_name: b.company_name, accent: b.accent, logo_url };
  },
  async setLogo(file) {
    if (file) await api.putAsset("logo", file); else await api.deleteAsset("logo");
  },
  getAsset: (name) => api.getAsset(name),
  async setAsset(name, file) {
    if (file) await api.putAsset(name, file); else await api.deleteAsset(name);
  },
};

const localStore: SettingsStore = {
  async getPrefs() { return lsGet<Prefs>("rw.prefs", {}); },
  async setPrefs(p) { lsSet("rw.prefs", p); return p; },
  async getSystem() { return lsGet<SystemSettings>("rw.system", {}); },
  async setSystem(s) { lsSet("rw.system", s); return s; },
  async getBranding() {
    const s = lsGet<SystemSettings>("rw.system", {});
    let blob: Blob | null = null;
    try { blob = await localStore.getAsset("logo"); } catch { /* no logo */ }
    if (!blob) { if (logoUrl) URL.revokeObjectURL(logoUrl); logoUrl = null; logoBlob = null; }
    else if (!logoUrl || logoBlob !== blob) {
      if (logoUrl) URL.revokeObjectURL(logoUrl);
      logoUrl = URL.createObjectURL(blob); logoBlob = blob;
    }
    return { company_name: s.company_name ?? "", accent: s.accent ?? null, logo_url: logoUrl };
  },
  setLogo: (file) => localStore.setAsset("logo", file),
  async getAsset(name) {
    if (name === "logo") await migrateLogo();
    return idbGet(name);
  },
  async setAsset(name, file) {
    if (!file) { await idbDelete(name); return; }
    await checkAsset(name, file);
    await idbPut(name, file);
  },
};

export function settingsStore(): SettingsStore { return IS_WEB ? webStore : localStore; }
