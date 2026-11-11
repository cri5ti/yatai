//! The Copilot source: which GitHub Copilot sessions are open on this PC (CLI, VS Code, JetBrains), and what each is doing.
//! Copilot keeps one folder per session in `~/.copilot/session-state/<id>/`: `workspace.yaml` (folder, name, client…),
//! an `inuse.<pid>.lock` while a process holds the session open, and `events.jsonl`, the log of what happened. The state is
//! read from the *kind* of the last few events (a turn started / ended, a permission asked / answered, shutdown): the text of
//! the conversation is never parsed, kept or returned. Only the end of the log is read (it can be many MB).

use serde::Serialize;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub session_id: String,
    pub cwd: String,
    pub name: String,
    /// 'vscode-agent-host' | 'github/cli' | 'copilot-intellij' …
    pub client: String,
    pub branch: String,
    /// 'working' | 'waiting' | 'idle' | 'ended'
    pub state: String,
    /// when it got into that state (ms since the epoch)
    pub state_at: u64,
}

fn dir() -> Option<PathBuf> {
    let home = std::env::var_os("COPILOT_HOME").map(PathBuf::from).or_else(|| std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(|h| PathBuf::from(h).join(".copilot")))?;
    Some(home.join("session-state"))
}

/// `key: value` of a flat yaml file (what workspace.yaml is); values may be quoted
fn yaml(text: &str, key: &str) -> Option<String> {
    text.lines().find_map(|l| {
        let (k, v) = l.split_once(':')?;
        (k.trim() == key).then(|| v.trim().trim_matches(['"', '\'']).to_string())
    })
}

/// "2026-11-11T02:19:27.669Z" → ms since the epoch (UTC only: that is what the log writes)
pub fn iso_ms(s: &str) -> Option<u64> {
    let b = s.as_bytes();
    if b.len() < 19 || b[4] != b'-' || b[7] != b'-' || (b[10] != b'T' && b[10] != b' ') {
        return None;
    }
    let n = |a: usize, z: usize| s.get(a..z)?.parse::<i64>().ok();
    let (y, m, d, hh, mm, ss) = (n(0, 4)?, n(5, 7)?, n(8, 10)?, n(11, 13)?, n(14, 16)?, n(17, 19)?);
    let ms = if b.get(19) == Some(&b'.') { s[20..].chars().take_while(char::is_ascii_digit).take(3).collect::<String>() } else { String::new() };
    let ms = format!("{ms:0<3}").parse::<i64>().ok()?;
    // days since 1970-01-01 (Howard Hinnant's days_from_civil)
    let y2 = if m <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    u64::try_from(((days * 24 + hh) * 60 + mm) * 60_000 + ss * 1000 + ms).ok()
}

/// the `type` and `timestamp` of one log line, without parsing it: `{"type":"…","data":{…huge…},"id":…,"timestamp":"…"}`
fn kind(line: &str) -> Option<(&str, Option<u64>)> {
    let rest = line.strip_prefix("{\"type\":\"")?;
    let t = &rest[..rest.find('"')?];
    let ts = line.rfind("\"timestamp\":\"").and_then(|i| iso_ms(line.get(i + 13..i + 13 + 24).unwrap_or(&line[i + 13..])));
    Some((t, ts))
}

/// what the events say the session is doing: (state, when it got there)
pub fn state_of<'a>(events: impl Iterator<Item = (&'a str, Option<u64>)>) -> Option<(&'static str, u64)> {
    let mut st: Option<(&'static str, u64)> = None;
    let mut asked = 0i32; // permissions asked and not answered yet
    for (t, at) in events {
        let at = at.unwrap_or_else(|| st.map_or(0, |s| s.1));
        let next = match t {
            "session.shutdown" => "ended",
            "permission.requested" => {
                asked += 1;
                "waiting"
            }
            "permission.completed" => {
                asked = (asked - 1).max(0);
                if asked > 0 { "waiting" } else { "working" }
            }
            "assistant.turn_end" | "abort" | "session.resume" => {
                asked = 0;
                "idle"
            }
            "assistant.turn_start" | "user.message" | "tool.execution_start" | "tool.execution_complete" | "assistant.message" | "external_tool.requested" | "external_tool.completed" => {
                if asked > 0 { "waiting" } else { "working" }
            }
            _ => continue, // hooks, usage records, model snapshots: noise
        };
        // a state that goes on (another tool call while working) keeps the time it began
        if st.map(|s| s.0) != Some(next) {
            st = Some((next, at));
        }
    }
    st
}

/// the last `n` bytes of a file, from the first line start after the cut
fn tail(path: &Path, n: u64) -> Option<String> {
    let mut f = std::fs::File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    let from = len.saturating_sub(n);
    f.seek(SeekFrom::Start(from)).ok()?;
    let mut buf = Vec::new();
    f.take(n).read_to_end(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf).into_owned();
    Some(if from > 0 { text.split_once('\n').map(|x| x.1.to_string()).unwrap_or_default() } else { text })
}

/// is some process that still runs holding this session open? (`inuse.<pid>.lock`: a lock older than the process is a reused pid)
fn held(dir: &Path, started: &dyn Fn(u32) -> Option<u64>) -> bool {
    let Ok(rd) = std::fs::read_dir(dir) else { return false };
    rd.flatten().any(|e| {
        let name = e.file_name().to_string_lossy().into_owned();
        let Some(pid) = name.strip_prefix("inuse.").and_then(|r| r.strip_suffix(".lock")).and_then(|p| p.parse::<u32>().ok()) else { return false };
        let Some(c) = started(pid) else { return false };
        let locked = e.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(u64::MAX, |d| d.as_millis() as u64);
        c == 0 || crate::proc::filetime_ms(c) <= locked + 5_000
    })
}

fn session(dir: &Path, started: &dyn Fn(u32) -> Option<u64>) -> Option<Session> {
    let id = dir.file_name()?.to_string_lossy().into_owned();
    let ws = std::fs::read_to_string(dir.join("workspace.yaml")).ok()?;
    let cwd = yaml(&ws, "cwd").unwrap_or_default();
    let name = yaml(&ws, "name").filter(|n| !n.is_empty() && n != "null").unwrap_or_else(|| cwd.rsplit(['\\', '/']).next().unwrap_or("").to_string());
    let log = tail(&dir.join("events.jsonl"), 512 * 1024).unwrap_or_default();
    let (state, at) = state_of(log.lines().filter_map(kind)).unwrap_or(("idle", 0));
    let at = if at > 0 { at } else { yaml(&ws, "updated_at").and_then(|u| iso_ms(&u)).unwrap_or(0) };
    // nothing holds it open (the window closed, the process died): it is over, whatever the log last said
    let state = if state != "ended" && !held(dir, started) { "ended" } else { state };
    Some(Session { session_id: id, cwd, name, client: yaml(&ws, "client_name").unwrap_or_default(), branch: yaml(&ws, "branch").unwrap_or_default(), state: state.into(), state_at: at })
}

fn read(root: &Path, started: &dyn Fn(u32) -> Option<u64>) -> Vec<Session> {
    let Ok(rd) = std::fs::read_dir(root) else { return vec![] };
    let mut out: Vec<Session> = rd.flatten().filter(|e| e.path().is_dir() && e.path().join("workspace.yaml").exists()).filter_map(|e| session(&e.path(), started)).collect();
    out.sort_by(|a, b| b.state_at.cmp(&a.state_at));
    out
}

/// the Copilot sessions on this PC, newest change first, as JSON (ended ones included: the page decides what to show)
#[tauri::command]
pub async fn copilot_sessions() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let list = dir().map(|d| read(&d, &crate::proc::started)).unwrap_or_default();
        serde_json::to_string(&list).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(types: &[&str]) -> Option<(&'static str, u64)> {
        state_of(types.iter().enumerate().map(|(i, t)| (*t, Some(1000 + i as u64))))
    }

    #[test]
    fn iso_times() {
        assert_eq!(iso_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(iso_ms("2026-11-11T02:19:27.669Z"), Some(1_794_363_567_669));
        assert_eq!(iso_ms("2024-02-29T12:00:00.5Z"), Some(1_709_208_000_500));
        assert_eq!(iso_ms("nonsense"), None);
    }

    #[test]
    fn kind_of_a_line_without_parsing_it() {
        let l = r#"{"type":"assistant.turn_end","data":{"turnId":"1","text":"a \"timestamp\":\"x\" in text"},"id":"e","timestamp":"2026-11-11T02:19:27.669Z","parentId":"p"}"#;
        assert_eq!(kind(l), Some(("assistant.turn_end", Some(1_794_363_567_669))));
        assert_eq!(kind("not json"), None);
    }

    #[test]
    fn working_waiting_idle_ended() {
        assert_eq!(run(&["user.message", "assistant.turn_start", "tool.execution_start"]), Some(("working", 1000)));
        assert_eq!(run(&["assistant.turn_start", "permission.requested"]), Some(("waiting", 1001)));
        assert_eq!(run(&["assistant.turn_start", "permission.requested", "hook.start", "permission.completed", "tool.execution_start"]), Some(("working", 1003)));
        assert_eq!(run(&["assistant.turn_start", "tool.execution_start", "assistant.turn_end", "hook.end", "session.usage_checkpoint"]), Some(("idle", 1002)));
        assert_eq!(run(&["assistant.turn_end", "session.shutdown"]), Some(("ended", 1001)));
        assert_eq!(run(&["hook.start", "session.usage_record"]), None);
    }

    #[test]
    fn a_long_turn_keeps_the_time_it_began() {
        assert_eq!(run(&["assistant.turn_start", "tool.execution_start", "tool.execution_complete", "tool.execution_start"]), Some(("working", 1000)));
    }

    #[test]
    fn open_only_while_a_live_process_holds_it() {
        let root = std::env::temp_dir().join(format!("yatai-copilot-{}", std::process::id()));
        let d = root.join("s1");
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("workspace.yaml"), "id: s1\ncwd: d:\\work\\api\nname: Fix the thing\nclient_name: github/cli\nupdated_at: 2026-11-11T02:19:27.669Z\n").unwrap();
        std::fs::write(d.join("events.jsonl"), "{\"type\":\"session.start\",\"data\":{}}\n{\"type\":\"assistant.turn_start\",\"data\":{},\"timestamp\":\"2026-11-11T02:19:27.669Z\"}\n").unwrap();
        std::fs::write(d.join("inuse.77.lock"), "77\n").unwrap();
        let alive = read(&root, &|pid| (pid == 77).then_some(0));
        let dead = read(&root, &|_| None);
        std::fs::remove_dir_all(&root).ok();
        assert_eq!((alive[0].state.as_str(), alive[0].name.as_str(), alive[0].client.as_str(), alive[0].state_at), ("working", "Fix the thing", "github/cli", 1_794_363_567_669));
        assert_eq!(dead[0].state, "ended");
    }

    /// against this machine: counts only
    #[test]
    fn this_pc() {
        let v = dir().map(|d| read(&d, &crate::proc::started)).unwrap_or_default();
        let by = |s: &str| v.iter().filter(|x| x.state == s).count();
        eprintln!("copilot sessions: {} (working {}, waiting {}, idle {}, ended {})", v.len(), by("working"), by("waiting"), by("idle"), by("ended"));
    }
}
