# Import from Auvik polish (3.19.2) — design note

Status: written 2026-11-18. Release 3.19.2, a patch on 3.19.1. Mostly web (the Import from Auvik screen); one shared change (the Device panel's Type field) also reaches the desktop app. Next release after this is still **3.20.0 Auvik cables**, as in the 3.19.0 plan. Cabling is not part of 3.19.2.

Builds on `2026-11-18-auvik-api-import-design.md`. The import pipeline, re-import rules and the "fill empty only" rule don't change.

## 1. Loading text

Every "loading" line in the dialog shows in green (`v("ok-text")`) and pulses gently (opacity 1 → 0.45 → 1, about 1.6 s). These are: "Checking the Auvik connection...", "Loading the Auvik clients...", "Checking the sites already in Rackwright...", "Testing...", "Reading site N of M…", "Importing site N of M…".

- One small component, `Busy` in `auvik/api/ui.ts(x)`, renders the line. The keyframes are put in once with a `<style>` tag inside the dialog, so nothing global changes.
- `@media (prefers-reduced-motion: reduce)`: no animation, steady green.
- It has `role="status"` so screen readers read it once.

## 2. Device table (each site tab)

Columns: Import, Name, Kind, Type, Model, Template, U, Rack, Host, IP, Status.

- **Kind** is where the device goes: Firewall, Router, Switch, Server, Storage, UPS, PDU, Access point, OOBM (iDRAC/iLO), Controller, Virtual machine, Endpoint. It's a dropdown.
- **Type** is the device type saved on the rack device. It's a dropdown of the app's device types (see 2.4).
- **Model** is a dropdown (see 2.5).
- **Rack** is the rack document the device is already in, or the one it goes to. For example "Main office (Auvik)" or "Rack A". This is the "site" column: every row in a tab belongs to the same Auvik site, so the useful thing to show is which document holds the device. Below it, in small text: To place / Inventory / VM box / Endpoints.

### 2.1 Sorting

Click a header to sort by it. Click again to reverse. A small ▲/▼ shows the column and direction. Sortable: Name, Kind, Type, Model, Template, U, Rack, IP, Status. Name sorting puts numbers in order (EX-SW2 before EX-SW10). IP sorting is numeric. Rows that are equal keep Auvik's order. The default is Auvik's order. The sort is per tab and kept in `SiteState`.

### 2.2 Filter, Select all / Select none, header checkbox

- A **Filter** box above the table. It matches the text in Name, Kind, Type, Model, Rack, IP and Status (trimmed, ignoring case).
- **Select all** and **Select none** buttons, and a checkbox in the Import header. All of them act on the **visible** rows only (the filtered rows). The header box is ticked when every visible row is ticked, blank when none is, and in-between (indeterminate) otherwise.
- "N of M devices ticked" still counts all rows.

### 2.3 Kind override (per row and in bulk)

- Each row's Kind dropdown. Choosing a kind runs the existing `retype` with that kind's type word (for example Switch → "Switch", Endpoint → "Generic Device"). The row is classified again: its template, height and destination update. A rack kind still goes off-rack to To place (the API import never places without a layout).
- **Bulk:** a bar above the table, "Set kind for the N ticked rows shown: [kind] Apply". It acts on rows that are both ticked and visible.
- **It counts as a hand edit.** When the import saves, the device's `type` field gets `source: "manual"` and is locked (`markManual`). The next import won't change it without a tick. For a matched device, the change is ticked by default, because the person picked it.

### 2.4 Type dropdown (import page and Device panel)

- One shared list, `DEVICE_TYPES` in a new pure module `src/deviceTypes.ts`: every `type` in the catalog (Switch, Router, Firewall, Server, Storage, Patch panel, UPS, PDU, Wireless, Modem/ISP, Shelf, Cable manager, Blank, KVM), plus "Endpoints" and "Virtual machines", sorted.
- **Import page:** the default is the matched template's type, which is what is saved today. Choosing another type saves that as `Device.type`, with `source: "manual"` and locked. The template stays the same. Rows that don't become a device (VM and endpoint rows, which go into boxes) show their box type as plain text.
- **Device panel** (shared, desktop too): the Type text box becomes a `<select>` with the same list. A type that isn't in the list (older files, the Python app) is shown as an extra first option, so nothing is lost. A load and save never changes the type. `devSet("type", …)` stays the same, so the lock and source rule is unchanged.

### 2.5 Model dropdown, including Virtual Machine

Options on every row:

1. **"<Auvik's text>"**. This is the default when the device isn't virtual. It keeps today's behaviour: Auvik's model, with the auto-matched template.
2. **Catalog models of the row's Type** (in a "Catalog" group). Choosing one sets the template (so Template and U update) and saves that model name as `Device.model`.
3. **"Virtual Machine"** group: "Virtual Machine – Hyper-V", "Virtual Machine – VMware", "Virtual Machine – KVM (Scale HyperCore)". These save that text as the model (a device's `model`, or the member's `model` in a VM box). They don't change the template.

- **Pre-pick for virtual devices.** A device is virtual when its kind is Virtual machine, or Auvik's model says so (`virtual machine`, `virtual platform`, `vmware`, `qemu`, `kvm`, `hyper-v`). For those, the default is the matching Virtual Machine choice:
  - `hyper-v` / `microsoft` → Hyper-V;
  - `vmware` / `esxi` → VMware;
  - `kvm` / `qemu` / `scale` / `hypercore` → KVM.
  - It reads the model, the description (discovery) and the software. When nothing matches, the default stays Auvik's text.
  - A pre-pick is an Auvik value (`source: "auvik"`), not a hand edit.
- The **"Guessed host — check"** flag next to the host dropdown stays exactly as it is.
- Picking a model by hand counts as a hand edit: `model` gets `source: "manual"` and is locked. For a VM box member, the member's `locked` gets `"model"`.

### 2.6 Where the overrides live

- `SiteState` gains:
  - `kinds: Record<key, Kind>`;
  - `types: Record<key, string>`;
  - `models: Record<key, string>` (`""` = Auvik, `tpl:<catalog name>`, or `vm:hyperv|vmware|kvm`);
  - `sort: {col, dir} | null`;
  - `filter: string`.
- `apiItems(devs, org, ctx, over?)` applies them inside the pure planning code, so `planSite` and the table see one result:
  - kinds go through `retype`;
  - the template override is a new optional `PlanItem.tplOver` honoured by `resolvePlan` (catalog name → template);
  - the type override is `PlanItem.typeOver`;
  - the model text override is `PlanItem.modelOver`.
- `applyInPlace` writes `typeOver` / `modelOver` onto new and matched devices (under the usual fld: ticks). `build()` in `sync.ts` then marks every hand-picked field manual.
- The .xlsx screen ignores the new optional fields, so its behaviour and the regression snapshot don't change.
- Overrides are keyed by plan item key, so they survive re-plans (Overwrite, layout, host changes) and unticking.

## Tests

- **`scripts/auvik-api.test.ts`:**
  - sort comparator (natural name, numeric IP, stable);
  - visible-rows select all / none;
  - a kind override moves a device from To place to Inventory and saves `type` as manual and locked;
  - a type override is saved and locked;
  - a catalog model override changes the template and U;
  - VM pre-pick for each of the three vendors, and none for an unknown vendor;
  - a VM model override lands on the VM box member with `locked: ["model"]`;
  - `hostGuessed` is still set;
  - a re-import after an override keeps the manual values.
- **`scripts/device.test.ts`** (or a new small test): `DEVICE_TYPES` has the catalog types, and a custom type is kept as an option.
- The .xlsx regression test must still pass unchanged.
- **Browser check** (mocked fetch, as in 3.19.0, never the live server):
  - the green pulse, and a steady green line under reduced motion;
  - sort, reverse, filter, header checkbox and bulk kind;
  - the Type and Model dropdowns, and VM pre-picks;
  - the recorded save body has the manual sources;
  - the Device panel Type dropdown;
  - dark and light themes.

## Release

3.19.2 (`node scripts/version.mjs 3.19.2`). A CHANGELOG entry in plain sentences that says the desktop app gets the Type dropdown in the Device panel. A changed `tauri.conf.json` version means the Desktop exe workflow runs on push. Stop before push.
