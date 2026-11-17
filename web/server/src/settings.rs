//! Settings, preferences, email change and uploaded assets such as the company logo
//! (see web/API.md, "Settings and branding").

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::Response;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};

use super::{auth, auth_admin, get_user, json_ok, norm_email, norm_name, now_rfc3339, parse, verify_pw};
use super::{ApiError, ApiResult, Shared};

const MAX_PREFS: usize = 16 * 1024;
const MAX_SETTINGS: usize = 64 * 1024;
const LOGO_TYPES: &[&str] = &["image/png", "image/svg+xml", "image/jpeg", "image/webp"];
const LOGO_MAX: usize = 2 * 1024 * 1024;
const ART_MAX: usize = 5 * 1024 * 1024;
const FONT_MAX: usize = 5 * 1024 * 1024;
const FONT_TYPES: &[&str] = &[
    "font/ttf",
    "font/otf",
    "font/sfnt",
    "application/x-font-ttf",
    "application/x-font-otf",
    "application/octet-stream",
];

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assets (
    name TEXT PRIMARY KEY,
    mime TEXT NOT NULL,
    data BLOB NOT NULL,
    updated_at TEXT NOT NULL
);
";

/// Create the settings and assets tables and add `users.prefs` to databases made before it existed.
pub(crate) fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(SCHEMA)?;
    let mut has_prefs = false;
    {
        let mut stmt = conn.prepare("PRAGMA table_info(users)")?;
        let names = stmt.query_map([], |r| r.get::<_, String>(1))?;
        for n in names {
            if n? == "prefs" {
                has_prefs = true;
            }
        }
    }
    if !has_prefs {
        conn.execute_batch("ALTER TABLE users ADD COLUMN prefs TEXT NOT NULL DEFAULT '{}';")?;
    }
    Ok(())
}

// ---------------------------------------------------------------- me

#[derive(Deserialize)]
struct PatchMeReq {
    name: Option<String>,
    email: Option<String>,
    current_password: Option<String>,
}

pub(crate) async fn patch_me(State(st): State<Shared>, headers: HeaderMap, body: Bytes) -> ApiResult {
    let me = auth(&st, &headers)?;
    let req: PatchMeReq = parse(&body)?;
    let name = req.name.as_deref().map(norm_name).transpose()?;
    let email = req.email.as_deref().map(norm_email).transpose()?;
    let conn = st.db();
    if let Some(e) = &email {
        let pw = req
            .current_password
            .as_deref()
            .ok_or_else(|| ApiError::bad("Enter your current password to change your email"))?;
        let cur: String = conn.query_row("SELECT pw_hash FROM users WHERE id = ?1", params![me.id], |r| r.get(0))?;
        if !verify_pw(&cur, pw) {
            return Err(ApiError::bad("Current password is wrong"));
        }
        let taken: i64 = conn.query_row(
            "SELECT COUNT(*) FROM users WHERE email = ?1 AND id <> ?2",
            params![e, me.id],
            |r| r.get(0),
        )?;
        if taken > 0 {
            return Err(ApiError::new(StatusCode::CONFLICT, "That email is already in use"));
        }
    }
    if let Some(n) = &name {
        conn.execute("UPDATE users SET name = ?1 WHERE id = ?2", params![n, me.id])?;
    }
    if let Some(e) = &email {
        conn.execute("UPDATE users SET email = ?1 WHERE id = ?2", params![e, me.id])?;
    }
    let user = get_user(&conn, me.id)?.ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "User not found"))?;
    Ok(json_ok(&user))
}

pub(crate) async fn get_prefs(State(st): State<Shared>, headers: HeaderMap) -> ApiResult {
    let me = auth(&st, &headers)?;
    let text: Option<String> = {
        let conn = st.db();
        let t = conn
            .query_row("SELECT prefs FROM users WHERE id = ?1", params![me.id], |r| r.get::<_, String>(0))
            .optional()?;
        t
    };
    let v = text
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .filter(|v| v.is_object())
        .unwrap_or_else(|| json!({}));
    Ok(json_ok(&v))
}

pub(crate) async fn put_prefs(State(st): State<Shared>, headers: HeaderMap, body: Bytes) -> ApiResult {
    let me = auth(&st, &headers)?;
    if body.len() > MAX_PREFS {
        return Err(ApiError::bad("Preferences are too large (16 KB at most)"));
    }
    let v: Value = parse(&body)?;
    if !v.is_object() {
        return Err(ApiError::bad("Preferences must be a JSON object"));
    }
    let text = v.to_string();
    st.db().execute("UPDATE users SET prefs = ?1 WHERE id = ?2", params![text, me.id])?;
    Ok(json_ok(&v))
}

// ---------------------------------------------------------------- settings

fn load_settings(conn: &Connection) -> Result<Value, ApiError> {
    let text: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE id = 1", [], |r| r.get::<_, String>(0))
        .optional()?;
    Ok(text
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .filter(|v| v.is_object())
        .unwrap_or_else(|| json!({})))
}

fn is_hex_colour(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

fn validate_settings(v: &Value) -> Result<(), ApiError> {
    let Some(obj) = v.as_object() else {
        return Err(ApiError::bad("Settings must be a JSON object"));
    };
    if let Some(x) = obj.get("company_name") {
        match x.as_str() {
            Some(s) if s.chars().count() <= 100 => {}
            _ => return Err(ApiError::bad("Company name must be text of 100 characters or fewer")),
        }
    }
    if let Some(x) = obj.get("accent") {
        match x.as_str() {
            Some(s) if s.is_empty() || is_hex_colour(s) => {}
            _ => return Err(ApiError::bad("Accent colour must look like #336699")),
        }
    }
    if let Some(x) = obj.get("rack_default_model") {
        if !x.is_string() {
            return Err(ApiError::bad("Default rack model must be text"));
        }
    }
    if let Some(x) = obj.get("rack_default_u") {
        match x.as_i64() {
            Some(n) if (1..=60).contains(&n) => {}
            _ => return Err(ApiError::bad("Default rack height must be a whole number from 1 to 60")),
        }
    }
    if let Some(x) = obj.get("report_secondary") {
        match x.as_str() {
            Some(s) if s.is_empty() || is_hex_colour(s) => {}
            _ => return Err(ApiError::bad("Secondary colour must look like #336699")),
        }
    }
    if let Some(x) = obj.get("address_line") {
        match x.as_str() {
            Some(s) if s.chars().count() <= 200 => {}
            _ => return Err(ApiError::bad("Address line must be text of 200 characters or fewer")),
        }
    }
    if let Some(x) = obj.get("report_font_name") {
        match x.as_str() {
            Some(s) if s.chars().count() <= 100 => {}
            _ => return Err(ApiError::bad("Font name must be text of 100 characters or fewer")),
        }
    }
    Ok(())
}

fn asset_list(conn: &Connection) -> Result<Vec<Value>, ApiError> {
    let mut stmt = conn.prepare("SELECT name, mime, length(data), updated_at FROM assets ORDER BY name")?;
    let rows = stmt
        .query_map([], |r| {
            Ok(json!({
                "name": r.get::<_, String>(0)?,
                "mime": r.get::<_, String>(1)?,
                "size": r.get::<_, i64>(2)?,
                "updated_at": r.get::<_, String>(3)?,
            }))
        })?
        .collect::<Result<Vec<Value>, _>>()?;
    Ok(rows)
}

pub(crate) async fn get_settings(State(st): State<Shared>, headers: HeaderMap) -> ApiResult {
    auth(&st, &headers)?;
    let conn = st.db();
    let settings = load_settings(&conn)?;
    let assets = asset_list(&conn)?;
    Ok(json_ok(&json!({ "settings": settings, "assets": assets })))
}

pub(crate) async fn put_settings(State(st): State<Shared>, headers: HeaderMap, body: Bytes) -> ApiResult {
    auth_admin(&st, &headers)?;
    if body.len() > MAX_SETTINGS {
        return Err(ApiError::bad("Settings are too large (64 KB at most)"));
    }
    let v: Value = parse(&body)?;
    validate_settings(&v)?;
    let text = v.to_string();
    st.db().execute(
        "INSERT INTO settings (id, value) VALUES (1, ?1) ON CONFLICT(id) DO UPDATE SET value = excluded.value",
        params![text],
    )?;
    Ok(json_ok(&v))
}

// ---------------------------------------------------------------- assets

/// Allowed types, size limit and whether the asset is a font, or None for an unknown name.
fn asset_rule(name: &str) -> Option<(&'static [&'static str], usize, bool)> {
    match name {
        "logo" => Some((LOGO_TYPES, LOGO_MAX, false)),
        "cover_art" | "header_art" | "footer_art" => Some((LOGO_TYPES, ART_MAX, false)),
        "font_regular" | "font_bold" => Some((FONT_TYPES, FONT_MAX, true)),
        _ => None,
    }
}

fn has_font_magic(b: &[u8]) -> bool {
    b.starts_with(&[0x00, 0x01, 0x00, 0x00]) || b.starts_with(b"OTTO") || b.starts_with(b"true")
}

fn asset_not_found() -> ApiError {
    ApiError::new(StatusCode::NOT_FOUND, "Not found")
}

pub(crate) async fn put_asset(
    State(st): State<Shared>,
    Path(name): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult {
    auth_admin(&st, &headers)?;
    let (types, max, is_font) = asset_rule(&name).ok_or_else(asset_not_found)?;
    let mime = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(';').next().unwrap_or("").trim().to_lowercase())
        .unwrap_or_default();
    if !types.iter().any(|t| *t == mime.as_str()) {
        return Err(ApiError::bad(if is_font {
            "Upload a TTF or OTF font file."
        } else {
            "Upload a PNG, JPG, SVG or WebP image."
        }));
    }
    if body.is_empty() {
        return Err(ApiError::bad("The file is empty"));
    }
    if body.len() > max {
        return Err(ApiError::bad(if max == LOGO_MAX {
            "That file is too large (2 MB at most)."
        } else {
            "That file is too large (5 MB at most)."
        }));
    }
    if is_font && !has_font_magic(&body) {
        return Err(ApiError::bad("Upload a TTF or OTF font file."));
    }
    let now = now_rfc3339();
    st.db().execute(
        "INSERT INTO assets (name, mime, data, updated_at) VALUES (?1, ?2, ?3, ?4) \
         ON CONFLICT(name) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at",
        params![name, mime, body.to_vec(), now],
    )?;
    Ok(json_ok(&json!({ "name": name, "mime": mime, "size": body.len(), "updated_at": now })))
}

pub(crate) async fn delete_asset(State(st): State<Shared>, Path(name): Path<String>, headers: HeaderMap) -> ApiResult {
    auth_admin(&st, &headers)?;
    asset_rule(&name).ok_or_else(asset_not_found)?;
    st.db().execute("DELETE FROM assets WHERE name = ?1", params![name])?;
    Ok(json_ok(&json!({})))
}

fn serve_asset(st: &Shared, name: &str) -> ApiResult {
    let found: Option<(String, Vec<u8>)> = {
        let conn = st.db();
        let f = conn
            .query_row("SELECT mime, data FROM assets WHERE name = ?1", params![name], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, Vec<u8>>(1)?))
            })
            .optional()?;
        f
    };
    let (mime, data) = found.ok_or_else(asset_not_found)?;
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CONTENT_SECURITY_POLICY, "default-src 'none'; style-src 'unsafe-inline'")
        .header(header::CACHE_CONTROL, "no-cache")
        .body(axum::body::Body::from(data))
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Could not build response"))
}

pub(crate) async fn get_asset(State(st): State<Shared>, Path(name): Path<String>, headers: HeaderMap) -> ApiResult {
    auth(&st, &headers)?;
    serve_asset(&st, &name)
}

// ---------------------------------------------------------------- branding (no sign-in)

pub(crate) async fn get_branding(State(st): State<Shared>) -> ApiResult {
    let conn = st.db();
    let settings = load_settings(&conn)?;
    let has_logo: i64 = conn.query_row("SELECT COUNT(*) FROM assets WHERE name = 'logo'", [], |r| r.get(0))?;
    let company_name = settings.get("company_name").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let accent = settings.get("accent").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(|s| s.to_string());
    Ok(json_ok(&json!({ "company_name": company_name, "accent": accent, "has_logo": has_logo > 0 })))
}

pub(crate) async fn get_branding_logo(State(st): State<Shared>) -> ApiResult {
    serve_asset(&st, "logo")
}
