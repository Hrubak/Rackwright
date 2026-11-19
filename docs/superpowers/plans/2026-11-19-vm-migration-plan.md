# 3.21.0 VM Migration Plan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For one site, plan moving its VMs onto a Scale Computing HyperCore cluster and show whether they fit, in the Migration tab and in the Word/PDF report, on web and desktop.

**Architecture:** The plan is a JSON value on the site (`SiteItem.migration`), stored like floor plans (`rooms`): a `migration` column on the web server, `sites[].migration` in `.client.json` on the desktop. The VM list is read live from the site's rack documents; pure TS in `src/migration/` turns docs + plan into VM rows and a fit result, which the tab and the report both use.

**Tech Stack:** React + TypeScript (rackwright-tauri/src), Rust axum + rusqlite (web/server), tests with `npx tsx scripts/*.test.ts`.

**Spec:** `docs/superpowers/specs/2026-11-19-vm-migration-plan-design.md`

## Global Constraints

- Branch `web`, base 1f05dff + the design commit 9b38956. Commit per task; do not push.
- Commit author: `git -c user.name=Hrubak -c user.email=hrubak@gmail.com commit`; message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Made-up data only in code, tests and examples: "Example IT", "Example HQ", "EX-HV01", "EX-ESX01", "EX-CL01", "EX-SQL01", "EX-VCSA". Never real client names, IPs or hostnames.
- Do not touch secrets or `.env` files.
- Shared front end: no Tauri imports in `src/migration/`; desktop-only code stays behind dynamic `@tauri-apps` imports.
- Colours only through `v(token)` from `src/theme.ts`; plain-language UI copy.
- Unknown fields in `.client.json` and in the plan JSON survive load and save.
- No Rust toolchain on this PC: Rust changes are compiled by CI. Never end a block with `stmt.query_map(...)?.collect()?` (bind to a variable first).
- Units: VM RAM and disk in GB; node RAM in GB; node storage in TB; 1 TB = 1000 GB.
- Defaults: vCPU per core **4**, RAM reserve per node **8 GB**, keep free **20%**, N+1 **on**, nodes **3**. The 8 GB and 20% are editable settings and are *to be checked against Scale's guidance*: do not look them up or change them.
- Fit thresholds: Fits ≤ 80%, Tight > 80% and ≤ 100%, Doesn't fit > 100%.
- Before each commit (from `rackwright-tauri`): `npm run build && npm run build:web && for t in scripts/*.test.ts; do npx tsx $t || exit 1; done`. All must pass.

## Review Focus

1. A site with zero VMs, or a plan with 0 nodes / 0 cores: the tab and report show "0" and a clear result, never NaN, Infinity or a crash. → tests in Task 3 (`zero cluster`, `no vms`).
2. A 1-node cluster with N+1 on: counted nodes stays 1 (not 0), and the result says "No failover". → test in Task 3 (`one node`).
3. A VM row removed from the racks (re-import, rack removed from site): its typed sizes stay in the plan and it shows under "No longer in the racks". → test in Task 2 (`orphans`).
4. The same Auvik VM in two rack documents of one site: it appears once and its sizes are not double-counted. → test in Task 2 (`dedupe by key`).
5. Typing in a size box: blank, "0", negative, "abc" and decimals. Blank clears the value; negative and non-numbers are ignored; vCPU rounds to a whole number. → `parseSize` test in Task 3.

---

### Task 1: Store the plan on the site (server, API, client store, types)

**Files:**
- Create: `rackwright-tauri/src/migration/types.ts`
- Modify: `web/API.md` (Site shape and `PATCH /api/sites/:id` row, near line 165–177)
- Modify: `web/server/src/clients.rs` (column migration near line 81–92; `Site` struct ~226; `SITE_SELECT`/`row_site` ~237; `PatchSiteReq` + `patch_site` ~397–450)
- Modify: `web/server/tests/api.rs` (new test next to `site_rooms_round_trip` ~434)
- Modify: `rackwright-tauri/src/api.ts:67,78` (`SiteRow.migration?`, `patchSite` param)
- Modify: `rackwright-tauri/src/clients/store.ts` (`SiteItem`, `ClientStore.setMigration`, web store ~66/76, `ClientFile` ~93, desktop `get` ~136 and new `setMigration` next to `setRooms` ~172)
- Test: `rackwright-tauri/scripts/migration.test.ts` (new)

**Interfaces:**
- Produces (`src/migration/types.ts`):
  ```ts
  export type SizeField = "vcpu" | "ramGb" | "diskGb" | "usedGb";
  export type SizeSourceId = "manual" | "asio";
  export interface ClusterSpec { name: string; nodes: number; cores: number; ramGb: number; rawTb: number; preset?: string }
  export interface FitRules { cpuRatio: number; ramReserveGb: number; keepFreePct: number; nPlus1: boolean }
  export interface VmEntry { vcpu?: number; ramGb?: number; diskGb?: number; usedGb?: number; include?: boolean; notes?: string; source?: Partial<Record<SizeField, SizeSourceId>> }
  export interface MigrationPlan { v: 1; cluster: ClusterSpec; rules: FitRules; vms: Record<string, VmEntry>; [k: string]: unknown }
  export const DEFAULT_RULES: FitRules; // { cpuRatio: 4, ramReserveGb: 8, keepFreePct: 20, nPlus1: true }
  export function newPlan(siteName: string): MigrationPlan; // cluster { name: `${siteName} cluster`, nodes: 3, cores: 0, ramGb: 0, rawTb: 0 }, DEFAULT_RULES, vms {}
  export function readPlan(x: unknown): MigrationPlan | undefined; // undefined for null, non-objects and {} (no cluster); fills missing rules from DEFAULT_RULES; keeps unknown keys
  ```
- Produces (store): `SiteItem.migration?: MigrationPlan`; `ClientStore.setMigration(key: string, siteId: number, plan: MigrationPlan | null): Promise<void>`. Web sends `patchSite(id, { migration: plan ?? {} })`; desktop sets `site(f, id).migration = plan` or deletes the field for `null`. Both `get` paths run the stored value through `readPlan`.
- Produces (HTTP): `Site.migration` is a JSON object, `{}` by default. `PATCH /api/sites/:id` accepts `migration?` (object, ≤ 256 KB), else 400 with "Migration plan must be an object" / "Migration plan is too large".

- [ ] **Step 1: Write `web/API.md` changes first** (Site shape gains `"migration": {...} /* JSON object, {} by default */`; PATCH row gains `migration?` with the two 400 messages).
- [ ] **Step 2: Write the failing TS test** in `scripts/migration.test.ts` (same `eq` helper style as `scripts/clients.test.ts`):
  ```ts
  eq("readPlan empty", readPlan({}), undefined);
  eq("readPlan null", readPlan(null), undefined);
  const p = newPlan("Example HQ");
  eq("newPlan name", p.cluster.name, "Example HQ cluster");
  eq("newPlan rules", p.rules, { cpuRatio: 4, ramReserveGb: 8, keepFreePct: 20, nPlus1: true });
  eq("readPlan fills rules", readPlan({ v: 1, cluster: p.cluster, vms: {} })!.rules, DEFAULT_RULES);
  eq("readPlan keeps unknown", (readPlan({ ...p, waves: [1] }) as any).waves, [1]);
  ```
- [ ] **Step 3: Run** `npx tsx scripts/migration.test.ts` — expect failure (module not found).
- [ ] **Step 4: Implement `src/migration/types.ts`.**
- [ ] **Step 5: Run the test** — expect no FAIL lines, exit 0.
- [ ] **Step 6: Server:** add the column the way `rooms` is added (`ALTER TABLE sites ADD COLUMN migration TEXT NOT NULL DEFAULT '{}'` when missing); `Site.migration: Value` parsed by `parse_migration` (object or `{}`); `SITE_SELECT` gains `migration`; `PatchSiteReq.migration: Option<Value>` validated like `rooms` with `MAX_MIGRATION = 256 * 1024`; separate `UPDATE sites SET migration = ?1 WHERE id = ?2`.
- [ ] **Step 7: Rust test** `site_migration_round_trip` modelled on `site_rooms_round_trip`: new site has `migration == {}`; PATCH a made-up plan object then GET returns it; PATCH `[]` → 400; PATCH an object larger than 256 KB → 400; value unchanged after the failures; a PATCH with only `name` leaves `migration` unchanged.
- [ ] **Step 8: Client store + `api.ts`** as in Interfaces.
- [ ] **Step 9: Run the full pre-commit check** (Global Constraints). Expect builds and all tests pass.
- [ ] **Step 10: Commit** `feat(migration): store a VM migration plan on each site`.

### Task 2: VM list for a site

**Files:**
- Create: `rackwright-tauri/src/migration/vms.ts`
- Modify: `rackwright-tauri/src/auvik/plan.ts:53` (export `INFRA_VM`; no behaviour change)
- Test: `rackwright-tauri/scripts/migration.test.ts`

**Interfaces:**
- Consumes: `MigrationPlan`, `VmEntry` (Task 1); `Doc`, `Device` from `src/types.ts`; `INFRA_VM`.
- Produces:
  ```ts
  export type Platform = "vmware" | "hyperv" | "scale" | "unknown";
  export const PLATFORM_LABEL: Record<Platform, string>; // VMware, Hyper-V, Scale HyperCore, Unknown
  export interface SiteVm { key: string; name: string; host: string; platform: Platform; rackKey: string; rackName: string; deviceId: number; ip: string; infra: boolean }
  export function siteVms(racks: { key: string; name: string }[], docs: Record<string, Doc | string>): SiteVm[];
  export function defaultInclude(vm: SiteVm): { include: boolean; reason: string };
  export function isIncluded(vm: SiteVm, e?: VmEntry): boolean; // e?.include ?? defaultInclude(vm).include
  export function orphanKeys(plan: MigrationPlan, vms: SiteVm[]): string[]; // plan.vms keys with no matching vm, sorted
  ```

Rules the implementer cannot guess:
- VM sources, per loaded doc (skip string entries = load errors): (a) every row of `endpoints` on a device with `type === "Virtual machines"`; (b) rows with `kind === "vm"` in any other device's `endpoints`; (c) devices (not boxes) whose `model` starts with "Virtual Machine".
- Key: row `key` → `auvik:${key}`; device `auvik_id` → `auvik:${auvik_id}`; else `${rackKey}#${deviceId}#${name}`. First occurrence wins (dedupe by key). Sort by name, case-insensitive.
- Host: for (a), the name of the device `vm_host` points to in the same doc, else ""; for (b), the containing device's name; for (c), "".
- Platform: test the row/device `model` first, then the host device's `model`, `os` and `name`: `/hyper-?v/i` → hyperv; `/vmware|esxi/i` → vmware; `/kvm|scale|hypercore/i` → scale; else unknown.
- `infra = INFRA_VM.test(`${name} ${model}`) || /\bvcls\b/i.test(name)`.
- `defaultInclude`: infra → `{ include: false, reason: "Infrastructure VM" }`; platform scale → `{ include: false, reason: "Already on Scale" }`; else `{ include: true, reason: "" }`.

- [ ] **Step 1: Write failing tests** with a made-up doc: a "Virtual machines" box `vm_host` → server "EX-HV01" (model "PowerEdge R650", os "Windows Server 2022 Hyper-V") holding rows EX-SQL01 (key "a1", model "Virtual Machine – Hyper-V"), EX-VCSA (key "a2", model "Virtual Machine – VMware"), EX-APP01 (no key, model ""); an Endpoints box with one `kind: "vm"` row EX-WEB01; a second doc holding the same row key "a1".
  - `siteVms` names = ["EX-APP01", "EX-SQL01", "EX-VCSA", "EX-WEB01"] (dedupe by key).
  - EX-SQL01: key "auvik:a1", host "EX-HV01", platform "hyperv". EX-APP01: key `${rackKey}#${boxId}#EX-APP01`, platform "hyperv" (from host os).
  - `defaultInclude(EX-VCSA)` = `{ include: false, reason: "Infrastructure VM" }`; a row with model "Virtual Machine – KVM (Scale HyperCore)" → "Already on Scale".
  - `isIncluded(vcsa, { include: true })` = true.
  - `orphans`: plan.vms has "auvik:a1" and "auvik:gone" → `orphanKeys` = ["auvik:gone"].
  - A string doc entry is skipped without throwing.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement `vms.ts`; export `INFRA_VM`.**
- [ ] **Step 4: Run** — expect pass.
- [ ] **Step 5: Pre-commit check, commit** `feat(migration): list a site's VMs from its racks`.

### Task 3: Fit math, presets and the size-source hook

**Files:**
- Create: `rackwright-tauri/src/migration/fit.ts`, `rackwright-tauri/src/migration/presets.ts`, `rackwright-tauri/src/migration/sources.ts`
- Test: `rackwright-tauri/scripts/migration.test.ts`

**Interfaces:**
- Consumes: Task 1 types; `SiteVm`, `isIncluded` (Task 2).
- Produces (`fit.ts`):
  ```ts
  export type Level = "fits" | "tight" | "over";
  export type Overall = Level | "incomplete";
  export interface ResourceFit { needed: number; available: number; usedPct: number; left: number; level: Level }
  export interface FitResult {
    cpu: ResourceFit; ram: ResourceFit; disk: ResourceFit; // cpu in vCPU, ram in GB, disk in TB
    usedTb: number; counted: number; failover: "n+1" | "off" | "none";
    problems: { key: string; reason: string }[]; missing: string[]; // keys
    included: number; excluded: number; overall: Overall;
  }
  export const LEVEL_TEXT: Record<Overall, string>; // Fits, Tight, Doesn't fit, Incomplete
  export function fitPlan(plan: MigrationPlan, vms: SiteVm[]): FitResult;
  export function resultText(f: FitResult): string;
  export function failoverText(f: FitResult): string; // "One node down (N+1)" | "No failover headroom" | "No failover"
  export function parseSize(text: string, whole: boolean): number | undefined | null; // undefined = cleared, null = ignore input
  ```
- Produces (`presets.ts`): `export interface NodePreset { id: string; label: string; cores: number; ramGb: number; rawTb: number }`, `export const NODE_PRESETS: NodePreset[]`.
- Produces (`sources.ts`): `export interface SizeSource { id: SizeSourceId; label: string; available(): boolean; fill(siteId: number, vms: SiteVm[]): Promise<Record<string, Partial<Pick<VmEntry, SizeField>>>> }`, `export const SIZE_SOURCES: SizeSource[]` (only manual; its `available()` is false so no "Fill sizes" button shows), `export function applyFill(plan: MigrationPlan, fill: Record<string, Partial<Pick<VmEntry, SizeField>>>, from: SizeSourceId, overwrite: boolean): MigrationPlan` (writes empty fields only unless `overwrite`, records `source[field] = from`).

Math (only VMs where `isIncluded` is true count; blank sizes count as 0):
- `counted = nodes <= 1 ? max(nodes, 0) : nPlus1 ? nodes - 1 : nodes`; `failover = nodes <= 1 ? "none" : nPlus1 ? "n+1" : "off"`.
- cpu: needed = Σ vcpu; available = cores × counted × cpuRatio.
- ram: needed = Σ ramGb; available = max(0, ramGb − ramReserveGb) × counted.
- disk: needed = Σ diskGb / 1000; available = rawTb × counted / 2 × (1 − keepFreePct / 100). `usedTb` = Σ usedGb / 1000 (information only).
- `usedPct = available > 0 ? needed / available × 100 : needed > 0 ? Infinity : 0`; level from the thresholds; `left = available − needed`.
- problems, per included VM: `ramGb > max(0, node ramGb − reserve)` → "Needs more RAM than one node has (N GB)"; `vcpu > cores` → "Needs more vCPUs than one node has cores (N)". Both can apply (two entries).
- missing: included VMs with blank `vcpu`, `ramGb` or `diskGb` (`usedGb` is optional).
- overall: any problem or any resource "over" → "over"; else missing → "incomplete"; else the worst of the three levels.
- `resultText`: "Fits", "Tight (RAM 91%)" naming the fullest resource, "Doesn't fit (RAM 112%)" or "Doesn't fit (1 VM too big for a node)", "Incomplete — 1 VM has no size" / "— 3 VMs have no size".
- `parseSize`: trimmed "" → undefined; not a finite number or < 0 → null; `whole` rounds; else the number.

- [ ] **Step 1: Write failing tests.** Cluster 3 nodes × 24 cores × 384 GB × 7.7 TB, DEFAULT_RULES:
  - one VM 8 vCPU / 64 GB / 500 GB / used 310: cpu.available 192, ram.available 752, disk.available ≈ 6.16 (`Math.abs(x - 6.16) < 1e-9`), usedTb 0.31, overall "fits", failoverText "One node down (N+1)".
  - nPlus1 false: counted 3, cpu.available 288.
  - VM with 30 vCPU: problem "Needs more vCPUs than one node has cores (24)", overall "over" (even though total cpu fits).
  - VM with 380 GB RAM: problem "Needs more RAM than one node has (376 GB)".
  - RAM total 700 of 752 → ram.level "tight", resultText "Tight (RAM 93%)".
  - an included VM with no `diskGb` → overall "incomplete", resultText "Incomplete — 1 VM has no size"; missing `usedGb` alone → still "fits".
  - excluded VM (infra) sizes not counted; `included`/`excluded` counts right.
  - `zero cluster`: nodes 3, cores 0 → cpu.available 0, cpu.level "over" when needed > 0, cpu.usedPct Infinity, and no field of cpu/ram/disk is NaN (`Number.isNaN` false for needed, available, usedPct, left).
  - `no vms`: overall "fits", all needed 0.
  - `one node`: nodes 1, nPlus1 true → counted 1, failover "none".
  - `parseSize`: "" → undefined, "abc" → null, "-1" → null, "7.6" whole → 8, "1.5" → 1.5, "0" → 0.
  - `applyFill`: an existing vcpu 4 stays with overwrite false and becomes the filled value with overwrite true; `source.vcpu` = "asio" only where written.
  - `NODE_PRESETS` every entry has positive cores, ramGb and rawTb and a unique id.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement `fit.ts`, `sources.ts`.**
- [ ] **Step 4: Implement `presets.ts`:** ship a preset only if every number in it comes from a Scale Computing spec sheet that is cited (title + URL) in the design doc's "Node presets" section; the main session supplies those entries and citations. Otherwise `NODE_PRESETS = []` and the "Start from" list is empty (the tab hides the dropdown when empty). The preset test checks entries only when the list is non-empty.
- [ ] **Step 5: Run** — expect pass.
- [ ] **Step 6: Pre-commit check, commit** `feat(migration): capacity check with N+1 for a HyperCore cluster`.

### Task 4: Migration tab

**Files:**
- Create: `rackwright-tauri/src/migration/MigrationTab.tsx`
- Modify: `rackwright-tauri/src/home/Dashboard.tsx:20` (`ClientTab` gains `"migration"`)
- Modify: `rackwright-tauri/src/clients/ClientBar.tsx:8` (`CLIENT_TABS` gains `["migration", "Migration"]` after `["cabling", "Cabling"]`)
- Modify: `rackwright-tauri/src/clients/ClientPage.tsx:~149–152` (render the tab)

**Interfaces:**
- Consumes: `siteVms`, `isIncluded`, `defaultInclude`, `orphanKeys`, `PLATFORM_LABEL` (Task 2); `fitPlan`, `resultText`, `failoverText`, `LEVEL_TEXT`, `parseSize` (Task 3); `NODE_PRESETS`, `SIZE_SOURCES` (Task 3); `newPlan`, `store.setMigration` (Task 1).
- Produces: `export default function MigrationTab(p: { client: ClientItem; siteId?: number; docs: Record<string, Doc | string>; onSaved: () => void }): JSX.Element`, rendered as `{tab === "migration" && <MigrationTab client={client} siteId={siteFilter} docs={docs} onSaved={refresh} />}`.

Behaviour:
- Site choice and the "pick a site" state work like `rooms/FloorTab.tsx` (same props and site handling).
- No plan: short text "No migration plan for this site yet." and a "Start a plan" button → `newPlan(site.name)`.
- Plan: the layout in the spec's section 3 — cluster row (name, nodes, Start from dropdown over `NODE_PRESETS` that fills cores/ramGb/rawTb and sets `preset`), per-node row, rules row (vCPU per core, RAM reserve GB, Keep free %, N+1 checkbox) with a small note "Defaults to be checked against Scale's guidance." next to RAM reserve and Keep free; capacity table (Needed, Available with `failoverText`, Used %, Left; plus "Used today: X TB" on the disk row); the result in large text coloured by level through `v()` tokens already used for ok/warn/error in the app; VM table with include checkbox, name, now on (host), platform, vCPU, RAM GB, Disk GB (provisioned), Used GB, and the problem or exclusion reason; a "No longer in the racks" list from `orphanKeys` with a Remove button each; a text filter on name/host.
- Size inputs use `parseSize` (`whole` for vCPU); `null` keeps the old value. Editing a size sets `source[field] = "manual"`.
- A "Fill sizes" button renders only when some `SIZE_SOURCES` entry is `available()` (none this release).
- Saving: copy FloorTab's pattern (dirty ref, 600 ms debounce, flush on unmount, the saved indicator) and add `useLeaveGuard(dirty)` from `src/unsaved.ts` while a save is pending.
- "Delete plan" button with a confirm → `setMigration(..., null)`.

- [ ] **Step 1: Implement the tab and wiring.**
- [ ] **Step 2: Pre-commit check** — builds pass; `grep -l tauri-apps ../web/dist/assets/*.js` finds nothing.
- [ ] **Step 3: Browser check (main session):** web dev preview per HANDOFF.md with fetch mocked in the page (no test data in the live server): a made-up "Example IT" / "Example HQ" site with EX-HV01 and VMs; start a plan, pick a preset, type sizes, see the result move Fits → Tight → Doesn't fit, exclude a VM, reload and see values kept (mocked PATCH), dark theme readable. Screenshot.
- [ ] **Step 4: Commit** `feat(migration): Migration tab for a site`.

### Task 5: Report section (Word and PDF)

**Files:**
- Modify: `rackwright-tauri/src/report/types.ts` (`ReportOptions.migration?: boolean`, default true when absent)
- Modify: `rackwright-tauri/src/report/model.ts` (`SiteSection.migration?`, built in `buildReportModel`)
- Modify: `rackwright-tauri/src/report/docxBody.ts:~140–152`
- Modify: `rackwright-tauri/src/report/pdf.ts:~280–292`
- Modify: `rackwright-tauri/src/report/ReportDialog.tsx` (tick box, saved with the other options)
- Test: `rackwright-tauri/scripts/report.test.ts`, `rackwright-tauri/scripts/docx.test.ts`

**Interfaces:**
- Consumes: `readPlan` result on `SiteItem.migration`; `siteVms`, `isIncluded`, `fitPlan`, `resultText`, `failoverText`, `PLATFORM_LABEL`.
- Produces (`model.ts`):
  ```ts
  export interface MigrationSection {
    title: string;            // `VM migration to ${cluster.name}`
    clusterLine: string;      // "3 nodes, each 24 cores, 384 GB RAM and 7.7 TB raw storage. One node down (N+1)."
    capacity: string[][];     // header row ["Resource","Needed","Available","Used","Left"], then vCPU, RAM (GB), Disk (TB) rows, formatted
    result: string;           // `Result: ${resultText(fit)}`
    vms: string[][];          // included VMs only: [name, host, platform, vcpu, ramGb, diskGb, usedGb] as text, "" for blanks
  }
  // SiteSection gains: migration?: MigrationSection  (only when the site has a plan and options.migration !== false)
  ```
- Numbers: whole numbers for vCPU and GB, one decimal for TB, `Math.round` for %, "∞" never printed (an unavailable resource prints "0" available and "—" used).

Placement (both renderers, same headings): overview level — right after the site's block, Heading 2 `title`, `clusterLine`, capacity table, `result`. Detailed level — after "Devices at <site>" (or where it would be), the same plus a VM table with heads VM, Now on, Platform, vCPU, RAM (GB), Disk (GB), Used (GB). Excluded VMs and notes are never printed. Dialog: checkbox "VM migration plan" shown only when a chosen site has a plan, checked by default, stored as `migration` in the report options.

- [ ] **Step 1: Failing tests.** `report.test.ts`: a made-up client with one site holding a plan (3 nodes, 2 VMs, one excluded) → `sites[0].migration.title` = "VM migration to EX-CL01", `vms.length` = 1, `capacity[0]` = header row, `result` starts "Result: "; with `options.migration = false` → `migration` undefined; a site without a plan → undefined. `docx.test.ts`: `buildBodyXml` output contains "VM migration to EX-CL01" at overview level and the "Used (GB)" head only at detailed level; XML is valid (existing `XMLValidator` check).
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement model, docx, PDF, dialog.**
- [ ] **Step 4: Run** — expect pass.
- [ ] **Step 5: Pre-commit check; export a made-up PDF and Word report in the browser preview and look at the section. Commit** `feat(report): VM migration section in the Word and PDF report`.

### Task 6: Release 3.21.0 (main session, no subagent)

**Files:** `CHANGELOG.md`, `README.md` (feature list), `docs/roadmap.md` (3.21.0 done; waves and Asio fill next), version files via `node scripts/version.mjs 3.21.0`.

- [ ] **Step 1:** CHANGELOG `## 3.21.0 — <date>`, plain sentences: the Migration tab, what the result means, that the reserve and keep-free defaults are settings to check, the report section, that sizes are typed in this release.
- [ ] **Step 2:** `node scripts/version.mjs 3.21.0` then `node scripts/version.mjs --check`.
- [ ] **Step 3:** Full pre-commit check, the customer-data scan from HANDOFF.md (only the known `vsz` hit in `src/auvik/plan.ts`), `grep -l tauri-apps web/dist/assets/*.js` empty.
- [ ] **Step 4:** Whole-branch review (one reviewer). Fix what it finds.
- [ ] **Step 5:** Commit `Release 3.21.0: VM migration plan`. **Stop. Ask the user "Push it" or "Not yet".**

## Execution

Subagent-driven, per the user: Tasks 1–5 each by a Sonnet implementer at low effort, then a reviewer at medium; the main session runs builds, tests, the browser checks and Task 6.
