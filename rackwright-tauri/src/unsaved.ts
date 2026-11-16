// Unsaved-changes safety, for the desktop and the web app:
//  - useLeaveGuard: warn before the tab is reloaded/closed (web) or the window is closed (desktop).
//  - Recovery drafts: the open rack is copied to localStorage while it has unsaved changes,
//    so a crash, a closed tab or a power cut can be undone on the next start.
import { useEffect, useRef } from "react";
import { IS_WEB } from "./backend";
import type { Doc } from "./types";

export interface Draft {
  doc: Doc;
  /** Desktop: the file it came from. */
  path: string | null;
  /** Web: the shared rack it came from. */
  cur: { id: number; name: string; version: number } | null;
  /** When it was written (ms since 1970). */
  at: number;
}

const keyOf = (who: string) => `rw.draft.${who}`;

export function readDraft(who: string): Draft | null {
  try {
    const s = localStorage.getItem(keyOf(who));
    if (!s) return null;
    const d = JSON.parse(s) as Draft;
    return d && d.doc && Array.isArray(d.doc.racks) && Array.isArray(d.doc.devices) ? d : null;
  } catch { return null; }
}

/** Returns false when the browser refused (storage full or blocked). */
export function writeDraft(who: string, d: Omit<Draft, "at">): boolean {
  try { localStorage.setItem(keyOf(who), JSON.stringify({ ...d, at: Date.now() })); return true; } catch { return false; }
}

export function clearDraft(who: string) {
  try { localStorage.removeItem(keyOf(who)); } catch { /* ignore */ }
}

/** A name for the draft, for the restore prompt. */
export function draftName(d: Draft): string {
  if (d.cur) return d.cur.name;
  if (d.path) return d.path.split(/[\\/]/).pop() || d.path;
  const r = d.doc.racks.map((x) => x.name).filter(Boolean);
  return r.length ? `unsaved rack (${r.slice(0, 3).join(", ")}${r.length > 3 ? ", ..." : ""})` : "unsaved rack";
}

export const LEAVE_TEXT = "You have unsaved changes. Leave and lose them?";

/** Warn before the page or window goes away while `dirty` is true. */
export function useLeaveGuard(dirty: boolean) {
  const ref = useRef(dirty);
  ref.current = dirty;
  useEffect(() => {
    if (IS_WEB) {
      const h = (e: BeforeUnloadEvent) => { if (ref.current) { e.preventDefault(); e.returnValue = ""; } };
      window.addEventListener("beforeunload", h);
      return () => window.removeEventListener("beforeunload", h);
    }
    let off: (() => void) | undefined;
    let gone = false;
    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const { ask } = await import("@tauri-apps/plugin-dialog");
        const f = await getCurrentWindow().onCloseRequested(async (e) => {
          if (!ref.current) return;
          const ok = await ask("You have unsaved changes. Close Rackwright and lose them?",
            { title: "Unsaved changes", kind: "warning", okLabel: "Close without saving", cancelLabel: "Keep editing" });
          if (!ok) e.preventDefault();
        });
        if (gone) f(); else off = f;
      } catch { /* not running inside Tauri (plain Vite dev server) */ }
    })();
    return () => { gone = true; off?.(); };
  }, []);
}
