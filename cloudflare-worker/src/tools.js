// ============================================================================
// Hermes Agent — Full Toolset & Function-Calling Engine (src/tools.js)
// Implements all Nous Research Hermes Agent toolsets & tools end-to-end:
// - Spot VM Bridge execution (/data/hermes via Cloudflared tunnel) + R2 Edge
// - terminal, process_manage, execute_code
// - read_file, write_file, patch, search_files
// - web_search, web_extract
// - skills_list, skill_view, skill_manage
// - memory (MEMORY.md, USER.md, SOUL.md, facts)
// - session_search, todo_list, kanban_manage, cronjob_manage
// - delegate_task (subagent orchestration), hermes_cli
// ============================================================================

export const TOOLSET_GROUPS = {
  "hermes-cli": {
    name: "Full Hermes CLI (All 19 Tools)",
    description: "All default Hermes Agent tools: terminal, files, web, skills, memory, kanban, cron, subagents, code execution",
    tools: [
      "terminal", "process_manage", "execute_code",
      "read_file", "write_file", "patch", "search_files",
      "web_search", "web_extract",
      "skills_list", "skill_view", "skill_manage",
      "memory", "session_search", "todo_list",
      "kanban_manage", "cronjob_manage", "delegate_task", "hermes_cli"
    ]
  },
  "coding": {
    name: "Coding Posture",
    description: "Files, terminal, code execution, search, web docs, skills, todo, subagent delegation",
    tools: [
      "terminal", "process_manage", "execute_code",
      "read_file", "write_file", "patch", "search_files",
      "web_search", "web_extract",
      "skills_list", "skill_view", "skill_manage",
      "todo_list", "delegate_task"
    ]
  },
  "web": {
    name: "Web Research & Extraction",
    description: "Web search, webpage markdown extraction, memory, and session recall",
    tools: ["web_search", "web_extract", "memory", "session_search", "todo_list"]
  },
  "debugging": {
    name: "Debugging & Diagnostics",
    description: "Terminal, process management, file inspection, Hermes CLI doctor",
    tools: ["terminal", "process_manage", "read_file", "search_files", "hermes_cli", "web_search"]
  },
  "safe": {
    name: "Safe (No Terminal/File Write)",
    description: "Read-only skills, web search, memory, todos, kanban",
    tools: ["web_search", "web_extract", "read_file", "skills_list", "skill_view", "memory", "session_search", "todo_list", "kanban_manage"]
  },
  "off": {
    name: "Direct Chat Only (No Tools)",
    description: "Pure LLM conversation without tool declarations",
    tools: []
  }
};

export const HERMES_TOOL_DECLARATIONS = [
  {
    name: "terminal",
    description: "Execute a bash command on the Spot VM persistent disk (/data/hermes). Use for running shell commands, git, system checks, package management, or CLI tools.",
    parameters: {
      type: "OBJECT",
      properties: {
        command: { type: "STRING", description: "The bash command line to execute" },
        workdir: { type: "STRING", description: "Working directory (default: /data/hermes)" },
        timeout: { type: "INTEGER", description: "Timeout in seconds (default: 45)" }
      },
      required: ["command"]
    }
  },
  {
    name: "process_manage",
    description: "Inspect running processes and systemd services on the Spot VM (/data/hermes), or restart a Hermes service.",
    parameters: {
      type: "OBJECT",
      properties: {
        action: { type: "STRING", description: "'list' to view top processes and systemd service statuses, or 'restart_service'" },
        service: { type: "STRING", description: "Service name if action is restart_service (hermes-dashboard.service or hermes-sync.service)" }
      },
      required: ["action"]
    }
  },
  {
    name: "execute_code",
    description: "Execute a Python, JavaScript (Node.js), or Bash script on the Spot VM (/data/hermes) and return stdout/stderr.",
    parameters: {
      type: "OBJECT",
      properties: {
        code: { type: "STRING", description: "Full source code to execute" },
        language: { type: "STRING", description: "'python', 'javascript', or 'bash' (default: 'python')" }
      },
      required: ["code"]
    }
  },
  {
    name: "read_file",
    description: "Read the contents of a file on the persistent disk (/data/hermes or any path on the VM) with optional line range.",
    parameters: {
      type: "OBJECT",
      properties: {
        path: { type: "STRING", description: "Absolute file path (e.g. /data/hermes/boot.sh)" },
        start_line: { type: "INTEGER", description: "Optional 1-indexed start line" },
        end_line: { type: "INTEGER", description: "Optional 1-indexed end line" }
      },
      required: ["path"]
    }
  },
  {
    name: "write_file",
    description: "Create or overwrite (or append to) a file on the persistent disk (/data/hermes).",
    parameters: {
      type: "OBJECT",
      properties: {
        path: { type: "STRING", description: "Absolute path of the file to write" },
        content: { type: "STRING", description: "Content to write into the file" },
        append: { type: "BOOLEAN", description: "If true, append to the file instead of overwriting" }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "patch",
    description: "Patch an existing file on /data/hermes by replacing a target string with a replacement string.",
    parameters: {
      type: "OBJECT",
      properties: {
        path: { type: "STRING", description: "Absolute path of the file to patch" },
        target: { type: "STRING", description: "Exact text block to find" },
        replacement: { type: "STRING", description: "Replacement text block" }
      },
      required: ["path", "target", "replacement"]
    }
  },
  {
    name: "search_files",
    description: "Search file contents (grep) or list directory files on /data/hermes.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "Text/regex pattern to search for (or leave empty to list directory)" },
        path: { type: "STRING", description: "Directory path to search in (default: /data/hermes)" }
      },
      required: ["path"]
    }
  },
  {
    name: "web_search",
    description: "Search the live web for up-to-date information, documentation, news, or technical answers.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "Search query string" },
        num_results: { type: "INTEGER", description: "Number of results to return (default: 6)" }
      },
      required: ["query"]
    }
  },
  {
    name: "web_extract",
    description: "Fetch a URL from the web and extract its clean readable text/markdown content.",
    parameters: {
      type: "OBJECT",
      properties: {
        url: { type: "STRING", description: "Full https:// URL to fetch and extract" }
      },
      required: ["url"]
    }
  },
  {
    name: "skills_list",
    description: "List all installed Hermes Agent skills (58+ bundled skills + custom learned skills) with categories and descriptions.",
    parameters: {
      type: "OBJECT",
      properties: {
        category: { type: "STRING", description: "Optional category filter (e.g. software-development, productivity, research, autonomous-ai-agents, creative, devops, custom)" }
      }
    }
  },
  {
    name: "skill_view",
    description: "Load the full SKILL.md instructions and metadata for a specific Hermes skill by name or ID.",
    parameters: {
      type: "OBJECT",
      properties: {
        name: { type: "STRING", description: "Skill name or ID (e.g. 'hermes-agent', 'pdf', 'architecture-diagram')" }
      },
      required: ["name"]
    }
  },
  {
    name: "skill_manage",
    description: "Create, update, or delete a reusable Hermes Agent skill (SKILL.md) in the closed learning loop on /data/hermes/.hermes/skills/ and R2.",
    parameters: {
      type: "OBJECT",
      properties: {
        action: { type: "STRING", description: "'create', 'update', or 'delete'" },
        name: { type: "STRING", description: "Skill slug name (e.g. 'vertex-deploy-guide')" },
        category: { type: "STRING", description: "Skill category (default: 'custom')" },
        description: { type: "STRING", description: "Concise one-line description of when to use the skill" },
        content: { type: "STRING", description: "Full markdown instructions for SKILL.md" }
      },
      required: ["action", "name"]
    }
  },
  {
    name: "memory",
    description: "Read or update Hermes Agent persistent memory across sessions: facts list, MEMORY.md (long-term agent notes), USER.md (user profile model), or SOUL.md (agent persona).",
    parameters: {
      type: "OBJECT",
      properties: {
        action: { type: "STRING", description: "'list', 'add', 'delete', 'read_files', or 'update_file'" },
        target: { type: "STRING", description: "'fact' (default), 'memory_md', 'user_md', or 'soul_md'" },
        content: { type: "STRING", description: "Memory fact or markdown content to save" },
        category: { type: "STRING", description: "Category tag for fact (e.g. 'preference', 'project', 'system')" }
      },
      required: ["action"]
    }
  },
  {
    name: "session_search",
    description: "Search across all past Hermes conversation sessions and messages for cross-session recall.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "Keywords or phrase to search across all saved sessions" }
      },
      required: ["query"]
    }
  },
  {
    name: "todo_list",
    description: "Manage the structured task Todo list for planning and tracking multi-step work.",
    parameters: {
      type: "OBJECT",
      properties: {
        action: { type: "STRING", description: "'list', 'add', 'complete', 'delete', or 'clear'" },
        title: { type: "STRING", description: "Todo item description (when adding)" },
        id: { type: "STRING", description: "Todo item ID (when completing or deleting)" },
        priority: { type: "STRING", description: "'high', 'medium', or 'low'" }
      },
      required: ["action"]
    }
  },
  {
    name: "kanban_manage",
    description: "Manage the Hermes Kanban multi-agent collaboration board (columns: todo, in_progress, review, blocked, done).",
    parameters: {
      type: "OBJECT",
      properties: {
        action: { type: "STRING", description: "'list', 'create', 'move', 'complete', 'block', 'request_review', 'comment', or 'delete'" },
        id: { type: "STRING", description: "Kanban task ID (for move/complete/block/comment/delete)" },
        title: { type: "STRING", description: "Task title (for create)" },
        description: { type: "STRING", description: "Task description or handoff notes" },
        column: { type: "STRING", description: "'todo', 'in_progress', 'review', 'blocked', or 'done'" },
        priority: { type: "STRING", description: "'low', 'medium', 'high', or 'critical'" },
        assignee: { type: "STRING", description: "Assigned agent/profile (e.g. 'hermes-coder', 'hermes-researcher')" },
        comment: { type: "STRING", description: "Comment text to append to the task thread" }
      },
      required: ["action"]
    }
  },
  {
    name: "cronjob_manage",
    description: "Create, list, pause, resume, trigger, or delete scheduled Hermes Agent cron automations.",
    parameters: {
      type: "OBJECT",
      properties: {
        action: { type: "STRING", description: "'list', 'create', 'toggle', 'delete', or 'run'" },
        id: { type: "STRING", description: "Cronjob ID (for toggle/delete/run)" },
        name: { type: "STRING", description: "Human-readable job name" },
        schedule: { type: "STRING", description: "Cron expression or interval (e.g. '0 9 * * *', 'every 2h', '30m')" },
        prompt: { type: "STRING", description: "Agent prompt or task to execute on schedule" },
        model: { type: "STRING", description: "Optional Gemini model override (default: gemini-3.8-flash)" }
      },
      required: ["action"]
    }
  },
  {
    name: "delegate_task",
    description: "Spawn an isolated Hermes subagent (or parallel batch of subagents) with its own context and Gemini model to solve a complex subtask.",
    parameters: {
      type: "OBJECT",
      properties: {
        goal: { type: "STRING", description: "Clear task objective for the subagent" },
        context: { type: "STRING", description: "Relevant background context or data for the subagent" },
        model: { type: "STRING", description: "Optional Gemini model ID for the subagent (default: gemini-3.8-flash-thinking)" },
        role: { type: "STRING", description: "Subagent specialist role (e.g. 'Code Researcher', 'System Auditor', 'Security Reviewer')" }
      },
      required: ["goal"]
    }
  },
  {
    name: "hermes_cli",
    description: "Run a native `hermes` CLI command on the Spot VM (e.g., '--version', 'doctor', 'status --full', 'config show', 'skills list', 'sessions list').",
    parameters: {
      type: "OBJECT",
      properties: {
        args: { type: "STRING", description: "CLI arguments to pass to `hermes` (e.g. 'doctor' or 'status')" }
      },
      required: ["args"]
    }
  }
];

export function getDeclarationsForToolset(toolsetName) {
  const group = TOOLSET_GROUPS[toolsetName] || TOOLSET_GROUPS["hermes-cli"];
  if (!group || !group.tools || group.tools.length === 0) return [];
  const allowed = new Set(group.tools);
  return HERMES_TOOL_DECLARATIONS.filter(d => allowed.has(d.name));
}

export async function callVmBridge(idx, path, method = "POST", body = null, timeoutMs = 35000) {
  const bridge = idx.vm_bridge;
  if (!bridge || !bridge.tunnel_url) {
    return { ok: false, error: "Spot VM tunnel not yet registered in index." };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const opts = {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Hermes-Bridge-Secret": bridge.bridge_secret || "CHANGE_ME_BRIDGE_SECRET",
        "User-Agent": "HermesCloudflareWorker/2.0"
      },
      signal: ctrl.signal
    };
    if (body && method !== "GET") {
      opts.body = JSON.stringify(body);
    }
    const resp = await fetch(`${bridge.tunnel_url}${path}`, opts);
    clearTimeout(timer);
    if (!resp.ok) {
      const txt = await resp.text();
      return { ok: false, error: `Bridge HTTP ${resp.status}: ${txt.slice(0, 300)}` };
    }
    return await resp.json();
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, error: `Bridge unreachable: ${err.message}` };
  }
}

export async function performWebSearch(query, numResults = 6) {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36"
      }
    });
    const html = await resp.text();
    const results = [];
    const blockRegex = /<a class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = blockRegex.exec(html)) !== null && results.length < numResults) {
      let link = m[1];
      const uddg = link.match(/[?&]uddg=([^&]+)/);
      if (uddg) link = decodeURIComponent(uddg[1]);
      const strip = s => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
      results.push({
        title: strip(m[2]),
        url: link,
        snippet: strip(m[3])
      });
    }
    if (results.length > 0) {
      return { ok: true, query, results };
    }
    // Fallback to Wikipedia OpenSearch if DuckDuckGo HTML throttles
    const wikiUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=${numResults}&format=json`;
    const wResp = await fetch(wikiUrl, { headers: { "User-Agent": "HermesAgent/2.0" } });
    const wData = await wResp.json();
    const wResults = (wData[1] || []).map((title, i) => ({
      title,
      description: (wData[2] || [])[i] || "",
      url: (wData[3] || [])[i] || ""
    }));
    return { ok: true, query, results: wResults };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function performWebExtract(targetUrl) {
  try {
    const resp = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; HermesAgent/2.0; +https://hermes.example.com)"
      }
    });
    const contentType = resp.headers.get("content-type") || "";
    const raw = await resp.text();
    if (contentType.includes("application/json")) {
      return { ok: true, url: targetUrl, content: raw.slice(0, 25000) };
    }
    const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : targetUrl;
    const cleaned = raw
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<\/(p|div|h1|h2|h3|h4|li|tr|br)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n+/g, "\n\n")
      .trim();
    return {
      ok: true,
      url: targetUrl,
      title,
      content: cleaned.slice(0, 25000)
    };
  } catch (e) {
    return { ok: false, url: targetUrl, error: e.message };
  }
}

export async function executeHermesTool(name, args, ctx) {
  const { env, idx, saveIndex, loadSession, callVertexSubagent } = ctx;
  const now = new Date().toISOString();

  switch (name) {
    case "terminal": {
      const vmRes = await callVmBridge(idx, "/terminal", "POST", {
        command: args.command,
        workdir: args.workdir || "/data/hermes",
        timeout: args.timeout || 45
      });
      if (vmRes.ok || vmRes.exit_code !== undefined) return vmRes;
      return {
        ok: false,
        error: vmRes.error || "Spot VM bridge unavailable for live bash execution."
      };
    }

    case "process_manage": {
      return await callVmBridge(idx, "/processes", "POST", {
        action: args.action || "list",
        service: args.service
      });
    }

    case "execute_code": {
      return await callVmBridge(idx, "/execute_code", "POST", {
        code: args.code,
        language: args.language || "python",
        timeout: args.timeout || 45
      });
    }

    case "read_file": {
      const vmRes = await callVmBridge(idx, "/files", "POST", {
        action: "read",
        path: args.path,
        start_line: args.start_line,
        end_line: args.end_line
      });
      if (vmRes.ok) return vmRes;
      const r2File = (idx.virtual_files || {})[args.path];
      if (r2File !== undefined) {
        return { ok: true, path: args.path, content: r2File, source: "r2_mirror" };
      }
      return vmRes;
    }

    case "write_file": {
      if (!idx.virtual_files) idx.virtual_files = {};
      idx.virtual_files[args.path] = args.append
        ? ((idx.virtual_files[args.path] || "") + args.content)
        : args.content;
      await saveIndex(env, idx);
      const vmRes = await callVmBridge(idx, "/files", "POST", {
        action: "write",
        path: args.path,
        content: args.content,
        append: !!args.append
      });
      return vmRes.ok ? vmRes : { ok: true, path: args.path, bytes: (args.content || "").length, saved_to: "r2_and_queued_for_data" };
    }

    case "patch": {
      return await callVmBridge(idx, "/files", "POST", {
        action: "patch",
        path: args.path,
        target: args.target,
        replacement: args.replacement
      });
    }

    case "search_files": {
      const action = args.query ? "search" : "list";
      return await callVmBridge(idx, "/files", "POST", {
        action,
        path: args.path || "/data/hermes",
        query: args.query || ""
      });
    }

    case "web_search": {
      return await performWebSearch(args.query, args.num_results || 6);
    }

    case "web_extract": {
      return await performWebExtract(args.url);
    }

    case "skills_list": {
      const vmRes = await callVmBridge(idx, "/skills", "POST", { action: "list" }, 10000);
      let allSkills = vmRes.ok && Array.isArray(vmRes.skills) ? vmRes.skills : (idx.skills_catalog || []);
      const customSkills = Object.values(idx.custom_skills || {});
      const byName = new Map();
      for (const s of allSkills) byName.set(s.name, s);
      for (const cs of customSkills) byName.set(cs.name, cs);
      let list = Array.from(byName.values());
      if (args.category) {
        const cat = args.category.toLowerCase();
        list = list.filter(s => (s.category || "").toLowerCase().includes(cat));
      }
      return {
        ok: true,
        total: list.length,
        skills: list.map(s => ({
          id: s.id || `${s.category}/${s.name}`,
          name: s.name,
          category: s.category,
          description: s.description
        }))
      };
    }

    case "skill_view": {
      const q = (args.name || "").trim().toLowerCase().replace(/^\//, "");
      if (idx.custom_skills && idx.custom_skills[q]) {
        return { ok: true, skill: idx.custom_skills[q], content: idx.custom_skills[q].content };
      }
      const vmRes = await callVmBridge(idx, "/skills", "POST", { action: "view", name: q }, 12000);
      if (vmRes.ok) return vmRes;
      return { ok: false, error: vmRes.error || `Skill '${args.name}' not found.` };
    }

    case "skill_manage": {
      const act = (args.action || "create").toLowerCase();
      const slug = (args.name || "custom-skill").toLowerCase().replace(/[^a-z0-9_-]/g, "-");
      if (!idx.custom_skills) idx.custom_skills = {};
      if (act === "delete") {
        delete idx.custom_skills[slug];
        await saveIndex(env, idx);
        await callVmBridge(idx, "/skills", "POST", { action: "delete", name: slug });
        return { ok: true, deleted: slug };
      }
      const cat = args.category || "custom";
      const desc = args.description || `Custom Hermes skill: ${slug}`;
      const content = args.content || `# ${slug}\n\n${desc}`;
      const skillObj = {
        id: `${cat}/${slug}`,
        name: slug,
        category: cat,
        description: desc,
        content,
        updated_at: now
      };
      idx.custom_skills[slug] = skillObj;
      await saveIndex(env, idx);
      const vmRes = await callVmBridge(idx, "/skills", "POST", {
        action: "save",
        name: slug,
        category: cat,
        description: desc,
        content
      });
      return { ok: true, skill: skillObj, vm_synced: !!vmRes.ok };
    }

    case "memory": {
      const act = (args.action || "list").toLowerCase();
      const target = (args.target || "fact").toLowerCase();
      if (!idx.memories) idx.memories = [];
      if (!idx.persona) {
        idx.persona = {
          soul_md: "You are Hermes Agent, built by Nous Research. Be direct, accurate, and proactive with your tools.",
          memory_md: "# Hermes Agent Persistent Memory (MEMORY.md)\n",
          user_md: "# User Profile (USER.md)\n- Owner: admin@example.com\n"
        };
      }
      if (act === "read_files") {
        return { ok: true, persona: idx.persona, facts: idx.memories };
      }
      if (act === "update_file" || target === "memory_md" || target === "user_md" || target === "soul_md") {
        if (target === "soul_md" || target === "soul") idx.persona.soul_md = args.content || "";
        else if (target === "user_md" || target === "user") idx.persona.user_md = args.content || "";
        else idx.persona.memory_md = args.content || "";
        await saveIndex(env, idx);
        await callVmBridge(idx, "/memory_files", "POST", {
          action: "set",
          soul_md: idx.persona.soul_md,
          memory_md: idx.persona.memory_md,
          user_md: idx.persona.user_md
        });
        return { ok: true, target, updated_at: now };
      }
      if (act === "add") {
        const item = {
          id: Date.now(),
          content: args.content || "",
          category: args.category || "general",
          created_at: now,
          updated_at: now
        };
        idx.memories.unshift(item);
        await saveIndex(env, idx);
        return { ok: true, memory: item };
      }
      if (act === "delete") {
        idx.memories = idx.memories.filter(m => String(m.id) !== String(args.id));
        await saveIndex(env, idx);
        return { ok: true };
      }
      return { ok: true, memories: idx.memories, persona: idx.persona };
    }

    case "session_search": {
      const q = (args.query || "").toLowerCase();
      const matches = [];
      for (const s of (idx.sessions || []).slice(0, 30)) {
        const sData = await loadSession(env, s.id);
        const hitMsgs = (sData.messages || []).filter(m => (m.content || "").toLowerCase().includes(q));
        if ((s.title || "").toLowerCase().includes(q) || hitMsgs.length > 0) {
          matches.push({
            session_id: s.id,
            title: s.title,
            model: s.model,
            updated_at: s.updated_at,
            matching_excerpts: hitMsgs.slice(0, 3).map(m => ({
              role: m.role,
              excerpt: (m.content || "").slice(0, 280)
            }))
          });
        }
      }
      return { ok: true, query: args.query, count: matches.length, matches };
    }

    case "todo_list": {
      if (!idx.todos) idx.todos = [];
      const act = (args.action || "list").toLowerCase();
      if (act === "add") {
        const item = {
          id: `todo_${Date.now()}`,
          title: args.title || "Untitled task",
          status: "pending",
          priority: args.priority || "medium",
          created_at: now
        };
        idx.todos.push(item);
        await saveIndex(env, idx);
        return { ok: true, todo: item, todos: idx.todos };
      }
      if (act === "complete") {
        const t = idx.todos.find(x => x.id === args.id || x.title === args.title);
        if (t) t.status = t.status === "completed" ? "pending" : "completed";
        await saveIndex(env, idx);
        return { ok: true, todos: idx.todos };
      }
      if (act === "delete") {
        idx.todos = idx.todos.filter(x => x.id !== args.id);
        await saveIndex(env, idx);
        return { ok: true, todos: idx.todos };
      }
      if (act === "clear") {
        idx.todos = [];
        await saveIndex(env, idx);
        return { ok: true, todos: [] };
      }
      return { ok: true, todos: idx.todos };
    }

    case "kanban_manage": {
      if (!idx.kanban_tasks) idx.kanban_tasks = idx.kanban || [];
      idx.kanban = idx.kanban_tasks;
      const act = (args.action || "list").toLowerCase();
      if (act === "create") {
        const card = {
          id: `kb_${Date.now()}`,
          title: args.title || "New Kanban Task",
          description: args.description || "",
          column: args.column || "todo",
          priority: args.priority || "medium",
          assignee: args.assignee || "hermes-agent",
          comments: [],
          created_at: now,
          updated_at: now
        };
        idx.kanban_tasks.unshift(card);
        await saveIndex(env, idx);
        return { ok: true, card, task: card, tasks: idx.kanban_tasks, kanban: idx.kanban_tasks };
      }
      const card = idx.kanban_tasks.find(c => c.id === args.id || (args.title && c.title.toLowerCase() === args.title.toLowerCase()));
      if (act === "move" && card) {
        card.column = args.column || "in_progress";
        card.updated_at = now;
        await saveIndex(env, idx);
        return { ok: true, card, task: card, tasks: idx.kanban_tasks, kanban: idx.kanban_tasks };
      }
      if (act === "complete" && card) {
        card.column = "done";
        if (args.description) card.comments.push({ author: "hermes", text: `Completed: ${args.description}`, at: now });
        card.updated_at = now;
        await saveIndex(env, idx);
        return { ok: true, card, task: card, tasks: idx.kanban_tasks, kanban: idx.kanban_tasks };
      }
      if (act === "block" && card) {
        card.column = "blocked";
        if (args.description) card.comments.push({ author: "hermes", text: `Blocked: ${args.description}`, at: now });
        card.updated_at = now;
        await saveIndex(env, idx);
        return { ok: true, card, task: card, tasks: idx.kanban_tasks, kanban: idx.kanban_tasks };
      }
      if (act === "request_review" && card) {
        card.column = "review";
        if (args.description) card.comments.push({ author: "hermes", text: `Review requested: ${args.description}`, at: now });
        card.updated_at = now;
        await saveIndex(env, idx);
        return { ok: true, card, task: card, tasks: idx.kanban_tasks, kanban: idx.kanban_tasks };
      }
      if (act === "comment" && card) {
        card.comments.push({ author: args.assignee || "hermes", text: args.comment || args.description || "", at: now });
        card.updated_at = now;
        await saveIndex(env, idx);
        return { ok: true, card, task: card, tasks: idx.kanban_tasks, kanban: idx.kanban_tasks };
      }
      if (act === "delete") {
        idx.kanban_tasks = idx.kanban_tasks.filter(c => c.id !== args.id);
        idx.kanban = idx.kanban_tasks;
        await saveIndex(env, idx);
        return { ok: true, tasks: idx.kanban_tasks, kanban: idx.kanban_tasks };
      }
      return { ok: true, tasks: idx.kanban_tasks, kanban: idx.kanban_tasks };
    }

    case "cronjob_manage": {
      if (!idx.cronjobs) idx.cronjobs = [];
      const act = (args.action || "list").toLowerCase();
      if (act === "create") {
        const job = {
          id: `cron_${Date.now()}`,
          name: args.name || "Scheduled Hermes Automation",
          schedule: args.schedule || "0 9 * * *",
          prompt: args.prompt || "Run system health check and summarize.",
          model: args.model || "gemini-3.8-flash",
          enabled: true,
          last_run: null,
          last_result: null,
          created_at: now
        };
        idx.cronjobs.unshift(job);
        await saveIndex(env, idx);
        return { ok: true, job, cronjobs: idx.cronjobs };
      }
      const job = idx.cronjobs.find(j => j.id === args.id || (args.name && j.name.toLowerCase() === args.name.toLowerCase()));
      if (act === "toggle" && job) {
        job.enabled = !job.enabled;
        await saveIndex(env, idx);
        return { ok: true, job };
      }
      if (act === "delete") {
        idx.cronjobs = idx.cronjobs.filter(j => j.id !== args.id);
        await saveIndex(env, idx);
        return { ok: true, cronjobs: idx.cronjobs };
      }
      if (act === "run" && job && callVertexSubagent) {
        const subRes = await callVertexSubagent({
          goal: job.prompt,
          context: `Scheduled Cron Execution for '${job.name}' (${job.schedule})`,
          model: job.model || "gemini-3.8-flash",
          role: "Cron Automation Runner"
        });
        job.last_run = now;
        job.last_result = subRes.reply || subRes.error || "Completed";
        await saveIndex(env, idx);
        return { ok: true, job, output: job.last_result };
      }
      return { ok: true, cronjobs: idx.cronjobs };
    }

    case "delegate_task": {
      if (!callVertexSubagent) {
        return { ok: false, error: "Subagent runner not initialized" };
      }
      return await callVertexSubagent({
        goal: args.goal,
        context: args.context || "",
        model: args.model || "gemini-3.8-flash-thinking",
        role: args.role || "Hermes Specialist Subagent"
      });
    }

    case "hermes_cli": {
      return await callVmBridge(idx, "/hermes_cli", "POST", {
        args: args.args || "status"
      });
    }

    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}
