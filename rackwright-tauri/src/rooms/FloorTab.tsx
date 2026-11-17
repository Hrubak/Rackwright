// The Floor plan tab: pick a room of the site, edit its plan, add objects and rooms, export a PDF. Saves after a short pause.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { v } from "../theme";
import type { Doc } from "../types";
import type { Units } from "../settings/types";
import { ClientItem, RackItem, clientStore } from "../clients/store";
import { FloorPlan, rackWatts, type FloorSel } from "./FloorPlan";
import { btu } from "../power/model";
import { OBJ_TYPES, ensureRooms, findFreeTile, footprint, nextId, resizeRoom, spotId } from "./model";
import type { RackSource, Room, RoomObject } from "./types";

const btn = { background: v("control"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 12 } as const;
const inp = { background: v("bg"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "3px 6px", fontSize: 12 } as const;
const SIZES: Record<RoomObject["type"], [number, number]> = { door: [2, 1], ac: [2, 1], panel: [1, 1], desk: [3, 2], label: [3, 1] };
const errOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface FloorTabProps {
  client: ClientItem;
  siteId?: number;
  docs: Record<string, Doc | string>;
  units: Units;
  onOpenRack: (r: RackItem) => void;
  /** Called after a save; the page reloads the client (web shows what was stored). */
  onSaved: () => Promise<unknown> | void;
}

export default function FloorTab({ client, siteId, docs, units, onOpenRack, onSaved }: FloorTabProps) {
  const store = clientStore();
  const site = client.sites.find((s) => s.id === siteId) ?? client.sites[0];
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  const [sel, setSel] = useState<FloorSel>(null);
  const [msg, setMsg] = useState("");
  const [saved, setSaved] = useState(false);
  const [ask, setAsk] = useState<{ w: number; d: number; failed: number } | null>(null);
  const [size, setSize] = useState({ w: "", d: "" });
  const [scale, setScale] = useState(false);
  const [moveTo, setMoveTo] = useState("");
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ key: string; id: number; rooms: Room[] } | null>(null);

  // Rack ids per rack document, once every document of the site has loaded.
  const ready = !!site && site.racks.every((r) => docs[r.key] !== undefined);
  const sources: RackSource[] = useMemo(() => !site ? [] : site.racks.map((r) => {
    const d = docs[r.key];
    if (typeof d === "object") return { key: r.key, rackIds: d.racks.map((x) => x.id) };
    // unreadable: keep what was stored so a bad file does not wipe its spots
    return { key: r.key, rackIds: (site.rooms ?? []).flatMap((rm) => rm.racks.filter((s) => s.key === r.key).map((s) => s.rack)) };
  }), [site, docs]);

  useEffect(() => {
    if (!site || !ready || dirty.current) return;
    const e = ensureRooms(site.rooms, sources); // changed alone never saves
    setRooms(e.rooms);
    setRoomId((id) => (id != null && e.rooms.some((r) => r.id === id) ? id : e.rooms[0]?.id ?? null));
  }, [site, ready, sources]);

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const p = pending.current; if (!p) return;
    pending.current = null;
    try {
      await store.setRooms(p.key, p.id, p.rooms);
      if (!pending.current) dirty.current = false;
      setSaved(true); setMsg("");
      if (store.web) await onSaved(); // web: reload so the plan shows what was stored
    } catch (e) { setMsg(errOf(e)); }
  }, [store, onSaved]);
  const flushRef = useRef(flush); flushRef.current = flush;
  useEffect(() => () => { if (pending.current) void flushRef.current(); }, []);

  const edit = (next: Room[]) => {
    if (!site) return;
    dirty.current = true; setRooms(next); setSaved(false);
    pending.current = { key: client.key, id: site.id, rooms: next };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 600);
  };
  const update = (room: Room) => edit(rooms.map((r) => (r.id === room.id ? room : r)));

  const room = rooms.find((r) => r.id === roomId) ?? rooms[0];
  useEffect(() => { if (room) setSize({ w: String(room.w), d: String(room.d) }); }, [room?.id, room?.w, room?.d]); // eslint-disable-line react-hooks/exhaustive-deps

  let roomPower = "";
  if (room) {
    let w = 0, unk = 0;
    for (const sp of room.racks) { const p = rackWatts(docs, sp); w += p.w; unk += p.unknown; }
    roomPower = w > 0 ? `Room: ${unk > 0 ? "at least " : ""}${Math.round(w).toLocaleString("en-US")} W · ${btu(w).toLocaleString("en-US")} BTU/hr` : "Power unknown";
  }

  if (!client.sites.length) return <div style={{ opacity: 0.8 }}>Add a site on the Sites tab to start a floor plan.</div>;
  if (!site) return null;
  if (!ready || !room) return <div style={{ opacity: 0.7 }}>Loading...</div>;

  const onSize = () => {
    const w = Math.round(Number(size.w)), d = Math.round(Number(size.d));
    if (!(w >= 2 && w <= 100 && d >= 2 && d <= 100)) { setMsg("Size must be between 2 and 100 tiles."); setSize({ w: String(room.w), d: String(room.d) }); return; }
    setMsg("");
    if (w === room.w && d === room.d) return;
    const r = resizeRoom(room, w, d, scale);
    if (r.failed > 0 && !room.allow_overlap) { setAsk({ w, d, failed: r.failed }); return; } // discard the result and ask
    update(r.room);
  };
  const addObj = (type: RoomObject["type"]) => {
    const [w, h] = SIZES[type];
    const p = findFreeTile(room, w, h);
    if (!p) { setMsg("There is no free space in this room. Make it bigger or allow overlapping."); return; }
    setMsg("");
    const o: RoomObject = { id: nextId(room), type, x: p.x, y: p.y, w, h, label: OBJ_TYPES[type] };
    update({ ...room, objects: [...room.objects, o] });
    setSel({ kind: "obj", id: o.id });
  };
  const addRoom = () => {
    const name = prompt("Name for the new room", `Room ${rooms.length + 1}`)?.trim();
    if (!name) return;
    const id = rooms.reduce((m, r) => Math.max(m, r.id), 0) + 1;
    edit([...rooms, { id, name, w: 14, d: 9, objects: [], racks: [] }]);
    setRoomId(id); setAll(false); setSel(null);
  };
  const rename = () => {
    const name = prompt("Room name", room.name)?.trim();
    if (name && name !== room.name) update({ ...room, name });
  };
  const del = () => {
    if (room.racks.length) { setMsg("Move its racks to another room first."); return; }
    if (rooms.length < 2) { setMsg("A site needs at least one room."); return; }
    if (!confirm(`Delete the room "${room.name}"?`)) return;
    const rest = rooms.filter((r) => r.id !== room.id);
    edit(rest); setRoomId(rest[0].id); setSel(null);
  };
  const selSpot = sel?.kind === "rack" ? room.racks.find((s) => spotId(s) === sel.id) : undefined;
  const move = () => {
    const to = rooms.find((r) => String(r.id) === moveTo);
    if (!selSpot || !to) return;
    const f = footprint(selSpot.rot);
    const p = findFreeTile(to, f.w, f.h) ?? { x: 0, y: 0 };
    edit(rooms.map((r) => r.id === room.id ? { ...r, racks: r.racks.filter((s) => s !== selSpot) } : r.id === to.id ? { ...r, racks: [...r.racks, { ...selSpot, x: p.x, y: p.y }] } : r));
    setRoomId(to.id); setSel(null); setMoveTo("");
  };
  const exportPdf = async () => {
    try { const { exportFloorPdf } = await import("./floorPdf"); await exportFloorPdf(room, docs, units, site.name); } catch (e) { setMsg(errOf(e)); }
  };
  const open = (key: string) => { const r = site.racks.find((x) => x.key === key); if (r) onOpenRack(r); };
  const others = rooms.filter((r) => r.id !== room.id);

  return (
    <div>
      {!siteId && client.sites.length > 1 && <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>Showing {site.name}. Pick a site in the bar above to see another.</div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8, fontSize: 12 }}>
        <select style={inp} value={room.id} onChange={(e) => { setRoomId(Number(e.target.value)); setSel(null); }} aria-label="Room">
          {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <span style={{ display: "inline-flex" }}>
          <button style={{ ...btn, borderRadius: "4px 0 0 4px", background: all ? v("control") : v("accent-soft") }} onClick={() => setAll(false)}>This room</button>
          <button style={{ ...btn, borderRadius: "0 4px 4px 0", background: all ? v("accent-soft") : v("control") }} onClick={() => setAll(true)}>All rooms</button>
        </span>
        {!all && <>
          <b>{room.name}</b>
          <span>Size</span>
          <input style={{ ...inp, width: 44 }} value={size.w} aria-label="Width in tiles" onChange={(e) => setSize({ ...size, w: e.target.value })} onBlur={onSize} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
          <span>×</span>
          <input style={{ ...inp, width: 44 }} value={size.d} aria-label="Depth in tiles" onChange={(e) => setSize({ ...size, d: e.target.value })} onBlur={onSize} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
          <span>tiles</span>
          <label title="Spread racks and objects out when the room changes size"><input type="checkbox" checked={scale} onChange={(e) => setScale(e.target.checked)} /> Scale items</label>
          <label><input type="checkbox" checked={!!room.allow_overlap} onChange={(e) => update({ ...room, allow_overlap: e.target.checked })} /> Allow overlapping</label>
          <select style={inp} value="" onChange={(e) => e.target.value && addObj(e.target.value as RoomObject["type"])} aria-label="Add an object">
            <option value="">+ Add ▾</option>
            {(Object.keys(OBJ_TYPES) as RoomObject["type"][]).map((t) => <option key={t} value={t}>{OBJ_TYPES[t]}</option>)}
          </select>
        </>}
        <button style={btn} onClick={addRoom}>+ Room</button>
        {!all && <>
          <button style={btn} onClick={rename}>Rename</button>
          <button style={{ ...btn, color: v("danger") }} onClick={del}>Delete room</button>
          {selSpot && others.length > 0 && <>
            <select style={inp} value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="Move rack to room">
              <option value="">Move rack to room…</option>
              {others.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            {moveTo && <button style={btn} onClick={move}>Move</button>}
          </>}
          <button style={btn} onClick={exportPdf}>Export PDF</button>
        </>}
        {!all && <span style={{ fontSize: 12, opacity: 0.85 }}>{roomPower}</span>}
        {saved && <span style={{ opacity: 0.7 }}>Saved</span>}
      </div>
      {msg && <div style={{ fontSize: 12, color: v("error-text"), marginBottom: 6 }}>{msg}</div>}
      {ask && (
        <div style={{ border: `1px solid ${v("border")}`, borderRadius: 6, padding: 10, marginBottom: 8, background: v("card"), maxWidth: 520, fontSize: 12 }}>
          {ask.failed} item{ask.failed === 1 ? "" : "s"} won't fit in {ask.w} × {ask.d} tiles without overlapping something.
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <button style={btn} onClick={() => { setAsk(null); setSize({ w: String(room.w), d: String(room.d) }); }}>Keep the current size</button>
            <button style={btn} onClick={() => { update({ ...resizeRoom(room, ask.w, ask.d, scale).room, allow_overlap: true }); setAsk(null); }}>Allow overlapping and resize</button>
          </div>
        </div>
      )}
      {all
        ? rooms.map((r) => (
          <div key={r.id} style={{ marginBottom: 14 }}>
            <b style={{ fontSize: 13 }}>{r.name}</b> <span style={{ fontSize: 11, opacity: 0.7 }}>Click to edit this room.</span>
            <div style={{ cursor: "pointer" }} onClick={() => { setRoomId(r.id); setAll(false); setSel(null); }}>
              <div style={{ pointerEvents: "none" }}>
                <FloorPlan room={r} docs={docs} units={units} onChange={() => {}} onOpenRack={() => {}} onSelect={() => {}} selected={null} readOnly />
              </div>
            </div>
          </div>))
        : <FloorPlan room={room} docs={docs} units={units} onChange={update} onOpenRack={(k) => open(k)} onSelect={setSel} selected={sel} />}
    </div>
  );
}
