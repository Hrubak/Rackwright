export interface Port { id: number; name: string; type: string; label: string }
export interface Device {
  id: number; name: string; type: string; u_size: number; rack: number | null; u: number; side: number;
  half: boolean; rows: number; fx: number; fy: number; face: string; color?: string; ports: Port[];
}
export interface Rack { id: number; name: string; u: number; x: number; y: number }
export interface Cable { id: number; a: number; b: number; color: string; type?: string; style?: string; label?: string }
export interface Doc { v: number; nid: number; racks: Rack[]; devices: Device[]; cables: Cable[] }
export interface Route { cable: number; pts: [number, number][]; mode: string; dir_a: number; dir_b: number }
export interface Hint { cable: number; device: number; msg: string }
export interface RouteResult { routes: Route[]; hints: Hint[] }
export type PortPos = [number, number, number, number]; // id, x, y, size

export const UH = 26, RW = 480, RAIL = 24, HDR = 46, PADB = 10;
export const PORT_COLORS: Record<string, string> = {
  RJ45: "#6aa84f", SFP: "#e69138", "SFP+": "#f1c232", QSFP: "#cc4125", "Fiber LC": "#3d85c6",
  Power: "#555a62", Console: "#7a8fa6", Mgmt: "#8e7cc3", Other: "#888",
};
