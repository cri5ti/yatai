//! Read-only Codex activity and quota observations. Never returns conversation text or credentials.
//! Rollouts are an internal format: unknown events and incomplete final lines are ignored.
use serde::{Deserialize, Serialize};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

#[derive(Default, Deserialize)]
struct Record {
    #[serde(default)]
    timestamp: String,
    #[serde(rename = "type", default)]
    kind: String,
    #[serde(default)]
    payload: Payload,
}
#[derive(Default, Deserialize)]
struct Payload {
    id: Option<String>,
    cwd: Option<String>,
    originator: Option<String>,
    #[serde(rename = "type")]
    kind: Option<String>,
    rate_limits: Option<Limits>,
}
#[derive(Deserialize)]
struct Limits { primary: Option<Window>, secondary: Option<Window> }
#[derive(Deserialize)]
struct Window { used_percent: f64, window_minutes: Option<u64>, resets_at: Option<u64> }
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
struct Quota { left: f64, limit: u32, reset: u64, label: String, observed_at: u64 }
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
struct Session { session_id: String, cwd: String, name: String, client: String, branch: String, state: String, state_at: u64 }
#[derive(Serialize, Default)]
struct Report { sessions: Vec<Session>, quotas: Vec<Quota> }

fn ms(s: &str) -> u64 {
    chrono::DateTime::parse_from_rfc3339(s).ok().map(|d| d.timestamp_millis().max(0) as u64).unwrap_or(0)
}
fn parse(head: &str, tail: &str, now: u64) -> Option<(Session, Vec<Quota>)> {
    let meta: Record = serde_json::from_str(head.lines().next()?).ok()?;
    if meta.kind != "session_meta" { return None; }
    let cwd = meta.payload.cwd.unwrap_or_default();
    let mut s = Session {
        session_id: meta.payload.id?, name: cwd.rsplit(['/', '\\']).find(|p| !p.is_empty()).unwrap_or("Codex session").to_string(),
        cwd, client: meta.payload.originator.unwrap_or_else(|| "Codex".into()), branch: String::new(),
        state: "ended".into(), state_at: ms(&meta.timestamp),
    };
    let mut quotas = Vec::new();
    for line in tail.lines() {
        let Ok(r) = serde_json::from_str::<Record>(line) else { continue };
        if r.kind != "event_msg" { continue; }
        let at = ms(&r.timestamp);
        let next = match r.payload.kind.as_deref() {
            Some("task_started" | "turn_started" | "user_message") => Some("working"),
            Some("task_complete" | "task_completed" | "turn_complete" | "turn_aborted") => Some("idle"),
            _ => None,
        };
        if let Some(next) = next { s.state = next.into(); s.state_at = at; }
        if let Some(limits) = r.payload.rate_limits {
            quotas = [limits.primary, limits.secondary].into_iter().flatten().filter_map(|w| {
                if !w.used_percent.is_finite() { return None; }
                Some(Quota { left: (100.0 - w.used_percent).clamp(0.0, 100.0), limit: 100,
                    reset: w.resets_at.unwrap_or(0).saturating_mul(1000), observed_at: at,
                    label: match w.window_minutes { Some(m) if m % 1440 == 0 => format!("{}d", m / 1440), Some(m) if m % 60 == 0 => format!("{}h", m / 60), Some(m) => format!("{m}m"), None => "Usage".into() } })
            }).collect();
        }
    }
    // A log cannot prove the process is still alive. Do not leave an abandoned turn working forever.
    if s.state == "working" && now.saturating_sub(s.state_at) > 30 * 60_000 { s.state = "ended".into(); }
    Some((s, quotas))
}
fn files(dir: &Path, depth: u8, out: &mut Vec<(u64, PathBuf)>) -> Result<(), String> {
    let rd = match std::fs::read_dir(dir) { Ok(rd) => rd, Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()), Err(e) => return Err(e.to_string()) };
    for entry in rd.flatten() {
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_dir() && depth > 0 { files(&entry.path(), depth - 1, out)?; }
        else if kind.is_file() && entry.path().extension().is_some_and(|e| e == "jsonl") {
            let at = entry.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_millis() as u64);
            out.push((at, entry.path()));
        }
    }
    Ok(())
}
fn read(root: &Path, now: u64) -> Result<Report, String> {
    let mut paths = Vec::new();
    files(root, 3, &mut paths)?;
    paths.sort_by(|a, b| b.0.cmp(&a.0));
    let mut report = Report::default();
    let mut latest = 0;
    for (_, path) in paths.into_iter().filter(|(at, _)| now.saturating_sub(*at) < 2 * 86_400_000).take(100) {
        let Ok(mut f) = std::fs::File::open(path) else { continue };
        let len = f.metadata().map_err(|e| e.to_string())?.len();
        let mut head = Vec::new();
        (&mut f).take(64 * 1024).read_to_end(&mut head).map_err(|e| e.to_string())?;
        let from = len.saturating_sub(512 * 1024);
        f.seek(SeekFrom::Start(from)).map_err(|e| e.to_string())?;
        let mut tail = Vec::new();
        f.take(512 * 1024).read_to_end(&mut tail).map_err(|e| e.to_string())?;
        let tail = String::from_utf8_lossy(&tail);
        let tail = if from > 0 { tail.split_once('\n').map_or("", |(_, t)| t) } else { &tail };
        if let Some((s, q)) = parse(&String::from_utf8_lossy(&head), tail, now) {
            let at = q.iter().map(|q| q.observed_at).max().unwrap_or(0);
            if at > latest { latest = at; report.quotas = q; }
            report.sessions.push(s);
        }
    }
    Ok(report)
}
#[tauri::command]
pub async fn codex_sessions() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let home = std::env::var_os("CODEX_HOME").map(PathBuf::from).or_else(|| std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(|h| PathBuf::from(h).join(".codex")));
        let report = match home { Some(h) => read(&h.join("sessions"), chrono::Utc::now().timestamp_millis().max(0) as u64)?, None => Report::default() };
        serde_json::to_string(&report).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    const HEAD: &str = r#"{"type":"session_meta","timestamp":"2026-11-12T10:00:00Z","payload":{"id":"abc","cwd":"/work/api","base_instructions":"SECRET"}}"#;
    #[test]
    fn activity_quota_and_privacy() {
        let log = concat!(
            "{\"type\":\"event_msg\",\"timestamp\":\"2026-11-12T10:01:00Z\",\"payload\":{\"type\":\"task_started\"}}\n",
            "{\"type\":\"event_msg\",\"timestamp\":\"2026-11-12T10:02:00Z\",\"payload\":{\"type\":\"token_count\",\"info\":{\"private\":\"SECRET\"},\"rate_limits\":{\"primary\":{\"used_percent\":25,\"window_minutes\":300,\"resets_at\":2000000000},\"secondary\":null}}}\n",
            "{\"type\":\"event_msg\",\"timestamp\":\"2026-11-12T10:03:00Z\",\"payload\":{\"type\":\"task_complete\",\"last_agent_message\":\"SECRET\"}}\n{broken");
        let (s, q) = parse(HEAD, log, ms("2026-11-12T10:04:00Z")).unwrap();
        assert_eq!((s.state.as_str(), s.name.as_str()), ("idle", "api"));
        assert_eq!((q[0].left, q[0].label.as_str(), q[0].reset), (75.0, "5h", 2000000000000));
        assert!(!serde_json::to_string(&(s, q)).unwrap().contains("SECRET"));
    }
    #[test]
    fn stale_or_unrecognised_activity_is_not_working() {
        let log = r#"{"type":"event_msg","timestamp":"2026-11-12T10:01:00Z","payload":{"type":"task_started"}}"#;
        assert_eq!(parse(HEAD, log, ms("2026-11-12T11:00:00Z")).unwrap().0.state, "ended");
        assert_eq!(parse(HEAD, "", 0).unwrap().0.state, "ended");
        assert!(parse("{}", "", 0).is_none());
    }
}
