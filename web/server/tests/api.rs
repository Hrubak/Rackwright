use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use axum::Router;
use serde_json::{json, Value};
use tower::ServiceExt;

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
    async fn put(&mut self, uri: &str, body: Value) -> (StatusCode, Value) {
        self.call(Method::PUT, uri, Some(body)).await
    }
    async fn patch(&mut self, uri: &str, body: Value) -> (StatusCode, Value) {
        self.call(Method::PATCH, uri, Some(body)).await
    }
    async fn delete(&mut self, uri: &str) -> (StatusCode, Value) {
        self.call(Method::DELETE, uri, None).await
    }
}

fn make_app() -> (Router, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let app = rackwright_server::build_app(&dir.path().join("data"), &dir.path().join("static")).unwrap();
    (app, dir)
}

fn sample_doc() -> Value {
    json!({
        "v": 2, "nid": 20,
        "racks": [{"id": 1, "name": "R1", "u": 12, "x": 0, "y": 0}],
        "devices": [
            {"id": 2, "name": "sw", "type": "Switch", "u_size": 1, "rack": 1, "u": 1,
             "ports": [{"id": 3, "name": "1", "type": "RJ45", "label": ""}, {"id": 4, "name": "2", "type": "RJ45", "label": ""}]},
            {"id": 5, "name": "pp", "type": "Patch Panel", "u_size": 1, "rack": 1, "u": 5,
             "ports": [{"id": 6, "name": "1", "type": "RJ45", "label": ""}]}
        ],
        "cables": [{"id": 9, "a": 3, "b": 6, "color": "#ff0000"}],
        "custom_field": "keep me"
    })
}

async fn setup_admin(c: &mut Client) -> Value {
    let (s, v) = c.post("/api/setup", json!({"email": "Admin@Example.com", "name": "Ada", "password": "password1"})).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v
}

#[tokio::test]
async fn setup_login_me() {
    let (app, _d) = make_app();
    let mut c = Client::new(&app);

    let (s, v) = c.get("/healthz").await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v, Value::Null); // plain text "ok"

    assert_eq!(c.get("/api/setup").await.1, json!({"needs_setup": true}));
    assert_eq!(c.get("/api/me").await.0, StatusCode::UNAUTHORIZED);

    let user = setup_admin(&mut c).await;
    assert_eq!(user["email"], "admin@example.com");
    assert_eq!(user["is_admin"], true);
    assert_eq!(c.get("/api/setup").await.1, json!({"needs_setup": false}));

    // already signed in by setup
    let (s, me) = c.get("/api/me").await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(me, user);

    // second setup refused
    let (s, _) = c.post("/api/setup", json!({"email": "x@y.z", "name": "X", "password": "password1"})).await;
    assert_eq!(s, StatusCode::CONFLICT);

    // logout, then login with different email case
    assert_eq!(c.post("/api/logout", json!({})).await.0, StatusCode::OK);
    assert_eq!(c.get("/api/me").await.0, StatusCode::UNAUTHORIZED);

    let (s, v) = c.post("/api/login", json!({"email": "admin@example.com", "password": "nope"})).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    assert_eq!(v["error"], "Wrong email or password");

    let (s, v) = c.post("/api/login", json!({"email": "ADMIN@example.com", "password": "password1"})).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(c.get("/api/me").await.1["name"], "Ada");

    // password change
    let (s, _) = c.post("/api/me/password", json!({"current": "wrong", "new": "password2"})).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _) = c.post("/api/me/password", json!({"current": "password1", "new": "short"})).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _) = c.post("/api/me/password", json!({"current": "password1", "new": "password2"})).await;
    assert_eq!(s, StatusCode::OK);
    c.post("/api/logout", json!({})).await;
    let (s, _) = c.post("/api/login", json!({"email": "admin@example.com", "password": "password2"})).await;
    assert_eq!(s, StatusCode::OK);
}

#[tokio::test]
async fn non_admin_forbidden_and_user_management() {
    let (app, _d) = make_app();
    let mut admin = Client::new(&app);
    setup_admin(&mut admin).await;

    let (s, u) = admin
        .post("/api/users", json!({"email": "bob@example.com", "name": "Bob", "password": "bobbobbob", "is_admin": false}))
        .await;
    assert_eq!(s, StatusCode::OK, "{u}");
    let bob_id = u["id"].as_i64().unwrap();
    let (s, _) = admin
        .post("/api/users", json!({"email": "BOB@example.com", "name": "Bob2", "password": "bobbobbob", "is_admin": false}))
        .await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(admin.get("/api/users").await.1.as_array().unwrap().len(), 2);

    let mut bob = Client::new(&app);
    let (s, _) = bob.post("/api/login", json!({"email": "bob@example.com", "password": "bobbobbob"})).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(bob.get("/api/users").await.0, StatusCode::FORBIDDEN);
    assert_eq!(bob.post("/api/users", json!({"email": "c@d.e", "name": "C", "password": "12345678"})).await.0, StatusCode::FORBIDDEN);
    assert_eq!(bob.patch("/api/users/1", json!({"name": "Hax"})).await.0, StatusCode::FORBIDDEN);
    assert_eq!(bob.delete("/api/users/1").await.0, StatusCode::FORBIDDEN);
    // unauthenticated
    assert_eq!(Client::new(&app).get("/api/users").await.0, StatusCode::UNAUTHORIZED);

    // admin promotes and renames Bob, resets password
    let (s, v) = admin.patch(&format!("/api/users/{bob_id}"), json!({"name": "Robert", "is_admin": true, "password": "newpassword"})).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["name"], "Robert");
    assert_eq!(v["is_admin"], true);

    // deleting a user removes their sessions
    let (s, _) = admin.delete(&format!("/api/users/{bob_id}")).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(bob.get("/api/me").await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(admin.delete(&format!("/api/users/{bob_id}")).await.0, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn last_admin_protections() {
    let (app, _d) = make_app();
    let mut admin = Client::new(&app);
    let me = setup_admin(&mut admin).await;
    let my_id = me["id"].as_i64().unwrap();

    // cannot delete self
    assert_eq!(admin.delete(&format!("/api/users/{my_id}")).await.0, StatusCode::BAD_REQUEST);
    // cannot demote the last admin
    let (s, v) = admin.patch(&format!("/api/users/{my_id}"), json!({"is_admin": false})).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");

    // with a second admin, demoting is fine; the remaining one is protected again
    let (_, u2) = admin
        .post("/api/users", json!({"email": "two@example.com", "name": "Two", "password": "twotwotwo", "is_admin": true}))
        .await;
    let id2 = u2["id"].as_i64().unwrap();
    let (s, _) = admin.patch(&format!("/api/users/{id2}"), json!({"is_admin": false})).await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = admin.patch(&format!("/api/users/{my_id}"), json!({"is_admin": false})).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    // user 2 is now a plain user and can't be used to delete the admin
    assert_eq!(admin.delete(&format!("/api/users/{id2}")).await.0, StatusCode::OK);
}

#[tokio::test]
async fn racks_crud_and_conflict() {
    let (app, _d) = make_app();
    let mut a = Client::new(&app);
    setup_admin(&mut a).await;

    assert_eq!(Client::new(&app).get("/api/racks").await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(a.get("/api/racks").await.1, json!([]));

    // invalid doc
    let (s, _) = a.post("/api/racks", json!({"name": "bad", "doc": {"racks": "nope"}})).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    let (s, meta) = a.post("/api/racks", json!({"name": "Lab", "doc": sample_doc()})).await;
    assert_eq!(s, StatusCode::OK, "{meta}");
    assert_eq!(meta["version"], 1);
    assert_eq!(meta["updated_by"], "Ada");
    let id = meta["id"].as_i64().unwrap();

    let (s, full) = a.get(&format!("/api/racks/{id}")).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(full["name"], "Lab");
    assert_eq!(full["doc"]["custom_field"], "keep me");
    assert_eq!(full["doc"]["devices"].as_array().unwrap().len(), 2);

    assert_eq!(a.get("/api/racks").await.1.as_array().unwrap().len(), 1);

    // second user edits
    a.post("/api/users", json!({"email": "bob@example.com", "name": "Bob", "password": "bobbobbob", "is_admin": false})).await;
    let mut b = Client::new(&app);
    b.post("/api/login", json!({"email": "bob@example.com", "password": "bobbobbob"})).await;

    let mut doc2 = sample_doc();
    doc2["nid"] = json!(21);
    let (s, m2) = b.put(&format!("/api/racks/{id}"), json!({"name": "Lab 2", "doc": doc2, "version": 1})).await;
    assert_eq!(s, StatusCode::OK, "{m2}");
    assert_eq!(m2["version"], 2);
    assert_eq!(m2["updated_by"], "Bob");
    assert_eq!(m2["name"], "Lab 2");

    // stale version -> 409
    let (s, c) = a.put(&format!("/api/racks/{id}"), json!({"name": "Mine", "doc": sample_doc(), "version": 1})).await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(c["version"], 2);
    assert_eq!(c["updated_by"], "Bob");
    assert!(c["error"].is_string());

    // missing
    assert_eq!(a.get("/api/racks/9999").await.0, StatusCode::NOT_FOUND);
    assert_eq!(a.put("/api/racks/9999", json!({"name": "x", "doc": sample_doc(), "version": 1})).await.0, StatusCode::NOT_FOUND);

    // delete
    assert_eq!(b.delete(&format!("/api/racks/{id}")).await.0, StatusCode::OK);
    assert_eq!(a.get(&format!("/api/racks/{id}")).await.0, StatusCode::NOT_FOUND);
    assert_eq!(a.delete(&format!("/api/racks/{id}")).await.0, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn clients_sites_and_racks() {
    let (app, _d) = make_app();
    let mut a = Client::new(&app);

    // signed out
    let mut anon = Client::new(&app);
    assert_eq!(anon.get("/api/clients").await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(anon.post("/api/clients", json!({"name": "X"})).await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(anon.patch("/api/sites/1", json!({"name": "X"})).await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(anon.put("/api/racks/1/site", json!({"site_id": null})).await.0, StatusCode::UNAUTHORIZED);

    setup_admin(&mut a).await;
    assert_eq!(a.get("/api/clients").await.1, json!([]));

    // clients: validation, create, duplicate (case-insensitive)
    assert_eq!(a.post("/api/clients", json!({"name": "   "})).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(a.post("/api/clients", json!({"name": "n".repeat(201)})).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(a.post("/api/clients", json!({"name": "Big", "notes": "x".repeat(10_001)})).await.0, StatusCode::BAD_REQUEST);
    let (s, acme) = a.post("/api/clients", json!({"name": "  Acme Dental ", "notes": "Dentist group"})).await;
    assert_eq!(s, StatusCode::OK, "{acme}");
    assert_eq!(acme["name"], "Acme Dental");
    assert_eq!(acme["notes"], "Dentist group");
    assert_eq!(acme["sites"], 0);
    assert_eq!(acme["racks"], 0);
    let acme_id = acme["id"].as_i64().unwrap();
    assert_eq!(a.post("/api/clients", json!({"name": "ACME dental"})).await.0, StatusCode::CONFLICT);
    let (s, beta) = a.post("/api/clients", json!({"name": "beta Logistics"})).await;
    assert_eq!(s, StatusCode::OK, "{beta}");
    assert_eq!(beta["notes"], "");
    let beta_id = beta["id"].as_i64().unwrap();

    // list sorted by name, case-insensitive
    let (_, list) = a.get("/api/clients").await;
    let names: Vec<&str> = list.as_array().unwrap().iter().map(|c| c["name"].as_str().unwrap()).collect();
    assert_eq!(names, vec!["Acme Dental", "beta Logistics"]);

    // patch
    let (s, v) = a.patch(&format!("/api/clients/{acme_id}"), json!({"notes": "Updated"})).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["notes"], "Updated");
    assert_eq!(v["name"], "Acme Dental");
    assert_eq!(a.patch(&format!("/api/clients/{acme_id}"), json!({"name": "BETA logistics"})).await.0, StatusCode::CONFLICT);
    // renaming to its own name in another case is fine
    let (s, v) = a.patch(&format!("/api/clients/{acme_id}"), json!({"name": "ACME Dental"})).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["name"], "ACME Dental");
    assert_eq!(a.patch("/api/clients/9999", json!({"name": "Z"})).await.0, StatusCode::NOT_FOUND);
    assert_eq!(a.get("/api/clients/9999").await.0, StatusCode::NOT_FOUND);

    // sites
    assert_eq!(a.post("/api/clients/9999/sites", json!({"name": "S"})).await.0, StatusCode::NOT_FOUND);
    assert_eq!(a.post(&format!("/api/clients/{acme_id}/sites"), json!({"name": ""})).await.0, StatusCode::BAD_REQUEST);
    let (s, main) = a
        .post(&format!("/api/clients/{acme_id}/sites"), json!({"name": "Main Office", "address": "1 Example Street"}))
        .await;
    assert_eq!(s, StatusCode::OK, "{main}");
    assert_eq!(main["client_id"], acme_id);
    assert_eq!(main["address"], "1 Example Street");
    assert_eq!(main["notes"], "");
    let main_id = main["id"].as_i64().unwrap();
    assert_eq!(
        a.post(&format!("/api/clients/{acme_id}/sites"), json!({"name": "main office"})).await.0,
        StatusCode::CONFLICT
    );
    let (s, branch) = a.post(&format!("/api/clients/{acme_id}/sites"), json!({"name": "Branch"})).await;
    assert_eq!(s, StatusCode::OK, "{branch}");
    let branch_id = branch["id"].as_i64().unwrap();
    // same name under another client is fine
    let (s, beta_main) = a.post(&format!("/api/clients/{beta_id}/sites"), json!({"name": "Main Office"})).await;
    assert_eq!(s, StatusCode::OK, "{beta_main}");
    let beta_main_id = beta_main["id"].as_i64().unwrap();

    // delete client with sites -> 409
    let (s, v) = a.delete(&format!("/api/clients/{acme_id}")).await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(v["error"], "Delete or move its sites first.");

    // racks: create with and without a site
    assert_eq!(
        a.post("/api/racks", json!({"name": "Bad", "doc": sample_doc(), "site_id": 9999})).await.0,
        StatusCode::NOT_FOUND
    );
    let (s, r1) = a.post("/api/racks", json!({"name": "Rack B", "doc": sample_doc(), "site_id": main_id})).await;
    assert_eq!(s, StatusCode::OK, "{r1}");
    assert_eq!(r1["site_id"], main_id);
    assert_eq!(r1["site"], "Main Office");
    assert_eq!(r1["client_id"], acme_id);
    assert_eq!(r1["client"], "ACME Dental");
    assert_eq!(r1["version"], 1);
    let r1_id = r1["id"].as_i64().unwrap();
    let (s, r2) = a.post("/api/racks", json!({"name": "Rack A", "doc": sample_doc()})).await;
    assert_eq!(s, StatusCode::OK, "{r2}");
    assert_eq!(r2["site_id"], Value::Null);
    assert_eq!(r2["site"], "");
    assert_eq!(r2["client_id"], Value::Null);
    assert_eq!(r2["client"], "");
    let r2_id = r2["id"].as_i64().unwrap();

    // GET /api/racks and GET /api/racks/:id carry the new fields
    let (_, racks) = a.get("/api/racks").await;
    let found = racks.as_array().unwrap().iter().find(|r| r["id"] == r1_id).unwrap().clone();
    assert_eq!(found["site"], "Main Office");
    assert_eq!(found["client"], "ACME Dental");
    let (_, full) = a.get(&format!("/api/racks/{r1_id}")).await;
    assert_eq!(full["site_id"], main_id);
    assert_eq!(full["client"], "ACME Dental");
    assert_eq!(full["doc"]["custom_field"], "keep me");

    // PUT /site moves a rack without changing its version
    assert_eq!(a.put(&format!("/api/racks/{r2_id}/site"), json!({"site_id": 9999})).await.0, StatusCode::NOT_FOUND);
    assert_eq!(a.put("/api/racks/9999/site", json!({"site_id": main_id})).await.0, StatusCode::NOT_FOUND);
    let (s, m) = a.put(&format!("/api/racks/{r2_id}/site"), json!({"site_id": branch_id})).await;
    assert_eq!(s, StatusCode::OK, "{m}");
    assert_eq!(m["site"], "Branch");
    assert_eq!(m["version"], 1);
    let (s, m) = a.put(&format!("/api/racks/{r2_id}/site"), json!({"site_id": null})).await;
    assert_eq!(s, StatusCode::OK, "{m}");
    assert_eq!(m["site_id"], Value::Null);
    assert_eq!(m["version"], 1);
    a.put(&format!("/api/racks/{r2_id}/site"), json!({"site_id": branch_id})).await;

    // counts and nested detail (sites and racks by name)
    let (s, detail) = a.get(&format!("/api/clients/{acme_id}")).await;
    assert_eq!(s, StatusCode::OK, "{detail}");
    assert_eq!(detail["sites"].as_array().unwrap().len(), 2);
    assert_eq!(detail["racks"], 2);
    assert_eq!(detail["sites"][0]["name"], "Branch");
    assert_eq!(detail["sites"][0]["racks"][0]["name"], "Rack A");
    assert_eq!(detail["sites"][1]["name"], "Main Office");
    assert_eq!(detail["sites"][1]["racks"][0]["name"], "Rack B");
    let (_, list) = a.get("/api/clients").await;
    assert_eq!(list[0]["sites"], 2);
    assert_eq!(list[0]["racks"], 2);

    // PATCH site: fields, duplicates, moving to another client
    let (s, v) = a.patch(&format!("/api/sites/{main_id}"), json!({"address": "2 Example Street", "notes": "n"})).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["address"], "2 Example Street");
    assert_eq!(v["name"], "Main Office");
    assert_eq!(a.patch(&format!("/api/sites/{main_id}"), json!({"name": "BRANCH"})).await.0, StatusCode::CONFLICT);
    assert_eq!(a.patch(&format!("/api/sites/{main_id}"), json!({"client_id": 9999})).await.0, StatusCode::NOT_FOUND);
    assert_eq!(a.patch("/api/sites/9999", json!({"name": "Z"})).await.0, StatusCode::NOT_FOUND);
    // moving "Main Office" to beta collides with beta's own "Main Office"
    assert_eq!(a.patch(&format!("/api/sites/{main_id}"), json!({"client_id": beta_id})).await.0, StatusCode::CONFLICT);
    // moving "Branch" works and takes its rack along
    let (s, v) = a.patch(&format!("/api/sites/{branch_id}"), json!({"client_id": beta_id})).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["client_id"], beta_id);
    let (_, m) = a.get(&format!("/api/racks/{r2_id}")).await;
    assert_eq!(m["client"], "beta Logistics");
    assert_eq!(m["site"], "Branch");

    // delete a site: its rack stays, becomes unassigned
    let (s, _) = a.delete(&format!("/api/sites/{main_id}")).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(a.delete(&format!("/api/sites/{main_id}")).await.0, StatusCode::NOT_FOUND);
    let (s, m) = a.get(&format!("/api/racks/{r1_id}")).await;
    assert_eq!(s, StatusCode::OK, "{m}");
    assert_eq!(m["site_id"], Value::Null);
    assert_eq!(m["site"], "");
    assert_eq!(m["client"], "");

    // acme has no sites now: delete works; beta (with sites) still refuses
    assert_eq!(a.delete(&format!("/api/clients/{acme_id}")).await.0, StatusCode::OK);
    assert_eq!(a.get(&format!("/api/clients/{acme_id}")).await.0, StatusCode::NOT_FOUND);
    assert_eq!(a.delete(&format!("/api/clients/{beta_id}")).await.0, StatusCode::CONFLICT);
    assert_eq!(a.delete(&format!("/api/sites/{beta_main_id}")).await.0, StatusCode::OK);
}

#[tokio::test]
async fn site_links() {
    let (app, _d) = make_app();
    let mut a = Client::new(&app);
    let mut anon = Client::new(&app);
    assert_eq!(anon.post("/api/clients/1/links", json!({"site_a": 1, "kind": "VPN"})).await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(anon.patch("/api/links/1", json!({"kind": "VPN"})).await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(anon.delete("/api/links/1").await.0, StatusCode::UNAUTHORIZED);

    setup_admin(&mut a).await;
    let (_, c1) = a.post("/api/clients", json!({"name": "Acme Dental"})).await;
    let c1 = c1["id"].as_i64().unwrap();
    let (_, c2) = a.post("/api/clients", json!({"name": "Beta Logistics"})).await;
    let c2 = c2["id"].as_i64().unwrap();
    let (_, sa) = a.post(&format!("/api/clients/{c1}/sites"), json!({"name": "Main Office"})).await;
    let sa = sa["id"].as_i64().unwrap();
    let (_, sb) = a.post(&format!("/api/clients/{c1}/sites"), json!({"name": "Branch"})).await;
    let sb = sb["id"].as_i64().unwrap();
    let (_, so) = a.post(&format!("/api/clients/{c2}/sites"), json!({"name": "Depot"})).await;
    let so = so["id"].as_i64().unwrap();

    // create A-B with ends
    let end_a = json!({"rack": 1, "dev": 7, "name": "edge-fw"});
    let end_b = json!({"rack": "branch.rack.json", "dev": 3, "name": "branch-rtr"});
    let (s, l1) = a
        .post(
            &format!("/api/clients/{c1}/links"),
            json!({"site_a": sa, "site_b": sb, "kind": " VPN ", "provider": "ExampleNet", "bandwidth": "100M", "a_end": end_a, "b_end": end_b}),
        )
        .await;
    assert_eq!(s, StatusCode::OK, "{l1}");
    assert_eq!(l1["kind"], "VPN");
    assert_eq!(l1["client_id"], c1);
    assert_eq!(l1["circuit"], "");
    assert_eq!(l1["notes"], "");
    assert_eq!(l1["a_end"], end_a);
    assert_eq!(l1["b_end"], end_b);
    let l1_id = l1["id"].as_i64().unwrap();

    // A-Internet, no ends
    let (s, l2) = a.post(&format!("/api/clients/{c1}/links"), json!({"site_a": sa, "site_b": null, "kind": "Internet"})).await;
    assert_eq!(s, StatusCode::OK, "{l2}");
    assert!(l2["site_b"].is_null());
    assert!(l2["a_end"].is_null());
    assert!(l2["b_end"].is_null());
    let l2_id = l2["id"].as_i64().unwrap();

    // client shows both, by id
    let (_, cl) = a.get(&format!("/api/clients/{c1}")).await;
    let ids: Vec<i64> = cl["links"].as_array().unwrap().iter().map(|l| l["id"].as_i64().unwrap()).collect();
    assert_eq!(ids, vec![l1_id, l2_id]);
    let (_, other) = a.get(&format!("/api/clients/{c2}")).await;
    assert_eq!(other["links"], json!([]));

    // patch: bandwidth changes, a_end kept
    let (s, v) = a.patch(&format!("/api/links/{l1_id}"), json!({"bandwidth": "1G"})).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["bandwidth"], "1G");
    assert_eq!(v["a_end"], end_a);
    assert_eq!(v["site_b"], sb);
    // explicit null clears site_b and an end
    let (s, v) = a.patch(&format!("/api/links/{l1_id}"), json!({"site_b": null, "b_end": null})).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(v["site_b"].is_null());
    assert!(v["b_end"].is_null());
    assert_eq!(v["a_end"], end_a);
    assert_eq!(v["provider"], "ExampleNet");

    // validation
    let url = format!("/api/clients/{c1}/links");
    assert_eq!(a.post(&url, json!({"site_a": sa, "site_b": sa, "kind": "VPN"})).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(a.post(&url, json!({"site_a": sa, "site_b": so, "kind": "VPN"})).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(a.post(&url, json!({"site_a": so, "kind": "VPN"})).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(a.post(&url, json!({"site_a": sa, "kind": "  "})).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(a.post(&url, json!({"site_a": sa, "kind": "k".repeat(41)})).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(a.post(&url, json!({"site_a": sa, "kind": "VPN", "a_end": {"rack": 1}})).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(a.patch(&format!("/api/links/{l1_id}"), json!({"site_b": sa})).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(a.patch(&format!("/api/links/{l1_id}"), json!({"site_b": so})).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(a.patch(&format!("/api/links/{l1_id}"), json!({"kind": ""})).await.0, StatusCode::BAD_REQUEST);

    // 404s
    assert_eq!(a.post("/api/clients/9999/links", json!({"site_a": sa, "kind": "VPN"})).await.0, StatusCode::NOT_FOUND);
    assert_eq!(a.patch("/api/links/9999", json!({"kind": "VPN"})).await.0, StatusCode::NOT_FOUND);
    assert_eq!(a.delete("/api/links/9999").await.0, StatusCode::NOT_FOUND);

    // delete one link
    assert_eq!(a.delete(&format!("/api/links/{l2_id}")).await.0, StatusCode::OK);
    assert_eq!(a.delete(&format!("/api/links/{l2_id}")).await.0, StatusCode::NOT_FOUND);

    // deleting a site removes its links
    let (_, l3) = a.post(&url, json!({"site_a": sa, "site_b": sb, "kind": "Fiber"})).await;
    assert!(l3["id"].is_i64(), "{l3}");
    assert_eq!(a.delete(&format!("/api/sites/{sb}")).await.0, StatusCode::OK);
    let (_, cl) = a.get(&format!("/api/clients/{c1}")).await;
    // l3 (A-B) is gone; l1 (A-Internet since the patch) stays
    let ids: Vec<i64> = cl["links"].as_array().unwrap().iter().map(|l| l["id"].as_i64().unwrap()).collect();
    assert_eq!(ids, vec![l1_id]);

    // moving a site to another client removes its links
    let (_, l4) = a.post(&url, json!({"site_a": sa, "kind": "Internet"})).await;
    assert!(l4["id"].is_i64(), "{l4}");
    let (s, v) = a.patch(&format!("/api/sites/{sa}"), json!({"client_id": c2})).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (_, cl) = a.get(&format!("/api/clients/{c1}")).await;
    assert_eq!(cl["links"], json!([]));
}

#[tokio::test]
async fn compute_endpoints() {
    let (app, _d) = make_app();
    let mut a = Client::new(&app);

    // needs a session
    assert_eq!(a.post("/api/route_cables", json!({"doc": sample_doc(), "face": "front"})).await.0, StatusCode::UNAUTHORIZED);

    setup_admin(&mut a).await;
    let (s, v) = a.post("/api/route_cables", json!({"doc": sample_doc(), "face": "front"})).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(v["routes"].is_array());
    assert!(v["hints"].is_array());

    let (s, v) = a.post("/api/port_positions", json!({"doc": sample_doc()})).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let arr = v.as_array().unwrap();
    assert_eq!(arr.len(), 3);
    assert_eq!(arr[0].as_array().unwrap().len(), 4);

    // bad body -> JSON error
    let (s, v) = a.post("/api/route_cables", json!({"nope": 1})).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert!(v["error"].is_string());

    // unknown API path is a JSON 404, not the SPA index
    let (s, v) = a.get("/api/does-not-exist").await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    assert!(v["error"].is_string());
}

#[tokio::test]
async fn admin_update_outside_lxc() {
    let (app, _d) = make_app();
    let mut admin = Client::new(&app);
    setup_admin(&mut admin).await;
    let (s, _) = admin.post("/api/users", json!({"email": "u@example.com", "name": "U", "password": "password1", "is_admin": false})).await;
    assert_eq!(s, StatusCode::OK);
    let mut user = Client::new(&app);
    assert_eq!(user.post("/api/login", json!({"email": "u@example.com", "password": "password1"})).await.0, StatusCode::OK);

    // admin only
    assert_eq!(user.get("/api/admin/update").await.0, StatusCode::FORBIDDEN);
    assert_eq!(user.post("/api/admin/update", json!({})).await.0, StatusCode::FORBIDDEN);
    assert_eq!(user.post("/api/admin/update/check", json!({})).await.0, StatusCode::FORBIDDEN);
    assert_eq!(Client::new(&app).get("/api/admin/update").await.0, StatusCode::UNAUTHORIZED);

    // CI and dev machines are not the LXC: status says so and nothing runs
    let (s, v) = admin.get("/api/admin/update").await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["available"], false);
    assert_eq!(v["state"], "idle");
    assert_eq!(v["version"], env!("CARGO_PKG_VERSION"));
    assert!(v["reason"].as_str().unwrap().contains("LXC"));
    assert_eq!(admin.post("/api/admin/update", json!({})).await.0, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(admin.post("/api/admin/update/check", json!({})).await.0, StatusCode::SERVICE_UNAVAILABLE);
}

// ---------------------------------------------------------------- 3.7.0 settings

impl Client {
    /// Raw-bytes request with an optional content type; returns status, headers and body.
    async fn raw(
        &mut self,
        method: Method,
        uri: &str,
        content_type: Option<&str>,
        body: Vec<u8>,
    ) -> (StatusCode, axum::http::HeaderMap, Vec<u8>) {
        let mut b = Request::builder().method(method).uri(uri);
        if let Some(c) = &self.cookie {
            b = b.header(header::COOKIE, c.as_str());
        }
        if let Some(ct) = content_type {
            b = b.header(header::CONTENT_TYPE, ct);
        }
        let req = b.body(Body::from(body)).unwrap();
        let resp = self.app.clone().oneshot(req).await.unwrap();
        let status = resp.status();
        let headers = resp.headers().clone();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        (status, headers, bytes.to_vec())
    }
}

async fn make_member(app: &Router, admin: &mut Client, email: &str) -> Client {
    let (s, v) = admin
        .post("/api/users", json!({"email": email, "name": "Member", "password": "password1", "is_admin": false}))
        .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let mut c = Client::new(app);
    let (s, v) = c.post("/api/login", json!({"email": email, "password": "password1"})).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    c
}

#[tokio::test]
async fn settings_roundtrip() {
    let (app, _d) = make_app();
    let mut admin = Client::new(&app);
    setup_admin(&mut admin).await;
    let mut user = make_member(&app, &mut admin, "u@example.com").await;
    let mut anon = Client::new(&app);

    assert_eq!(anon.get("/api/settings").await.0, StatusCode::UNAUTHORIZED);
    let (s, v) = user.get("/api/settings").await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v, json!({"settings": {}, "assets": []}));

    let body = json!({"company_name": "Example IT", "accent": "#336699", "extra": {"a": 1}});
    let (s, v) = admin.put("/api/settings", body.clone()).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v, body);
    let (s, v) = user.get("/api/settings").await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["settings"], body);
    assert_eq!(v["settings"]["extra"]["a"], 1);

    assert_eq!(user.put("/api/settings", json!({"company_name": "X"})).await.0, StatusCode::FORBIDDEN);
    assert_eq!(anon.put("/api/settings", json!({})).await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(admin.put("/api/settings", json!({"accent": "blue"})).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(admin.put("/api/settings", json!({"accent": "#12345"})).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(admin.put("/api/settings", json!({"rack_default_u": 99})).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(admin.put("/api/settings", json!({"rack_default_u": 0})).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(admin.put("/api/settings", json!({"company_name": "x".repeat(101)})).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(admin.put("/api/settings", json!([1])).await.0, StatusCode::BAD_REQUEST);
    // the refused requests changed nothing
    assert_eq!(admin.get("/api/settings").await.1["settings"], body);
    let ok = json!({"rack_default_model": "Generic 19in", "rack_default_u": 42});
    assert_eq!(admin.put("/api/settings", ok).await.0, StatusCode::OK);
    assert_eq!(admin.get("/api/settings").await.1["settings"]["rack_default_u"], 42);
}

#[tokio::test]
async fn logo_upload() {
    let (app, _d) = make_app();
    let mut admin = Client::new(&app);
    setup_admin(&mut admin).await;
    let mut user = make_member(&app, &mut admin, "u@example.com").await;
    let mut anon = Client::new(&app);

    assert_eq!(admin.put("/api/settings", json!({"company_name": "Example IT"})).await.0, StatusCode::OK);
    let (s, v) = anon.get("/api/branding").await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["has_logo"], false);
    assert_eq!(v["company_name"], "Example IT");
    assert_eq!(v["accent"], Value::Null);
    assert_eq!(anon.get("/api/branding/logo").await.0, StatusCode::NOT_FOUND);

    let png = vec![7u8; 10];
    let (s, _, b) = admin.raw(Method::PUT, "/api/assets/logo", Some("image/png"), png.clone()).await;
    assert_eq!(s, StatusCode::OK);
    let v: Value = serde_json::from_slice(&b).unwrap();
    assert_eq!(v["name"], "logo");
    assert_eq!(v["mime"], "image/png");
    assert_eq!(v["size"], 10);

    let (s, v) = anon.get("/api/branding").await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["has_logo"], true);
    assert_eq!(v["company_name"], "Example IT");

    let (s, h, b) = anon.raw(Method::GET, "/api/branding/logo", None, Vec::new()).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(h.get(header::CONTENT_TYPE).unwrap(), "image/png");
    assert_eq!(h.get(header::X_CONTENT_TYPE_OPTIONS).unwrap(), "nosniff");
    assert_eq!(h.get(header::CONTENT_SECURITY_POLICY).unwrap(), "default-src 'none'; style-src 'unsafe-inline'");
    assert_eq!(b, png);

    // the signed-in asset route serves the same bytes; signed out is refused
    let (s, h, b) = user.raw(Method::GET, "/api/assets/logo", None, Vec::new()).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(h.get(header::CONTENT_TYPE).unwrap(), "image/png");
    assert_eq!(b, png);
    assert_eq!(anon.get("/api/assets/logo").await.0, StatusCode::UNAUTHORIZED);

    // listed in settings
    let (_, v) = user.get("/api/settings").await;
    assert_eq!(v["assets"][0]["name"], "logo");
    assert_eq!(v["assets"][0]["size"], 10);

    // SVG is accepted (charset parameter ignored) and keeps its type
    let svg = b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>".to_vec();
    let (s, _, _) = admin.raw(Method::PUT, "/api/assets/logo", Some("image/svg+xml; charset=utf-8"), svg).await;
    assert_eq!(s, StatusCode::OK);
    let (_, h, _) = anon.raw(Method::GET, "/api/branding/logo", None, Vec::new()).await;
    assert_eq!(h.get(header::CONTENT_TYPE).unwrap(), "image/svg+xml");

    // refused uploads
    let (s, _, _) = admin.raw(Method::PUT, "/api/assets/logo", Some("text/html"), b"<script>".to_vec()).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _, _) = admin.raw(Method::PUT, "/api/assets/logo", None, png.clone()).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let big = vec![0u8; 2 * 1024 * 1024 + 1];
    let (s, _, _) = admin.raw(Method::PUT, "/api/assets/logo", Some("image/png"), big).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _, _) = admin.raw(Method::PUT, "/api/assets/nope", Some("image/png"), png.clone()).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _, _) = user.raw(Method::PUT, "/api/assets/logo", Some("image/png"), png.clone()).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _, _) = anon.raw(Method::PUT, "/api/assets/logo", Some("image/png"), png.clone()).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    assert_eq!(user.delete("/api/assets/logo").await.0, StatusCode::FORBIDDEN);
    assert_eq!(anon.delete("/api/assets/logo").await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(admin.get("/api/assets/nope").await.0, StatusCode::NOT_FOUND);
    // the failed uploads left the logo in place
    assert_eq!(anon.get("/api/branding").await.1["has_logo"], true);

    assert_eq!(admin.delete("/api/assets/logo").await.0, StatusCode::OK);
    assert_eq!(admin.delete("/api/assets/logo").await.0, StatusCode::OK); // also when absent
    assert_eq!(anon.get("/api/branding").await.1["has_logo"], false);
    assert_eq!(anon.get("/api/branding/logo").await.0, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn me_patch_and_prefs() {
    let (app, _d) = make_app();
    let mut admin = Client::new(&app);
    setup_admin(&mut admin).await;
    let mut u = make_member(&app, &mut admin, "u@example.com").await;
    let mut anon = Client::new(&app);

    assert_eq!(anon.patch("/api/me", json!({"name": "X"})).await.0, StatusCode::UNAUTHORIZED);
    let (s, v) = u.patch("/api/me", json!({"name": "Grace"})).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["name"], "Grace");
    assert_eq!(v["email"], "u@example.com");
    assert_eq!(u.patch("/api/me", json!({"name": "  "})).await.0, StatusCode::BAD_REQUEST);

    // email needs the current password
    assert_eq!(u.patch("/api/me", json!({"email": "new@example.com"})).await.0, StatusCode::BAD_REQUEST);
    let (s, _) = u.patch("/api/me", json!({"email": "new@example.com", "current_password": "wrong-pw"})).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _) = u.patch("/api/me", json!({"email": "not-an-email", "current_password": "password1"})).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    // taken by the admin, in a different case
    let (s, _) = u.patch("/api/me", json!({"email": "ADMIN@example.com", "current_password": "password1"})).await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(u.get("/api/me").await.1["email"], "u@example.com");

    let (s, v) = u.patch("/api/me", json!({"email": "New@Example.com", "current_password": "password1"})).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["email"], "new@example.com");
    let (s, me) = u.get("/api/me").await; // the session keeps working
    assert_eq!(s, StatusCode::OK);
    assert_eq!(me["email"], "new@example.com");
    assert_eq!(me["name"], "Grace");
    // your own address again is not a conflict
    let (s, _) = u.patch("/api/me", json!({"email": "new@example.com", "current_password": "password1"})).await;
    assert_eq!(s, StatusCode::OK);
    // sign in with the new address
    let mut again = Client::new(&app);
    let (s, _) = again.post("/api/login", json!({"email": "new@example.com", "password": "password1"})).await;
    assert_eq!(s, StatusCode::OK);

    // preferences
    assert_eq!(anon.get("/api/me/prefs").await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(anon.put("/api/me/prefs", json!({})).await.0, StatusCode::UNAUTHORIZED);
    let (s, v) = u.get("/api/me/prefs").await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v, json!({}));
    let prefs = json!({"units": "in", "x": {"y": 1}});
    let (s, v) = u.put("/api/me/prefs", prefs.clone()).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v, prefs);
    assert_eq!(u.get("/api/me/prefs").await.1, prefs);
    // other users keep their own
    assert_eq!(admin.get("/api/me/prefs").await.1, json!({}));
    assert_eq!(u.put("/api/me/prefs", json!([1])).await.0, StatusCode::BAD_REQUEST);
    let huge = json!({"pad": "x".repeat(17 * 1024)});
    assert_eq!(u.put("/api/me/prefs", huge).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(u.get("/api/me/prefs").await.1, prefs);
}
