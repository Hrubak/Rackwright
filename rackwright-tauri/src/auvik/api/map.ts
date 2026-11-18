// Trimmed Auvik API devices (from the server) -> the existing import plan. Pure; no backend.ts import.
import type { AuvikDevice, ParsedAuvik } from "../parse";
import { buildItems, setMode, type HostCtx, type Kind, type PlanItem } from "../plan";

export interface AuvikApiComponent { type: string; name: string; detail: string }
export interface AuvikApiDevice {
  id: string; name: string; type: string; makeModel: string; vendor: string; serial: string; firmware: string; software: string;
  ips: string[]; macs: string[]; status: string; discovery: string; components: AuvikApiComponent[];
}

/** Auvik deviceType -> the type words classify() and inferKind() understand. */
export const TYPE_WORDS: Record<string, string> = {
  switch: "Switch", l3Switch: "Layer 3 Switch", stack: "Switch", voipSwitch: "Switch", router: "Router",
  firewall: "Firewall", utm: "Firewall", securityAppliance: "Firewall",
  server: "Server", hypervisor: "Hypervisor", storage: "Storage", ups: "UPS", pdu: "PDU",
  accessPoint: "Access Point", thinAccessPoint: "Access Point", wirelessController: "Controller", controller: "Controller",
  virtualMachine: "Virtual Machine", workstation: "Workstation", printer: "Printer", copier: "Printer",
  voipPhone: "IP Phone", ipPhone: "IP Phone", phone: "Phone", camera: "Camera", internetOfThings: "Internet of Things",
  ipmi: "Intelligent Platform Management Interface", unknown: "Unknown",
};

export function toAuvikDevice(a: AuvikApiDevice, org: string): AuvikDevice {
  return {
    apiId: a.id, name: a.name, rawName: a.name, unnamed: false, org, status: a.status,
    type: TYPE_WORDS[a.type] ?? "Unknown", model: a.makeModel,
    macs: a.macs, ips: a.ips, networks: "", neighbors: [],
    software: a.software, serial: a.serial, firmware: a.firmware,
    description: a.discovery ? "discovery " + a.discovery : "", rows: 1,
  };
}

const counts = (xs: string[]) => { const m = new Map<string, number>(); for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1); return m; };
/** Device specs from components. Auvik gives no sizes, so these are counts and names. */
export function specsOf(c: AuvikApiDevice["components"]): Record<string, string> {
  const out: Record<string, string> = {};
  const of = (t: string) => c.filter((x) => x.type === t);
  const cpu = of("cpu"), mem = of("memory"), disk = of("disk"), psu = of("powerSupply");
  if (cpu.length) {
    const top = [...counts(cpu.map((x) => x.name)).entries()].sort((a, b) => b[1] - a[1])[0][0];
    out["CPU"] = cpu.length === 1 ? cpu[0].name : `${cpu.length} × ${top}`;
  }
  if (mem.length) out["Memory"] = mem.length === 1 ? mem[0].name : `${mem.length} modules`;
  if (disk.length) out["Disks"] = `${disk.length}: ${disk.map((x) => x.name).join(", ")}`;
  if (psu.length) out["Power supplies"] = String(psu.length);
  return out;
}

/** Kinds that go in the "To place" column; the rest of the off-rack kinds go in "Inventory". */
export const TO_PLACE_KINDS: Kind[] = ["firewall", "router", "switch", "server", "storage", "ups", "pdu"];

export type ApiPlanItem = PlanItem & { specs?: Record<string, string> };

export function apiItems(devs: AuvikApiDevice[], org: string, ctx?: HostCtx): { parsed: ParsedAuvik; items: ApiPlanItem[] } {
  const parsed: ParsedAuvik = { site: org, devices: devs.map((d) => toAuvikDevice(d, org)), warnings: [] };
  let items: PlanItem[] = buildItems(parsed, ctx);
  for (const i of items.filter((x) => x.mode === "rack")) items = setMode(items, i.key, "off", ctx);
  const byId = new Map(devs.map((d) => [d.id, d]));
  return {
    parsed,
    items: items.map((i): ApiPlanItem => {
      const src = i.dev.apiId ? byId.get(i.dev.apiId) : undefined;
      const specs = src ? specsOf(src.components) : {};
      const out: ApiPlanItem = { ...i };
      if (i.mode === "vm" && i.host) out.hostGuessed = true;
      if (Object.keys(specs).length) out.specs = specs;
      return out;
    }),
  };
}
