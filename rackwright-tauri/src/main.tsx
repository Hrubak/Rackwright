import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import WebShell from "./WebShell";
import { IS_WEB } from "./backend";
import { SettingsProvider } from "./settings/context";
import { applyTheme } from "./theme";
applyTheme("dark");
createRoot(document.getElementById("root")!).render(IS_WEB ? <WebShell /> : <SettingsProvider><App /></SettingsProvider>);
