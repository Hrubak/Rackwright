import type { Prefs, StartScreen } from "./types";

/** Which screen to show first. The Clients dashboard unless the person chose another. */
export const startScreen = (p: Prefs): StartScreen => p.start ?? "clients";
