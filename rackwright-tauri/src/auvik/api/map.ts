// Trimmed Auvik API devices (from the server) -> the existing import plan. Pure; no backend.ts import.
import type { AuvikDevice, ParsedAuvik } from "../parse";
import { CATALOG } from "../../edit";
import { buildItems, retype, setMode, type HostCtx, type Kind, type PlanItem } from "../plan";

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
  voipPhone: "IP Phone", ipPhone: "IP Phone", phone: "Phone", camera: "Camera", internetOfThings: "IoT",
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

/** `baseKind`: the kind the row had before the person's kind pick (set only on a picked row), so the table can tell a pick from the default. */
export type ApiPlanItem = PlanItem & { specs?: Record<string, string>; baseKind?: Kind };

/** The type word each kind is re-classified from when the person picks a kind. */
export const KIND_TYPE: Record<Kind, string> = {
  firewall: "Firewall", router: "Router", switch: "Switch", server: "Server", storage: "Storage", ups: "UPS", pdu: "PDU",
  ap: "Access Point", ipmi: "Intelligent Platform Management Interface", controller: "Controller", vm: "Virtual Machine", endpoint: "Generic Device",
};
/** What the Kind dropdown shows. */
export const KIND_LABEL: Record<Kind, string> = { ...KIND_TYPE, ap: "Access point", ipmi: "OOBM (iDRAC/iLO)", vm: "Virtual machine", endpoint: "Endpoint" };
/** Model text saved for a virtual device. */
export const VM_MODELS = { hyperv: "Virtual Machine – Hyper-V", vmware: "Virtual Machine – VMware", kvm: "Virtual Machine – KVM (Scale HyperCore)" } as const;
export type VmVendor = keyof typeof VM_MODELS;

/** A virtual device: kind Virtual machine, or Auvik's model says so. */
export function isVirtual(i: Pick<PlanItem, "kind" | "dev">): boolean {
  return i.kind === "vm" || /virtual machine|virtual platform|vmware|qemu|\bkvm\b|hyper-?v/i.test(i.dev.model);
}
/** Which hypervisor a VM runs on, from its model, description (discovery) and software. */
export function vmVendor(d: Pick<AuvikDevice, "model" | "description" | "software">): VmVendor | null {
  const s = `${d.model} ${d.description} ${d.software}`;
  if (/hyper-?v|microsoft/i.test(s)) return "hyperv";
  if (/vmware|esxi/i.test(s)) return "vmware";
  if (/\bkvm\b|qemu|scale|hypercore/i.test(s)) return "kvm";
  return null;
}
/** The Model dropdown's default: the Virtual Machine choice for a virtual device whose vendor is known, else Auvik's text (""). */
export function defaultModelChoice(i: Pick<PlanItem, "kind" | "dev">): string {
  const v = isVirtual(i) ? vmVendor(i.dev) : null;
  return v ? "vm:" + v : "";
}

/** The person's picks on the import page, by plan item key.
 *  A model value is "" (Auvik's text), "tpl:<catalog name>" or "vm:hyperv|vmware|kvm". */
export interface Overrides { kinds?: Record<string, Kind>; types?: Record<string, string>; models?: Record<string, string> }

/** `kept` = kinds the site's documents hold from an earlier hand pick (see keptKinds in sync.ts). They re-classify the row
 *  like a pick, but are not a new hand edit (no kindOver). The person's own `over.kinds` win. */
export function apiItems(devs: AuvikApiDevice[], org: string, ctx?: HostCtx, over?: Overrides, kept?: Record<string, Kind>): { parsed: ParsedAuvik; items: ApiPlanItem[] } {
  const parsed: ParsedAuvik = { site: org, devices: devs.map((d) => toAuvikDevice(d, org)), warnings: [] };
  let items: PlanItem[] = buildItems(parsed, ctx);
  for (const [key, kind] of Object.entries(kept ?? {})) {
    const i = items.find((x) => x.key === key);
    if (!i || i.kind === kind || over?.kinds?.[key] || !KIND_TYPE[kind]) continue;
    items = retype(parsed, items, key, KIND_TYPE[kind], ctx);
  }
  const baseKind = new Map<string, Kind>();
  for (const [key, kind] of Object.entries(over?.kinds ?? {})) {
    const before = items.find((i) => i.key === key);
    if (!before || !KIND_TYPE[kind]) continue;
    const k0 = kept?.[key];
    baseKind.set(key, k0 && KIND_TYPE[k0] ? k0 : before.kind);   // without this pick the kept kind would apply
    items = retype(parsed, items, key, KIND_TYPE[kind], ctx).map((i) => (i.key === key ? { ...i, kindOver: true } : i));
  }
  for (const i of items.filter((x) => x.mode === "rack")) items = setMode(items, i.key, "off", ctx);
  const byId = new Map(devs.map((d) => [d.id, d]));
  return {
    parsed,
    items: items.map((i): ApiPlanItem => {
      const src = i.dev.apiId ? byId.get(i.dev.apiId) : undefined;
      const specs = src ? specsOf(src.components) : {};
      const out: ApiPlanItem = { ...i };
      if (i.mode === "vm" && i.host) out.hostGuessed = true;
      if (i.kind === "controller" && i.mode === "skip" && !/virtual|\bvm\b/i.test(`${i.dev.name} ${i.dev.model}`)) { out.mode = "off"; out.virtual = false; }   // a real controller is inventory, never silently dropped
      if (i.kind === "ipmi" && i.host === "new") { out.mode = "off"; out.host = "off"; }   // no host to attach to: off-rack only, a layout places devices
      if (Object.keys(specs).length) out.specs = specs;
      if (baseKind.has(i.key)) out.baseKind = baseKind.get(i.key);
      const m = over?.models?.[i.key];
      if (m?.startsWith("tpl:")) {
        const t = CATALOG.find((c) => c.name === m.slice(4));
        if (t) {
          out.modelOver = t.model || t.name;
          if (out.mode === "rack" || out.mode === "off") { out.tplOver = t.name; out.tplName = t.name; out.generic = false; }   // only a device row has a template
        }
      } else if (m?.startsWith("vm:")) {
        const v = m.slice(3);
        if (v in VM_MODELS) out.modelOver = VM_MODELS[v as VmVendor];
      } else if (m === undefined) {
        const v = defaultModelChoice(out);   // pre-pick for a virtual device: an Auvik value, not a hand edit
        if (v) out.modelOver = VM_MODELS[v.slice(3) as VmVendor];
      }
      const ty = over?.types?.[i.key];
      if (ty) out.typeOver = ty;
      return out;
    }),
  };
}
