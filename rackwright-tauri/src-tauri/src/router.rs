//! Orthogonal cable router. Every bend is a true 90 degrees; parallel runs get their own lane
//! (5 px apart, wider than the cable) so no two cables share a line. Horizontal runs happen only on
//! a rack cable manager when one is near, otherwise along the device seam (flagged as a hint),
//! down the rack-side ducts, or across the overhead tray.
use crate::geom::*;
use crate::model::*;
use serde::Serialize;
use std::collections::HashMap;

pub const LANE: f64 = 5.0;
const MAX_DUCT_LANES: usize = 12;
const MAX_TRAY_LANES: usize = 14;
const UNSUPPORTED_RUN: f64 = 90.0;

#[derive(Serialize, Clone, Debug)]
pub struct Route {
    pub cable: i64,
    pub pts: Vec<[f64; 2]>,
    pub mode: String,
    /// direction each plug points away from its port: -1 up, 1 down
    pub dir_a: i32,
    pub dir_b: i32,
}

#[derive(Serialize, Clone, Debug)]
pub struct Hint {
    pub cable: i64,
    pub device: i64,
    pub msg: String,
}

#[derive(Serialize, Default, Clone, Debug)]
pub struct RouteResult {
    pub routes: Vec<Route>,
    pub hints: Vec<Hint>,
}

/// Greedy interval colouring: items sharing a key and overlapping in range get different levels.
fn levels(items: &[(String, f64, f64)]) -> Vec<usize> {
    let mut out = vec![0; items.len()];
    let mut by: HashMap<&str, Vec<(f64, f64, usize)>> = HashMap::new();
    for (n, (k, lo, hi)) in items.iter().enumerate() {
        by.entry(k.as_str()).or_default().push((*lo, *hi, n));
    }
    for lst in by.values_mut() {
        lst.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let mut ends: Vec<f64> = vec![];
        for &(lo, hi, n) in lst.iter() {
            match ends.iter().position(|&e| lo > e + LANE) {
                Some(lv) => {
                    ends[lv] = hi;
                    out[n] = lv;
                }
                None => {
                    ends.push(hi);
                    out[n] = ends.len() - 1;
                }
            }
        }
    }
    out
}

struct End {
    px: f64,
    py: f64,
    di: usize,
    seam: f64,
    dir: i32,
    cont: Rect,
    mgr: bool,
}

struct Job {
    cable: i64,
    a: End,
    b: End,
    mode: u8, // 0 direct, 1 gutter, 2 tray
    ra: bool,
    rb: bool,
    xa: f64,
    xb: f64,
    ty: f64,
    ga: usize,
    gb: usize,
    ha: usize,
    hb: usize,
    jx_a: f64,
    jx_b: f64,
}

pub fn visible(d: &Device, face: &str) -> bool {
    d.rack.is_none() || d.face == face || d.face == "both"
}

fn cont_key(c: &Rect) -> String {
    format!("{:.0},{:.0}", c.l, c.t)
}

/// Racks stacked in one column share the same duct lanes, so key by the side edge's x, not by rack.
fn duct_key(c: &Rect, right: bool) -> String {
    format!("{}:{}", right, ((if right { c.r } else { c.l }) / 6.0).round())
}

pub fn route_all(doc: &Doc, face: &str) -> RouteResult {
    let pidx = port_index(doc);
    let top = doc.racks.iter().map(|r| rack_rect(r).t).fold(f64::INFINITY, f64::min);
    let top = if top.is_finite() { top } else { 0.0 };
    let mut mgrs: HashMap<i64, Vec<f64>> = HashMap::new();
    for d in &doc.devices {
        if let (Some(r), true) = (d.rack, d.dtype == "Cable manager") {
            if visible(d, face) {
                let q = dev_rect(doc, d);
                mgrs.entry(r).or_default().push((q.t + q.b) / 2.0);
            }
        }
    }
    let mut jobs: Vec<Job> = vec![];
    for c in &doc.cables {
        let (Some(&(pa, da)), Some(&(pb, db))) = (pidx.get(&c.a), pidx.get(&c.b)) else { continue };
        if !visible(&doc.devices[da], face) || !visible(&doc.devices[db], face) {
            continue;
        }
        let mk = |pp: PortPos, di: usize| -> End {
            let d = &doc.devices[di];
            let q = dev_rect(doc, d);
            let near = d
                .rack
                .and_then(|r| mgrs.get(&r))
                .and_then(|v| {
                    v.iter()
                        .copied()
                        .filter(|m| (m - pp.y).abs() <= 3.0 * UH && !(q.t < *m && *m < q.b))
                        .min_by(|a, b| (a - pp.y).abs().partial_cmp(&(b - pp.y).abs()).unwrap())
                });
            let (seam, dir, mgr) = match near {
                Some(m) => (m, 0, true),
                None => {
                    if pp.y - q.t <= q.b - pp.y {
                        (q.t, -1, false)
                    } else {
                        (q.b, 1, false)
                    }
                }
            };
            End { px: pp.x, py: pp.y, di, seam, dir, cont: container(doc, d), mgr }
        };
        let (a, b) = (mk(pa, da), mk(pb, db));
        let same = cont_key(&a.cont) == cont_key(&b.cont);
        let mode = if same && (a.seam - b.seam).abs() < 2.5 {
            0
        } else if same {
            1
        } else {
            2
        };
        let (cxa, cxb) = (a.cont.cx(), b.cont.cx());
        let (ra, rb) = if mode == 1 {
            let r = (a.px + b.px) / 2.0 >= cxa;
            (r, r)
        } else {
            (cxb >= cxa, cxa > cxb)
        };
        jobs.push(Job {
            cable: c.id, a, b, mode, ra, rb, xa: 0.0, xb: 0.0, ty: 0.0, ga: 0, gb: 0, ha: 0, hb: 0, jx_a: 0.0,
            jx_b: 0.0,
        });
    }
    // stub x jitter: ports in one column heading the same way would otherwise share a vertical line
    {
        let mut groups: HashMap<String, Vec<(usize, bool, f64)>> = HashMap::new();
        for (n, j) in jobs.iter().enumerate() {
            for (is_a, e) in [(true, &j.a), (false, &j.b)] {
                groups
                    .entry(format!("{}:{}:{}", e.di, e.px.round(), e.dir))
                    .or_default()
                    .push((n, is_a, (e.py - e.seam).abs()));
            }
        }
        for g in groups.values_mut() {
            if g.len() < 2 {
                continue;
            }
            g.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap());
            let k = g.len() as f64;
            for (i, (n, is_a, _)) in g.iter().enumerate() {
                let off = (i as f64 - (k - 1.0) / 2.0) * 3.0;
                if *is_a {
                    jobs[*n].jx_a = off
                } else {
                    jobs[*n].jx_b = off
                }
            }
        }
    }
    // duct lanes (vertical runs beside the racks)
    let mut gi: Vec<(String, f64, f64)> = vec![];
    for j in jobs.iter_mut() {
        if j.mode == 0 {
            continue;
        }
        let far = if j.mode == 2 { top } else { j.b.seam };
        j.ga = gi.len();
        gi.push((duct_key(&j.a.cont, j.ra), j.a.seam.min(far), j.a.seam.max(far)));
        if j.mode == 2 {
            j.gb = gi.len();
            gi.push((duct_key(&j.b.cont, j.rb), j.b.seam.min(top), j.b.seam.max(top)));
        }
    }
    let glv = levels(&gi);
    let ti: Vec<(String, f64, f64)> = jobs
        .iter()
        .filter(|j| j.mode == 2)
        .map(|j| ("t".to_string(), j.a.px.min(j.b.px), j.a.px.max(j.b.px)))
        .collect();
    let tlv = levels(&ti);
    let mut tn = 0;
    let gx = |c: &Rect, right: bool, lv: usize| -> f64 {
        let lv = lv.min(MAX_DUCT_LANES - 1) as f64;
        if right { c.r + 8.0 + lv * LANE } else { c.l - 8.0 - lv * LANE }
    };
    for j in jobs.iter_mut() {
        if j.mode == 0 {
            continue;
        }
        j.xa = gx(&j.a.cont, j.ra, glv[j.ga]);
        if j.mode == 2 {
            j.xb = gx(&j.b.cont, j.rb, glv[j.gb]);
            j.ty = top - 18.0 - tlv[tn].min(MAX_TRAY_LANES - 1) as f64 * LANE;
            tn += 1;
        } else {
            j.xb = j.xa;
        }
    }
    // seam rows (horizontal runs along device edges)
    let mut hi: Vec<(String, f64, f64)> = vec![];
    let key = |e: &End| format!("{}{}{}", cont_key(&e.cont), e.seam.round(), e.dir);
    for j in jobs.iter_mut() {
        j.ha = hi.len();
        if j.mode == 0 {
            hi.push((key(&j.a), j.a.px.min(j.b.px) - 2.0, j.a.px.max(j.b.px) + 2.0));
        } else {
            hi.push((key(&j.a), j.a.px.min(j.xa), j.a.px.max(j.xa)));
            j.hb = hi.len();
            hi.push((key(&j.b), j.b.px.min(j.xb), j.b.px.max(j.xb)));
        }
    }
    let hlv = levels(&hi);
    let off = |level: usize, d: i32| -> f64 {
        if d == 0 {
            ((level + 1) / 2) as f64 * LANE * if level % 2 == 1 { 1.0 } else { -1.0 }
        } else {
            d as f64 * (4.0 + LANE * (level % 8) as f64)
        }
    };
    let mut res = RouteResult::default();
    for j in &jobs {
        let (a, b) = (&j.a, &j.b);
        let (ax, bx) = (a.px + j.jx_a, b.px + j.jx_b);
        let sa = a.seam + off(hlv[j.ha], a.dir);
        let mut p: Vec<[f64; 2]> = vec![[a.px, a.py], [ax, a.py], [ax, sa]];
        if j.mode == 0 {
            p.extend([[bx, sa], [bx, b.py], [b.px, b.py]]);
        } else {
            let sb = b.seam + off(hlv[j.hb], b.dir);
            p.push([j.xa, sa]);
            if j.mode == 2 {
                p.extend([[j.xa, j.ty], [j.xb, j.ty], [j.xb, sb]]);
            } else {
                p.push([j.xa, sb]);
            }
            p.extend([[bx, sb], [bx, b.py], [b.px, b.py]]);
            for (e, x, dx) in [(a, ax, j.xa), (b, bx, j.xb)] {
                // off-rack gear cannot have a cable manager, so only rack-mounted ends get the hint
                if !e.mgr && doc.devices[e.di].rack.is_some() && (x - dx).abs() > UNSUPPORTED_RUN {
                    let d = &doc.devices[e.di];
                    res.hints.push(Hint {
                        cable: j.cable,
                        device: d.id,
                        msg: format!(
                            "{}: cable runs {:.0}px sideways with nothing to support it. Add a cable manager within 3U.",
                            d.name,
                            (x - dx).abs()
                        ),
                    });
                }
            }
        }
        // drop zero-length and collinear points
        let mut q: Vec<[f64; 2]> = vec![];
        for pt in p {
            if let Some(l) = q.last() {
                if (l[0] - pt[0]).abs() < 0.01 && (l[1] - pt[1]).abs() < 0.01 {
                    continue;
                }
            }
            while q.len() >= 2 {
                let (m, l) = (q[q.len() - 1], q[q.len() - 2]);
                if ((l[0] - m[0]).abs() < 0.01 && (m[0] - pt[0]).abs() < 0.01)
                    || ((l[1] - m[1]).abs() < 0.01 && (m[1] - pt[1]).abs() < 0.01)
                {
                    q.pop();
                } else {
                    break;
                }
            }
            q.push(pt);
        }
        let dir_of = |e: &End| if e.dir != 0 { e.dir } else if e.seam >= e.py { 1 } else { -1 };
        res.routes.push(Route {
            cable: j.cable,
            pts: q,
            mode: ["direct", "gutter", "tray"][j.mode as usize].into(),
            dir_a: dir_of(a),
            dir_b: dir_of(b),
        });
    }
    res
}

#[cfg(test)]
mod tests {
    use super::*;

    fn overlaps(r: &RouteResult) -> Vec<String> {
        let mut segs: Vec<(i64, bool, f64, f64, f64)> = vec![]; // cable, vertical, fixed, lo, hi
        for rt in &r.routes {
            for w in rt.pts.windows(2) {
                let (a, b) = (w[0], w[1]);
                if (a[0] - b[0]).abs() < 0.01 {
                    segs.push((rt.cable, true, a[0], a[1].min(b[1]), a[1].max(b[1])));
                } else if (a[1] - b[1]).abs() < 0.01 {
                    segs.push((rt.cable, false, a[1], a[0].min(b[0]), a[0].max(b[0])));
                } else {
                    panic!("cable {} has a diagonal segment {:?}->{:?}", rt.cable, a, b);
                }
            }
        }
        let mut bad = vec![];
        for i in 0..segs.len() {
            for k in i + 1..segs.len() {
                let (s, t) = (segs[i], segs[k]);
                if s.0 != t.0 && s.1 == t.1 && (s.2 - t.2).abs() < LANE - 0.5 && s.3.max(t.3) < s.4.min(t.4) - 0.5 {
                    bad.push(format!("cables {} and {} run together at {:.1}/{:.1}", s.0, t.0, s.2, t.2));
                }
            }
        }
        bad
    }

    #[test]
    fn homelab_routes_are_square_and_do_not_overlap() {
        let doc: Doc = serde_json::from_str(include_str!("../../../Homelab.rack.json")).unwrap();
        let mut total = 0;
        for face in ["front", "rear"] {
            let r = route_all(&doc, face);
            total += r.routes.len();
            let bad = overlaps(&r);
            assert!(bad.is_empty(), "{:?} {:?}", bad, r.routes.iter().map(|x| (x.cable, x.mode.clone(), x.pts.clone())).collect::<Vec<_>>());
        }
        assert!(total > 0);
    }

    #[test]
    fn round_trip_keeps_unknown_fields() {
        let src = include_str!("../../../Homelab.rack.json");
        let doc: Doc = serde_json::from_str(src).unwrap();
        let a: serde_json::Value = serde_json::from_str(src).unwrap();
        let b: serde_json::Value = serde_json::to_value(&doc).unwrap();
        assert_eq!(a["devices"][0]["plate"], b["devices"][0]["plate"]);
        assert_eq!(a["cables"][0]["length"], b["cables"][0]["length"]);
    }
}
