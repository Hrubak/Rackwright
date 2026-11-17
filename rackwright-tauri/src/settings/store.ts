import { IS_WEB } from "../backend";
import * as api from "../api";
import type { Branding, Prefs, SystemSettings } from "./types";

export interface SettingsStore {
  getPrefs(): Promise<Prefs>;
  setPrefs(p: Prefs): Promise<Prefs>;
  getSystem(): Promise<SystemSettings>;
  setSystem(s: SystemSettings): Promise<SystemSettings>;
  getBranding(): Promise<Branding>;
  setLogo(file: File | null): Promise<void>;
}

const MAX_LOGO = 1024 * 1024;

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
};

const localStore: SettingsStore = {
  async getPrefs() { return lsGet<Prefs>("rw.prefs", {}); },
  async setPrefs(p) { lsSet("rw.prefs", p); return p; },
  async getSystem() { return lsGet<SystemSettings>("rw.system", {}); },
  async setSystem(s) { lsSet("rw.system", s); return s; },
  async getBranding() {
    const s = lsGet<SystemSettings>("rw.system", {});
    let logo: string | null = null;
    try { logo = localStorage.getItem("rw.logo"); } catch { /* ignore */ }
    return { company_name: s.company_name ?? "", accent: s.accent ?? null, logo_url: logo };
  },
  async setLogo(file) {
    if (!file) { try { localStorage.removeItem("rw.logo"); } catch { /* ignore */ } return; }
    if (file.size > MAX_LOGO) throw new Error("Pick an image under 1 MB.");
    const url = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = () => rej(new Error("Could not read that file."));
      r.readAsDataURL(file);
    });
    try { localStorage.setItem("rw.logo", url); } catch { throw new Error("Could not save the logo."); }
  },
};

export function settingsStore(): SettingsStore { return IS_WEB ? webStore : localStore; }
