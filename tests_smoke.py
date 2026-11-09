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

# real equipment: front + rear, import matching, svg
a.doc = R.new_doc(); a.dirty = False
print("imported", a.build_from_text("Rack2\n- Dell PowerEdge R750 - (2U)\n- Dell R650 - (1U)\n- UniFi USW Pro 24 - (1U)\n- Synology RS822+ - (1U)\n- Synology DS923+ - (4U)\n", 0))
for dv in a.doc['devices']:
    print(dv['name'], dv.get('plate'), dv['face'], dv['u_size'])
for face in ("front", "rear"):
    a.rv.face = face; a.redraw()
    print(face, "svg", a.rv.export_svg(os.path.join(tempfile.gettempdir(), "real_%s.svg" % face)))
a.dirty = False
root.destroy()
