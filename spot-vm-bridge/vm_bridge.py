#!/usr/bin/env python3
"""
Hermes Agent — Spot VM Persistent Bridge & Cloudflared Tunnel Supervisor (/data/hermes/vm_bridge.py)
Exposes real Spot VM capabilities (/data filesystem, bash terminal, Python/Node code execution,
58+ Hermes skills, SOUL.md/MEMORY.md/USER.md, process manager, and native `hermes` CLI)
to the Cloudflare Web UI (https://hermes.yourdomain.com) via an authenticated Cloudflare Tunnel.
"""
import base64
import glob
import http.server
import json
import os
import re
import shutil
import socketserver
import subprocess
import sys
import threading
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BRIDGE_PORT = 9120
BRIDGE_SECRET = "CHANGE_ME_BRIDGE_SECRET"
WORKER_URL = "https://hermes.yourdomain.com"
AUTH_USER = "admin@example.com"
AUTH_PASS = "CHANGE_ME_STRONG_PASSWORD"

HERMES_ROOT = Path("/data/hermes")
HERMES_HOME = HERMES_ROOT / ".hermes"
SKILLS_DIR = HERMES_HOME / "skills"
MEMORIES_DIR = HERMES_HOME / "memories"
SCRATCH_DIR = HERMES_ROOT / "storage" / "scratch"
HERMES_BIN = HERMES_HOME / "hermes-agent" / "venv" / "bin" / "hermes"

MEMORIES_DIR.mkdir(parents=True, exist_ok=True)
SCRATCH_DIR.mkdir(parents=True, exist_ok=True)

# Ensure default MEMORY.md and USER.md exist on /data/hermes/.hermes/memories/
MEMORY_MD = MEMORIES_DIR / "MEMORY.md"
USER_MD = MEMORIES_DIR / "USER.md"
SOUL_MD = HERMES_HOME / "SOUL.md"

if not MEMORY_MD.exists():
    MEMORY_MD.write_text(
        "# Hermes Agent Persistent Memory (MEMORY.md)\n\n"
        "- Deployment: Hosted on Cloudflare (`https://hermes.yourdomain.com`) backed by Google Vertex AI (`YOUR_GCP_PROJECT_ID`).\n"
        "- Persistent Storage: All local state, sessions, skills, and databases live on `/data/hermes/` on the Spot VM persistent disk.\n"
        "- Auto-Recovery: `/data/hermes/boot.sh` automatically restores symlinks and systemd services across Spot VM reallocations.\n",
        encoding="utf-8",
    )

if not USER_MD.exists():
    USER_MD.write_text(
        "# User Profile (USER.md)\n\n"
        "- **Owner / Admin:** Ajith (`admin@example.com`)\n"
        "- **Cloud Project:** Google Cloud `YOUR_GCP_PROJECT_ID` (Vertex AI Gemini models + Thinking variants)\n"
        "- **Infrastructure:** Azure Spot VM with 251 GB persistent disk mounted at `/data` + Cloudflare Workers & R2.\n",
        encoding="utf-8",
    )

STATE = {
    "tunnel_url": None,
    "started_at": datetime.now(timezone.utc).isoformat(),
    "last_heartbeat": None,
}


def get_env():
    env = os.environ.copy()
    env["HOME"] = "/root"
    env["HERMES_HOME"] = str(HERMES_HOME)
    env["PATH"] = f"/data/bin:/usr/local/bin:/usr/bin:/bin:{HERMES_HOME}/hermes-agent/venv/bin"
    return env


def run_cmd(command: str, workdir: str = "/data/hermes", timeout: int = 45) -> dict:
    t0 = time.time()
    cwd = workdir if os.path.isdir(workdir) else "/data/hermes"
    try:
        proc = subprocess.run(
            ["/bin/bash", "-c", command],
            cwd=cwd,
            env=get_env(),
            capture_output=True,
            text=True,
            timeout=min(max(int(timeout or 45), 1), 180),
        )
        return {
            "ok": proc.returncode == 0,
            "exit_code": proc.returncode,
            "stdout": proc.stdout[-24000:] if proc.stdout else "",
            "stderr": proc.stderr[-12000:] if proc.stderr else "",
            "duration_ms": int((time.time() - t0) * 1000),
            "workdir": cwd,
        }
    except subprocess.TimeoutExpired as e:
        return {
            "ok": False,
            "exit_code": 124,
            "stdout": (e.stdout or "")[-12000:] if isinstance(e.stdout, str) else "",
            "stderr": f"Command timed out after {timeout}s",
            "duration_ms": int((time.time() - t0) * 1000),
            "workdir": cwd,
        }
    except Exception as e:
        return {
            "ok": False,
            "exit_code": 1,
            "stdout": "",
            "stderr": str(e),
            "duration_ms": int((time.time() - t0) * 1000),
            "workdir": cwd,
        }


def parse_skill_frontmatter(md_text: str) -> dict:
    meta = {"name": "", "description": "", "version": "1.0.0", "tags": []}
    if md_text.startswith("---"):
        parts = md_text.split("---", 2)
        if len(parts) >= 3:
            fm = parts[1]
            for line in fm.splitlines():
                m = re.match(r"^([a-zA-Z0-9_-]+):\s*(.+)$", line.strip())
                if m:
                    k, v = m.group(1), m.group(2).strip().strip('"').strip("'")
                    if k in ("name", "description", "version"):
                        meta[k] = v
                tm = re.search(r"tags:\s*\[([^\]]+)\]", line)
                if tm:
                    meta["tags"] = [x.strip().strip('"').strip("'") for x in tm.group(1).split(",") if x.strip()]
    return meta


def list_all_skills() -> list:
    skills = []
    if not SKILLS_DIR.exists():
        return skills
    for skill_md in sorted(SKILLS_DIR.rglob("SKILL.md")):
        try:
            rel = skill_md.relative_to(SKILLS_DIR)
            parts = rel.parts
            category = parts[0] if len(parts) > 2 else "custom"
            folder_name = skill_md.parent.name
            text = skill_md.read_text(encoding="utf-8", errors="replace")
            meta = parse_skill_frontmatter(text)
            refs = [str(p.relative_to(skill_md.parent)) for p in skill_md.parent.rglob("*") if p.is_file() and p.name != "SKILL.md"]
            skills.append({
                "id": f"{category}/{folder_name}",
                "name": meta["name"] or folder_name,
                "category": category,
                "description": meta["description"] or f"Hermes skill {folder_name}",
                "version": meta["version"],
                "tags": meta["tags"],
                "path": str(skill_md),
                "references": refs[:20],
                "size": len(text),
            })
        except Exception:
            continue
    return skills


def view_skill(name_or_id: str) -> dict:
    q = (name_or_id or "").strip().lower().lstrip("/")
    for s in list_all_skills():
        if s["name"].lower() == q or s["id"].lower() == q or s["path"].lower() == q or q in s["name"].lower():
            p = Path(s["path"])
            content = p.read_text(encoding="utf-8", errors="replace")
            return {"ok": True, "skill": s, "content": content}
    return {"ok": False, "error": f"Skill '{name_or_id}' not found"}


def save_skill(name: str, category: str, description: str, content: str) -> dict:
    slug = re.sub(r"[^a-zA-Z0-9_-]", "-", (name or "custom-skill").strip().lower()).strip("-") or "custom-skill"
    cat = re.sub(r"[^a-zA-Z0-9_-]", "-", (category or "custom").strip().lower()).strip("-") or "custom"
    target_dir = SKILLS_DIR / cat / slug
    target_dir.mkdir(parents=True, exist_ok=True)
    skill_file = target_dir / "SKILL.md"
    if not content.startswith("---"):
        content = (
            f"---\nname: {slug}\ndescription: \"{description or slug}\"\nversion: 1.0.0\n"
            f"metadata:\n  hermes:\n    created_by: agent\n    category: {cat}\n---\n\n{content}"
        )
    skill_file.write_text(content, encoding="utf-8")
    return {"ok": True, "path": str(skill_file), "name": slug, "category": cat}


def get_system_health() -> dict:
    df = run_cmd("df -h /data | tail -n 1", timeout=5)
    du = shutil.disk_usage("/data")
    services = {}
    for svc in ["hermes-dashboard.service", "hermes-sync.service", "hermes-bridge.service"]:
        r = run_cmd(f"systemctl is-active {svc}", timeout=5)
        services[svc] = r["stdout"].strip() or "unknown"
    return {
        "ok": True,
        "hostname": os.uname().nodename,
        "tunnel_url": STATE["tunnel_url"],
        "started_at": STATE["started_at"],
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data_disk": {
            "raw": df["stdout"].strip(),
            "total_gb": round(du.total / (1024**3), 1),
            "used_gb": round(du.used / (1024**3), 1),
            "free_gb": round(du.free / (1024**3), 1),
            "percent": f"{round((du.used / du.total) * 100, 1)}%"
        },
        "services": services,
        "hermes_home": str(HERMES_HOME),
        "skills_count": len(list_all_skills()),
    }


class BridgeHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def _send(self, code: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(200, {"ok": True})

    def _check_auth(self) -> bool:
        sec = self.headers.get("X-Hermes-Bridge-Secret", "")
        if sec == BRIDGE_SECRET:
            return True
        self._send(401, {"error": "Unauthorized bridge request"})
        return False

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, get_system_health())
        if not self._check_auth():
            return
        if self.path == "/skills":
            return self._send(200, {"ok": True, "skills": list_all_skills()})
        self._send(404, {"error": "Not found"})

    def do_POST(self):
        if not self._check_auth():
            return
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
        try:
            body = json.loads(raw)
        except Exception:
            body = {}

        if self.path == "/terminal":
            cmd = body.get("command", "")
            workdir = body.get("workdir", "/data/hermes")
            timeout = int(body.get("timeout", 45))
            return self._send(200, run_cmd(cmd, workdir=workdir, timeout=timeout))

        if self.path == "/execute_code":
            code = body.get("code", "")
            lang = (body.get("language", "python") or "python").lower()
            timeout = int(body.get("timeout", 45))
            ts = int(time.time() * 1000)
            if lang in ("python", "py", "python3"):
                fpath = SCRATCH_DIR / f"run_{ts}.py"
                fpath.write_text(code, encoding="utf-8")
                res = run_cmd(f"python3 {fpath}", workdir="/data/hermes", timeout=timeout)
            elif lang in ("javascript", "js", "node"):
                fpath = SCRATCH_DIR / f"run_{ts}.js"
                fpath.write_text(code, encoding="utf-8")
                res = run_cmd(f"node {fpath}", workdir="/data/hermes", timeout=timeout)
            else:
                fpath = SCRATCH_DIR / f"run_{ts}.sh"
                fpath.write_text(code, encoding="utf-8")
                res = run_cmd(f"bash {fpath}", workdir="/data/hermes", timeout=timeout)
            return self._send(200, res)

        if self.path == "/files":
            action = body.get("action", "list")
            target_path = Path(body.get("path", "/data/hermes")).resolve()
            if action == "list":
                if not target_path.exists():
                    return self._send(404, {"ok": False, "error": f"Path not found: {target_path}"})
                if target_path.is_file():
                    content = target_path.read_text(encoding="utf-8", errors="replace")[:50000]
                    return self._send(200, {"ok": True, "type": "file", "path": str(target_path), "content": content})
                items = []
                for p in sorted(target_path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))[:200]:
                    try:
                        st = p.stat()
                        items.append({
                            "name": p.name,
                            "path": str(p),
                            "type": "dir" if p.is_dir() else "file",
                            "size": st.st_size,
                            "mtime": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat(),
                        })
                    except Exception:
                        continue
                return self._send(200, {"ok": True, "type": "dir", "path": str(target_path), "items": items, "entries": items})

            if action == "read":
                if not target_path.is_file():
                    return self._send(404, {"ok": False, "error": f"File not found: {target_path}"})
                lines = target_path.read_text(encoding="utf-8", errors="replace").splitlines()
                s = max(1, int(body.get("start_line", 1) or 1))
                e = min(len(lines), int(body.get("end_line", len(lines)) or len(lines)))
                snippet = "\n".join(lines[s - 1 : e])
                return self._send(200, {"ok": True, "path": str(target_path), "total_lines": len(lines), "content": snippet[:60000]})

            if action == "write":
                target_path.parent.mkdir(parents=True, exist_ok=True)
                content = body.get("content", "")
                if body.get("append"):
                    with open(target_path, "a", encoding="utf-8") as f:
                        f.write(content)
                else:
                    target_path.write_text(content, encoding="utf-8")
                return self._send(200, {"ok": True, "path": str(target_path), "bytes": len(content)})

            if action == "patch":
                if not target_path.is_file():
                    return self._send(404, {"ok": False, "error": f"File not found: {target_path}"})
                orig = target_path.read_text(encoding="utf-8", errors="replace")
                old = body.get("target", "")
                new = body.get("replacement", "")
                if old not in orig:
                    return self._send(400, {"ok": False, "error": "Target string not found in file"})
                updated = orig.replace(old, new, 1)
                target_path.write_text(updated, encoding="utf-8")
                return self._send(200, {"ok": True, "path": str(target_path)})

            if action == "search":
                q = body.get("query", "")
                search_root = str(target_path) if target_path.exists() else "/data/hermes"
                cmd = f"grep -rnI --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=venv --exclude-dir=__pycache__ { json.dumps(q) } { json.dumps(search_root) } | head -n 60"
                return self._send(200, run_cmd(cmd, timeout=15))

        if self.path == "/skills":
            action = body.get("action", "list")
            if action == "list":
                return self._send(200, {"ok": True, "skills": list_all_skills()})
            if action == "view":
                return self._send(200, view_skill(body.get("name", "")))
            if action == "save":
                return self._send(200, save_skill(
                    body.get("name", ""),
                    body.get("category", "custom"),
                    body.get("description", ""),
                    body.get("content", ""),
                ))
            if action == "delete":
                v = view_skill(body.get("name", ""))
                if v.get("ok") and v["skill"]["category"] == "custom":
                    shutil.rmtree(Path(v["skill"]["path"]).parent, ignore_errors=True)
                    return self._send(200, {"ok": True})
                return self._send(400, {"ok": False, "error": "Only custom skills can be deleted"})

        if self.path == "/memory_files":
            action = body.get("action", "get")
            if action in ("get", "read"):
                s_txt = SOUL_MD.read_text(encoding="utf-8", errors="replace") if SOUL_MD.exists() else ""
                m_txt = MEMORY_MD.read_text(encoding="utf-8", errors="replace") if MEMORY_MD.exists() else ""
                u_txt = USER_MD.read_text(encoding="utf-8", errors="replace") if USER_MD.exists() else ""
                return self._send(200, {
                    "ok": True,
                    "soul_md": s_txt,
                    "memory_md": m_txt,
                    "user_md": u_txt,
                    "files": {"SOUL.md": s_txt, "MEMORY.md": m_txt, "USER.md": u_txt}
                })
            if action in ("set", "write"):
                fname = body.get("file", "")
                content = body.get("content")
                if fname == "SOUL.md" and content is not None:
                    SOUL_MD.write_text(content, encoding="utf-8")
                elif fname == "MEMORY.md" and content is not None:
                    MEMORY_MD.write_text(content, encoding="utf-8")
                elif fname == "USER.md" and content is not None:
                    USER_MD.write_text(content, encoding="utf-8")
                if "soul_md" in body and body["soul_md"] is not None:
                    SOUL_MD.write_text(body["soul_md"], encoding="utf-8")
                if "memory_md" in body and body["memory_md"] is not None:
                    MEMORY_MD.write_text(body["memory_md"], encoding="utf-8")
                if "user_md" in body and body["user_md"] is not None:
                    USER_MD.write_text(body["user_md"], encoding="utf-8")
                return self._send(200, {"ok": True, "file": fname})

        if self.path == "/processes":
            action = body.get("action", "list")
            if action == "list":
                ps = run_cmd("ps aux --sort=-%mem | head -n 20", timeout=5)
                return self._send(200, {
                    "ok": True,
                    "ps": ps["stdout"],
                    "health": get_system_health(),
                })
            if action == "restart_service":
                svc = body.get("service", "hermes-dashboard.service")
                if svc in ("hermes-dashboard.service", "hermes-sync.service"):
                    r = run_cmd(f"systemctl restart {svc}", timeout=15)
                    return self._send(200, r)
                return self._send(400, {"ok": False, "error": "Unsupported service"})

        if self.path == "/hermes_cli":
            args = body.get("args", "--version")
            return self._send(200, run_cmd(f"{HERMES_BIN} {args}", workdir="/data/hermes/.hermes/hermes-agent", timeout=60))

        if self.path == "/custom_tools":
            tools_dir = HERMES_ROOT / "tools"
            tools_dir.mkdir(parents=True, exist_ok=True)
            manifest_path = HERMES_HOME / "custom_tools.json"
            existing = {}
            if manifest_path.exists():
                try:
                    existing = json.loads(manifest_path.read_text(encoding="utf-8"))
                except Exception:
                    existing = {}
            action = (body.get("action") or "list").lower()
            if action == "register":
                tname = body.get("name", "custom_tool")
                code = body.get("code", "")
                script_path = body.get("script_path", "")
                if code and not script_path:
                    sfile = tools_dir / f"{tname}.py"
                    sfile.write_text(code, encoding="utf-8")
                    sfile.chmod(0o755)
                    script_path = str(sfile)
                elif code and script_path:
                    sfile = Path(script_path)
                    sfile.parent.mkdir(parents=True, exist_ok=True)
                    sfile.write_text(code, encoding="utf-8")
                    sfile.chmod(0o755)
                tool_entry = {
                    "name": tname,
                    "description": body.get("description", ""),
                    "parameters": body.get("parameters", {}),
                    "handler_type": body.get("handler_type", "python_script"),
                    "script_path": script_path,
                    "command": body.get("command", ""),
                    "api_key": body.get("api_key", ""),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
                existing[tname] = tool_entry
                manifest_path.write_text(json.dumps(existing, indent=2), encoding="utf-8")
                return self._send(200, {"ok": True, "tool": tool_entry, "custom_tools": existing})
            if action == "delete":
                tname = body.get("name", "")
                existing.pop(tname, None)
                manifest_path.write_text(json.dumps(existing, indent=2), encoding="utf-8")
                return self._send(200, {"ok": True, "deleted": tname, "custom_tools": existing})
            return self._send(200, {"ok": True, "custom_tools": existing})

        if self.path == "/run_agent_job":
            job_payload = body.get("payload") or body

            def _orchestrate_job():
                basic = base64.b64encode(f"{AUTH_USER}:{AUTH_PASS}".encode()).decode()
                hdrs = {
                    "Authorization": f"Basic {basic}",
                    "X-Hermes-Bridge-Secret": BRIDGE_SECRET,
                    "User-Agent": "HermesVMBridge/2.0",
                    "Content-Type": "application/json",
                }
                for attempt in range(3):
                    try:
                        req = urllib.request.Request(
                            f"{WORKER_URL}/api/internal/execute-job",
                            data=json.dumps(job_payload).encode("utf-8"),
                            headers=hdrs,
                            method="POST",
                        )
                        with urllib.request.urlopen(req, timeout=240) as resp:
                            res_data = json.loads(resp.read().decode("utf-8", errors="replace"))
                            if res_data.get("ok") or res_data.get("status") in ("done", "error"):
                                break
                    except Exception as e:
                        print(f"[hermes-bridge] Background job execution attempt {attempt+1} error: {e}", flush=True)
                        time.sleep(2)

            threading.Thread(target=_orchestrate_job, daemon=True).start()
            return self._send(200, {"ok": True, "dispatched": True, "job_id": job_payload.get("turnId")})

        self._send(404, {"error": f"Unknown route {self.path}"})


def push_heartbeat():
    basic = base64.b64encode(f"{AUTH_USER}:{AUTH_PASS}".encode()).decode()
    headers = {
        "Authorization": f"Basic {basic}",
        "User-Agent": "HermesVMBridge/1.0",
        "Content-Type": "application/json",
    }
    while True:
        try:
            if STATE["tunnel_url"]:
                health = get_system_health()
                s_txt = SOUL_MD.read_text(encoding="utf-8", errors="replace") if SOUL_MD.exists() else ""
                m_txt = MEMORY_MD.read_text(encoding="utf-8", errors="replace") if MEMORY_MD.exists() else ""
                u_txt = USER_MD.read_text(encoding="utf-8", errors="replace") if USER_MD.exists() else ""
                ct_path = HERMES_HOME / "custom_tools.json"
                mcp_path = HERMES_HOME / "mcp.json"
                custom_tools_data = {}
                mcp_servers_data = {}
                if ct_path.exists():
                    try:
                        custom_tools_data = json.loads(ct_path.read_text(encoding="utf-8"))
                    except Exception:
                        pass
                if mcp_path.exists():
                    try:
                        mcp_raw = json.loads(mcp_path.read_text(encoding="utf-8"))
                        mcp_servers_data = mcp_raw.get("mcpServers", mcp_raw) if isinstance(mcp_raw, dict) else {}
                    except Exception:
                        pass
                payload = {
                    "tunnel_url": STATE["tunnel_url"],
                    "bridge_secret": BRIDGE_SECRET,
                    "hostname": health["hostname"],
                    "data_disk": health["data_disk"],
                    "services": health["services"],
                    "health": health,
                    "skills": list_all_skills(),
                    "custom_tools": custom_tools_data,
                    "mcp_servers": mcp_servers_data,
                    "soul_md": s_txt,
                    "memory_md": m_txt,
                    "user_md": u_txt,
                    "memory_files": {"SOUL.md": s_txt, "MEMORY.md": m_txt, "USER.md": u_txt},
                    "timestamp": health["timestamp"]
                }
                req = urllib.request.Request(
                    f"{WORKER_URL}/api/vm/heartbeat",
                    data=json.dumps(payload).encode("utf-8"),
                    headers=headers,
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=15) as resp:
                    if resp.status == 200:
                        STATE["last_heartbeat"] = datetime.now(timezone.utc).isoformat()
                        (HERMES_ROOT / "storage" / "bridge_state.json").write_text(
                            json.dumps({
                                "tunnel_url": STATE["tunnel_url"],
                                "last_heartbeat": STATE["last_heartbeat"],
                                "skills_count": len(payload["skills"]),
                                "services": health["services"],
                                "data_disk": health["data_disk"]
                            }, indent=2),
                            encoding="utf-8"
                        )
        except Exception as e:
            print(f"[hermes-bridge] Heartbeat error: {e}", flush=True)
        time.sleep(25)


def supervise_cloudflared():
    while True:
        try:
            print("[hermes-bridge] Starting cloudflared quick tunnel to 127.0.0.1:9120...", flush=True)
            proc = subprocess.Popen(
                ["/data/bin/cloudflared", "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{BRIDGE_PORT}"],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            for line in proc.stdout:
                m = re.search(r"(https://[a-zA-Z0-9-]+\.trycloudflare\.com)", line)
                if m:
                    url = m.group(1)
                    if STATE["tunnel_url"] != url:
                        STATE["tunnel_url"] = url
                        print(f"[hermes-bridge] Tunnel established: {url}", flush=True)
            proc.wait()
        except Exception as e:
            print(f"[hermes-bridge] cloudflared error: {e}", flush=True)
        time.sleep(5)


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    t_cf = threading.Thread(target=supervise_cloudflared, daemon=True)
    t_cf.start()
    t_hb = threading.Thread(target=push_heartbeat, daemon=True)
    t_hb.start()
    print(f"[hermes-bridge] Listening on 127.0.0.1:{BRIDGE_PORT}", flush=True)
    server = ThreadedHTTPServer(("127.0.0.1", BRIDGE_PORT), BridgeHandler)
    server.serve_forever()
