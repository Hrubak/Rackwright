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
- **Client report.** A quarterly-review report for one client, Overview or Detailed, with your own summary and recommendations: a branded PDF, and a Word document built from your uploaded master template. Branding (logo, colours, font, artwork, template) is uploaded by an admin and never committed.

Design: `docs/superpowers/specs/2026-11-16-look-and-feel-design.md`. Releases: 3.5.0 groundwork and logo (done), 3.6.0 top bar (done), 3.7.0 Settings (done), 3.8.0 light theme (done), 3.9.0 client report PDF, 3.10.0 Word report.
