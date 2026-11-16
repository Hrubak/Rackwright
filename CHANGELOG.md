# Changelog

Newest first. Every push to `web` adds an entry here (CI checks it). The web version number lives in one place: `version` in `web/server/Cargo.toml`. Upstream changes from hast3/Rackwright arrive under `## Unreleased` through the Sync upstream pull request and get a version when that pull request is merged.

## 2.6.0 — 2026-11-16
Desktop app 2.4.0 has the same changes.
- **Edit devices.** The properties panel adds a MAC field. A Ports list lets you rename ports, change their type, add ports and delete them. Deleting a port that has a cable asks first and removes the cable.
- **Your edits are kept.** When you change a field on an imported device or endpoint, it gets a lock icon. The next Auvik import leaves it alone. Click the lock to let Auvik update it again.
- **Edit endpoints and VMs.** Select an "Endpoints on ..." or "VMs on ..." box to edit each member (name, kind, type, model, IP, MAC, switch port). You can also:
  - add a member by hand, on a free switch port you pick;
  - remove a member, which removes its port and cable;
  - move a member to another switch's box;
  - change a VM box's host.
- In the Endpoints view, click a row to open that member. "Place on switch..." puts an unplaced device on a switch port you choose.
- **Re-import shows what changed.** Import Auvik into a rack that already has Auvik devices to get a Changes list:
  - new devices, changed fields (IP, model, name), new cables and cables that moved to another port or switch, all ticked;
  - fields you edited by hand, shown as kept and unticked;
  - cables Auvik no longer sees, and devices or endpoints missing from the export, unticked (nothing is removed unless you tick it).
  Import does exactly what is ticked, as one undo step. A moved cable keeps its color and type. Cables you drew by hand and endpoints you added by hand are never touched.
- **iDRAC / iLO on the back of the server.** Out-of-band management cards no longer come in as separate boxes. Each becomes an iDRAC, iLO or BMC port on the rear of its server, cabled to its switch port. The importer guesses the server from the name ("Server1-iDRAC" goes to "Server1") or serial. You can change it in the review's Host column. If the server is not in the export, "New server" adds a 2U placeholder server with that name, which you can replace later.
- **Cable display** (bottom left of the rack view, remembered per browser):
  - Show: all cables, only the selected device's cables, or none. With none, a dot marks each connected port.
  - Style: routed (as before) or stubs. Stubs are a short line at each port labeled with the far end, such as "→ SW-02 :34".
  - Hide endpoint cables: show only the infrastructure links.
  PDF and Visio exports still draw every cable.

## 2.5.0 — 2026-11-16
Desktop app 2.3.0 has the same changes.
- **Cables follow a device while you drag it.** Network and power cables re-route as you move a device between U slots, racks or around the off-rack area. They settle when you let go. Press Escape to cancel the move.
- **Views.** The toolbar has Rack, Infrastructure, Switch and Endpoints. Click a device in any view to select it. Click "Show in rack" to go back to it in the rack.
  - **Infrastructure:** a diagram of the network gear, laid out top to bottom: firewalls, core switches or stack, access switches, then servers, hypervisors, access points and the UPS. Each line is the cables between two devices; hover it for the ports. Endpoint and VM boxes hang under their switch or host. You can turn power cables on and off.
  - **Switch:** pick a switch or stack unit to see its ports in front-panel order. Each port is colored by what is plugged in (network device, PC, phone, IoT, printer, VM, empty). The table below lists port, device, type, IP and MAC.
  - **Endpoints:** every endpoint in one table (PCs, phones, IoT, printers, VMs and unplaced devices) with switch and port. Filter by kind, search, sort, or copy as CSV.
- **Import Auvik, more choices.** "Include as" adds Phone, IoT and Virtual machine. IP phones and phone systems (Grandstream, Mitel, Yealink, Polycom and others) default to Phone. Cameras and small boards (Dahua, Raspberry Pi, ESPHome and others) default to IoT. You can change the Type of any row in the review, and the row is sorted again.
- **VM boxes.** Virtual machines go in an off-rack "VMs on <host>" box, with a dashed line to the host. Auvik does not say which host a VM runs on, so the importer guesses from the vendor (Scale Computing, Hyper-V, VMware). Change the guess with the Host column in the review. VMs with no host go in "VMs (no host)".
- **Firewall mount kit.** Desktop-size firewalls such as the SonicWall TZ now go in a 1U rack-mount kit with the ports brought to the front, and cables plug in at the front. Pick Shelf in the review's Mount column to keep the old shelf instead. Both kits are in the device list to add by hand.
- Fixed: a device with two links to the same switch (a dual-homed server, or a firewall with several links to a stack) got only one cable on import. All links now come in, each on its own port.
- The device Type can be edited in the properties panel.

## 2.4.0 — 2026-11-16
Desktop app 2.2.0 has the same changes.
- **Import Auvik.** Build a rack from an Auvik device export (`.xlsx`). A review screen lists every device. You choose how each one comes in: in the rack, off-rack, as an endpoint, or skipped. You also pick a new layout (and its rack model) or the rack you have open. Import adds the devices and the cables Auvik saw between them, on the switch ports it reported.
- What goes where by default: firewalls, switches, servers, hypervisors, storage and UPSs go in the rack, with the UPS at the bottom. Access points and iDRAC/iLO cards go off-rack. Known models (Ruckus ICX, SonicWall TZ, APC Smart-UPS and more) use their real faceplates; others get a generic one of the right size.
- A switch stack becomes one switch per stack unit, kept together. A port such as `GigabitEthernet3/1/22` lands on unit 3, port 22. Devices listed twice by Auvik are merged.
- Desktops, phones, printers and other LAN devices are not drawn one by one. Each switch gets an "Endpoints on ..." box next to the rack, with a port per device on the switch port it uses. Select it to see the list. Devices Auvik could not tie to a switch port are in the Unplaced endpoints list in the side panel. Virtual appliances (such as a virtual wireless controller) are listed but not drawn.
- The importer adds a 1U cable manager below each switch and firewall, and below every second server, while the rack has room. The routed cables then have something to hang on.
- **Import again to update.** Devices are matched by serial number, MAC address or name. Matched devices keep their place and get new IPs, models and notes; new devices are added. The review screen lists devices that are missing from the newer export. They stay in the rack; nothing is deleted.
- Cables to off-rack items no longer warn "nothing to support it". An off-rack item cannot have a cable manager.
- The export is read in your browser or the desktop app. Nothing is uploaded until you save the rack.

## 2.3.0 — 2026-11-16
Desktop app 2.1.0 has the same changes; they are in the shared front end.
- **New rack picker.** New and + Rack open a list of real racks: 4-post cabinets (APC NetShelter SX, Eaton RA, Tripp Lite SmartRack), 4-post open frames, 2-post relay racks, wall-mount cabinets and small desktop racks, each with its U height and footprint. Search, filter by kind, or pick a generic rack of any height from 4U to 52U. New used to leave an empty canvas; it now starts with the rack you pick, and Cancel keeps what you had. Sizes marked "approximate" could not be fully confirmed from spec sheets.
- Each kind is drawn its own way (cabinet side panels, open-frame posts, 2-post feet, wall bracket, desktop handles), and the rack header shows the model. Select a rack to change its model or height. A rack that would cut off devices is refused with a message. Racks saved before this keep their look.
- **Export PDF:** front view, rear view, cable schedule and device list, on Letter landscape pages, with text and lines kept sharp.
- **Export Visio (.vsdx):** a real Visio file with Front, Rear and Logical pages, where every rack, device and cable is its own shape. It has been checked for a valid file structure but not yet opened in Visio. Tell us if Visio complains.
- Export is now a menu (Export PDF, Export Visio, and Export file on the web).
- **Cleaner cables:** thinner lines with rounded bends, no heavy black outline, and small realistic plugs (RJ45, LC duplex, DAC, IEC power, console). Cables that run side by side in a duct or tray are drawn as one harness with Velcro ties.
- **Cable color: own / by type** (bottom left). By type colors copper, fiber, DAC, power and console cables consistently, and a legend counts each type.
- Hover over or select a device or cable to bring its cables forward and fade the rest. Hovering a cable shows its label, ends, type and length.
- The toolbar wraps on narrow windows instead of the sign-in controls covering the buttons.
- For developers: CI also checks that the desktop app compiles. `RW_API=http://host:8080 npm run dev:web` points the dev server at another Rackwright server.

## 2.2.1 — 2026-11-16
- `update` failed at "Building the server" with "cannot update the lock file ... because --locked was passed", and left the service stopped. The first install had written its own `Cargo.lock`, which went out of date when the version changed. The build now uses `--locked` only for a `Cargo.lock` that comes from the repository. If an update already failed this way, run `rm /opt/rackwright/web/server/Cargo.lock && update`.
- `web/server/Cargo.lock` (generated by the CI build) is in the repository, so every container builds the same dependency versions that CI tested. CI builds and tests with `--locked`.

## 2.2.0 — 2026-11-16
- `Homelab.rack.json` is a synthetic example rack, kept in git as the only exception to the `*.rack.json` ignore rule (two racks, 21 devices, 25 network and power cables, front and rear, two off-rack access points). The desktop router's unit tests read it, so they run again in CI through the server's `cargo test`. Open it in either app to try things out.
- Known router issue, found while making the example: two cables that leave the same port column for the same cable manager sit 3 px apart, and the router's own test wants at least 4.5 px. The example avoids it. Denser real racks can show cables drawn on top of each other there.
- `update` in the LXC follows the repository and branch the container was installed from, so the same scripts work for this fork and for hast3/Rackwright. `var_repo=... var_branch=... update` points a container somewhere else. Update and install print the version. A new install fetches its install script from the same repository it clones (the host script had it fixed to Hrubak/Rackwright).
- AGENTS.md describes the project for anyone working on it, with the fork-and-upstream rules in their own section. CI runs on `master` as well as `web`. Sync upstream does nothing in hast3/Rackwright itself.

## 2.1.0 — 2026-11-16
- CHANGELOG.md covers the whole history, including the desktop app before the web version. CI fails a push or pull request to `web` that does not add an entry, or whose top version does not match `web/server/Cargo.toml`.
- AGENTS.md tells people and coding agents how the branches work, how to run, test and release, and how to pull upstream changes. CLAUDE.md points to it.
- Sync upstream runs every day and on demand. It moves `desktop` and `master` forward to hast3/Rackwright `master`, then opens a pull request that merges the new upstream commits into `web`, with the changelog entry already written and CI started. If the merge conflicts, it opens an issue that lists the files.
- CI uses the current checkout and Node setup actions.
- `web` is now the fork's default branch, so the scheduled Sync upstream can run (GitHub runs schedules only from the default branch).

## 2.0.0 — 2026-11-16
First web version. Same rack editor as the desktop app, in the browser, installed in a Proxmox LXC.
- The browser shows the desktop app's React screens. The same source builds the desktop app (`npm run build`) and the web app (`npm run build:web`), and the desktop app works as before.
- A Rust server (`web/server`) serves the page and routes cables with the desktop app's own router, so cable routes match the desktop app.
- Sign-in with email and password. The first person to open the site creates the admin account. An admin adds people on Users with a starting password, renames them, makes them admin, resets passwords and removes accounts. There is no email delivery.
- Racks are shared: everyone who signs in sees and edits all of them. Open lists racks with who changed them and when. Save keeps the rack, Save as makes a copy. If someone else saved the rack first, you choose to reload theirs or overwrite with yours.
- Import file and Export file move `.rack.json` files between the desktop and web apps.
- Proxmox LXC installer in the same shape as CW Compare: run one line on the Proxmox host to create a Debian 13 container (2 CPU, 2 GB RAM, 8 GB disk, port 8080). Type `update` in the container console to pull `web` and rebuild. Data stays in `/var/lib/rackwright`.
- CI builds and tests the server, builds both front ends, and checks the install scripts.
- The server did not build the desktop router's own unit tests at first, because they read a sample file (`Homelab.rack.json`) that was not in the repository (added in 2.2.0).

## Desktop history (hast3/Rackwright, before the web version)

### Desktop 2.0 — 2026-11-11 to 2026-11-12 (Tauri: Rust + React)
- Release exe embeds the front end, so it no longer needs the dev server. (b79f668)
- Workability pass: drag devices from the palette with a ghost, placement checks, access point discs, properties panel, keyboard shortcuts. (6610af6)
- Faceplate and port art ported from 1.0, UI polish, release exe launcher. (921cce2)
- Rack-list import matches words correctly (regex word boundaries). (75728e2)
- Editing: add a rack or device from the catalog, drag between U slots, click port to port to cable, delete, undo and redo; device catalog; rack-list import. (13665a8)
- Rackwright 2.0 starts as a Tauri app: Rust core with an orthogonal cable router that keeps cables from overlapping, React/TypeScript rack view. (3a3c312)

### Desktop 1.0 — 2026-11-09 to 2026-11-10 (Python, tkinter)
- Power: inlets on all active devices, UPS and PDU inputs, corrected UPS outlet counts, outlet-to-inlet check, Power report tab. (810af12)
- Port art: RJ45 sockets with contacts and link LEDs, SFP cages, LC duplex, IEC power, console ports. (1eaca6b)
- Cabling rewritten with tracks, side ducts and an overhead tray; rack-mount organizers; power cord defaults; multi-select; dark theme. (bf06065)
- More equipment with front and rear faceplates: APC and Eaton UPS and battery packs, PDUs, Cisco, Meraki, Ruckus, SonicWall, Fortinet, Aruba, Juniper, Palo Alto. (e6ab0e9)
- Cables between vertically adjacent containers run directly. (d514926)
- Cables in the same rack take the shortest path, with no side detour. (00d8e62)
- Rack view draws cable plugs straight on, with the boot seen end-on at the port. (a20e366)
- Ethernet-style cables with RJ45 plugs on both ends; UniFi Dream Router and access point objects. (d5ff679)
- Real equipment faceplates with front and rear views: Dell PowerEdge, UniFi, Synology. (55212d5)
- Rackwright 1.0.0: rack and logical views, cables, custom devices, text import, front and rear mounting. (9145feb)
