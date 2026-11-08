//! The AI key never enters the webview: it lives in the OS keychain (Keychain / Credential Manager /
//! Secret Service) and Rust adds it to the request. The UI only sends the request body.
//! Debug builds also accept OPENAI_API_KEY from the environment or app/.env, so `tauri dev` works without the keychain.

use serde::Serialize;

const SERVICE: &str = "yatai";
const ACCOUNT: &str = "openai-api-key";

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())
}

#[cfg(debug_assertions)]
fn dev_key() -> Option<String> {
    if let Ok(k) = std::env::var("OPENAI_API_KEY") {
        if !k.trim().is_empty() {
            return Some(k.trim().to_string());
        }
    }
    // `tauri dev` runs from src-tauri; the key the browser build uses sits in app/.env
    for p in ["../.env", ".env"] {
        if let Ok(txt) = std::fs::read_to_string(p) {
            for line in txt.lines() {
                if let Some(v) = line.trim().strip_prefix("OPENAI_API_KEY=") {
                    let v = v.trim().trim_matches('"');
                    if !v.is_empty() && v != "sk-..." {
                        return Some(v.to_string());
                    }
                }
            }
        }
    }
    None
}
#[cfg(not(debug_assertions))]
fn dev_key() -> Option<String> {
    None
}

fn keychain_key() -> Option<String> {
    entry().ok()?.get_password().ok().filter(|k| !k.is_empty())
}

/// where the key comes from; debug builds look at the environment first so a rebuilt (re-signed) binary
/// does not trigger a keychain prompt on every run
fn key() -> Option<(String, &'static str)> {
    if let Some(k) = dev_key() {
        return Some((k, "env"));
    }
    keychain_key().map(|k| (k, "keychain"))
}

#[derive(Serialize)]
pub struct KeyStatus {
    configured: bool,
    source: Option<&'static str>,
}

#[tauri::command]
pub fn ai_key_status() -> KeyStatus {
    let k = key();
    KeyStatus { configured: k.is_some(), source: k.map(|(_, s)| s) }
}

/// store (or with an empty string, remove) the key in the keychain
#[tauri::command]
pub fn ai_set_key(key: String) -> Result<KeyStatus, String> {
    let e = entry()?;
    if key.trim().is_empty() {
        match e.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(err) => return Err(err.to_string()),
        }
    } else {
        e.set_password(key.trim()).map_err(|e| e.to_string())?;
    }
    Ok(ai_key_status())
}

#[derive(Serialize)]
pub struct Reply {
    status: u16,
    body: String,
}

/// POST `<base_url>/<path>` with the key added; the body and the answer pass through untouched
#[tauri::command]
pub async fn ai_post(base_url: String, path: String, body: String) -> Result<Reply, String> {
    let (k, _) = key().ok_or("No OpenAI API key — add one in Settings (⌘,)")?;
    let base = if base_url.trim().is_empty() { "https://api.openai.com/v1".to_string() } else { base_url.trim().trim_end_matches('/').to_string() };
    if !path.chars().all(|c| c.is_ascii_alphanumeric() || c == '/' || c == '-' || c == '_') {
        return Err("bad path".into());
    }
    let res = reqwest::Client::new()
        .post(format!("{base}/{}", path.trim_start_matches('/')))
        .bearer_auth(k)
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let body = res.text().await.map_err(|e| e.to_string())?;
    Ok(Reply { status, body })
}
