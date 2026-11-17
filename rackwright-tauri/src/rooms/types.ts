// Room and floor plan shapes. Units are tiles (one tile = 2 ft, or 600 mm when metric).
export type RoomObjectType = "door" | "ac" | "panel" | "desk" | "label";
export type Rot = 0 | 90 | 180 | 270;

export interface RoomObject { id: number; type: RoomObjectType; x: number; y: number; w: number; h: number; label: string }
// key = the site's RackItem key; rack = the rack's id inside that document
export interface RackSpot { key: string; rack: number; x: number; y: number; rot: Rot }
export interface Room { id: number; name: string; w: number; d: number; allow_overlap?: boolean; objects: RoomObject[]; racks: RackSpot[] }
export interface RackSource { key: string; rackIds: number[] }
