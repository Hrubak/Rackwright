// Split-by-network tests. Synthetic data only.
import type { AuvikDevice, ParsedAuvik } from "../src/auvik/parse";
import { networksOf, splitBySite } from "../src/auvik/split";
import { buildItems, resolvePlan } from "../src/auvik/plan";

let fails = 0;
const t = (name: string, ok: boolean) => { if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name); };

const dev = (name: string, networks: string, neighbors: string[] = []): AuvikDevice => ({
  name, rawName: name, unnamed: false, org: "Example Co", status: "Up", type: "Switch", model: "", macs: [], ips: [], networks,
  neighbors: neighbors.map((n) => ({ name: n, iface: "1" })), software: "", serial: name + "-ser", firmware: "", description: "", rows: 1,
});
const p: ParsedAuvik = {
  site: "Example Co", warnings: ["w"],
  devices: [
    dev("sw-a", "192.0.2.0/24, VLAN 10", ["sw-b"]),
    dev("sw-b", "198.51.100.0/24"),
    dev("sw-c", "VLAN 10;203.0.113.0/24\n198.51.100.0/24", ["sw-a"]),
    dev("sw-d", ""),
  ],
};

const nets = networksOf(p);
t("networks counted and sorted", nets[0].name === "198.51.100.0/24" && nets[0].devices === 2 && nets.length === 4);
t("separators split", nets.some((n) => n.name === "203.0.113.0/24" && n.devices === 1));

const s = splitBySite(p, { "198.51.100.0/24": "B", "VLAN 10": "A" }, "main");
t("first assigned network wins", s.B.devices.map((d) => d.name).join() === "sw-b" && s.A.devices.map((d) => d.name).join() === "sw-a,sw-c");
t("fallback for the rest", s.main.devices.map((d) => d.name).join() === "sw-d");
t("site and warnings kept", s.A.site === "Example Co" && s.A.warnings[0] === "w");
t("empty sites absent", Object.keys(splitBySite(p, {}, "main")).join() === "main");

let ok = true;
try { for (const k of Object.keys(s)) resolvePlan(s[k], buildItems(s[k])); } catch { ok = false; }
t("plans build with cross-site neighbours", ok);

if (fails) { console.log(fails + " failed"); process.exit(1); }
