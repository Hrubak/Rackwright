//! Document model. Field names match the Python app's `.rack.json` so existing files load unchanged.
//! Unknown fields are kept (`extra`) so a load/save round trip never loses data.
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Doc {
    #[serde(default)]
    pub v: i64,
    #[serde(default)]
    pub nid: i64,
    #[serde(default)]
    pub racks: Vec<Rack>,
    #[serde(default)]
    pub devices: Vec<Device>,
    #[serde(default)]
    pub cables: Vec<Cable>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Rack {
    pub id: i64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub u: i64,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Port {
    pub id: i64,
    #[serde(default)]
    pub name: String,
    #[serde(default, rename = "type")]
    pub ptype: String,
    #[serde(default)]
    pub label: String,
}

fn front() -> String {
    "front".into()
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Device {
    pub id: i64,
    #[serde(default)]
    pub name: String,
    #[serde(default, rename = "type")]
    pub dtype: String,
    #[serde(default)]
    pub u_size: i64,
    #[serde(default)]
    pub rack: Option<i64>,
    #[serde(default)]
    pub u: i64,
    #[serde(default)]
    pub side: i64,
    #[serde(default)]
    pub half: bool,
    #[serde(default)]
    pub rows: i64,
    #[serde(default)]
    pub fx: f64,
    #[serde(default)]
    pub fy: f64,
    #[serde(default = "front")]
    pub face: String,
    #[serde(default)]
    pub ports: Vec<Port>,
    #[serde(default)]
    pub plate: Option<Value>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Cable {
    pub id: i64,
    pub a: i64,
    pub b: i64,
    #[serde(default)]
    pub color: String,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}
