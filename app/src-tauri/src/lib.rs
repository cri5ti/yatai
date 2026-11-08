mod ai;
mod db;
mod plugin;

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// set once the UI has flushed its pending writes (or gave up waiting): then quitting really quits
static CAN_EXIT: AtomicBool = AtomicBool::new(false);

/* ---------- commands ---------- */

#[tauri::command]
fn db_load(db: State<db::Db>) -> Result<serde_json::Value, String> {
    let c = db.0.lock().map_err(|e| e.to_string())?;
    db::load(&c)
}

#[tauri::command]
fn db_apply(db: State<db::Db>, ops: Vec<db::Op>) -> Result<(), String> {
    let mut c = db.0.lock().map_err(|e| e.to_string())?;
    db::apply(&mut c, &ops)
}

#[tauri::command]
fn db_path(app: AppHandle) -> String {
    data_file(&app).display().to_string()
}

/// the inbox count next to the tray icon (macOS menu bar) / in its tooltip
#[tauri::command]
fn set_badge(tray: State<Tray>, count: u32) {
    if let Some(t) = tray.0.lock().ok().and_then(|t| t.clone()) {
        let label = if count > 0 { Some(count.to_string()) } else { None };
        #[cfg(target_os = "macos")]
        let _ = t.set_title(label.as_deref());
        let _ = t.set_tooltip(Some(match label {
            Some(n) => format!("yatai · {n} in the inbox"),
            None => "yatai".into(),
        }));
    }
}

#[tauri::command]
fn show_capture(app: AppHandle) {
    open_capture(&app);
}

/// a popup window (settings, help, the AI chat, the drawers, the developer panel): created on first use,
/// then only moved / shown / hidden. The main window decides when and where (see src/popups.ts).
/// Async: on Windows a window must not be created from a synchronous command (it would deadlock).
#[tauri::command]
async fn popup_open(app: AppHandle, view: String, x: f64, y: f64, w: f64, h: f64, focus: bool) -> Result<(), String> {
    if view.is_empty() || !view.chars().all(|c| c.is_ascii_lowercase()) {
        return Err(format!("bad popup name {view:?}"));
    }
    let label = format!("popup-{view}");
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.set_size(LogicalSize::new(w, h));
        let _ = win.set_position(LogicalPosition::new(x, y));
        let _ = win.show();
        if focus {
            let _ = win.set_focus();
        }
        return Ok(());
    }
    let main = app.get_webview_window("main").ok_or("no main window")?;
    // created hidden: the page shows itself once it has its first state and has painted
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("popup.html".into()))
        .title("yatai")
        .decorations(false)
        .shadow(true)
        .skip_taskbar(true)
        .visible(false)
        .inner_size(w, h)
        .min_inner_size(260.0, 140.0)
        .position(x, y)
        // a child of the main window: kept above it, and (macOS) moved along with it
        .parent(&main)
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn popup_close(app: AppHandle, view: String) {
    if let Some(win) = app.get_webview_window(&format!("popup-{view}")) {
        // give the keyboard back to the main window, unless the user had already gone somewhere else
        let had_focus = win.is_focused().unwrap_or(false);
        let _ = win.hide();
        if had_focus {
            if let Some(main) = app.get_webview_window("main") {
                if main.is_visible().unwrap_or(false) {
                    let _ = main.set_focus();
                }
            }
        }
    }
}

/// open a web link in the system browser (the webview itself never navigates away)
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let ok = reqwest::Url::parse(&url).map(|u| matches!(u.scheme(), "http" | "https")).unwrap_or(false);
    if !ok {
        return Err("only http(s) links".into());
    }
    #[cfg(target_os = "macos")]
    let mut cmd = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("rundll32");
        c.arg("url.dll,FileProtocolHandler");
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = std::process::Command::new("xdg-open");
    cmd.arg(&url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// the UI calls this once its writes are on disk
#[tauri::command]
fn quit(app: AppHandle) {
    CAN_EXIT.store(true, Ordering::SeqCst);
    app.exit(0);
}

/* ---------- shell ---------- */

struct Tray(Mutex<Option<TrayIcon>>);
/// global shortcuts another app already had
struct Taken(Vec<&'static str>);

#[tauri::command]
fn shortcuts_taken(t: State<Taken>) -> Vec<&'static str> {
    t.0.clone()
}

fn data_file(app: &AppHandle) -> std::path::PathBuf {
    let dir = app.path().app_data_dir().expect("no app data dir");
    std::fs::create_dir_all(&dir).ok();
    dir.join("yatai.db")
}

/// everything about the main window (show / hide, layout, position) is decided by the UI; the shell only asks
fn to_main(app: &AppHandle, event: &str) {
    if event == "yatai://show" {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
    let _ = app.emit_to("main", event, ());
}

fn open_capture(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("capture") {
        let _ = w.center();
        let _ = w.show();
        let _ = w.set_focus();
        let _ = app.emit_to("capture", "yatai://capture-open", ());
    }
}

/// a small diamond, drawn rather than shipped (template image: macOS tints it for the menu bar)
fn tray_image() -> Image<'static> {
    const N: u32 = 36;
    let mut px = vec![0u8; (N * N * 4) as usize];
    let c = (N as f32 - 1.0) / 2.0;
    for y in 0..N {
        for x in 0..N {
            let d = (x as f32 - c).abs() + (y as f32 - c).abs();
            let a = ((c - 3.0 - d) * 1.5).clamp(0.0, 1.0); // anti-aliased edge
            let i = ((y * N + x) * 4) as usize;
            px[i + 3] = (a * 255.0) as u8;
        }
    }
    Image::new_owned(px, N, N)
}

fn build_tray(app: &AppHandle) -> tauri::Result<TrayIcon> {
    let show = MenuItem::with_id(app, "toggle", "Show / hide yatai", true, Some("Alt+Y"))?;
    let capture = MenuItem::with_id(app, "capture", "Quick capture…", true, Some("Alt+Space"))?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let dev = MenuItem::with_id(app, "dev", "Developer panel", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit yatai", true, Some("CmdOrCtrl+Q"))?;
    let sep = || PredefinedMenuItem::separator(app);
    let menu = Menu::with_items(app, &[&show, &capture, &sep()?, &settings, &dev, &sep()?, &quit])?;
    TrayIconBuilder::with_id("yatai")
        .icon(tray_image())
        .icon_as_template(true)
        .tooltip("yatai")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
            "toggle" => to_main(app, "yatai://toggle"),
            "capture" => open_capture(app),
            "settings" => to_main(app, "yatai://settings"),
            "dev" => to_main(app, "yatai://dev"),
            "quit" => app.exit(0), // goes through ExitRequested, which lets the UI flush first
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                to_main(tray.app_handle(), "yatai://toggle");
            }
        })
        .build(app)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let toggle = Shortcut::new(Some(Modifiers::ALT), Code::KeyY);
    let capture = Shortcut::new(Some(Modifiers::ALT), Code::Space);

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| to_main(app, "yatai://show")))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, sc, e| {
                    if e.state() != ShortcutState::Pressed {
                        return;
                    }
                    if sc == &toggle {
                        to_main(app, "yatai://toggle");
                    } else if sc == &capture {
                        open_capture(app);
                    }
                })
                .build(),
        )
        .manage(Tray(Mutex::new(None)))
        .setup(move |app| {
            let path = data_file(app.handle());
            let conn = db::open(&path).map_err(|e| format!("cannot open {}: {e}", path.display()))?;
            app.manage(db::Db(Mutex::new(conn)));
            let tray = build_tray(app.handle())?;
            *app.state::<Tray>().0.lock().unwrap() = Some(tray);
            // another app may own a shortcut already (⌥Space is popular): yatai still starts, and says so
            let mut taken = vec![];
            for (sc, name) in [(toggle, "⌥Y"), (capture, "⌥Space")] {
                if let Err(e) = app.global_shortcut().register(sc) {
                    eprintln!("yatai: cannot register {name}: {e}");
                    taken.push(name);
                }
            }
            app.manage(Taken(taken));
            Ok(())
        })
        .on_window_event(|w, e| {
            // closing a window only hides it; yatai lives in the tray
            if let WindowEvent::CloseRequested { api, .. } = e {
                api.prevent_close();
                match w.label() {
                    "main" => {
                        let _ = w.emit_to("main", "yatai://hide", ());
                    }
                    // a popup is open because the state says so: the main window closes it there
                    l if l.starts_with("popup-") => {
                        let _ = w.emit_to("main", "yatai://popup-closed", l.trim_start_matches("popup-"));
                    }
                    _ => {
                        let _ = w.hide();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            db_load,
            db_apply,
            db_path,
            set_badge,
            show_capture,
            popup_open,
            popup_close,
            shortcuts_taken,
            quit,
            open_url,
            ai::ai_key_status,
            ai::ai_set_key,
            ai::ai_post,
            plugin::plugin_secret_status,
            plugin::plugin_secret_set,
            plugin::plugin_http,
            plugin::plugin_get_secret_url,
        ])
        .build(tauri::generate_context!())
        .expect("error while building yatai");

    app.run(|app, e| {
        if let RunEvent::ExitRequested { api, .. } = e {
            if CAN_EXIT.load(Ordering::SeqCst) {
                return;
            }
            // let the UI write what is pending, then quit (or quit anyway after a second)
            api.prevent_exit();
            let _ = app.emit_to("main", "yatai://quit", ());
            let app = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(1200));
                CAN_EXIT.store(true, Ordering::SeqCst);
                app.exit(0);
            });
        }
    });
}
