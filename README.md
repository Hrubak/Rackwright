# Rackwright

> **Branches.** `desktop` holds the desktop apps (the Tauri app and the tkinter app). `web` is everything on `desktop` plus the browser version, described under "Web version (Proxmox LXC)" below.

Standalone desktop app (Python 3.11+, tkinter only, no installs) for designing network racks.
Separate from CompAIre.

Run: double-click `Start Rackwright.bat` (or `python rackwright.py [file.rack.json]`).

- Rack view: any rack height, drag devices between U slots/racks (green/red ghost), half-width devices, off-rack devices.
- Front/rear: each device is mounted front, rear or both; "Flip front/rear" shows the back of the racks.
- Cables: click port to port; colour, length + unit, type, label, dashed style. Cable schedule + shopping list, CSV export.
- Cable styles in the Rack view: routed (through ducts and the overhead tray), stubs, or loose (patch cables hanging straight from port to port).
- Logical view: same cables as device-to-device links with a "Logical connection" note (VLAN/purpose).
- Custom devices: any size, type, colour, ports (bulk add); save as reusable templates.
- File > Import rack list: paste `Rack1 / - Panel A - (2U) / - Open - (12U)` style lists and get a laid-out rack
  (names are mapped to device types; Open/Empty/Free leave gaps; add `rear` to a line for rear mount).
- Undo/redo, SVG export, device list CSV. Saves `.rack.json`.

## Real equipment (front and rear faceplates)
The library has Dell PowerEdge (R230-R760, 1U/2U with the right drive bays), Ubiquiti UniFi 24/48-port switches,
and Synology 4-bay NAS (DS desktop and RS rack). Use "Flip front/rear" to see the back (PSUs, fans, slots).
Imported lists match these by name (e.g. "Dell R650", "UniFi USW Pro 24", "Synology DS923+").

Also included (generic branded faceplates, front and rear): APC Smart-UPS SMT/SMC/SMX/SRT and their battery packs, APC/Eaton PDUs, Eaton 5PX/9PX,
Cisco Catalyst/ASA/Firepower/ISR, Meraki MS/MX/MR, Ruckus ICX, SonicWall TZ/NSa/NSsp, Fortinet, Aruba, Juniper and Palo Alto.
Imports match by model (e.g. "SonicWall NSa 2700", "Catalyst 9300-48P", "ICX7150-48P", "SRT3000RMXLI", "SRT96RMBP").

## Recent changes
- Cabling rewritten: thin cables with small plugs, routed along device edges, down rack-side cable managers and across an overhead tray in parallel lanes with rounded corners and Velcro ties. Power cords are dark.
- Rack-side finger ducts (per rack: both / left / right / none) and rack-mount organizers (Cable manager 1U/2U, Brush panel, D-ring manager).
- Power chains: connect UPS outlet → PDU input → device (power-to-power cables default to a black power cord).
- Multi-select: Shift/Ctrl-click or drag a marquee, then drag to move the group.
- Modern dark UI theme.

## VM migration plan
The **Migration** tab on a client plans moving one site's virtual machines from VMware ESXi and Hyper-V hosts onto a Scale Computing HyperCore cluster and shows whether they fit. It works the same on the web and the desktop.

1. Pick the site and press **Start a plan**.
2. Type the target cluster: name, number of nodes, and cores, RAM (GB) and raw storage (TB) per node.
3. Type each VM's vCPU, RAM, provisioned disk and used disk. The VM list comes from the site's racks ("Virtual machines" boxes and Auvik-imported VMs).

The result is Fits, Tight, Doesn't fit or Incomplete (a VM still has no size). By default CPU and RAM are counted with one node down (N+1), storage counts HyperCore's two copies, and 20% is kept free. vCPU per core, the RAM reserve per node and Keep free are settings on the plan. The plan is saved with the site and goes into the client report as "VM migration to <cluster>", with the rules it used printed under the capacity table. Keep free 20% matches Scale's Major capacity alert (80% used); the 8 GB RAM reserve per node is our estimate, since Scale publishes no fixed figure.

## Client report in Word
Besides the PDF, the Client report dialog has **Export Word**. It builds the same Overview or Detailed report into your own Word master template, so the cover, headers, footers, fonts and colours stay as your designer made them.

**Upload the template** in Settings › Company, under Reports (the Word master template row). On the web only an admin can upload it and everyone shares it; on the desktop it is kept on this PC. It must be a Word document (.docx), not a template file (.dotx): in Word use Save As and pick "Word Document". A file that is not a Word document is refused with a message when you upload it. With no template, the report uses plain Word styles.

**Markers.** Type these anywhere in the template (body, tables, text boxes, cover, headers and footers):

| Marker | Becomes |
|---|---|
| `{{CLIENT}}` | The client company's name as saved in Clients |
| `{{PREPARED_FOR}}` | The "Prepared for" field in the dialog (the client name if left blank) |
| `{{SITE}}` | The names of the chosen sites, joined with ", " |
| `{{DATE}}` | The report date, written out ("November 18, 2026") |
| `{{REPORT_TITLE}}` | "Network review — <client name>", the same title as the PDF |
| `{{PREPARED_BY}}` | Your company name from Settings › Company (empty if none) |
| `{{SUMMARY}}` | The executive summary text |
| `{{RECOMMENDATIONS}}` | The recommendations text |
| `{{RACKWRIGHT}}` | The generated report body |

Rules:
- Put `{{RACKWRIGHT}}` on a line of its own. If the template does not have it, the report is added at the end of the document.
- If `{{SUMMARY}}` or `{{RECOMMENDATIONS}}` appear in the template, the report body leaves those sections out, so they are not printed twice.
- A marker that is unknown (anything else in double braces) or has nothing to put in is removed.
- Markers still work when Word has split them into pieces while you typed.
- Markers in Word's cover-page fields (Title, Company, Date) work too.

## Desktop app (Windows)
`Rackwright.exe` is the Tauri desktop app with the same screens as the web version (no sign-in; racks are saved as `.rack.json` files). Download the newest one from the repository's Releases page (`desktop-v...`) or use `Rackwright.exe` in this folder. It needs the Microsoft Edge WebView2 runtime, which Windows 10 and 11 already have. GitHub Actions rebuilds both whenever the desktop version changes.

## Web version (Proxmox LXC)

On the **Proxmox host** shell (not inside a VM). The repo is public, so no token is needed.

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Hrubak/Rackwright/web/proxmox/ct/rackwright.sh)"
```

Default LXC: Debian 13, 2 CPU, 2 GB RAM, 8 GB disk, unprivileged, DHCP on `vmbr0`, port 8080. Choose **No** on the first prompt for Advanced (CTID, VLAN, storage, and the rest). The container builds Rackwright itself, so the first install takes several minutes.

When it finishes it prints `http://<ct-ip>:8080`. The first person to open that address creates the admin account. An admin adds other people on the Users page with a starting password and tells them. There is no email. Racks are shared by all signed-in users.

**Update later** - open the LXC console and type:

```bash
update
```

That pulls the `web` branch, rebuilds, and restarts `rackwright.service`. Data stays in `/var/lib/rackwright` (SQLite file `rackwright.db`) and an update never touches it.

Keep it on the LAN (or Tailscale). Do not publish this URL.

### Connect Auvik (web)

To import devices from Auvik, tell the server how to sign in to Auvik. Do this once, in the LXC console:

```bash
nano /etc/rackwright/auvik.env
```

The file has three `AUVIK_` lines that start with `#`. Remove the `#` from those three lines and fill them in:

```
AUVIK_USERNAME=your-auvik-user@example.com
AUVIK_REGION=us1
AUVIK_API_KEY=your-api-key
```

Save (Ctrl+O, Enter, Ctrl+X), then restart the server:

```bash
systemctl restart rackwright
```

Open a client in the web app, choose **Import from Auvik**, and press **Test connection**. If it says the connection works, you can import.

The key stays on the server. The app never shows it, and the browser never receives it. Only root can read the file. Installing or updating creates the file if it is missing and never overwrites one you have filled in.

### Run on this PC

Needs Rust and Node. From this folder:

```
cd rackwright-tauri
npm ci
npm run build:web
cd ../web/server
cargo run --release
```

Open http://127.0.0.1:8080. Data is stored in `./data`. Set `RW_DATA`, `RW_HOST`, `RW_PORT` and `RW_STATIC` to change that (see `web/API.md`).
