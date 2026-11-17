import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { applyAccent, applyTheme, isHex6, resolveTheme } from "../theme";
import { settingsStore } from "./store";
import type { AssetName, Branding, Prefs, SystemSettings } from "./types";

interface Ctx {
  prefs: Prefs; system: SystemSettings; branding: Branding;
  savePrefs(p: Partial<Prefs>): Promise<void>;
  saveSystem(s: Partial<SystemSettings>): Promise<void>;
  setLogo(f: File | null): Promise<void>;
  setAsset(name: AssetName, f: File | null): Promise<void>;
  /** Goes up after any asset change. */
  assetsVersion: number;
  reload(): Promise<void>;
  loaded: boolean;
}

const EMPTY: Branding = { company_name: "", accent: null, logo_url: null };
const noop = async () => {};
const SettingsCtx = createContext<Ctx>({ prefs: {}, system: {}, branding: EMPTY, savePrefs: noop, saveSystem: noop, setLogo: noop, setAsset: noop, assetsVersion: 0, reload: noop, loaded: false });

const accentOf = (s: SystemSettings) => (typeof s.accent === "string" && isHex6(s.accent) ? s.accent : null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>({});
  const [system, setSystem] = useState<SystemSettings>({});
  const [branding, setBranding] = useState<Branding>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [assetsVersion, setAssetsVersion] = useState(0);
  const store = useMemo(() => settingsStore(), []);

  const reload = useCallback(async () => {
    try {
      const [p, s, b] = await Promise.all([store.getPrefs(), store.getSystem(), store.getBranding()]);
      setPrefs(p); setSystem(s); setBranding(b);
      applyAccent(accentOf(s));
    } catch { /* leave defaults */ }
    setLoaded(true);
  }, [store]);

  useEffect(() => { void reload(); }, [reload]);

  const themePref = prefs.theme ?? "dark";
  useEffect(() => {
    try { localStorage.setItem("rw.theme", themePref); } catch { /* ignore */ }
    let mq: MediaQueryList | null = null;
    try { if (typeof matchMedia === "function") mq = matchMedia("(prefers-color-scheme: dark)"); } catch { mq = null; }
    const apply = () => applyTheme(resolveTheme(themePref, mq ? mq.matches : true));
    apply();
    if (themePref !== "system" || !mq) return;
    mq.addEventListener?.("change", apply);
    return () => mq!.removeEventListener?.("change", apply);
  }, [themePref]);

  const savePrefs = useCallback(async (p: Partial<Prefs>) => {
    setPrefs(await store.setPrefs({ ...prefs, ...p }));
  }, [store, prefs]);
  const saveSystem = useCallback(async (s: Partial<SystemSettings>) => {
    const next = await store.setSystem({ ...system, ...s });
    setSystem(next);
    applyAccent(accentOf(next));
    try { setBranding(await store.getBranding()); } catch { /* keep */ }
  }, [store, system]);
  const setAsset = useCallback(async (name: AssetName, f: File | null) => {
    await store.setAsset(name, f);
    setAssetsVersion((n) => n + 1);
    if (name === "logo") setBranding(await store.getBranding());
  }, [store]);
  const setLogo = useCallback((f: File | null) => setAsset("logo", f), [setAsset]);

  const value = useMemo(() => ({ prefs, system, branding, savePrefs, saveSystem, setLogo, setAsset, assetsVersion, reload, loaded }), [prefs, system, branding, savePrefs, saveSystem, setLogo, setAsset, assetsVersion, reload, loaded]);
  return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
}

export function useSettings(): Ctx { return useContext(SettingsCtx); }
