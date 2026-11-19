# Loose cable view (3.22.0)

Approved by the user on 2026-11-19, as proposed. Mockup with made-up data: https://claude.ai/artifact/18Fg5R2SLdtXfKBwjJu1sX

## Why

Today's Rack view draws cables neatly routed through the side ducts and the overhead tray. Sometimes you want to see what a rack really looks like: patch cables running straight from port to port with a little sag.

## What

- A third cable **Style**, **loose**, next to routed and stubs. It appears in the canvas overlay (Style dropdown) and in View › Cables. It is saved per browser in the existing `rw.cableOpts` setting, like the other cable choices. An older Rackwright reading `style: "loose"` falls back to routed.
- With loose on, each cable leaves its port the same way as today: the plug is drawn as usual, pointing the same way the router says (`dir_a` / `dir_b`). Then the cable runs as one smooth curve to the other port, with a sag that grows with distance.
- Each cable gets a fixed amount of sag and a slight sideways shift worked out from its id, so a bundle fans out instead of drawing as one thick line, and the shape is the same on every redraw.
- Unchanged: colours and the "by type" mode, plugs, hover dimming, selection outline, click, double-click, tooltip, line widths and click targets, "Show all / selected / none", "Hide endpoint cables" and the end dots.
- Loose draws no ducts, trays or ties (the harness).
- **Off keeps today's drawing exactly.** Routed and stubs are drawn by the same code as before.
- **Exports stay routed.** The rack PDF, the client report pictures and Visio export render the rack with default cable settings, so they never use loose.
- Works the same on web and desktop: the curve comes from the route ends the router already returns. No server, Rust or file-format change.

## Approaches

1. **A third Style choice (chosen).** Loose and stubs can't be on together, and the Style setting already exists and is already saved.
2. A separate on/off box. Rejected: it would need rules for loose plus stubs.
3. Loose curves in the router (Rust). Rejected: the router's job is the routed drawing, and a pure front-end function is easier to test and keeps the server untouched.

## Geometry

`loosePath(a, da, b, db, id): string` in `src/cableView.ts`, pure and unit-tested:

- Leave each port 10 px along its direction (past the plug body).
- One cubic Bézier between those two points. Each control point goes further along its port's direction by `k = clamp(0.35 × distance, 14, 110)`, then down by `sag = clamp(0.16 × distance, 6, 64) × (0.7 to 1.3, fixed per cable id)`, and both shift sideways by the same small amount (up to ±7 px, also fixed per id).
- The path starts exactly at port A and ends exactly at port B. Every number is finite, even when both ports are the same point.

## Left to the builder

Exact jitter hash, test names, where the menu entry sits in View › Cables (after Stubs).
