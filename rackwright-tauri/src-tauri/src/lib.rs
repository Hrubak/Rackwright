pub mod geom;
pub mod model;
pub mod router;

use model::Doc;

#[tauri::command]
fn open_doc(path: String) -> Result<Doc, String> {
    let s = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&s).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_doc(path: String, doc: Doc) -> Result<(), String> {
    let s = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    std::fs::write(path, s).map_err(|e| e.to_string())
}

#[tauri::command]
fn route_cables(doc: Doc, face: String) -> router::RouteResult {
    router::route_all(&doc, &face)
}

#[tauri::command]
fn port_positions(doc: Doc) -> Vec<(i64, f64, f64, f64)> {
    doc.devices
        .iter()
        .flat_map(|d| geom::port_geom(&doc, d))
        .map(|(id, p)| (id, p.x, p.y, p.s))
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![open_doc, save_doc, route_cables, port_positions])
        .run(tauri::generate_context!())
        .expect("error while running Rackwright");
}
