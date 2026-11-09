import sys, os, tempfile
sys.path.insert(0, '.')
import tkinter as tk
import rackwright as R
R.SETTINGS = os.path.join(tempfile.gettempdir(), "rw_test.json")
root = tk.Tk()
a = R.App(root)
txt = """Rack1
- Panel A - (2U)
- Cable management - ( 2U )
- Panel B - ( 2U )
- Cable management - ( 2U )
- Panel C - ( 2U )
- Open Space - ( 3U )
- STK1 -  ( 1U )
- STK2 -  ( 1U )
- STK3 -  ( 1U )
- Open - ( 12U )
- APC 1 - ( 2 U )
- Open - ( 2U )
- APC 2 - ( 2U )
- Open - ( 6 U )
- Rear PDU (rear) - (1U)
"""
print("racks", a.build_from_text(txt))
print("height", a.doc['racks'][0]['u'])
for d in a.doc['devices']:
    print(d['name'], d['type'], 'U', d['u'], 'size', d['u_size'], d['face'], 'ports', len(d['ports']))
a.rv.flip(); a.redraw(); a.rv.flip()
a.dirty = False
a.load_sample()
a.nb.select(1); a.redraw(); a.nb.select(0); a.redraw()
d = tempfile.gettempdir()
print("svg", a.rv.export_svg(os.path.join(d, "r.svg")), a.lv.export_svg(os.path.join(d, "l.svg")))
a.dirty = False
root.destroy()
