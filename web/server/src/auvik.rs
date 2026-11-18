//! Auvik API access. The API key lives only in `AuvikCfg`, is only used to build the
//! `Authorization` header, and never appears in a response, a log line or `Debug` output.
//! No reqwest error text is ever used: every error is mapped to fixed text.

use std::time::Duration;

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use serde_json::{json, Value};

use crate::{auth, json_ok, ApiError, ApiResult, Shared};

const FIXED_REFUSED: &str = "Auvik refused the request.";
const FIXED_BUSY: &str = "Auvik is busy. Try again in a few minutes.";
const FIXED_NOT_SET_UP: &str = "Auvik is not set up on this server.";
const BACKOFF_SECS: [u64; 5] = [1, 2, 4, 8, 16];
const MAX_RETRY_AFTER_SECS: u64 = 60;

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
