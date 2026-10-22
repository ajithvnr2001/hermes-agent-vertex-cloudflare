#!/usr/bin/env python3
"""
Continuous Persistent Disk Sync Daemon for Hermes Agent (/data/hermes/storage).
Syncs all sessions, messages, memories, kanban tasks, todos, cronjobs, and persona files
from Cloudflare Worker R2 to local persistent disk (/data/hermes/storage/ JSON files + SQLite hermes_store.db).
"""
import base64
import json
import os
import sqlite3
import time
import urllib.request
from pathlib import Path

HERMES_ROOT = Path(os.environ.get("HERMES_DATA_DIR", "/data/hermes"))
STORAGE_DIR = HERMES_ROOT / "storage"
SESSIONS_DIR = STORAGE_DIR / "sessions"
SQLITE_PATH = STORAGE_DIR / "hermes_store.db"
WORKER_URL = os.environ.get("HERMES_WORKER_URL", "https://hermes.example.com").rstrip("/")
EXPORT_URL = os.environ.get("HERMES_EXPORT_URL", f"{WORKER_URL}/api/export")
AUTH_USER = os.environ.get("HERMES_AUTH_USER", "admin@example.com")
AUTH_PASS = os.environ.get("HERMES_AUTH_PASSWORD", "CHANGE_ME_STRONG_PASSWORD")


def init_sqlite():
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(SQLITE_PATH)
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            title TEXT,
            model TEXT,
            thinking_mode TEXT,
            message_count INTEGER,
            created_at TEXT,
            updated_at TEXT
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            session_id TEXT,
            id INTEGER,
            role TEXT,
            content TEXT,
            thoughts TEXT,
            model TEXT,
            thinking_mode TEXT,
            tool_calls TEXT,
            created_at TEXT,
            PRIMARY KEY (session_id, id)
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS memories_v2 (
            id TEXT PRIMARY KEY,
            content TEXT,
            category TEXT,
            source_session_id TEXT,
            created_at TEXT,
            updated_at TEXT
        )
    """)
    try:
        c.execute("INSERT OR IGNORE INTO memories_v2 SELECT CAST(id AS TEXT), content, category, source_session_id, created_at, updated_at FROM memories")
        c.execute("DROP TABLE memories")
        c.execute("ALTER TABLE memories_v2 RENAME TO memories")
    except Exception:
        c.execute("""
            CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY,
                content TEXT,
                category TEXT,
                source_session_id TEXT,
                created_at TEXT,
                updated_at TEXT
            )
        """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS kanban_tasks (
            id TEXT PRIMARY KEY,
            title TEXT,
            description TEXT,
            column_name TEXT,
            priority TEXT,
            assignee TEXT,
            comments TEXT,
            created_at TEXT,
            updated_at TEXT
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS todos (
            id TEXT PRIMARY KEY,
            title TEXT,
            status TEXT,
            priority TEXT,
            created_at TEXT
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS cronjobs (
            id TEXT PRIMARY KEY,
            name TEXT,
            schedule TEXT,
            prompt TEXT,
            model TEXT,
            enabled INTEGER,
            last_run TEXT,
            last_result TEXT,
            created_at TEXT
        )
    """)
    conn.commit()
    conn.close()


def sync_once():
    creds = base64.b64encode(f"{AUTH_USER}:{AUTH_PASS}".encode()).decode()
    req = urllib.request.Request(
        EXPORT_URL,
        headers={
            "Authorization": f"Basic {creds}",
            "User-Agent": "Hermes-Data-Disk-Sync/1.0"
        }
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        payload = json.loads(resp.read().decode("utf-8"))

    # 1. Save full snapshot and index on /data/hermes/storage
    (STORAGE_DIR / "full_snapshot.json").write_text(json.dumps(payload, indent=2))
    idx = payload.get("index") or payload
    memories_list = idx.get("memories") or payload.get("memories") or []
    kanban_list = idx.get("kanban_tasks") or idx.get("kanban") or payload.get("kanban_tasks") or []
    todos_list = idx.get("todos") or payload.get("todos") or []
    cronjobs_list = idx.get("cronjobs") or payload.get("cronjobs") or []
    sessions_list = idx.get("sessions") or payload.get("sessions") or []

    (STORAGE_DIR / "index.json").write_text(json.dumps(idx, indent=2))
    (STORAGE_DIR / "memories.json").write_text(json.dumps(memories_list, indent=2))
    (STORAGE_DIR / "kanban.json").write_text(json.dumps(kanban_list, indent=2))
    (STORAGE_DIR / "todos.json").write_text(json.dumps(todos_list, indent=2))
    (STORAGE_DIR / "cronjobs.json").write_text(json.dumps(cronjobs_list, indent=2))

    # 2. Save each session file on /data/hermes/storage/sessions/<id>.json
    sessions_data = payload.get("sessions_data", {})
    for s in sessions_list:
        if isinstance(s, dict) and s.get("id"):
            sessions_data[s["id"]] = s
    for sid, sdata in sessions_data.items():
        (SESSIONS_DIR / f"{sid}.json").write_text(json.dumps(sdata, indent=2))

    # 3. Sync into SQLite database on /data/hermes/storage/hermes_store.db
    conn = sqlite3.connect(SQLITE_PATH)
    c = conn.cursor()
    for mem in memories_list:
        c.execute("""
            INSERT OR REPLACE INTO memories (id, content, category, source_session_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            str(mem.get("id")),
            mem.get("content"),
            mem.get("category"),
            mem.get("source_session_id"),
            mem.get("created_at"),
            mem.get("updated_at")
        ))

    for s in sessions_list:
        c.execute("""
            INSERT OR REPLACE INTO sessions (id, title, model, thinking_mode, message_count, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            s.get("id"),
            s.get("title"),
            s.get("model"),
            s.get("thinking_level") or s.get("thinking_mode", "auto"),
            len(s.get("messages", [])) or s.get("message_count", 0),
            s.get("created_at"),
            s.get("updated_at")
        ))

    for sid, sdata in sessions_data.items():
        for idx_m, m in enumerate(sdata.get("messages", [])):
            tc = m.get("tool_calls")
            tc_str = json.dumps(tc) if tc is not None and not isinstance(tc, str) else tc
            c.execute("""
                INSERT OR REPLACE INTO messages (session_id, id, role, content, thoughts, model, thinking_mode, tool_calls, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                sid,
                m.get("id") or (idx_m + 1),
                m.get("role"),
                m.get("content"),
                m.get("thoughts"),
                m.get("model"),
                m.get("thinking_level") or m.get("thinking_mode"),
                tc_str,
                m.get("created_at")
            ))

    for k in kanban_list:
        c.execute("""
            INSERT OR REPLACE INTO kanban_tasks (id, title, description, column_name, priority, assignee, comments, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            k.get("id"),
            k.get("title"),
            k.get("description", ""),
            k.get("column", "todo"),
            k.get("priority", "medium"),
            k.get("assignee", "hermes"),
            json.dumps(k.get("comments", [])),
            k.get("created_at"),
            k.get("updated_at")
        ))

    for t in todos_list:
        c.execute("""
            INSERT OR REPLACE INTO todos (id, title, status, priority, created_at)
            VALUES (?, ?, ?, ?, ?)
        """, (
            str(t.get("id")),
            t.get("title"),
            t.get("status", "pending"),
            t.get("priority", "medium"),
            t.get("created_at") or t.get("updated_at")
        ))

    for cj in cronjobs_list:
        c.execute("""
            INSERT OR REPLACE INTO cronjobs (id, name, schedule, prompt, model, enabled, last_run, last_result, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            cj.get("id"),
            cj.get("name"),
            cj.get("schedule"),
            cj.get("prompt"),
            cj.get("model"),
            1 if cj.get("enabled", True) else 0,
            cj.get("last_run"),
            cj.get("last_output") or cj.get("last_result"),
            cj.get("created_at")
        ))

    conn.commit()
    conn.close()
    print(
        f"[hermes-sync] Synced {len(sessions_list)} sessions, "
        f"{len(memories_list)} memories, "
        f"{len(kanban_list)} kanban tasks, "
        f"{len(todos_list)} todos, "
        f"{len(cronjobs_list)} cronjobs to /data/hermes/storage",
        flush=True
    )


def main():
    init_sqlite()
    if "--once" in os.sys.argv:
        sync_once()
        return
    while True:
        try:
            sync_once()
        except Exception as e:
            print(f"[hermes-sync] Warning: {e}", flush=True)
        time.sleep(30)


if __name__ == "__main__":
    main()
