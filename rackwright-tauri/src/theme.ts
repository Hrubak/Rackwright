// Theme tokens. Every value equals the hex it replaces; dark must look as before.
export type ThemeName = "dark";

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

export const v = (t: Token) => `var(--rw-${t})`;

export function applyTheme(name: ThemeName, el?: HTMLElement): void {
  const target = el ?? document.documentElement;
  target.setAttribute("data-theme", name);
  for (const [k, val] of Object.entries(DARK)) target.style.setProperty(`--rw-${k}`, val);
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
