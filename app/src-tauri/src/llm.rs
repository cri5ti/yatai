//! A local model server (Ollama) on this machine, for small jobs such as sorting emails.
//! Only loopback is reachable from here. While a request runs, Ollama's processes are kept at idle CPU priority
//! (Ollama starts a new runner process whenever it loads a model, so this is applied again every second).

use std::time::Duration;

#[derive(serde::Serialize)]
pub struct LlmRes {
    status: u16,
    body: String,
}

/// every process whose exe starts with "ollama" (the server, the tray app, the model runners): idle priority
#[cfg(windows)]
fn calm() {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    use windows_sys::Win32::System::Threading::{GetPriorityClass, OpenProcess, SetPriorityClass, IDLE_PRIORITY_CLASS, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SET_INFORMATION};
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return;
        }
        let mut e: PROCESSENTRY32W = std::mem::zeroed();
        e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut ok = Process32FirstW(snap, &mut e) != 0;
        while ok {
            let len = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
            let name = String::from_utf16_lossy(&e.szExeFile[..len]).to_ascii_lowercase();
            if name.starts_with("ollama") {
                let h = OpenProcess(PROCESS_SET_INFORMATION | PROCESS_QUERY_LIMITED_INFORMATION, 0, e.th32ProcessID);
                if !h.is_null() {
                    if GetPriorityClass(h) != IDLE_PRIORITY_CLASS {
                        SetPriorityClass(h, IDLE_PRIORITY_CLASS);
                    }
                    CloseHandle(h);
                }
            }
            ok = Process32NextW(snap, &mut e) != 0;
        }
        CloseHandle(snap);
    }
}
#[cfg(not(windows))]
fn calm() {}

/// POST `body` to http://127.0.0.1:<port>/<path> (Ollama's API: `api/chat`, `api/tags`; GET when body is empty)
#[tauri::command]
pub async fn llm_local(port: Option<u16>, path: String, body: String) -> Result<LlmRes, String> {
    if path.contains("..") || path.contains(['?', '#', '@', '\\']) || path.starts_with('/') {
        return Err("bad path".into());
    }
    let url = format!("http://127.0.0.1:{}/{path}", port.unwrap_or(11434));
    let client = reqwest::Client::builder().timeout(Duration::from_secs(180)).build().map_err(|e| e.to_string())?;
    let rb = if body.is_empty() { client.get(&url) } else { client.post(&url).header("content-type", "application/json").body(body) };
    calm();
    let keep = tauri::async_runtime::spawn(async {
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            calm();
        }
    });
    let res = rb.send().await;
    keep.abort();
    let res = res.map_err(|e| if e.is_connect() { "the local model server (Ollama) is not running".to_string() } else { e.to_string() })?;
    let status = res.status().as_u16();
    let body = res.text().await.map_err(|e| e.to_string())?;
    Ok(LlmRes { status, body })
}
