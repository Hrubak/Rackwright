import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import WebShell from "./WebShell";
import { IS_WEB } from "./backend";
import { SettingsProvider } from "./settings/context";
import { applyTheme, resolveTheme } from "./theme";
import type { ThemePref } from "./settings/types";
function startTheme() {
  let pref: ThemePref = "dark", dark = true;
  try { const s = localStorage.getItem("rw.theme"); if (s === "dark" || s === "light" || s === "system") pref = s; } catch { /* default */ }
  try { if (typeof matchMedia === "function") dark = matchMedia("(prefers-color-scheme: dark)").matches; } catch { /* default */ }
  applyTheme(resolveTheme(pref, dark));
}
startTheme();
createRoot(document.getElementById("root")!).render(IS_WEB ? <WebShell /> : <SettingsProvider><App /></SettingsProvider>);
