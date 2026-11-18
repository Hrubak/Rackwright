export interface Port { id: number; name: string; type: string; label: string }
export interface Device {
  id: number; name: string; type: string; u_size: number; rack: number | null; u: number; side: number;
  half: boolean; rows: number; fx: number; fy: number; face: string; color?: string; ports: Port[]; plate?: any; model?: string; ip?: string; serial?: string; notes?: string;
  auvik_id?: string; auvik_name?: string; auvik_macs?: string[]; auvik_model?: string;
  endpoints?: { name: string; type: string; model: string; ip: string; mac: string; port: string; status: string; kind?: "pc" | "phone" | "iot" | "printer" | "vm" | "other"; key?: string; locked?: string[]; manual?: boolean }[];
  mac?: string;
  locked?: string[]; // fields edited by hand (name, type, model, ip, serial, notes, mac); an Auvik import leaves them alone
  oobm?: { name: string; ip: string; mac: string; key: string; portId?: number }; // iDRAC / iLO / BMC shown on this server's rear port
  vm_host?: number; // "Virtual machines" box: id of the device the VMs run on
  cols?: number; // partial-width gear: the row is split into this many columns (default 2 = half width); `side` is the column
  rev?: boolean; // turned around: ports face the rear (the rear view shows its front panel)
  status?: DevStatus; manufacturer?: string; hostname?: string; asset_tag?: string; os?: string; role?: string; owner?: string;
  purchase_date?: string; warranty_exp?: string; power_w?: number; battery_date?: string; rated_w?: number; last_verified?: string;
  services?: Service[]; specs?: Record<string, string>;
}
export type DevStatus = "active" | "spare" | "offline" | "planned";
export interface Service { name: string; port: string; proto: string; status: string; notes: string }
export interface Rack {
  id: number; name: string; u: number; x: number; y: number;
  kind?: string; model?: string; model_name?: string; width_mm?: number; depth_mm?: number;
  last_verified?: string; circuit?: string; volts?: 120 | 208; notes?: string;
}
export interface Cable { id: number; a: number; b: number; color: string; type?: string; style?: string; label?: string; length?: number; unit?: string }
export interface AuvikMeta { site: string; imported: string; unplaced: { name: string; type: string; model: string; ip: string; mac: string; status: string; reason: string }[]; virtual: string[] }
export interface Doc { v: number; nid: number; racks: Rack[]; devices: Device[]; cables: Cable[]; auvik?: AuvikMeta }
export interface Route { cable: number; pts: [number, number][]; mode: string; dir_a: number; dir_b: number }
export interface Hint { cable: number; device: number; msg: string }
export interface RouteResult { routes: Route[]; hints: Hint[] }
export type PortPos = [number, number, number, number]; // id, x, y, size

export const UH = 26, RW = 480, RAIL = 24, HDR = 46, PADB = 10;
export const PORT_COLORS: Record<string, string> = {
  RJ45: "#6aa84f", SFP: "#e69138", "SFP+": "#f1c232", QSFP: "#cc4125", "Fiber LC": "#3d85c6", // theme-ok
  Power: "#555a62", Console: "#7a8fa6", Mgmt: "#8e7cc3", Other: "#888", // theme-ok
};
