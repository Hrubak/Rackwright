//! Admin "Update server" (see web/API.md, "Server update").
//!
//! Only works in the Rackwright LXC: the app is a git checkout in `RW_APP_DIR` (default
//! `/opt/rackwright`) and systemd runs the server. The update runs the same script as the
//! `update` command (`proxmox/ct/rackwright.sh`), in its own transient systemd unit so it keeps
//! running when it restarts `rackwright.service`. Output goes to `<RW_DATA>/update.log`, the
//! result to `<RW_DATA>/update.state` ("running|ok|failed <unix time>").

use std::path::{Path as FsPath, PathBuf};
use std::process::Command;

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::Json;
use serde::Serialize;

use super::{auth_admin, json_ok, now_unix, ApiError, ApiResult, Shared};

const UNIT: &str = "rackwright-update";
const DEFAULT_BRANCH: &str = "web";
const LOG_LINES: usize = 200;

pub struct UpdateCfg {
    app_dir: PathBuf,
    log: PathBuf,
    state: PathBuf,
}

impl UpdateCfg {
    pub fn new(data_dir: &FsPath) -> Self {
        let app_dir = std::env::var("RW_APP_DIR").unwrap_or_else(|_| "/opt/rackwright".into());
        UpdateCfg {
            app_dir: PathBuf::from(app_dir),
            log: data_dir.join("update.log"),
            state: data_dir.join("update.state"),
        }
    }

    fn script(&self) -> PathBuf {
        self.app_dir.join("proxmox/ct/rackwright.sh")
    }

    /// None when updating from the web can work here, otherwise why not.
    fn unavailable(&self) -> Option<&'static str> {
        if !cfg!(target_os = "linux")
            || !self.app_dir.join(".git").exists()
            || !self.script().is_file()
            || find_systemd_run().is_none()
        {
            return Some(
                "Updating from the web works only in the Rackwright LXC. Run update inside the container instead.",
            );
        }
        None
    }

    fn git(&self, args: &[&str]) -> Option<String> {
        let out = Command::new("git").arg("-C").arg(&self.app_dir).args(args).output().ok()?;
        if !out.status.success() {
            return None;
        }
        Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
    }

    fn branch(&self) -> String {
        match self.git(&["rev-parse", "--abbrev-ref", "HEAD"]) {
            Some(b) if !b.is_empty() && b != "HEAD" => b,
            _ => DEFAULT_BRANCH.to_string(),
        }
    }
}

fn find_systemd_run() -> Option<&'static str> {
    ["/usr/bin/systemd-run", "/bin/systemd-run"].into_iter().find(|p| FsPath::new(p).exists())
}

fn unit_active() -> bool {
    Command::new("systemctl")
        .args(["is-active", "--quiet", UNIT])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Remove ANSI colour codes and carriage-return redraws so the log reads as plain text.
fn plain(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        if c == '\u{1b}' {
            if it.peek() == Some(&'[') {
                it.next();
                for d in it.by_ref() {
                    if d.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        if c != '\r' {
            out.push(c);
        }
    }
    out
}

fn log_tail(path: &FsPath) -> String {
    let Ok(raw) = std::fs::read(path) else { return String::new() };
    let text = plain(&String::from_utf8_lossy(&raw));
    let lines: Vec<&str> = text.lines().collect();
    let from = lines.len().saturating_sub(LOG_LINES);
    lines[from..].join("\n")
}

/// Changelog sections above the heading for `current` (the entries the update would bring).
fn changes_since(changelog: &str, current: &str) -> String {
    let mut out = Vec::new();
    let mut started = false;
    for line in changelog.lines() {
        if line.starts_with("## ") {
            let ver = line[3..].trim_start_matches('v').split_whitespace().next().unwrap_or("");
            if ver == current {
                break;
            }
            started = true;
        }
        if started {
            out.push(line);
        }
    }
    out.join("\n").trim().to_string()
}

fn toml_version(cargo_toml: &str) -> String {
    let mut in_pkg = false;
    for line in cargo_toml.lines() {
        let t = line.trim();
        if t.starts_with('[') {
            in_pkg = t == "[package]";
            continue;
        }
        if in_pkg {
            if let Some(rest) = t.strip_prefix("version") {
                let v = rest.trim_start().trim_start_matches('=').trim().trim_matches('"');
                return v.to_string();
            }
        }
    }
    String::new()
}

#[derive(Serialize)]
struct Status {
    available: bool,
    reason: String,
    version: String,
    commit: String,
    branch: String,
    repo: String,
    /// "idle" (never run), "running", "ok", "failed"
    state: String,
    /// RFC 3339 time of the last state change, empty when idle
    since: String,
    log: String,
}

fn rfc3339(unix: i64) -> String {
    use time::format_description::well_known::Rfc3339;
    time::OffsetDateTime::from_unix_timestamp(unix)
        .ok()
        .and_then(|t| t.format(&Rfc3339).ok())
        .unwrap_or_default()
}

fn read_status(cfg: &UpdateCfg) -> Status {
    let reason = cfg.unavailable();
    let available = reason.is_none();
    let (mut state, mut since) = ("idle".to_string(), String::new());
    if let Ok(s) = std::fs::read_to_string(&cfg.state) {
        let mut parts = s.split_whitespace();
        if let Some(st) = parts.next() {
            state = st.to_string();
            since = parts.next().and_then(|t| t.parse().ok()).map(rfc3339).unwrap_or_default();
        }
    }
    if available {
        if unit_active() {
            state = "running".into();
        } else if state == "running" {
            // The unit is gone but never wrote a result: it was stopped or the container restarted.
            state = "failed".into();
        }
    }
    Status {
        available,
        reason: reason.unwrap_or("").to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        commit: if available { cfg.git(&["rev-parse", "--short", "HEAD"]).unwrap_or_default() } else { String::new() },
        branch: if available { cfg.branch() } else { String::new() },
        repo: if available { cfg.git(&["remote", "get-url", "origin"]).unwrap_or_default() } else { String::new() },
        state,
        since,
        log: log_tail(&cfg.log),
    }
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, ApiError> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Update task failed"))
}

/// GET /api/admin/update
pub async fn get_update(State(st): State<Shared>, headers: HeaderMap) -> ApiResult {
    auth_admin(&st, &headers)?;
    let s = st.clone();
    let status = blocking(move || read_status(&s.update)).await?;
    Ok(json_ok(&status))
}

#[derive(Serialize)]
struct Check {
    version: String,
    commit: String,
    latest_version: String,
    latest_commit: String,
    latest_date: String,
    latest_subject: String,
    update_available: bool,
    changes: String,
}

fn do_check(cfg: &UpdateCfg) -> Result<Check, ApiError> {
    if let Some(r) = cfg.unavailable() {
        return Err(ApiError::new(StatusCode::SERVICE_UNAVAILABLE, r));
    }
    if unit_active() {
        return Err(ApiError::new(StatusCode::CONFLICT, "An update is running. Wait for it to finish."));
    }
    let branch = cfg.branch();
    let remote_ref = format!("refs/remotes/origin/{branch}");
    let refspec = format!("+refs/heads/{branch}:{remote_ref}");
    let fetched = Command::new("git")
        .arg("-C")
        .arg(&cfg.app_dir)
        .args(["-c", "http.lowSpeedLimit=1000", "-c", "http.lowSpeedTime=20"])
        .args(["fetch", "--quiet", "--depth", "1", "origin", &refspec])
        .output()
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Could not run git"))?;
    if !fetched.status.success() {
        let why = String::from_utf8_lossy(&fetched.stderr).trim().to_string();
        eprintln!("update check: git fetch failed: {why}");
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("Could not reach the repository. Check the container's internet access. ({why})"),
        ));
    }
    let current = env!("CARGO_PKG_VERSION").to_string();
    let head = cfg.git(&["rev-parse", "HEAD"]).unwrap_or_default();
    let latest = cfg.git(&["rev-parse", &remote_ref]).unwrap_or_default();
    let info = cfg.git(&["log", "-1", "--format=%cI%x09%s", &remote_ref]).unwrap_or_default();
    let (date, subject) = info.split_once('\t').unwrap_or((info.as_str(), ""));
    let toml = cfg.git(&["show", &format!("{remote_ref}:web/server/Cargo.toml")]).unwrap_or_default();
    let log = cfg.git(&["show", &format!("{remote_ref}:CHANGELOG.md")]).unwrap_or_default();
    let short = |c: &str| c.chars().take(7).collect::<String>();
    Ok(Check {
        version: current.clone(),
        commit: short(&head),
        latest_version: toml_version(&toml),
        latest_commit: short(&latest),
        latest_date: date.to_string(),
        latest_subject: subject.to_string(),
        update_available: !latest.is_empty() && latest != head,
        changes: changes_since(&log, &current),
    })
}

/// POST /api/admin/update/check
pub async fn post_check(State(st): State<Shared>, headers: HeaderMap) -> ApiResult {
    auth_admin(&st, &headers)?;
    let s = st.clone();
    let check = blocking(move || do_check(&s.update)).await??;
    Ok(json_ok(&check))
}

fn do_start(cfg: &UpdateCfg) -> Result<(), ApiError> {
    if let Some(r) = cfg.unavailable() {
        return Err(ApiError::new(StatusCode::SERVICE_UNAVAILABLE, r));
    }
    if unit_active() {
        return Err(ApiError::new(StatusCode::CONFLICT, "An update is already running."));
    }
    let run = find_systemd_run().unwrap_or("systemd-run");
    let _ = std::fs::write(&cfg.log, "");
    std::fs::write(&cfg.state, format!("running {}\n", now_unix()))
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Could not write to the data folder"))?;
    // The script restarts rackwright.service at the end, so it must not run inside it.
    const WRAPPER: &str = r#"if RW_UPDATE_FROM_WEB=1 bash "$1" >"$2" 2>&1; then r=ok; else r=failed; fi; echo "$r $(date +%s)" >"$3""#;
    let home = std::env::var("HOME").unwrap_or_else(|_| "/root".into());
    let out = Command::new(run)
        .args(["--unit", UNIT, "--collect", "--quiet"])
        .arg(format!("--setenv=HOME={home}"))
        .args(["/bin/bash", "-c", WRAPPER, "rackwright-update"])
        .arg(cfg.script())
        .arg(&cfg.log)
        .arg(&cfg.state)
        .output()
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Could not start the update"))?;
    if !out.status.success() {
        let why = String::from_utf8_lossy(&out.stderr).trim().to_string();
        eprintln!("update start: systemd-run failed: {why}");
        let _ = std::fs::write(&cfg.state, format!("failed {}\n", now_unix()));
        return Err(ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, format!("Could not start the update ({why})")));
    }
    Ok(())
}

/// POST /api/admin/update
pub async fn post_update(State(st): State<Shared>, headers: HeaderMap) -> ApiResult {
    let me = auth_admin(&st, &headers)?;
    let s = st.clone();
    blocking(move || do_start(&s.update)).await??;
    println!("update started by {}", me.email);
    Ok((StatusCode::ACCEPTED, Json(serde_json::json!({}))).into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_colours() {
        assert_eq!(plain("\u{1b}[1;92m✓\u{1b}[m Done\r\n"), "✓ Done\n");
    }

    #[test]
    fn changelog_since() {
        let log = "# Changelog\n\nintro\n\n## 2.9.0 — d\n- c\n\n## 2.8.0 — d\n- b\n\n## 2.7.0 — d\n- a\n";
        assert_eq!(changes_since(log, "2.8.0"), "## 2.9.0 — d\n- c");
        assert_eq!(changes_since(log, "2.9.0"), "");
    }

    #[test]
    fn reads_package_version() {
        let t = "[package]\nname = \"x\"\nversion = \"2.8.0\"\n[dependencies]\nversion = \"1\"\n";
        assert_eq!(toml_version(t), "2.8.0");
    }
}
