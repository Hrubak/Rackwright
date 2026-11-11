//! Rack/device/port geometry in world pixels (same constants as the Python app).
use crate::model::*;
use std::collections::HashMap;

pub const UH: f64 = 26.0;
pub const RW: f64 = 480.0;
pub const RAIL: f64 = 24.0;
pub const HDR: f64 = 46.0;
pub const PADB: f64 = 10.0;

#[derive(Clone, Copy, Debug)]
pub struct Rect {
    pub l: f64,
    pub t: f64,
    pub r: f64,
    pub b: f64,
}
impl Rect {
    pub fn cx(&self) -> f64 {
        (self.l + self.r) / 2.0
    }
}

pub fn rack_rect(r: &Rack) -> Rect {
    Rect { l: r.x, t: r.y, r: r.x + RW + 2.0 * RAIL, b: r.y + HDR + r.u as f64 * UH + PADB }
}

pub fn dev_rect(doc: &Doc, d: &Device) -> Rect {
    let w = if d.half { RW / 2.0 } else { RW };
    let size = d.u_size.max(1) as f64;
    if let Some(r) = d.rack.and_then(|id| doc.racks.iter().find(|r| r.id == id)) {
        let top = r.y + HDR + (r.u - (d.u + d.u_size - 1)) as f64 * UH;
        let left = r.x + RAIL + if d.half && d.side == 1 { RW / 2.0 } else { 0.0 };
        Rect { l: left, t: top, r: left + w, b: top + size * UH }
    } else {
        Rect { l: d.fx, t: d.fy, r: d.fx + w, b: d.fy + size * UH }
    }
}

pub fn container(doc: &Doc, d: &Device) -> Rect {
    match d.rack.and_then(|id| doc.racks.iter().find(|r| r.id == id)) {
        Some(r) => rack_rect(r),
        None => dev_rect(doc, d),
    }
}

#[derive(Clone, Copy, Debug)]
pub struct PortPos {
    pub x: f64,
    pub y: f64,
    pub s: f64,
}

fn plate_kind(d: &Device) -> &str {
    d.plate.as_ref().and_then(|p| p.get("k")).and_then(|k| k.as_str()).unwrap_or("")
}

/// Centre of every port on a device (same layout rules as the Python `port_geom`).
pub fn port_geom(doc: &Doc, d: &Device) -> Vec<(i64, PortPos)> {
    let n = d.ports.len();
    if n == 0 {
        return vec![];
    }
    let rc = dev_rect(doc, d);
    let (w, h) = (rc.r - rc.l, rc.b - rc.t);
    let rows = (n as i64).min(if d.rows > 0 { d.rows } else { (d.u_size * 2).max(1) }) as usize;
    let cols = (n + rows - 1) / rows;
    let labw = (w * 0.3).min(150.0);
    let (cell, x0);
    if matches!(plate_kind(d), "dell" | "syn_rack" | "syn_desk" | "udr" | "uap" | "gen") {
        cell = ((h - 4.0) / rows as f64).min(14.0);
        x0 = rc.r - 8.0 - cols as f64 * cell;
    } else {
        let area = w - labw - 12.0;
        cell = (area / cols as f64).min((h - 4.0) / rows as f64).min(22.0);
        x0 = rc.l + labw + 6.0 + (area - cols as f64 * cell) / 2.0;
    }
    let y0 = rc.t + (h - rows as f64 * cell) / 2.0;
    let s = (cell - 3.0).max(4.0);
    d.ports
        .iter()
        .enumerate()
        .map(|(i, p)| {
            (
                p.id,
                PortPos {
                    x: x0 + (i / rows) as f64 * cell + cell / 2.0,
                    y: y0 + (i % rows) as f64 * cell + cell / 2.0,
                    s,
                },
            )
        })
        .collect()
}

pub fn port_index(doc: &Doc) -> HashMap<i64, (PortPos, usize)> {
    let mut m = HashMap::new();
    for (di, d) in doc.devices.iter().enumerate() {
        for (pid, pp) in port_geom(doc, d) {
            m.insert(pid, (pp, di));
        }
    }
    m
}
