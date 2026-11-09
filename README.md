# Rackwright

Standalone desktop app (Python 3.11+, tkinter only, no installs) for designing network racks.
Separate from CompAIre.

Run: double-click `Start Rackwright.bat` (or `python rackwright.py [file.rack.json]`).

- Rack view: any rack height, drag devices between U slots/racks (green/red ghost), half-width devices, off-rack devices.
- Front/rear: each device is mounted front, rear or both; "Flip front/rear" shows the back of the racks.
- Cables: click port to port; colour, length + unit, type, label, dashed style. Cable schedule + shopping list, CSV export.
- Logical view: same cables as device-to-device links with a "Logical connection" note (VLAN/purpose).
- Custom devices: any size, type, colour, ports (bulk add); save as reusable templates.
- File > Import rack list: paste `Rack1 / - Panel A - (2U) / - Open - (12U)` style lists and get a laid-out rack
  (names are mapped to device types; Open/Empty/Free leave gaps; add `rear` to a line for rear mount).
- Undo/redo, SVG export, device list CSV. Saves `.rack.json`.

## Real equipment (front and rear faceplates)
The library has Dell PowerEdge (R230-R760, 1U/2U with the right drive bays), Ubiquiti UniFi 24/48-port switches,
and Synology 4-bay NAS (DS desktop and RS rack). Use "Flip front/rear" to see the back (PSUs, fans, slots).
Imported lists match these by name (e.g. "Dell R650", "UniFi USW Pro 24", "Synology DS923+").
