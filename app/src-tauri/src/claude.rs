//! The Claude source: which Claude Code sessions are running on this PC, and what each is doing.
//! Claude Code keeps one small file per running session in `~/.claude/sessions/<pid>.json` (name, folder, status:
//! busy / idle / waiting / shell, when it last changed). This reads those, and nothing else: not the transcripts,
//! and none of the session's private fields (tokens, socket paths). A file whose process is gone (a crash leaves it
//! behind) comes back with `alive: false`.

use serde::Serialize;
use std::path::PathBuf;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub session_id: String,
    pub pid: u32,
    pub cwd: String,
    pub name: String,
    /// 'busy' | 'idle' | 'waiting' | 'shell' (as Claude Code writes it)
    pub status: String,
    /// why it waits ('input needed', a permission prompt…)
    pub waiting_for: Option<String>,
    pub entrypoint: String,
    pub started_at: u64,
    pub status_at: u64,
    pub alive: bool,
}

fn dir() -> Option<PathBuf> {
    let base = std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(|h| PathBuf::from(h).join(".claude")))?;
    Some(base.join("sessions"))
}

/// one session file → its public fields (None when it is not a session file)
fn parse(text: &str) -> Option<(Session, u64)> {
    let v: serde_json::Value = serde_json::from_str(text).ok()?;
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).map(str::to_string);
    let n = |k: &str| v.get(k).and_then(|x| x.as_u64()).unwrap_or(0);
    let pid = n("pid") as u32;
    let session_id = s("sessionId")?;
    if pid == 0 {
        return None;
    }
    let proc_start = s("procStart").and_then(|p| p.parse::<u64>().ok()).unwrap_or(0);
    let cwd = s("cwd").unwrap_or_default();
    let name = s("name").unwrap_or_else(|| cwd.rsplit(['\\', '/']).next().unwrap_or("").to_string());
    let ses = Session {
        session_id,
        pid,
        cwd,
        name,
        status: s("status").unwrap_or_else(|| "idle".into()),
        waiting_for: s("waitingFor"),
        entrypoint: s("entrypoint").unwrap_or_default(),
        started_at: n("startedAt"),
        status_at: n("statusUpdatedAt").max(n("updatedAt")),
        alive: false,
    };
    Some((ses, proc_start))
}

/// is `pid` still the process that wrote the file? (`start`: its creation time as a Windows FILETIME; a reused pid has another one)
fn alive(pid: u32, start: u64) -> bool {
    match crate::proc::started(pid) {
        None => false,
        Some(c) => start == 0 || c == 0 || c.abs_diff(start) < 20_000_000,
    }
}

fn read(dir: &std::path::Path, check: &dyn Fn(u32, u64) -> bool) -> Vec<Session> {
    let Ok(rd) = std::fs::read_dir(dir) else { return vec![] };
    let mut out: Vec<Session> = rd
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| std::fs::read_to_string(e.path()).ok())
        .filter_map(|t| parse(&t))
        .map(|(mut s, start)| {
            s.alive = check(s.pid, start);
            s
        })
        .collect();
    out.sort_by(|a, b| b.status_at.cmp(&a.status_at));
    out
}

/// the sessions Claude Code has registered on this PC, newest change first, as JSON
#[tauri::command]
pub async fn claude_sessions() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let list = dir().map(|d| read(&d, &alive)).unwrap_or_default();
        serde_json::to_string(&list).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    const FILE: &str = r#"{"pid":71256,"sessionId":"abc","cwd":"d:\\work\\api","startedAt":10,"procStart":"134388737852353378","kind":"interactive","entrypoint":"claude-vscode","peerToken":"SECRET","messagingSocketPath":"\\\\.\\pipe\\x","name":"api-1d","status":"waiting","updatedAt":20,"statusUpdatedAt":30,"waitingFor":"input needed"}"#;

    #[test]
    fn keeps_only_the_public_fields() {
        let (s, start) = parse(FILE).unwrap();
        assert_eq!((s.pid, s.session_id.as_str(), s.name.as_str(), s.status.as_str()), (71256, "abc", "api-1d", "waiting"));
        assert_eq!((s.waiting_for.as_deref(), s.status_at, start), (Some("input needed"), 30, 134388737852353378));
        let json = serde_json::to_string(&s).unwrap();
        assert!(!json.contains("SECRET") && !json.contains("pipe"), "{json}");
    }

    #[test]
    fn rejects_files_that_are_not_sessions() {
        assert!(parse("not json").is_none());
        assert!(parse(r#"{"peerToken":"x"}"#).is_none());
        assert!(parse(r#"{"pid":0,"sessionId":"a"}"#).is_none());
    }

    #[test]
    fn name_falls_back_to_the_folder_and_status_to_idle() {
        let (s, _) = parse(r#"{"pid":1,"sessionId":"a","cwd":"d:\\work\\api"}"#).unwrap();
        assert_eq!((s.name.as_str(), s.status.as_str()), ("api", "idle"));
    }

    #[test]
    fn reads_a_folder_and_marks_dead_ones() {
        let d = std::env::temp_dir().join(format!("yatai-claude-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("1.json"), r#"{"pid":1,"sessionId":"a","statusUpdatedAt":5}"#).unwrap();
        std::fs::write(d.join("2.json"), r#"{"pid":2,"sessionId":"b","statusUpdatedAt":9}"#).unwrap();
        std::fs::write(d.join("junk.txt"), "x").unwrap();
        let v = read(&d, &|pid, _| pid == 1);
        std::fs::remove_dir_all(&d).ok();
        assert_eq!(v.iter().map(|s| (s.session_id.as_str(), s.alive)).collect::<Vec<_>>(), vec![("b", false), ("a", true)]);
    }

    /// against this machine: counts only
    #[test]
    fn this_pc() {
        let v = dir().map(|d| read(&d, &alive)).unwrap_or_default();
        let live = v.iter().filter(|s| s.alive).count();
        eprintln!("claude sessions: {} files, {} alive", v.len(), live);
    }
}
