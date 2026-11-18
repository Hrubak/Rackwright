use axum::body::Body;
use axum::extract::{Query, State};
use axum::response::{IntoResponse, Response};
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use axum::http::{header, HeaderMap, Method, Request, StatusCode};
use axum::routing::get;
use axum::Router;
use rackwright_server::auvik::{log_lines, valid_region, AuvikCfg};
use serde_json::{json, Value};
use tower::ServiceExt;

const KEY: &str = "TESTKEY-do-not-leak-7f3a";
const USER: &str = "api-user@example.com";
const VERIFY_OK: &str = include_str!("fixtures/auvik/verify-ok.json");
const VERIFY_DENIED: &str = include_str!("fixtures/auvik/verify-denied.json");

struct Client {
    app: Router,
    cookie: Option<String>,
}

impl Client {
    fn new(app: &Router) -> Self {
        Client { app: app.clone(), cookie: None }
    }

    async fn call(&mut self, method: Method, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
        let mut b = Request::builder().method(method).uri(uri);
        if let Some(c) = &self.cookie {
            b = b.header(header::COOKIE, c.as_str());
        }
        let req = if let Some(v) = body {
            b.header(header::CONTENT_TYPE, "application/json").body(Body::from(v.to_string())).unwrap()
        } else {
            b.body(Body::empty()).unwrap()
        };
        let resp = self.app.clone().oneshot(req).await.unwrap();
        let status = resp.status();
        if let Some(sc) = resp.headers().get(header::SET_COOKIE) {
            let pair = sc.to_str().unwrap().split(';').next().unwrap().to_string();
            if pair.ends_with('=') {
                self.cookie = None;
            } else {
                self.cookie = Some(pair);
            }
        }
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        check_body(&bytes);
        let v = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        (status, v)
    }

    async fn get(&mut self, uri: &str) -> (StatusCode, Value) {
        self.call(Method::GET, uri, None).await
    }
    async fn post(&mut self, uri: &str, body: Value) -> (StatusCode, Value) {
        self.call(Method::POST, uri, Some(body)).await
    }
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

async fn verify(State(mode): State<&'static str>, headers: HeaderMap) -> (StatusCode, String) {
    let got = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    match mode {
        "ok" => {
            let want = format!("Basic {}", b64(format!("{USER}:{KEY}").as_bytes()));
            if got == want {
                (StatusCode::OK, VERIFY_OK.to_string())
            } else {
                (StatusCode::UNAUTHORIZED, VERIFY_DENIED.to_string())
            }
        }
        "denied" => (StatusCode::UNAUTHORIZED, VERIFY_DENIED.to_string()),
        "echo_header" => (StatusCode::UNAUTHORIZED, json!({ "errors": [{ "title": got }] }).to_string()),
        "echo_token" => {
            let token = got.trim_start_matches("Basic ").to_string();
            (StatusCode::UNAUTHORIZED, json!({ "errors": [{ "title": format!("Bad login {token}") }] }).to_string())
        }
        _ => {
            let title = format!("Bad login {got} for key {KEY}");
            (StatusCode::UNAUTHORIZED, json!({ "errors": [{ "title": title }] }).to_string())
        }
    }
}

async fn spawn_mock(mode: &'static str) -> String {
    let app = Router::new().route("/authentication/verify", get(verify)).with_state(mode);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{addr}")
}

fn make_app(cfg: Option<AuvikCfg>) -> (Router, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let app = rackwright_server::build_app_with(&dir.path().join("data"), &dir.path().join("static"), cfg).unwrap();
    (app, dir)
}

async fn signed_in(app: &Router) -> Client {
    let mut c = Client::new(app);
    let (s, v) = c.post("/api/setup", json!({"email": "Admin@Example.com", "name": "Ada", "password": "password1"})).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    c
}

async fn configured_app(mode: &'static str) -> (Router, tempfile::TempDir) {
    let url = spawn_mock(mode).await;
    make_app(Some(AuvikCfg::new(&url, USER, "us1", KEY)))
}

#[tokio::test]
async fn status_not_configured() {
    let (app, _d) = make_app(None);
    let mut c = signed_in(&app).await;
    let (s, v) = c.get("/api/auvik").await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v, json!({"configured": false, "region": "", "username": ""}));
    let (s, v) = c.post("/api/auvik/test", json!({})).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    assert_eq!(v["error"], "Auvik is not set up on this server.");
}

#[tokio::test]
async fn status_configured() {
    let (app, _d) = configured_app("ok").await;
    let mut c = signed_in(&app).await;
    let (s, v) = c.get("/api/auvik").await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v, json!({"configured": true, "region": "us1", "username": USER}));
    assert!(!v.to_string().contains("TESTKEY"));
}

#[tokio::test]
async fn test_ok() {
    let (app, _d) = configured_app("ok").await;
    let mut c = signed_in(&app).await;
    let (s, v) = c.post("/api/auvik/test", json!({})).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v, json!({"ok": true}));
}

#[tokio::test]
async fn test_denied() {
    let (app, _d) = configured_app("denied").await;
    let mut c = signed_in(&app).await;
    let (s, v) = c.post("/api/auvik/test", json!({})).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v, json!({"ok": false, "error": "Invalid credentials"}));
}

#[tokio::test]
async fn test_echo_filtered() {
    let (app, _d) = configured_app("echo").await;
    let mut c = signed_in(&app).await;
    let (s, v) = c.post("/api/auvik/test", json!({})).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["ok"], false);
    assert_eq!(v["error"], "Auvik refused the request.");
    assert!(!v.to_string().contains("TESTKEY"));
}

#[tokio::test]
async fn test_echo_header_only_filtered() {
    let token = b64(format!("{USER}:{KEY}").as_bytes());
    for mode in ["echo_header", "echo_token"] {
        let (app, _d) = configured_app(mode).await;
        let mut c = signed_in(&app).await;
        let (s, v) = c.post("/api/auvik/test", json!({})).await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(v["error"], "Auvik refused the request.", "{mode}");
        let text = v.to_string();
        assert!(!text.contains("TESTKEY"), "{mode}");
        assert!(!text.contains(&token), "{mode}");
    }
}

#[tokio::test]
async fn signed_out_is_401() {
    let (app, _d) = configured_app("ok").await;
    let mut c = Client::new(&app);
    let (s, _) = c.get("/api/auvik").await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let (s, _) = c.post("/api/auvik/test", json!({})).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
}

#[test]
fn debug_redacts() {
    let cfg = AuvikCfg::new("http://127.0.0.1:1", USER, "us1", KEY);
    let text = format!("{:?}", cfg);
    assert!(!text.contains("TESTKEY"), "{text}");
}

#[test]
fn region_check() {
    for ok in ["us1", "eu2", "au1"] {
        assert!(valid_region(ok), "{ok}");
    }
    for bad in ["evil.com/", "US1", "", "us"] {
        assert!(!valid_region(bad), "{bad}");
    }
}

/// Every response body read in this file goes through here, so no test can miss a leak.
fn check_body(bytes: &[u8]) {
    let text = String::from_utf8_lossy(bytes).to_string();
    let token = b64(format!("{USER}:{KEY}").as_bytes());
    assert!(!text.contains("TESTKEY"), "response contains the key: {text}");
    assert!(!text.contains(&token), "response contains the token: {text}");
}

// ---- Tenants and inventory ----

const TENANTS: &str = include_str!("fixtures/auvik/tenants.json");
const TENANTS_DETAIL: &str = include_str!("fixtures/auvik/tenants-detail.json");
const INFO_P1: &str = include_str!("fixtures/auvik/device-info-main-p1.json");
const INFO_P2: &str = include_str!("fixtures/auvik/device-info-main-p2.json");
const INFO_P3: &str = include_str!("fixtures/auvik/device-info-main-p3.json");
const DETAIL_MAIN: &str = include_str!("fixtures/auvik/device-detail-main.json");
const COMPONENTS_MAIN: &str = include_str!("fixtures/auvik/component-info-main.json");
const INFO_WAREHOUSE: &str = include_str!("fixtures/auvik/device-info-warehouse.json");
const EXPECTED_MAIN: &str = include_str!("fixtures/auvik/expected-inventory-main.json");

const NO_DATA: &str = r#"{"data":[],"links":{}}"#;

/// Settings for the inventory mock. `host` is the mock's own address, put into `links.next`.
struct Mock {
    host: String,
    /// `links.next` points at a host nothing listens on; a call to it would hang and fail the test.
    other_host: bool,
    always_429: bool,
    /// How many 429 answers (with Retry-After: 0) to give before real data.
    rate_limits: AtomicUsize,
    /// Page one's `links.next` points at page one itself.
    self_loop: bool,
    /// The device list answers 500 and echoes the Authorization header in the body.
    echo500: bool,
    /// The tenant details answer 500.
    detail_fails: bool,
    /// Requests to the device list.
    info_hits: AtomicUsize,
    /// Requests to all inventory routes (429 answers included).
    hits: AtomicUsize,
}

impl Mock {
    fn new(host: &str) -> Mock {
        Mock {
            host: host.to_string(),
            other_host: false,
            always_429: false,
            rate_limits: AtomicUsize::new(0),
            self_loop: false,
            echo500: false,
            detail_fails: false,
            info_hits: AtomicUsize::new(0),
            hits: AtomicUsize::new(0),
        }
    }
}

fn throttle(m: &Mock) -> Option<Response> {
    m.hits.fetch_add(1, Ordering::SeqCst);
    let limited = m.always_429 || m.rate_limits.load(Ordering::SeqCst) > 0;
    if !limited {
        return None;
    }
    if !m.always_429 {
        m.rate_limits.fetch_sub(1, Ordering::SeqCst);
    }
    Some((StatusCode::TOO_MANY_REQUESTS, [(header::RETRY_AFTER, "0")], "{}".to_string()).into_response())
}

fn answer(body: String) -> Response {
    (StatusCode::OK, body).into_response()
}

async fn m_tenants() -> Response {
    answer(TENANTS.to_string())
}

async fn m_tenants_detail(State(m): State<Arc<Mock>>, Query(q): Query<HashMap<String, String>>) -> Response {
    if m.detail_fails {
        return (StatusCode::INTERNAL_SERVER_ERROR, "{}".to_string()).into_response();
    }
    if q.get("tenantDomainPrefix").map(|t| t.as_str()) == Some("example-it") {
        answer(TENANTS_DETAIL.to_string())
    } else {
        answer(NO_DATA.to_string())
    }
}

async fn m_info(State(m): State<Arc<Mock>>, Query(q): Query<HashMap<String, String>>, headers: HeaderMap) -> Response {
    m.info_hits.fetch_add(1, Ordering::SeqCst);
    if let Some(r) = throttle(&m) {
        return r;
    }
    if m.echo500 {
        let got = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
        return (StatusCode::INTERNAL_SERVER_ERROR, json!({ "errors": [{ "title": got }] }).to_string()).into_response();
    }
    let tenant = q.get("tenants").cloned().unwrap_or_default();
    match tenant.as_str() {
        "1001" => {
            let after = q.get("page[after]").cloned().unwrap_or_default();
            let raw = match after.as_str() {
                "p2" => INFO_P2,
                "p3" => INFO_P3,
                _ => INFO_P1,
            };
            if m.self_loop {
                let mut v: Value = serde_json::from_str(raw).unwrap();
                v["links"]["next"] = json!(format!("http://{}/inventory/device/info?tenants=1001&page[first]=1000", m.host));
                return answer(v.to_string());
            }
            let host = if m.other_host { "203.0.113.9:9" } else { m.host.as_str() };
            answer(raw.replace("{HOST}", host))
        }
        "1002" => answer(INFO_WAREHOUSE.to_string()),
        "1003" => (StatusCode::FORBIDDEN, VERIFY_DENIED.to_string()).into_response(),
        "1004" => answer(NO_DATA.to_string()),
        _ => (StatusCode::NOT_FOUND, "{}".to_string()).into_response(),
    }
}

async fn m_detail(State(m): State<Arc<Mock>>, Query(q): Query<HashMap<String, String>>) -> Response {
    if let Some(r) = throttle(&m) {
        return r;
    }
    if q.get("tenants").map(|t| t.as_str()) == Some("1001") {
        answer(DETAIL_MAIN.to_string())
    } else {
        answer(NO_DATA.to_string())
    }
}

async fn m_components(State(m): State<Arc<Mock>>, Query(q): Query<HashMap<String, String>>) -> Response {
    if let Some(r) = throttle(&m) {
        return r;
    }
    if q.get("tenants").map(|t| t.as_str()) == Some("1001") {
        answer(COMPONENTS_MAIN.to_string())
    } else {
        answer(NO_DATA.to_string())
    }
}

/// Starts the inventory mock and returns the app wired to it.
async fn inv_app(set: impl FnOnce(&mut Mock)) -> (Router, tempfile::TempDir, Arc<Mock>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let mut mock = Mock::new(&addr.to_string());
    set(&mut mock);
    let mock = Arc::new(mock);
    let app = Router::new()
        .route("/tenants", get(m_tenants))
        .route("/tenants/detail", get(m_tenants_detail))
        .route("/inventory/device/info", get(m_info))
        .route("/inventory/device/detail", get(m_detail))
        .route("/inventory/component/info", get(m_components))
        .with_state(mock.clone());
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let cfg = AuvikCfg::new(&format!("http://{addr}"), USER, "us1", KEY);
    let (router, dir) = make_app(Some(cfg));
    (router, dir, mock)
}

const INV_MAIN: &str = "/api/auvik/tenants/1001/inventory";

fn expected_main() -> Value {
    serde_json::from_str(EXPECTED_MAIN).unwrap()
}

#[tokio::test]
async fn tenants_listed() {
    let (app, _d, _m) = inv_app(|_| {}).await;
    let mut c = signed_in(&app).await;
    let (s, v) = c.get("/api/auvik/tenants").await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let want = json!([
        {"id": "1000", "name": "Example IT", "type": "multiClient", "parent": null},
        {"id": "1003", "name": "EX Denied", "type": "client", "parent": "1000"},
        {"id": "1004", "name": "EX Empty", "type": "client", "parent": "1000"},
        {"id": "1001", "name": "EX Main Office", "type": "client", "parent": "1000"},
        {"id": "1002", "name": "EX Warehouse", "type": "client", "parent": "1000"},
    ]);
    assert_eq!(v, want);
}

#[tokio::test]
async fn tenants_fall_back_to_prefix_when_details_fail() {
    let (app, _d, _m) = inv_app(|m| m.detail_fails = true).await;
    let mut c = signed_in(&app).await;
    let (s, v) = c.get("/api/auvik/tenants").await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let names: Vec<String> = v.as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_string()).collect();
    assert_eq!(names, vec!["example-it", "ex-denied", "ex-empty", "ex-main", "ex-warehouse"]);
    assert_eq!(v[0]["type"], "multiClient");
}

#[tokio::test]
async fn pagination_three_pages() {
    let (app, _d, m) = inv_app(|_| {}).await;
    let mut c = signed_in(&app).await;
    let (s, v) = c.get(INV_MAIN).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v, expected_main());
    assert_eq!(v["devices"].as_array().unwrap().len(), 12);
    assert_eq!(m.info_hits.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn rate_limited_then_ok() {
    let (app, _d, m) = inv_app(|m| m.rate_limits = AtomicUsize::new(2)).await;
    let mut c = signed_in(&app).await;
    let (s, v) = c.get(INV_MAIN).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v, expected_main());
    // Two 429 answers, then three device pages, device details and components.
    assert_eq!(m.hits.load(Ordering::SeqCst), 7);
}

#[tokio::test]
async fn busy_after_retries() {
    let (app, _d, m) = inv_app(|m| m.always_429 = true).await;
    let mut c = signed_in(&app).await;
    let (s, v) = c.get(INV_MAIN).await;
    assert_eq!(s, StatusCode::BAD_GATEWAY);
    assert_eq!(v["error"], "Auvik is busy. Try again in a few minutes.");
    // The first try plus five retries.
    assert_eq!(m.hits.load(Ordering::SeqCst), 6);
}

#[tokio::test]
async fn denied_site() {
    let (app, _d, _m) = inv_app(|_| {}).await;
    let mut c = signed_in(&app).await;
    let (s, v) = c.get("/api/auvik/tenants/1003/inventory").await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v, json!({"status": "denied", "note": "Rackwright's Auvik key can't read this site.", "devices": []}));
}

#[tokio::test]
async fn empty_site() {
    let (app, _d, _m) = inv_app(|_| {}).await;
    let mut c = signed_in(&app).await;
    let (s, v) = c.get("/api/auvik/tenants/1004/inventory").await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v, json!({"status": "empty", "note": "No devices found. The site may have no collector.", "devices": []}));
}

#[tokio::test]
async fn warehouse_without_details() {
    let (app, _d, _m) = inv_app(|_| {}).await;
    let mut c = signed_in(&app).await;
    let (s, v) = c.get("/api/auvik/tenants/1002/inventory").await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["status"], "ok");
    let devs = v["devices"].as_array().unwrap();
    assert_eq!(devs.len(), 3);
    assert_eq!(devs[0]["name"], "EX-WSW01");
    assert_eq!(devs[0]["serial"], "");
    assert_eq!(devs[0]["ips"], json!([]));
    assert_eq!(devs[0]["components"], json!([]));
}

#[tokio::test]
async fn missing_fields() {
    let (app, _d, _m) = inv_app(|_| {}).await;
    let mut c = signed_in(&app).await;
    let (s, v) = c.get(INV_MAIN).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let ups = v["devices"].as_array().unwrap().iter().find(|d| d["name"] == "EX-UPS01").unwrap().clone();
    assert_eq!(ups["makeModel"], "");
    assert_eq!(ups["serial"], "");
    assert_eq!(ups["firmware"], "");
    assert_eq!(ups["software"], "");
    assert_eq!(ups["components"], json!([]));
    assert_eq!(ups["ips"], json!(["192.0.2.51"]));
}

#[tokio::test]
async fn next_loop_capped() {
    let (app, _d, m) = inv_app(|m| m.self_loop = true).await;
    let mut c = signed_in(&app).await;
    let (s, v) = c.get(INV_MAIN).await;
    assert_eq!(s, StatusCode::BAD_GATEWAY);
    assert_eq!(v["error"], "Auvik returned too many pages for this site.");
    assert_eq!(m.info_hits.load(Ordering::SeqCst), 50);
}

#[tokio::test]
async fn next_other_host_ignored() {
    let (app, _d, _m) = inv_app(|m| m.other_host = true).await;
    let mut c = signed_in(&app).await;
    let (s, v) = c.get(INV_MAIN).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v, expected_main());
}

#[tokio::test]
async fn bad_site_id_and_signed_out() {
    let (app, _d, _m) = inv_app(|_| {}).await;
    let mut c = signed_in(&app).await;
    let (s, _) = c.get("/api/auvik/tenants/a.b/inventory").await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let mut out = Client::new(&app);
    let (s, _) = out.get("/api/auvik/tenants").await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let (s, _) = out.get(INV_MAIN).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn not_configured_tenants() {
    let (app, _d) = make_app(None);
    let mut c = signed_in(&app).await;
    let (s, v) = c.get("/api/auvik/tenants").await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    assert_eq!(v["error"], "Auvik is not set up on this server.");
    let (s, _) = c.get(INV_MAIN).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn key_never_leaks() {
    // Every response in this file is also checked by `check_body` inside `Client::call`.
    let token = b64(format!("{USER}:{KEY}").as_bytes());
    let (app, _d, _m) = inv_app(|m| m.echo500 = true).await;
    let mut c = signed_in(&app).await;
    let (s, v) = c.get(INV_MAIN).await;
    assert_eq!(s, StatusCode::BAD_GATEWAY);
    assert_eq!(v["error"], "Auvik could not be read. Try again in a few minutes.");
    let lines = log_lines();
    assert!(!lines.is_empty());
    for l in &lines {
        assert!(!l.contains("TESTKEY"), "{l}");
        assert!(!l.contains(&token), "{l}");
    }
}
