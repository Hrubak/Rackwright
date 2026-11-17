# Roadmap

Rackwright is used two ways: by an MSP's own staff for internal knowledge and planning, and in front of clients as a presentation of their network and infrastructure. New work should serve both: accurate and fast for technicians, clean enough to show a client.

## Clients and sites (in progress)

- 3.1.0: clients, sites and the racks in each (web database, desktop `.client.json`). Done.
- 3.2.0: client inventory and search across sites, type totals, CSV export. Done.
- 3.3.0: site-to-site links diagram with provider, circuit ID, bandwidth and end devices. Done.
- 3.4.0: Auvik import into a client, with an optional split into sites by network. Done.

## Look and feel (planned after Clients and sites)

- **Logo and icon.** A Rackwright logo and an app icon (desktop exe, browser tab, sign-in page).
- **Settings.** A Settings menu with two parts:
  - User profile: name, email, password, personal preferences (theme, default view, units).
  - System settings (admin, web): company name and logo for client-facing output, defaults for new racks, server update, users.
- **Polished UI.** A clearer top bar and header: group the toolbar into menus (File, Edit, View, Clients, Help), show where you are (Client > Site > Rack), and tidy the side panels.
- **Themes and styles.** Dark, light and "match my computer" themes. Clients see Rackwright through exports, not the live app, so there is no in-app presentation mode.
- **Version check.** Desktop: on start and once a day, check the public GitHub release `desktop-v<version>`; a banner offers Download (opens the release page) and Skip this version. Web: admins get a banner when the server's branch has a newer version, with Update now (the existing Update server); everyone gets "Rackwright was updated — Reload" when the server is newer than the open page.
- **Client report.** A quarterly-review report for one client, Overview or Detailed, with your own summary and recommendations: a branded PDF, and a Word document built from your uploaded master template. Branding (logo, colours, font, artwork, template) is uploaded by an admin and never committed.

Design: `docs/superpowers/specs/2026-11-16-look-and-feel-design.md`. Releases: 3.5.0 groundwork and logo (done), 3.6.0 top bar (done), 3.7.0 Settings (done), 3.8.0 light theme (done), 3.9.0 client report PDF (done), 3.10.0 version check, then the RackMap merge below, then the Word report (3.17.0).

## RackMap merge (planned after the version check)

A colleague shared RackMap (CheddarBW/RackMap) to fold into Rackwright. Rackwright takes its client-first layout and features and keeps its own drawings, views, imports, exports and accounts.

- **New layout.** The Clients dashboard is the home screen, with a Needs attention list. Inside a client: Floor plan, Racks, Inventory, Cabling and Links tabs, an equipment sidebar, and a tabbed device panel (Overview, Specs, Ports, Services, Notes).
- **Rooms and floor plans.** Sites hold rooms; each room has a floor plan with its racks and objects (doors, cooling, panels), rotation, overlap control and lines for cabling between racks.
- **Needs attention, duplicate IPs and power budget.** Warranty, UPS battery and load alerts, racks not checked in 90 days, IPs used twice, and power rolled up per PDU, UPS, circuit, rack and room.
- **Site-visit mode.** Walk a rack top to bottom on site and confirm or correct each device.
- **Build or reorganise racks from imports.** Text, CSV, Visio, SVG, PDF and diagram pictures (read on your own machine), always with a preview; importing again moves devices instead of duplicating them.
- **Later:** device change history, cable trace through patch panels, label sheets and QR codes, restore an earlier save, multi-select bulk edit.

Design: `docs/superpowers/specs/2026-11-17-rackmap-merge-design.md`. Releases: 3.11.0 layout, 3.12.0 rooms and floor plans, 3.13.0 needs attention, duplicate IPs and power, 3.14.0 site visit, 3.15.0 text and CSV import, 3.16.0 diagram and picture import, 3.17.0 Word report.
