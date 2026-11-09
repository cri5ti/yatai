//! Local SQLite store. The UI keeps the whole document in memory and sends row-level changes here
//! (`db_apply`), one transaction per batch. Tables and columns are whitelisted below; values arrive as JSON.

use rusqlite::{params_from_iter, types::Value as Sql, Connection};
use serde::Deserialize;
use serde_json::{Map, Value};
use std::{path::Path, sync::Mutex};

pub struct Db(pub Mutex<Connection>);

/// every table the UI may write, with its columns (the first one is the primary key)
const TABLES: &[(&str, &[&str])] = &[
    (
        "item",
        &[
            "id", "ord", "parent_id", "title", "status", "today", "open", "created", "modified", "last_run", "scheduled", "est", "due",
            "later", "spent", "smart", "notify",
        ],
    ),
    ("inbox", &["id", "ord", "text", "created", "suggestion"]),
    ("meeting", &["id", "ord", "day", "title", "start", "moved_to", "duration_min", "location", "open"]),
    ("plan_seg", &["id", "ord", "owner", "items", "keep", "pulled"]),
    ("kv", &["key", "value"]),
];

/// versioned migrations; `user_version` records how many have run
const MIGRATIONS: &[&str] = &[r#"
    CREATE TABLE item (
        id TEXT PRIMARY KEY, ord INTEGER NOT NULL, parent_id TEXT, title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'todo', today INTEGER NOT NULL DEFAULT 0, open INTEGER NOT NULL DEFAULT 1,
        created INTEGER NOT NULL, modified INTEGER NOT NULL, last_run INTEGER, scheduled INTEGER,
        est INTEGER, due TEXT, later INTEGER, spent INTEGER, smart TEXT
    );
    CREATE INDEX item_parent ON item(parent_id);
    CREATE TABLE inbox (id TEXT PRIMARY KEY, ord INTEGER NOT NULL, text TEXT NOT NULL, created INTEGER NOT NULL, suggestion TEXT);
    CREATE TABLE meeting (
        id TEXT PRIMARY KEY, ord INTEGER NOT NULL, day TEXT, title TEXT NOT NULL, start INTEGER NOT NULL,
        moved_to INTEGER, duration_min INTEGER NOT NULL, location TEXT, open INTEGER
    );
    CREATE TABLE plan_seg (id TEXT PRIMARY KEY, ord INTEGER NOT NULL, owner TEXT NOT NULL, items TEXT NOT NULL, keep INTEGER, pulled INTEGER);
    CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"#, r#"
    ALTER TABLE item ADD COLUMN notify INTEGER;
"#];

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let mut c = Connection::open(path)?;
    c.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = OFF;")?;
    let v: usize = c.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(v) {
        let tx = c.transaction()?;
        tx.execute_batch(sql)?;
        tx.execute_batch(&format!("PRAGMA user_version = {}", i + 1))?;
        tx.commit()?;
    }
    Ok(c)
}

fn cols(table: &str) -> Result<&'static [&'static str], String> {
    TABLES.iter().find(|(t, _)| *t == table).map(|(_, c)| *c).ok_or_else(|| format!("unknown table {table}"))
}

fn to_sql(v: &Value) -> Sql {
    match v {
        Value::Null => Sql::Null,
        Value::Bool(b) => Sql::Integer(*b as i64),
        Value::Number(n) => n.as_i64().map(Sql::Integer).unwrap_or_else(|| Sql::Real(n.as_f64().unwrap_or(0.0))),
        Value::String(s) => Sql::Text(s.clone()),
        other => Sql::Text(other.to_string()),
    }
}

fn from_sql(v: rusqlite::types::ValueRef) -> Value {
    use rusqlite::types::ValueRef::*;
    match v {
        Null => Value::Null,
        Integer(i) => Value::from(i),
        Real(f) => Value::from(f),
        Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        Blob(_) => Value::Null,
    }
}

/// everything, every table ordered by `ord` — the UI maps rows back into its document
pub fn load(c: &Connection) -> Result<Value, String> {
    let mut out = Map::new();
    for (table, columns) in TABLES {
        let order = if columns.contains(&"ord") { " ORDER BY ord" } else { "" };
        let mut st = c.prepare(&format!("SELECT {} FROM {table}{order}", columns.join(", "))).map_err(|e| e.to_string())?;
        let rows = st
            .query_map([], |r| {
                let mut m = Map::new();
                for (i, col) in columns.iter().enumerate() {
                    m.insert((*col).to_string(), from_sql(r.get_ref(i)?));
                }
                Ok(Value::Object(m))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        out.insert((*table).to_string(), Value::Array(rows));
    }
    Ok(Value::Object(out))
}

#[derive(Deserialize)]
pub struct Op {
    t: String,
    put: Option<Map<String, Value>>,
    del: Option<String>,
}

impl Op {
    pub fn table(&self) -> &str {
        &self.t
    }
}

pub fn apply(c: &mut Connection, ops: &[Op]) -> Result<(), String> {
    let tx = c.transaction().map_err(|e| e.to_string())?;
    for op in ops {
        let columns = cols(&op.t)?;
        if let Some(row) = &op.put {
            let sql = format!(
                "INSERT OR REPLACE INTO {} ({}) VALUES ({})",
                op.t,
                columns.join(", "),
                vec!["?"; columns.len()].join(", ")
            );
            let vals: Vec<Sql> = columns.iter().map(|k| row.get(*k).map(to_sql).unwrap_or(Sql::Null)).collect();
            tx.execute(&sql, params_from_iter(vals)).map_err(|e| format!("{}: {e}", op.t))?;
        }
        if let Some(id) = &op.del {
            tx.execute(&format!("DELETE FROM {} WHERE {} = ?", op.t, columns[0]), [id]).map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ops(v: Value) -> Vec<Op> {
        serde_json::from_value(v).unwrap()
    }

    #[test]
    fn migrate_put_load_delete() {
        let dir = std::env::temp_dir().join(format!("yatai-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.db");
        let _ = std::fs::remove_file(&path);
        let mut c = open(&path).unwrap();
        apply(
            &mut c,
            &ops(json!([
                { "t": "item", "put": { "id": "b", "ord": 1, "parent_id": "a", "title": "child", "status": "todo", "today": true, "open": true, "created": 1, "modified": 2, "est": 30, "smart": "{\"source\":\"pr\"}" } },
                { "t": "item", "put": { "id": "a", "ord": 0, "parent_id": null, "title": "parent", "status": "done", "today": false, "open": false, "created": 1, "modified": 2 } },
                { "t": "kv", "put": { "key": "ui", "value": "{\"tab\":\"next\"}" } },
                { "t": "plan_seg", "put": { "id": "s1", "ord": 0, "owner": "a", "items": "[\"b\"]" } }
            ])),
        )
        .unwrap();
        drop(c);
        // reopening runs no migration twice
        let mut c = open(&path).unwrap();
        let v = load(&c).unwrap();
        let items = v["item"].as_array().unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0]["id"], "a"); // ordered by ord
        assert_eq!(items[1]["today"], 1);
        assert_eq!(items[1]["est"], 30);
        assert_eq!(items[0]["est"], Value::Null);
        assert_eq!(v["kv"][0]["value"], "{\"tab\":\"next\"}");
        apply(&mut c, &ops(json!([{ "t": "item", "del": "b" }, { "t": "item", "put": { "id": "a", "ord": 0, "title": "renamed", "status": "todo", "today": false, "open": true, "created": 1, "modified": 3 } }]))).unwrap();
        let v = load(&c).unwrap();
        assert_eq!(v["item"].as_array().unwrap().len(), 1);
        assert_eq!(v["item"][0]["title"], "renamed");
        // unknown tables are refused, and the batch is rolled back
        assert!(apply(&mut c, &ops(json!([{ "t": "item", "del": "a" }, { "t": "sqlite_master", "del": "x" }]))).is_err());
        assert_eq!(load(&c).unwrap()["item"].as_array().unwrap().len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
