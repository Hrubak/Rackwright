// Theme tokens. Every value equals the hex it replaces; dark must look as before.
export type ThemeName = "dark" | "light";
export type ThemePref = ThemeName | "system";

export const DARK = {
  bg: "#14161a",
  panel: "#1b1d21",
  "panel-2": "#24272c",
  control: "#2a2d33",
  border: "#3a3d42",
  "border-subtle": "#2c2f35",
  text: "#e6e8eb",
  "text-muted": "#9aa0a6",
  "text-dim": "#8b9097",
  "text-faint": "#6b717a",
  accent: "#2a6fdb",
  brand: "#2a6fdb",
  "accent-soft": "#2a3a52",
  "on-accent": "#ffffff",
  select: "#ffd33d",
  danger: "#f85149",
  ok: "#2ea043",
  "ok-bright": "#3ddc5b",
  warn: "#d29922",
  focus: "#4aa3ff",
  scrollbar: "#33363c",
  hover: "#363a42",
  "hover-border": "#5a5f67",
  overlay: "#000a",
  "row-hover": "#262a31",
  "accent-border": "#5b8bd0",
  link: "#58a6ff",
  "danger-bg": "#5a1d1d",
  "ok-bg": "#1d3a2a",
  "danger-text": "#ff7b72",
  "ok-text": "#7ee787",
  "warn-bg": "#3a2d12",
  "error-text": "#ffb4ab",
  "error-bg": "#3a1d1d",
  card: "#202328",
  inset: "#17191d",
  "mini-rack-bg": "#111317",
  "mini-rack-border": "#4a4e55",
  "mini-device": "#5b6270",
  "overlay-strong": "#000c",
  "border-faint": "#22252b",
  "text-muted-alt": "#9aa0a8",
  "row-hover-blue": "#24324a",
  "log-bg": "#0e0f12",
  ink: "#101113",
  edge: "#00000066",
  shadow: "#0008",
  "icon-frame": "#9aa1ab",
  "icon-post": "#c3c8cf",
  "icon-slot": "#4a4f58",
  "why-text": "#fff",
  "rack-post": "#2f3238",
  "rack-edge": "#464a52",
  "rack-panel": "#20232a",
  "rack-dark": "#15171b",
  "rack-bar": "#262930",
  "rack-foot": "#3a3e46",
  "rack-cap": "#2a2d34",
  "rack-handle": "#383c44",
  "rack-base": "#22252b",
  "rack-body": "#1d2025",
  "rack-subtitle": "#7d838c",
  "rack-title": "#e6e8eb",
  "rack-well": "#0b0c0e",
  "rack-well-edge": "#2c2f35",
  "u-stripe": "#111317",
  "u-hole": "#2a2d33",
  "u-label": "#6b717a",
  "mgr-face": "#1d2024",
  "why-bg": "#000d",
  "badge-ink": "#1b1d21",
  "plug-head": "#c9ced5",
  "plug-edge": "#4a4f57",
  "plug-tip": "#f4f6f8",
  "plug-latch": "#d8dce1",
  "plug-metal": "#b9bfc7",
  "plug-pin": "#7b818a",
  "plug-c13-edge": "#7d838c",
  "plug-c14-edge": "#9aa0a8",
  "plug-c13-body": "#202226",
  "plug-c14-body": "#14151a",
  "plug-boot": "#2b2d31",
  "plug-console": "#7a8fa6",
  "plug-white": "#e4e8ec",
  "cable-under-light": "#9aa0aa",
  "cable-shadow": "#000",
  "duct-fill": "#cfd6e0",
  "duct-tick": "#8d96a3",
  "cable-label": "#d5dae0",
  "cable-label-halo": "#0b0c0e",
  "tip-bg": "#0b0c0e",
  "tip-text-dim": "#a9afb7",
  "float-bg": "#0b0c0eee",
  "float-text": "#c9ced4",
  "vm-link": "#9aa3b2",
  "vm-edge": "#5fc3d4",
  "diagram-edge": "#4a4f57",
  "diagram-subtext": "#7d838c",
  "cloud-fill": "#202a38",
  "link-end-text": "#b6bcc4",
  "row-divider": "#24272c",
};

export type Token = keyof typeof DARK;

// Light set: the app frame and the drawings. Also what exports draw with.
// The rack frame stays graphite (real racks are dark) on a light page; empty U space is light.
// Cable plugs, tooltips and the "why" badge are physical or floating dark objects and keep their dark values.
export const LIGHT: Record<Token, string> = {
  bg: "#f4f5f7",
  panel: "#ffffff",
  "panel-2": "#f0f2f5",
  control: "#ffffff",
  border: "#c9ced6",
  "border-subtle": "#e1e4e8",
  text: "#1f2328",
  "text-muted": "#57606a",
  "text-dim": "#5f6670",
  "text-faint": "#7a828c",
  accent: "#2a6fdb",
  brand: "#2a6fdb",
  "accent-soft": "#dce8fa",
  "on-accent": "#ffffff",
  select: "#e0a800",
  danger: "#cf222e",
  ok: "#1a7f37",
  "ok-bright": "#1f9d45",
  warn: "#9a6700",
  focus: "#2a6fdb",
  scrollbar: "#c5cad1",
  hover: "#eaedf1",
  "hover-border": "#aeb5be",
  overlay: "#0006",
  "row-hover": "#eef1f5",
  "accent-border": "#7aa5e6",
  link: "#0969da",
  "danger-bg": "#ffebe9",
  "ok-bg": "#dafbe1",
  "danger-text": "#cf222e",
  "ok-text": "#1a7f37",
  "warn-bg": "#fff8c5",
  "error-text": "#a40e26",
  "error-bg": "#ffebe9",
  card: "#ffffff",
  inset: "#f6f8fa",
  "mini-rack-bg": "#eef0f3",
  "mini-rack-border": "#9aa1ab",
  "mini-device": "#8a929e",
  "overlay-strong": "#0008",
  "border-faint": "#eaecef",
  "text-muted-alt": "#57606a",
  "row-hover-blue": "#e3edfb",
  "log-bg": "#f6f8fa",
  ink: "#101113",
  edge: "#00000033",
  shadow: "#0003",
  "icon-frame": "#6b727c",
  "icon-post": "#4a5059",
  "icon-slot": "#c9ced6",
  "why-text": "#fff",
  "rack-post": "#3a3e45",
  "rack-edge": "#2a2d33",
  "rack-panel": "#4a4f57",
  "rack-dark": "#24272c",
  "rack-bar": "#33363c",
  "rack-foot": "#2c2f35",
  "rack-cap": "#454a52",
  "rack-handle": "#5a5f68",
  "rack-base": "#33363c",
  "rack-body": "#3a3e45",
  "rack-subtitle": "#a9b0b9",
  "rack-title": "#e6e8eb",
  "rack-well": "#e9ecf0",
  "rack-well-edge": "#8a919b",
  "u-stripe": "#dde1e6",
  "u-hole": "#9aa1ab",
  "u-label": "#c9ced6",
  "mgr-face": "#2a2d32",
  "why-bg": "#000d",
  "badge-ink": "#1b1d21",
  "plug-head": "#c9ced5",
  "plug-edge": "#4a4f57",
  "plug-tip": "#f4f6f8",
  "plug-latch": "#d8dce1",
  "plug-metal": "#b9bfc7",
  "plug-pin": "#7b818a",
  "plug-c13-edge": "#7d838c",
  "plug-c14-edge": "#9aa0a8",
  "plug-c13-body": "#202226",
  "plug-c14-body": "#14151a",
  "plug-boot": "#2b2d31",
  "plug-console": "#7a8fa6",
  "plug-white": "#e4e8ec",
  "cable-under-light": "#6b727c",
  "cable-shadow": "#000",
  "duct-fill": "#b8c0cc",
  "duct-tick": "#7d8693",
  "cable-label": "#1f2328",
  "cable-label-halo": "#ffffff",
  "tip-bg": "#0b0c0e",
  "tip-text-dim": "#a9afb7",
  "float-bg": "#ffffffee",
  "float-text": "#3d444d",
  "vm-link": "#6b7480",
  "vm-edge": "#1b8a9c",
  "diagram-edge": "#8a919b",
  "diagram-subtext": "#57606a",
  "cloud-fill": "#e3ebf7",
  "link-end-text": "#3d444d",
  "row-divider": "#e1e4e8",
};

export const v = (t: Token) => `var(--rw-${t})`;

export const palette = (name: ThemeName): Record<Token, string> => (name === "light" ? LIGHT : DARK);

export function currentTheme(): ThemeName {
  try { return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark"; } catch { return "dark"; }
}

export function resolveTheme(pref: ThemePref, prefersDark: boolean): ThemeName {
  return pref === "system" ? (prefersDark ? "dark" : "light") : pref;
}

let lastAccent: string | null = null;

export function applyTheme(name: ThemeName, el?: HTMLElement): void {
  const target = el ?? document.documentElement;
  target.setAttribute("data-theme", name);
  for (const [k, val] of Object.entries(palette(name))) target.style.setProperty(`--rw-${k}`, val);
  applyAccent(lastAccent, el);
}

export function resolveVars(s: string, palette: Record<string, string>): string {
  return s.replace(/var\(--rw-([a-z0-9-]+)\s*(?:,\s*([^)]*?))?\s*\)/gi, (m, name: string, fb?: string) =>
    palette[name] ?? (fb !== undefined ? fb : m));
}

/** Replace var(--rw-*) in presentation attributes and style attributes of every element, so svg2pdf sees literal colours. */
export function resolveSvgVars(svg: Element, palette: Record<string, string> = DARK): void {
  const els = [svg, ...Array.from(svg.querySelectorAll("*"))];
  for (const el of els) {
    for (const a of ["fill", "stroke", "stop-color", "color", "style"]) {
      const val = el.getAttribute(a);
      if (val && val.includes("var(")) el.setAttribute(a, resolveVars(val, palette));
    }
  }
}

export const isHex6 = (s: string) => /^#[0-9a-fA-F]{6}$/.test(s);

/** Mix two #rrggbb colours; t is the share of a (0 to 1). */
export function mixHex(a: string, b: string, t: number): string {
  const ch = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return "#" + [0, 1, 2].map((i) => Math.round(ch(a, i) * t + ch(b, i) * (1 - t)).toString(16).padStart(2, "0")).join("");
}

export function applyAccent(hex: string | null, el?: HTMLElement): void {
  const target = el ?? document.documentElement;
  lastAccent = hex;
  const ok = !!hex && isHex6(hex);
  const light = (target.getAttribute("data-theme") ?? "dark") === "light";
  const pal = light ? LIGHT : DARK;
  target.style.setProperty("--rw-accent", ok ? hex! : pal.accent);
  target.style.setProperty("--rw-accent-soft", ok ? mixHex(hex!, pal.panel, light ? 0.18 : 0.25) : pal["accent-soft"]);
}
