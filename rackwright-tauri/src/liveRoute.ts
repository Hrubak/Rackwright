// Live re-routing while a device is dragged: a provisional copy of the document with the device at its
// drop target, and a throttled router (one request in flight, always the latest position next).
import type { Doc, PortPos, RouteResult } from "./types";
import type { Target } from "./edit";

/** A copy of `doc` with device `id` at the drag target, or null when the target is not a valid place to drop. */
export function provisionalDoc(doc: Doc, id: number, t: Target): Doc | null {
  const i = doc.devices.findIndex((d) => d.id === id);
  if (i < 0) return null;
  let dev;
  if (t.kind === "rack") {
    if (!t.p.ok) return null;
    dev = { ...doc.devices[i], rack: t.r.id, u: t.u, side: t.side };
  } else if (t.kind === "float") {
    dev = { ...doc.devices[i], rack: null, fx: Math.round(t.fx), fy: Math.round(t.fy) };
  } else return null;
  const devices = doc.devices.slice(); devices[i] = dev;
  return { ...doc, devices };
}

/** Same target as last time? Used to skip identical requests while the cursor stays in one slot. */
export function targetKey(id: number, t: Target): string {
  if (t.kind === "rack") return `${id}:r${t.r.id}:${t.u}:${t.side}:${t.p.ok ? 1 : 0}`;
  if (t.kind === "float") return `${id}:f${Math.round(t.fx)}:${Math.round(t.fy)}`;
  return `${id}:none`;
}

export interface LiveResult { routes: RouteResult; ports: PortPos[] }

export class LiveRouter {
  private busy = false;
  private pending: { doc: Doc; face: "front" | "rear" } | null = null;
  private last = -Infinity;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private gen = 0;
  /** Requests actually sent (for tests). */
  sent = 0;
  constructor(
    private route: (doc: Doc, face: "front" | "rear") => Promise<LiveResult>,
    private onResult: (doc: Doc, r: LiveResult) => void,
    private onError: (e: unknown) => void,
    private minGap = 40,
    private now: () => number = () => Date.now(),
  ) {}

  /** Ask for routes for `doc`. Only the newest unsent request is kept. */
  request(doc: Doc, face: "front" | "rear") { this.pending = { doc, face }; this.pump(); }

  /** Forget everything queued and ignore any answer still on its way. */
  cancel() {
    this.gen++; this.pending = null;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  private pump() {
    if (this.busy || !this.pending || this.timer) return;
    const wait = this.last + this.minGap - this.now();
    if (wait > 0) { this.timer = setTimeout(() => { this.timer = null; this.pump(); }, wait); return; }
    const job = this.pending; this.pending = null;
    this.busy = true; this.last = this.now(); this.sent++;
    const g = this.gen;
    this.route(job.doc, job.face)
      .then((r) => { if (g === this.gen) this.onResult(job.doc, r); })
      .catch((e) => { if (g === this.gen) this.onError(e); })
      .finally(() => { this.busy = false; this.pump(); });
  }
}
