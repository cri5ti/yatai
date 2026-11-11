//! Self-update: a release build looks for a newer version on GitHub Releases (the endpoint in tauri.conf.json),
//! downloads it in the background, and tells the UI. Installing is the user's call ("Restart to update"):
//! on Windows the installer closes the app, so the UI flushes its pending writes first (see `update_install`).

use std::sync::Mutex;
use std::time::Duration;
use tauri::{menu::MenuItem, AppHandle, Emitter, Manager, State, Wry};
use tauri_plugin_updater::{Update, UpdaterExt};

/// the downloaded update, waiting for the user to restart
#[derive(Default)]
pub struct Pending(Mutex<Option<(Update, Vec<u8>)>>);

/// the tray menu entry that says "Check for updates" / "Restart to update to vX"
pub struct UpdateMenu(pub MenuItem<Wry>);

const CHECK_LABEL: &str = "Check for updates";
/// look again this often while running (the app is meant to stay open for days)
const EVERY: Duration = Duration::from_secs(3 * 3600);

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    current: String,
    /// a downloaded version waiting for a restart
    ready: Option<String>,
    /// debug builds (tauri dev) never update themselves
    enabled: bool,
}

fn status(app: &AppHandle) -> Status {
    let ready = app.state::<Pending>().0.lock().ok().and_then(|p| p.as_ref().map(|(u, _)| u.version.clone()));
    Status { current: app.package_info().version.to_string(), ready, enabled: !cfg!(debug_assertions) }
}

/// check, and download when something newer is out. Err = could not reach / verify; Ok = nothing newer or downloaded.
async fn check(app: &AppHandle) -> Result<(), String> {
    if app.state::<Pending>().0.lock().map_err(|e| e.to_string())?.is_some() {
        return Ok(()); // one is already waiting
    }
    let Some(update) = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())? else {
        return Ok(());
    };
    let bytes = update.download(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    let version = update.version.clone();
    *app.state::<Pending>().0.lock().map_err(|e| e.to_string())? = Some((update, bytes));
    let _ = app.state::<UpdateMenu>().0.set_text(format!("Restart to update to v{version}"));
    let _ = app.emit_to("main", "yatai://update-ready", version);
    Ok(())
}

/// the background loop: shortly after start, then every few hours. Failures (offline) are silent: the next round retries.
pub fn start(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(20)).await;
        loop {
            if let Err(e) = check(&app).await {
                eprintln!("yatai: update check failed: {e}");
            }
            tokio::time::sleep(EVERY).await;
        }
    });
}

#[tauri::command]
pub fn update_status(app: AppHandle) -> Status {
    status(&app)
}

/// "Check now" from Settings / the tray: reports the outcome, errors included
#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Status, String> {
    if cfg!(debug_assertions) {
        return Err("updates are off in dev builds".into());
    }
    check(&app).await?;
    Ok(status(&app))
}

/// install what was downloaded. Windows: the installer takes over and ends the process (the passive installer
/// relaunches yatai); elsewhere this returns and we restart. The UI has flushed its writes before calling.
#[tauri::command]
pub fn update_install(app: AppHandle, pending: State<Pending>) -> Result<(), String> {
    let (update, bytes) = pending.0.lock().map_err(|e| e.to_string())?.take().ok_or("no update downloaded")?;
    if let Err(e) = update.install(&bytes) {
        // keep it for another try
        *pending.0.lock().map_err(|e| e.to_string())? = Some((update, bytes));
        return Err(e.to_string());
    }
    app.restart()
}

/// the tray entry: install when an update waits, else look now
pub fn tray_clicked(app: &AppHandle) {
    if status(app).ready.is_some() {
        let _ = app.emit_to("main", "yatai://update-install", ());
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let msg = match check(&app).await {
            Ok(()) => match status(&app).ready {
                Some(v) => format!("yatai v{v} is ready: restart to update"),
                None => "yatai is up to date".into(),
            },
            Err(e) => format!("Update check failed: {e}"),
        };
        let _ = app.emit_to("main", "yatai://update-msg", msg);
    });
}

pub fn menu_item(app: &AppHandle) -> tauri::Result<MenuItem<Wry>> {
    MenuItem::with_id(app, "update", CHECK_LABEL, !cfg!(debug_assertions), None::<&str>)
}
