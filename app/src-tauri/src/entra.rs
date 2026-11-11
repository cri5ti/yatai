//! One Microsoft (Entra ID) sign-in for the Calendar, Emails and Azure DevOps sources (design/plugins.md §9).
//! The user signs in once in the system browser (authorization code + PKCE, loopback redirect). Rust keeps the refresh
//! token in the OS keychain and mints a short-lived access token per resource (Graph, Azure DevOps) when a request
//! needs one, renewing it a few minutes before it expires. The page never sees a token: `plugin_http` adds it.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const SERVICE: &str = "yatai";
/// a Windows credential holds ~2.5 KB (UTF-16 here), a refresh token can be longer: it is stored in pieces
const CHUNK: usize = 800;
const RENEW_BEFORE: Duration = Duration::from_secs(5 * 60);
const WAIT_FOR_BROWSER: Duration = Duration::from_secs(180);

/// what a resource is: the scope prefix and the hosts its tokens may be sent to
struct Resource {
    prefix: &'static str,
    hosts: &'static [&'static str],
    suffixes: &'static [&'static str],
}
fn resource(name: &str) -> Result<Resource, String> {
    match name {
        "graph" => Ok(Resource { prefix: "https://graph.microsoft.com/", hosts: &["graph.microsoft.com"], suffixes: &[] }),
        "devops" => Ok(Resource { prefix: "499b84ac-1321-427f-aa17-267ca6975798/", hosts: &["dev.azure.com"], suffixes: &[".visualstudio.com"] }),
        _ => Err("unknown resource".into()),
    }
}
/// only to its own hosts: the token of one resource is no use (and a leak) anywhere else
pub fn host_ok(res: &str, host: &str) -> bool {
    let Ok(r) = resource(res) else { return false };
    let h = host.to_ascii_lowercase();
    r.hosts.iter().any(|x| *x == h) || r.suffixes.iter().any(|s| h.len() > s.len() && h.ends_with(s))
}

#[derive(Serialize, Deserialize, Clone, Default)]
struct Meta {
    client: String,
    tenant: String,
    /// who signed in (their user name)
    account: String,
    /// the scopes (without the resource prefix) each resource was consented for: { graph: ["Mail.Read"], devops: ["user_impersonation"] }
    scopes: HashMap<String, Vec<String>>,
    chunks: usize,
}

fn kr(name: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, name).map_err(|e| e.to_string())
}
fn split(s: &str) -> Vec<String> {
    s.as_bytes().chunks(CHUNK).map(|c| String::from_utf8_lossy(c).into_owned()).collect()
}
fn load() -> Option<(Meta, String)> {
    let meta: Meta = serde_json::from_str(&kr("entra").ok()?.get_password().ok()?).ok()?;
    let mut rt = String::new();
    for i in 0..meta.chunks {
        rt += &kr(&format!("entra.rt{i}")).ok()?.get_password().ok()?;
    }
    (!rt.is_empty()).then_some((meta, rt))
}
fn store(meta: &Meta, refresh: &str) -> Result<(), String> {
    let parts = split(refresh);
    for (i, p) in parts.iter().enumerate() {
        kr(&format!("entra.rt{i}"))?.set_password(p).map_err(|e| e.to_string())?;
    }
    // pieces left over from a longer token
    for i in parts.len()..meta.chunks.max(parts.len() + 4) {
        let _ = kr(&format!("entra.rt{i}")).map(|e| e.delete_credential());
    }
    let meta = Meta { chunks: parts.len(), ..meta.clone() };
    kr("entra")?.set_password(&serde_json::to_string(&meta).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
fn wipe() {
    let n = load().map(|(m, _)| m.chunks).unwrap_or(0).max(8);
    for i in 0..n {
        let _ = kr(&format!("entra.rt{i}")).map(|e| e.delete_credential());
    }
    let _ = kr("entra").map(|e| e.delete_credential());
    cache().lock().unwrap().clear();
}

fn cache() -> &'static Mutex<HashMap<String, (String, Instant)>> {
    static C: std::sync::OnceLock<Mutex<HashMap<String, (String, Instant)>>> = std::sync::OnceLock::new();
    C.get_or_init(Default::default)
}

fn endpoint(tenant: &str, what: &str) -> String {
    format!("https://login.microsoftonline.com/{tenant}/oauth2/v2.0/{what}")
}
fn plain(s: &str) -> bool {
    !s.is_empty() && s.len() <= 80 && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_'))
}

fn random(n: usize) -> String {
    let mut b = vec![0u8; n];
    getrandom::getrandom(&mut b).expect("the OS has no randomness");
    B64.encode(b)
}
fn challenge(verifier: &str) -> String {
    B64.encode(Sha256::digest(verifier.as_bytes()))
}

#[derive(Deserialize)]
struct TokenRes {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    id_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

/// the user name in an id token (the payload of a token we got straight from the token endpoint over TLS)
fn who(id_token: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_slice(&B64.decode(id_token.split('.').nth(1)?).ok()?).ok()?;
    ["preferred_username", "email", "name"].iter().find_map(|k| v.get(k)?.as_str().map(str::to_string))
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().timeout(Duration::from_secs(30)).user_agent("yatai").build().map_err(|e| e.to_string())
}

/// the first line of Entra's explanation ("AADSTS65001: The user or administrator has not consented…")
fn why(t: &TokenRes) -> String {
    let d = t.error_description.as_deref().unwrap_or("").lines().next().unwrap_or("").trim();
    if d.is_empty() { t.error.clone().unwrap_or_else(|| "sign-in failed".into()) } else { d.to_string() }
}

async fn token_call(tenant: &str, form: &[(&str, &str)]) -> Result<TokenRes, (bool, String)> {
    let r = client().map_err(|e| (false, e))?.post(endpoint(tenant, "token")).form(form).send().await.map_err(|e| (false, e.to_string()))?;
    let t: TokenRes = r.json().await.map_err(|_| (false, "Microsoft answered with something unexpected".to_string()))?;
    if t.error.is_some() || t.access_token.is_none() {
        // the grant is no good any more (expired, revoked, consent withdrawn, conditional access): the user has to sign in again
        let again = matches!(t.error.as_deref(), Some("invalid_grant" | "interaction_required" | "consent_required" | "login_required"));
        return Err((again, why(&t)));
    }
    Ok(t)
}

fn scope_string(res: &str, names: &[String]) -> Result<String, String> {
    let r = resource(res)?;
    if names.is_empty() || !names.iter().all(|n| plain(n)) {
        return Err("bad scopes".into());
    }
    let mut v: Vec<String> = names.iter().map(|n| format!("{}{n}", r.prefix)).collect();
    v.push("offline_access".into());
    v.push("openid".into());
    v.push("profile".into());
    Ok(v.join(" "))
}

struct Pending {
    listener: TcpListener,
    port: u16,
    state: String,
    verifier: String,
    client: String,
    tenant: String,
    res: String,
    names: Vec<String>,
}
fn pending() -> &'static Mutex<Option<Pending>> {
    static P: std::sync::OnceLock<Mutex<Option<Pending>>> = std::sync::OnceLock::new();
    P.get_or_init(Default::default)
}

#[derive(Serialize)]
pub struct Status {
    configured: bool,
    account: Option<String>,
    client: Option<String>,
    tenant: Option<String>,
    scopes: HashMap<String, Vec<String>>,
}
fn status() -> Status {
    match load() {
        Some((m, _)) => Status { configured: true, account: Some(m.account), client: Some(m.client), tenant: Some(m.tenant), scopes: m.scopes },
        None => Status { configured: false, account: None, client: None, tenant: None, scopes: HashMap::new() },
    }
}

#[tauri::command]
pub fn entra_status() -> Status {
    status()
}

#[tauri::command]
pub fn entra_sign_out() -> Status {
    pending().lock().unwrap().take();
    wipe();
    status()
}

/// step 1 of a sign-in: listen on a free local port and return the address to open in the browser.
/// `res` is "graph" or "devops"; `names` the scopes wanted from it (all of them, not only the new one).
#[tauri::command]
pub async fn entra_begin(client: String, tenant: String, res: String, names: Vec<String>) -> Result<String, String> {
    let (client, tenant) = (client.trim().to_string(), tenant.trim().to_string());
    if !plain(&client) {
        return Err("the application (client) id is not valid".into());
    }
    // a different tenant than the signed-in account's is not a "more scopes" request: start from scratch
    let tenant = if tenant.is_empty() { "organizations".to_string() } else { tenant };
    if !plain(&tenant) {
        return Err("the tenant is not valid".into());
    }
    let scope = scope_string(&res, &names)?;
    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let (state, verifier) = (random(16), random(32));
    let mut q = vec![
        ("client_id", client.clone()),
        ("response_type", "code".into()),
        ("redirect_uri", format!("http://localhost:{port}")),
        ("response_mode", "query".into()),
        ("scope", scope),
        ("state", state.clone()),
        ("code_challenge", challenge(&verifier)),
        ("code_challenge_method", "S256".into()),
    ];
    // already signed in: stay on that account (and do not ask again for what is already consented)
    if let Some((m, _)) = load().filter(|(m, _)| m.client == client) {
        q.push(("login_hint", m.account));
    }
    let mut url = reqwest::Url::parse(&endpoint(&tenant, "authorize")).map_err(|e| e.to_string())?;
    url.query_pairs_mut().extend_pairs(q.iter().map(|(k, v)| (*k, v.as_str())));
    *pending().lock().unwrap() = Some(Pending { listener, port, state, verifier, client, tenant, res, names });
    Ok(url.to_string())
}

/// the `code` and `state` (or the error) of the request the browser was sent back with
fn parse_redirect(request: &str) -> Option<HashMap<String, String>> {
    let target = request.lines().next()?.split_whitespace().nth(1)?;
    let u = reqwest::Url::parse(&format!("http://localhost{target}")).ok()?;
    let q: HashMap<String, String> = u.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
    (q.contains_key("code") || q.contains_key("error")).then_some(q)
}

async fn reply(s: &mut tokio::net::TcpStream, ok: bool) {
    let body = format!(
        "<!doctype html><meta charset=utf-8><title>yatai</title><body style=\"font:16px system-ui;margin:3em\"><h2>{}</h2><p>You can close this tab and go back to yatai.</p>",
        if ok { "Signed in" } else { "Sign-in did not work" }
    );
    let _ = s.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await;
    let _ = s.shutdown().await;
}

/// step 2: wait for the browser to come back, trade the code for tokens and keep the refresh token. Returns the status.
#[tauri::command]
pub async fn entra_finish() -> Result<Status, String> {
    let p = pending().lock().unwrap().take().ok_or("no sign-in is waiting")?;
    let got = tokio::time::timeout(WAIT_FOR_BROWSER, async {
        loop {
            let (mut s, _) = p.listener.accept().await.map_err(|e| e.to_string())?;
            let mut buf = vec![0u8; 8192];
            let n = tokio::time::timeout(Duration::from_secs(5), s.read(&mut buf)).await.ok().and_then(|r| r.ok()).unwrap_or(0);
            let q = parse_redirect(&String::from_utf8_lossy(&buf[..n]));
            reply(&mut s, q.as_ref().is_some_and(|q| q.contains_key("code"))).await;
            if let Some(q) = q {
                return Ok::<_, String>(q);
            } // anything else (a favicon request) is ignored
        }
    })
    .await
    .map_err(|_| "No answer from the browser (3 minutes): try again".to_string())??;
    if got.get("state") != Some(&p.state) {
        return Err("the sign-in answer does not belong to this request".into());
    }
    if let Some(e) = got.get("error") {
        let d = got.get("error_description").map(|d| d.lines().next().unwrap_or("").to_string()).unwrap_or_default();
        return Err(if d.is_empty() { e.clone() } else { d });
    }
    let code = got.get("code").ok_or("no code")?;
    let redirect = format!("http://localhost:{}", p.port);
    let scope = scope_string(&p.res, &p.names)?;
    let t = token_call(
        &p.tenant,
        &[("client_id", &p.client), ("grant_type", "authorization_code"), ("code", code), ("redirect_uri", &redirect), ("code_verifier", &p.verifier), ("scope", &scope)],
    )
    .await
    .map_err(|e| e.1)?;
    let prior = load().filter(|(m, _)| m.client == p.client && m.tenant == p.tenant).map(|(m, _)| m);
    let mut meta = prior.unwrap_or(Meta { client: p.client.clone(), tenant: p.tenant.clone(), ..Default::default() });
    meta.account = t.id_token.as_deref().and_then(who).unwrap_or(meta.account);
    meta.scopes.insert(p.res.clone(), p.names.clone());
    store(&meta, t.refresh_token.as_deref().ok_or("Microsoft sent no refresh token (is offline_access allowed?)")?)?;
    let mut c = cache().lock().unwrap();
    c.clear();
    if let (Some(a), Some(x)) = (&t.access_token, t.expires_in) {
        c.insert(p.res.clone(), (a.clone(), Instant::now() + Duration::from_secs(x)));
    }
    drop(c);
    Ok(status())
}

/// an access token for `res`, renewed when it is about to expire. `Err(true, …)`: the user has to sign in again.
pub async fn access_token(res: &str) -> Result<String, (bool, String)> {
    if let Some((t, exp)) = cache().lock().unwrap().get(res) {
        if *exp > Instant::now() + RENEW_BEFORE {
            return Ok(t.clone());
        }
    }
    // one renewal at a time: the refresh token rotates, so two at once would spend it twice
    static GATE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _g = GATE.lock().await;
    if let Some((t, exp)) = cache().lock().unwrap().get(res) {
        if *exp > Instant::now() + RENEW_BEFORE {
            return Ok(t.clone());
        }
    }
    let (meta, refresh) = load().ok_or((true, "not signed in to Microsoft".to_string()))?;
    let names = meta.scopes.get(res).filter(|n| !n.is_empty()).ok_or((true, "this source is not enabled for the Microsoft account".to_string()))?;
    let scope = scope_string(res, names).map_err(|e| (false, e))?;
    let t = token_call(&meta.tenant, &[("client_id", &meta.client), ("grant_type", "refresh_token"), ("refresh_token", &refresh), ("scope", &scope)]).await?;
    if let Some(r) = t.refresh_token.as_deref().filter(|r| *r != refresh) {
        store(&meta, r).map_err(|e| (false, e))?;
    }
    let a = t.access_token.unwrap_or_default();
    cache().lock().unwrap().insert(res.to_string(), (a.clone(), Instant::now() + Duration::from_secs(t.expires_in.unwrap_or(3600))));
    Ok(a)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_challenge_is_the_rfc_example() {
        // RFC 7636 appendix B
        assert_eq!(challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn tokens_only_go_to_their_own_hosts() {
        assert!(host_ok("graph", "graph.microsoft.com"));
        assert!(!host_ok("graph", "dev.azure.com"));
        assert!(host_ok("devops", "dev.azure.com"));
        assert!(host_ok("devops", "Acme.visualstudio.com"));
        assert!(!host_ok("devops", "visualstudio.com"));
        assert!(!host_ok("devops", "evil.com"));
        assert!(!host_ok("devops", "dev.azure.com.evil.com"));
        assert!(!host_ok("nope", "graph.microsoft.com"));
    }

    #[test]
    fn redirect_is_parsed() {
        let q = parse_redirect("GET /?code=abc&state=xyz&session_state=1 HTTP/1.1\r\nHost: localhost\r\n\r\n").unwrap();
        assert_eq!(q["code"], "abc");
        assert_eq!(q["state"], "xyz");
        let e = parse_redirect("GET /?error=access_denied&error_description=AADSTS65004%3A+nope&state=xyz HTTP/1.1\r\n").unwrap();
        assert_eq!(e["error_description"], "AADSTS65004: nope");
        assert!(parse_redirect("GET /favicon.ico HTTP/1.1\r\n").is_none());
        assert!(parse_redirect("").is_none());
    }

    #[test]
    fn scopes_are_built_and_checked() {
        let s = scope_string("graph", &["Mail.Read".into(), "Calendars.Read".into()]).unwrap();
        assert_eq!(s, "https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Calendars.Read offline_access openid profile");
        assert!(scope_string("graph", &["Mail.Read openid".into()]).is_err());
        assert!(scope_string("graph", &[]).is_err());
        assert!(scope_string("x", &["a".into()]).is_err());
    }

    #[test]
    fn long_refresh_tokens_are_split_and_rejoin() {
        let t = "x".repeat(CHUNK * 2 + 5);
        let p = split(&t);
        assert_eq!(p.len(), 3);
        assert_eq!(p.concat(), t);
    }

    #[test]
    fn who_reads_the_user_name() {
        let payload = B64.encode(r#"{"preferred_username":"a@b.com","name":"A"}"#);
        assert_eq!(who(&format!("h.{payload}.s")).as_deref(), Some("a@b.com"));
        assert_eq!(who("garbage"), None);
    }
}
