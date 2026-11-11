//! Automatic backups of the SQLite file, kept in `<app data>/backups/`.
//!  - daily:    `yatai-daily-YYYY-MM-DD.db`, one per local day (taken the first time yatai runs that day)
//!  - frequent: `yatai-snap-YYYYMMDD-HHMMSS.db`, every N minutes, only if the document changed since the last one
//! Each kind keeps its own number of files; older ones are deleted. A snapshot is `VACUUM INTO`: a consistent,
//! compact copy taken while yatai keeps running. Settings live in `backup.json` next to the database, so the
//! schedule works from launch, before the UI is up.

use chrono::Local;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, State};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub daily: bool,
    pub daily_keep: u32,
    pub frequent: bool,
    pub frequent_every_min: u32,
    pub frequent_keep: u32,
}

impl Default for Config {
    fn default() -> Self {
        Config { daily: true, daily_keep: 14, frequent: true, frequent_every_min: 15, frequent_keep: 8 }
    }
}

impl Config {
    fn clamped(mut self) -> Self {
        self.daily_keep = self.daily_keep.clamp(1, 365);
        self.frequent_keep = self.frequent_keep.clamp(1, 200);
        self.frequent_every_min = self.frequent_every_min.clamp(1, 24 * 60);
        self
    }
}

pub struct Backups {
    dir: PathBuf,
    file: PathBuf,
    cfg: Mutex<Config>,
    /// the document changed since the last frequent snapshot
    dirty: AtomicBool,
    last_frequent: Mutex<Instant>,
}

impl Backups {
    pub fn new(data_dir: &Path) -> Backups {
        let file = data_dir.join("backup.json");
        let cfg = fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str::<Config>(&t).ok()).unwrap_or_default().clamped();
        Backups { dir: data_dir.join("backups"), file, cfg: Mutex::new(cfg), dirty: AtomicBool::new(false), last_frequent: Mutex::new(Instant::now()) }
    }
    /// called after every write to the document (not to UI preferences)
    pub fn touched(&self) {
        self.dirty.store(true, Ordering::Relaxed);
    }
}

const DAILY: &str = "yatai-daily-";
const SNAP: &str = "yatai-snap-";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    name: String,
    kind: &'static str,
    size: u64,
    /// ms since the epoch
    modified: u64,
}

fn kind_of(name: &str) -> Option<&'static str> {
    if !name.ends_with(".db") {
        None
    } else if name.starts_with(DAILY) {
        Some("daily")
    } else if name.starts_with(SNAP) {
        Some("frequent")
    } else {
        None
    }
}

/// every backup, newest first (the names sort by time)
fn list(dir: &Path) -> Vec<Info> {
    let mut out: Vec<Info> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let kind = kind_of(&name)?;
            let md = e.metadata().ok()?;
            let modified = md.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as u64;
            Some(Info { name, kind, size: md.len(), modified })
        })
        .collect();
    out.sort_by(|a, b| b.name.cmp(&a.name));
    out
}

fn prune(dir: &Path, cfg: &Config) {
    let all = list(dir);
    for (kind, keep) in [("daily", cfg.daily_keep), ("frequent", cfg.frequent_keep)] {
        for old in all.iter().filter(|i| i.kind == kind).skip(keep.max(1) as usize) {
            let _ = fs::remove_file(dir.join(&old.name));
        }
    }
}

/// a consistent copy of the database; written under a temporary name, so a half-written file never looks like a backup
fn snapshot(conn: &Connection, dir: &Path, name: &str) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!("{name}.tmp"));
    let _ = fs::remove_file(&tmp);
    conn.execute("VACUUM INTO ?1", [tmp.to_string_lossy().as_ref()]).map_err(|e| format!("backup: {e}"))?;
    fs::rename(&tmp, dir.join(name)).map_err(|e| e.to_string())
}

fn snap_name() -> String {
    format!("{SNAP}{}.db", Local::now().format("%Y%m%d-%H%M%S"))
}
fn daily_name() -> String {
    format!("{DAILY}{}.db", Local::now().format("%Y-%m-%d"))
}

/// run every 30 s: take what is due
fn tick(app: &AppHandle) {
    let bk = app.state::<Backups>();
    let cfg = bk.cfg.lock().unwrap().clone();
    let db = app.state::<crate::db::Db>();
    if cfg.daily && !bk.dir.join(daily_name()).exists() {
        let r = db.0.lock().map_err(|e| e.to_string()).and_then(|c| snapshot(&c, &bk.dir, &daily_name()));
        if let Err(e) = r {
            eprintln!("yatai: daily backup failed: {e}");
        }
        prune(&bk.dir, &cfg);
    }
    if cfg.frequent && bk.dirty.load(Ordering::Relaxed) {
        let due = bk.last_frequent.lock().unwrap().elapsed() >= Duration::from_secs(cfg.frequent_every_min as u64 * 60);
        if due {
            bk.dirty.store(false, Ordering::Relaxed);
            let r = db.0.lock().map_err(|e| e.to_string()).and_then(|c| snapshot(&c, &bk.dir, &snap_name()));
            match r {
                Ok(()) => {
                    *bk.last_frequent.lock().unwrap() = Instant::now();
                    prune(&bk.dir, &cfg);
                }
                Err(e) => {
                    bk.dirty.store(true, Ordering::Relaxed); // try again next time
                    eprintln!("yatai: backup failed: {e}");
                }
            }
        }
    }
}

pub fn start(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(30));
        tick(&app);
    });
}

/* ---------- commands ---------- */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    db_path: String,
    db_size: u64,
    dir: String,
    config: Config,
    backups: Vec<Info>,
}

#[tauri::command]
pub fn backup_status(app: AppHandle, bk: State<Backups>) -> Status {
    let db = crate::data_file(&app);
    let size = |p: &Path| fs::metadata(p).map(|m| m.len()).unwrap_or(0);
    let wal = PathBuf::from(format!("{}-wal", db.display()));
    Status {
        db_path: db.display().to_string(),
        db_size: size(&db) + size(&wal),
        dir: bk.dir.display().to_string(),
        config: bk.cfg.lock().unwrap().clone(),
        backups: list(&bk.dir),
    }
}

#[tauri::command]
pub fn backup_set_config(bk: State<Backups>, config: Config) -> Result<Config, String> {
    let config = config.clamped();
    fs::write(&bk.file, serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    *bk.cfg.lock().unwrap() = config.clone();
    prune(&bk.dir, &config);
    Ok(config)
}

/// a snapshot right now (counts with the frequent ones)
#[tauri::command]
pub fn backup_now(db: State<crate::db::Db>, bk: State<Backups>) -> Result<(), String> {
    let c = db.0.lock().map_err(|e| e.to_string())?;
    snapshot(&c, &bk.dir, &snap_name())?;
    drop(c);
    prune(&bk.dir, &bk.cfg.lock().unwrap());
    Ok(())
}

/// show the data folder (`which` = "data") or the backups folder in the file manager
#[tauri::command]
pub fn backup_reveal(app: AppHandle, bk: State<Backups>, which: String) -> Result<(), String> {
    let dir = if which == "backups" {
        fs::create_dir_all(&bk.dir).map_err(|e| e.to_string())?;
        bk.dir.clone()
    } else {
        crate::data_file(&app).parent().map(Path::to_path_buf).ok_or("no data folder")?
    };
    #[cfg(target_os = "macos")]
    let mut cmd = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut cmd = std::process::Command::new("explorer");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = std::process::Command::new("xdg-open");
    cmd.arg(dir).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_and_prune() {
        let dir = std::env::temp_dir().join(format!("yatai-bk-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let c = crate::db::open(&dir.join("t.db")).unwrap();
        c.execute("INSERT INTO kv (key, value) VALUES ('a', 'b')", []).unwrap();
        let bdir = dir.join("backups");
        for n in ["yatai-snap-20240101-000001.db", "yatai-snap-20240101-000002.db", "yatai-snap-20240101-000003.db", "yatai-daily-2024-01-01.db", "yatai-daily-2024-01-02.db"] {
            snapshot(&c, &bdir, n).unwrap();
        }
        // the copy is a real database with the data in it
        let copy = Connection::open(bdir.join("yatai-snap-20240101-000003.db")).unwrap();
        let v: String = copy.query_row("SELECT value FROM kv WHERE key = 'a'", [], |r| r.get(0)).unwrap();
        assert_eq!(v, "b");
        drop(copy);
        fs::write(bdir.join("notes.txt"), "x").unwrap();
        prune(&bdir, &Config { daily_keep: 1, frequent_keep: 2, ..Config::default() });
        let names: Vec<_> = list(&bdir).into_iter().map(|i| i.name).collect();
        assert_eq!(names, ["yatai-snap-20240101-000003.db", "yatai-snap-20240101-000002.db", "yatai-daily-2024-01-02.db"]);
        assert!(bdir.join("notes.txt").exists()); // only its own files are touched
        let _ = fs::remove_dir_all(&dir);
    }
}
