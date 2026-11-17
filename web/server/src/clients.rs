//! Clients and sites (see web/API.md, "Clients and sites"), plus `PUT /api/racks/:id/site`.

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

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
CREATE TABLE IF NOT EXISTS site_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    site_a INTEGER NOT NULL,
    site_b INTEGER,
    kind TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT '',
    circuit TEXT NOT NULL DEFAULT '',
    bandwidth TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    a_end TEXT,
    b_end TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS site_links_client ON site_links(client_id);
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
    let mut has_report = false;
    {
        let mut stmt = conn.prepare("PRAGMA table_info(clients)")?;
        let names = stmt.query_map([], |r| r.get::<_, String>(1))?;
        for n in names {
            if n? == "report" {
                has_report = true;
            }
        }
    }
    if !has_report {
        conn.execute_batch("ALTER TABLE clients ADD COLUMN report TEXT NOT NULL DEFAULT '{}';")?;
    }
    let mut has_rooms = false;
    {
        let mut stmt = conn.prepare("PRAGMA table_info(sites)")?;
        let names = stmt.query_map([], |r| r.get::<_, String>(1))?;
        for n in names {
            if n? == "rooms" {
                has_rooms = true;
            }
        }
    }
    if !has_rooms {
        conn.execute_batch("ALTER TABLE sites ADD COLUMN rooms TEXT NOT NULL DEFAULT '[]';")?;
    }
    conn.execute_batch("CREATE INDEX IF NOT EXISTS racks_site ON racks(site_id);")
}

const MAX_REPORT: usize = 64 * 1024;

pub(crate) async fn get_client_report(State(st): State<Shared>, headers: HeaderMap, Path(id): Path<i64>) -> ApiResult {
    auth(&st, &headers)?;
    let text: Option<String> = {
        let conn = st.db();
        let t = conn
            .query_row("SELECT report FROM clients WHERE id = ?1", params![id], |r| r.get::<_, String>(0))
            .optional()?;
        t
    };
    let text = text.ok_or_else(client_not_found)?;
    let v = serde_json::from_str::<Value>(&text)
        .ok()
        .filter(|v| v.is_object())
        .unwrap_or_else(|| json!({}));
    Ok(json_ok(&v))
}

pub(crate) async fn put_client_report(State(st): State<Shared>, headers: HeaderMap, Path(id): Path<i64>, body: Bytes) -> ApiResult {
    auth(&st, &headers)?;
    let conn = st.db();
    if !client_exists(&conn, id)? {
        return Err(client_not_found());
    }
    if body.len() > MAX_REPORT {
        return Err(ApiError::bad("Report options are too large (64 KB at most)"));
    }
    let v: Value = parse(&body)?;
    if !v.is_object() {
        return Err(ApiError::bad("Report options must be a JSON object"));
    }
    let text = v.to_string();
    conn.execute("UPDATE clients SET report = ?1 WHERE id = ?2", params![text, id])?;
    Ok(json_ok(&v))
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
    rooms: Value,
    updated_at: String,
}

const SITE_SELECT: &str = "SELECT id, client_id, name, address, notes, updated_at, rooms FROM sites";

fn row_site(r: &rusqlite::Row) -> rusqlite::Result<Site> {
    Ok(Site { id: r.get(0)?, client_id: r.get(1)?, name: r.get(2)?, address: r.get(3)?, notes: r.get(4)?, updated_at: r.get(5)?, rooms: parse_rooms(&r.get::<_, String>(6)?) })
}

fn parse_rooms(text: &str) -> Value {
    serde_json::from_str::<Value>(text).ok().filter(|v| v.is_array()).unwrap_or_else(|| json!([]))
}

const MAX_ROOMS: usize = 256 * 1024;

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
    let links = {
        let mut stmt = conn.prepare(&format!("{LINK_SELECT} WHERE client_id = ?1 ORDER BY id"))?;
        let v = stmt.query_map(params![id], row_link)?.collect::<Result<Vec<Link>, _>>()?;
        v
    };
    let mut v = serde_json::to_value(&meta).map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Serialize error"))?;
    v["sites"] = json!(out_sites);
    v["links"] = serde_json::to_value(&links)
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Serialize error"))?;
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
    rooms: Option<Value>,
}

pub(crate) async fn patch_site(State(st): State<Shared>, headers: HeaderMap, Path(id): Path<i64>, body: Bytes) -> ApiResult {
    auth(&st, &headers)?;
    let req: PatchSiteReq = parse(&body)?;
    let name = req.name.as_deref().map(clean_name).transpose()?;
    let address = req.address.as_deref().map(|a| clean_text(a, "Address")).transpose()?;
    let notes = req.notes.as_deref().map(|n| clean_text(n, "Notes")).transpose()?;
    let rooms_text = match &req.rooms {
        Some(v) => {
            if !v.is_array() {
                return Err(ApiError::bad("Rooms must be a list"));
            }
            let t = v.to_string();
            if t.len() > MAX_ROOMS {
                return Err(ApiError::bad("Rooms are too large"));
            }
            Some(t)
        }
        None => None,
    };
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
    if target_client != cur.client_id {
        // Links must stay inside one client.
        conn.execute("DELETE FROM site_links WHERE site_a = ?1 OR site_b = ?1", params![id])?;
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
    if let Some(t) = &rooms_text {
        conn.execute("UPDATE sites SET rooms = ?1 WHERE id = ?2", params![t, id])?;
    }
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
    conn.execute("DELETE FROM site_links WHERE site_a = ?1 OR site_b = ?1", params![id])?;
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

// ---------------------------------------------------------------- site-to-site links

const MAX_KIND: usize = 40;
const MAX_LINK_FIELD: usize = 200;

fn link_not_found() -> ApiError {
    ApiError::new(StatusCode::NOT_FOUND, "Link not found")
}

#[derive(Serialize)]
struct Link {
    id: i64,
    client_id: i64,
    site_a: i64,
    site_b: Option<i64>,
    kind: String,
    provider: String,
    circuit: String,
    bandwidth: String,
    notes: String,
    a_end: Value,
    b_end: Value,
    updated_at: String,
}

const LINK_SELECT: &str = "SELECT id, client_id, site_a, site_b, kind, provider, circuit, bandwidth, notes, \
    a_end, b_end, updated_at FROM site_links";

fn end_value(s: Option<String>) -> Value {
    s.and_then(|t| serde_json::from_str::<Value>(&t).ok()).unwrap_or(Value::Null)
}

fn end_string(v: &Value) -> Option<String> {
    if v.is_null() {
        None
    } else {
        Some(v.to_string())
    }
}

fn row_link(r: &rusqlite::Row) -> rusqlite::Result<Link> {
    let a_end: Option<String> = r.get(9)?;
    let b_end: Option<String> = r.get(10)?;
    Ok(Link {
        id: r.get(0)?,
        client_id: r.get(1)?,
        site_a: r.get(2)?,
        site_b: r.get(3)?,
        kind: r.get(4)?,
        provider: r.get(5)?,
        circuit: r.get(6)?,
        bandwidth: r.get(7)?,
        notes: r.get(8)?,
        a_end: end_value(a_end),
        b_end: end_value(b_end),
        updated_at: r.get(11)?,
    })
}

fn get_link(conn: &Connection, id: i64) -> Result<Option<Link>, ApiError> {
    Ok(conn.query_row(&format!("{LINK_SELECT} WHERE id = ?1"), params![id], row_link).optional()?)
}

/// The writable columns of a link, as stored.
struct LinkFields {
    site_a: i64,
    site_b: Option<i64>,
    kind: String,
    provider: String,
    circuit: String,
    bandwidth: String,
    notes: String,
    a_end: Option<String>,
    b_end: Option<String>,
}

type JsonMap = serde_json::Map<String, Value>;

fn body_object(body: &Bytes) -> Result<JsonMap, ApiError> {
    match parse::<Value>(body)? {
        Value::Object(m) => Ok(m),
        _ => Err(ApiError::bad("Invalid request body: expected a JSON object")),
    }
}

fn text_field(m: &JsonMap, key: &str, what: &str, max: usize) -> Result<Option<String>, ApiError> {
    match m.get(key) {
        None => Ok(None),
        Some(Value::String(s)) => {
            if s.chars().count() > max {
                return Err(ApiError::bad(format!("{what} can be at most {max} characters")));
            }
            Ok(Some(s.clone()))
        }
        Some(_) => Err(ApiError::bad(format!("{what} must be text"))),
    }
}

/// `None` = key absent, `Some(None)` = explicit null, `Some(Some(id))` = a site id.
fn site_field(m: &JsonMap, key: &str) -> Result<Option<Option<i64>>, ApiError> {
    match m.get(key) {
        None => Ok(None),
        Some(Value::Null) => Ok(Some(None)),
        Some(v) => match v.as_i64() {
            Some(n) => Ok(Some(Some(n))),
            None => Err(ApiError::bad(format!("{key} must be a site id"))),
        },
    }
}

/// `None` = key absent, `Some(None)` = explicit null, `Some(Some(json))` = a valid LinkEnd as JSON text.
fn end_field(m: &JsonMap, key: &str) -> Result<Option<Option<String>>, ApiError> {
    match m.get(key) {
        None => Ok(None),
        Some(Value::Null) => Ok(Some(None)),
        Some(v) => {
            let ok = match v.as_object() {
                Some(o) => {
                    let rack_ok = match o.get("rack") {
                        Some(Value::String(_)) => true,
                        Some(r) => r.is_i64(),
                        None => false,
                    };
                    let dev_ok = o.get("dev").map_or(false, |d| d.is_i64());
                    let name_ok = matches!(o.get("name"), Some(Value::String(_)));
                    rack_ok && dev_ok && name_ok
                }
                None => false,
            };
            if !ok {
                return Err(ApiError::bad(format!("{key} must be null or an object with rack, dev and name")));
            }
            Ok(Some(Some(v.to_string())))
        }
    }
}

/// Copy every field present in the body onto `f`.
fn apply_link_body(m: &JsonMap, f: &mut LinkFields) -> Result<(), ApiError> {
    if let Some(v) = m.get("site_a") {
        f.site_a = v.as_i64().ok_or_else(|| ApiError::bad("site_a must be a site id"))?;
    }
    if let Some(b) = site_field(m, "site_b")? {
        f.site_b = b;
    }
    if let Some(k) = text_field(m, "kind", "Kind", 10_000)? {
        let k = k.trim().to_string();
        if k.chars().count() > MAX_KIND {
            return Err(ApiError::bad(format!("Kind can be at most {MAX_KIND} characters")));
        }
        f.kind = k;
    }
    if let Some(s) = text_field(m, "provider", "Provider", MAX_LINK_FIELD)? {
        f.provider = s;
    }
    if let Some(s) = text_field(m, "circuit", "Circuit", MAX_LINK_FIELD)? {
        f.circuit = s;
    }
    if let Some(s) = text_field(m, "bandwidth", "Bandwidth", MAX_LINK_FIELD)? {
        f.bandwidth = s;
    }
    if let Some(s) = text_field(m, "notes", "Notes", MAX_TEXT)? {
        f.notes = s;
    }
    if let Some(e) = end_field(m, "a_end")? {
        f.a_end = e;
    }
    if let Some(e) = end_field(m, "b_end")? {
        f.b_end = e;
    }
    Ok(())
}

fn site_in_client(conn: &Connection, site_id: i64, client_id: i64) -> Result<bool, ApiError> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sites WHERE id = ?1 AND client_id = ?2",
        params![site_id, client_id],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

fn check_link(conn: &Connection, client_id: i64, f: &LinkFields) -> Result<(), ApiError> {
    if f.kind.is_empty() {
        return Err(ApiError::bad("Kind can't be empty"));
    }
    if !site_in_client(conn, f.site_a, client_id)? {
        return Err(ApiError::bad("site_a must be a site of this client"));
    }
    if let Some(b) = f.site_b {
        if !site_in_client(conn, b, client_id)? {
            return Err(ApiError::bad("site_b must be a site of this client"));
        }
        if b == f.site_a {
            return Err(ApiError::bad("A link must join two different sites"));
        }
    }
    Ok(())
}

pub(crate) async fn create_link(State(st): State<Shared>, headers: HeaderMap, Path(client_id): Path<i64>, body: Bytes) -> ApiResult {
    auth(&st, &headers)?;
    let m = body_object(&body)?;
    if !m.contains_key("site_a") {
        return Err(ApiError::bad("site_a is required"));
    }
    let mut f = LinkFields {
        site_a: 0,
        site_b: None,
        kind: String::new(),
        provider: String::new(),
        circuit: String::new(),
        bandwidth: String::new(),
        notes: String::new(),
        a_end: None,
        b_end: None,
    };
    apply_link_body(&m, &mut f)?;
    let conn = st.db();
    if !client_exists(&conn, client_id)? {
        return Err(client_not_found());
    }
    check_link(&conn, client_id, &f)?;
    let now = now_rfc3339();
    conn.execute(
        "INSERT INTO site_links (client_id, site_a, site_b, kind, provider, circuit, bandwidth, notes, a_end, b_end, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
        params![client_id, f.site_a, f.site_b, f.kind, f.provider, f.circuit, f.bandwidth, f.notes, f.a_end, f.b_end, now],
    )?;
    let link = get_link(&conn, conn.last_insert_rowid())?.ok_or_else(link_not_found)?;
    Ok(json_ok(&link))
}

pub(crate) async fn patch_link(State(st): State<Shared>, headers: HeaderMap, Path(id): Path<i64>, body: Bytes) -> ApiResult {
    auth(&st, &headers)?;
    let m = body_object(&body)?;
    let conn = st.db();
    let cur = get_link(&conn, id)?.ok_or_else(link_not_found)?;
    let mut f = LinkFields {
        site_a: cur.site_a,
        site_b: cur.site_b,
        kind: cur.kind.clone(),
        provider: cur.provider.clone(),
        circuit: cur.circuit.clone(),
        bandwidth: cur.bandwidth.clone(),
        notes: cur.notes.clone(),
        a_end: end_string(&cur.a_end),
        b_end: end_string(&cur.b_end),
    };
    apply_link_body(&m, &mut f)?;
    check_link(&conn, cur.client_id, &f)?;
    conn.execute(
        "UPDATE site_links SET site_a = ?1, site_b = ?2, kind = ?3, provider = ?4, circuit = ?5, bandwidth = ?6, \
         notes = ?7, a_end = ?8, b_end = ?9, updated_at = ?10 WHERE id = ?11",
        params![f.site_a, f.site_b, f.kind, f.provider, f.circuit, f.bandwidth, f.notes, f.a_end, f.b_end, now_rfc3339(), id],
    )?;
    let link = get_link(&conn, id)?.ok_or_else(link_not_found)?;
    Ok(json_ok(&link))
}

pub(crate) async fn delete_link(State(st): State<Shared>, headers: HeaderMap, Path(id): Path<i64>) -> ApiResult {
    auth(&st, &headers)?;
    let conn = st.db();
    let n = conn.execute("DELETE FROM site_links WHERE id = ?1", params![id])?;
    if n == 0 {
        return Err(link_not_found());
    }
    Ok(json_ok(&json!({})))
}
