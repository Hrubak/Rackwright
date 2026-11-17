import EquipmentSidebar from "./equip/EquipmentSidebar";
import { v } from "./theme";
import pkg from "../package.json";
import { About } from "./About";
import { Logo } from "./Logo";
import { CableOverlay, CableColorMode } from "./Cables";
import type { ReactNode } from "react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { backend, IS_WEB } from "./backend";
import * as A from "./api";
import { ConflictDialog, NamePrompt, RackList, UserBar, WebProps } from "./web";
import RackView, { Resolver, Sel } from "./RackView";
import { DropButton, MenuBar, MenuItem, SEP } from "./Menu";
import { SHORTCUTS, commandFor } from "./shortcuts";
import { ShortcutsDialog, WhatsNewDialog } from "./HelpDialogs";
import { Device, Doc, PortPos, RouteResult } from "./types";
import { LiveRouter, provisionalDoc, targetKey } from "./liveRoute";
import type { Target } from "./edit";
import InfraView from "./views/InfraView";
import SwitchView from "./views/SwitchView";
import EndpointsView from "./views/EndpointsView";

type ViewId = "rack" | "infra" | "switch" | "endpoints";
const VIEWS: [ViewId, string][] = [["rack", "Rack"], ["infra", "Infrastructure"], ["switch", "Switch"], ["endpoints", "Endpoints"]];
import RackPicker, { PickResult } from "./RackPicker";
import { fmtDims } from "./units";
import { useSettings } from "./settings/context";
import SettingsScreen, { SettingsTab } from "./settings/SettingsScreen";
import { RACK_MODELS, genericDefaultU, kindLabel, specOf, modelById } from "./racks";
import { AuvikInfo, EndpointTable, UnplacedDialog } from "./auvik/Panels";
import DevicePanel from "./panel/DevicePanel";
import ModelPicker from "./ModelPicker";
import { resizeDevice, swapModel } from "./swapModel";
import { CableOpts, loadOpts, saveOpts, visibleCables } from "./cableView";
import ClientsPanel from "./clients/ClientsPanel";
import { Breadcrumb } from "./Breadcrumb";
import Dashboard, { type ClientTab } from "./home/Dashboard";
import { findRackLocation, sameFile, type RackLocation } from "./location";
import { RackItem, clientStore } from "./clients/store";
import { UpdateBanner } from "./version/UpdateBanner";
import { useDesktopUpdates } from "./version/useDesktopUpdates";
import { useWebUpdates } from "./version/useWebUpdates";
import { Draft, LEAVE_TEXT, clearDraft, draftName, readDraft, useLeaveGuard, writeDraft } from "./unsaved";
const ImportAuvik = lazy(() => import("./auvik/ImportAuvik"));
const ReportDialog = lazy(() => import("./report/ReportDialog"));
import {
  CATALOG, addRack, applySpec, resizeRack, buildFromText, checkPlace, clone, deleteDevice, deleteRack, duplicateDevice, fromTpl, newCable,
  placeNew, portOf, protoOf, rackUsage, shapeOf, tplRackStatus, MOUNTS, Mount, mountOf, setMount, sidesOf, stepSide, upgradeDoc, widthLabel,
} from "./edit";

const empty: Doc = { v: 1, nid: 1, racks: [], devices: [], cables: [] };
const none: RouteResult = { routes: [], hints: [] };
const btn = { background: v("control"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "5px 12px", marginRight: 5, cursor: "pointer" } as const;
const inp = { background: v("bg"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "4px 6px" } as const;

const PROTOS = CATALOG.map((t) => protoOf(t));
const icon = (i: number) => {
  const s = shapeOf({ ...PROTOS[i], rack: null });
  return s === "disc" ? "●" : s === "squircle" ? "▢" : "▬";
};

export type { ClientTab };
type Screen = { kind: "home" } | { kind: "client"; key: string; tab: ClientTab; site?: number } | { kind: "editor" };

interface Cur { id: number; name: string; version: number }

export default function App({ web }: { web?: WebProps } = {}) {
  const settings = useSettings();
  const [doc, setDoc] = useState<Doc>(empty);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [helpDlg, setHelpDlg] = useState<"shortcuts" | "news" | null>(null);
  const [clientsImport, setClientsImport] = useState(false);
  const [screen, setScreen] = useState<Screen>({ kind: "home" });
  const [importTick, setImportTick] = useState(0);
  const [undo, setUndo] = useState<Doc[]>([]);
  const [redo, setRedo] = useState<Doc[]>([]);
  const [dirty, setDirty] = useState(false);
  const [path, setPath] = useState<string | null>(null);
  // Web only: the shared rack being edited (null = not saved yet), and the dialogs around it.
  const [cur, setCur] = useState<Cur | null>(null);
  const [showRacks, setShowRacks] = useState(false);
  const [nameAsk, setNameAsk] = useState<{ title: string; initial: string; cb: (n: string) => void } | null>(null);
  const [conflict, setConflict] = useState<{ by: string } | null>(null);
  const [face, setFace] = useState<"front" | "rear">("front");
  const [routes, setRoutes] = useState<RouteResult>(none);
  const [ports, setPorts] = useState<PortPos[]>([]);
  const [sel, setSel] = useState<Sel>(null);
  const [view, setView] = useState<ViewId>("rack");
  // while a device is dragged: a provisional document with the routes and ports computed for it
  const [live, setLive] = useState<{ doc: Doc; routes: RouteResult; ports: PortPos[] } | null>(null);
  const dragKey = useRef("");
  const liveRouter = useRef<LiveRouter | null>(null);
  if (!liveRouter.current) liveRouter.current = new LiveRouter(
    (d, f) => Promise.all([backend.routeCables(d, f), backend.portPositions(d)]).then(([routes, ports]) => ({ routes, ports })),
    (d, r) => setLive({ doc: d, routes: r.routes, ports: r.ports }),
    (e) => setMsg(String(e instanceof Error ? e.message : e)),
  );
  const [pending, setPending] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [toast, setToast] = useState<{ text: string; bad: boolean } | null>(null);
  const [fitsOnly, setFitsOnly] = useState(false);
  const [palSel, setPalSel] = useState<number | null>(null);
  const [pdrag, setPdrag] = useState<{ i: number; x: number; y: number; active: boolean } | null>(null);
  const [cableColor, setCableColor] = useState<CableColorMode>(() => { try { return localStorage.getItem("rw.cableColor") === "type" ? "type" : "own"; } catch { return "own"; } });
  const [cableOpts, setCableOpts] = useState<CableOpts>(loadOpts);
  const [epFocus, setEpFocus] = useState<{ dev: number; idx: number } | null>(null);
  const [fitTick, setFitTick] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [auvikOpen, setAuvikOpen] = useState(false);
  const [clientsOpen, setClientsOpen] = useState(false);
  const [reportFor, setReportFor] = useState<string | null>(null); // "" = no client preselected
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [clientsTarget, setClientsTarget] = useState<{ client?: string; site?: number }>({});
  const [loc, setLoc] = useState<RackLocation | null | "unassigned">(null);
  const [wide, setWide] = useState(() => window.innerWidth >= 1280);
  useEffect(() => { const r = () => setWide(window.innerWidth >= 1280); window.addEventListener("resize", r); return () => window.removeEventListener("resize", r); }, []);
  const [equipCollapsed, setEquipCollapsedRaw] = useState(() => {
    try { const s = localStorage.getItem("rw.equipCollapsed"); if (s === "1" || s === "0") return s === "1"; } catch { /* ignore */ }
    return window.innerWidth < 1280;
  });
  const setEquipCollapsed = (b: boolean) => { setEquipCollapsedRaw(b); try { localStorage.setItem("rw.equipCollapsed", b ? "1" : "0"); } catch { /* ignore */ } };
  const [unplacedOpen, setUnplacedOpen] = useState(false);
  const [modelFor, setModelFor] = useState<number | null>(null);
  const [picker, setPicker] = useState<"new" | "add" | null>(null);
  const [importText, setImportText] = useState("");
  const [importH, setImportH] = useState("0");
  const resolveRef = useRef<Resolver>(() => ({ kind: "none" }));
  const lastKey = useRef<{ k: string; t: number }>({ k: "", t: 0 });
  const toastTimer = useRef<number>(0);
  const pdragRef = useRef(pdrag);
  pdragRef.current = pdrag;

  const say = useCallback((text: string, bad = false) => {
    setToast({ text, bad });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }, []);
  const pick = useCallback((s: Sel) => {
    setSel(s);
    if (s && s.kind === "dev" && !panelOpen) {
      try { if (!localStorage.getItem("rw.hintDbl")) { localStorage.setItem("rw.hintDbl", "1"); say("Double-click a device to open its details."); } } catch { /* ignore */ }
    }
  }, [panelOpen, say]);
  const openPanel = useCallback((s: Sel) => { setSel(s); setPanelOpen(true); }, []);

  useEffect(() => {
    let stale = false;
    Promise.all([backend.routeCables(doc, face), backend.portPositions(doc)])
      .then(([r, p]) => { if (!stale) { setRoutes(r); setPorts(p); setLive(null); } })
      .catch((e) => setMsg(String(e instanceof Error ? e.message : e)));
    return () => { stale = true; };
  }, [doc, face]);

  /** Apply an edit to a copy of the document, with undo. fn returns a status message, or "!msg" to reject the edit.
   *  Repeated edits with the same `key` within ~1.2s (typing in a field) share one undo step. */
  const edit = useCallback((fn: (d: Doc) => string | void, key?: string): boolean => {
    const next = clone(doc);
    const m = fn(next) || "";
    if (m.startsWith("!")) { say(m.slice(1), true); return false; }
    const now = Date.now();
    const merge = !!key && lastKey.current.k === key && now - lastKey.current.t < 1200;
    lastKey.current = { k: key || "", t: now };
    if (!merge) setUndo((u) => [...u.slice(-99), doc]);
    setRedo([]);
    setDoc(next);
    setDirty(true);
    setMsg(m);
    if (m) say(m);
    return true;
  }, [doc, say]);

  const doUndo = useCallback(() => {
    if (!undo.length) return;
    lastKey.current = { k: "", t: 0 };
    setRedo((r) => [...r, doc]); setDoc(undo[undo.length - 1]); setUndo(undo.slice(0, -1)); setDirty(true); setSel(null);
  }, [undo, doc]);
  const doRedo = useCallback(() => {
    if (!redo.length) return;
    lastKey.current = { k: "", t: 0 };
    setUndo((u) => [...u, doc]); setDoc(redo[redo.length - 1]); setRedo(redo.slice(0, -1)); setDirty(true); setSel(null);
  }, [redo, doc]);

  const del = useCallback(() => {
    if (!sel) return;
    edit((d) => {
      if (sel.kind === "cable") d.cables = d.cables.filter((c) => c.id !== sel.id);
      else if (sel.kind === "dev") deleteDevice(d, sel.id);
      else deleteRack(d, sel.id);
    });
    setSel(null);
  }, [sel, edit]);

  // Unsaved-changes safety: warn before leaving, and keep a recovery draft (see unsaved.ts).
  const who = IS_WEB ? `web${web?.user.id ?? 0}` : "desktop";
  const [offer, setOffer] = useState<Draft | null>(() => readDraft(who));
  useLeaveGuard(dirty);
  const draftFail = useRef(false);
  useEffect(() => {
    if (offer) return; // the restore prompt is still open: keep the old draft until it is answered
    if (!dirty) { clearDraft(who); return; }
    const t = window.setTimeout(() => {
      const ok = writeDraft(who, { doc, path, cur });
      if (!ok && !draftFail.current) say("Could not keep a recovery copy (browser storage is full). Save often.", true);
      draftFail.current = !ok;
    }, 1000);
    return () => window.clearTimeout(t);
  }, [doc, dirty, path, cur, offer, who, say]);
  const restoreDraft = () => {
    if (!offer) return;
    reset(offer.doc, offer.path, offer.cur); setDirty(true); setOffer(null);
    say("Restored your unsaved changes. Save them when you are ready.");
  };
  const discardDraft = () => { clearDraft(who); setOffer(null); };
  const webGuarded: WebProps | undefined = web && {
    ...web,
    signOut: () => { if (dirty && !confirm(LEAVE_TEXT)) return; clearDraft(who); web.signOut(); },
  };

  const deskUpd = useDesktopUpdates();
  const checkUpdates = async () => {
    const r = await deskUpd.checkNow();
    say(!r.ok ? "Could not check for updates. Check your internet connection." : r.offer ? `Rackwright ${r.offer.version} is available.` : `You have the newest version (${pkg.version}).`);
  };
  const webUpd = useWebUpdates(IS_WEB && !!web, !!web?.user.is_admin);

  const reset = (d: Doc, p: string | null, c: Cur | null = null) => { setDoc(upgradeDoc(d)); setPath(p); setCur(c); setUndo([]); setRedo([]); setSel(null); setPending(null); setDirty(false); setFitTick((n) => n + 1); };
  const doNew = () => { if (!dirty || confirm("Discard unsaved changes?")) setPicker("new"); };
  const onPick = (r: PickResult) => {
    const mode = picker; setPicker(null);
    if (mode === "new") {
      const d = clone(empty); const rk = addRack(d, r.name, r.u, specOf(r.model));
      reset(d, null); setSel({ kind: "rack", id: rk.id });
    } else if (mode === "add") edit((d) => { const rk = addRack(d, r.name, r.u, specOf(r.model)); setSel({ kind: "rack", id: rk.id }); });
  };
  const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

  const doOpen = async () => {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    if (IS_WEB) { setShowRacks(true); return; }
    try {
      const r = await backend.openDoc();
      if (r) { reset(r.doc, r.path); setMsg(""); }
    } catch (e) { setMsg(String(e)); }
  };

  const loadShared = async (id: number): Promise<boolean> => {
    try {
      const r = await A.getRack(id);
      reset(r.doc, null, { id: r.id, name: r.name, version: r.version });
      setMsg(""); setShowRacks(false);
      return true;
    } catch (e) { say(errText(e), true); return false; }
  };

  /** Web: PUT the current rack (or POST when new). Handles the 409 conflict flow. */
  const saveShared = useCallback(async (name: string, c: Cur | null, d: Doc) => {
    try {
      const m = c ? await A.updateRack(c.id, name, d, c.version) : await A.createRack(name, d);
      setCur({ id: m.id, name: m.name, version: m.version }); setDirty(false); say("Saved");
    } catch (e) {
      if (e instanceof A.ApiError && e.status === 409 && c) setConflict({ by: String(e.body?.updated_by ?? "") });
      else say(errText(e), true);
    }
  }, [say]);

  const doSave = useCallback(async (asNew = false) => {
    if (IS_WEB) {
      if (cur && !asNew) { saveShared(cur.name, cur, doc); return; }
      setNameAsk({ title: asNew ? "Save as new shared rack" : "Save rack", initial: cur?.name ?? "", cb: (n) => { setNameAsk(null); saveShared(n, null, doc); } });
      return;
    }
    try {
      const p = await backend.saveDoc(asNew ? null : path, doc);
      if (p) { setPath(p); setDirty(false); say("Saved"); }
    } catch (e) { say(String(e), true); }
  }, [path, cur, doc, say, saveShared]);

  /** Clients screen: open a rack from a site. */
  const openFromClient = async (r: RackItem, devId?: number) => {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    if (IS_WEB) {
      if (r.id == null) return;
      await loadShared(r.id);
    } else {
      try { const d = await clientStore().loadDoc(r); reset(d, r.path ?? null); setMsg(""); } catch (e) { say(errText(e), true); return; }
    }
    setClientsOpen(false);
    if (devId != null) { setView("rack"); setSel({ kind: "dev", id: devId }); }
  };
  /** Web, Clients screen: save the open rack (not saved yet) as a new shared rack in a site. */
  const saveCurrentTo = async (siteId: number) => {
    const name = prompt("Name for this rack:", doc.racks[0]?.name ?? "")?.trim();
    if (!name) return false;
    const m = await A.createRack(name, doc, siteId);
    setCur({ id: m.id, name: m.name, version: m.version }); setDirty(false); say("Saved");
    return true;
  };

  const conflictTheirs = async () => { setConflict(null); if (cur) await loadShared(cur.id); };
  const conflictMine = async () => {
    setConflict(null);
    if (!cur) return;
    try {
      const latest = await A.getRack(cur.id); // pick up the current version, then overwrite it
      await saveShared(cur.name, { ...cur, version: latest.version }, doc);
    } catch (e) { say(errText(e), true); }
  };

  const doImportFile = async () => {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    try {
      const r = await A.importFile();
      if (r) { reset(r.doc, null); setMsg("Imported " + r.name); }
    } catch (e) { say(errText(e), true); }
  };
  const doExportFile = () => A.exportFile(cur?.name ?? "rack", doc);
  const exportName = () => cur?.name ?? (path ? path.split(/[\\/]/).pop()!.replace(/\.rack\.json$|\.json$/i, "") : undefined);
  const doExport = async (kind: "pdf" | "visio") => {
    say(kind === "pdf" ? "Making the PDF..." : "Making the Visio file...");
    try {
      const x = await import("./export");
      const saved = await (kind === "pdf" ? x.exportPdf(doc, exportName()) : x.exportVisio(doc, exportName()));
      if (saved) say("Export saved");
    } catch (e) { say(errText(e), true); }
  };

  const onPort = (pid: number) => {
    if (pending == null) { setPending(pid); say("Click a second port to connect"); return; }
    if (pending === pid) { setPending(null); return; }
    let newId = 0;
    const ok = edit((d) => {
      const c = newCable(d, pending, pid);
      if (typeof c === "string") return "!" + c;
      newId = c.id;
    });
    if (ok) setSel({ kind: "cable", id: newId });
    setPending(null);
  };

  const onMoveDevice = (id: number, rack: number | null, u: number, side: number, fx: number, fy: number) =>
    edit((d) => {
      const dev = d.devices.find((x) => x.id === id)!;
      dev.rack = rack; if (rack != null) { dev.u = u; dev.side = side; } else { dev.fx = fx; dev.fy = fy; }
    });

  const onDragTarget = useCallback((id: number, t: Target) => {
    const k = targetKey(id, t);
    if (k === dragKey.current) return;
    dragKey.current = k;
    const pd = provisionalDoc(doc, id, t);
    if (pd) liveRouter.current!.request(pd, face); // an invalid target keeps the last cables on screen
  }, [doc, face]);
  // Dropped (the saved routes replace the live ones when they arrive) or cancelled (back to the saved routes now).
  const onDragEnd = useCallback((committed: boolean) => {
    dragKey.current = ""; liveRouter.current!.cancel();
    if (!committed) setLive(null);
  }, []);

  const targetRack = () => {
    const rid = sel?.kind === "rack" ? sel.id : sel?.kind === "dev" ? doc.devices.find((x) => x.id === sel.id)?.rack : null;
    return doc.racks.find((r) => r.id === rid) ?? (doc.racks.length === 1 ? doc.racks[0] : undefined);
  };

  const addFromCatalog = (i: number) => {
    let id = 0;
    const ok = edit((d) => {
      const dev = fromTpl(d, CATALOG[i]);
      id = dev.id;
      return placeNew(d, dev, face, targetRack()?.id ?? null);
    });
    if (ok) setSel({ kind: "dev", id });
  };

  /** A palette drag was released at client (x, y). */
  const dropPalette = useCallback((i: number, x: number, y: number) => {
    const proto = { ...PROTOS[i], face: CATALOG[i].plate ? "both" : face };
    const t = resolveRef.current(proto, x, y);
    if (t.kind === "none") return;
    if (t.kind === "rack" && !t.p.ok) { say(t.p.why || "Can't place it there", true); return; }
    let id = 0;
    const ok = edit((d) => {
      const dev = fromTpl(d, CATALOG[i]);
      id = dev.id; dev.face = proto.face;
      if (t.kind === "rack") { dev.rack = t.r.id; dev.u = t.u; dev.side = t.side; }
      else { dev.rack = null; dev.fx = t.fx; dev.fy = t.fy; }
      d.devices.push(dev);
      if (t.kind === "rack" && t.p.warn) return t.p.warn;
    });
    if (ok) setSel({ kind: "dev", id });
  }, [edit, face, say]);

  const startPdrag = (e: React.MouseEvent, i: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setPalSel(i);
    setPdrag({ i, x: e.clientX, y: e.clientY, active: false });
  };
  const dragging = pdrag != null;
  useEffect(() => {
    if (!dragging) return;
    const mm = (e: MouseEvent) => setPdrag((p) => p && { ...p, x: e.clientX, y: e.clientY, active: p.active || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 4 });
    const mu = (e: MouseEvent) => {
      const p = pdragRef.current; setPdrag(null);
      if (p && p.active) dropPalette(p.i, e.clientX, e.clientY);
    };
    const kd = (e: KeyboardEvent) => { if (e.key === "Escape") setPdrag(null); };
    window.addEventListener("mousemove", mm); window.addEventListener("mouseup", mu); window.addEventListener("keydown", kd);
    return () => { window.removeEventListener("mousemove", mm); window.removeEventListener("mouseup", mu); window.removeEventListener("keydown", kd); };
  }, [dragging, dropPalette]);

  const doImport = () => {
    let n = 0;
    const ok = edit((d) => {
      n = buildFromText(d, importText, parseInt(importH) || 0);
      return n ? `Imported ${n} rack(s)` : "!No rack lines found. Each line needs a size like (2U).";
    });
    if (ok) { setImportOpen(false); setFitTick((k) => k + 1); }
  };

  const selDev = sel?.kind === "dev" ? doc.devices.find((d) => d.id === sel.id) : undefined;
  const selCable = sel?.kind === "cable" ? doc.cables.find((c) => c.id === sel.id) : undefined;
  const selRack = sel?.kind === "rack" ? doc.racks.find((r) => r.id === sel.id) : undefined;

  /** Move/side/rack changes from the properties panel and the arrow keys, with the full sanity check. */
  const place = useCallback((id: number, rackId: number, u: number, side: number) =>
    edit((d) => {
      const dev = d.devices.find((x) => x.id === id)!;
      const r = d.racks.find((x) => x.id === rackId);
      if (!r) return "!No such rack";
      const p = checkPlace(d, dev, r, u, side);
      if (!p.ok) return "!" + (p.why || "Can't place it there");
      dev.rack = rackId; dev.u = u; dev.side = side;
      return p.warn || "";
    }, `place${id}`), [edit]);

  const doDuplicate = () => {
    if (selDev) { let id = 0; if (edit((d) => { id = duplicateDevice(d, selDev.id)?.id ?? 0; })) setSel({ kind: "dev", id }); }
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = (e.target as HTMLElement).tagName;
      const cmd = commandFor(e);
      if (cmd === "save" || cmd === "saveAs") { e.preventDefault(); doSave(cmd === "saveAs"); return; }
      if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT") return;
      if (cmd) {
        switch (cmd) {
          case "new": e.preventDefault(); doNew(); break;
          case "open": e.preventDefault(); doOpen(); break;
          case "redo": e.preventDefault(); doRedo(); break;
          case "undo": e.preventDefault(); doUndo(); break;
          case "duplicate": e.preventDefault(); doDuplicate(); break;
          case "delete": del(); break;
          case "deselect": if (pending == null && panelOpen) setPanelOpen(false); else { setPending(null); setSel(null); } break;
          case "fit": setFitTick((n) => n + 1); break;
        }
      }
      else if (selDev && selDev.rack != null && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const du = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;
        const ds = e.key === "ArrowLeft" ? stepSide(selDev, -1) : e.key === "ArrowRight" ? stepSide(selDev, 1) : selDev.side;
        place(selDev.id, selDev.rack, selDev.u + du, selDev.half ? ds : 0);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [doUndo, doRedo, del, doSave, doNew, doOpen, doDuplicate, edit, selDev, place, pending, panelOpen]);

  const rackForTags = targetRack();

  const endp = (pid: number) => { const o = portOf(doc, pid); return o ? `${o.d.name} ${o.p.name}` : "?"; };
  const cab = (c: NonNullable<typeof selCable>, patch: Record<string, unknown>) =>
    edit((d) => { Object.assign(d.cables.find((x) => x.id === c.id)!, patch); }, `cab${c.id}`);
  const lockIcon = (dv: Device, k: string) => dv.locked?.includes(k) ? (
    <button title="Next Auvik import may update this field" onClick={(e) => { e.preventDefault(); edit((d) => { const x = d.devices.find((y) => y.id === dv.id)!; x.locked = (x.locked ?? []).filter((f) => f !== k); if (!x.locked.length) delete x.locked; }); }}
      style={{ background: "none", border: "none", cursor: "pointer", padding: "0 3px", fontSize: 11, color: v("warn") }}>{"\u{1F512}"}</button>
  ) : null;
  const field = (label: string, val: string | number, set: (v: string) => void, w = 0, lock?: ReactNode) => (
    <label style={{ display: "block", fontSize: 11, color: v("text-dim") }}>{label}{lock}<br />
      <input style={{ ...inp, width: "100%", boxSizing: "border-box" }} value={val} onChange={(e) => set(e.target.value)} /></label>
  );
  const devSet = (dv: Device, k: "name" | "type" | "ip" | "model" | "serial" | "notes" | "mac", v: string) =>
    edit((d) => {
      const x = d.devices.find((y) => y.id === dv.id)! as any;
      if (x[k] === v) return;
      x[k] = v;
      if (x.auvik_id && !(x.locked ?? []).includes(k)) x.locked = [...(x.locked ?? []), k];
    }, `dev${dv.id}${k}`);
  const legendCables = useMemo(() => { const v = visibleCables(doc, cableOpts, sel, null); return doc.cables.filter((c) => v.has(c.id)); }, [doc, cableOpts, sel]);
  const dragDev = pdrag && pdrag.active ? { ...PROTOS[pdrag.i], face: CATALOG[pdrag.i].plate ? "both" : face } : null;
  const portsCabled = (dv: Device) => dv.ports.filter((p) => doc.cables.some((c) => c.a === p.id || c.b === p.id)).length;
  const sum = (() => {
    const total = doc.racks.reduce((s, r) => s + r.u, 0);
    const used = doc.racks.reduce((s, r) => s + rackUsage(doc, r).used, 0);
    return { total, used, off: doc.devices.filter((d) => d.rack == null).length };
  })();

  const noRacks = !doc.racks.length;
  const needRack = noRacks ? "Add a rack first" : undefined;
  const setCable = (patch: Partial<CableOpts>) => { const o = { ...cableOpts, ...patch }; setCableOpts(o); saveOpts(o); };
  const menus: { label: string; items: MenuItem[] }[] = [
    { label: "File", items: [
      { label: "New", shortcut: IS_WEB ? undefined : SHORTCUTS.new, run: doNew },
      { label: "Open…", shortcut: SHORTCUTS.open, run: doOpen },
      { label: "Save", shortcut: SHORTCUTS.save, run: () => doSave() },
      { label: "Save as…", shortcut: SHORTCUTS.saveAs, run: () => doSave(true) },
      SEP,
      ...(IS_WEB ? [{ label: "Import file…", run: doImportFile }] : []),
      { label: "Import list…", run: () => setImportOpen(true) },
      { label: "Import Auvik…", run: () => setAuvikOpen(true) },
      SEP,
      { label: "Export", items: [
        { label: "Export PDF", run: () => doExport("pdf"), disabled: noRacks, hint: needRack },
        { label: "Export Visio (.vsdx)", run: () => doExport("visio"), disabled: noRacks, hint: needRack },
        ...(IS_WEB ? [{ label: "Export file (.rack.json)", run: doExportFile }] : []),
        { label: "Client report…", run: () => setReportFor(loc && loc !== "unassigned" ? loc.clientKey : "") },
      ] },
    ] },
    { label: "Edit", items: [
      { label: "Undo", shortcut: SHORTCUTS.undo, run: doUndo, disabled: !undo.length },
      { label: "Redo", shortcut: SHORTCUTS.redo, run: doRedo, disabled: !redo.length },
      SEP,
      { label: "Add rack…", run: () => setPicker("add") },
      { label: "Duplicate", shortcut: SHORTCUTS.duplicate, run: doDuplicate, disabled: !selDev, hint: selDev ? undefined : "Select a device first" },
      { label: "Delete", shortcut: SHORTCUTS.delete, run: del, disabled: !sel, hint: sel ? undefined : "Select something first" },
    ] },
    { label: "View", items: [
      ...VIEWS.map(([id, label]): MenuItem => ({ label, checked: view === id, run: () => setView(id) })),
      SEP,
      { label: "Flip front/rear", run: () => setFace(face === "front" ? "rear" : "front"), disabled: view !== "rack", hint: view === "rack" ? undefined : "Only in the Rack view" },
      { label: "Fit to screen", shortcut: SHORTCUTS.fit, run: () => setFitTick((n) => n + 1) },
      SEP,
      { label: "Cables", items: [
        { label: "Show all", checked: cableOpts.show === "all", run: () => setCable({ show: "all" }) },
        { label: "Show selected only", checked: cableOpts.show === "selected", run: () => setCable({ show: "selected" }) },
        { label: "Show none", checked: cableOpts.show === "none", run: () => setCable({ show: "none" }) },
        SEP,
        { label: "Routed", checked: cableOpts.style === "routed", run: () => setCable({ style: "routed" }) },
        { label: "Stubs", checked: cableOpts.style === "stubs", run: () => setCable({ style: "stubs" }) },
        SEP,
        { label: "Hide endpoint cables", checked: cableOpts.hideEndpoints, run: () => setCable({ hideEndpoints: !cableOpts.hideEndpoints }) },
      ] },
    ] },
    { label: "Clients", items: [
      { label: "Clients…", run: () => { setClientsImport(false); setClientsOpen(true); } },
      { label: "Client report…", run: () => setReportFor("") },
      { label: "Import Auvik into a client…", run: () => { setScreen({ kind: "home" }); setImportTick((n) => n + 1); } },
    ] },
    { label: "Help", items: [
      { label: "Keyboard shortcuts…", run: () => setHelpDlg("shortcuts") },
      { label: "What's new…", run: () => setHelpDlg("news") },
      ...(IS_WEB ? [] : [{ label: "Check for updates…", run: checkUpdates }]),
      { label: "About Rackwright…", run: () => setAboutOpen(true) },
    ] },
  ];
  const rackName = IS_WEB ? (cur?.name ?? "New rack") : (path ? path.split(/[\\/]/).pop()! : "New rack");
  useEffect(() => {
    if (clientsOpen) return;
    let stop = false;
    (async () => {
      try {
        if (IS_WEB) {
          if (!cur?.id) { setLoc(null); return; }
          const m = (await A.listRacks()).find((r) => r.id === cur.id);
          if (stop) return;
          setLoc(m && m.site_id != null && m.client_id != null ? { clientKey: String(m.client_id), client: m.client ?? "", siteId: m.site_id, site: m.site ?? "" } : m ? "unassigned" : null);
        } else {
          if (!path) { setLoc(null); return; }
          const st = clientStore();
          const all = await Promise.all((await st.list()).map((c) => st.get(c.key)));
          if (!stop) setLoc(findRackLocation(all, (r) => !!r.path && sameFile(r.path, path)) ?? "unassigned");
        }
      } catch { if (!stop) setLoc(null); }
    })();
    return () => { stop = true; };
  }, [IS_WEB ? cur?.id : path, clientsOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const sepBar = <span style={{ width: 1, alignSelf: "stretch", background: v("border"), margin: "2px 10px" }} />;
  const seg = (opts: [string, string][], curId: string, pick: (id: string) => void, title: (l: string) => string) => opts.map(([id, label], i) => (
    <button key={id} onClick={() => pick(id)} title={title(label)}
      style={{ ...btn, marginRight: 0, borderRadius: i === 0 ? "4px 0 0 4px" : i === opts.length - 1 ? "0 4px 4px 0" : 0, marginLeft: i ? -1 : 0, background: curId === id ? v("accent-soft") : btn.background, borderColor: curId === id ? v("accent-border") : v("border") }}>{label}</button>
  ));

  // Start screen (once, after settings load) and last-rack bookkeeping.
  const reopening = useRef(false);
  const startDone = useRef(false);
  useEffect(() => {
    if (!settings.loaded || startDone.current) return;
    startDone.current = true;
    const start = settings.prefs.start ?? "new";
    if (start !== "clients") setScreen({ kind: "editor" });
    const last = settings.prefs.last_rack;
    if (start === "last" && last) {
      reopening.current = true;
      (async () => {
        let ok = false;
        try {
          if (IS_WEB) { if (last.id != null) ok = await loadShared(last.id); }
          else if (last.path) { const d = await clientStore().loadDoc({ key: last.path, name: last.name ?? "", path: last.path }); reset(d, last.path); setMsg(""); ok = true; }
        } catch { ok = false; }
        if (!ok) say("Could not reopen the last rack.", true);
      })().finally(() => { reopening.current = false; });
    } else if (start === "clients") setScreen({ kind: "home" });
    else if (start === "racks" && IS_WEB) setShowRacks(true);
  }, [settings.loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const lastSent = useRef("");
  const lastRackKey = IS_WEB ? (cur ? `w${cur.id}` : "") : (path ?? "");
  useEffect(() => {
    if (!settings.loaded || !lastRackKey || reopening.current) return;
    const lr = IS_WEB ? { id: cur!.id, name: cur!.name } : { path: path!, name: path!.split(/[\\/]/).pop() };
    const sig = JSON.stringify(lr);
    const old = settings.prefs.last_rack;
    if (sig === lastSent.current || (old && JSON.stringify(IS_WEB ? { id: old.id, name: old.name } : { path: old.path, name: old.name }) === sig)) return;
    const t = window.setTimeout(() => { lastSent.current = sig; settings.savePrefs({ last_rack: lr }).catch(() => {}); }, 1000);
    return () => window.clearTimeout(t);
  }, [lastRackKey, cur?.name, settings.loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", color: v("text"), fontFamily: "Segoe UI, sans-serif", userSelect: pdrag ? "none" : undefined }}>
      <div style={{ minHeight: 42, padding: "6px 10px", background: v("panel"), borderBottom: `1px solid ${v("border-subtle")}`, boxSizing: "border-box", display: "flex", flexWrap: "nowrap", alignItems: "center", whiteSpace: "nowrap" }}>
        <button style={{ background: "none", border: "none", padding: "0 8px 0 0", cursor: "pointer", display: "flex" }} onClick={() => setScreen({ kind: "home" })} title="Home" aria-label="Home"><Logo size={24} /></button>
        <button style={{ ...btn, padding: "5px 8px", marginRight: 8, background: screen.kind === "home" ? v("accent-soft") : v("control") }} onClick={() => setScreen({ kind: "home" })} title="Clients dashboard" aria-label="Home" aria-pressed={screen.kind === "home"}>{"▦"}</button>
        {settings.branding.logo_url && <>
          <div style={{ width: 1, alignSelf: "stretch", margin: "2px 8px 2px 0", background: v("border") }} />
          <img src={settings.branding.logo_url} alt={settings.branding.company_name} title={settings.branding.company_name} style={{ height: 24, maxWidth: 120, objectFit: "contain", marginRight: 8 }} />
        </>}
        <MenuBar menus={menus} />
        {sepBar}
        <Breadcrumb loc={loc} rackName={rackName} dirty={dirty}
          onClient={(k) => { setClientsTarget({ client: k }); setClientsImport(false); setClientsOpen(true); }}
          onSite={(k, id) => { setClientsTarget({ client: k, site: id }); setClientsImport(false); setClientsOpen(true); }} />
        {msg && <span style={{ opacity: 0.7, fontSize: 12, marginLeft: 8, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis" }}>{msg}</span>}
        {sepBar}
        {wide
          ? <span style={{ display: "inline-flex", marginRight: 8 }}>{seg(VIEWS, view, (id) => setView(id as ViewId), (l) => `${l} view`)}</span>
          : <span style={{ marginRight: 8 }}><DropButton label={`${VIEWS.find(([id]) => id === view)?.[1]} ▾`} title="Change view" items={VIEWS.map(([id, label]): MenuItem => ({ label, checked: view === id, run: () => setView(id) }))} /></span>}
        {view === "rack" && <span style={{ display: "inline-flex", marginRight: 8 }}>{seg([["front", "Front"], ["rear", "Rear"]], face, (id) => setFace(id as "front" | "rear"), (l) => `Show the ${l.toLowerCase()}`)}</span>}
        <button style={{ ...btn, padding: "5px 9px" }} onClick={doUndo} disabled={!undo.length} title={`Undo (${SHORTCUTS.undo})`}>{"↶"}</button>
        <button style={{ ...btn, padding: "5px 9px" }} onClick={doRedo} disabled={!redo.length} title={`Redo (${SHORTCUTS.redo})`}>{"↷"}</button>
        <button style={{ ...btn, background: panelOpen ? v("accent-soft") : v("control") }} onClick={() => setPanelOpen((o) => !o)} title="Show or hide the details panel" aria-pressed={panelOpen}>Details</button>
        <button style={{ ...btn, background: v("accent"), color: v("on-accent"), borderColor: v("accent") }} onClick={() => doSave()} title={`Save (${SHORTCUTS.save})`}>Save</button>
        {!IS_WEB && <button style={{ ...btn, padding: "5px 9px", marginLeft: 6, marginRight: 0 }} title="Settings" aria-label="Settings" onClick={() => setSettingsTab("profile")}>{"⚙"}</button>}
        {IS_WEB && webGuarded && <UserBar web={webGuarded} openSettings={setSettingsTab} />}
      </div>
      {!IS_WEB && deskUpd.offer && <UpdateBanner kind="desktop" text={`Rackwright ${deskUpd.offer.version} is available.`} primary="Download" secondary="Skip this version" onPrimary={deskUpd.download} onSecondary={deskUpd.skip} onClose={deskUpd.hide} />}
      {IS_WEB && webUpd.reload && <UpdateBanner kind="reload" text={`Rackwright was updated to ${webUpd.reload}. Reload to use the new version.`} primary="Reload" onPrimary={() => location.reload()} />}
      {IS_WEB && !webUpd.reload && webUpd.admin && <UpdateBanner kind="admin" text={`Rackwright ${webUpd.admin} is available for this server.`} primary="Update now" secondary="Later" onPrimary={() => setSettingsTab("update")} onSecondary={webUpd.later} />}
      {screen.kind === "home" && <Dashboard importTick={importTick} onOpen={(key, o) => { setClientsTarget({ client: key, site: o?.site }); setClientsImport(false); setClientsOpen(true); }} />}
      <div style={{ flex: 1, minHeight: 0, display: screen.kind === "home" ? "none" : "flex", position: "relative" }}>
        <div style={{ display: view === "rack" ? "flex" : "none" }}>
          <EquipmentSidebar list={CATALOG} fitsOnly={fitsOnly} onFits={setFitsOnly} onDragStart={startPdrag} onAdd={addFromCatalog}
            statusOf={(c) => rackForTags ? tplRackStatus(doc, rackForTags, c) : c.plate?.off ? "off" : "none"}
            icon={icon} widthLabel={widthLabel} selected={palSel} collapsed={equipCollapsed} onCollapse={setEquipCollapsed} />
        </div>
        <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
          {view !== "rack" && selDev && (
            <button style={{ ...btn, position: "absolute", right: 10, top: 10, zIndex: 5, marginRight: 0 }} onClick={() => setView("rack")}>Show {selDev.name} in rack</button>
          )}
          {view === "infra" && <InfraView doc={doc} selected={sel} onSelect={pick} onOpen={openPanel} />}
          {view === "switch" && <SwitchView doc={doc} selected={sel} onSelect={pick} onOpen={openPanel} />}
          {view === "endpoints" && <EndpointsView doc={doc} selected={sel} onSelect={pick} onOpen={openPanel} edit={edit} onMember={(dev, idx) => setEpFocus({ dev, idx })} />}
          <div style={{ position: "absolute", inset: 0, display: view === "rack" ? "block" : "none" }}>
          <RackView doc={doc} liveDoc={live?.doc ?? null} onDragTarget={onDragTarget} onDragEnd={onDragEnd} face={face}
            routes={live ? live.routes : routes} ports={live ? live.ports : ports} selected={sel} onSelect={pick} onOpen={openPanel}
            pendingPort={pending} onPort={onPort} onMoveDevice={onMoveDevice} onReject={(w) => say(w, true)}
            drag={dragDev ? { dev: dragDev as Device, x: pdrag!.x, y: pdrag!.y } : null} resolveRef={resolveRef} fitTick={fitTick} cableColor={cableColor} cableOpts={cableOpts} />
          <CableOverlay cables={legendCables} opts={cableOpts} onOpts={(o) => { setCableOpts(o); saveOpts(o); }} mode={cableColor} onMode={(m) => { setCableColor(m); try { localStorage.setItem("rw.cableColor", m); } catch { /* ignore */ } }} />
          </div>
          {toast && (
            <div style={{ position: "absolute", left: "50%", bottom: 14, transform: "translateX(-50%)", padding: "6px 14px", borderRadius: 5, fontSize: 13,
              background: toast.bad ? v("danger-bg") : v("ok-bg"), border: `1px solid ${toast.bad ? v("danger") : v("ok")}`, pointerEvents: "none" }}>{toast.text}</div>
          )}
        </div>
        {panelOpen && <div style={{ width: selDev ? 360 : 240, flexShrink: 0, background: v("panel"), borderLeft: `1px solid ${v("border-subtle")}`, padding: 10, overflow: "auto", display: "flex", flexDirection: "column", gap: 8,
          ...(wide ? {} : { position: "absolute", right: 0, top: 0, bottom: 0, zIndex: 20, boxShadow: "-6px 0 18px rgba(0,0,0,0.35)" }) }}>
          {!sel && <>
            <Sec title="Overview" first onClose={() => setPanelOpen(false)} />
            <div style={{ fontSize: 12, lineHeight: 1.7 }}>
              {doc.racks.length} rack(s), {sum.used}/{sum.total}U used<br />
              {doc.devices.length} devices ({sum.off} off-rack)<br />
              {doc.cables.length} cables<br />
              <span style={{ opacity: 0.6 }}>Double-click a device, rack or cable to edit it. Arrow keys nudge a selected device, Ctrl+D duplicates, Home fits the view.</span>
            </div>
            <AuvikInfo doc={doc} onOpen={() => setUnplacedOpen(true)} />
          </>}
          {selRack && <>
            <Sec title="Rack" first onClose={() => setPanelOpen(false)} />
            {field("Name", selRack.name, (v) => edit((d) => { d.racks.find((r) => r.id === selRack.id)!.name = v; }, `rn${selRack.id}`))}
            {field("Height (U)", selRack.u, (v) => edit((d) => {
              const r = d.racks.find((x) => x.id === selRack.id)!;
              const n = Math.max(1, Math.min(60, parseInt(v) || 1));
              const why = resizeRack(d, r, n);
              if (why) return "!" + why;
            }, `rh${selRack.id}`), 60)}
            <label style={{ display: "block", fontSize: 11, color: v("text-dim") }}>Model<br />
              <select style={{ ...inp, width: "100%" }} value={selRack.model ?? ""} onChange={(e) => {
                const mod = modelById(e.target.value); if (!mod) return;
                edit((d) => {
                  const r = d.racks.find((x) => x.id === selRack.id)!;
                  const u = mod.generic ? r.u : mod.u;
                  if (u !== r.u) { const why = resizeRack(d, r, u); if (why) return "!" + why; }
                  applySpec(r, specOf(mod));
                });
              }}>
                {!selRack.model && <option value="">(none)</option>}
                {selRack.model && !modelById(selRack.model) && <option value={selRack.model}>{selRack.model_name || selRack.model}</option>}
                {["cabinet", "open4", "twopost", "wall", "desktop"].map((k) => (
                  <optgroup key={k} label={kindLabel(k)}>
                    {RACK_MODELS.filter((m) => m.kind === k).map((m) => <option key={m.id} value={m.id}>{m.generic ? m.name : `${m.name} (${m.u}U)`}</option>)}
                  </optgroup>
                ))}
              </select></label>
            {selRack.kind && <div style={{ fontSize: 12, opacity: 0.7 }}>{kindLabel(selRack.kind)}, {fmtDims(selRack.width_mm, selRack.depth_mm, settings.prefs.units ?? "mm")}</div>}
            <div style={{ fontSize: 12, opacity: 0.7 }}>{rackUsage(doc, selRack).used}U used, {rackUsage(doc, selRack).free}U free</div>
          </>}
          {selDev && <DevicePanel doc={doc} dev={selDev} edit={edit} epFocus={epFocus?.dev === selDev.id ? epFocus.idx : null}
            onSelect={(id) => setSel({ kind: "dev", id })} onClose={() => setPanelOpen(false)} onLocate={() => { setView("rack"); setFitTick((k) => k + 1); }}
            onDuplicate={doDuplicate} onChangeModel={() => setModelFor(selDev.id)} onDelete={del} onCopied={(ok) => say(ok ? "Copied" : "Could not copy", !ok)}
            lockIcon={(k) => lockIcon(selDev, k)} devSet={(k, val) => devSet(selDev, k, val)}
            placement={<>
            <label style={{ display: "block", fontSize: 11, color: v("text-dim") }}>Rack<br />
              <select style={{ ...inp, width: "100%" }} value={selDev.rack ?? ""} onChange={(e) => {
                const v = e.target.value;
                if (v === "") { edit((d) => { const x = d.devices.find((y) => y.id === selDev.id)!; x.fx = x.fx || 40; x.fy = x.fy || 40; x.rack = null; }); return; }
                const r = doc.racks.find((x) => x.id === Number(v))!;
                const probe = { ...selDev, rack: r.id };
                for (let u = r.u - selDev.u_size + 1; u >= 1; u--) for (const s of sidesOf(selDev))
                  if (checkPlace(doc, probe, r, u, s).ok) { place(selDev.id, r.id, u, s); return; }
                say(`No room in ${r.name} for ${selDev.name}`, true);
              }}>
                <option value="">(off-rack)</option>
                {doc.racks.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select></label>
            {selDev.rack != null && <div style={{ display: "flex", gap: 8, fontSize: 11, color: v("text-dim") }}>
              <label>U<br /><input type="number" style={{ ...inp, width: 56 }} value={selDev.u} min={1}
                onChange={(e) => { const n = parseInt(e.target.value); if (n) place(selDev.id, selDev.rack!, n, selDev.side); }} /></label>
              {selDev.half && <label>Side<br /><select style={inp} value={selDev.side} onChange={(e) => place(selDev.id, selDev.rack!, selDev.u, Number(e.target.value))}>
                {sidesOf(selDev).map((s, i, a) => <option key={s} value={s}>{a.length === 2 ? ["left", "right"][i] : a.length === 3 ? ["left", "middle", "right"][i] : `column ${i + 1}`}</option>)}</select></label>}
              <label style={{ flex: 1, minWidth: 0 }}>Mounted<br />
                <select style={{ ...inp, width: "100%" }} value={mountOf(selDev)} title="Which rails it hangs on (its ports face that way). Short gear leaves the other side of the U free." onChange={(e) => edit((d) => {
                  const x = d.devices.find((y) => y.id === selDev.id)!; setMount(x, e.target.value as Mount);
                  const r = d.racks.find((z) => z.id === x.rack);
                  if (r) { const p = checkPlace(d, x, r, x.u, x.side); if (!p.ok) return "!" + p.why; }
                })}>
                  {MOUNTS.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
                </select></label>
            </div>}
            <div style={{ display: "flex", gap: 8, fontSize: 11, color: v("text-dim"), alignItems: "flex-end" }}>
              <label>Height (U)<br /><input type="number" style={{ ...inp, width: 56 }} value={selDev.u_size} min={1} max={selDev.rack != null ? doc.racks.find((r) => r.id === selDev.rack)?.u : undefined}
                onChange={(e) => { const n = parseInt(e.target.value); if (n >= 1) edit((d) => { const x = resizeDevice(d, selDev.id, n); return x.ok ? x.msg : "!" + x.msg; }, `hu${selDev.id}`); }} /></label>
              {!selDev.plate && <label style={{ color: v("text") }}><input type="checkbox" checked={!!selDev.half} onChange={(e) => edit((d) => { const x = resizeDevice(d, selDev.id, selDev.u_size, e.target.checked); return x.ok ? x.msg : "!" + x.msg; })} /> Half width</label>}
            </div>
            </>} />}
          {selCable && <>
            <Sec title="Cable" first onClose={() => setPanelOpen(false)} />
            <div style={{ fontSize: 12 }}>{endp(selCable.a)}<br />to {endp(selCable.b)}</div>
            {field("Label", selCable.label ?? "", (v) => cab(selCable, { label: v }))}
            <label style={{ fontSize: 11, color: v("text-dim") }}>Colour<br />
              <input type="color" value={selCable.color || "#1f6feb"} onChange={(e) => cab(selCable, { color: e.target.value })} /></label> // theme-ok
            <label style={{ display: "block", fontSize: 11, color: v("text-dim") }}>Style<br />
              <select style={{ ...inp, width: "100%" }} value={selCable.style ?? "solid"} onChange={(e) => cab(selCable, { style: e.target.value })}>
                <option>solid</option><option>dashed</option>
              </select></label>
          </>}
          {sel && !selDev && <button style={{ ...btn, color: v("danger"), marginRight: 0 }} onClick={del}>Delete</button>}
        </div>}
      </div>
      {routes.hints.length > 0 && (
        <div style={{ maxHeight: 70, overflow: "auto", background: v("panel"), fontSize: 12, padding: 6, borderTop: `1px solid ${v("border-subtle")}` }}>
          {routes.hints.map((h, i) => <div key={i}>! {h.msg}</div>)}
        </div>
      )}
      {pdrag && pdrag.active && (
        <div style={{ position: "fixed", left: pdrag.x + 12, top: pdrag.y + 8, pointerEvents: "none", background: v("accent-soft"), border: `1px solid ${v("accent-border")}`,
          borderRadius: 4, padding: "2px 8px", fontSize: 12, zIndex: 50 }}>{icon(pdrag.i)} {CATALOG[pdrag.i].name}</div>
      )}
      {aboutOpen && <About onClose={() => setAboutOpen(false)} />}
      {helpDlg === "shortcuts" && <ShortcutsDialog onClose={() => setHelpDlg(null)} />}
      {helpDlg === "news" && <WhatsNewDialog onClose={() => setHelpDlg(null)} />}
      {offer && (
        <div style={{ position: "fixed", inset: 0, background: v("overlay"), display: "flex", alignItems: "center", justifyContent: "center", zIndex: 120 }}>
          <div style={{ background: v("panel"), padding: 14, borderRadius: 6, width: 460, maxWidth: "94vw", border: `1px solid ${v("border")}`, color: v("text"), fontSize: 13 }}>
            <b style={{ fontSize: 14 }}>Restore unsaved changes?</b>
            <div style={{ margin: "10px 0 12px" }}>
              Rackwright closed before <b>{draftName(offer)}</b> was saved. The last changes are from {new Date(offer.at).toLocaleString()}
              {" "}({offer.doc.racks.length} racks, {offer.doc.devices.length} devices, {offer.doc.cables.length} cables).
              {offer.cur ? " If someone saved this rack since then, saving will ask whose version to keep." : ""}
            </div>
            <button style={btn} onClick={restoreDraft}>Restore</button>
            <button style={{ ...btn, marginRight: 0 }} onClick={discardDraft}>Discard</button>
          </div>
        </div>
      )}
      {settingsTab && <SettingsScreen tab={settingsTab} setTab={setSettingsTab} web={webGuarded} onClose={() => setSettingsTab(null)} />}
      {clientsOpen && (
        <ClientsPanel startImport={clientsImport} openClient={clientsTarget.client} focusSite={clientsTarget.site} onClose={() => { setClientsOpen(false); setClientsTarget({}); }} onOpenRack={openFromClient}
          current={{ label: cur?.name ?? (path ? path.split(/[\\/]/).pop()! : "unsaved rack"), id: cur?.id ?? null, path }}
          saveCurrentTo={IS_WEB && !cur && doc.racks.length > 0 ? saveCurrentTo : undefined} />
      )}
      {reportFor != null && <Suspense fallback={null}><ReportDialog clientKey={reportFor || undefined} onClose={() => setReportFor(null)} /></Suspense>}
      {IS_WEB && showRacks && <RackList currentId={cur?.id ?? null} onClose={() => setShowRacks(false)} onOpen={(m) => loadShared(m.id)} />}
      {IS_WEB && nameAsk && <NamePrompt title={nameAsk.title} initial={nameAsk.initial} onOk={nameAsk.cb} onCancel={() => setNameAsk(null)} />}
      {IS_WEB && conflict && <ConflictDialog by={conflict.by} onTheirs={conflictTheirs} onMine={conflictMine} onCancel={() => setConflict(null)} />}
      {modelFor != null && (() => { const dv = doc.devices.find((x) => x.id === modelFor); return dv ? (
        <ModelPicker dev={dv} onCancel={() => setModelFor(null)} onPick={(t) => { if (edit((d) => { const x = swapModel(d, dv.id, t); return x.ok ? x.msg : "!" + x.msg; })) setModelFor(null); }} />
      ) : null; })()}
      {picker && <RackPicker title={picker === "new" ? "New rack" : "Add a rack"} okLabel={picker === "new" ? "Create" : "Add rack"}
        defaultName={picker === "new" ? "Rack 1" : `Rack ${doc.racks.length + 1}`}
        defaults={{ model: typeof settings.system.rack_default_model === "string" ? settings.system.rack_default_model : undefined, u: typeof settings.system.rack_default_u === "number" ? settings.system.rack_default_u : undefined }} onPick={onPick} onCancel={() => setPicker(null)} />}
      {auvikOpen && <Suspense fallback={null}><ImportAuvik doc={doc} rackId={targetRack()?.id ?? null} onClose={() => { setAuvikOpen(false); setFitTick((k) => k + 1); }} onApply={edit} /></Suspense>}
      {unplacedOpen && <UnplacedDialog items={doc.auvik?.unplaced ?? []} onClose={() => setUnplacedOpen(false)} />}
      {importOpen && (
        <div style={{ position: "fixed", inset: 0, background: v("overlay"), display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: v("panel"), padding: 14, borderRadius: 6, width: 520, border: `1px solid ${v("border")}` }}>
            <div style={{ fontSize: 12, marginBottom: 6, opacity: 0.8 }}>Paste a list, top of rack first, e.g. "Rack1", "- Panel A - (2U)", "- Open - (12U)". Open/Empty/Free leave a gap; add "rear" to mount on the back.</div>
            <textarea style={{ ...inp, width: "100%", height: 260, boxSizing: "border-box" }} value={importText} onChange={(e) => setImportText(e.target.value)} />
            <div style={{ marginTop: 8, fontSize: 12 }}>Rack height (0 = size to list): <input style={{ ...inp, width: 50 }} value={importH} onChange={(e) => setImportH(e.target.value)} />
              <span style={{ float: "right" }}>
                <button style={btn} onClick={() => setImportOpen(false)}>Cancel</button>
                <button style={{ ...btn, marginRight: 0 }} onClick={doImport}>Build racks</button>
              </span></div>
          </div>
        </div>
      )}
    </div>
  );
}

function Sec({ title, first, onClose }: { title: string; first?: boolean; onClose?: () => void }) {
  return <div style={{ display: "flex", alignItems: "center", fontSize: 12, fontWeight: 600, color: v("text-muted"), marginTop: 14, paddingTop: first ? 0 : 8, borderTop: first ? "none" : `1px solid ${v("border-subtle")}` }}>
    <span style={{ flex: 1 }}>{title}</span>
    {onClose && <button aria-label="Close" title="Close" style={{ ...btn, padding: "0 8px", fontSize: 16, marginRight: 0 }} onClick={onClose}>{"×"}</button>}
  </div>;
}
