# Import from Auvik polish (3.19.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Polish the web Import from Auvik dialog: green pulsing loading lines, a sortable/filterable device table with select all/none, Kind/Type/Model overrides that are saved as hand edits, Virtual Machine model choices, and a Type dropdown in the Device panel.

**Spec:** `docs/superpowers/specs/2026-11-18-auvik-import-polish-design.md`. Read it before any task. It is the authority.

**Start point:** branch `web` at e68759a (3.19.1 + bot exe).

## Global Constraints

- Release version `3.19.2` (`node scripts/version.mjs 3.19.2`), CHANGELOG heading `## 3.19.2 — 2026-11-18`. Only Task 5 bumps the version.
- New Import-from-Auvik UI code stays in `rackwright-tauri/src/auvik/api/` (web only, lazy-loaded). The desktop build must not import `auvik/api/*` statically. `grep -l tauri-apps web/dist/assets/*.js` must find nothing.
- Pure modules (`map.ts`, `sync.ts`, `plan.ts`, `apply.ts`, `diff.ts`, `source.ts`, new `deviceTypes.ts`, new `auvik/api/table.ts`) must not import `backend.ts` (tests run under `npx tsx`).
- `.rack.json`: no new document fields. `Device.type`/`model`/`source`/`locked` and endpoint `locked` already exist. Older files load and save unchanged.
- The .xlsx import path (`ImportAuvik.tsx`) must behave exactly as before: `scripts/auvik-xlsx-regress.test.ts` passes unchanged. New `PlanItem` fields are optional and unset on that path.
- Hand edits: `markManual(device, field)` from `src/source.ts` (sets `source[field]="manual"`, locks when `auvik_id` is set). For a VM box / Endpoints member, add the field to the member's `locked` array.
- Colours only through `v(token)` from `src/theme.ts`; green loading text uses `v("ok-text")`.
- UI copy is plain language, short sentences.
- Test data made up only (Example IT, EX-SW01, 192.0.2.x). Reuse the fixtures in `web/server/tests/fixtures/auvik/`.
- Before every commit, from `rackwright-tauri`: `npm run build && npm run build:web && for t in scripts/*.test.ts; do npx tsx $t || exit 1; done`. All must pass.
- Customer-data scan before every commit (see HANDOFF / AGENTS); must print only `rackwright-tauri/src/auvik/plan.ts:48`.
- Commit on `web` with `git -c user.name=Hrubak -c user.email=hrubak@gmail.com commit`, message ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push.

## File structure

| File | Responsibility |
|---|---|
| `src/auvik/api/ui.tsx` (rename from `ui.ts`) | `btn`, `inp`, plus `Busy` loading line |
| `src/auvik/api/ImportAuvikApi.tsx` | Use `Busy` for every loading line |
| `src/deviceTypes.ts` (new) | `DEVICE_TYPES`, `typeOptions(current)` |
| `src/panel/DevicePanel.tsx` | Type `<select>` |
| `src/auvik/plan.ts` | `PlanItem.tplOver?/typeOver?/modelOver?`; `resolvePlan` honours `tplOver` |
| `src/auvik/api/map.ts` | `KIND_TYPE`, `vmVendor`, `VM_MODELS`, overrides in `apiItems` |
| `src/auvik/apply.ts` / `diff.ts` | write `typeOver`/`modelOver` as field values |
| `src/auvik/api/sync.ts` | pass overrides through `planSite`; mark manual in `build()` |
| `src/auvik/api/table.ts` (new, pure) | sort comparator, filter, visible-row selection, rack column text |
| `src/auvik/api/SitePreview.tsx` | Table UI |
| `scripts/auvik-api.test.ts`, `scripts/device.test.ts` | Tests |

---

### Task 1: Green pulsing loading lines

**Files:** rename `src/auvik/api/ui.ts` → `ui.tsx` (update imports), modify `ImportAuvikApi.tsx`.

- `export function Busy({ children }: { children: React.ReactNode })` renders `<div role="status" className="rw-busy" style={{ color: v("ok-text") }}>{children}</div>`. A `<BusyStyle/>` (or the same component injecting once) adds:
  `@keyframes rw-busy-pulse { 0%,100% { opacity: 1 } 50% { opacity: .45 } } .rw-busy { animation: rw-busy-pulse 1.6s ease-in-out infinite } @media (prefers-reduced-motion: reduce) { .rw-busy { animation: none } }`. Render the `<style>` once inside the dialog root.
- Replace these lines with `Busy`: "Checking the Auvik connection...", "Loading the Auvik clients...", "Checking the sites already in Rackwright...", the "Testing..." state of the test result, "Reading site N of M: name…", "Importing site N of M: name…". Keep their text and layout (margins) as now. The test result line ("Connection works." / "Connection failed: …") is not a loading line: not green.
- [ ] Implement, run builds and all tests, commit "feat(auvik): green pulsing loading lines in Import from Auvik".

### Task 2: Device types list and Device panel Type dropdown

**Files:** create `src/deviceTypes.ts`; modify `src/panel/DevicePanel.tsx:105`; tests in `scripts/device.test.ts`.

- `export const DEVICE_TYPES: string[]` = sorted unique `CATALOG.map(t => t.type)` (import `CATALOG` from `./edit`) plus `"Endpoints"` and `"Virtual machines"`, sorted with `localeCompare`.
- `export function typeOptions(current: string): string[]` → `DEVICE_TYPES` if it contains `current` or `current` is empty; else `[current, ...DEVICE_TYPES]`.
- DevicePanel: replace the Type `<input>` with `<select style={{ ...inp, width: "100%" }} value={dev.type} onChange={(e) => devSet("type", e.target.value)}>` over `typeOptions(dev.type)`. Keep the label and `lockIcon("type")`.
- Tests: list contains Switch, Server, Wireless, UPS, Patch panel, Endpoints, Virtual machines; no duplicates; sorted; `typeOptions("Custom Box")[0] === "Custom Box"`; `typeOptions("Switch")` equals `DEVICE_TYPES`.
- [ ] TDD: tests first (fail), implement, run builds + all tests, commit "feat: Type is a dropdown of the app's device types in the Device panel".

### Task 3: Overrides in the plan and saved as hand edits (pure)

**Files:** `src/auvik/plan.ts`, `src/auvik/api/map.ts`, `src/auvik/apply.ts` (and `diff.ts` if the field list lives there), `src/auvik/api/sync.ts`, `scripts/auvik-api.test.ts`.

Interfaces:
- `PlanItem` gains optional `tplOver?: string` (catalog template name), `typeOver?: string` (saved Device.type), `modelOver?: string` (saved model text), `kindOver?: boolean` (true when the kind came from the person). All unset on the .xlsx path.
- `resolvePlan`: when `it.tplOver` names a catalog template (`CATALOG.find(c => c.name === it.tplOver)`), use `clone()` of it instead of `matchTemplate` for rack/off units, `generic=false`. `analyze` should also report its name in `tplName` (do it in `apiItems` if simpler).
- In `map.ts`:
  - `export const KIND_TYPE: Record<Kind, string>` = firewall "Firewall", router "Router", switch "Switch", server "Server", storage "Storage", ups "UPS", pdu "PDU", ap "Access Point", ipmi "Intelligent Platform Management Interface", controller "Controller", vm "Virtual Machine", endpoint "Generic Device".
  - `export const KIND_LABEL: Record<Kind, string>` = …, ap "Access point", ipmi "OOBM (iDRAC/iLO)", vm "Virtual machine", endpoint "Endpoint" (others as KIND_TYPE).
  - `export const VM_MODELS = { hyperv: "Virtual Machine – Hyper-V", vmware: "Virtual Machine – VMware", kvm: "Virtual Machine – KVM (Scale HyperCore)" } as const` (en dash).
  - `export function isVirtual(i: PlanItem): boolean` — `i.kind === "vm"` or `/virtual machine|virtual platform|vmware|qemu|\bkvm\b|hyper-?v/i` on `dev.model`.
  - `export function vmVendor(d: AuvikDevice): keyof typeof VM_MODELS | null` over `${model} ${description} ${software}`: `/hyper-?v|microsoft/i` → hyperv; `/vmware|esxi/i` → vmware; `/\bkvm\b|qemu|scale|hypercore/i` → kvm; checked in that order; else null.
  - `export interface Overrides { kinds?: Record<string, Kind>; types?: Record<string, string>; models?: Record<string, string> }` where a model value is `""` (Auvik), `"tpl:<catalog name>"` or `"vm:hyperv|vmware|kvm"`.
  - `apiItems(devs, org, ctx?, over?: Overrides)`: after `buildItems`, apply each `kinds[key]` with `retype(parsed, items, key, KIND_TYPE[kind], ctx)` and set `kindOver: true`; then the existing rack→off pass and the existing per-item fix-ups run (so a rack kind still ends off-rack). Then models: explicit `models[key]` wins (`tpl:` → `tplOver`, `modelOver` = that template's `model || name`; `vm:` → `modelOver` = VM_MODELS text; `""` → nothing); otherwise, when `isVirtual(i)` and `vmVendor(i.dev)` hits, `modelOver` = that VM_MODELS text (pre-pick; not a hand edit). Types: `types[key]` → `typeOver`. `hostGuessed` behaviour unchanged.
  - `export function defaultModelChoice(i: ApiPlanItem): string` → `"vm:<vendor>"` for a pre-pick, else `""`. (The table uses it as the dropdown's default.)
- `apply.ts`: for a unit whose `item.modelOver` is set, the new device's `model` is `modelOver` (source "auvik" unless hand-picked; Task 3 marks hand picks in sync); for matched devices the model field change uses `modelOver` as the "to" value. Same for `typeOver` → `Device.type` (new devices: after `fromTpl`; matched devices: a `type` field change). VM box / Endpoints members take `modelOver` as their `model`. Look at `deviceFields` in `diff.ts` to add the `type` field only when `typeOver` is set, so the .xlsx path's diff is unchanged.
- `sync.ts`:
  - `planSite(..., hosts?, over?: Overrides)` passes `over` to `apiItems` and keeps it on `SitePlan.over`.
  - In `build()` after `applyInPlace`: for each hand-picked override (`over.kinds` → field "type"; `over.types` → "type"; `over.models` with a non-empty value → "model"), find the saved device (`auvik_id === "api:"+apiId`, ignoring `#` suffixes) and `markManual(dev, field)`; for a VM/endpoint member (`endpoints[].key === "api:"+apiId`) push the field into its `locked`. Pre-picks are not marked.
  - The fld change for a hand-picked field is ticked by default on a matched device: expose `export function overrideTicks(p: SitePlan): string[]` returning those change ids, and the screen (Task 4) seeds `over[id]=true` when a pick is made. (Or set `defaultOn` true for those changes in planSite; pick one and test it.)
- Tests (made-up data, the main fixture):
  - a kind override Switch → Endpoint moves EX-SW01 from To place to an Endpoints box, and after `applySite` its member is there; a kind override Endpoint → Server puts a device in column 0 with `source.type==="manual"` and `locked` including "type";
  - a type override "Patch panel" saves `type: "Patch panel"`, manual and locked;
  - `tpl:<a catalog 2U server>` changes the unit's `tpl.u_size` and saves that model, manual and locked;
  - `vmVendor` for each vendor and null for "Acme Box"; a fixture VM with VMware words gets `modelOver === VM_MODELS.vmware` and `hostGuessed` still true; its VM box member's model is that text and NOT locked;
  - a hand `vm:hyperv` on a VM puts `"model"` in the member's `locked`;
  - re-import (plan again on the saved doc, no overrides, `fill:"overwrite"`): the manual `type`/`model` values stay;
  - the .xlsx regression test still passes.
- [ ] TDD, run builds + all tests, commit "feat(auvik): kind, type and model overrides saved as hand edits; Virtual Machine models".

### Task 4: The device table

**Files:** create `src/auvik/api/table.ts` (pure); modify `src/auvik/api/SitePreview.tsx`, `src/auvik/api/ImportAuvikApi.tsx` (pass overrides into `planSite`); tests in `scripts/auvik-api.test.ts`.

- `SiteState` gains `kinds`, `types`, `models` (per `Overrides`), `sort: { col: SortCol; dir: 1 | -1 } | null`, `filter: string`. `newSiteState()` sets them empty / null / "". `planFor` passes `{kinds, types, models}` to `planSite`.
- `table.ts`:
  - `export type SortCol = "name" | "kind" | "type" | "model" | "template" | "u" | "rack" | "ip" | "status"`;
  - `export interface Row { key: string; id: string; name: string; kind: string; type: string; model: string; template: string; u: string; rack: string; dest: string; ip: string; status: string }` (display strings);
  - `export function natCmp(a: string, b: string): number` (`localeCompare(b, undefined, { numeric: true, sensitivity: "base" })`);
  - `export function ipCmp(a, b)` numeric by octets, empty last;
  - `export function sortRows(rows: Row[], s: {col, dir} | null): Row[]` stable; null keeps input order; `u` numeric;
  - `export function filterRows(rows, q)` trimmed, case-insensitive, across name/kind/type/model/rack/ip/status;
  - `export function setTicked(excluded: Set<string>, visibleIds: string[], on: boolean): Set<string>` (new set);
  - `export function headState(excluded, visibleIds): "all" | "none" | "some"`.
- `SitePreview.tsx`:
  - Columns: Import (header checkbox: checked when "all", `indeterminate` via ref when "some"), Name, Kind (select over KIND_LABEL), Type (select over `typeOptions(current)` for rows with mode rack/off; plain box type text "Virtual machines"/"Endpoints" otherwise), Model (select: Auvik's text as `""`, optgroup "Catalog" = `CATALOG` templates whose `type` is the row's current type, optgroup "Virtual Machine" = the three VM_MODELS as `vm:*`; value = `st.models[key] ?? defaultModelChoice(item)`), Template, U, Rack (doc name: the other rack's name when the device is matched in `eff.other`/`elsewhere`, else `eff.target.name`; under it small dim text with To place / Inventory / VM box / Endpoints), Host (unchanged, keeps "Guessed host — check"), IP, Status.
  - Headers for the sortable columns are buttons; click sorts asc, again reverses, show ▲/▼.
  - Above the table: a Filter input (placeholder "Filter devices"), **Select all**, **Select none** (visible rows), and "Set kind for the N ticked rows shown: [select] Apply" (disabled when N=0).
  - Choosing kind/type/model writes `st.kinds/types/models[key]`; choosing `""` for model or the computed kind removes the override. Seed `st.over` for the matching fld change ids as Task 3 decided.
  - Keep the "N of M devices ticked" line counting all rows.
- Tests for `table.ts` functions (natural sort EX-SW2 < EX-SW10, IP numeric, reverse, stable ties, filter, setTicked only touches visible ids, headState three states).
- [ ] TDD for table.ts, implement UI, run builds + all tests + the `tauri-apps` grep, commit "feat(auvik): sortable, filterable device table with select all and kind/type/model pickers".

### Task 5: Browser check and release (controller)

- Browser check with a mocked `fetch` (as in 3.19.0; never the live server): pulse + reduced motion, sort/reverse/filter/header checkbox/bulk kind, Type and Model dropdowns, VM pre-picks, recorded save body has manual sources; Device panel Type dropdown; dark and light.
- `node scripts/version.mjs 3.19.2`, `--check`; CHANGELOG `## 3.19.2 — 2026-11-18` (web dialog changes; desktop gets the Device panel Type dropdown; cables still in 3.20.0).
- Full checks and scan; commit "Release 3.19.2: Import from Auvik polish". Stop before push.
