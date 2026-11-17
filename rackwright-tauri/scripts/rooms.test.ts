// npx tsx scripts/rooms.test.ts — room model (synthetic data only)
import { cleanRooms, ensureRooms, findFreeTile, footprint, nextId, occupied, resizeRoom, tileFree } from "../src/rooms/model";
import { OBJ_TYPES } from "../src/rooms/model";
import type { Room } from "../src/rooms/types";

let fail = 0;
const eq = (name: string, a: unknown, b: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
};

const racks = [{ key: "r1", rackIds: [1, 2] }];
const e = ensureRooms(undefined, racks);
eq("main room", [e.rooms.length, e.rooms[0].name, e.rooms[0].w, e.rooms[0].d, e.changed], [1, "Main room", 14, 9, true]);
eq("spots", e.rooms[0].racks, [{ key: "r1", rack: 1, x: 0, y: 0, rot: 0 }, { key: "r1", rack: 2, x: 1, y: 0, rot: 0 }]);
const e2 = ensureRooms(e.rooms, racks);
eq("existing kept", [e2.rooms[0].racks, e2.changed], [e.rooms[0].racks, false]);
const stale: Room[] = [{ ...e.rooms[0], racks: [...e.rooms[0].racks, { key: "r9", rack: 1, x: 5, y: 5, rot: 0 }] }];
const e3 = ensureRooms(stale, racks);
eq("stale dropped", [e3.rooms[0].racks.length, e3.changed], [2, true]);
eq("cleanRooms", cleanRooms(stale, racks)[0].racks.length, 2);
eq("stale input untouched", stale[0].racks.length, 3);
const e4 = ensureRooms(e.rooms, [{ key: "r1", rackIds: [1] }]);
eq("missing rack id dropped", e4.rooms[0].racks.map((s) => s.rack), [1]);
const e5 = ensureRooms(e.rooms, [{ key: "r1", rackIds: [1, 2, 3] }]);
eq("new rack placed", [e5.rooms[0].racks[2], e5.changed], [{ key: "r1", rack: 3, x: 2, y: 0, rot: 0 }, true]);

eq("fp 0", footprint(0), { w: 1, h: 2 });
eq("fp 90", footprint(90), { w: 2, h: 1 });
eq("fp 180", footprint(180), { w: 1, h: 2 });
eq("fp 270", footprint(270), { w: 2, h: 1 });
eq("obj types", OBJ_TYPES.ac, "Cooling / CRAC");

const room: Room = { id: 1, name: "Test", w: 6, d: 4, objects: [{ id: 3, type: "desk", x: 3, y: 0, w: 2, h: 1, label: "" }], racks: [{ key: "a", rack: 1, x: 0, y: 0, rot: 0 }] };
eq("occupied", [...occupied(room)].sort(), ["0,0", "0,1", "3,0", "4,0"]);
eq("free", tileFree(room, 1, 0, 1, 2), true);
eq("overlap rack", tileFree(room, 0, 1, 1, 2), false);
eq("overlap obj", tileFree(room, 4, 0, 1, 1), false);
eq("out of bounds", tileFree(room, 5, 3, 2, 1), false);
eq("except rack", tileFree(room, 0, 0, 1, 2, { kind: "rack", id: "a#1" }), true);
eq("except obj", tileFree(room, 3, 0, 2, 1, { kind: "obj", id: 3 }), true);
eq("allow overlap", tileFree({ ...room, allow_overlap: true }, 0, 0, 1, 2), true);
eq("overlap still bounded", tileFree({ ...room, allow_overlap: true }, 5, 3, 2, 1), false);
eq("find free", findFreeTile(room, 1, 2), { x: 1, y: 0 });
eq("find none", findFreeTile({ ...room, w: 1, d: 2 }, 1, 2), null);
eq("nextId", [nextId(room), nextId({ ...room, objects: [] })], [4, 1]);

const big: Room = { id: 1, name: "Main room", w: 14, d: 9, objects: [{ id: 1, type: "door", x: 0, y: 4, w: 1, h: 2, label: "" }], racks: [{ key: "a", rack: 1, x: 4, y: 4, rot: 0 }, { key: "a", rack: 2, x: 5, y: 4, rot: 0 }] };
const snap = JSON.stringify(big);
const r = resizeRoom(big, 7, 5, true);
eq("input not mutated", JSON.stringify(big), snap);
eq("resize dims", [r.room.w, r.room.d, r.failed], [7, 5, 0]);
eq("door stays on wall", r.room.objects[0].x, 0);
eq("row together", r.room.racks[1].x - r.room.racks[0].x === 1 && r.room.racks[1].y === r.room.racks[0].y, true);
const packed: Room = { id: 1, name: "P", w: 4, d: 4, objects: [], racks: [] };
for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y += 2) packed.racks.push({ key: "a", rack: packed.racks.length + 1, x, y, rot: 0 });
const f = resizeRoom(packed, 2, 2, false);
eq("failed when packed", f.failed > 0, true);
eq("failed ids kept", f.room.racks.length, 8);

console.log(fail ? `${fail} failed` : "all passed");
if (fail) process.exit(1);
