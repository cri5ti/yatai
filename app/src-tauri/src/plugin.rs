//! The host side of the plugin system (spec/design/plugins.md §4, §10).
//! A plugin's token lives in the OS keychain, bound to the one host it may be sent to. The page asks Rust to make the
//! request (`plugin_http`); Rust adds the Authorization header, so after the user has pasted a token it never comes back.

use std::collections::HashMap;
use std::time::Duration;

use reqwest::Url;
use serde::{Deserialize, Serialize};

const SERVICE: &str = "yatai";
const MAX_BODY: usize = 8 * 1024 * 1024;

fn entry(plugin: &str) -> Result<keyring::Entry, String> {
    if plugin.is_empty() || !plugin.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("bad plugin id".into());
    }
    keyring::Entry::new(SERVICE, &format!("plugin:{plugin}")).map_err(|e| e.to_string())
}

/// what is stored: the host the token may go to, and the token (`host\ntoken`)
fn load(plugin: &str) -> Option<(String, String)> {
    let v = entry(plugin).ok()?.get_password().ok()?;
    let (h, t) = v.split_once('\n')?;
    (!h.is_empty() && !t.is_empty()).then(|| (h.to_string(), t.to_string()))
}

#[derive(Serialize)]
pub struct SecretStatus {
    configured: bool,
    host: Option<String>,
}

fn status(plugin: &str) -> SecretStatus {
    let s = load(plugin);
    SecretStatus { configured: s.is_some(), host: s.map(|(h, _)| h) }
}

#[tauri::command]
pub fn plugin_secret_status(plugin: String) -> SecretStatus {
    status(&plugin)
}

/// store the token for `host` (or with an empty token, remove it)
#[tauri::command]
pub fn plugin_secret_set(plugin: String, host: String, token: String) -> Result<SecretStatus, String> {
    let e = entry(&plugin)?;
    if token.trim().is_empty() {
        match e.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(err) => return Err(err.to_string()),
        }
    } else {
        let host = host.trim().to_ascii_lowercase();
        if host.is_empty() || host.contains(['/', ':', ' ', '\n']) {
            return Err("bad host".into());
        }
        e.set_password(&format!("{host}\n{}", token.trim())).map_err(|e| e.to_string())?;
    }
    Ok(status(&plugin))
}

#[derive(Deserialize)]
pub struct HttpReq {
    plugin: String,
    method: Option<String>,
    url: String,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    /// add the plugin's token (only ever to the host it was stored for)
    auth: bool,
}

#[derive(Serialize)]
pub struct HttpRes {
    status: u16,
    headers: HashMap<String, String>,
    body: String,
}

/// https only; with a token, only to the host it is bound to
fn check_url(url: &str, bound: Option<&str>) -> Result<Url, String> {
    let u = Url::parse(url).map_err(|_| "bad url".to_string())?;
    if u.scheme() != "https" {
        return Err("only https urls".into());
    }
    if let Some(h) = bound {
        if !u.host_str().is_some_and(|x| x.eq_ignore_ascii_case(h)) {
            return Err(format!("this token is only for {h}"));
        }
    }
    Ok(u)
}

#[tauri::command]
pub async fn plugin_http(req: HttpReq) -> Result<HttpRes, String> {
    let secret = if req.auth { Some(load(&req.plugin).ok_or("not connected")?) } else { None };
    let url = check_url(&req.url, secret.as_ref().map(|(h, _)| h.as_str()))?;
    let method = reqwest::Method::from_bytes(req.method.as_deref().unwrap_or("GET").to_ascii_uppercase().as_bytes()).map_err(|_| "bad method")?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none()) // a redirect could point anywhere; the token stays with the host it was given for
        .timeout(Duration::from_secs(30))
        .user_agent("yatai")
        .build()
        .map_err(|e| e.to_string())?;
    let mut rb = client.request(method, url);
    for (k, v) in req.headers.unwrap_or_default() {
        if !k.eq_ignore_ascii_case("authorization") {
            rb = rb.header(k, v);
        }
    }
    if let Some((_, t)) = secret {
        rb = rb.bearer_auth(t);
    }
    if let Some(b) = req.body {
        rb = rb.body(b);
    }
    let mut res = rb.send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let headers = res.headers().iter().filter_map(|(k, v)| Some((k.as_str().to_string(), v.to_str().ok()?.to_string()))).collect();
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
        buf.extend_from_slice(&chunk);
        if buf.len() > MAX_BODY {
            return Err("response too large".into());
        }
    }
    Ok(HttpRes { status, headers, body: String::from_utf8_lossy(&buf).into_owned() })
}

/// GET the url that was stored as this plugin's secret (a published calendar link is a password in itself:
/// it never leaves Rust). Redirects stay on https; no credentials are added.
#[tauri::command]
pub async fn plugin_get_secret_url(plugin: String) -> Result<HttpRes, String> {
    let (host, url) = load(&plugin).ok_or("not connected")?;
    let u = check_url(&url, Some(&host))?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::custom(|a| if a.previous().len() > 3 || a.url().scheme() != "https" { a.stop() } else { a.follow() }))
        .timeout(Duration::from_secs(30))
        .user_agent("yatai")
        .build()
        .map_err(|e| e.to_string())?;
    let mut res = client.get(u).send().await.map_err(|e| e.to_string().replace(&url, "<calendar link>"))?;
    let status = res.status().as_u16();
    let headers = res.headers().iter().filter_map(|(k, v)| Some((k.as_str().to_string(), v.to_str().ok()?.to_string()))).collect();
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
        buf.extend_from_slice(&chunk);
        if buf.len() > MAX_BODY {
            return Err("response too large".into());
        }
    }
    Ok(HttpRes { status, headers, body: String::from_utf8_lossy(&buf).into_owned() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn https_only() {
        assert!(check_url("http://api.github.com/user", None).is_err());
        assert!(check_url("https://api.github.com/user", None).is_ok());
        assert!(check_url("file:///etc/passwd", None).is_err());
    }

    #[test]
    fn token_stays_with_its_host() {
        assert!(check_url("https://api.github.com/graphql", Some("api.github.com")).is_ok());
        assert!(check_url("https://API.github.com/graphql", Some("api.github.com")).is_ok());
        assert!(check_url("https://evil.example/graphql", Some("api.github.com")).is_err());
        // look-alikes: userinfo and suffix tricks resolve to a different host
        assert!(check_url("https://api.github.com@evil.example/", Some("api.github.com")).is_err());
        assert!(check_url("https://api.github.com.evil.example/", Some("api.github.com")).is_err());
    }

    #[test]
    fn plugin_ids_are_plain() {
        assert!(entry("github").is_ok());
        assert!(entry("../x").is_err());
        assert!(entry("").is_err());
    }
}
