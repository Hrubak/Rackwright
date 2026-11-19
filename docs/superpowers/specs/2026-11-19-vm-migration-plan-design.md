# 3.21.0 VM migration plan — design

Status: approved 2026-11-19. Base: `origin/web` at 1f05dff (3.20.0). Earlier notes: `docs/vm-migration-handoff.md`.

## Intent

For one site, plan moving its VMs off VMware ESXi and Hyper-V hosts onto a Scale Computing HyperCore cluster, and show plainly whether they fit. Clients use it to sign off the new cluster ("it is big enough, even with a node down"). Techs use it as the VM list for the move.

## Decided by the user

- Works in the web app and the desktop exe.
- VM sizes (vCPU, RAM, disk) are typed in by hand. "Fill from Asio" is a later web-only release: leave a hook, don't build it. No RVTools.
- VMs come from what the site already holds: "Virtual machines" boxes and Auvik-imported VMs (Model = Virtual Machine – Hyper-V / VMware / KVM (Scale HyperCore)).
- Auvik stays the source for network gear and physical hosts.

## Goals, non-goals, anti-goals

- Goals: one target cluster per site; a VM list with sizes; a capacity check with N+1; a section in the Word/PDF report.
- Non-goals (this release): migration waves, VM status (moved/checked), several clusters or plan options per site, host-to-host moves, cloud targets, before/after diagram, "to retire" marks on old hosts, Asio fill, RVTools.
- Anti-goals: a plan that says "fits" when sizes are missing; an Auvik re-import that wipes typed sizes; client data in code or tests.

## Approaches considered

1. **Plan stored on the site (recommended).** A `migration` JSON value on the site, the same way floor plans (`rooms`) are stored: web server `sites.migration` column + `PATCH /api/sites/:id`; desktop `.client.json`. The VM list is read live from the site's rack documents; the plan only holds the cluster, sizes and include/exclude by VM key. A cluster spans racks, so the site is the right owner, and Auvik re-imports never touch it.
2. Sizes stored on each VM row inside the rack documents (`endpoints[i].vcpu`). Simple to read, but every size edit saves a rack file (save conflicts across racks), and re-import code would have to protect three more fields per row.
3. A separate "plan" document type with its own list/save endpoints. Most flexible (plan A vs plan B later), most server work, nothing this release needs.

## Answers to the five questions

### 1. Target cluster and N+1

- **Typed in, with presets that pre-fill.** Fields: cluster name, node count (default 3, min 1), and per node: physical CPU cores, RAM (GB), raw storage (TB). All nodes the same (HyperCore clusters normally are). A "Start from" dropdown pre-fills the per-node fields from a small built-in list (HE150, HE250 and a few HC-series configs); the values stay editable because real nodes are ordered in many configs. The list lives in one small TS file, easy to extend.
- Not picked from rack devices this release: the catalog has only HE150/HE250 with no CPU/RAM/disk, and planned nodes are often not in a rack yet. Later: "link to nodes in racks".
- **N+1 is on by default:** CPU and RAM are checked with one node down (node count − 1). Storage is checked on all nodes but must also leave room to re-mirror after a node loss (see 2). A toggle turns N+1 off (shown in the report as "No failover headroom"). With 1 node, N+1 is off and the result says "No failover".

### 2. Fit math

Pure TS in `src/migration/fit.ts`, unit-tested.

- **CPU:** needed = sum of vCPU of included VMs. Available = cores per node × nodes counted × ratio. Ratio default **4:1** vCPU per physical core, editable (1–10). Cores, not threads.
- **RAM:** **no overcommit** (HyperCore does not overcommit memory). Needed = sum of VM RAM. Available = (RAM per node − reserve per node) × nodes counted. Reserve per node is an editable setting, default **8 GB** — *our estimate; Scale publishes no fixed figure* (3.21.1).
- **Storage:** HyperCore keeps two copies of every block (replication factor 2). Usable = raw per node × nodes ÷ 2. With N+1 on, usable = raw per node × (nodes − 1) ÷ 2, so the cluster can heal after losing a node. Each VM stores two disk sizes: **provisioned** and **used**. Needed = sum of **provisioned** disk (the safe number). Used disk is shown as its own column and total, for information only; it does not change the result. "Keep free" is an editable setting, default **20%**, subtracted from usable. Scale's capacity guidance sets its Major alert at 80% used, which is 20% free ([HyperCore user guide: capacity](https://docs.scalecomputing.com/articles/sc-hypercore-user-guide/capacity), [SCRIBE overview](https://docs.scalecomputing.com/articles/sc-hypercore-user-guide/scribe-overview)).
- **Status per resource:** Fits (≤ 80% of available), Tight (80–100%), Doesn't fit (> 100%). The overall result is the worst of the three.
- **Per VM:** a VM "can't run" if its RAM is more than one node's usable RAM (RAM per node − reserve) or its vCPU is more than one node's **physical cores** (no ratio applied: one VM can't use more vCPUs than a node has cores). Shown on the row and makes the overall result "Doesn't fit".
- **Missing sizes:** an included VM with any blank size makes the result **"Incomplete — N VMs have no size"**, never "Fits". The totals still show what is known.
- Headroom shown as "left for growth": available − needed per resource.

### 3. Where it lives

- **Document:** per site, `SiteItem.migration?: MigrationPlan` (approach 1). Shape:
  `{ v: 1, cluster: { name, nodes, cores, ramGb, rawTb, preset? }, rules: { cpuRatio, ramReserveGb, keepFreePct, nPlus1 }, vms: { [vmKey]: { vcpu?, ramGb?, diskGb?, usedGb?, include?, notes?, source?: { vcpu?, ramGb?, diskGb?, usedGb? } } } }` (`diskGb` = provisioned, `usedGb` = used). Unknown fields survive load and save. Server: new `migration TEXT NOT NULL DEFAULT '{}'` column added like `rooms`, size limit 256 KB, documented in `web/API.md` first.
- **VM key:** the Auvik key when the row has one (`auvik:<key>`), else `<rackKey>#<deviceId>#<name>`. A plan entry whose VM is no longer found stays, listed under "No longer in the racks" with a Remove button, so nothing typed is lost.
- **UI:** a new client tab **"Migration"** next to Floor plan / Inventory / Cabling, with the same site picker (one site at a time). Layout:

  ```
  Site: [Example HQ v]                      Result: TIGHT (RAM 91%)
  Target cluster  [EX-CL01] Nodes [3] Start from [HC-series v]
    Per node: Cores [24]  RAM [384] GB  Storage [7.7] TB raw
    Rules: vCPU per core [4]  RAM reserve [8] GB  Keep free [20]%  [x] N+1
  Capacity        Needed   Available (1 node down)   Used   Left
    vCPU            96          192                   50%    96
    RAM (GB)       688          752                   91%    64
    Disk (TB)       5.1          6.2                  82%    1.1   (used today: 3.2)
  VMs (14 included, 2 excluded, 1 with no size)      [filter]
    [x] EX-SQL01   EX-HV01  Hyper-V   vCPU [8]  RAM [64]  Disk [500]  Used [310]
    [ ] EX-VCSA    EX-ESX01 VMware    (excluded: infrastructure)
  ```

  Sizes edit inline, Tab moves across a row then down. Saves like floor plans (one PATCH, debounced, with the unsaved-changes guard).
- Default include: all VMs, except the ones the Auvik import already marks as infrastructure (`INFRA_VM`: vCenter, vCLS and the like) and VMs already on KVM (Scale), which start excluded with the reason shown; the user can tick them.

### 4. Report

- Yes, in both Word and PDF, from the same `ReportModel` (new `migration` per `SiteSection`).
- **Section:** inside each site's section, after "Devices at <site>", a Heading 2 **"VM migration to <cluster name>"**. Overview level: the cluster line, the capacity table and the result. Detailed level adds the VM table (VM, now on, platform, vCPU, RAM, disk provisioned, disk used). Excluded VMs and notes are not printed.
- Only for sites that have a plan. A tick box in the report dialog, "VM migration plan", on by default when any chosen site has one.
- No new marker: it goes in the generated body at `{{RACKWRIGHT}}`, like every other section. A `{{MIGRATION}}` marker can come later if a template needs it on its own page.

### 5. Waves

Later (3.22.0 or after). The `vms` entries and the `v` field leave room for `wave` and `status` without a format change. Building waves now doubles the UI before the capacity check has been used on a real job.

## Asio hook (not built)

`src/migration/sources.ts` exports `interface SizeSource { id: "manual" | "asio"; available(): boolean; fill(site, vms): Promise<Record<vmKey, Partial<Sizes>>> }` and only the manual source. Each size field records its source in `vms[key].source`; a later fill writes empty fields only unless the user picks overwrite (the rule shared with the Auvik import). The tab has a spot for a "Fill sizes" button that renders only when a non-manual source is available, so the Asio release adds a source and a server route, nothing else.

## Constraints

- Shared front end; nothing web-only in this release, so no `IS_WEB` branches beyond the store.
- `.rack.json` is unchanged. `.client.json` gains `sites[].migration`; older desktop builds keep it (unknown fields survive).
- No Rust toolchain locally: the server change is small and CI compiles it; add a test in `web/server/tests/api.rs` (PATCH migration, round-trip, 400 on too large / not an object).
- Colours only through `v(token)`; plain-language copy.
- Tests and examples use made-up sites only ("Example IT", "Example HQ", "EX-HV01", "EX-ESX01", "EX-CL01").

## Tasks (for the plan)

1. Server + API.md + store: `migration` on sites (web column + PATCH, desktop `.client.json`), test.
2. `src/migration/`: types, VM list from docs (keys, host, platform, defaults), fit math, presets, size-source hook; `scripts/migration.test.ts`.
3. Migration tab UI.
4. Report model + Word + PDF section and the dialog tick box.
5. CHANGELOG 3.21.0, README, version bump, roadmap.

Each task by a Sonnet subagent at low effort, a reviewer at medium after each, then builds, tests, the data scan and a browser check in the main session. Stop before pushing.

## Left to the builder

Exact preset values (from public Scale spec sheets, marked as starting points), column widths, debounce timing, filter details.

## Node presets

Rule (user, 2026-11-19): ship a preset only if its numbers come from a Scale Computing spec sheet cited here; otherwise leave it out. An empty "Start from" list is fine.

3.21.0 ships **no presets**. Scale's sheets (for example the [SC Platform Family Brochure](https://www.scalecomputing.com/documents/Data-Sheets/SC-Platform-Family-Brochure.pdf) and the [SC Hardware Data Sheet](https://scalecomputing.com/documents/Data-Sheets/SC-Hardware-Data-Sheet.pdf)) list each node as a set of options (HE150: RAM 8, 16, 32 or 64 GB; one NVMe drive of 500 GB to 4 TB), not as fixed node sizes, and the HE250 rows don't clearly give CPU, RAM and storage. Any one preset would be our choice of options, not a spec-sheet number. The "Start from" dropdown is hidden while the list is empty; nodes are typed from the quote.

## Defaults checked against Scale's guidance (3.21.1)

Checked by the user on 2026-11-19 against the [HyperCore user guide: capacity](https://docs.scalecomputing.com/articles/sc-hypercore-user-guide/capacity) and the [SCRIBE overview](https://docs.scalecomputing.com/articles/sc-hypercore-user-guide/scribe-overview):

- **Keep free 20%:** confirmed. It matches Scale's Major alert level (80% used).
- **N+1 on by default for RAM:** confirmed. Scale sizes RAM so the cluster can lose a node.
- **RAM reserve 8 GB per node:** our estimate. Scale publishes no fixed figure. It stays an editable setting, and the Migration tab says so next to the rules.

The report prints the rules used under the capacity table: vCPU per core, N+1 on or off, the per-node RAM reserve and the keep-free percentage, as counted (after limits).

## Approval

Approved by the user on 2026-11-19 with three changes, all applied above: provisioned and used disk per VM (fit uses provisioned); the single-VM check also fails when vCPU is more than one node's physical cores; the 8 GB reserve and 20% keep-free are editable settings marked "to be checked against Scale's guidance".
