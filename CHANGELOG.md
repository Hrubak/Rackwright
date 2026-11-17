# Changelog

Newest first. Every push to `web` adds an entry here (CI checks it). From 3.0.0 the web server and the desktop app share one version number. Set it with `node scripts/version.mjs x.y.z`; CI fails if they differ. Upstream changes from hast3/Rackwright arrive under `## Unreleased` through the Sync upstream pull request and get a version when that pull request is merged.

## 3.8.0 — 2026-11-17
Web and desktop.
- **Light theme.** Settings › Profile › Theme: Dark (the default), Light, or Match my computer. Match my computer follows your Windows or browser setting and changes with it. The choice applies at once and is kept per person (web) or per computer (desktop).
- **Drawings follow the theme.** In Light the page is white and empty rack space is light grey; racks stay graphite, like real ones. Device faceplates, device colours and your own cable colours look the same in both themes.
- **PDF exports are always light**, whichever theme you use, so they print well and look the same for everyone.
- Your company accent colour works in both themes.

## 3.7.0 — 2026-11-17
Web and desktop. The web server gets new tables and endpoints for settings, so update the LXC as usual.
- **Settings.** Open Settings from your account menu (web) or the gear at the right end of the top bar (desktop). Press Escape or Close to go back.
  - Profile (web): change your name and email (a new email asks for your current password) and your password.
  - Preferences: units (millimetres or inches) and the start screen: a new rack, the last rack you had open, Clients, or the rack list (web). Each person has their own preferences.
  - Company (admins on the web): company name, logo (PNG, SVG, JPG or WebP, up to 2 MB on the web and 1 MB on the desktop) and accent colour. The logo shows in the top bar and on the sign-in page. The accent colour changes buttons and highlights. The Rackwright logo stays blue. Reports will use these in a later version.
  - New racks (admins on the web): a default rack model and height. New rack and Add rack start with them selected.
  - Users and Server update (admins on the web) moved here from their own windows. The account menu opens them directly.
- **Units.** Rack sizes in the properties panel and the rack picker follow your units setting.

## 3.6.0 — 2026-11-17
Web and desktop.
- **New top bar.** The row of buttons is now five menus: File, Edit, View, Clients and Help. Hover across the menu names to move between them. Press Escape or click elsewhere to close a menu.
  - File: New, Open, Save, Save as, Import file (web), Import list, Import Auvik, Export (PDF, Visio, .rack.json on the web).
  - Edit: Undo, Redo, Add rack, Duplicate, Delete.
  - View: the four views, Flip front/rear, Fit to screen, and Cables (the same cable choices as the box at the bottom left).
  - Clients: the Clients screen, and Import Auvik into a client.
  - Help: Keyboard shortcuts, What's new (the latest changes) and About.
- **Always at hand.** The view switcher, Front/Rear, Undo, Redo and Save stay on the bar. In a window narrower than 1280 pixels the four views fold into one dropdown.
- **Where you are.** The bar shows Client › Site › Rack for the open rack. Click the client or site to open it on the Clients screen. A rack in no site shows Unassigned. A dot after the name means there are unsaved changes.
- **Your account menu (web).** Click your initials at the top right for Change password, Users and Update server (admins), and Sign out.
- **Shortcuts.** New shortcuts: Ctrl+O opens, and Ctrl+N starts a new rack on the desktop (browsers keep Ctrl+N for a new window). Menus show each shortcut next to the item.
- **Tidier side panels.** The properties panel is grouped into Device, Placement, Ports and Actions, with labels above each field.

## 3.5.0 — 2026-11-16
Web and desktop. First step of the look-and-feel work (plan: `docs/superpowers/specs/2026-11-16-look-and-feel-design.md`).
- **New logo and app icon.** Rackwright has a logo: three rack units on a blue tile. It is the desktop app icon (exe, taskbar), the browser tab icon, and it heads the sign-in page.
- **About.** Click the logo at the top left to see the version and whether you are in the web or desktop app. Press Escape or Close to go back.
- **Groundwork for themes.** Every colour in the app and in the rack drawings now comes from one theme file. Nothing looks different yet. Light theme and company branding build on this in later releases. PDF export looks the same as before.

## 3.4.0 — 2026-11-16
Web and desktop.
- **Import Auvik into a client.** On the Clients screen, pick a client and click Import Auvik next to Add site. Choose the Auvik device export (.xlsx); the file stays on your computer.
  - Pick the main site, or make a new one. Its name is filled in from the export.
  - Split by network (optional): the export's networks are listed with how many devices are on each. Send a network to another site, or type a new site name. Use this when each office has its own subnets. Devices on networks you leave alone go to the main site.
  - Each site gets one new rack named "<site> (Auvik)", built with the usual default choices. To review the details or update the rack from a newer export later, open the rack and use Import Auvik there, as before.
  - On the desktop, the new rack files are saved next to the client file. An existing file is never overwritten; a number is added to the name instead.

## 3.3.0 — 2026-11-16
Web and desktop.
- **Site-to-site links.** The Clients screen has a third tab, Links. It draws the client's sites and the WAN links between them: VPN, MPLS, fiber, internet, wireless, SD-WAN or other. Each type has its own colour and the label shows the bandwidth. A link can also go from a site to the Internet / provider cloud.
  - Add link, or click a line or a row, to set the two sites, the type, provider, circuit ID, bandwidth and notes. You can also pick the device each end lands on (firewalls and routers are listed first), and its name is shown at that end of the line.
  - Two links between the same sites are drawn side by side, so a primary circuit and a backup VPN are both visible.
  - Deleting a site deletes its links. On the web, moving a site to another client also deletes its links. On the desktop, links are saved in the `.client.json` file.

## 3.2.0 — 2026-11-16
Web and desktop.
- **Inventory and search for a client.** The Clients screen has a new tab, Inventory and search. It lists every device in every rack of the client's sites, with site, rack, name, type, model, IP, MAC, serial and where it sits (rack and U, or off-rack).
  - Type to search. Every word must match somewhere, so `north switch` finds switches at the North site. MAC addresses match with or without colons or dashes.
  - Filter by site, or click a type count (Switch 12, Firewall 2...) to show only that type.
  - Include endpoints adds the PCs, phones, printers and other endpoints from an Auvik import, under the device they were seen on.
  - Click a row to open that rack with the device selected.
  - Export CSV saves what is shown, for a client report or a spreadsheet.

## 3.1.1 — 2026-11-16
- Fixes the web server build in 3.1.0, which failed to compile, so `update` could not install it. Use this version for Clients and sites. The desktop app has no changes beyond the version number.

## 3.1.0 — 2026-11-16
Web and desktop.
- **Clients and sites.** A new Clients button opens a screen for MSP clients. Add a client, then its sites (name, address, notes), then put racks in each site. Each site shows small drawings of its racks with racks, U used, device and cable counts; the client header adds them up. Click a rack to open it.
- **Web:** clients and sites are shared by everyone, like racks. Add saved racks lists the racks that are in no site yet. If the open rack is not saved yet, Save the open rack here saves it straight into that site. The Open list now shows each rack's client and site. Racks you already have show as Unassigned until you add them to a site. Deleting a site keeps its racks; a client can be deleted only when it has no sites.
- **Desktop:** each client is a `.client.json` file that lists its sites and their `.rack.json` files. New client asks where to save it; Open client file adds an existing one to the list. Racks in the client file's folder are stored with relative paths, so the folder can be moved or synced (OneDrive, a share). Add rack files and Add the open rack put racks in a site.
- CI now runs the front-end test files too.
- Coming next: search and totals across a client's sites, site-to-site links, and Auvik import into a client.

## 3.0.0 — 2026-11-16
The web app and the desktop app now have the same version number, starting at 3.0.0. A new desktop exe is built for this release.
- **One version for web and desktop.** Before this, the web server was 2.9.1 and the desktop app was 2.6.0. Both are now 3.0.0 and move together. `node scripts/version.mjs 3.1.0` sets every version file at once, and CI fails if any of them differ.
- **Warning before you lose changes.** With unsaved changes, the web app now asks before the tab is reloaded or closed and before Sign out. The desktop app asks before the window closes. New, Open and Import already asked.
- **Recovery copy.** While a rack has unsaved changes, the app keeps a copy in the browser or app storage, updated about a second after each edit. If the tab, the window or the PC closes before you save, the next start offers to restore it (Restore or Discard). Saving, or opening another rack, removes the copy. The copy stays on that computer and is kept separately for each signed-in user. On the web, if someone else saved the same rack in the meantime, saving a restored copy asks whose version to keep, as before.

## 2.9.1 — 2026-11-16
- **Up-to-date desktop app for Windows.** `Rackwright.exe` in the repository was last built for desktop 2.0 and had none of the newer features. A new GitHub Actions workflow, Desktop exe, now builds it whenever the desktop version changes. It publishes it as a download on the release `desktop-v<version>` and also replaces `Rackwright.exe` in the repository. The first build is desktop 2.6.0, with everything up to web 2.9.0: Auvik import, PDF and Visio export, the Infrastructure, Switch and Endpoints views, editing with locks, HE250/HE150, rear mounting and the KVM models. The web-only parts (sign-in, Users, shared racks, Update server) are not in the desktop app.

## 2.9.0 — 2026-11-16
Desktop app 2.6.0 has the same changes.
- **Rear mounting.** "Mounted" in the properties panel now works for every device, including firewalls and switches with a faceplate. Pick one of:
  - Front, full depth (the default for gear with a faceplate);
  - Front only (short), which leaves the rear of that U free;
  - Rear, full depth: the ports face the rear. The rear view shows the device's front panel, the front view shows its back, and a yellow stripe on its left edge marks it;
  - Rear only (short), which leaves the front of that U free, for example for a patch panel in front of a rear-mounted switch.
- **Three HE150 nodes per shelf.** Scale Computing HE150 now takes a third of a shelf, so three fit side by side on one 1U shelf. HE250 still takes half, two per shelf. HE150 nodes in racks you already saved move to the new size when you open them: the right-hand node moves to the right third. Side in the properties panel offers left, middle and right, and the arrow keys move between them.
- **KVM switches.** New 1U KVM models: Tripp Lite NetDirector 8-port and 16-port Cat5 KVM over IP (B064-008-01-IPG, B064-016-01-IPG), Tripp Lite 16-port HDMI/USB KVM (B024-H4U16), and a generic "KVM switch 1U". Each has PC ports, a local console port and power; the IP models also have a LAN port.

## 2.8.0 — 2026-11-16
Web only. The desktop app does not change.
- **Update the server from the web.** Admins get an Update server button next to Users. Check for updates shows the running version, the newest version on the branch the container was installed from, and what changed. Update now runs the same steps as typing `update` in the container and shows the log while it works. When it finishes, click Reload page.
- **Less downtime when updating.** `update` (from the console or the web) now builds the new version while the old one keeps running, then restarts. If the build fails, the old version keeps running instead of staying stopped.
- Once only: this release adds the button, so run `update` inside the container one more time to get it. After that you can update from the web.

## 2.7.0 — 2026-11-16
Desktop app 2.5.0 has the same changes.
- **Change a device's height.** Select a device in a rack and set Height (U), for example to turn an imported 1U server into a 2U one. The top edge stays where it is when there is room, otherwise the bottom edge. If the new size does not fit, nothing changes and the message says what is in the way. Devices without a fixed faceplate also get a Half width box.
- **Change model.** "Change model..." in the properties panel swaps a device for another catalog model. Name, IP, MAC, serial, notes, the iDRAC/iLO link and endpoints are kept. Cables move to the new model's ports with the same name, then the same type. Cables with no match stay on extra ports you can move. Changing an imported device's type or model locks those fields so the next Auvik import keeps your choice.
- **Scale Computing HyperCore nodes.** New catalog models HE250 (SNUC NUC24OXGv9 / Onyx Pro) and HE150 (SNUC NUC13OXi7 / Onyx), with front and rear faceplates drawn from the real units. HE250 ports: SFP+1, SFP+2, LAN1, LAN2, DC in. HE150 ports: LAN1, DC in. They are 2U, half width, and stand on a shelf: two fit side by side on one 1U shelf. Changing a racked server to one of them adds a shelf under it when needed. Auvik import matches them by HE150/HE250, NUC13OX, NUC24OXG or Onyx in the model or name.
- Shelf gear can now be taller than its shelf (a 2U unit on a 1U shelf), and the importer puts 2U shelf gear on shelves instead of leaving it off-rack. Shelves are drawn behind the gear standing on them, on screen and in Visio export.
- The device list now says a shelf model fits when a shelf in the rack has room for it, instead of always "off-rack".

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
