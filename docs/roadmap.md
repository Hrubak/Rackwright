# Roadmap

Rackwright is used two ways: by an MSP's own staff for internal knowledge and planning, and in front of clients as a presentation of their network and infrastructure. New work should serve both: accurate and fast for technicians, clean enough to show a client.

## Clients and sites (in progress)

- 3.1.0: clients, sites and the racks in each (web database, desktop `.client.json`). Done.
- 3.2.0: client inventory and search across sites, type totals, CSV export. Done.
- 3.3.0: site-to-site links: a diagram of a client's sites joined by WAN links (VPN, MPLS, fiber, internet, wireless), with provider, circuit ID and bandwidth, ending on a firewall or router in a site's rack.
- 3.4.0: Auvik import into a client, split into sites.

## Look and feel (planned after Clients and sites)

- **Logo and icon.** A Rackwright logo and an app icon (desktop exe, browser tab, sign-in page).
- **Settings.** A Settings menu with two parts:
  - User profile: name, email, password, personal preferences (theme, default view, units).
  - System settings (admin, web): company name and logo for client-facing output, defaults for new racks, server update, users.
- **Polished UI.** A clearer top bar and header: group the toolbar into menus (File, Edit, View, Clients, Help), show where you are (Client > Site > Rack), and tidy the side panels.
- **Themes and styles.** Dark and light themes, plus a presentation style for showing to clients (cleaner colours, larger labels, company branding on exports).
