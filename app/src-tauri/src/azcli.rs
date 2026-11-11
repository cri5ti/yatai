//! Azure DevOps through the user's Azure CLI sign-in (`az login`): no app registration, no token pasted. The CLI keeps
//! the sign-in and renews it; we ask it for an access token (`az account get-access-token`) when a request needs one and
//! keep that token in memory until shortly before it expires. Only Azure DevOps: the CLI's client is pre-authorised for it
//! and not for the mail and calendar scopes of Graph. Like the Microsoft account, the page never sees the token.

use std::sync::Mutex;
use std::time::{Duration, Instant};

const DEVOPS: &str = "499b84ac-1321-427f-aa17-267ca6975798";
const RENEW_BEFORE: Duration = Duration::from_secs(5 * 60);

fn cache() -> &'static Mutex<Option<(String, Instant)>> {
    static C: std::sync::OnceLock<Mutex<Option<(String, Instant)>>> = std::sync::OnceLock::new();
    C.get_or_init(Default::default)
}

/// the token and its lifetime from `az account get-access-token -o json` (`expires_on` is epoch seconds in current versions;
/// older ones only have a local time string, then it is assumed to last 30 minutes)
fn parse_token(json: &str, now_epoch: u64) -> Option<(String, Duration)> {
    let v: serde_json::Value = serde_json::from_str(json.trim()).ok()?;
    let token = v.get("accessToken")?.as_str()?.to_string();
    let life = v.get("expires_on").and_then(|e| e.as_u64()).map(|e| e.saturating_sub(now_epoch)).unwrap_or(30 * 60);
    Some((token, Duration::from_secs(life)))
}

/// `(true, …)`: the user has to run `az login` (or the sign-in no longer satisfies the tenant's policy); `(false, …)`: something else
fn classify(stderr: &str) -> (bool, String) {
    let first = stderr.lines().map(str::trim).find(|l| !l.is_empty() && !l.starts_with("WARNING")).unwrap_or("the Azure CLI failed").to_string();
    let low = stderr.to_ascii_lowercase();
    if low.contains("is not recognized") || low.contains("command not found") || low.contains("no such file") {
        return (false, "The Azure CLI (az) is not installed or not on the PATH".into());
    }
    let login = low.contains("az login") || low.contains("aadsts") || low.contains("interaction_required") || low.contains("expired") || low.contains("no subscription");
    (login, if login { format!("Run `az login` again ({first})") } else { first })
}

fn run() -> Result<(String, Duration), (bool, String)> {
    use std::process::Command;
    #[cfg(windows)]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        // az is a .cmd file on Windows: it needs the shell, but not a console window
        let mut c = Command::new("cmd");
        c.args(["/C", "az"]).creation_flags(0x0800_0000);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = Command::new("az");
    let out = cmd.args(["account", "get-access-token", "--resource", DEVOPS, "--output", "json"]).output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound { (false, "The Azure CLI (az) is not installed or not on the PATH".to_string()) } else { (false, e.to_string()) }
    })?;
    if !out.status.success() {
        return Err(classify(&String::from_utf8_lossy(&out.stderr)));
    }
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    parse_token(&String::from_utf8_lossy(&out.stdout), now).ok_or((false, "the Azure CLI answered with something unexpected".to_string()))
}

/// an access token for Azure DevOps ("devops") from the CLI's sign-in
pub async fn access_token(res: &str) -> Result<String, (bool, String)> {
    if res != "devops" {
        return Err((false, "the Azure CLI is only used for Azure DevOps".into()));
    }
    if let Some((t, exp)) = &*cache().lock().unwrap() {
        if *exp > Instant::now() + RENEW_BEFORE {
            return Ok(t.clone());
        }
    }
    let (t, life) = tauri::async_runtime::spawn_blocking(run).await.map_err(|e| (false, e.to_string()))??;
    *cache().lock().unwrap() = Some((t.clone(), Instant::now() + life));
    Ok(t)
}

/// Settings → Azure DevOps → Azure CLI: is `az` there and signed in? (never returns the token)
#[tauri::command]
pub async fn az_check() -> Result<String, String> {
    cache().lock().unwrap().take();
    access_token("devops").await.map(|_| "signed in".to_string()).map_err(|e| e.1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_and_lifetime_are_read() {
        let (t, d) = parse_token(r#"{"accessToken":"abc","expiresOn":"2026-11-12 10:00:00.000000","expires_on":1000300,"tenant":"x"}"#, 1000000).unwrap();
        assert_eq!(t, "abc");
        assert_eq!(d, Duration::from_secs(300));
        let (_, d) = parse_token(r#"{"accessToken":"abc"}"#, 5).unwrap();
        assert_eq!(d, Duration::from_secs(1800));
        assert!(parse_token("not json", 0).is_none());
        assert!(parse_token(r#"{"x":1}"#, 0).is_none());
    }

    #[test]
    fn errors_say_what_to_do() {
        assert!(classify("ERROR: Please run 'az login' to setup account.").0);
        assert!(classify("AADSTS50076: multi factor authentication required").0);
        let (login, msg) = classify("'az' is not recognized as an internal or external command");
        assert!(!login && msg.contains("not installed"));
        let (login, msg) = classify("WARNING: something\nERROR: boom");
        assert!(!login && msg == "ERROR: boom");
    }
}
