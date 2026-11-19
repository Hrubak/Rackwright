// Device table helpers for Import from Auvik (src/auvik/api/table.ts). Synthetic data only.
import { natCmp, ipCmp, sortRows, filterRows, setTicked, headState, setPick, destOf, modelLabel, deviceRowTypes, type Row } from "../src/auvik/api/table";
import { VM_MODELS } from "../src/auvik/api/map";

let fails = 0;
const t = (name: string, ok: boolean, extra = "") => { if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  " + extra : "")); };

const row = (key: string, p: Partial<Row> = {}): Row =>
  ({ key, id: key, name: key, kind: "Switch", type: "Switch", model: "", template: "", u: "", rack: "EX Main Office (Auvik)", dest: "To place", ip: "", status: "online", ...p });
const names = (rs: Row[]) => rs.map((r) => r.name).join(",");

// natural compare
t("natCmp: EX-SW2 before EX-SW10", natCmp("EX-SW2", "EX-SW10") < 0 && natCmp("EX-SW10", "EX-SW2") > 0);
t("natCmp: ignores case", natCmp("ex-sw01", "EX-SW01") === 0);

// IP compare
t("ipCmp: numeric by octets", ipCmp("192.0.2.9", "192.0.2.10") < 0 && ipCmp("192.0.2.10", "192.0.2.9") > 0 && ipCmp("192.0.2.200", "198.51.100.1") < 0);
t("ipCmp: equal", ipCmp("192.0.2.5", "192.0.2.5") === 0);
t("ipCmp: empty last", ipCmp("", "192.0.2.1") > 0 && ipCmp("192.0.2.1", "") < 0 && ipCmp("", "") === 0);
t("ipCmp: IPv4 before other text", ipCmp("192.0.2.1", "2001:db8::1") < 0);

// sortRows
const rs = [row("a", { name: "EX-SW10", ip: "192.0.2.10", u: "2" }), row("b", { name: "EX-SW2", ip: "192.0.2.9", u: "10" }), row("c", { name: "EX-FW01", ip: "", u: "" })];
t("sortRows: null keeps input order", names(sortRows(rs, null)) === "EX-SW10,EX-SW2,EX-FW01");
t("sortRows: null returns a copy", sortRows(rs, null) !== rs);
t("sortRows: name asc natural", names(sortRows(rs, { col: "name", dir: 1 })) === "EX-FW01,EX-SW2,EX-SW10", names(sortRows(rs, { col: "name", dir: 1 })));
t("sortRows: name desc reverses", names(sortRows(rs, { col: "name", dir: -1 })) === "EX-SW10,EX-SW2,EX-FW01");
t("sortRows: ip numeric, empty last", names(sortRows(rs, { col: "ip", dir: 1 })) === "EX-SW2,EX-SW10,EX-FW01");
t("sortRows: ip desc keeps empty last", names(sortRows(rs, { col: "ip", dir: -1 })) === "EX-SW10,EX-SW2,EX-FW01");
t("sortRows: u numeric", names(sortRows(rs, { col: "u", dir: 1 })) === "EX-SW10,EX-SW2,EX-FW01");
t("sortRows: input not changed", names(rs) === "EX-SW10,EX-SW2,EX-FW01");
const ties = [row("1", { name: "EX-A", kind: "Server" }), row("2", { name: "EX-B", kind: "Router" }), row("3", { name: "EX-C", kind: "Server" }), row("4", { name: "EX-D", kind: "Router" })];
t("sortRows: stable ties (asc)", names(sortRows(ties, { col: "kind", dir: 1 })) === "EX-B,EX-D,EX-A,EX-C");
t("sortRows: stable ties (desc keeps Auvik order inside a tie)", names(sortRows(ties, { col: "kind", dir: -1 })) === "EX-A,EX-C,EX-B,EX-D");
t("sortRows: by rack / status / template / model / type", sortRows([row("x", { rack: "Rack B" }), row("y", { rack: "Rack A" })], { col: "rack", dir: 1 })[0].key === "y"
  && sortRows([row("x", { status: "online" }), row("y", { status: "offline" })], { col: "status", dir: 1 })[0].key === "y"
  && sortRows([row("x", { template: "T2" }), row("y", { template: "T1" })], { col: "template", dir: 1 })[0].key === "y"
  && sortRows([row("x", { model: "M2" }), row("y", { model: "M1" })], { col: "model", dir: 1 })[0].key === "y"
  && sortRows([row("x", { type: "UPS" }), row("y", { type: "Router" })], { col: "type", dir: 1 })[0].key === "y");

// filterRows
const fr = [row("1", { name: "EX-SW01", ip: "192.0.2.11" }), row("2", { name: "EX-PRN01", kind: "Endpoint", type: "Endpoints", status: "offline" }), row("3", { name: "EX-SRV01", kind: "Server", type: "Server", model: "Example R650", rack: "Lab" })];
t("filterRows: empty or blank keeps all", filterRows(fr, "").length === 3 && filterRows(fr, "   ").length === 3);
t("filterRows: name, trimmed, any case", names(filterRows(fr, "  ex-sw ")) === "EX-SW01");
t("filterRows: kind / type / model / rack / ip / status", names(filterRows(fr, "endpoint")) === "EX-PRN01" && names(filterRows(fr, "r650")) === "EX-SRV01"
  && names(filterRows(fr, "lab")) === "EX-SRV01" && names(filterRows(fr, "192.0.2.11")) === "EX-SW01" && names(filterRows(fr, "offline")) === "EX-PRN01" && names(filterRows(fr, "server")) === "EX-SRV01");
t("filterRows: no match", filterRows(fr, "zzz").length === 0);

// setTicked / headState
const ex = new Set(["b", "z"]);
const on = setTicked(ex, ["a", "b"], true);
t("setTicked on: ticks only visible ids, new set", on !== ex && !on.has("b") && on.has("z") && ex.has("b"));
const off = setTicked(ex, ["a", "b"], false);
t("setTicked off: unticks only visible ids", off.has("a") && off.has("b") && off.has("z") && !off.has("c") && !ex.has("a"));
t("headState: all", headState(new Set(["z"]), ["a", "b"]) === "all");
t("headState: none", headState(new Set(["a", "b"]), ["a", "b"]) === "none");
t("headState: some", headState(new Set(["a"]), ["a", "b"]) === "some");
t("headState: no visible rows is none", headState(new Set(), []) === "none");

// setPick: the computed default removes the key, so no hand edit is saved
const r0: Record<string, string> = { k1: "x" };
const r1 = setPick(r0, "k2", "y", "d");
t("setPick: a new value writes the key (new object)", r1 !== r0 && r1.k2 === "y" && r1.k1 === "x" && !("k2" in r0));
const r2 = setPick(r1, "k2", "d", "d");
t("setPick: the default removes the key", !("k2" in r2) && r2.k1 === "x");
t("setPick: the default on an unset key stays unset", !("k3" in setPick(r0, "k3", "d", "d")));

// destOf: the small text under the rack name
t("destOf", destOf("off", "switch") === "To place" && destOf("off", "ap") === "Inventory" && destOf("rack", "server") === "To place"
  && destOf("vm", "vm") === "VM box" && destOf("endpoint", "endpoint") === "Endpoints" && destOf("phone", "endpoint") === "Endpoints" && destOf("iot", "endpoint") === "Endpoints" && destOf("skip", "vm") === "");

// modelLabel: the text of the Model dropdown's value
t("modelLabel", modelLabel("", "Example C9300") === "Example C9300" && modelLabel("tpl:Example 48-port", "x") === "Example 48-port" && modelLabel("vm:vmware", "x") === VM_MODELS.vmware && modelLabel("vm:nope", "x") === "x");

// deviceRowTypes: a device row's Type never offers a box type (Endpoints, Virtual machines) unless it already is one
t("deviceRowTypes: no box types", !deviceRowTypes("Switch").includes("Endpoints") && !deviceRowTypes("Switch").includes("Virtual machines") && deviceRowTypes("Switch").includes("Server") && !deviceRowTypes("").includes("Endpoints"));
t("deviceRowTypes: keeps a current box type shown", deviceRowTypes("Virtual machines").includes("Virtual machines") && !deviceRowTypes("Virtual machines").includes("Endpoints") && deviceRowTypes("Custom Box")[0] === "Custom Box");

console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
