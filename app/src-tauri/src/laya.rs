//! The Laya helper (a decision model, no generative LLM) that sorts emails: a Python process on loopback, started
//! hidden the first time it is needed. Its virtual environment comes from app/sidecar/laya/setup.ps1; the server
//! script (laya_server.py) is written next to it from the copy built into the app. It exits by itself when yatai does.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::llm::LlmRes;

const PORT: u16 = 8765;
const SERVER: &str = include_str!("laya_server.py");
static STARTING: Mutex<()> = Mutex::new(());

fn home() -> Result<PathBuf, String> {
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")));
    Ok(base.ok_or("no app data folder")?.join("yatai").join("laya"))
}

fn python(dir: &std::path::Path) -> PathBuf {
    if cfg!(windows) { dir.join(".venv").join("Scripts").join("python.exe") } else { dir.join(".venv").join("bin").join("python") }
}

async fn healthy(client: &reqwest::Client) -> bool {
    client.get(format!("http://127.0.0.1:{PORT}/health")).timeout(Duration::from_secs(2)).send().await.is_ok_and(|r| r.status().is_success())
}

/// start the helper unless it answers already; waits until it does
async fn ensure(client: &reqwest::Client) -> Result<(), String> {
    if healthy(client).await {
        return Ok(());
    }
    {
        let _one = STARTING.lock().map_err(|e| e.to_string())?;
        let dir = home()?;
        let py = python(&dir);
        if !py.exists() {
            return Err("Laya is not set up: run app\\sidecar\\laya\\setup.ps1".into());
        }
        let script = dir.join("laya_server.py");
        if std::fs::read_to_string(&script).ok().as_deref() != Some(SERVER) {
            std::fs::write(&script, SERVER).map_err(|e| e.to_string())?;
        }
        let log = std::fs::File::create(dir.join("server.log")).map_err(|e| e.to_string())?;
        let mut cmd = std::process::Command::new(&py);
        cmd.arg("-I").arg(&script).args(["--port", &PORT.to_string(), "--parent", &std::process::id().to_string()]);
        cmd.stdout(log.try_clone().map_err(|e| e.to_string())?).stderr(log).stdin(std::process::Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000 | 0x0000_0040); // CREATE_NO_WINDOW | IDLE_PRIORITY_CLASS (the script lowers itself too)
        }
        cmd.spawn().map_err(|e| format!("could not start the Laya helper: {e}"))?;
    }
    let t0 = Instant::now();
    while t0.elapsed() < Duration::from_secs(90) {
        tokio::time::sleep(Duration::from_millis(500)).await;
        if healthy(client).await {
            return Ok(());
        }
    }
    Err("the Laya helper did not start (see %LOCALAPPDATA%\\yatai\\laya\\server.log)".into())
}

/// POST `body` ({ model, email | state, questions }) to the helper's /predict, starting it first if need be.
/// The first request after a start also loads the checkpoint (and downloads it the very first time): slow.
#[tauri::command]
pub async fn laya_predict(body: String) -> Result<LlmRes, String> {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(600)).build().map_err(|e| e.to_string())?;
    ensure(&client).await?;
    let res = client
        .post(format!("http://127.0.0.1:{PORT}/predict"))
        .header("content-type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("Laya helper: {e}"))?;
    let status = res.status().as_u16();
    let body = res.text().await.map_err(|e| e.to_string())?;
    Ok(LlmRes { status, body })
}
