//! The Emails source: reads the Inbox of the local classic Outlook through COM (Windows only), by running mail.ps1
//! in a hidden PowerShell. No tokens, no Graph consent: Outlook already has the mailbox synced.
//! Input and output are JSON strings; the page parses them (src/plugins/mail).

const SCRIPT: &str = include_str!("mail.ps1");

#[cfg(windows)]
fn run(input: &str) -> Result<String, String> {
    use std::io::Write;
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    // -EncodedCommand takes the script as base64 UTF-16LE, so stdin stays free for the input
    let utf16: Vec<u8> = SCRIPT.encode_utf16().flat_map(|c| c.to_le_bytes()).collect();
    let encoded = base64(&utf16);
    let mut child = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", &encoded])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("could not start PowerShell: {e}"))?;
    child.stdin.take().ok_or("no stdin")?.write_all(input.as_bytes()).map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        // the script reports its own errors as JSON; this is PowerShell itself failing
        return Err(format!("PowerShell exited with {}", out.status));
    }
    let s = String::from_utf8_lossy(&out.stdout);
    Ok(s.trim_start_matches('\u{feff}').trim().to_string())
}

#[cfg(windows)]
fn base64(b: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::with_capacity(b.len().div_ceil(3) * 4);
    for c in b.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            s.push(if i <= c.len() { T[(n >> (18 - 6 * i) & 63) as usize] as char } else { '=' });
        }
    }
    s
}

#[cfg(not(windows))]
fn run(_input: &str) -> Result<String, String> {
    Err("Emails reads the classic Outlook on Windows".into())
}

/// `input`: { since, limit, known } (see mail.ps1); returns its JSON output
#[tauri::command]
pub async fn mail_fetch(input: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || run(&input)).await.map_err(|e| e.to_string())?
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn base64_matches() {
        assert_eq!(super::base64(b"ab"), "YWI=");
        assert_eq!(super::base64(b"abc"), "YWJj");
        assert_eq!(super::base64(b"a"), "YQ==");
    }
}
