use axum::body::Body;
use axum::extract::State;
use axum::http::{header, HeaderMap, Method, Request, StatusCode};
use axum::routing::get;
use axum::Router;
use rackwright_server::auvik::{valid_region, AuvikCfg};
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
