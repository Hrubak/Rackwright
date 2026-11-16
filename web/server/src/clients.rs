//! Clients and sites (see web/API.md, "Clients and sites"), plus `PUT /api/racks/:id/site`.

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::{auth, get_meta, json_ok, norm_name, now_rfc3339, parse, rack_not_found};
use super::{ApiError, ApiResult, RackMeta, Shared, RACK_SELECT};

const MAX_NAME: usize = 200;
const MAX_TEXT: usize = 10_000;

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sites_client ON sites(client_id);
";

/// Create the clients/sites tables and add `racks.site_id` to databases made before it existed.
pub(crate) fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(SCHEMA)?;
    let mut has_site_id = false;
    {
        let mut stmt = conn.prepare("PRAGMA table_info(racks)")?;
        let names = stmt.query_map([], |r| r.get::<_, String>(1))?;
        for n in names {
            if n? == "site_id" {
                has_site_id = true;
            }
        }
    }
    if !has_site_id {
        conn.execute_batch("ALTER TABLE racks ADD COLUMN site_id INTEGER;")?;
    }
    conn.execute_batch("CREATE INDEX IF NOT EXISTS racks_site ON racks(site_id);")
}

// ---------------------------------------------------------------- helpers

fn conflict(msg: &str) -> ApiError {
    ApiError::new(StatusCode::CONFLICT, msg)
}

fn client_not_found() -> ApiError {
    ApiError::new(StatusCode::NOT_FOUND, "Client not found")
}

fn site_not_found() -> ApiError {
    ApiError::new(StatusCode::NOT_FOUND, "Site not found")
}

fn clean_name(s: &str) -> Result<String, ApiError> {
    let n = norm_name(s)?;
    if n.chars().count() > MAX_NAME {
        return Err(ApiError::bad(format!("Name can be at most {MAX_NAME} characters")));
    }
    Ok(n)
}

fn clean_text(s: &str, what: &str) -> Result<String, ApiError> {
    if s.chars().count() > MAX_TEXT {
        return Err(ApiError::bad(format!("{what} can be at most {MAX_TEXT} characters")));
    }
    Ok(s.to_string())
}

pub(crate) fn site_exists(conn: &Connection, id: i64) -> Result<bool, ApiError> {
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM sites WHERE id = ?1", params![id], |r| r.get(0))?;
    Ok(n > 0)
}

fn client_exists(conn: &Connection, id: i64) -> Result<bool, ApiError> {
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM clients WHERE id = ?1", params![id], |r| r.get(0))?;
    Ok(n > 0)
}

/// Case-insensitive duplicate check among clients, ignoring client `except`.
fn client_name_taken(conn: &Connection, name: &str, except: Option<i64>) -> Result<bool, ApiError> {
    let lower = name.to_lowercase();
    let mut stmt = conn.prepare("SELECT id, name FROM clients")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
    for row in rows {
        let (id, n) = row?;
        if Some(id) != except && n.to_lowercase() == lower {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Case-insensitive duplicate check among the sites of `client_id`, ignoring site `except`.
fn site_name_taken(conn: &Connection, client_id: i64, name: &str, except: Option<i64>) -> Result<bool, ApiError> {
    let lower = name.to_lowercase();
    let mut stmt = conn.prepare("SELECT id, name FROM sites WHERE client_id = ?1")?;
    let rows = stmt.query_map(params![client_id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
    for row in rows {
        let (id, n) = row?;
        if Some(id) != except && n.to_lowercase() == lower {
            return Ok(true);
        }
    }
    Ok(false)
}

// ---------------------------------------------------------------- clients

#[derive(Serialize)]
struct ClientMeta {
    id: i64,
    name: String,
    notes: String,
    sites: i64,
    racks: i64,
    updated_at: String,
}

const CLIENT_SELECT: &str = "SELECT c.id, c.name, c.notes, \
    (SELECT COUNT(*) FROM sites s WHERE s.client_id = c.id), \
    (SELECT COUNT(*) FROM racks r JOIN sites s ON s.id = r.site_id WHERE s.client_id = c.id), \
    c.updated_at FROM clients c";

fn row_client(r: &rusqlite::Row) -> rusqlite::Result<ClientMeta> {
    Ok(ClientMeta { id: r.get(0)?, name: r.get(1)?, notes: r.get(2)?, sites: r.get(3)?, racks: r.get(4)?, updated_at: r.get(5)? })
}

fn client_meta(conn: &Connection, id: i64) -> Result<Option<ClientMeta>, ApiError> {
    Ok(conn.query_row(&format!("{CLIENT_SELECT} WHERE c.id = ?1"), params![id], row_client).optional()?)
}

#[derive(Serialize)]
struct Site {
    id: i64,
    client_id: i64,
    name: String,
    address: String,
    notes: String,
    updated_at: String,
}

const SITE_SELECT: &str = "SELECT id, client_id, name, address, notes, updated_at FROM sites";

fn row_site(r: &rusqlite::Row) -> rusqlite::Result<Site> {
    Ok(Site { id: r.get(0)?, client_id: r.get(1)?, name: r.get(2)?, address: r.get(3)?, notes: r.get(4)?, updated_at: r.get(5)? })
}

fn get_site(conn: &Connection, id: i64) -> Result<Option<Site>, ApiError> {
    Ok(conn.query_row(&format!("{SITE_SELECT} WHERE id = ?1"), params![id], row_site).optional()?)
}

pub(crate) async fn list_clients(State(st): State<Shared>, headers: HeaderMap) -> ApiResult {
    auth(&st, &headers)?;
    let conn = st.db();
    let mut stmt = conn.prepare(&format!("{CLIENT_SELECT} ORDER BY c.name COLLATE NOCASE, c.id"))?;
    let rows = stmt.query_map([], row_client)?.collect::<Result<Vec<ClientMeta>, _>>()?;
    Ok(json_ok(&rows))
}

#[derive(Deserialize)]
struct NewClientReq {
    name: String,
    #[serde(default)]
    notes: String,
}

pub(crate) async fn create_client(State(st): State<Shared>, headers: HeaderMap, body: Bytes) -> ApiResult {
    auth(&st, &headers)?;
    let req: NewClientReq = parse(&body)?;
    let name = clean_name(&req.name)?;
    let notes = clean_text(&req.notes, "Notes")?;
    let conn = st.db();
    if client_name_taken(&conn, &name, None)? {
        return Err(conflict("A client with that name already exists"));
    }
    let now = now_rfc3339();
    conn.execute(
        "INSERT INTO clients (name, notes, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
        params![name, notes, now],
    )?;
    let meta = client_meta(&conn, conn.last_insert_rowid())?.ok_or_else(client_not_found)?;
    Ok(json_ok(&meta))
}

pub(crate) async fn get_client(State(st): State<Shared>, headers: HeaderMap, Path(id): Path<i64>) -> ApiResult {
    auth(&st, &headers)?;
    let conn = st.db();
    let meta = client_meta(&conn, id)?.ok_or_else(client_not_found)?;
    let sites = {
        let mut stmt = conn.prepare(&format!("{SITE_SELECT} WHERE client_id = ?1 ORDER BY name COLLATE NOCASE, id"))?;
        let v = stmt.query_map(params![id], row_site)?.collect::<Result<Vec<Site>, _>>()?;
        v
    };
    let mut out_sites: Vec<serde_json::Value> = Vec::with_capacity(sites.len());
    for s in sites {
        let racks = {
            let mut stmt =
                conn.prepare(&format!("{RACK_SELECT} WHERE r.site_id = ?1 ORDER BY r.name COLLATE NOCASE, r.id"))?;
            let v = stmt.query_map(params![s.id], super::row_meta)?.collect::<Result<Vec<RackMeta>, _>>()?;
            v
        };
        let mut v = serde_json::to_value(&s).map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Serialize error"))?;
        v["racks"] = serde_json::to_value(&racks)
            .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Serialize error"))?;
        out_sites.push(v);
    }
    let mut v = serde_json::to_value(&meta).map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Serialize error"))?;
    v["sites"] = json!(out_sites);
    Ok(json_ok(&v))
}

#[derive(Deserialize)]
struct PatchClientReq {
    name: Option<String>,
    notes: Option<String>,
}

pub(crate) async fn patch_client(State(st): State<Shared>, headers: HeaderMap, Path(id): Path<i64>, body: Bytes) -> ApiResult {
    auth(&st, &headers)?;
    let req: PatchClientReq = parse(&body)?;
    let name = req.name.as_deref().map(clean_name).transpose()?;
    let notes = req.notes.as_deref().map(|n| clean_text(n, "Notes")).transpose()?;
    let conn = st.db();
    if !client_exists(&conn, id)? {
        return Err(client_not_found());
    }
    if let Some(n) = &name {
        if client_name_taken(&conn, n, Some(id))? {
            return Err(conflict("A client with that name already exists"));
        }
        conn.execute("UPDATE clients SET name = ?1 WHERE id = ?2", params![n, id])?;
    }
    if let Some(n) = &notes {
        conn.execute("UPDATE clients SET notes = ?1 WHERE id = ?2", params![n, id])?;
    }
    conn.execute("UPDATE clients SET updated_at = ?1 WHERE id = ?2", params![now_rfc3339(), id])?;
    let meta = client_meta(&conn, id)?.ok_or_else(client_not_found)?;
    Ok(json_ok(&meta))
}

pub(crate) async fn delete_client(State(st): State<Shared>, headers: HeaderMap, Path(id): Path<i64>) -> ApiResult {
    auth(&st, &headers)?;
    let conn = st.db();
    if !client_exists(&conn, id)? {
        return Err(client_not_found());
    }
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM sites WHERE client_id = ?1", params![id], |r| r.get(0))?;
    if n > 0 {
        return Err(conflict("Delete or move its sites first."));
    }
    conn.execute("DELETE FROM clients WHERE id = ?1", params![id])?;
    Ok(json_ok(&json!({})))
}

// ---------------------------------------------------------------- sites

#[derive(Deserialize)]
struct NewSiteReq {
    name: String,
    #[serde(default)]
    address: String,
    #[serde(default)]
    notes: String,
}

pub(crate) async fn create_site(State(st): State<Shared>, headers: HeaderMap, Path(client_id): Path<i64>, body: Bytes) -> ApiResult {
    auth(&st, &headers)?;
    let req: NewSiteReq = parse(&body)?;
    let name = clean_name(&req.name)?;
    let address = clean_text(&req.address, "Address")?;
    let notes = clean_text(&req.notes, "Notes")?;
    let conn = st.db();
    if !client_exists(&conn, client_id)? {
        return Err(client_not_found());
    }
    if site_name_taken(&conn, client_id, &name, None)? {
        return Err(conflict("This client already has a site with that name"));
    }
    let now = now_rfc3339();
    conn.execute(
        "INSERT INTO sites (client_id, name, address, notes, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![client_id, name, address, notes, now],
    )?;
    let site = get_site(&conn, conn.last_insert_rowid())?.ok_or_else(site_not_found)?;
    Ok(json_ok(&site))
}

#[derive(Deserialize)]
struct PatchSiteReq {
    name: Option<String>,
    address: Option<String>,
    notes: Option<String>,
    client_id: Option<i64>,
}

pub(crate) async fn patch_site(State(st): State<Shared>, headers: HeaderMap, Path(id): Path<i64>, body: Bytes) -> ApiResult {
    auth(&st, &headers)?;
    let req: PatchSiteReq = parse(&body)?;
    let name = req.name.as_deref().map(clean_name).transpose()?;
    let address = req.address.as_deref().map(|a| clean_text(a, "Address")).transpose()?;
    let notes = req.notes.as_deref().map(|n| clean_text(n, "Notes")).transpose()?;
    let conn = st.db();
    let cur = get_site(&conn, id)?.ok_or_else(site_not_found)?;
    let target_client = req.client_id.unwrap_or(cur.client_id);
    if target_client != cur.client_id && !client_exists(&conn, target_client)? {
        return Err(client_not_found());
    }
    let new_name = name.unwrap_or_else(|| cur.name.clone());
    if site_name_taken(&conn, target_client, &new_name, Some(id))? {
        return Err(conflict("That client already has a site with that name"));
    }
    conn.execute(
        "UPDATE sites SET client_id = ?1, name = ?2, address = ?3, notes = ?4, updated_at = ?5 WHERE id = ?6",
        params![
            target_client,
            new_name,
            address.unwrap_or_else(|| cur.address.clone()),
            notes.unwrap_or_else(|| cur.notes.clone()),
            now_rfc3339(),
            id
        ],
    )?;
    let site = get_site(&conn, id)?.ok_or_else(site_not_found)?;
    Ok(json_ok(&site))
}

pub(crate) async fn delete_site(State(st): State<Shared>, headers: HeaderMap, Path(id): Path<i64>) -> ApiResult {
    auth(&st, &headers)?;
    let conn = st.db();
    if !site_exists(&conn, id)? {
        return Err(site_not_found());
    }
    conn.execute("UPDATE racks SET site_id = NULL WHERE site_id = ?1", params![id])?;
    conn.execute("DELETE FROM sites WHERE id = ?1", params![id])?;
    Ok(json_ok(&json!({})))
}

// ---------------------------------------------------------------- rack -> site

#[derive(Deserialize)]
struct RackSiteReq {
    site_id: Option<i64>,
}

pub(crate) async fn put_rack_site(State(st): State<Shared>, headers: HeaderMap, Path(id): Path<i64>, body: Bytes) -> ApiResult {
    auth(&st, &headers)?;
    let req: RackSiteReq = parse(&body)?;
    let conn = st.db();
    get_meta(&conn, id)?.ok_or_else(rack_not_found)?;
    if let Some(sid) = req.site_id {
        if !site_exists(&conn, sid)? {
            return Err(site_not_found());
        }
    }
    conn.execute("UPDATE racks SET site_id = ?1 WHERE id = ?2", params![req.site_id, id])?;
    let meta = get_meta(&conn, id)?.ok_or_else(rack_not_found)?;
    Ok(json_ok(&meta))
}
