//! Auvik API access. The API key lives only in `AuvikCfg`, is only used to build the
//! `Authorization` header, and never appears in a response, a log line or `Debug` output.
//! No reqwest error text is ever used: every error is mapped to fixed text.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use serde_json::{json, Value};

use crate::{auth, json_ok, ApiError, ApiResult, Shared};

const FIXED_REFUSED: &str = "Auvik refused the request.";
const FIXED_BUSY: &str = "Auvik is busy. Try again in a few minutes.";
const FIXED_NOT_SET_UP: &str = "Auvik is not set up on this server.";
const BACKOFF_SECS: [u64; 5] = [1, 2, 4, 8, 16];
const MAX_RETRY_AFTER_SECS: u64 = 60;
const MAX_PAGES: usize = 50;
const INVENTORY_TIMEOUT_SECS: u64 = 180;
const FIXED_TOO_MANY_PAGES: &str = "Auvik returned too many pages for this site.";
const FIXED_TOO_SLOW: &str = "Reading this site from Auvik took too long.";
const FIXED_READ_FAILED: &str = "Auvik could not be read. Try again in a few minutes.";

static LOG: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// All logging in this module goes through here. Callers pass only fixed or sanitised text.
pub fn log(msg: &str) {
    eprintln!("rackwright-server: auvik: {msg}");
    // The guard is taken and released here, never held across an await.
    if let Ok(mut lines) = LOG.lock() {
        lines.push(msg.to_string());
        if lines.len() > 500 {
            lines.remove(0);
        }
    }
}

/// The lines logged so far (for tests).
pub fn log_lines() -> Vec<String> {
    match LOG.lock() {
        Ok(lines) => lines.clone(),
        Err(_) => Vec::new(),
    }
}

/// The API key. `Debug` prints `***`; there is no `Display`.
#[derive(Clone)]
pub struct Secret(String);

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("\"***\"")
    }
}

#[derive(Clone, Debug)]
pub struct AuvikCfg {
    base: String,
    username: String,
    region: String,
    key: Secret,
    /// base64(user:key), the credential part of the Authorization header.
    token: Secret,
}

fn b64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { T[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[(n & 63) as usize] as char } else { '=' });
    }
    out
}

/// True for `^[a-z]{2,3}[0-9]{1,2}$`.
pub fn valid_region(s: &str) -> bool {
    let letters = s.bytes().take_while(|b| b.is_ascii_lowercase()).count();
    let rest = &s[letters..];
    (2..=3).contains(&letters) && (1..=2).contains(&rest.len()) && rest.bytes().all(|b| b.is_ascii_digit())
}

impl AuvikCfg {
    pub fn new(base: &str, username: &str, region: &str, key: &str) -> AuvikCfg {
        AuvikCfg {
            base: base.trim_end_matches('/').to_string(),
            username: username.to_string(),
            region: region.to_string(),
            key: Secret(key.to_string()),
            token: Secret(b64(format!("{username}:{key}").as_bytes())),
        }
    }

    /// Reads AUVIK_API_KEY, AUVIK_USERNAME, AUVIK_REGION (and test-only AUVIK_BASE_URL).
    pub fn from_env() -> Option<AuvikCfg> {
        let key = std::env::var("AUVIK_API_KEY").unwrap_or_default();
        let username = std::env::var("AUVIK_USERNAME").unwrap_or_default();
        let region = std::env::var("AUVIK_REGION").unwrap_or_default();
        let key = key.trim();
        let username = username.trim();
        let region = region.trim();
        if key.is_empty() || username.is_empty() || region.is_empty() {
            return None;
        }
        if !valid_region(region) {
            eprintln!("rackwright-server: AUVIK_REGION is not valid; Auvik import is off");
            return None;
        }
        let override_base = std::env::var("AUVIK_BASE_URL").unwrap_or_default();
        let base = if override_base.trim().is_empty() {
            format!("https://auvikapi.{region}.my.auvik.com/v1")
        } else {
            override_base.trim().to_string()
        };
        Some(AuvikCfg::new(&base, username, region, key))
    }
}

#[derive(Debug)]
pub enum AuvikErr {
    Denied(String),
    Busy,
    Failed(String),
}

pub struct Auvik {
    cfg: AuvikCfg,
    http: reqwest::Client,
    gate: tokio::sync::Mutex<()>,
}

/// A safe message: the fixed text when `s` contains the key, its base64 token, "basic " or "authorization", else `s` cut to 200 characters.
fn sanitize(s: &str, key: &str, token: &str) -> String {
    let lower = s.to_lowercase();
    if (!key.is_empty() && s.contains(key))
        || (!token.is_empty() && s.contains(token))
        || lower.contains("basic ")
        || lower.contains("authorization")
    {
        return FIXED_REFUSED.to_string();
    }
    s.chars().take(200).collect()
}

impl Auvik {
    pub fn new(cfg: AuvikCfg) -> Result<Auvik, String> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|_| "cannot start the Auvik HTTP client".to_string())?;
        Ok(Auvik { cfg, http, gate: tokio::sync::Mutex::new(()) })
    }

    pub fn region(&self) -> &str {
        &self.cfg.region
    }

    pub fn username(&self) -> &str {
        &self.cfg.username
    }

    /// GET `<base><path_and_query>` with Basic auth. One request at a time; retries 429/503.
    pub async fn get(&self, path_and_query: &str) -> Result<Value, AuvikErr> {
        let _guard = self.gate.lock().await;
        let url = format!("{}{}", self.cfg.base, path_and_query);
        let mut attempt = 0usize;
        loop {
            let sent = self
                .http
                .get(url.as_str())
                .basic_auth(self.cfg.username.as_str(), Some(self.cfg.key.0.as_str()))
                .header("Accept", "application/json")
                .send()
                .await;
            let resp = match sent {
                Ok(r) => r,
                Err(_) => return Err(AuvikErr::Failed("Could not reach Auvik.".to_string())),
            };
            let status = resp.status();
            let code = status.as_u16();
            if code == 429 || code == 503 {
                if attempt >= BACKOFF_SECS.len() {
                    return Err(AuvikErr::Busy);
                }
                let retry_after = resp
                    .headers()
                    .get("retry-after")
                    .and_then(|v| v.to_str().ok())
                    // An HTTP-date (not seconds) fails to parse and falls back to the fixed backoff.
                    .and_then(|s| s.trim().parse::<u64>().ok());
                let wait = retry_after.unwrap_or(BACKOFF_SECS[attempt]).min(MAX_RETRY_AFTER_SECS);
                attempt += 1;
                log(&format!("Auvik answered {code}; retry {attempt} in {wait}s"));
                tokio::time::sleep(Duration::from_secs(wait)).await;
                continue;
            }
            let body: Option<Value> = resp.json::<Value>().await.ok();
            if status.is_success() {
                return match body {
                    Some(v) => Ok(v),
                    None => Err(AuvikErr::Failed("Auvik sent an answer that could not be read.".to_string())),
                };
            }
            log(&format!("Auvik answered {code} for {path_and_query}"));
            let title: Option<String> = body
                .as_ref()
                .and_then(|v| v.pointer("/errors/0/title"))
                .and_then(|t| t.as_str())
                .map(|t| sanitize(t, &self.cfg.key.0, &self.cfg.token.0));
            if code == 401 || code == 403 {
                return Err(AuvikErr::Denied(title.unwrap_or_else(|| FIXED_REFUSED.to_string())));
            }
            return Err(AuvikErr::Failed(title.unwrap_or_else(|| "Auvik returned an error.".to_string())));
        }
    }

    /// The part of the base URL after the host, such as `/v1` (empty when none).
    fn base_path(&self) -> &str {
        let b = self.cfg.base.as_str();
        match b.find("://") {
            Some(i) => {
                let rest = &b[i + 3..];
                match rest.find('/') {
                    Some(j) => &rest[j..],
                    None => "",
                }
            }
            None => "",
        }
    }

    /// Reduces a `links.next` value (relative or absolute) to a path and query for `get`.
    /// The host of an absolute link is never used.
    fn next_path(&self, next: &str) -> Option<String> {
        let rest: &str = if let Some(i) = next.find("://") {
            let after = &next[i + 3..];
            match after.find('/') {
                Some(j) => &after[j..],
                None => return None,
            }
        } else if next.starts_with('/') {
            next
        } else {
            return None;
        };
        let bp = self.base_path();
        if !bp.is_empty() && rest.starts_with(bp) {
            let tail = &rest[bp.len()..];
            if tail.starts_with('/') || tail.starts_with('?') {
                return Some(tail.to_string());
            }
        }
        Some(rest.to_string())
    }

    /// Follows `links.next` from `first_path`; at most 50 pages. Returns every `data` item.
    pub async fn paged(&self, first_path: &str) -> Result<Vec<Value>, AuvikErr> {
        let mut out: Vec<Value> = Vec::new();
        let mut path = first_path.to_string();
        let mut pages = 0usize;
        loop {
            let page = self.get(&path).await?;
            pages += 1;
            if let Some(items) = page.get("data").and_then(|d| d.as_array()) {
                out.extend(items.iter().cloned());
            }
            let next: Option<String> = page
                .pointer("/links/next")
                .and_then(|n| n.as_str())
                .filter(|n| !n.is_empty())
                .map(|n| n.to_string());
            let next = match next {
                Some(n) => n,
                None => return Ok(out),
            };
            if pages >= MAX_PAGES {
                return Err(AuvikErr::Failed(FIXED_TOO_MANY_PAGES.to_string()));
            }
            path = match self.next_path(&next) {
                Some(p) => p,
                None => return Err(AuvikErr::Failed("Auvik sent an answer that could not be read.".to_string())),
            };
        }
    }
}

fn not_set_up() -> ApiError {
    ApiError::new(StatusCode::NOT_FOUND, FIXED_NOT_SET_UP)
}

pub async fn get_status(State(st): State<Shared>, headers: HeaderMap) -> ApiResult {
    auth(&st, &headers)?;
    let v = match st.auvik.as_ref() {
        Some(a) => json!({ "configured": true, "region": a.region(), "username": a.username() }),
        None => json!({ "configured": false, "region": "", "username": "" }),
    };
    Ok(json_ok(&v))
}

pub async fn post_test(State(st): State<Shared>, headers: HeaderMap) -> ApiResult {
    auth(&st, &headers)?;
    let a = match st.auvik.as_ref() {
        Some(a) => a,
        None => return Err(not_set_up()),
    };
    let v = match a.get("/authentication/verify").await {
        Ok(_) => json!({ "ok": true }),
        Err(AuvikErr::Denied(m)) | Err(AuvikErr::Failed(m)) => json!({ "ok": false, "error": m }),
        Err(AuvikErr::Busy) => json!({ "ok": false, "error": FIXED_BUSY }),
    };
    Ok(json_ok(&v))
}

fn text(v: &Value, key: &str) -> String {
    match v.pointer(&format!("/attributes/{key}")) {
        Some(Value::String(s)) => s.trim().to_string(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}

/// A string attribute from the first of `parts` that has it non-empty.
fn text_of(parts: &[&Value], key: &str) -> String {
    for p in parts {
        let t = text(p, key);
        if !t.is_empty() {
            return t;
        }
    }
    String::new()
}

fn text_list(v: &Value, key: &str) -> Vec<String> {
    match v.pointer(&format!("/attributes/{key}")) {
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(|x| x.as_str())
            .map(|x| x.trim().to_string())
            .filter(|x| !x.is_empty())
            .collect(),
        Some(Value::String(s)) if !s.trim().is_empty() => vec![s.trim().to_string()],
        _ => Vec::new(),
    }
}

fn list_of(parts: &[&Value], key: &str) -> Vec<String> {
    for p in parts {
        let l = text_list(p, key);
        if !l.is_empty() {
            return l;
        }
    }
    Vec::new()
}

fn id_of(v: &Value) -> String {
    match v.get("id") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}

fn api_err(e: AuvikErr, what: &str) -> ApiError {
    match e {
        AuvikErr::Busy => {
            log(&format!("{what}: Auvik is busy"));
            ApiError::new(StatusCode::BAD_GATEWAY, FIXED_BUSY)
        }
        AuvikErr::Denied(m) => {
            log(&format!("{what}: refused: {m}"));
            ApiError::new(StatusCode::BAD_GATEWAY, FIXED_REFUSED)
        }
        AuvikErr::Failed(m) => {
            log(&format!("{what}: failed: {m}"));
            if m == FIXED_TOO_MANY_PAGES {
                ApiError::new(StatusCode::BAD_GATEWAY, FIXED_TOO_MANY_PAGES)
            } else {
                ApiError::new(StatusCode::BAD_GATEWAY, FIXED_READ_FAILED)
            }
        }
    }
}

pub async fn get_tenants(State(st): State<Shared>, headers: HeaderMap) -> ApiResult {
    auth(&st, &headers)?;
    let a = match st.auvik.as_ref() {
        Some(a) => a,
        None => return Err(not_set_up()),
    };
    let list = a.paged("/tenants?page[first]=1000").await.map_err(|e| api_err(e, "tenants"))?;
    let detail = a.paged("/tenants/detail?page[first]=1000").await.map_err(|e| api_err(e, "tenant details"))?;
    let mut kinds: HashMap<String, String> = HashMap::new();
    let mut parents: HashMap<String, String> = HashMap::new();
    for d in &detail {
        let id = id_of(d);
        kinds.insert(id.clone(), text(d, "tenantType"));
        if let Some(kids) = d.pointer("/relationships/clients/data").and_then(|c| c.as_array()) {
            for k in kids {
                let kid = id_of(k);
                if !kid.is_empty() {
                    parents.insert(kid, id.clone());
                }
            }
        }
    }
    let mut rows: Vec<(bool, String, Value)> = Vec::new();
    for t in &list {
        let id = id_of(t);
        if id.is_empty() {
            continue;
        }
        let mut name = text(t, "domainPrefix");
        if name.is_empty() {
            name = id.clone();
        }
        let multi = kinds.get(&id).map(|k| k.as_str() == "multiClient").unwrap_or(false);
        let parent = match parents.get(&id) {
            Some(p) => Value::String(p.clone()),
            None => Value::Null,
        };
        let kind = if multi { "multiClient" } else { "client" };
        rows.push((!multi, name.to_lowercase(), json!({ "id": id, "name": name, "type": kind, "parent": parent })));
    }
    rows.sort_by(|x, y| (x.0, &x.1).cmp(&(y.0, &y.1)));
    let out: Vec<Value> = rows.into_iter().map(|r| r.2).collect();
    Ok(json_ok(&Value::Array(out)))
}

fn result(status: &str, note: &str, devices: Vec<Value>) -> Value {
    json!({ "status": status, "note": note, "devices": devices })
}

fn denied_result() -> Value {
    result("denied", "Rackwright's Auvik key can't read this site.", Vec::new())
}

async fn read_inventory(a: &Auvik, id: &str) -> Result<Value, AuvikErr> {
    let q = format!("tenants={id}&page[first]=1000");
    let info = match a.paged(&format!("/inventory/device/info?{q}")).await {
        Ok(v) => v,
        Err(AuvikErr::Denied(_)) => return Ok(denied_result()),
        Err(e) => return Err(e),
    };
    if info.is_empty() {
        return Ok(result("empty", "No devices found. The site may have no collector.", Vec::new()));
    }
    let detail = match a.paged(&format!("/inventory/device/detail?{q}")).await {
        Ok(v) => v,
        Err(AuvikErr::Denied(_)) => return Ok(denied_result()),
        Err(e) => return Err(e),
    };
    let comps = match a.paged(&format!("/inventory/component/info?{q}")).await {
        Ok(v) => v,
        Err(AuvikErr::Denied(_)) => return Ok(denied_result()),
        Err(e) => return Err(e),
    };
    let mut by_detail: HashMap<String, &Value> = HashMap::new();
    for d in &detail {
        by_detail.insert(id_of(d), d);
    }
    let mut by_device: HashMap<String, Vec<Value>> = HashMap::new();
    for c in &comps {
        let dev = match c.pointer("/relationships/device/data/id") {
            Some(Value::String(s)) => s.clone(),
            Some(Value::Number(n)) => n.to_string(),
            _ => continue,
        };
        let mut detail_text = text(c, "description");
        if detail_text.is_empty() {
            detail_text = text(c, "modelNumber");
        }
        by_device.entry(dev).or_default().push(json!({
            "type": text(c, "componentType"),
            "name": text(c, "componentName"),
            "detail": detail_text,
        }));
    }
    let none = Value::Null;
    let mut devices: Vec<Value> = Vec::new();
    for d in &info {
        let did = id_of(d);
        let det: &Value = match by_detail.get(&did) {
            Some(v) => *v,
            None => &none,
        };
        let parts: [&Value; 2] = [d, det];
        let comps_for = by_device.remove(&did).unwrap_or_default();
        devices.push(json!({
            "id": did,
            "name": text_of(&parts, "deviceName"),
            "type": text_of(&parts, "deviceType"),
            "makeModel": text_of(&parts, "makeModel"),
            "vendor": text_of(&parts, "vendorName"),
            "serial": text_of(&parts, "serialNumber"),
            "firmware": text_of(&parts, "firmwareVersion"),
            "software": text_of(&parts, "softwareVersion"),
            "ips": list_of(&parts, "ipAddresses"),
            "macs": list_of(&parts, "macAddress"),
            "status": text_of(&parts, "onlineStatus"),
            "discovery": text_of(&parts, "discoveryStatus"),
            "components": comps_for,
        }));
    }
    Ok(result("ok", "", devices))
}

pub async fn get_inventory(State(st): State<Shared>, headers: HeaderMap, Path(id): Path<String>) -> ApiResult {
    auth(&st, &headers)?;
    let a = match st.auvik.as_ref() {
        Some(a) => a,
        None => return Err(not_set_up()),
    };
    if id.is_empty() || id.len() > 64 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
        return Err(ApiError::bad("That site id is not valid."));
    }
    let run = tokio::time::timeout(Duration::from_secs(INVENTORY_TIMEOUT_SECS), read_inventory(a, &id)).await;
    match run {
        Err(_) => {
            log("inventory: timed out");
            Err(ApiError::new(StatusCode::BAD_GATEWAY, FIXED_TOO_SLOW))
        }
        Ok(Ok(v)) => Ok(json_ok(&v)),
        Ok(Err(e)) => Err(api_err(e, "inventory")),
    }
}
