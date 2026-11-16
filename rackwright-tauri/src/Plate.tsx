import React from "react";
import { Device, Port } from "./types";

/** Port of the Python faceplate art (front and rear chassis, port sockets). SVG only. */
export function lum(h: string): number {
  const m = /^#?([0-9a-f]{6})/i.exec(h || "");
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}
export const fgFor = (h: string) => (lum(h) > 0.6 ? "#111111" : "#ffffff");
export function shade(h: string, d: number): string {
  const m = /^#?([0-9a-f]{6})/i.exec(h || "");
  if (!m) return h;
  const n = parseInt(m[1], 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, v + d)));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
}

export interface PlateResult { nodes: React.ReactNode[]; lx: number; labw: number; fg: string }
type Pg = [number, number, number][]; // cx, cy, size

export function drawPlate(d: Device, l: number, t: number, r: number, b: number, pg: Pg, rear: boolean, z: number): PlateResult {
  const p = d.plate; const k = p.k; const h = b - t;
  const pl = Math.min(...pg.map(([cx, , s]) => cx - s / 2), r - 8) - 6;
  const nodes: React.ReactNode[] = [];
  let n = 0;
  const rc = (x0: number, y0: number, x1: number, y1: number, fill: string, out = "none") =>
    nodes.push(<rect key={n++} x={x0} y={y0} width={Math.max(0, x1 - x0)} height={Math.max(0, y1 - y0)} fill={fill} stroke={out} strokeWidth={0.8} />);
  const ov = (cx: number, cy: number, rad: number, fill: string, out = "none") =>
    nodes.push(<circle key={n++} cx={cx} cy={cy} r={rad} fill={fill} stroke={out} strokeWidth={0.8} />);
  const ln = (x0: number, y0: number, x1: number, y1: number, c: string) =>
    nodes.push(<line key={n++} x1={x0} y1={y0} x2={x1} y2={y1} stroke={c} strokeWidth={0.8} />);
  const tx = (x: number, y: number, s: string, size: number, fill: string, bold = false, anchor: "w" | "e" | "center" = "w") => {
    if (z < 0.7) return;
    const lines = s.split("\n");
    nodes.push(<text key={n++} x={x} y={y - (lines.length - 1) * size * 0.6} fill={fill} fontSize={size * 1.3} fontWeight={bold ? 700 : 400}
      textAnchor={anchor === "w" ? "start" : anchor === "e" ? "end" : "middle"} dominantBaseline="central" style={{ pointerEvents: "none" }}>
      {lines.map((ls, i) => <tspan key={i} x={x} dy={i ? size * 1.3 : 0}>{ls}</tspan>)}</text>);
  };
  const vents = (x0: number, y0: number, x1: number, y1: number, fill: string, step = 5) => {
    for (let x = x0; x < x1; x += step) ln(x, y0, x, y1, fill);
  };
  const bays = (x0: number, x1: number, brandLight: string) => {
    const cnt = p.bays, rows = p.brows || 1, cols = Math.ceil(cnt / rows), g = 2;
    const bw = (x1 - x0 - g * (cols - 1)) / cols, bh = (h - 10 - g * (rows - 1)) / rows;
    rc(x0 - 3, t + 3, x1 + 3, b - 3, "#0c0d0f", "#3a3d42");
    for (let i = 0; i < cnt; i++) {
      const cx = x0 + (i % cols) * (bw + g), cy = t + 5 + Math.floor(i / cols) * (bh + g);
      rc(cx, cy, cx + bw, cy + bh, "#24262a", "#5b6068");
      rc(cx + 2, cy + 2, cx + bw - 2, cy + bh - 2, "#17181b", "#2f3237");
      if (p.size === "2.5" && bh > 18) rc(cx + 3, cy + bh - 6, cx + bw - 3, cy + bh - 3, brandLight);
      else if (bw >= 18) { ov(cx + 4, cy + 4, 1.4, "#3ddc5b"); ln(cx + 8, cy + bh / 2, cx + bw - 4, cy + bh / 2, "#3d4046"); }
    }
  };
  const ear = (led: string) => {
    rc(l + 1, t + 1, l + 31, b - 1, "#34373c", "#4a4e54");
    ov(l + 15, t + h * 0.3, 4.5, "#14151a", "#c9ced4");
    ov(l + 15, t + h * 0.3, 1.5, "#3ddc5b");
    ov(l + 9, t + h * 0.62, 1.6, led);
    ov(l + 21, t + h * 0.62, 1.6, "#ffb020");
  };
  const rearServer = (psus: number) => {
    rc(l + 1, t + 1, r - 1, b - 1, "#2c2e33", "#4a4e54");
    const ph = h > 30 ? (h - 6) / psus : h - 6;
    for (let i = 0; i < psus; i++) {
      let x0, y0, x1, y1;
      if (h > 30) { x0 = l + 4; y0 = t + 3 + i * ph; x1 = l + 64; y1 = t + 3 + (i + 1) * ph - 2; }
      else { x0 = l + 4 + i * 62; y0 = t + 3; x1 = l + 62 + i * 62; y1 = b - 3; }
      rc(x0, y0, x1, y1, "#1a1b1e", "#6b717a");
      ov(x0 + 9, (y0 + y1) / 2, 3, "#3ddc5b");
      vents(x0 + 18, y0 + 4, x1 - 4, y1 - 4, "#33363b", 3);
    }
    const x0 = l + (h > 30 ? 68 : 4 + psus * 62 + 4);
    const slots = Math.max(1, Math.floor((pl - 8 - x0) / 60));
    const sw = (pl - 8 - x0) / slots;
    for (let i = 0; i < slots; i++) {
      rc(x0 + i * sw + 1, t + 4, x0 + (i + 1) * sw - 1, b - 4, "#202226", "#454950");
      rc(x0 + i * sw + 4, t + 7, x0 + (i + 1) * sw - 4, t + 10, "#0c0d0f");
      vents(x0 + i * sw + 4, t + 14, x0 + (i + 1) * sw - 4, b - 8, "#2e3136", 3);
    }
  };
  const done = (lx: number, labw: number, fg: string): PlateResult => ({ nodes, lx, labw, fg });
  const psus = d.ports.filter((q: Port) => q.type === "Power").length || 1;

  if (k === "dell") {
    if (!rear) {
      ear("#4aa3ff"); tx(l + 15, b - 6, "DELL", 6, "#c9ced4", true, "center");
      bays(l + 156, pl - 4, "#6b717a"); vents(l + 34, b - 5, l + 150, b - 3, "#2d3035", 3);
      return done(l + 34, 120, "#e6e8eb");
    }
    rearServer(psus); return done(l + 6, 54, "#e6e8eb");
  }
  if (k === "syn_rack") {
    if (!rear) { ear("#3ddc5b"); bays(l + 156, pl - 4, "#6b717a"); tx(l + 34, b - 6, "Synology", 6.5, "#9aa0a6", true); return done(l + 34, 120, "#e6e8eb"); }
    rearServer(psus); return done(l + 6, 54, "#e6e8eb");
  }
  if (k === "unifi") {
    rc(l + 1, t + 1, r - 1, b - 1, "#dfe2e6", "#9aa0a6");
    rc(l + 1, t + 1, l + 6, b - 1, "#b7bcc3"); rc(r - 6, t + 1, r - 1, b - 1, "#b7bcc3"); rc(l + 6, b - 4, r - 6, b - 2, "#c4c8ce");
    if (!rear) {
      ov(l + 143, t + h / 2, 4, "#ffffff", "#2a6fdb"); ov(l + 143, t + h / 2, 1.8, "#2a6fdb");
      if (p.lcd) {
        rc(l + 104, t + h / 2 - 7, l + 134, t + h / 2 + 7, "#0f1114", "#555a62");
        ln(l + 108, t + h / 2 - 2, l + 126, t + h / 2 - 2, "#2a6fdb"); ln(l + 108, t + h / 2 + 3, l + 120, t + h / 2 + 3, "#5a6068");
      }
      return done(l + 10, p.lcd ? 92 : 128, "#23262b");
    }
    rc(l + 10, t + 4, r - 10, b - 4, "#cfd3d8", "#9aa0a6");
    vents(l + 150, t + 6, r - 150, b - 6, "#a3a8af", 4);
    rc(l + 14, t + 6, l + 50, b - 6, "#15171a", "#5b6068"); rc(l + 20, t + 10, l + 44, b - 10, "#0c0d0f");
    tx(l + 56, t + h / 2, "AC", 7, "#23262b", true); ov(l + 84, t + h / 2, 2.5, "#8b9097", "#555a62");
    rc(l + 96, t + 9, l + 116, b - 9, "#15171a", "#5b6068");
    for (const fx of [r - 130, r - 70]) { ov(fx, t + h / 2, 10, "#b3b8bf", "#555a62"); ov(fx, t + h / 2, 3, "#555a62"); }
    tx(r - 22, t + h / 2, "REAR", 6, "#23262b", true, "center");
    return done(l + 10, 80, "#23262b");
  }
  if (k === "syn_desk") {
    rc(l + 1, t + 1, r - 1, b - 1, "#202226", "#3a3d42");
    const bx = l + 112, by = t + 4, bw = 84, bh = h - 8;
    rc(bx, by, bx + bw, by + bh, "#2d2f33", "#6b717a");
    if (!rear) {
      const tw = (bw - 12 - 6) / 4;
      for (let i = 0; i < 4; i++) {
        const x0 = bx + 6 + i * (tw + 2);
        rc(x0, by + 7, x0 + tw, by + bh - 28, "#17181b", "#4a4e54"); rc(x0 + 1, by + bh - 36, x0 + tw - 1, by + bh - 29, "#3a3d42");
        ov(x0 + tw / 2, by + bh - 22, 1.6, "#3ddc5b");
      }
      ov(bx + 11, by + bh - 9, 3.5, "#14151a", "#c9ced4"); ov(bx + 11, by + bh - 9, 1.2, "#3ddc5b");
      tx(bx + 22, by + bh - 9, "Synology", 6.5, "#9aa0a6", true);
    } else {
      ov(bx + bw / 2, by + bh * 0.33, 30, "#1b1c1f", "#6b717a"); ov(bx + bw / 2, by + bh * 0.33, 20, "#25272b", "#4a4e54"); ov(bx + bw / 2, by + bh * 0.33, 5, "#6b717a");
      rc(bx + 6, by + bh - 24, bx + 36, by + bh - 6, "#111214", "#6b717a"); rc(bx + 42, by + bh - 24, bx + 56, by + bh - 6, "#111214", "#6b717a");
      rc(bx + 60, by + bh - 24, bx + 78, by + bh - 6, "#111214", "#6b717a");
      tx(bx + bw / 2, by + 5, "REAR", 6, "#9aa0a6", true, "center");
    }
    return done(l + 6, 104, "#e6e8eb");
  }
  if (k === "gen") {
    const st = p.style, bc = p.bc, body = p.body, lab = p.lab, brand = p.brand;
    const dark = lum(body) < 0.43;
    const edge = dark ? "#4a4e54" : "#9aa0a6", back = dark ? "#0b0c0e" : "#14161a", cy = t + h / 2;
    const side = shade(body, dark ? 25 : -25);
    rc(l + 1, t + 1, r - 1, b - 1, body, edge); rc(l + 1, b - 4, r - 1, b - 1, bc);
    rc(l + 1, t + 1, l + 5, b - 1, side); rc(r - 5, t + 1, r - 1, b - 1, side);
    if (st === "sw" || st === "fw") {
      const room = pl - l - 12;
      if (!rear) {
        rc(pl, t + 3, r - 3, b - 4, back, "#3a3d42");
        if (room >= 150) tx(pl - 4, cy - 1, brand, 7, bc, true, "e");
        else if (h >= 30) ov(l + 11, b - 8, 1.6, "#3ddc5b");
        if (p.poe && room >= 150 && h >= 30) tx(pl - 4, cy + 9, "PoE", 6, lab, false, "e");
        if (p.kit) { rc(l + 6, t + 3, l + 9, b - 4, "#b7bcc3"); if (room >= 150) tx(l + 14, cy, "MOUNT KIT", 5.5, "#9aa0a6", true); }
        return done(l + 10, Math.max(50, room - (room >= 150 ? 52 : 0)), lab);
      }
      rc(l + 10, t + 4, l + 54, b - 4, "#15171a", "#5b6068"); rc(l + 15, t + 8, l + 49, b - 8, "#0c0d0f"); ov(l + 32, cy, 2.4, "#3ddc5b");
      vents(l + 64, t + 6, Math.max(l + 66, pl - 40), b - 8, shade(body, dark ? 30 : -35), 4);
      for (const fx of [pl - 28, pl - 10]) if (fx - 7 > l + 66) { ov(fx, cy, 6.5, shade(body, dark ? 20 : -25), "#555a62"); ov(fx, cy, 2, "#555a62"); }
      rc(pl, t + 3, r - 3, b - 4, back, "#3a3d42");
      return done(l + 10, Math.max(50, room - 10), lab);
    }
    if (st === "nuc") {
      // Scale Computing edge node on a shelf (SNUC chassis). SFP+/LAN/DC-in sockets come from the port grid on the right;
      // all other front and rear I/O here is decorative art.
      const he250 = p.nuc === "he250", ax = l + 104, ae = pl - 2;
      rc(l + 1, t + 1, r - 1, b - 1, "#17181b", "#4a4e54"); rc(l + 1, b - 4, r - 1, b - 1, "#0f1012");
      const usbA = (x: number, y: number, c: string) => { rc(x, y - 3, x + 9, y + 3, "#0c0d0f", "#6b717a"); rc(x + 1, y - 0.5, x + 8, y + 1.5, c); };
      const usbC = (x: number, y: number) => rc(x, y - 2, x + 8, y + 2, "#0c0d0f", "#8b9097");
      const hdmi = (x: number, y: number) => rc(x, y - 2.5, x + 13, y + 2.5, "#0c0d0f", "#8b9097");
      const jack = (x: number, y: number) => ov(x, y, 2.6, "#0c0d0f", "#8b9097");
      const slots = (x0: number, y0: number, x1: number, y1: number) => { for (let x = x0; x < x1; x += 4) ln(x, y1, Math.min(x + 6, x1), y0, "#2f3237"); };
      if (!rear) {
        tx(ax, t + 8, p.brand, 4.8, "#9aa0a6", true); tx(ax, t + 16, p.mdl, 6, bc, true);
        const y = b - 9;
        if (he250) {
          rc(ax, y - 4, ax + 12, y + 4, "#14151a", "#c9ced4"); ov(ax + 6, y, 1.2, "#3ddc5b"); // power button
          jack(ax + 19, y); usbA(ax + 25, y, "#2a6fdb"); usbA(ax + 36, y, "#2b2e33"); usbA(ax + 47, y, "#2b2e33");
          slots(ax + 60, t + 5, ae, b - 6);                                                  // diagonal vent grille
        } else {
          ov(ax + 3, y, 1.4, "#3ddc5b"); ln(ax + 8, y, ax + 12, y, "#6b717a");                 // LED and icons
          usbA(ax + 16, y, "#2b2e33"); usbA(ax + 27, y, "#2a6fdb"); jack(ax + 43, y);
          rc(ax + 50, y - 4, ax + 62, y + 4, "#14151a", "#c9ced4"); ov(ax + 56, y, 1.2, "#3ddc5b"); // power button
        }
        return done(l + 8, 94, lab);
      }
      const y1 = t + 12, y2 = t + 22, y3 = b - 9;
      if (he250) {
        rc(ax, t + 5, ax + 38, t + 11, "#25272b", "#4a4e54");                                // PCIe slot cover
        for (let gx = ae - 26; gx < ae; gx += 5) for (let gy = t + 5; gy < t + 14; gy += 4) rc(gx, gy, gx + 2.5, gy + 2.2, "#0c0d0f"); // vent grid
        usbC(ax, y3 - 3); usbC(ax, y3 + 3); hdmi(ax + 12, y3);
        usbA(ax + 29, y3 - 3.5, "#2a6fdb"); usbA(ax + 29, y3 + 3.5, "#2a6fdb");
      } else {
        rc(ax, t + 4, ax + 6, t + 8, "#0c0d0f", "#8b9097");                                  // Kensington slot
        usbC(ax + 10, y1); hdmi(ax + 10, y2 + 1);
        usbA(ax + 26, y1, "#2a6fdb"); usbA(ax + 26, y2 + 1, "#2a6fdb");
        usbC(ax + 40, y1); hdmi(ax + 40, y2 + 1);
        rc(ax, b - 10, ae, b - 6, "#25272b", "#4a4e54");                                     // blank expansion plate
      }
      return done(l + 8, 94, lab);
    }
    if (st === "ap") {
      if (!rear) { ov(l + 15, cy, 9.5, "#ffffff", "#9aa0a6"); ov(l + 15, cy, 6.5, body, bc); ov(l + 15, cy, 2, bc); return done(l + 30, 150, lab); }
      ov(l + 15, cy, 9.5, shade(body, -20), "#8b9097"); for (const ax of [-4, 4]) ov(l + 15 + ax, cy, 1.4, "#6b717a");
      return done(l + 30, 150, lab);
    }
    if (st === "ups" || st === "bp") {
      if (!rear) {
        tx(l + 10, b - 9, brand, 8, bc, true);
        const x1 = pl - 6;
        if (st === "ups") {
          const lx0 = l + 118;
          rc(lx0, t + 8, lx0 + 62, t + Math.min(h - 22, 36), "#0b1a14", "#6b717a");
          ln(lx0 + 5, t + 15, lx0 + 40, t + 15, bc); ln(lx0 + 5, t + 21, lx0 + 28, t + 21, "#4a5a52");
          for (let i = 0; i < 4; i++) ov(lx0 + 8 + i * 15, b - 11, 3, "#17181b", "#6b717a");
          vents(lx0 + 72, t + 8, x1, b - 8, "#33363b", 4);
        } else {
          const bx0 = l + 118;
          rc(bx0, cy - 11, bx0 + 34, cy + 11, "#17181b", "#6b717a"); rc(bx0 + 34, cy - 4, bx0 + 38, cy + 4, "#6b717a"); rc(bx0 + 4, cy - 7, bx0 + 24, cy + 7, bc);
          tx(bx0 + 48, cy, "BATTERY PACK", 6.5, "#9aa0a6", true);
          vents(bx0 + 130, t + 8, x1, b - 8, "#33363b", 4);
        }
        ov(l + 11, t + 9, 2, "#3ddc5b");
        return done(l + 10, 100, lab);
      }
      const x = l + 62;
      for (let i = 0; i < 2; i++) { ov(x + 12 + i * 30, cy, h > 40 ? 11 : 9, "#1a1b1e", "#555a62"); ov(x + 12 + i * 30, cy, 3, "#555a62"); }
      rc(l + 130, t + 8, l + 160, t + 8 + Math.min(20, h - 16), "#15171a", "#6b717a");
      tx(l + 145, h > 40 ? t + 8 + Math.min(20, h - 16) + 7 : b - 5, "BKR", 5.5, "#9aa0a6", true, "center");
      rc(l + 168, t + 8, l + 202, b - 8, "#15171a", "#6b717a");
      tx(l + 185, cy, h > 40 ? "SMART\nSLOT" : "SLOT", 5.5, "#9aa0a6", true, "center");
      tx(l + 222, cy, "REAR", 6, "#9aa0a6", true, "center");
      return done(l + 8, 50, lab);
    }
    if (st === "pdu") {
      if (!rear) {
        tx(l + 10, b - 8, brand, 7, bc, true);
        rc(l + 130, cy - 7, l + 168, cy + 7, "#0b1a14", "#6b717a"); ln(l + 135, cy, l + 160, cy, bc);
        vents(l + 178, t + 7, pl - 8, b - 7, "#33363b", 4);
        return done(l + 10, 110, lab);
      }
      rc(pl, t + 3, r - 3, b - 4, back, "#3a3d42"); rc(l + 10, cy - 7, l + 56, cy + 7, "#111214", "#6b717a");
      tx(l + 33, cy, "INPUT", 5.5, "#9aa0a6", true, "center");
      return done(l + 10, 100, lab);
    }
  }
  if (k === "udr") {
    rc(l + 1, t + 1, r - 1, b - 1, "#f2f4f6", "#aeb4bb"); rc(l + 1, b - 5, r - 1, b - 1, "#d9dde1");
    const cy = t + h / 2 - 1;
    if (!rear) {
      ov(l + 20, cy, 15, "#ffffff", "#9aa0a6"); ov(l + 20, cy, 11, "#e7eaed", "#2a6fdb"); ov(l + 20, cy, 4, "#2a6fdb");
      vents(l + 118, t + 8, l + 160, b - 9, "#c3c8ce", 4); tx(l + 46, cy, "Dream Router", 7, "#6b717a", true);
      return done(l + 46, 118, "#23262b");
    }
    rc(l + 6, t + 6, l + 44, b - 8, "#d5d9dd", "#aeb4bb"); ov(l + 25, cy, 9, "#c3c8ce", "#8b9097");
    vents(l + 54, t + 8, l + 150, b - 9, "#c3c8ce", 4); tx(l + 100, cy, "REAR", 6, "#6b717a", true, "center");
    return done(l + 54, 100, "#23262b");
  }
  if (k === "uap") {
    rc(l + 1, t + 1, r - 1, b - 1, "#f2f4f6", "#aeb4bb");
    const cy = t + h / 2;
    if (!rear) { ov(l + 15, cy, 9.5, "#ffffff", "#9aa0a6"); ov(l + 15, cy, 6.5, "#f2f4f6", "#2a6fdb"); ov(l + 15, cy, 2, "#2a6fdb"); }
    else { ov(l + 15, cy, 9.5, "#c3c8ce", "#8b9097"); for (const ax of [-4, 4]) ov(l + 15 + ax, cy, 1.4, "#6b717a"); }
    return done(l + 30, 150, "#23262b");
  }
  return done(l + 7, Math.min(150, (r - l) * 0.3), fgFor(d.color || "#3b6ea8"));
}

/** Port socket art. cable = colour of the cable plugged in, if any. */
export function drawPort(key: React.Key, p: Port, cx: number, cy: number, s: number, cable: string | null, plate: boolean,
  pend: boolean, z: number, typeColor: string, onClick: (e: React.MouseEvent) => void): React.ReactNode {
  const h = s / 2, typ = p.type;
  const stroke = pend ? "#00e5ff" : "#5a5f67";
  const sw = pend ? 2.5 : 0.9;
  const R = (x0: number, y0: number, x1: number, y1: number, fill: string, out = "none", w = 0.8, k?: number) =>
    <rect key={k} x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill={fill} stroke={out} strokeWidth={w} />;
  let body: React.ReactNode;
  if (!plate) {
    body = R(cx - h, cy - h, cx + h, cy + h, cable || typeColor, pend ? "#00e5ff" : "#000", pend ? 2.5 : 1);
  } else if (typ === "RJ45" || typ === "Mgmt") {
    const lit = !!cable;
    body = <>
      {R(cx - h, cy - h * 0.9, cx + h, cy + h * 0.95, "#2b2e33", stroke, sw)}
      {R(cx - h * 0.72, cy - h * 0.55, cx + h * 0.72, cy + h * 0.75, cable || "#08090a", "#000")}
      {R(cx - h * 0.35, cy + h * 0.45, cx + h * 0.35, cy + h * 0.95, "#2b2e33")}
      {z * s >= 11 && [-3, -1, 1, 3].map((i) => <line key={i} x1={cx + i * h * 0.17} y1={cy - h * 0.5} x2={cx + i * h * 0.17} y2={cy - h * 0.1} stroke="#c9a227" strokeWidth={0.7} />)}
      {z * s >= 14 && <>{R(cx - h * 0.62 - 1.4, cy - h * 0.86, cx - h * 0.62 + 1.4, cy - h * 0.64, lit ? "#3ddc61" : "#1d3a25")}
        {R(cx + h * 0.62 - 1.4, cy - h * 0.86, cx + h * 0.62 + 1.4, cy - h * 0.64, lit ? "#ffb21e" : "#3d2f12")}</>}
    </>;
  } else if (typ === "SFP" || typ === "SFP+" || typ === "QSFP") {
    body = <>{R(cx - h, cy - h * 0.8, cx + h, cy + h * 0.8, "#a9afb7", stroke, sw)}
      {R(cx - h * 0.75, cy - h * 0.5, cx + h * 0.75, cy + h * 0.5, cable || "#050506", "#43474d")}
      <line x1={cx - h * 0.5} y1={cy + h * 0.8} x2={cx + h * 0.5} y2={cy + h * 0.8} stroke="#e8ebee" strokeWidth={0.8} /></>;
  } else if (typ === "Fiber LC") {
    body = <>{R(cx - h, cy - h * 0.7, cx + h, cy + h * 0.7, "#2b2e33", stroke, sw)}
      {[-h * 0.42, h * 0.42].map((dx) => <circle key={dx} cx={cx + dx} cy={cy} r={h * 0.28} fill={cable || "#d9dde2"} stroke="#000" strokeWidth={0.8} />)}</>;
  } else if (typ === "Power") {
    body = <>{R(cx - h, cy - h * 0.75, cx + h, cy + h * 0.75, "#d7d9dc", stroke, sw)}
      <polygon points={`${cx - h * 0.8},${cy - h * 0.5} ${cx + h * 0.8},${cy - h * 0.5} ${cx + h * 0.6},${cy + h * 0.55} ${cx - h * 0.6},${cy + h * 0.55}`} fill={cable || "#111214"} stroke="#000" strokeWidth={0.8} />
      {[-h * 0.35, 0, h * 0.35].map((dx) => R(cx + dx - 0.9, cy - h * 0.2, cx + dx + 0.9, cy + h * 0.25, "#b0b4ba", "none", 0.8, dx))}</>;
  } else {
    body = <>{R(cx - h, cy - h * 0.7, cx + h, cy + h * 0.7, "#c4c8ce", stroke, sw)}
      {R(cx - h * 0.65, cy - h * 0.35, cx + h * 0.65, cy + h * 0.35, cable || "#101113", typeColor)}</>;
  }
  return (
    <g key={key} style={{ cursor: "crosshair" }} onMouseDown={(e) => e.stopPropagation()} onClick={onClick}>
      {body}
      <rect x={cx - h} y={cy - h} width={s} height={s} fill="transparent" />
      <title>{p.name}</title>
    </g>
  );
}
