# Auvik cables (3.20.0) — design

Status: approved 2026-11-19. Release: 3.20.0, right after 3.19.2. Web only (the desktop keeps the .xlsx import). Builds on `2026-11-18-auvik-api-import-design.md`; every rule there (key never exposed, fill-empty-only, never move placed devices, made-up test data) still holds.

## Why

Import from Auvik (3.19) brings devices but no cables: the API devices have `neighbors = []`, so switches show no patching and endpoints sit in unattached boxes. Techs want the same cabling the .xlsx "Connected to" column gives, without exporting a spreadsheet.

## Goals

- Read each site's cables from Auvik and turn them into `AuvikDevice.neighbors`, so `buildLinks`, the port mapping, endpoint groups on switches and the cable diff (`cn:` / `mv:` / `gone:`) work unchanged.
- Endpoints in the import's own Endpoints boxes move to their switch when Auvik knows the port, as a ticked change.
- Re-import keeps hand-moved cables and never removes a cable the user added.

## Non-goals

- Desktop, wireless links, VLAN/logical topology, cables that cross rack documents (listed, not drawn).

## Anti-goals

- The Auvik key leaks through the new route.
- A cable failure stops a site's devices from importing.
- An uplink (switch-to-switch, or a port with several endpoints behind it) is mistaken for an endpoint port and an endpoint is moved onto it.
- LAG member ports lose their cables because the LAG interface is dropped.

## Auvik facts (public OpenAPI spec, checked 2026-11-19)

- `GET /v1/inventory/interface/info?tenants=<id>`: `attributes.interfaceName`, `attributes.interfaceType` (ethernet, optical, inferredWired, inferredWireless, wifi, ieee8023AdLag, linkAggregation, vlan, loopback, tunnel, virtualNic, …), `relationships.parentDevice.data.id`, `relationships.connectedTo.data: [{type: "interface", id}]`.
- There is **no topology endpoint** in v1. `GET /v1/inventory/device/detail` (already read in 3.19) has `relationships.connectedDevices.data: [{id, attributes.deviceName}]`: device-to-device, no ports. This is the fallback.

## Approaches

1. **Separate route `GET /api/auvik/tenants/:id/links` (chosen).** The browser calls it right after the inventory of each site. A cable failure leaves devices intact; the inventory response and its fixtures don't change.
2. Fold links into the inventory response. Rejected: one failure kills both, and the 3.19 inventory contract and fixtures change.
3. Device-level links only (`connectedDevices`). Rejected: no ports, so no port mapping or patching.

## Server

`GET /api/auvik/tenants/:id/links` (signed in; 404 when Auvik is not set up; same id check, 3-minute cap, paging, retries, mutex and key rules as inventory). `web/API.md` first.

Response: `{"status": "ok"|"denied"|"empty", "note": str, "links": [{"device": id, "iface": str, "peerDevice": id, "peerIface": str, "portless": bool}], "dropped": n}`

- Reads `/inventory/interface/info?tenants=<id>&page[first]=1000` (all pages) and `/inventory/device/detail?tenants=<id>` for `connectedDevices`.
- **Interface types kept:** ethernet, optical, inferredWired, and the members of a LAG. **Dropped:** wifi, inferredWireless, vlan, loopback, tunnel, cpu, virtual*, distributedVirtualSwitch, other non-physical types, and the aggregate interfaces themselves (`ieee8023AdLag`, `linkAggregation`). A connection that ends on a dropped interface is dropped and counted in `dropped`. **LAG rule:** the LAG's physical member ports are ordinary ethernet/optical interfaces with their own `connectedTo`, so they still produce one link each. If Auvik reports a connection only on the aggregate (members have none), the builder maps it to the members when they can be told apart by name; otherwise it becomes one `portless` link between the two devices, never zero.
- One row per cable: an interface pair is emitted once (sorted by the two interface ids), with both ends' device ids and interface names. A connection to an interface not in this tenant's list is dropped and counted.
- **Fallback:** for each `connectedDevices` pair that has no interface-level link in either direction, one row with `iface`/`peerIface` empty and `portless: true`.
- `denied` (401/403 on interfaces) and `empty` (no interfaces) are 200 with a note, like inventory.

## Front end (web only)

- `api.ts`: `auvikLinks(id, signal)`.
- `ImportAuvikApi.tsx`: after each site's inventory, "Reading cables for site 2 of 5: <name>…". A failed or denied links read keeps the site's devices and adds a note "Cables could not be read for <site>; devices are imported without them." Stop works as today.
- `map.ts`: `linksToNeighbors(devices, links)` fills `neighbors` on both ends: `A.neighbors += {name: B.rawName, iface: peerIface}` and `B.neighbors += {name: A.rawName, iface: iface}`, emitted in one stable order so `buildLinks` pairs the interfaces correctly, including two or more cables between the same pair (LAG members). Links to device ids not in the inventory are counted as unresolved, as today.
- **Port-less links** are labelled "no port data" in the preview (cable change detail and the endpoint's port column), and are not drawn as patched to a port.

### Endpoints in the import's own boxes

- An endpoint that is a member of an Endpoints box the import made (`auvik_epbox`) and that the plan now puts in "Endpoints on <switch>" gets a change `mvbox:<key>` titled "Move to Endpoints on <switch>", **ticked by default**. Applying it removes the member from the box and lets the plan's group add it with its cable.
- **No move** (the member stays in its box, and the box shows its port as "<switch> <port>") when:
  - the switch port it hangs off also connects to a switch, router or firewall (an uplink), or
  - more than one endpoint is behind that same switch port (an unmanaged switch or hub).
- Endpoints anywhere else (a hand-made group, another rack document, an older .xlsx group) are never moved; they keep today's behaviour.
- A box left empty by moves is removed; a box with members keeps its name and summary refreshed.

### Cables

- New, moved and gone cables use the existing diff: a cable whose port was moved by hand (`locked` port) is unticked; `gone:` is never ticked; nothing the user added is removed.
- **Other rack documents in the site:** a cable change is applied there only when both ends are matched in that document. A cable whose ends sit in different documents is listed once as "Not drawn: <A> and <B> are in different racks" and not applied.

## Tests (made-up data only)

**Server (`web/server/tests/auvik.rs`)**, new fixtures in `tests/fixtures/auvik/`: `interface-info-main-p1.json`, `-p2.json` (paged), `device-detail` gains `connectedDevices`, and `expected-links-main.json` (the exact response, also read by the front-end tests). Cases: paging, one row per cable (both directions in Auvik, one row out), dropped wireless/VLAN with the count, a 2-member LAG producing two links, aggregate-only LAG fallback, a portless fallback pair, denied, empty, not configured → 404, and the key-leak search extended to this route.

**Front end (`rackwright-tauri/scripts/auvik-api.test.ts` or a new `auvik-cables.test.ts`):** neighbours from the expected links; two LAG cables between the same pair stay two cables on the right ports; port-less link labelled "no port data"; endpoint in an import box gets a ticked "Move to Endpoints on EX-SW01"; no move behind an uplink port; no move when two endpoints share a port; endpoint in a hand-made group untouched; a re-import keeps a hand-moved cable (unticked `mv:`) and a hand-added cable; a cable across two rack documents listed and not applied.

## Release

3.20.0 (`node scripts/version.mjs 3.20.0`), CHANGELOG entry in plain sentences, `web/API.md`, roadmap line ticked, fixtures README updated. Stop before push.

## Left to the builder

- Exact mapping of aggregate-only LAG links to members (by name) — fall back to one portless link when unclear.
- Where the "Not drawn" lines show in the preview (warnings line is fine).
- Whether `linksToNeighbors` lives in `map.ts` or a new `links.ts`.
