export type Cmd = "new" | "open" | "save" | "saveAs" | "undo" | "redo" | "duplicate" | "delete" | "fit" | "deselect";

export const SHORTCUTS: Record<Cmd, string> = {
  new: "Ctrl+N", open: "Ctrl+O", save: "Ctrl+S", saveAs: "Ctrl+Shift+S", undo: "Ctrl+Z",
  redo: "Ctrl+Y", duplicate: "Ctrl+D", delete: "Delete", fit: "Home", deselect: "Escape",
};

export interface KeyLike { key: string; ctrlKey: boolean; metaKey?: boolean; shiftKey: boolean; altKey?: boolean }

/** Modifiers must match exactly; Ctrl matches ctrlKey or metaKey. */
export function matches(e: KeyLike, shortcut: string): boolean {
  const parts = shortcut.split("+");
  const key = parts[parts.length - 1].toLowerCase();
  const mods = parts.slice(0, -1).map((m) => m.toLowerCase());
  return e.key.toLowerCase() === key
    && !!(e.ctrlKey || e.metaKey) === mods.includes("ctrl")
    && e.shiftKey === mods.includes("shift")
    && !!e.altKey === mods.includes("alt");
}

export function commandFor(e: KeyLike): Cmd | null {
  for (const c of Object.keys(SHORTCUTS) as Cmd[]) if (matches(e, SHORTCUTS[c])) return c;
  if (matches(e, "Ctrl+Shift+Z")) return "redo";
  return null;
}
