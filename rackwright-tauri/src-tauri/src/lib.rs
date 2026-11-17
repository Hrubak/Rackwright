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
fn save_bytes(path: String, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(path, data).map_err(|e| e.to_string())
}

/// Client files (`.client.json`) are read and written as plain text; the front end owns their format.
#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_text(path: String, text: String) -> Result<(), String> {
    std::fs::write(path, text).map_err(|e| e.to_string())
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
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![open_doc, save_doc, save_bytes, read_text, write_text, route_cables, port_positions])
        .run(tauri::generate_context!())
        .expect("error while running Rackwright");
}
