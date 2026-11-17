# RackMap merge — design

Date: 2026-11-17. Source: CheddarBW/RackMap (a colleague's single-file web app, shared with us to fold into Rackwright; copying its code is allowed).

## Why

A colleague built RackMap with features Rackwright lacks, and its client-first layout suits how an MSP works: start from the client, see what needs attention, go into a room, a rack, a device. Rackwright keeps what it already does better (real faceplates, cable routing through ducts, Infrastructure/Switch/Endpoints views, Auvik import, Visio export, client reports, web server with accounts) and gains RackMap's layout and features.

## Goals (this round)

1. **RackMap's layout** around Rackwright's drawings.
2. **Rooms and floor plans.**
3. **Build or reorganise racks from imports**: text, CSV, Visio (.vsdx), SVG, PDF, diagram pictures (PNG/JPG, read on the device).
4. **Needs attention** list (per client and across clients).
5. **Site-visit mode.**
6. **Power budget.**
7. **Duplicate IP warnings.**

Later (on the roadmap, not this round): device change history, end-to-end cable trace through patch panels, label sheets / QR codes, restore an earlier save, multi-select bulk edit, backup reminder, device model library.

## Non-goals and anti-goals

- No Claude-read import (free-form notes, the "read by Claude" diagram mode). Every import runs on the user's machine or server; no customer data leaves the network.
- No name-only sign-in; the web app's accounts stay.
- Do not drop Rackwright features to match RackMap: cable routing, faceplates, the four views, menus, themes, Auvik import, exports and reports all stay.
- Desktop and web must both keep working (AGENTS.md); `.rack.json` stays one format and unknown fields survive.

## Decisions made with the user

| Question | Decision |
|---|---|
| How far to take RackMap's UI | Adopt its layout: Clients dashboard is the home screen; inside a client, tabs Floor plan, Racks, Inventory, Cabling, Links; equipment sidebar on the left; tabbed device panel on the right. Keep Rackwright's menus, cable drawing, faceplates, views and themes. |
| Rooms | Sites hold rooms. Each room has a floor plan and its racks. Existing sites get one room ("Main room") holding all their racks. |
| Claude-read import | Skip. |
| Order | After 3.10.0 (version check). Word report moves after this work. |

## Approaches considered

- **Port RackMap's code into Rackwright's React/TypeScript front end (chosen).** Parsers and pure logic (`parseRackText`, `csvToSpec`, `parseVsdx`, `parseSvg`, `parsePdf`, `diagramToSpec`, the OCR picture pipeline, `resizeRoom`, `alertsFor`, power tracing) move almost as-is into typed modules. Screens are rewritten as React components using Rackwright's theme tokens, so light/dark and exports keep working.
- **Embed RackMap's `index.html` as a second app.** Fast, but two data models, two looks, no shared racks, and no web server storage. Rejected.
- **Rewrite features from scratch using RackMap as a reference only.** Slower, and loses tested parsing work. Rejected.

## Design

### Data

- **Rooms.** `Room { id, site_id, name, w, d, allow_overlap, objects: [{id, type, x, y, w, h, label, rot}], racks: [{rack_key, x, y, rot}] }`. Tiles are 2 ft (600 mm in metric units). Web: new `rooms` table, endpoints under `/api/clients/:id/sites/:sid/rooms` (documented in `web/API.md` first). Desktop: `sites[].rooms` in `.client.json`. Migration: a site with no rooms gets "Main room" holding its racks, placed in a row.
- **New device fields** (in `.rack.json` devices, all optional): `status` (active/spare/offline/planned), `manufacturer`, `hostname`, `asset_tag`, `os`, `role`, `owner`, `purchase_date`, `warranty_exp`, `power_w`, `last_verified`, `services: [{name, port, proto, status, notes}]`, `specs: {}`, plus UPS fields `battery_date`, `rated_w`. Rack: `last_verified`, `circuit`. Desktop Rust model must keep these (unknown fields already survive; add typed fields where Rust reads them).
- **Catalog power.** Catalog entries gain `power_w` (typical) and, for UPS/PDU, `rated_w`; a device's own `power_w` overrides.

### Layout

- **Home = Clients dashboard.** Client cards (contact, racks, devices, cables, rack space used, critical/warning counts, mini rack thumbnails) and a **Needs attention across clients** list below. Settings › Profile › Start screen gains "Clients" (the new default); "Last rack" stays.
- **Inside a client:** header shows Client › Site › Room pickers; tabs **Floor plan**, **Racks**, **Inventory**, **Cabling**, **Links**. The Racks tab is today's rack view (all four views, cables, faceplates), showing the room's racks side by side as RackMap does.
- **Equipment sidebar** (left, collapsible): search, Catalog (grouped by maker, filter chips by type), Generic. Drag onto a rack or click to add.
- **Device panel** (right, replaces the properties panel): status chip and type chip, actions row (Locate in rack, Duplicate, Copy as text, Delete), tabs **Overview** (connected-to chips, power path, location), **Specs**, **Ports**, **Services**, **Notes**. Rackwright's existing fields (Auvik locks, endpoints, OOBM, Change model) move into these tabs.
- Menus File/Edit/View/Clients/Help stay in the top bar; Import / Export collects the new imports.
- Single click picks a device, double-click opens its panel (RackMap behaviour).

### Floor plan

Grid of tiles; size W × D editable (resizing scales contents proportionally; items that no longer fit are reported). Racks show name and used/total U with a front-edge highlight; objects (door, CRAC, panel, cart, desk, generic) are labelled boxes. Drag to move, R while dragging rotates. Allow overlapping switch per room (off by default; identical boxes split into slices). Show inter-rack cabling (data arcs, power dashed). Double-click a rack opens it in the Racks tab. "This room / All rooms" toggle. Export PDF of the plan.

### Imports (build or reorganise racks)

All go through one **preview** screen (what will be added, moved, changed, left alone) before anything changes, then apply into the current room. Matching existing devices by serial, MAC, hostname or name, like the Auvik re-import, so importing again **reorganises** (moves devices to the new U/rack) instead of duplicating. Sources: RackMap text format, CSV (inventory or From/To cable list), Visio `.vsdx`, SVG, PDF (PDF.js), PNG/JPG pictures (Tesseract WebAssembly, ~10 MB, loaded only when used, served with the app on both web and desktop), and a folder of these files.

### Needs attention and duplicate IPs

Rules (from RackMap's `alertsFor`): warranty expired (critical) or within 60 days (warning); UPS battery replacement overdue / due within 60 days (battery date + 3 years by default); UPS load over 80% (warning) or 100% (critical); rack not checked on site in 90+ days or never (info); same IP on two devices of one client (warning). Shown on client cards (counts), the dashboard list, the device panel, an "IP!" tag on rack faces, red cells in Inventory, and a section in the client report.

### Site visit

Rack panel › Site visit walks the rack top to bottom, one device at a time: Matches / fix fields in place / Not in the rack (moves to unracked, status offline) / Skip. Stamps `last_verified` on each device and the rack. Works offline on the desktop; web saves as usual.

### Power budget

Trace each device's power path (device → PDU → UPS → circuit) using Rackwright's existing power cables. Roll up watts per PDU, UPS (% of rated, rough runtime), circuit (amps at 120/208 V), rack and room (and BTU/hr). Show on the rack header ("555 W"), the device panel power path, the floor plan, Needs attention (overloads) and the report.

## Release plan

| Release | Contents |
|---|---|
| 3.10.0 | Version check (already planned). |
| 3.11.0 | New layout: Clients dashboard home, client tabs, equipment sidebar, tabbed device panel, new device fields. |
| 3.12.0 | Rooms and floor plans (data, migration, editor, inter-rack cabling, PDF). |
| 3.13.0 | Needs attention, duplicate IPs, power budget. |
| 3.14.0 | Site-visit mode. |
| 3.15.0 | Imports: text and CSV, preview and reorganise. |
| 3.16.0 | Imports: Visio, SVG, PDF, pictures (OCR), folder. |
| 3.17.0 | Word report (moved from 3.11.0). |

Each release gets its own plan, ships alone, and follows the usual release steps (changelog, shared version, both builds, tests, customer-data scan, "Push it").

## Calls made while writing this up (check these)

1. **One rack document at a time.** A `.rack.json` already holds several racks with cables between them. The Racks tab shows the open document's racks side by side, as today. The room picker lists the room's rack documents, and you switch between them. There's no editing across documents and no cables between documents in this round. Cabling between racks on the floor plan comes from cables inside a document.
2. **What spans racks.** Power roll-up and power paths are worked out inside each document, so a PDU or UPS feeds devices in the same document. Needs attention, duplicate IPs, Inventory and Cabling read every document of the client, like Inventory does today. They only read, and don't add a client-level cable store.
3. **Rooms reference racks by the key sites already use** (the web rack id, or the desktop path relative to `.client.json`). A rack is in exactly one room of its site. "All rooms" means the rooms of the current site. Older versions ignore the `rooms` field. A rack listed in the site but not in any room shows in the first room, so moving a file or opening it in an old version never hides a rack.
4. **Reorganise on import.** The preview has a checkbox on every row: add, move (another U or rack in the same client), change fields, or no change. Existing devices missing from the import are listed as "Not in this import" and left alone. A row that matches two devices, or a device in another client, is unchecked and flagged so you decide.
5. **OCR and PDF reader.** The web build serves them from the server. The desktop downloads them the first time you import a picture or PDF, from a pinned jsDelivr version, and caches them, so `Rackwright.exe` doesn't grow by about 10 MB. Only the reader is downloaded. Your files never leave the machine.
6. **Power data.** PDUs and UPSes are recognised by catalog type and by device type. A device with no wattage from its catalog entry or set by hand counts as unknown. Totals then show "at least N W, K devices unknown". Voltage is set per circuit on the rack (120 V by default, 208 V optional).
7. **Same behaviour on web and desktop.** That includes single-click to pick, double-click to open, and the Clients start screen. Double-click doesn't do anything in the rack view today.
8. **3.10.0 version check comes first.** It's built and shipped before 3.11.0.

## Left to the builder

Exact component split, styling within the theme tokens, test fixtures (use "Example IT" / "Example Client" names; RackMap's sample clients may be reused only if they contain no real names), and how much of RackMap's code is ported verbatim versus rewritten, as long as behaviour matches.
