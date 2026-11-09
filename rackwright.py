#!/usr/bin/env python3
"""Rackwright - design network racks, devices, cables and logical connections.

Pure Python 3.11+ / tkinter. No extra packages needed.
"""
import copy
import csv
import html
import json
import math
import os
import re
import tkinter as tk
import tkinter.font as tkfont
from tkinter import colorchooser, filedialog, messagebox, ttk

APP = "Rackwright"
VERSION = "1.0.0"
UH = 26          # pixels per rack unit at zoom 1
RW = 480         # usable rack width
RAIL = 24        # rail width (holds U numbers)
HDR = 46         # rack header height
PADB = 10
FONT = "Segoe UI"
GOLD = "#ffd33d"

CABLE_COLORS = [("Blue", "#1f6feb"), ("Red", "#e5372b"), ("Yellow", "#f5d000"), ("Green", "#2ea043"),
                ("Orange", "#f08c00"), ("White", "#f4f4f4"), ("Black", "#111111"), ("Purple", "#8957e5"),
                ("Gray", "#8b949e"), ("Pink", "#f06292"), ("Aqua", "#14b8c4"), ("Brown", "#8b5a2b")]
DEV_COLORS = [("Blue", "#3b6ea8"), ("Teal", "#2f8f8f"), ("Green", "#4f8a3c"), ("Orange", "#c9772b"),
                ("Red", "#b24040"), ("Purple", "#7456a8"), ("Slate", "#4b5563"), ("Black", "#222428"),
                ("Silver", "#9aa3ad"), ("Tan", "#a8925a")]
PORT_TYPES = {"RJ45": "#6aa84f", "SFP": "#e69138", "SFP+": "#f1c232", "QSFP": "#cc4125", "Fiber LC": "#3d85c6",
              "Console": "#8e7cc3", "USB": "#999999", "Power": "#e06666", "Serial": "#76a5af",
              "HDMI/VGA": "#b45f06", "Mgmt": "#c27ba0", "Other": "#cccccc"}
CABLE_TYPES = ["Cat5e", "Cat6", "Cat6a", "Fiber OM3", "Fiber OM4", "Fiber OS2", "DAC", "AOC", "Power",
               "Console", "Coax", "Other"]
DEV_TYPES = ["Switch", "Router", "Firewall", "Server", "Storage", "Patch panel", "UPS", "PDU", "Shelf",
             "Blank", "Cable manager", "Wireless", "Modem/ISP", "Other"]
UNITS = ["ft", "m", "in", "cm"]
SETTINGS = os.path.join(os.path.expanduser("~"), ".rackwright.json")


# ---------------------------------------------------------------- helpers
def lum(h):
    try:
        h = h.lstrip("#")
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255
    except Exception:
        return 0.5


def fg_for(h):
    return "#111111" if lum(h) > 0.6 else "#ffffff"


def shade(h, d):
    try:
        h = h.lstrip("#")
        v = [max(0, min(255, int(h[i:i + 2], 16) + d)) for i in (0, 2, 4)]
        return "#%02x%02x%02x" % tuple(v)
    except Exception:
        return h


def color_name(h):
    try:
        t = h.lstrip("#")
        rgb = [int(t[i:i + 2], 16) for i in (0, 2, 4)]
    except Exception:
        return h
    best = min(CABLE_COLORS, key=lambda c: sum((int(c[1][i:i + 2 + 0][0:2], 16) - rgb[k]) ** 2
                                               for k, i in enumerate((1, 3, 5))))
    return best[0]


_fonts = {}


def font(px, bold=False):
    return (FONT, -max(1, int(round(px))), "bold") if bold else (FONT, -max(1, int(round(px))))


def measure(f, s):
    key = tuple(f)
    if key not in _fonts:
        _fonts[key] = tkfont.Font(font=f)
    return _fonts[key].measure(s)


def fit(s, f, maxw):
    if maxw <= 0:
        return ""
    if measure(f, s) <= maxw:
        return s
    while s and measure(f, s + "…") > maxw:
        s = s[:-1]
    return s + "…" if s else ""


def ports(prefix, n, typ, start=1):
    return [{"name": prefix.replace("{n}", str(start + i)) if "{n}" in prefix else
             (prefix if n == 1 else "%s%d" % (prefix, start + i)),
             "type": typ, "label": ""} for i in range(n)]


def tpl(name, typ, u, color, plist, half=False, rows=0, plate=None, group="", short="", model=""):
    t = {"name": name, "type": typ, "u_size": u, "color": color, "ports": plist, "half": half, "rows": rows,
         "model": model, "ip": ""}
    if plate:
        t["plate"] = plate
        t["group"] = group
        t["short"] = short
    return t


BUILTIN = [
    tpl("Switch 24-port 1U", "Switch", 1, "#3b6ea8", ports("{n}", 24, "RJ45") + ports("SFP{n}", 4, "SFP+")),
    tpl("Switch 48-port 1U", "Switch", 1, "#3b6ea8", ports("{n}", 48, "RJ45") + ports("SFP{n}", 4, "SFP+")),
    tpl("Switch 8-port half-width", "Switch", 1, "#3b6ea8", ports("{n}", 8, "RJ45"), half=True),
    tpl("Router 1U", "Router", 1, "#2f8f8f", ports("Gi0/{n}", 4, "RJ45", 0) + ports("Console", 1, "Console", 0)),
    tpl("Firewall 1U", "Firewall", 1, "#b24040", ports("{n}", 8, "RJ45") + ports("SFP+{n}", 2, "SFP+") +
        ports("Console", 1, "Console", 0)),
    tpl("Server 1U", "Server", 1, "#4b5563", ports("NIC{n}", 4, "RJ45") + ports("iDRAC", 1, "Mgmt", 0) +
        ports("PSU{n}", 2, "Power")),
    tpl("Server 2U", "Server", 2, "#4b5563", ports("NIC{n}", 4, "RJ45") + ports("iDRAC", 1, "Mgmt", 0) +
        ports("PSU{n}", 2, "Power")),
    tpl("NAS 2U", "Storage", 2, "#7456a8", ports("LAN{n}", 2, "RJ45") + ports("PSU{n}", 2, "Power")),
    tpl("Patch panel 24 1U", "Patch panel", 1, "#9aa3ad", ports("{n}", 24, "RJ45")),
    tpl("Patch panel 48 2U", "Patch panel", 2, "#9aa3ad", ports("{n}", 48, "RJ45")),
    tpl("Fiber panel 12 LC 1U", "Patch panel", 1, "#a8925a", ports("{n}", 12, "Fiber LC")),
    tpl("UPS 2U", "UPS", 2, "#222428", ports("Out{n}", 6, "Power")),
    tpl("PDU 1U", "PDU", 1, "#222428", ports("Out{n}", 8, "Power")),
    tpl("Wireless controller 1U", "Wireless", 1, "#2f8f8f", ports("{n}", 4, "RJ45")),
    tpl("Modem / ISP demarc (half)", "Modem/ISP", 1, "#c9772b", ports("WAN", 1, "RJ45", 0) +
        ports("LAN", 1, "RJ45", 0), half=True),
    tpl("Shelf 1U", "Shelf", 1, "#4b5563", []),
    tpl("Cable manager 1U", "Cable manager", 1, "#222428", []),
    tpl("Blank panel 1U", "Blank", 1, "#33363b", []),
]


# ---- real-equipment templates (front + rear faceplates)
# Dell PowerEdge: (model, U, bays, bay rows, drive size)
DELL = [("R230", 1, 4, 1, "3.5"), ("R240", 1, 4, 1, "3.5"), ("R250", 1, 4, 1, "3.5"), ("R340", 1, 4, 1, "3.5"),
        ("R350", 1, 4, 1, "3.5"), ("R420", 1, 4, 1, "3.5"), ("R430", 1, 8, 1, "2.5"), ("R440", 1, 8, 1, "2.5"),
        ("R450", 1, 8, 1, "2.5"), ("R620", 1, 8, 1, "2.5"), ("R630", 1, 8, 1, "2.5"), ("R640", 1, 10, 1, "2.5"),
        ("R650", 1, 10, 1, "2.5"), ("R660", 1, 10, 1, "2.5"), ("R6515", 1, 10, 1, "2.5"),
        ("R6525", 1, 10, 1, "2.5"), ("R720", 2, 8, 2, "3.5"), ("R730", 2, 8, 2, "3.5"),
        ("R730xd", 2, 12, 3, "3.5"), ("R740", 2, 8, 2, "3.5"), ("R740xd", 2, 12, 3, "3.5"),
        ("R740 (24 x 2.5)", 2, 24, 3, "2.5"), ("R540", 2, 8, 2, "3.5"), ("R550", 2, 8, 2, "3.5"),
        ("R750", 2, 12, 3, "3.5"), ("R750 (24 x 2.5)", 2, 24, 3, "2.5"), ("R760", 2, 12, 3, "3.5"),
        ("R760 (24 x 2.5)", 2, 24, 3, "2.5"), ("R7515", 2, 12, 3, "3.5"), ("R7525", 2, 12, 3, "3.5")]
UNIFI = [("USW-24", "UniFi Switch 24", False, 24, 2, "SFP"), ("USW-24-PoE", "UniFi Switch 24 PoE", False, 24, 2, "SFP"),
         ("USW-Pro-24", "UniFi Switch Pro 24", True, 24, 2, "SFP+"),
         ("USW-Pro-24-PoE", "UniFi Switch Pro 24 PoE", True, 24, 2, "SFP+"),
         ("USW-Pro-Max-24", "UniFi Switch Pro Max 24", True, 24, 2, "SFP+"),
         ("USW-Enterprise-24-PoE", "UniFi Switch Enterprise 24 PoE", True, 24, 2, "SFP+"),
         ("USW-Pro-48", "UniFi Switch Pro 48", True, 48, 4, "SFP+"),
         ("USW-Pro-48-PoE", "UniFi Switch Pro 48 PoE", True, 48, 4, "SFP+")]
SYN_DESK = ["DS923+", "DS423+", "DS423", "DS920+", "DS918+", "DS418"]
SYN_RACK = [("RS422+", 1, 4, 1, 1), ("RS822+", 1, 4, 1, 1), ("RS822RP+", 1, 4, 1, 2), ("RS1221+", 2, 8, 2, 1),
            ("RS1221RP+", 2, 8, 2, 2)]


def real_templates():
    out = []
    for m, u, n, rows, size in DELL:
        base = m.split()[0]
        out.append(tpl('Dell PowerEdge %s (%d x %s")' % (base, n, size) if "(" not in m else "Dell PowerEdge " + m,
                       "Server", u, "#2a2c30",
                       ports("NIC{n}", 4, "RJ45") + ports("iDRAC", 1, "Mgmt", 0) + ports("PSU{n}", 2, "Power"),
                       rows=2 if u == 1 else 4,
                       plate={"k": "dell", "bays": n, "brows": rows, "size": size}, group="Dell PowerEdge",
                       short="PE-" + base, model="PowerEdge " + base))
    for model, nm, lcd, n, nsfp, st in UNIFI:
        out.append(tpl("%s (%s)" % (nm, model), "Switch", 1, "#dfe2e6",
                       ports("{n}", n, "RJ45") + ports("SFP%s{n}" % ("+" if st == "SFP+" else ""), nsfp, st), rows=2,
                       plate={"k": "unifi", "lcd": lcd}, group="Ubiquiti UniFi", short=model, model=nm))
    for m in SYN_DESK:
        out.append(tpl("Synology %s (4-bay desktop, 4U half)" % m, "Storage", 4, "#2a2c30",
                       ports("LAN{n}", 2, "RJ45") + ports("Power", 1, "Power", 0), half=True, rows=3,
                       plate={"k": "syn_desk"}, group="Synology", short="NAS-" + m, model="Synology " + m))
    for m, u, n, rows, psu in SYN_RACK:
        out.append(tpl("Synology %s (%d-bay rack, %dU)" % (m, n, u), "Storage", u, "#2a2c30",
                       ports("LAN{n}", 4, "RJ45") + ports("PSU{n}", psu, "Power"), rows=2 if u == 1 else 4,
                       plate={"k": "syn_rack", "bays": n, "brows": rows, "size": "3.5"}, group="Synology",
                       short="NAS-" + m, model="Synology " + m))
    for model, nm, lan, wan in UDR:
        pl = ports("WAN", 1, "RJ45", 0)
        if wan:
            pl += ports("WAN2-SFP+", 1, "SFP+", 0)
        pl += ports("LAN{n}", lan, "RJ45") + ports("Power", 1, "Power", 0)
        out.append(tpl("%s (%s)" % (nm, model), "Router", 2, "#eceef1", pl, half=True, rows=3,
                       plate={"k": "udr", "off": True}, group="Ubiquiti UniFi", short=model, model=nm))
    for model, nm in UAP:
        out.append(tpl("%s (%s)" % (nm, model), "Wireless", 1, "#eceef1", ports("Eth", 1, "RJ45", 0), half=True,
                       rows=1, plate={"k": "uap", "off": True}, group="Ubiquiti UniFi", short=model, model=nm))
    return out


UDR = [("UDR", "UniFi Dream Router", 4, False), ("UDR7", "UniFi Dream Router 7", 3, True)]
UAP = [("U6-Lite", "UniFi Access Point U6 Lite"), ("U6+", "UniFi Access Point U6+"),
       ("U6-Pro", "UniFi Access Point U6 Pro"), ("U6-Enterprise", "UniFi Access Point U6 Enterprise"),
       ("U7-Lite", "UniFi Access Point U7 Lite"), ("U7-Pro", "UniFi Access Point U7 Pro"),
       ("U7-Pro-Max", "UniFi Access Point U7 Pro Max"), ("UAP-AC-Pro", "UniFi Access Point AC Pro"),
       ("nanoHD", "UniFi Access Point nanoHD")]
BUILTIN += real_templates()


def new_doc():
    return {"v": 1, "nid": 1, "racks": [], "devices": [], "cables": []}


def load_settings():
    try:
        with open(SETTINGS, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_settings(s):
    try:
        with open(SETTINGS, "w", encoding="utf-8") as f:
            json.dump(s, f, indent=1)
    except Exception:
        pass


# ---------------------------------------------------------------- dialogs
class Dialog(tk.Toplevel):
    """Generic form. fields: (key,label,kind,default[,extra]); kinds: str int float choice bool text color
    info action sep."""

    def __init__(self, parent, title, fields, ok_text="OK"):
        super().__init__(parent)
        self.title(title)
        self.transient(parent.winfo_toplevel())
        self.resizable(False, False)
        self.result = None
        self.vars = {}
        frm = ttk.Frame(self, padding=12)
        frm.pack()
        r = 0
        first = None
        for f in fields:
            key, label, kind, default = f[:4]
            extra = f[4] if len(f) > 4 else None
            if kind == "sep":
                ttk.Separator(frm).grid(row=r, column=0, columnspan=2, sticky="ew", pady=6)
                r += 1
                continue
            ttk.Label(frm, text=label).grid(row=r, column=0, sticky="ne", padx=(0, 8), pady=3)
            var = None
            if kind in ("str", "int", "float"):
                var = tk.StringVar(value=str(default))
                w = ttk.Entry(frm, textvariable=var, width=38)
            elif kind == "choice":
                var = tk.StringVar(value=default)
                w = ttk.Combobox(frm, textvariable=var, values=extra, width=36)
            elif kind == "bool":
                var = tk.BooleanVar(value=bool(default))
                w = ttk.Checkbutton(frm, variable=var)
            elif kind == "text":
                w = tk.Text(frm, width=38, height=4, wrap="word")
                w.insert("1.0", default)
                var = w
            elif kind == "color":
                var = tk.StringVar(value=default or "#cccccc")
                w = self._color(frm, var, extra or CABLE_COLORS)
            elif kind == "info":
                w = ttk.Label(frm, text=default, wraplength=320, justify="left")
            elif kind == "action":
                w = ttk.Button(frm, text=default, command=lambda cb=extra: cb(self))
            self.vars[key] = (kind, var)
            w.grid(row=r, column=1, sticky="w", pady=3)
            if first is None and kind in ("str", "int", "float"):
                first = w
            r += 1
        btn = ttk.Frame(frm)
        btn.grid(row=r, column=0, columnspan=2, sticky="e", pady=(10, 0))
        ttk.Button(btn, text=ok_text, command=self.ok).pack(side="right", padx=(6, 0))
        ttk.Button(btn, text="Cancel", command=self.destroy).pack(side="right")
        self.bind("<Escape>", lambda e: self.destroy())
        self.update_idletasks()
        p = parent.winfo_toplevel()
        self.geometry("+%d+%d" % (p.winfo_rootx() + 80, p.winfo_rooty() + 60))
        self.grab_set()
        if first:
            first.focus_set()
        parent.wait_window(self)

    def _color(self, frm, var, presets):
        f = ttk.Frame(frm)
        sw = tk.Label(f, width=4, bg=var.get(), relief="sunken")
        sw.pack(side="left", padx=(0, 6))

        def setc(c):
            var.set(c)
            sw.config(bg=c)

        for _, c in presets:
            tk.Button(f, bg=c, width=2, relief="raised", command=lambda c=c: setc(c)).pack(side="left", padx=1)

        def pick():
            r = colorchooser.askcolor(var.get(), parent=self)
            if r and r[1]:
                setc(r[1])
        ttk.Button(f, text="…", width=3, command=pick).pack(side="left", padx=(6, 0))
        return f

    def ok(self):
        out = {}
        for key, (kind, var) in self.vars.items():
            if kind in ("info", "action"):
                continue
            try:
                if kind == "int":
                    out[key] = int(var.get())
                elif kind == "float":
                    s = var.get().strip()
                    out[key] = float(s) if s else 0.0
                elif kind == "text":
                    out[key] = var.get("1.0", "end").strip()
                else:
                    out[key] = var.get()
            except ValueError:
                messagebox.showerror(APP, "Please enter a valid number for: %s" % key, parent=self)
                return
        self.result = out
        self.destroy()


class PortsEditor(tk.Toplevel):
    def __init__(self, parent, plist, newid):
        super().__init__(parent)
        self.title("Edit ports")
        self.transient(parent)
        self.plist = plist
        self.newid = newid
        self.geometry("560x520")
        top = ttk.Frame(self, padding=8)
        top.pack(fill="both", expand=True)
        self.tree = ttk.Treeview(top, columns=("name", "type", "label"), show="headings", height=14,
                                 selectmode="extended")
        for c, w in (("name", 120), ("type", 100), ("label", 260)):
            self.tree.heading(c, text=c.title())
            self.tree.column(c, width=w)
        sb = ttk.Scrollbar(top, command=self.tree.yview)
        self.tree.configure(yscrollcommand=sb.set)
        self.tree.grid(row=0, column=0, sticky="nsew")
        sb.grid(row=0, column=1, sticky="ns")
        top.rowconfigure(0, weight=1)
        top.columnconfigure(0, weight=1)
        self.tree.bind("<<TreeviewSelect>>", self.on_sel)
        ed = ttk.LabelFrame(top, text="Selected port", padding=6)
        ed.grid(row=1, column=0, columnspan=2, sticky="ew", pady=6)
        self.vn, self.vt, self.vl = tk.StringVar(), tk.StringVar(value="RJ45"), tk.StringVar()
        ttk.Entry(ed, textvariable=self.vn, width=14).grid(row=0, column=0)
        ttk.Combobox(ed, textvariable=self.vt, values=list(PORT_TYPES), width=10).grid(row=0, column=1, padx=4)
        ttk.Entry(ed, textvariable=self.vl, width=26).grid(row=0, column=2)
        ttk.Button(ed, text="Update", command=self.update_sel).grid(row=0, column=3, padx=4)
        ttk.Button(ed, text="Add one", command=self.add_one).grid(row=0, column=4)
        ttk.Label(ed, text="name / type / label (VLAN, purpose...)").grid(row=1, column=0, columnspan=5, sticky="w")
        bulk = ttk.LabelFrame(top, text="Bulk add", padding=6)
        bulk.grid(row=2, column=0, columnspan=2, sticky="ew")
        self.bp, self.bc, self.bs, self.bt = tk.StringVar(value="{n}"), tk.StringVar(value="24"), \
            tk.StringVar(value="1"), tk.StringVar(value="RJ45")
        for i, (t, v, w) in enumerate((("Pattern", self.bp, 12), ("Count", self.bc, 5), ("Start", self.bs, 5))):
            ttk.Label(bulk, text=t).grid(row=0, column=i * 2)
            ttk.Entry(bulk, textvariable=v, width=w).grid(row=0, column=i * 2 + 1, padx=3)
        ttk.Combobox(bulk, textvariable=self.bt, values=list(PORT_TYPES), width=10).grid(row=0, column=6, padx=3)
        ttk.Button(bulk, text="Add", command=self.bulk_add).grid(row=0, column=7)
        ttk.Label(bulk, text="Pattern examples: {n}   Gi1/0/{n}   Port {n}").grid(row=1, column=0, columnspan=8,
                                                                                  sticky="w")
        bt = ttk.Frame(top)
        bt.grid(row=3, column=0, columnspan=2, sticky="ew", pady=(8, 0))
        for t, c in (("Delete", self.delete), ("Up", lambda: self.move(-1)), ("Down", lambda: self.move(1)),
                     ("Clear all", self.clear)):
            ttk.Button(bt, text=t, command=c).pack(side="left", padx=2)
        ttk.Button(bt, text="Done", command=self.destroy).pack(side="right")
        self.fill()
        self.grab_set()
        parent.wait_window(self)

    def fill(self, keep=None):
        self.tree.delete(*self.tree.get_children())
        for i, p in enumerate(self.plist):
            self.tree.insert("", "end", iid=str(i), values=(p["name"], p["type"], p.get("label", "")))

    def sel(self):
        return [int(i) for i in self.tree.selection()]

    def on_sel(self, _e=None):
        s = self.sel()
        if len(s) == 1:
            p = self.plist[s[0]]
            self.vn.set(p["name"])
            self.vt.set(p["type"])
            self.vl.set(p.get("label", ""))

    def update_sel(self):
        s = self.sel()
        for i in s:
            p = self.plist[i]
            if len(s) == 1:
                p["name"] = self.vn.get()
                p["label"] = self.vl.get()
            p["type"] = self.vt.get()
        self.fill()
        for i in s:
            self.tree.selection_add(str(i))

    def add_one(self):
        self.plist.append({"id": self.newid(), "name": self.vn.get() or str(len(self.plist) + 1),
                           "type": self.vt.get(), "label": self.vl.get()})
        self.fill()

    def bulk_add(self):
        try:
            n, st = int(self.bc.get()), int(self.bs.get())
        except ValueError:
            return
        for p in ports(self.bp.get() or "{n}", n, self.bt.get(), st):
            p["id"] = self.newid()
            self.plist.append(p)
        self.fill()

    def delete(self):
        for i in sorted(self.sel(), reverse=True):
            del self.plist[i]
        self.fill()

    def move(self, d):
        s = self.sel()
        if len(s) != 1:
            return
        i, j = s[0], s[0] + d
        if 0 <= j < len(self.plist):
            self.plist[i], self.plist[j] = self.plist[j], self.plist[i]
            self.fill()
            self.tree.selection_set(str(j))

    def clear(self):
        if messagebox.askyesno(APP, "Remove all ports from this device?", parent=self):
            self.plist.clear()
            self.fill()


# ---------------------------------------------------------------- views
class ViewBase(ttk.Frame):
    BG = "#ffffff"

    def __init__(self, app):
        super().__init__(app.nb)
        self.app = app
        self.z = 1.0
        self.cv = tk.Canvas(self, bg=self.BG, highlightthickness=0)
        sx = ttk.Scrollbar(self, orient="horizontal", command=self.cv.xview)
        sy = ttk.Scrollbar(self, orient="vertical", command=self.cv.yview)
        self.cv.configure(xscrollcommand=sx.set, yscrollcommand=sy.set)
        self.cv.grid(row=0, column=0, sticky="nsew")
        sy.grid(row=0, column=1, sticky="ns")
        sx.grid(row=1, column=0, sticky="ew")
        self.rowconfigure(0, weight=1)
        self.columnconfigure(0, weight=1)
        cv = self.cv
        cv.bind("<MouseWheel>", lambda e: cv.yview_scroll(-1 if e.delta > 0 else 1, "units"))
        cv.bind("<Shift-MouseWheel>", lambda e: cv.xview_scroll(-1 if e.delta > 0 else 1, "units"))
        cv.bind("<Control-MouseWheel>", lambda e: self.zoom_at(1.15 if e.delta > 0 else 1 / 1.15, e.x, e.y))
        cv.bind("<ButtonPress-2>", lambda e: cv.scan_mark(e.x, e.y))
        cv.bind("<B2-Motion>", lambda e: cv.scan_dragto(e.x, e.y, gain=1))
        cv.configure(yscrollincrement=20, xscrollincrement=20)

    def S(self, v):
        return v * self.z

    def hit(self, x, y, order):
        found = {}
        for it in reversed(self.cv.find_overlapping(x - 2, y - 2, x + 2, y + 2)):
            for t in self.cv.gettags(it):
                k, _, v = t.partition(":")
                if v and k in order and k not in found:
                    try:
                        found[k] = int(v)
                    except ValueError:
                        pass
        for k in order:
            if k in found:
                return k, found[k]
        return None, None

    def refresh(self):
        self.cv.delete("all")
        self.draw()
        bb = self.cv.bbox("all")
        if bb:
            self.cv.configure(scrollregion=(bb[0] - 200, bb[1] - 200, bb[2] + 200, bb[3] + 200))
        else:
            self.cv.configure(scrollregion=(0, 0, 1, 1))

    def zoom_at(self, f, ex, ey):
        wx, wy = self.cv.canvasx(ex) / self.z, self.cv.canvasy(ey) / self.z
        self.z = max(0.2, min(3.0, self.z * f))
        self.refresh()
        self.scroll_world(wx, wy, ex, ey)

    def scroll_world(self, wx, wy, ex, ey):
        x0, y0, x1, y1 = [float(v) for v in str(self.cv.cget("scrollregion")).split()]
        self.cv.xview_moveto((wx * self.z - ex - x0) / max(1, x1 - x0))
        self.cv.yview_moveto((wy * self.z - ey - y0) / max(1, y1 - y0))

    def zoom(self, f):
        self.zoom_at(f, self.cv.winfo_width() / 2, self.cv.winfo_height() / 2)

    def fit(self):
        self.update_idletasks()
        self.z = 1.0
        self.refresh()
        bb = self.cv.bbox("all")
        if not bb:
            return
        w, h = bb[2] - bb[0] + 60, bb[3] - bb[1] + 60
        self.z = max(0.2, min(1.5, self.cv.winfo_width() / w, self.cv.winfo_height() / h))
        self.refresh()
        bb = self.cv.bbox("all")
        self.scroll_world(bb[0] / self.z - 30 / self.z, bb[1] / self.z - 30 / self.z, 0, 0)

    def cable_art(self, sp, color, sel, dash, tg):
        """Ethernet-style cable: dark jacket, coloured sheath, thin highlight (sp = screen coords)."""
        cv, S = self.cv, self.S
        jacket = GOLD if sel else shade(color, -95)
        cv.create_line(*sp, fill=jacket, width=S(7 if sel else 6), smooth=len(sp) > 4, capstyle="round", tags=tg)
        cv.create_line(*sp, fill=color, width=S(4), smooth=len(sp) > 4, dash=dash, capstyle="round", tags=tg)
        if not dash:
            cv.create_line(*sp, fill=shade(color, 70), width=max(1, S(1)), smooth=len(sp) > 4, tags=tg)

    def plug(self, x, y, ux, uy, color, sel, tg):
        """RJ45 plug at world point (x,y); (ux,uy) is the unit vector pointing away from the device."""
        cv, S = self.cv, self.S
        hw = 4.5
        if uy == 0 and getattr(self, "plug_face_on", False):
            # straight-on view: boot seen end-on (rounded block) with the cable coming out of its centre
            out = GOLD if sel else shade(color, -95)
            cv.create_rectangle(S(x - 6), S(y - 6.5), S(x + 6), S(y + 6.5), fill=shade(color, -30), outline=out,
                                width=max(1, S(1)), tags=tg)
            cv.create_rectangle(S(x - 4), S(y - 4.5), S(x + 4), S(y + 4.5), fill=color, outline=shade(color, -60),
                                tags=tg)
            cv.create_oval(S(x - 2), S(y - 2), S(x + 2), S(y + 2), fill=shade(color, 70), outline="", tags=tg)
            return

        def poly(pts, fill, out):
            flat = []
            for a_, n_ in pts:
                flat += [S(x + ux * a_ - uy * n_), S(y + uy * a_ + ux * n_)]
            cv.create_polygon(*flat, fill=fill, outline=out, tags=tg)

        edge = GOLD if sel else "#4a4f56"
        poly([(9, -hw + 0.5), (21, -2.2), (21, 2.2), (9, hw - 0.5)], color, GOLD if sel else shade(color, -95))
        poly([(0, -hw), (9, -hw), (9, hw), (0, hw)], "#dfe3e8", edge)
        for n_ in (-3, -1, 1, 3):
            cv.create_line(S(x + ux * 0.5 - uy * n_), S(y + uy * 0.5 + ux * n_), S(x + ux * 3 - uy * n_),
                           S(y + uy * 3 + ux * n_), fill="#c9961a", tags=tg)
        poly([(4, -2.4), (8, -2.4), (8, 2.4), (4, 2.4)], "#c3c9d0", "#8b9097")

    def export_svg(self, path):
        z = self.z
        self.z = 1.0
        self.refresh()
        cv = self.cv
        bb = cv.bbox("all")
        if not bb:
            self.z = z
            self.refresh()
            return False
        x0, y0 = bb[0] - 20, bb[1] - 20
        w, h = bb[2] - bb[0] + 40, bb[3] - bb[1] + 40
        out = ['<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="%d %d %d %d">' %
               (w, h, x0, y0, w, h), '<rect x="%d" y="%d" width="%d" height="%d" fill="%s"/>' % (x0, y0, w, h, self.BG)]

        def col(v):
            return v if v else "none"
        for it in cv.find_all():
            t = cv.type(it)
            c = cv.coords(it)
            if t == "rectangle":
                out.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" fill="%s" stroke="%s" stroke-width="%s"/>'
                           % (c[0], c[1], c[2] - c[0], c[3] - c[1], col(cv.itemcget(it, "fill")),
                              col(cv.itemcget(it, "outline")), cv.itemcget(it, "width")))
            elif t == "line":
                dash = cv.itemcget(it, "dash")
                da = ' stroke-dasharray="%s"' % str(dash).replace(" ", ",") if dash else ""
                pts = list(zip(c[0::2], c[1::2]))
                if str(cv.itemcget(it, "smooth")) in ("1", "true", "True", "bezier") and len(pts) > 2:
                    d = "M%.1f %.1f " % pts[0]
                    for i in range(1, len(pts) - 1):
                        mx, my = (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2
                        d += "L%.1f %.1f Q%.1f %.1f %.1f %.1f " % ((pts[i - 1][0] + pts[i][0]) / 2 if i == 1 else
                                                                  (pts[i][0] + pts[i - 1][0]) / 2,
                                                                  (pts[i - 1][1] + pts[i][1]) / 2 if i == 1 else
                                                                  (pts[i][1] + pts[i - 1][1]) / 2,
                                                                  pts[i][0], pts[i][1], mx, my)
                    d += "L%.1f %.1f" % pts[-1]
                    out.append('<path d="%s" fill="none" stroke="%s" stroke-width="%s" stroke-linecap="round"%s/>'
                               % (d, cv.itemcget(it, "fill"), cv.itemcget(it, "width"), da))
                else:
                    out.append('<polyline points="%s" fill="none" stroke="%s" stroke-width="%s"%s/>' % (
                        " ".join("%.1f,%.1f" % p for p in pts), cv.itemcget(it, "fill"),
                        cv.itemcget(it, "width"), da))
            elif t == "text":
                f = tkfont.Font(font=cv.itemcget(it, "font")).actual()
                anchor = cv.itemcget(it, "anchor")
                ta = "start" if "w" in anchor else ("end" if "e" in anchor else "middle")
                out.append('<text x="%.1f" y="%.1f" fill="%s" font-family="%s" font-size="%d" font-weight="%s" '
                           'text-anchor="%s" dominant-baseline="central">%s</text>' % (
                               c[0], c[1], cv.itemcget(it, "fill"), f["family"], abs(int(f["size"])),
                               f["weight"], ta, html.escape(cv.itemcget(it, "text"))))
            elif t == "polygon":
                out.append('<polygon points="%s" fill="%s" stroke="%s"/>' % (
                    " ".join("%.1f,%.1f" % p for p in zip(c[0::2], c[1::2])),
                    col(cv.itemcget(it, "fill")), col(cv.itemcget(it, "outline"))))
            elif t == "oval":
                out.append('<ellipse cx="%.1f" cy="%.1f" rx="%.1f" ry="%.1f" fill="%s" stroke="%s"/>' % (
                    (c[0] + c[2]) / 2, (c[1] + c[3]) / 2, (c[2] - c[0]) / 2, (c[3] - c[1]) / 2,
                    col(cv.itemcget(it, "fill")), col(cv.itemcget(it, "outline"))))
        out.append("</svg>")
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(out))
        self.z = z
        self.refresh()
        return True


class RackView(ViewBase):
    BG = "#14161a"

    def __init__(self, app):
        super().__init__(app)
        self.pend = None
        self.mode = None
        self.face = "front"
        cv = self.cv
        cv.bind("<ButtonPress-1>", self.press)
        cv.bind("<B1-Motion>", self.drag)
        cv.bind("<ButtonRelease-1>", self.release)
        cv.bind("<Double-Button-1>", self.dbl)
        cv.bind("<Button-3>", self.ctx)
        cv.bind("<Motion>", self.motion)

    def visible(self, d):
        return not d.get("rack") or d.get("face", "front") in (self.face, "both")

    def draw_ghost(self, d):
        l, t, r, b = self.app.dev_rect(d)
        self.cv.create_rectangle(self.S(l) + 1, self.S(t) + 1, self.S(r) - 1, self.S(b) - 1, fill="#1b1d20",
                                 outline="#555a62", dash=(3, 3))
        if (b - t) * self.z >= 14:
            f = font(9 * self.z)
            self.cv.create_text(self.S(l + 8), self.S((t + b) / 2), anchor="w", fill="#6b717a", font=f,
                                text=fit(d["name"] + "  (%s)" % d.get("face", "front"), f, self.S(r - l - 16)))

    ORDER = ("port", "cable", "dev", "rackhdr", "rack")

    # ---- drawing
    def draw(self):
        a = self.app
        a.build_cache()
        for r in a.doc["racks"]:
            self.draw_rack(r)
        for d in a.doc["devices"]:
            if self.visible(d):
                self.draw_device(d)
            else:
                self.draw_ghost(d)
        self.draw_cables()
        if self.pend is not None and self.pend in a.pcache:
            px, py = a.pcache[self.pend][:2]
            self.rubber = None

    def draw_rack(self, r):
        S, cv, a = self.S, self.cv, self.app
        x0, y0, x1, y1 = a.rack_rect(r)
        sel = a.sel == ("rack", r["id"])
        tg = "rack:%d" % r["id"]
        hd = "rackhdr:%d" % r["id"]
        cv.create_rectangle(S(x0), S(y0 + HDR - 8), S(x1), S(y1), fill=r.get("color", "#3a3d42"),
                            outline=GOLD if sel else "#0b0c0e", width=3 if sel else 2, tags=(tg,))
        cv.create_rectangle(S(x0), S(y0), S(x1), S(y0 + HDR - 8), fill="#24272d",
                            outline=GOLD if sel else "#0b0c0e", width=3 if sel else 2, tags=(hd,))
        cv.create_text(S((x0 + x1) / 2), S(y0 + 15), text=fit(r["name"], font(15 * self.z, True), S(x1 - x0 - 20)),
                       fill="#ffffff", font=font(15 * self.z, True), tags=(hd,))
        cv.create_text(S((x0 + x1) / 2), S(y0 + 31), text="%dU  %s" % (r["u"], "REAR VIEW" if self.face == "rear" else "front") + ("  " + r["notes"] if r.get("notes") else ""),
                       fill="#9aa0a6", font=font(10 * self.z), tags=(hd,))
        H = r["u"]
        for i in range(H):
            y = r["y"] + HDR + i * UH
            cv.create_rectangle(S(x0 + RAIL), S(y), S(x0 + RAIL + RW), S(y + UH),
                                fill="#1b1d20" if i % 2 else "#202327", outline="#2c2f34", tags=(tg,))
            if self.z >= 0.45:
                n = H - i if r.get("numbering", "up") == "up" else i + 1
                for cx in (x0 + RAIL / 2, x1 - RAIL / 2):
                    cv.create_text(S(cx), S(y + UH / 2), text=str(n), fill="#9aa0a6", font=font(10 * self.z),
                                   tags=(tg,))

    def draw_device(self, d):
        S, cv, a = self.S, self.cv, self.app
        l, t, r, b = a.dev_rect(d)
        col = d.get("color") or "#3b6ea8"
        sel = a.sel == ("dev", d["id"])
        cv.create_rectangle(S(l) + 1, S(t) + 1, S(r) - 1, S(b) - 1, fill=col,
                            outline=GOLD if sel else shade(col, -70), width=3 if sel else 1,
                            tags=("dev:%d" % d["id"],))
        w = r - l
        labw = min(150, w * 0.3)
        fg = fg_for(col)
        tg = ("dev:%d" % d["id"],)
        pg = a.port_geom(d)
        plate = d.get("plate")
        lx = l + 7
        if plate:
            lx, labw, fg = self.draw_plate(d, l, t, r, b, pg, self.face == "rear")
        two = (b - t) * self.z >= 22
        f1 = font(11 * self.z, True)
        cv.create_text(S(lx), S(t + (9 if two else (b - t) / 2)),
                       text=fit(d["name"], f1, S(labw - 8)), anchor="w", fill=fg, font=f1, tags=tg)
        if two:
            sub = d.get("ip") or d.get("model") or d.get("type", "")
            f2 = font(8.5 * self.z)
            cv.create_text(S(lx), S(t + 20), text=fit(sub, f2, S(labw - 8)), anchor="w", fill=fg, font=f2, tags=tg)
        for p, cx, cy, s in pg:
            c = a.cable_on_port(p["id"])
            fill = c["color"] if c else ("#101113" if plate else PORT_TYPES.get(p["type"], "#cccccc"))
            pend = self.pend == p["id"]
            if pend:
                oc, ow = "#00e5ff", 3
            elif plate and not c:
                oc, ow = PORT_TYPES.get(p["type"], "#cccccc"), 1
            else:
                oc, ow = "#000000", 1
            cv.create_rectangle(S(cx - s / 2), S(cy - s / 2), S(cx + s / 2), S(cy + s / 2), fill=fill,
                                outline=oc, width=ow, tags=("port:%d" % p["id"],))
            if s * self.z >= 15 and p["name"]:
                cv.create_text(S(cx), S(cy), text=p["name"][-3:], font=font(7 * self.z), fill=fg_for(fill),
                               tags=("port:%d" % p["id"],))

    # ---- faceplates: front and rear art for real equipment (rect/oval/line/text only, so SVG export works)
    def draw_plate(self, d, l, t, r, b, pg, rear):
        """Draws chassis art. Returns (label_x, label_width, label_fg)."""
        S, cv = self.S, self.cv
        tg = ("dev:%d" % d["id"],)
        p = d["plate"]
        k = p["k"]
        h = b - t
        pl = min([cx - s / 2 for _, cx, cy, s in pg], default=r - 8) - 6

        def rc(x0, y0, x1, y1, fill, out=""):
            cv.create_rectangle(S(x0), S(y0), S(x1), S(y1), fill=fill, outline=out, tags=tg)

        def ov(cx, cy, rad, fill, out=""):
            cv.create_oval(S(cx - rad), S(cy - rad), S(cx + rad), S(cy + rad), fill=fill, outline=out, tags=tg)

        def tx(x, y, s_, size, fill, bold=False, anchor="w"):
            if self.z >= 0.7:
                cv.create_text(S(x), S(y), text=s_, anchor=anchor, fill=fill, font=font(size * self.z, bold), tags=tg)

        def vents(x0, y0, x1, y1, fill, step=5):
            x = x0
            while x < x1:
                cv.create_line(S(x), S(y0), S(x), S(y1), fill=fill, tags=tg)
                x += step

        def bays(x0, x1, brand_light):
            n, rows = p["bays"], p["brows"]
            cols = math.ceil(n / rows)
            g = 2
            bw = (x1 - x0 - g * (cols - 1)) / cols
            bh = (h - 10 - g * (rows - 1)) / rows
            rc(x0 - 3, t + 3, x1 + 3, b - 3, "#0c0d0f", "#3a3d42")
            for i in range(n):
                cx, cy = x0 + (i % cols) * (bw + g), t + 5 + (i // cols) * (bh + g)
                rc(cx, cy, cx + bw, cy + bh, "#24262a", "#5b6068")
                rc(cx + 2, cy + 2, cx + bw - 2, cy + bh - 2, "#17181b", "#2f3237")
                if p.get("size") == "2.5" and bh > 18:
                    rc(cx + 3, cy + bh - 6, cx + bw - 3, cy + bh - 3, brand_light)
                elif bw >= 18:
                    ov(cx + 4, cy + 4, 1.4, "#3ddc5b")
                    cv.create_line(S(cx + 8), S(cy + bh / 2), S(cx + bw - 4), S(cy + bh / 2), fill="#3d4046", tags=tg)

        def ear(brand_led):
            rc(l + 1, t + 1, l + 31, b - 1, "#34373c", "#4a4e54")
            ov(l + 15, t + h * 0.3, 4.5, "#14151a", "#c9ced4")
            ov(l + 15, t + h * 0.3, 1.5, "#3ddc5b")
            ov(l + 9, t + h * 0.62, 1.6, brand_led)
            ov(l + 21, t + h * 0.62, 1.6, "#ffb020")

        def rear_server(psus, fans):
            rc(l + 1, t + 1, r - 1, b - 1, "#2c2e33", "#4a4e54")
            ph = (h - 6) / psus if h > 30 else h - 6
            for i in range(psus):
                if h > 30:
                    x0, y0, x1, y1 = l + 4, t + 3 + i * ph, l + 64, t + 3 + (i + 1) * ph - 2
                else:
                    x0, y0, x1, y1 = l + 4 + i * 62, t + 3, l + 62 + i * 62, b - 3
                rc(x0, y0, x1, y1, "#1a1b1e", "#6b717a")
                ov(x0 + 9, (y0 + y1) / 2, 3, "#3ddc5b")
                vents(x0 + 18, y0 + 4, x1 - 4, y1 - 4, "#33363b", 3)
            x0 = l + (68 if h > 30 else 4 + psus * 62 + 4)
            slots = max(1, int((pl - 8 - x0) // 60))
            sw = (pl - 8 - x0) / slots
            for i in range(slots):
                rc(x0 + i * sw + 1, t + 4, x0 + (i + 1) * sw - 1, b - 4, "#202226", "#454950")
                rc(x0 + i * sw + 4, t + 7, x0 + (i + 1) * sw - 4, t + 10, "#0c0d0f")
                vents(x0 + i * sw + 4, t + 14, x0 + (i + 1) * sw - 4, b - 8, "#2e3136", 3)

        psus = sum(1 for q in d["ports"] if q["type"] == "Power") or 1
        if k == "dell":
            if not rear:
                ear("#4aa3ff")
                tx(l + 15, b - 6, "DELL", 6, "#c9ced4", True, "center")
                bays(l + 156, pl - 4, "#6b717a")
                vents(l + 34, b - 5, l + 150, b - 3, "#2d3035", 3)
                return l + 34, 120, "#e6e8eb"
            rear_server(psus, 0)
            return l + 6, 54, "#e6e8eb"
        if k == "syn_rack":
            if not rear:
                ear("#3ddc5b")
                bays(l + 156, pl - 4, "#6b717a")
                tx(l + 34, b - 6, "Synology", 6.5, "#9aa0a6", True)
                rc(l + 1, t + 1, l + 1, t + 1, "#2a2c30")
                return l + 34, 120, "#e6e8eb"
            rear_server(psus, 2)
            return l + 6, 54, "#e6e8eb"
        if k == "unifi":
            rc(l + 1, t + 1, r - 1, b - 1, "#dfe2e6", "#9aa0a6")
            rc(l + 1, t + 1, l + 6, b - 1, "#b7bcc3")
            rc(r - 6, t + 1, r - 1, b - 1, "#b7bcc3")
            rc(l + 6, b - 4, r - 6, b - 2, "#c4c8ce")
            if not rear:
                ov(l + 143, t + h / 2, 4, "#ffffff", "#2a6fdb")
                ov(l + 143, t + h / 2, 1.8, "#2a6fdb")
                if p.get("lcd"):
                    rc(l + 104, t + h / 2 - 7, l + 134, t + h / 2 + 7, "#0f1114", "#555a62")
                    cv.create_line(S(l + 108), S(t + h / 2 - 2), S(l + 126), S(t + h / 2 - 2), fill="#2a6fdb", tags=tg)
                    cv.create_line(S(l + 108), S(t + h / 2 + 3), S(l + 120), S(t + h / 2 + 3), fill="#5a6068", tags=tg)
                return l + 10, (92 if p.get("lcd") else 128), "#23262b"
            rc(l + 10, t + 4, r - 10, b - 4, "#cfd3d8", "#9aa0a6")
            vents(l + 150, t + 6, r - 150, b - 6, "#a3a8af", 4)
            rc(l + 14, t + 6, l + 50, b - 6, "#15171a", "#5b6068")
            rc(l + 20, t + 10, l + 44, b - 10, "#0c0d0f")
            tx(l + 56, t + h / 2, "AC", 7, "#23262b", True)
            ov(l + 84, t + h / 2, 2.5, "#8b9097", "#555a62")
            rc(l + 96, t + 9, l + 116, b - 9, "#15171a", "#5b6068")
            for fx in (r - 130, r - 70):
                ov(fx, t + h / 2, 10, "#b3b8bf", "#555a62")
                ov(fx, t + h / 2, 3, "#555a62")
            tx(r - 22, t + h / 2, "REAR", 6, "#23262b", True, "center")
            return l + 10, 80, "#23262b"
        if k == "syn_desk":
            rc(l + 1, t + 1, r - 1, b - 1, "#202226", "#3a3d42")
            bx, by, bw, bh = l + 112, t + 4, 84, h - 8
            rc(bx, by, bx + bw, by + bh, "#2d2f33", "#6b717a")
            if not rear:
                tw = (bw - 12 - 6) / 4
                for i in range(4):
                    x0 = bx + 6 + i * (tw + 2)
                    rc(x0, by + 7, x0 + tw, by + bh - 28, "#17181b", "#4a4e54")
                    rc(x0 + 1, by + bh - 36, x0 + tw - 1, by + bh - 29, "#3a3d42")
                    ov(x0 + tw / 2, by + bh - 22, 1.6, "#3ddc5b")
                ov(bx + 11, by + bh - 9, 3.5, "#14151a", "#c9ced4")
                ov(bx + 11, by + bh - 9, 1.2, "#3ddc5b")
                tx(bx + 22, by + bh - 9, "Synology", 6.5, "#9aa0a6", True)
            else:
                ov(bx + bw / 2, by + bh * 0.33, 30, "#1b1c1f", "#6b717a")
                ov(bx + bw / 2, by + bh * 0.33, 20, "#25272b", "#4a4e54")
                ov(bx + bw / 2, by + bh * 0.33, 5, "#6b717a")
                rc(bx + 6, by + bh - 24, bx + 36, by + bh - 6, "#111214", "#6b717a")
                rc(bx + 42, by + bh - 24, bx + 56, by + bh - 6, "#111214", "#6b717a")
                rc(bx + 60, by + bh - 24, bx + 78, by + bh - 6, "#111214", "#6b717a")
                tx(bx + bw / 2, by + 5, "REAR", 6, "#9aa0a6", True, "center")
            return l + 6, 104, "#e6e8eb"
        if k == "udr":
            rc(l + 1, t + 1, r - 1, b - 1, "#f2f4f6", "#aeb4bb")
            rc(l + 1, b - 5, r - 1, b - 1, "#d9dde1")
            cy = t + h / 2 - 1
            if not rear:
                ov(l + 20, cy, 15, "#ffffff", "#9aa0a6")
                ov(l + 20, cy, 11, "#e7eaed", "#2a6fdb")
                ov(l + 20, cy, 4, "#2a6fdb")
                vents(l + 118, t + 8, l + 160, b - 9, "#c3c8ce", 4)
                tx(l + 46, cy, "Dream Router", 7, "#6b717a", True)
                return l + 46, 118, "#23262b"
            rc(l + 6, t + 6, l + 44, b - 8, "#d5d9dd", "#aeb4bb")
            ov(l + 25, cy, 9, "#c3c8ce", "#8b9097")
            vents(l + 54, t + 8, l + 150, b - 9, "#c3c8ce", 4)
            tx(l + 100, cy, "REAR", 6, "#6b717a", True, "center")
            return l + 54, 100, "#23262b"
        if k == "uap":
            rc(l + 1, t + 1, r - 1, b - 1, "#f2f4f6", "#aeb4bb")
            cy = t + h / 2
            if not rear:
                ov(l + 15, cy, 9.5, "#ffffff", "#9aa0a6")
                ov(l + 15, cy, 6.5, "#f2f4f6", "#2a6fdb")
                ov(l + 15, cy, 2, "#2a6fdb")
                return l + 30, 150, "#23262b"
            ov(l + 15, cy, 9.5, "#c3c8ce", "#8b9097")
            for ax in (-4, 4):
                ov(l + 15 + ax, cy, 1.4, "#6b717a")
            return l + 30, 150, "#23262b"
        return l + 7, min(150, (r - l) * 0.3), fg_for(d.get("color") or "#3b6ea8")

    def draw_cables(self):
        a, S, cv = self.app, self.S, self.cv
        for lane, c in enumerate(a.doc["cables"]):
            pts = a.route(c, lane % 12)
            if not pts or not (self.visible(a.pcache[c["a"]][3]) and self.visible(a.pcache[c["b"]][3])):
                continue
            sel = a.sel == ("cable", c["id"])
            sp = [S(v) for v in pts]
            dash = (6, 4) if c.get("style") == "dashed" else None
            tg = ("cable:%d" % c["id"],)
            self.cable_art(sp, c["color"], sel, dash, tg)
            for (px, py), (qx, qy) in ((pts[0:2], pts[2:4]), (pts[6:8], pts[4:6])):
                ux = 1 if qx >= px else -1
                self.plug_face_on = True
                self.plug(px, py, ux, 0, c["color"], sel, tg)
                self.plug_face_on = False
            if a.show_labels:
                txt = c.get("label") or a.fmt_len(c)
                if txt:
                    mx, my = (pts[2] + pts[4]) / 2, (pts[3] + pts[5]) / 2
                    if abs(pts[2] - pts[4]) < 1:
                        mx = pts[2] + (10 if pts[2] > pts[0] else -10) + 0
                    f = font(9 * self.z)
                    tid = cv.create_text(S(mx), S(my), text=txt, font=f, fill="#111111", tags=tg,
                                         anchor="w" if abs(pts[2] - pts[4]) < 1 and pts[2] > pts[0] else
                                         ("e" if abs(pts[2] - pts[4]) < 1 else "center"))
                    bb = cv.bbox(tid)
                    rid = cv.create_rectangle(bb[0] - 2, bb[1] - 1, bb[2] + 2, bb[3] + 1, fill=c["color"],
                                              outline="#000000", tags=tg)
                    cv.itemconfigure(tid, fill=fg_for(c["color"]))
                    cv.tag_lower(rid, tid)

    # ---- events
    def xy(self, e):
        return self.cv.canvasx(e.x), self.cv.canvasy(e.y)

    def press(self, e):
        a, cv = self.app, self.cv
        cv.focus_set()
        x, y = self.xy(e)
        wx, wy = x / self.z, y / self.z
        self.moved = False
        self.p0 = (e.x, e.y)
        kind, i = self.hit(x, y, self.ORDER)
        self.mode = None
        if self.pend is not None:
            if kind == "port" and i != self.pend:
                self.finish_cable(i)
                return
            if kind == "port":
                self.mode = "portcancel"
                return
            self.pend = None
            self.refresh()
        if kind == "port":
            c = a.cable_on_port(i)
            if c:
                a.select(("cable", c["id"]))
                return
            self.pend = i
            self.mode = "port"
            self.refresh()
            a.status("Cable started: click or drag to another port (Esc cancels)")
            return
        if kind == "cable":
            a.select(("cable", i))
        elif kind == "dev":
            d = a.dev(i)
            a.select(("dev", i))
            l, t = a.dev_rect(d)[:2]
            self.mode = "dev"
            self.dd, self.gdx, self.gdy = d, wx - l, wy - t
            self.cp = False
        elif kind == "rackhdr":
            a.select(("rack", i))
            self.mode = "rack"
            self.rr, self.lw, self.cp = a.rack(i), (wx, wy), False
        elif kind == "rack":
            a.select(("rack", i))
            a.cur_rack = i
            self.mode = "pan"
            cv.scan_mark(e.x, e.y)
        else:
            a.select(None)
            self.mode = "pan"
            cv.scan_mark(e.x, e.y)

    def drag(self, e):
        a, cv = self.app, self.cv
        x, y = self.xy(e)
        wx, wy = x / self.z, y / self.z
        if abs(e.x - self.p0[0]) + abs(e.y - self.p0[1]) > 4:
            self.moved = True
        cv.delete("ghost")
        if self.mode in ("port", "portcancel") and self.pend in a.pcache:
            px, py = a.pcache[self.pend][:2]
            cv.create_line(self.S(px), self.S(py), x, y, fill="#00e5ff", width=2, dash=(4, 3), tags=("ghost",))
        elif self.mode == "pan":
            cv.scan_dragto(e.x, e.y, gain=1)
        elif self.mode == "rack" and self.moved:
            if not self.cp:
                a.checkpoint()
                self.cp = True
            self.rr["x"] += wx - self.lw[0]
            self.rr["y"] += wy - self.lw[1]
            self.lw = (wx, wy)
            self.refresh()
        elif self.mode == "dev" and self.moved:
            loc = self.locate(wx, wy)
            d = self.dd
            if loc:
                tmp = dict(d, rack=loc[0]["id"], u=loc[1], side=loc[2])
                ok = a.fits(loc[0], tmp, ignore=d["id"])
            else:
                tmp = dict(d, rack=None, fx=wx - self.gdx, fy=wy - self.gdy)
                ok = True
            l, t, r, b = a.dev_rect(tmp)
            cv.create_rectangle(self.S(l), self.S(t), self.S(r), self.S(b), fill="", width=3,
                                outline="#2ea043" if ok else "#e5372b", dash=(6, 3), tags=("ghost",))

    def release(self, e):
        a, cv = self.app, self.cv
        x, y = self.xy(e)
        wx, wy = x / self.z, y / self.z
        cv.delete("ghost")
        m = self.mode
        self.mode = None
        if m == "port":
            if self.moved:
                kind, i = self.hit(x, y, self.ORDER)
                if kind == "port" and i != self.pend:
                    self.finish_cable(i)
                else:
                    self.pend = None
                    self.refresh()
        elif m == "portcancel" and not self.moved:
            self.pend = None
            self.refresh()
        elif m == "dev" and self.moved:
            d = self.dd
            loc = self.locate(wx, wy)
            if loc:
                tmp = dict(d, rack=loc[0]["id"], u=loc[1], side=loc[2])
                if a.fits(loc[0], tmp, ignore=d["id"]):
                    a.checkpoint()
                    d.update(rack=loc[0]["id"], u=loc[1], side=loc[2])
                    a.cur_rack = loc[0]["id"]
                else:
                    a.status("That slot is taken - device stays where it was")
            else:
                a.checkpoint()
                d.update(rack=None, fx=wx - self.gdx, fy=wy - self.gdy)
            a.redraw()
        elif m == "rack" and self.moved:
            a.redraw()

    def locate(self, wx, wy):
        a = self.app
        d = self.dd
        for r in a.doc["racks"]:
            x0, y0, x1, y1 = a.rack_rect(r)
            if x0 - 10 <= wx <= x1 + 10 and y0 <= wy <= y1 + 20:
                idx = round((wy - self.gdy - (r["y"] + HDR)) / UH)
                size = d["u_size"]
                top = r["u"] - idx
                u = max(1, min(r["u"] - size + 1, top - size + 1))
                side = 0
                if d.get("half"):
                    side = 0 if wx < r["x"] + RAIL + RW / 2 else 1
                return r, u, side
        return None

    def finish_cable(self, pb):
        a = self.app
        pa, self.pend = self.pend, None
        if a.cable_on_port(pb):
            a.status("That port already has a cable")
            self.refresh()
            return
        a.new_cable(pa, pb)

    def dbl(self, e):
        x, y = self.xy(e)
        kind, i = self.hit(x, y, self.ORDER)
        a = self.app
        self.pend = None
        if kind == "dev":
            a.edit_device(a.dev(i))
        elif kind == "cable":
            a.edit_cable(a.cable(i))
        elif kind in ("rack", "rackhdr"):
            a.edit_rack(a.rack(i))
        elif kind == "port":
            a.edit_port(i)

    def motion(self, e):
        a = self.app
        x, y = self.xy(e)
        if self.pend is not None and self.mode is None:
            self.cv.delete("ghost")
            if self.pend in a.pcache:
                px, py = a.pcache[self.pend][:2]
                self.cv.create_line(self.S(px), self.S(py), x, y, fill="#00e5ff", width=2, dash=(4, 3),
                                    tags=("ghost",))
        kind, i = self.hit(x, y, self.ORDER)
        a.status(a.describe(kind, i), hover=True)

    def ctx(self, e):
        a = self.app
        x, y = self.xy(e)
        wx, wy = x / self.z, y / self.z
        kind, i = self.hit(x, y, self.ORDER)
        m = tk.Menu(self.cv, tearoff=0)
        if kind == "port":
            p, d = a.port_index()[i]
            m.add_command(label="Edit port…", command=lambda: a.edit_port(i))
            c = a.cable_on_port(i)
            if c:
                m.add_command(label="Edit cable…", command=lambda: a.edit_cable(c))
                m.add_command(label="Remove cable", command=lambda: a.delete_cable(c))
            else:
                m.add_command(label="Start cable here", command=lambda: self.start_pend(i))
        elif kind == "cable":
            c = a.cable(i)
            a.select(("cable", i))
            m.add_command(label="Edit cable…", command=lambda: a.edit_cable(c))
            m.add_command(label="Remove cable", command=lambda: a.delete_cable(c))
        elif kind == "dev":
            d = a.dev(i)
            a.select(("dev", i))
            m.add_command(label="Edit device…", command=lambda: a.edit_device(d))
            m.add_command(label="Duplicate", command=lambda: a.duplicate_device(d))
            m.add_command(label="Move to U…", command=lambda: a.move_to_u(d))
            if d.get("half") and d.get("rack"):
                m.add_command(label="Swap left/right", command=lambda: a.swap_side(d))
            m.add_command(label="Take out of rack (off-rack)", command=lambda: a.unrack(d))
            m.add_command(label="Save as template…", command=lambda: a.save_template(d))
            m.add_separator()
            m.add_command(label="Delete device", command=lambda: a.delete_device(d))
        elif kind in ("rack", "rackhdr"):
            r = a.rack(i)
            a.select(("rack", i))
            m.add_command(label="Edit rack…", command=lambda: a.edit_rack(r))
            m.add_command(label="Delete rack", command=lambda: a.delete_rack(r))
            m.add_separator()
            m.add_command(label="Add rack", command=a.add_rack)
        else:
            m.add_command(label="Add rack", command=a.add_rack)
            m.add_command(label="New custom device…", command=a.new_custom_device)
        m.tk_popup(e.x_root, e.y_root)

    def flip(self):
        self.face = "rear" if self.face == "front" else "front"
        self.pend = None
        self.app.status("Showing the %s of the racks" % self.face)
        self.refresh()

    def start_pend(self, pid):
        self.pend = pid
        self.mode = None
        self.refresh()
        self.app.status("Cable started: click another port (Esc cancels)")


class LogicalView(ViewBase):
    BG = "#f6f8fa"
    BW, BH = 190, 62

    def __init__(self, app):
        super().__init__(app)
        cv = self.cv
        cv.bind("<ButtonPress-1>", self.press)
        cv.bind("<B1-Motion>", self.drag)
        cv.bind("<ButtonRelease-1>", self.release)
        cv.bind("<Double-Button-1>", self.dbl)
        cv.bind("<Button-3>", self.ctx)
        self.mode = None

    ORDER = ("cable", "ldev")

    def auto_layout(self, only_missing=False):
        a = self.app
        cols = {}
        for d in a.doc["devices"]:
            cols.setdefault(d.get("rack"), []).append(d)
        order = [r["id"] for r in a.doc["racks"]] + [None]
        x = 40
        for rid in order:
            ds = cols.get(rid, [])
            if rid:
                r = a.rack(rid)
                ds.sort(key=lambda d: -(d["u"] + d["u_size"]))
            ds = [d for d in ds if not (only_missing and "lx" in d)]
            for k, d in enumerate(ds):
                d["lx"] = x + (k // 8) * (self.BW + 60)
                d["ly"] = 60 + (k % 8) * (self.BH + 50)
            if ds:
                x += (len(ds) // 8 + 1 - (0 if len(ds) % 8 else 1)) * (self.BW + 60) + 80

    def draw(self):
        a, cv, S = self.app, self.cv, self.S
        a.build_cache()
        if any("lx" not in d for d in a.doc["devices"]):
            self.auto_layout(only_missing=True)
        BW, BH = self.BW, self.BH
        if a.show_groups:
            for r in a.doc["racks"]:
                ds = [d for d in a.doc["devices"] if d.get("rack") == r["id"]]
                if ds:
                    x0 = min(d["lx"] for d in ds) - 14
                    y0 = min(d["ly"] for d in ds) - 30
                    x1 = max(d["lx"] for d in ds) + BW + 14
                    y1 = max(d["ly"] for d in ds) + BH + 14
                    cv.create_rectangle(S(x0), S(y0), S(x1), S(y1), fill="#eaeef3", outline="#b0b8c2", dash=(5, 3))
                    cv.create_text(S(x0 + 8), S(y0 + 12), text=r["name"], anchor="w", font=font(12 * self.z, True),
                                   fill="#57606a")
        pairs = {}
        for c in a.doc["cables"]:
            pa, pb = a.port_index().get(c["a"]), a.port_index().get(c["b"])
            if not pa or not pb or pa[1]["id"] == pb[1]["id"]:
                continue
            pairs.setdefault(frozenset((pa[1]["id"], pb[1]["id"])), []).append((c, pa, pb))
        for key, lst in pairs.items():
            n = len(lst)
            for k, (c, pa, pb) in enumerate(lst):
                da, db = pa[1], pb[1]
                ax, ay = da["lx"] + BW / 2, da["ly"] + BH / 2
                bx, by = db["lx"] + BW / 2, db["ly"] + BH / 2
                dx, dy = bx - ax, by - ay
                ln = math.hypot(dx, dy) or 1
                off = (k - (n - 1) / 2) * 16
                nx, ny = -dy / ln * off, dx / ln * off
                ax, ay, bx, by = ax + nx, ay + ny, bx + nx, by + ny
                s = self.exit_t(ax, ay, dx, dy, da)
                e = self.exit_t(bx, by, -dx, -dy, db)
                sx, sy, ex, ey = ax + dx * s, ay + dy * s, bx - dx * e, by - dy * e
                sel = a.sel == ("cable", c["id"])
                tg = ("cable:%d" % c["id"],)
                dash = (6, 4) if c.get("style") == "dashed" else None
                self.cable_art([S(sx), S(sy), S(ex), S(ey)], c["color"], sel, dash, tg)
                ln2 = math.hypot(ex - sx, ey - sy) or 1
                ux, uy = (ex - sx) / ln2, (ey - sy) / ln2
                if ln2 > 50:
                    self.plug(sx, sy, ux, uy, c["color"], sel, tg)
                    self.plug(ex, ey, -ux, -uy, c["color"], sel, tg)
                lines = []
                if c.get("logical"):
                    lines.append(c["logical"])
                if c.get("label"):
                    lines.append(c["label"])
                if a.show_portnames:
                    lines.append("%s ↔ %s" % (pa[0]["name"], pb[0]["name"]))
                if lines:
                    f = font(9 * self.z)
                    t = cv.create_text(S((sx + ex) / 2), S((sy + ey) / 2), text="\n".join(lines), font=f,
                                       fill="#111111", justify="center", tags=tg)
                    bb = cv.bbox(t)
                    rid = cv.create_rectangle(bb[0] - 3, bb[1] - 2, bb[2] + 3, bb[3] + 2, fill="#ffffff",
                                              outline=c["color"], width=2, tags=tg)
                    cv.tag_lower(rid, t)
        for d in a.doc["devices"]:
            col = d.get("color") or "#3b6ea8"
            sel = a.sel == ("dev", d["id"])
            tg = ("ldev:%d" % d["id"],)
            cv.create_rectangle(S(d["lx"]), S(d["ly"]), S(d["lx"] + BW), S(d["ly"] + BH), fill=col,
                                outline=GOLD if sel else shade(col, -70), width=3 if sel else 1, tags=tg)
            fg = fg_for(col)
            cv.create_text(S(d["lx"] + 8), S(d["ly"] + 16), anchor="w", fill=fg, font=font(12 * self.z, True),
                           text=fit(d["name"], font(12 * self.z, True), S(BW - 14)), tags=tg)
            sub = " · ".join(x for x in (d.get("type", ""), d.get("model", "")) if x)
            cv.create_text(S(d["lx"] + 8), S(d["ly"] + 33), anchor="w", fill=fg, font=font(9 * self.z),
                           text=fit(sub, font(9 * self.z), S(BW - 14)), tags=tg)
            loc = ""
            if d.get("rack"):
                r = a.rack(d["rack"])
                loc = "%s  %s" % (r["name"], a.u_label(r, d))
            cv.create_text(S(d["lx"] + 8), S(d["ly"] + 48), anchor="w", fill=fg, font=font(9 * self.z),
                           text=fit((d.get("ip", "") + "   " + loc).strip(), font(9 * self.z), S(BW - 14)), tags=tg)

    def exit_t(self, px, py, dx, dy, d):
        cx, cy = d["lx"] + self.BW / 2, d["ly"] + self.BH / 2
        ts = []
        if dx:
            ts.append(((cx + (self.BW / 2 if dx > 0 else -self.BW / 2)) - px) / dx)
        if dy:
            ts.append(((cy + (self.BH / 2 if dy > 0 else -self.BH / 2)) - py) / dy)
        ts = [t for t in ts if t > 0]
        return min(ts) if ts else 0

    def press(self, e):
        a, cv = self.app, self.cv
        cv.focus_set()
        x, y = cv.canvasx(e.x), cv.canvasy(e.y)
        kind, i = self.hit(x, y, self.ORDER)
        self.moved = False
        self.cp = False
        if kind == "ldev":
            a.select(("dev", i))
            d = a.dev(i)
            self.mode = "dev"
            self.dd = d
            self.lw = (x / self.z, y / self.z)
        elif kind == "cable":
            a.select(("cable", i))
            self.mode = None
        else:
            a.select(None)
            self.mode = "pan"
            cv.scan_mark(e.x, e.y)

    def drag(self, e):
        a, cv = self.app, self.cv
        if self.mode == "pan":
            cv.scan_dragto(e.x, e.y, gain=1)
        elif self.mode == "dev":
            wx, wy = cv.canvasx(e.x) / self.z, cv.canvasy(e.y) / self.z
            if not self.cp:
                a.checkpoint()
                self.cp = True
            self.dd["lx"] += wx - self.lw[0]
            self.dd["ly"] += wy - self.lw[1]
            self.lw = (wx, wy)
            self.refresh()

    def release(self, e):
        self.mode = None

    def dbl(self, e):
        a = self.app
        kind, i = self.hit(self.cv.canvasx(e.x), self.cv.canvasy(e.y), self.ORDER)
        if kind == "ldev":
            a.edit_device(a.dev(i))
        elif kind == "cable":
            a.edit_cable(a.cable(i))

    def ctx(self, e):
        a = self.app
        kind, i = self.hit(self.cv.canvasx(e.x), self.cv.canvasy(e.y), self.ORDER)
        m = tk.Menu(self.cv, tearoff=0)
        if kind == "ldev":
            m.add_command(label="Edit device…", command=lambda: a.edit_device(a.dev(i)))
        elif kind == "cable":
            m.add_command(label="Edit cable / logical connection…", command=lambda: a.edit_cable(a.cable(i)))
            m.add_command(label="Remove cable", command=lambda: a.delete_cable(a.cable(i)))
        m.add_command(label="Auto-arrange by rack", command=a.auto_arrange)
        m.tk_popup(e.x_root, e.y_root)


# ---------------------------------------------------------------- app
class App:
    def __init__(self, root):
        self.root = root
        self.settings = load_settings()
        self.doc = new_doc()
        self.path = None
        self.dirty = False
        self.undo_s, self.redo_s = [], []
        self.sel = None
        self.cur_rack = None
        self.show_labels = True
        self.show_groups = True
        self.show_portnames = True
        self.pcache = {}
        self._pidx = {}
        self.sched = None
        root.geometry(self.settings.get("geometry", "1400x850"))
        root.protocol("WM_DELETE_WINDOW", self.quit)
        self.build_ui()
        self.redraw()
        self.title()

    # ---- model access
    def nid(self):
        n = self.doc["nid"]
        self.doc["nid"] = n + 1
        return n

    def rack(self, i):
        return next((r for r in self.doc["racks"] if r["id"] == i), None)

    def dev(self, i):
        return next((d for d in self.doc["devices"] if d["id"] == i), None)

    def cable(self, i):
        return next((c for c in self.doc["cables"] if c["id"] == i), None)

    def port_index(self):
        return self._pidx

    def cable_on_port(self, pid):
        for c in self.doc["cables"]:
            if c["a"] == pid or c["b"] == pid:
                return c
        return None

    def build_cache(self):
        self._pidx = {}
        self.pcache = {}
        for d in self.doc["devices"]:
            for p in d["ports"]:
                self._pidx[p["id"]] = (p, d)
            for p, cx, cy, s in self.port_geom(d):
                self.pcache[p["id"]] = (cx, cy, s, d)

    def rack_rect(self, r):
        x, y = r["x"], r["y"]
        return x, y, x + RW + 2 * RAIL, y + HDR + r["u"] * UH + PADB

    def dev_rect(self, d):
        size = d["u_size"]
        w = RW * (0.5 if d.get("half") else 1)
        r = self.rack(d["rack"]) if d.get("rack") else None
        if r:
            top = r["y"] + HDR + (r["u"] - (d["u"] + size - 1)) * UH
            left = r["x"] + RAIL + (RW / 2 if d.get("half") and d.get("side", 0) == 1 else 0)
        else:
            left, top = d.get("fx", 0), d.get("fy", 0)
        return left, top, left + w, top + size * UH

    def port_geom(self, d):
        pl = d["ports"]
        n = len(pl)
        if not n:
            return []
        l, t, r, b = self.dev_rect(d)
        w, h = r - l, b - t
        rows = min(n, d.get("rows") or max(1, d["u_size"] * 2))
        cols = math.ceil(n / rows)
        labw = min(150, w * 0.3)
        if (d.get("plate") or {}).get("k") in ("dell", "syn_rack", "syn_desk", "udr", "uap"):
            cell = min((h - 4) / rows, 14)
            x0 = r - 8 - cols * cell
        else:
            area = w - labw - 12
            cell = min(area / cols, (h - 4) / rows, 22)
            x0 = l + labw + 6 + (area - cols * cell) / 2
        y0 = t + (h - rows * cell) / 2
        s = max(4, cell - 3)
        return [(p, x0 + (i // rows) * cell + cell / 2, y0 + (i % rows) * cell + cell / 2, s)
                for i, p in enumerate(pl)]

    def container(self, d):
        if d.get("rack"):
            return self.rack_rect(self.rack(d["rack"]))
        return self.dev_rect(d)

    def route(self, c, lane):
        A, B = self.pcache.get(c["a"]), self.pcache.get(c["b"])
        if not A or not B:
            return None
        ca, cb = self.container(A[3]), self.container(B[3])
        gap = max(ca[1] - cb[3], cb[1] - ca[3])
        overlap = min(ca[2], cb[2]) - max(ca[0], cb[0])
        if ca == cb or (overlap > 0 and gap < 40):
            # same rack/shelf, or stacked neighbours: shortest path, no detour out to the side
            xm = (A[0] + B[0]) / 2
            return [A[0], A[1], xm, A[1], xm, B[1], B[0], B[1]]
        ma, mb = (ca[0] + ca[2]) / 2, (cb[0] + cb[2]) / 2
        if ma < mb - 1:
            sa, sb = 1, -1
        elif ma > mb + 1:
            sa, sb = -1, 1
        else:
            sa = sb = 1
        off = 14 + lane * 5
        xa = ca[2] + off if sa > 0 else ca[0] - off
        xb = cb[2] + off if sb > 0 else cb[0] - off
        return [A[0], A[1], xa, A[1], xb, B[1], B[0], B[1]]

    def fmt_len(self, c):
        return "%g%s" % (c["length"], c.get("unit", "")) if c.get("length") else ""

    def u_label(self, r, d):
        H = r["u"]
        lo, hi = d["u"], d["u"] + d["u_size"] - 1
        if r.get("numbering", "up") != "up":
            lo, hi = H - hi + 1, H - lo + 1
        return "U%d" % lo if lo == hi else "U%d-%d" % (lo, hi)

    def describe(self, kind, i):
        if kind == "port":
            p, d = self._pidx.get(i, (None, None))
            if not p:
                return ""
            s = "%s • port %s (%s)%s" % (d["name"], p["name"], p["type"], " - " + p["label"] if p.get("label") else "")
            c = self.cable_on_port(i)
            if c:
                o = c["b"] if c["a"] == i else c["a"]
                op, od = self._pidx.get(o, (None, None))
                s += "  →  %s port %s  [%s %s %s]" % (od["name"] if od else "?", op["name"] if op else "?",
                                                           color_name(c["color"]), self.fmt_len(c), c.get("type", ""))
            else:
                s += "  • free - click to start a cable"
            return s
        if kind == "cable":
            c = self.cable(i)
            return "Cable %s %s %s %s" % (color_name(c["color"]), self.fmt_len(c), c.get("label", ""), c.get("logical", ""))
        if kind == "dev":
            d = self.dev(i)
            r = self.rack(d["rack"]) if d.get("rack") else None
            return "%s • %s • %dU%s • %s" % (d["name"], d.get("type", ""), d["u_size"],
                                                            " • " + self.u_label(r, d) if r else " • off-rack",
                                                            d.get("ip", ""))
        if kind in ("rack", "rackhdr"):
            r = self.rack(i)
            return "%s • %dU" % (r["name"], r["u"])
        return ""

    def status(self, msg, hover=False):
        if hover and self.pinned and msg == "":
            return
        self.sb.config(text=msg)

    pinned = False

    # ---- ui
    def build_ui(self):
        root = self.root
        self.build_menu()
        tb = ttk.Frame(root, padding=(6, 4))
        tb.pack(fill="x")
        for t, c in (("New", self.new), ("Open", self.open), ("Save", self.save), ("|", None),
                     ("Undo", self.undo), ("Redo", self.redo), ("|", None),
                     ("+ Rack", self.add_rack), ("+ Device", self.new_custom_device),
                     ("Cable schedule", self.show_schedule), ("Flip front/rear", self.flip), ("|", None),
                     ("Zoom +", lambda: self.view().zoom(1.2)), ("Zoom -", lambda: self.view().zoom(1 / 1.2)),
                     ("Fit", lambda: self.view().fit())):
            if t == "|":
                ttk.Separator(tb, orient="vertical").pack(side="left", fill="y", padx=6)
            else:
                ttk.Button(tb, text=t, command=c).pack(side="left", padx=2)
        self.sbv = tk.BooleanVar(value=True)
        for text, attr in (("Cable labels", "show_labels"), ("Rack outlines (logical)", "show_groups"),
                           ("Port names (logical)", "show_portnames")):
            v = tk.BooleanVar(value=getattr(self, attr))
            ttk.Checkbutton(tb, text=text, variable=v,
                            command=lambda v=v, a=attr: (setattr(self, a, v.get()), self.redraw())).pack(
                side="left", padx=6)
        self.sb = ttk.Label(root, text="", relief="sunken", anchor="w", padding=(6, 2))
        self.sb.pack(side="bottom", fill="x")
        pw = ttk.PanedWindow(root, orient="horizontal")
        pw.pack(fill="both", expand=True)
        left = ttk.Frame(pw, padding=4)
        pw.add(left, weight=0)
        ttk.Label(left, text="Device library", font=(FONT, 10, "bold")).pack(anchor="w")
        ttk.Label(left, text="Double-click or drag onto a rack", foreground="#666").pack(anchor="w")
        self.lib = ttk.Treeview(left, show="tree", selectmode="browse", height=24)
        self.lib.pack(fill="both", expand=True, pady=4)
        self.lib.column("#0", width=230)
        self.lib.bind("<Double-1>", lambda e: self.lib_add())
        self.lib.bind("<ButtonRelease-1>", self.lib_drop)
        self.lib.bind("<Button-3>", self.lib_menu)
        ttk.Button(left, text="New custom device…", command=self.new_custom_device).pack(fill="x")
        self.nb = ttk.Notebook(pw)
        pw.add(self.nb, weight=1)
        self.rv = RackView(self)
        self.lv = LogicalView(self)
        self.nb.add(self.rv, text=" Rack view ")
        self.nb.add(self.lv, text=" Logical view ")
        self.nb.bind("<<NotebookTabChanged>>", lambda e: self.redraw())
        self.fill_lib()
        r = self.root
        r.bind("<Control-z>", lambda e: self.undo())
        r.bind("<Control-y>", lambda e: self.redo())
        r.bind("<Control-s>", lambda e: self.save())
        r.bind("<Control-o>", lambda e: self.open())
        r.bind("<Control-n>", lambda e: self.new())
        r.bind("<Control-d>", lambda e: self.sel and self.sel[0] == "dev" and self.duplicate_device(self.dev(self.sel[1])))
        r.bind("<Delete>", self.key_delete)
        r.bind("<Escape>", self.key_esc)
        r.bind("<Up>", lambda e: self.nudge(1))
        r.bind("<Down>", lambda e: self.nudge(-1))
        r.bind("<Left>", lambda e: self.nudge_side())
        r.bind("<Right>", lambda e: self.nudge_side())
        self.status("Ready. Add a rack, then double-click a device in the library.")

    def build_menu(self):
        m = tk.Menu(self.root)
        f = tk.Menu(m, tearoff=0)
        f.add_command(label="New", accelerator="Ctrl+N", command=self.new)
        f.add_command(label="Open…", accelerator="Ctrl+O", command=self.open)
        f.add_command(label="Save", accelerator="Ctrl+S", command=self.save)
        f.add_command(label="Save as…", command=lambda: self.save(True))
        f.add_separator()
        f.add_command(label="Import rack list (text)...", command=self.import_list)
        f.add_command(label="Load sample design", command=self.load_sample)
        f.add_separator()
        f.add_command(label="Export rack view (SVG)…", command=lambda: self.export_svg(self.rv))
        f.add_command(label="Export logical view (SVG)…", command=lambda: self.export_svg(self.lv))
        f.add_command(label="Export cable schedule (CSV)…", command=self.export_csv)
        f.add_command(label="Export device list (CSV)…", command=self.export_devices)
        f.add_separator()
        f.add_command(label="Exit", command=self.quit)
        m.add_cascade(label="File", menu=f)
        e = tk.Menu(m, tearoff=0)
        e.add_command(label="Undo", accelerator="Ctrl+Z", command=self.undo)
        e.add_command(label="Redo", accelerator="Ctrl+Y", command=self.redo)
        e.add_separator()
        e.add_command(label="Duplicate device", accelerator="Ctrl+D",
                      command=lambda: self.sel and self.sel[0] == "dev" and self.duplicate_device(self.dev(self.sel[1])))
        e.add_command(label="Delete selected", accelerator="Del", command=self.key_delete)
        e.add_command(label="Edit selected…", command=self.edit_selected)
        m.add_cascade(label="Edit", menu=e)
        a = tk.Menu(m, tearoff=0)
        a.add_command(label="Add rack…", command=self.add_rack)
        a.add_command(label="New custom device…", command=self.new_custom_device)
        a.add_command(label="Auto-arrange logical view", command=self.auto_arrange)
        m.add_cascade(label="Add", menu=a)
        h = tk.Menu(m, tearoff=0)
        h.add_command(label="How to use", command=self.help)
        m.add_cascade(label="Help", menu=h)
        self.root.config(menu=m)

    def flip(self):
        self.nb.select(0)
        self.rv.flip()

    def help(self):
        messagebox.showinfo(APP, (
            "Rack view\n"
            " - Drag a device to move it between U slots / racks (green = ok, red = taken).\n"
            " - Drop outside a rack to make it an off-rack device (ISP, laptop, wall jack...).\n"
            " - Up/Down arrows nudge the selected device one U; Left/Right swaps half-width side.\n"
            " - Cable: click a port, then click (or drag to) another port, then set colour/length/label.\n"
            " - Double-click anything to edit it; right-click for more.\n"
            " - Ctrl+wheel zooms, wheel scrolls, middle-drag or empty-space drag pans.\n\n"
            "Logical view: the same cables as connections between devices. Put VLAN/purpose text in\n"
            "the cable's 'Logical connection' field and it shows on the link. Drag boxes freely.\n\n"
            "Library: right-click a device and choose 'Save as template' to build your own parts."))

    def view(self):
        return self.rv if self.nb.index("current") == 0 else self.lv

    def title(self):
        n = os.path.basename(self.path) if self.path else "Untitled"
        self.root.title("%s - %s%s" % (APP, n, " *" if self.dirty else ""))

    # ---- library
    def templates(self):
        return BUILTIN + self.settings.get("templates", [])

    def fill_lib(self):
        self.lib.delete(*self.lib.get_children())
        self.tmap = {}
        groups = {}
        for i, t in enumerate(self.templates()):
            gk = t.get("group") or t["type"]
            g = groups.get(gk)
            if g is None:
                g = groups[gk] = self.lib.insert("", "end", text=gk, open=False if t.get("group") else True)
            iid = self.lib.insert(g, "end", text="%s%s" % (t["name"], "  ★" if i >= len(BUILTIN) else ""))
            self.tmap[iid] = i

    def lib_sel(self):
        s = self.lib.selection()
        if s and s[0] in self.tmap:
            return self.templates()[self.tmap[s[0]]]
        return None

    def lib_add(self):
        t = self.lib_sel()
        if t:
            self.place_new(self.from_tpl(t))

    def lib_drop(self, e):
        t = self.lib_sel()
        if not t or abs(e.x) < 0 :
            return
        w = self.root.winfo_containing(e.x_root, e.y_root)
        if w is self.rv.cv:
            cv = self.rv.cv
            x = cv.canvasx(e.x_root - cv.winfo_rootx()) / self.rv.z
            y = cv.canvasy(e.y_root - cv.winfo_rooty()) / self.rv.z
            self.nb.select(0)
            d = self.from_tpl(t)
            d["face"] = self.rv.face
            self.rv.dd, self.rv.gdx, self.rv.gdy = d, 0, UH / 2
            loc = self.rv.locate(x, y)
            if loc and self.fits(loc[0], dict(d, rack=loc[0]["id"], u=loc[1], side=loc[2])):
                d.update(rack=loc[0]["id"], u=loc[1], side=loc[2])
                self.add_device(d)
            elif loc:
                self.status("That slot is taken")
            else:
                d.update(rack=None, fx=x, fy=y)
                self.add_device(d)

    def lib_menu(self, e):
        iid = self.lib.identify_row(e.y)
        if iid not in self.tmap:
            return
        self.lib.selection_set(iid)
        i = self.tmap[iid]
        m = tk.Menu(self.lib, tearoff=0)
        m.add_command(label="Add to rack", command=self.lib_add)
        if i >= len(BUILTIN):
            m.add_command(label="Delete template", command=lambda: self.del_template(i - len(BUILTIN)))
        m.tk_popup(e.x_root, e.y_root)

    def del_template(self, k):
        del self.settings["templates"][k]
        save_settings(self.settings)
        self.fill_lib()

    def save_template(self, d):
        from_d = Dialog(self.root, "Save as template", [("name", "Template name", "str", d["name"])])
        if not from_d.result:
            return
        t = {k: copy.deepcopy(d.get(k)) for k in ("type", "u_size", "color", "half", "rows", "model", "ip", "plate", "group", "short")}
        t["name"] = from_d.result["name"]
        t["ports"] = [{"name": p["name"], "type": p["type"], "label": p.get("label", "")} for p in d["ports"]]
        self.settings.setdefault("templates", []).append(t)
        save_settings(self.settings)
        self.fill_lib()

    def from_tpl(self, t):
        d = {"id": self.nid(), "name": t.get("short") or t["name"], "model": t.get("model", ""), "type": t["type"],
             "u_size": t["u_size"], "rack": None, "u": 1, "side": 0, "half": t.get("half", False),
             "color": t["color"], "ip": t.get("ip", ""), "serial": "", "notes": "", "rows": t.get("rows", 0),
             "ports": [], "fx": 0, "fy": 0, "face": "front"}
        if t.get("plate"):
            d["plate"] = copy.deepcopy(t["plate"])
            d["face"] = "both"
        for p in t["ports"]:
            d["ports"].append({"id": self.nid(), "name": p["name"], "type": p["type"], "label": p.get("label", "")})
        return d

    # ---- undo
    def checkpoint(self):
        self.undo_s.append(json.dumps(self.doc))
        if len(self.undo_s) > 150:
            self.undo_s.pop(0)
        self.redo_s.clear()
        self.dirty = True
        self.title()

    def undo(self):
        if self.undo_s:
            self.redo_s.append(json.dumps(self.doc))
            self.doc = json.loads(self.undo_s.pop())
            self.after_restore()

    def redo(self):
        if self.redo_s:
            self.undo_s.append(json.dumps(self.doc))
            self.doc = json.loads(self.redo_s.pop())
            self.after_restore()

    def after_restore(self):
        self.sel = None
        self.rv.pend = None
        self.dirty = True
        self.title()
        self.redraw()

    def redraw(self):
        try:
            self.title()
            if self.nb.index("current") == 0:
                self.rv.refresh()
            else:
                self.lv.refresh()
            if self.sched and self.sched.winfo_exists():
                self.fill_sched()
        except tk.TclError:
            pass

    def select(self, s):
        self.sel = s
        if s and s[0] == "rack":
            self.cur_rack = s[1]
        if s and s[0] == "dev":
            d = self.dev(s[1])
            if d and d.get("rack"):
                self.cur_rack = d["rack"]
        self.redraw()

    # ---- racks
    def add_rack(self):
        n = len(self.doc["racks"]) + 1
        res = Dialog(self.root, "Add rack", [
            ("name", "Name", "str", "Rack %d" % n), ("u", "Height (U)", "int", 42),
            ("numbering", "U numbering", "choice", "up", ["up", "down"]),
            ("color", "Rack colour", "color", "#3a3d42", [("", "#3a3d42"), ("", "#2b3a55"), ("", "#4a2f2f"),
                                                          ("", "#2f4a35")]),
            ("notes", "Note (shown in header)", "str", "")]).result
        if not res:
            return
        if not 1 <= res["u"] <= 100:
            messagebox.showerror(APP, "Height must be 1-100 U")
            return
        self.checkpoint()
        x = max([self.rack_rect(r)[2] for r in self.doc["racks"]], default=-170) + 170
        r = {"id": self.nid(), "name": res["name"], "u": res["u"], "x": x, "y": 0,
             "numbering": res["numbering"], "color": res["color"], "notes": res["notes"]}
        self.doc["racks"].append(r)
        self.cur_rack = r["id"]
        self.redraw()
        self.rv.fit()

    def edit_rack(self, r):
        res = Dialog(self.root, "Edit rack", [
            ("name", "Name", "str", r["name"]), ("u", "Height (U)", "int", r["u"]),
            ("numbering", "U numbering", "choice", r.get("numbering", "up"), ["up", "down"]),
            ("color", "Rack colour", "color", r.get("color", "#3a3d42"),
             [("", "#3a3d42"), ("", "#2b3a55"), ("", "#4a2f2f"), ("", "#2f4a35")]),
            ("notes", "Note", "str", r.get("notes", ""))]).result
        if not res:
            return
        top = max([d["u"] + d["u_size"] - 1 for d in self.doc["devices"] if d.get("rack") == r["id"]], default=0)
        if res["u"] < top or res["u"] < 1:
            messagebox.showerror(APP, "Devices occupy up to U%d - move them first." % top)
            return
        self.checkpoint()
        r.update(res)
        self.redraw()

    def delete_rack(self, r):
        ds = [d for d in self.doc["devices"] if d.get("rack") == r["id"]]
        if not messagebox.askyesno(APP, "Delete %s%s?" % (r["name"], " and its %d devices" % len(ds) if ds else "")):
            return
        self.checkpoint()
        for d in ds:
            self.remove_device(d)
        self.doc["racks"].remove(r)
        self.sel = None
        self.redraw()

    # ---- devices
    def fits(self, r, d, ignore=None):
        lo, hi = d["u"], d["u"] + d["u_size"] - 1
        if lo < 1 or hi > r["u"]:
            return False
        for o in self.doc["devices"]:
            if o.get("rack") != r["id"] or o["id"] == ignore or o["id"] == d.get("id") and ignore is None and False:
                continue
            if o["id"] == d.get("id"):
                continue
            fa, fb = o.get("face", "front"), d.get("face", "front")
            if not (fa == fb or "both" in (fa, fb)):
                continue
            if o["u"] <= hi and o["u"] + o["u_size"] - 1 >= lo:
                if not (o.get("half") and d.get("half")) or o.get("side", 0) == d.get("side", 0):
                    return False
        return True

    def find_free(self, r, d):
        for side in ((0, 1) if d.get("half") else (0,)):
            for u in range(1, r["u"] - d["u_size"] + 2):
                if self.fits(r, dict(d, u=u, side=side, rack=r["id"])):
                    return u, side
        return None

    def add_device(self, d):
        self.checkpoint()
        self.doc["devices"].append(d)
        self.sel = ("dev", d["id"])
        self.redraw()

    def place_new(self, d):
        if not self.doc["racks"]:
            self.add_rack()
            if not self.doc["racks"]:
                return
        d["face"] = self.rv.face
        r = self.rack(self.cur_rack) or self.doc["racks"][0]
        off = (d.get("plate") or {}).get("off")
        spot = None if off else self.find_free(r, d)
        if not spot and not off:
            for r2 in self.doc["racks"]:
                spot = self.find_free(r2, d)
                if spot:
                    r = r2
                    break
        if spot:
            d.update(rack=r["id"], u=spot[0], side=spot[1])
        else:
            n = [x for x in self.doc["devices"] if not x.get("rack")]
            d.update(rack=None, fx=min(x["x"] for x in self.doc["racks"]) - RW - 160,
                     fy=sum(x["u_size"] * UH + 20 for x in n))
            self.status("Placed off-rack" if off else "No free slot - placed off-rack")
        self.add_device(d)

    def new_custom_device(self):
        d = self.from_tpl({"name": "New device", "type": "Other", "u_size": 1, "color": "#4b5563", "ports": []})
        if self.edit_device(d, new=True):
            self.place_new(d)

    def edit_device(self, d, new=False):
        work = copy.deepcopy(d["ports"])
        r = self.rack(d["rack"]) if d.get("rack") else None

        def edit_ports(dlg):
            PortsEditor(dlg, work, self.nid)
        res = Dialog(self.root, "New device" if new else "Edit device", [
            ("name", "Name / hostname", "str", d["name"]),
            ("type", "Type", "choice", d["type"], DEV_TYPES),
            ("model", "Make / model", "str", d.get("model", "")),
            ("u_size", "Height (U)", "int", d["u_size"]),
            ("half", "Half-width (two per U)", "bool", d.get("half", False)),
            ("color", "Colour", "color", d["color"], DEV_COLORS),
            ("ip", "IP / management", "str", d.get("ip", "")),
            ("serial", "Serial / asset tag", "str", d.get("serial", "")),
            ("rows", "Port rows (0 = auto)", "int", d.get("rows", 0)),
            ("face", "Mounted on", "choice", d.get("face", "front"), ["front", "rear", "both"]),
            ("notes", "Notes", "text", d.get("notes", "")),
            ("ports", "Ports: %d" % len(d["ports"]), "action", "Edit ports…", edit_ports)]).result
        if not res:
            return False
        res["u_size"] = max(1, min(res["u_size"], 60))
        res["rows"] = max(0, res["rows"])
        trial = dict(d, **res)
        if r and not new and not self.fits(r, trial, ignore=d["id"]):
            messagebox.showerror(APP, "That size doesn't fit in the rack at the current position.")
            return False
        if not new:
            self.checkpoint()
        d.update(res)
        d["ports"] = work
        keep = {p["id"] for p in work}
        self.doc["cables"] = [c for c in self.doc["cables"]
                              if not ((c["a"] in {p["id"] for p in copy.deepcopy(work)} or True) and False)]
        alive = {p["id"] for x in self.doc["devices"] for p in x["ports"]} | keep
        self.doc["cables"] = [c for c in self.doc["cables"] if c["a"] in alive and c["b"] in alive]
        if not new:
            self.redraw()
        return True

    def remove_device(self, d):
        ids = {p["id"] for p in d["ports"]}
        self.doc["cables"] = [c for c in self.doc["cables"] if c["a"] not in ids and c["b"] not in ids]
        self.doc["devices"].remove(d)

    def delete_device(self, d):
        self.checkpoint()
        self.remove_device(d)
        self.sel = None
        self.redraw()

    def duplicate_device(self, d):
        n = copy.deepcopy(d)
        n["id"] = self.nid()
        n["name"] = d["name"] + " (copy)"
        for p in n["ports"]:
            p["id"] = self.nid()
        if d.get("rack"):
            r = self.rack(d["rack"])
            spot = self.find_free(r, n)
            if spot:
                n.update(u=spot[0], side=spot[1])
            else:
                n.update(rack=None, fx=r["x"] - RW - 160, fy=60)
        else:
            n["fx"], n["fy"] = d["fx"] + 30, d["fy"] + 30
        n.pop("lx", None)
        self.add_device(n)

    def move_to_u(self, d):
        r = self.rack(d.get("rack")) if d.get("rack") else self.rack(self.cur_rack)
        if not r:
            return
        res = Dialog(self.root, "Move to U", [
            ("rack", "Rack", "choice", r["name"], [x["name"] for x in self.doc["racks"]]),
            ("u", "Top of device at U", "int", 1)]).result
        if not res:
            return
        r = next((x for x in self.doc["racks"] if x["name"] == res["rack"]), r)
        n = res["u"]
        top = n if r.get("numbering", "up") == "up" else r["u"] - n + 1
        u = top - d["u_size"] + 1
        t = dict(d, rack=r["id"], u=u)
        if self.fits(r, t, ignore=d["id"]):
            self.checkpoint()
            d.update(rack=r["id"], u=u)
            self.redraw()
        else:
            messagebox.showerror(APP, "That position is out of range or occupied.")

    def unrack(self, d):
        l, t = self.dev_rect(d)[:2]
        r = self.rack(d["rack"])
        self.checkpoint()
        d.update(rack=None, fx=r["x"] - RW - 160 if r else 0, fy=t)
        self.redraw()

    def swap_side(self, d):
        t = dict(d, side=1 - d.get("side", 0))
        if self.fits(self.rack(d["rack"]), t, ignore=d["id"]):
            self.checkpoint()
            d["side"] = t["side"]
            self.redraw()

    def nudge(self, delta):
        if not self.sel or self.sel[0] != "dev" or self.nb.index("current") != 0:
            return
        d = self.dev(self.sel[1])
        r = self.rack(d["rack"]) if d.get("rack") else None
        if not r:
            return
        t = dict(d, u=d["u"] + delta)
        if self.fits(r, t, ignore=d["id"]):
            self.checkpoint()
            d["u"] = t["u"]
            self.redraw()
        else:
            self.status("Can't move there (rack edge or occupied)")

    def nudge_side(self):
        if self.sel and self.sel[0] == "dev":
            d = self.dev(self.sel[1])
            if d.get("half") and d.get("rack"):
                self.swap_side(d)

    def edit_port(self, pid):
        p, d = self._pidx[pid]
        res = Dialog(self.root, "Edit port", [
            ("name", "Port name", "str", p["name"]), ("type", "Type", "choice", p["type"], list(PORT_TYPES)),
            ("label", "Label / VLAN / purpose", "str", p.get("label", ""))]).result
        if res:
            self.checkpoint()
            p.update(res)
            self.redraw()

    # ---- cables
    def new_cable(self, pa, pb):
        dflt = self.settings.get("cable_defaults", {"color": "#1f6feb", "type": "Cat6", "length": 3.0,
                                                    "unit": "ft", "style": "solid"})
        c = {"id": 0, "a": pa, "b": pb, "color": dflt["color"], "style": dflt["style"], "type": dflt["type"],
             "length": dflt["length"], "unit": dflt["unit"], "label": "", "logical": "", "notes": ""}
        if self.cable_dialog(c, "New cable"):
            self.checkpoint()
            c["id"] = self.nid()
            self.doc["cables"].append(c)
            self.settings["cable_defaults"] = {k: c[k] for k in ("color", "type", "length", "unit", "style")}
            save_settings(self.settings)
            self.sel = ("cable", c["id"])
        self.redraw()

    def cable_dialog(self, c, title):
        pa, da = self._pidx[c["a"]]
        pb, db = self._pidx[c["b"]]
        res = Dialog(self.root, title, [
            ("ends", "Connection", "info", "%s [%s]  ↔  %s [%s]" % (da["name"], pa["name"], db["name"], pb["name"])),
            ("color", "Cable colour", "color", c["color"]),
            ("style", "Line style", "choice", c.get("style", "solid"), ["solid", "dashed"]),
            ("type", "Cable type", "choice", c.get("type", ""), CABLE_TYPES),
            ("length", "Length", "float", "%g" % c.get("length", 0)),
            ("unit", "Unit", "choice", c.get("unit", "ft"), UNITS),
            ("label", "Cable label / ID", "str", c.get("label", "")),
            ("logical", "Logical connection", "str", c.get("logical", "")),
            ("notes", "Notes", "text", c.get("notes", ""))]).result
        if not res:
            return False
        res.pop("ends", None)
        c.update(res)
        return True

    def edit_cable(self, c):
        if not c:
            return
        old = copy.deepcopy(c)
        if self.cable_dialog(c, "Edit cable"):
            cur = copy.deepcopy(c)
            c.clear()
            c.update(old)
            self.checkpoint()
            c.update(cur)
        self.redraw()

    def delete_cable(self, c):
        self.checkpoint()
        self.doc["cables"].remove(c)
        self.sel = None
        self.redraw()

    # ---- keys
    def key_delete(self, e=None):
        if not self.sel:
            return
        k, i = self.sel
        if k == "dev":
            self.delete_device(self.dev(i))
        elif k == "cable":
            self.delete_cable(self.cable(i))
        elif k == "rack":
            self.delete_rack(self.rack(i))

    def key_esc(self, e=None):
        self.rv.pend = None
        self.rv.cv.delete("ghost")
        self.rv.refresh()
        self.status("")

    def edit_selected(self):
        if not self.sel:
            return
        k, i = self.sel
        {"dev": lambda: self.edit_device(self.dev(i)), "cable": lambda: self.edit_cable(self.cable(i)),
         "rack": lambda: self.edit_rack(self.rack(i))}[k]()

    def auto_arrange(self):
        self.checkpoint()
        self.lv.auto_layout()
        self.redraw()

    # ---- schedule
    def show_schedule(self):
        if self.sched and self.sched.winfo_exists():
            self.sched.lift()
            return
        w = self.sched = tk.Toplevel(self.root)
        w.title("Cable schedule")
        w.geometry("1100x520")
        nb = ttk.Notebook(w)
        nb.pack(fill="both", expand=True)
        f1, f2 = ttk.Frame(nb), ttk.Frame(nb)
        nb.add(f1, text=" Cables ")
        nb.add(f2, text=" Shopping list ")
        cols = ("id", "from", "to", "color", "type", "length", "label", "logical")
        self.st = ttk.Treeview(f1, columns=cols, show="headings")
        for c, wd in zip(cols, (50, 250, 250, 70, 80, 70, 120, 180)):
            self.st.heading(c, text=c.title())
            self.st.column(c, width=wd)
        self.st.pack(fill="both", expand=True)
        self.st.bind("<Double-1>", lambda e: self.st.selection() and self.edit_cable(self.cable(int(self.st.selection()[0]))))
        bt = ttk.Frame(f1)
        bt.pack(fill="x")
        ttk.Button(bt, text="Export CSV…", command=self.export_csv).pack(side="left", padx=4, pady=4)
        ttk.Label(bt, text="Double-click a row to edit").pack(side="left")
        self.sl = ttk.Treeview(f2, columns=("qty", "type", "color", "length"), show="headings")
        for c, wd in zip(("qty", "type", "color", "length"), (60, 150, 120, 120)):
            self.sl.heading(c, text=c.title())
            self.sl.column(c, width=wd)
        self.sl.pack(fill="both", expand=True)
        self.fill_sched()

    def endp(self, pid):
        p, d = self._pidx.get(pid, ({"name": "?"}, {"name": "?", "rack": None}))
        r = self.rack(d["rack"]) if d.get("rack") else None
        loc = "%s %s " % (r["name"], self.u_label(r, d)) if r else "(off-rack) "
        return "%s%s / %s" % (loc, d["name"], p["name"])

    def fill_sched(self):
        self.build_cache()
        self.st.delete(*self.st.get_children())
        tally = {}
        for c in self.doc["cables"]:
            self.st.insert("", "end", iid=str(c["id"]), values=(c["id"], self.endp(c["a"]), self.endp(c["b"]),
                                                                color_name(c["color"]), c.get("type", ""),
                                                                self.fmt_len(c), c.get("label", ""),
                                                                c.get("logical", "")))
            k = (c.get("type", ""), color_name(c["color"]), self.fmt_len(c))
            tally[k] = tally.get(k, 0) + 1
        self.sl.delete(*self.sl.get_children())
        for (t, col, ln), n in sorted(tally.items()):
            self.sl.insert("", "end", values=(n, t, col, ln))

    # ---- files
    def confirm_discard(self):
        if not self.dirty:
            return True
        r = messagebox.askyesnocancel(APP, "Save changes first?")
        if r is None:
            return False
        if r:
            return self.save()
        return True

    def new(self):
        if not self.confirm_discard():
            return
        self.doc = new_doc()
        self.path = None
        self.undo_s.clear()
        self.redo_s.clear()
        self.dirty = False
        self.sel = None
        self.redraw()

    def open(self):
        if not self.confirm_discard():
            return
        p = filedialog.askopenfilename(filetypes=[("Rack design", "*.rack.json *.json"), ("All", "*.*")],
                                       initialdir=self.settings.get("dir"))
        if p:
            self.load(p)

    def load(self, p):
        try:
            with open(p, encoding="utf-8") as f:
                doc = json.load(f)
            for k in ("racks", "devices", "cables"):
                doc.setdefault(k, [])
            ids = [x["id"] for k in ("racks", "devices", "cables") for x in doc[k]] + \
                  [pp["id"] for d in doc["devices"] for pp in d["ports"]]
            doc["nid"] = max(doc.get("nid", 1), max(ids, default=0) + 1)
        except Exception as ex:
            messagebox.showerror(APP, "Couldn't open that file:\n%s" % ex)
            return
        self.doc = doc
        self.path = p
        self.undo_s.clear()
        self.redo_s.clear()
        self.dirty = False
        self.sel = None
        self.settings["dir"] = os.path.dirname(p)
        save_settings(self.settings)
        self.redraw()
        self.rv.fit()

    def save(self, as_new=False):
        p = self.path
        if as_new or not p:
            p = filedialog.asksaveasfilename(defaultextension=".rack.json", initialdir=self.settings.get("dir"),
                                             filetypes=[("Rack design", "*.rack.json"), ("JSON", "*.json")])
            if not p:
                return False
        try:
            with open(p, "w", encoding="utf-8") as f:
                json.dump(self.doc, f, indent=1)
        except Exception as ex:
            messagebox.showerror(APP, "Couldn't save:\n%s" % ex)
            return False
        self.path = p
        self.dirty = False
        self.settings["dir"] = os.path.dirname(p)
        save_settings(self.settings)
        self.title()
        self.status("Saved " + p)
        return True

    def export_svg(self, view):
        p = filedialog.asksaveasfilename(defaultextension=".svg", filetypes=[("SVG image", "*.svg")],
                                         initialdir=self.settings.get("dir"))
        if p and view.export_svg(p):
            self.status("Exported " + p + " (open in a browser to view/print)")

    def export_csv(self):
        p = filedialog.asksaveasfilename(defaultextension=".csv", filetypes=[("CSV", "*.csv")],
                                         initialdir=self.settings.get("dir"))
        if not p:
            return
        self.build_cache()
        with open(p, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f)
            w.writerow(["ID", "From", "To", "Color", "Type", "Length", "Unit", "Label", "Logical connection", "Notes"])
            for c in self.doc["cables"]:
                w.writerow([c["id"], self.endp(c["a"]), self.endp(c["b"]), color_name(c["color"]), c.get("type", ""),
                            c.get("length", ""), c.get("unit", ""), c.get("label", ""), c.get("logical", ""),
                            c.get("notes", "")])
        self.status("Exported " + p)

    def export_devices(self):
        p = filedialog.asksaveasfilename(defaultextension=".csv", filetypes=[("CSV", "*.csv")],
                                         initialdir=self.settings.get("dir"))
        if not p:
            return
        with open(p, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f)
            w.writerow(["Rack", "U", "Name", "Type", "Model", "Height U", "IP", "Serial", "Ports", "Notes"])
            for d in self.doc["devices"]:
                r = self.rack(d["rack"]) if d.get("rack") else None
                w.writerow([r["name"] if r else "(off-rack)", self.u_label(r, d) if r else "", d["name"],
                            d.get("type", ""), d.get("model", ""), d["u_size"], d.get("ip", ""),
                            d.get("serial", ""), len(d["ports"]), d.get("notes", "")])
        self.status("Exported " + p)

    def quit(self):
        if not self.confirm_discard():
            return
        self.settings["geometry"] = self.root.geometry()
        save_settings(self.settings)
        self.root.destroy()

    # ---- text import
    ITEM = re.compile(r"^\s*(?:[-*•–]+\s*)?(.+?)\s*[-–—:]*\s*\(\s*(\d+)\s*U\s*\)\s*(.*)$", re.I)
    EMPTY = re.compile(r"^(open|empty|free|spare|vacant|available)\b", re.I)

    @classmethod
    def parse_rack_text(cls, text):
        racks = []
        for line in text.splitlines():
            if not line.strip():
                continue
            m = cls.ITEM.match(line)
            if m:
                if not racks:
                    racks.append({"name": "Rack 1", "items": []})
                name = m.group(1).strip(" -–—")
                tail = (m.group(3) + " " + name).lower()
                if re.search(r"\b(rear|back)\b", tail):
                    face = "rear"
                elif "full depth" in tail:
                    face = "both"
                else:
                    face = "front"
                racks[-1]["items"].append((name, int(m.group(2)), face))
            else:
                racks.append({"name": line.strip().strip("-:* "), "items": []})
        return [r for r in racks if r["items"]]

    def real_match(self, n, u):
        pool = [t for t in BUILTIN if t.get("plate")]
        pick = None
        if re.search(r"poweredge|dell|\br\d{3,4}(xd|xs)?\b", n) and not re.search(r"\bdell\s+(switch|pdu)", n):
            m = re.search(r"\br(\d{3,4})(xd|xs)?\b", n)
            cands = [t for t in pool if t["plate"]["k"] == "dell"]
            if m:
                key = "r" + m.group(1) + (m.group(2) or "")
                c2 = [t for t in cands if t["short"].lower() == "pe-" + key]
                c2.sort(key=lambda t: t["plate"]["bays"])
                pick = c2[0] if c2 else None
            if not pick and ("poweredge" in n or "dell" in n or m):
                pick = next((t for t in cands if t["short"] == ("PE-R650" if u == 1 else "PE-R750")), None)
        elif re.search(r"dream\s*router|\budr7?\b", n):
            pick = next(t for t in pool if t["short"] == ("UDR7" if "7" in n else "UDR"))
        elif re.search(r"\bu[67]-?(lite|pro|\+|enterprise|max)|access\s*point|\buap\b|nanohd|\bap\d*\b", n):
            key = re.sub(r"[^a-z0-9+]", "", n)
            pick = next((t for t in pool if t["plate"]["k"] == "uap" and
                         t["short"].lower().replace("-", "") in key), None) or \
                next(t for t in pool if t["short"] == "U7-Pro")
        elif re.search(r"unifi|usw|ubiquiti", n):
            cands = [t for t in pool if t["plate"]["k"] == "unifi"]
            pick = next((t for t in cands if t["model"] == ("UniFi Switch Pro 48" if "48" in n else
                                                          "UniFi Switch Pro 24")), cands[0])
        elif re.search(r"synology|\bds\d{3}|\brs\d{3,4}", n):
            rack = re.search(r"\brs\d{3,4}", n) or u <= 2 and "synology" in n and u > 0 and "ds" not in n
            cands = [t for t in pool if t["plate"]["k"] == ("syn_rack" if rack else "syn_desk")]
            m = re.search(r"\b(ds|rs)(\d{3,4})(rp)?(\+)?", n)
            if m:
                key = (m.group(1) + m.group(2) + (m.group(3) or "") + (m.group(4) or "")).upper()
                pick = next((t for t in cands if t["short"] == "NAS-" + key), None)
            if not pick:
                pick = next((t for t in cands if u == t["u_size"]), cands[0])
        if not pick:
            return None
        t = copy.deepcopy(pick)
        if not t.get("half"):
            t["u_size"] = u
        return t

    def smart_template(self, name, u):
        n = name.lower()

        def mk(typ, color, plist):
            return {"name": name, "type": typ, "u_size": u, "color": color, "ports": plist, "half": False, "rows": 0}
        hit = self.real_match(n, u)
        if hit:
            return hit
        if re.search(r"cable\s*(mgmt|manage|mgr)|wire\s*manage|cbl", n):
            return mk("Cable manager", "#222428", [])
        if re.search(r"blank|filler", n):
            return mk("Blank", "#33363b", [])
        if "fiber" in n:
            return mk("Patch panel", "#a8925a", ports("{n}", 12 * u, "Fiber LC"))
        if re.search(r"panel|\bpp\b|^pp-", n):
            return mk("Patch panel", "#9aa3ad", ports("{n}", 24 * u, "RJ45"))
        if re.search(r"apc|ups|battery", n):
            return mk("UPS", "#222428", ports("Out{n}", 6, "Power"))
        if "pdu" in n or "power strip" in n:
            return mk("PDU", "#222428", ports("Out{n}", 8, "Power"))
        if re.search(r"firewall|\bfw\b|fortigate|palo|sonicwall", n):
            return mk("Firewall", "#b24040", ports("{n}", 8, "RJ45") + ports("SFP+{n}", 2, "SFP+"))
        if re.search(r"router|\brtr\b", n):
            return mk("Router", "#2f8f8f", ports("Gi0/{n}", 4, "RJ45", 0))
        if re.search(r"\bnas\b|storage|\bsan\b", n):
            return mk("Storage", "#7456a8", ports("LAN{n}", 2, "RJ45") + ports("PSU{n}", 2, "Power"))
        if re.search(r"server|\bsrv\b|\bhv\b|esx|host", n):
            return mk("Server", "#4b5563", ports("NIC{n}", 4, "RJ45") + ports("PSU{n}", 2, "Power"))
        if re.search(r"stk|stack|switch|\bsw\d*\b|\bidf\b|\bmdf\b", n):
            return mk("Switch", "#3b6ea8", ports("{n}", 48 if u >= 2 else 24, "RJ45") + ports("SFP{n}", 4, "SFP+"))
        if "shelf" in n:
            return mk("Shelf", "#4b5563", [])
        return mk("Other", "#4b5563", [])

    def import_list(self):
        w = tk.Toplevel(self.root)
        w.title("Import rack list")
        w.transient(self.root)
        w.geometry("560x520")
        ttk.Label(w, justify="left", padding=8, text=(
            "Paste a list, top of rack first. Example:\n  Rack1\n  - Panel A - (2U)\n  - Cable management - (2U)\n"
            "  - Open - (12U)\n  - APC 1 - (2U)\nNames like Open/Empty/Free leave a gap. Add the word rear to a "
            "line to mount it on the back.")).pack(anchor="w")
        txt = tk.Text(w, wrap="none", undo=True)
        txt.pack(fill="both", expand=True, padx=8)
        row = ttk.Frame(w, padding=8)
        row.pack(fill="x")
        total = tk.StringVar(value="0")
        ttk.Label(row, text="Rack height (U, 0 = size to the list):").pack(side="left")
        ttk.Entry(row, textvariable=total, width=5).pack(side="left", padx=4)

        def from_file():
            p = filedialog.askopenfilename(parent=w, filetypes=[("Text", "*.txt"), ("All", "*.*")])
            if p:
                txt.delete("1.0", "end")
                txt.insert("1.0", open(p, encoding="utf-8-sig", errors="replace").read())

        def go():
            try:
                h = int(total.get() or 0)
            except ValueError:
                h = 0
            if self.build_from_text(txt.get("1.0", "end"), h):
                w.destroy()
            else:
                messagebox.showerror(APP, "No rack lines found. Each line needs a size like (2U).", parent=w)
        ttk.Button(row, text="Build racks", command=go).pack(side="right")
        ttk.Button(row, text="Load file...", command=from_file).pack(side="right", padx=6)

    def build_from_text(self, text, height=0):
        parsed = self.parse_rack_text(text)
        if not parsed:
            return 0
        self.checkpoint()
        x = max([self.rack_rect(r)[2] for r in self.doc["racks"]], default=-170) + 170
        for pr in parsed:
            total = sum(u for _, u, _ in pr["items"])
            r = {"id": self.nid(), "name": pr["name"], "u": max(total, height or 0), "x": x, "y": 0,
                 "numbering": "up", "color": "#3a3d42", "notes": ""}
            self.doc["racks"].append(r)
            x += RW + 2 * RAIL + 90
            top = r["u"]
            for name, u, face in pr["items"]:
                if self.EMPTY.match(name.strip()):
                    top -= u
                    continue
                d = self.from_tpl(self.smart_template(name, u))
                d.update(rack=r["id"], u=top - u + 1, face="both" if d.get("plate") and face == "front" else face, name=name)
                self.doc["devices"].append(d)
                top -= u
            self.cur_rack = r["id"]
        self.sel = None
        self.redraw()
        self.rv.fit()
        self.status("Imported %d rack(s). Double-click any device to refine its type and ports." % len(parsed))
        return len(parsed)

    # ---- sample
    def load_sample(self):
        if not self.confirm_discard():
            return
        self.doc = new_doc()
        self.path = None
        t = {x["name"]: x for x in BUILTIN}
        r = {"id": self.nid(), "name": "Main Rack", "u": 24, "x": 0, "y": 0, "numbering": "up",
             "color": "#3a3d42", "notes": "Server room"}
        self.doc["racks"].append(r)

        def put(name, u, label=None, **kw):
            d = self.from_tpl(t[name])
            d.update(rack=r["id"], u=u, name=label or name, **kw)
            self.doc["devices"].append(d)
            return d
        pp = put("Patch panel 24 1U", 24, "PP-A")
        fw = put("Firewall 1U", 23, "FW-01", ip="10.0.0.1")
        sw = put("Switch 48-port 1U", 22, "CORE-SW1", ip="10.0.0.2")
        sv = put("Server 2U", 19, "HV-01", ip="10.0.0.10")
        nas = put("NAS 2U", 17, "NAS-01", ip="10.0.0.20")
        put("UPS 2U", 1, "UPS-01")
        isp = self.from_tpl(t["Modem / ISP demarc (half)"])
        isp.update(rack=None, fx=-RW / 2 - 170, fy=140, name="ISP Modem")
        self.doc["devices"].append(isp)

        def cab(da, pa, db, pb, color, length, logical, typ="Cat6"):
            f = next(p for p in da["ports"] if p["name"] == pa)
            g = next(p for p in db["ports"] if p["name"] == pb)
            self.doc["cables"].append({"id": self.nid(), "a": f["id"], "b": g["id"], "color": color, "style": "solid",
                                       "type": typ, "length": length, "unit": "ft", "label": "", "logical": logical,
                                       "notes": ""})
        cab(isp, "WAN", fw, "1", "#f5d000", 5, "WAN")
        cab(fw, "SFP+1", sw, "SFP1", "#e5372b", 3, "Trunk", "DAC")
        cab(sw, "1", sv, "NIC1", "#1f6feb", 3, "VLAN 10")
        cab(sw, "2", nas, "LAN1", "#2ea043", 3, "VLAN 20 storage")
        cab(sw, "3", pp, "1", "#f08c00", 7, "To office drop 1")
        self.dirty = True
        self.redraw()
        self.rv.fit()


def main():
    root = tk.Tk()
    app = App(root)
    import sys
    if len(sys.argv) > 1 and os.path.isfile(sys.argv[1]):
        app.load(sys.argv[1])
    root.mainloop()


if __name__ == "__main__":
    main()
