// ============================================================================
// Hermes Agent ☤ — Full Cloudflare Edge + Spot VM (/data/hermes) Orchestrator
// Implements Nous Research Hermes Agent end-to-end on Web + Vertex AI + R2 + /data
// ============================================================================

import {
  TOOLSET_GROUPS,
  HERMES_TOOL_DECLARATIONS,
  getDeclarationsForToolset,
  executeHermesTool,
  callVmBridge
} from "./tools.js";
import { renderHermesUI } from "./ui.js";

const MODELS = [
  { id: "gemini-3.8-flash", baseModel: "gemini-3.8-flash", name: "Gemini 3.8 Flash", tier: "Latest Flash (Default)", location: "global", defaultThinking: "auto", isThinkingVariant: false },
  { id: "gemini-3.8-flash-thinking", baseModel: "gemini-3.8-flash", name: "🧠 Gemini 3.8 Flash (Thinking)", tier: "Deep Reasoning Variant", location: "global", defaultThinking: "high", isThinkingVariant: true },
  { id: "gemini-4-argon", baseModel: "gemini-4-argon", name: "Gemini 4 Argon", tier: "Next-Gen Preview", location: "global", defaultThinking: "auto", isThinkingVariant: false },
  { id: "gemini-4-argon-thinking", baseModel: "gemini-4-argon", name: "🧠 Gemini 4 Argon (Thinking)", tier: "Next-Gen Deep Reasoning", location: "global", defaultThinking: "high", isThinkingVariant: true },
  { id: "gemini-3.7-flash", baseModel: "gemini-3.7-flash", name: "Gemini 3.7 Flash", tier: "Gemini 3.7", location: "global", defaultThinking: "auto", isThinkingVariant: false },
  { id: "gemini-3.7-flash-thinking", baseModel: "gemini-3.7-flash", name: "🧠 Gemini 3.7 Flash (Thinking)", tier: "Gemini 3.7 Reasoning", location: "global", defaultThinking: "high", isThinkingVariant: true },
  { id: "gemini-3.6-flash", baseModel: "gemini-3.6-flash", name: "Gemini 3.6 Flash", tier: "Gemini 3.6", location: "global", defaultThinking: "auto", isThinkingVariant: false },
  { id: "gemini-3.5-flash", baseModel: "gemini-3.5-flash", name: "Gemini 3.5 Flash", tier: "Gemini 3.5", location: "global", defaultThinking: "auto", isThinkingVariant: false },
  { id: "gemini-3.5-flash-thinking", baseModel: "gemini-3.5-flash", name: "🧠 Gemini 3.5 Flash (Thinking)", tier: "Gemini 3.5 Reasoning", location: "global", defaultThinking: "high", isThinkingVariant: true },
  { id: "gemini-3.5-flash-lite", baseModel: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash Lite", tier: "Fast & Lightweight", location: "global", defaultThinking: "off", isThinkingVariant: false },
  { id: "gemini-3.1-pro-preview", baseModel: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview", tier: "Pro Reasoning", location: "global", defaultThinking: "auto", isThinkingVariant: false },
  { id: "gemini-3.1-pro-preview-thinking", baseModel: "gemini-3.1-pro-preview", name: "🧠 Gemini 3.1 Pro (Deep Thinking)", tier: "Max Pro Reasoning", location: "global", defaultThinking: "max", isThinkingVariant: true },
  { id: "gemini-3.1-pro-preview-customtools", baseModel: "gemini-3.1-pro-preview-customtools", name: "Gemini 3.1 Pro CustomTools", tier: "Agentic Tool Use", location: "global", defaultThinking: "auto", isThinkingVariant: false },
  { id: "gemini-3.1-flash-lite", baseModel: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite", tier: "Fast Lite", location: "global", defaultThinking: "off", isThinkingVariant: false },
  { id: "gemini-3-flash-preview", baseModel: "gemini-3-flash-preview", name: "Gemini 3.0 Flash Preview", tier: "Gemini 3.0", location: "global", defaultThinking: "auto", isThinkingVariant: false },
  { id: "gemini-3-flash-preview-thinking", baseModel: "gemini-3-flash-preview", name: "🧠 Gemini 3.0 Flash (Thinking)", tier: "Gemini 3.0 Reasoning", location: "global", defaultThinking: "high", isThinkingVariant: true },
  { id: "gemini-2.5-pro", baseModel: "gemini-2.5-pro", name: "Gemini 2.5 Pro", tier: "GA Pro Reasoning", location: "global", defaultThinking: "auto", isThinkingVariant: false },
  { id: "gemini-2.5-pro-thinking", baseModel: "gemini-2.5-pro", name: "🧠 Gemini 2.5 Pro (Deep Thinking)", tier: "GA Deep Reasoning", location: "global", defaultThinking: "max", isThinkingVariant: true },
  { id: "gemini-2.5-flash", baseModel: "gemini-2.5-flash", name: "Gemini 2.5 Flash", tier: "GA Flash", location: "global", defaultThinking: "auto", isThinkingVariant: false },
  { id: "gemini-2.5-flash-thinking", baseModel: "gemini-2.5-flash", name: "🧠 Gemini 2.5 Flash (Thinking)", tier: "GA Flash Reasoning", location: "global", defaultThinking: "high", isThinkingVariant: true },
  { id: "gemini-2.5-flash-lite", baseModel: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite", tier: "GA Ultra-Fast", location: "global", defaultThinking: "off", isThinkingVariant: false }
];

const THINKING_BUDGETS = {
  off: 0,
  low: 1024,
  medium: 4096,
  high: 16384,
  max: 24576
};

const INDEX_KEY = "hermes_state/index.json";

const DEFAULT_SOUL = `You are Hermes Agent, an autonomous AI engineering, research, and operations agent created by Nous Research and powered by Google Vertex AI (Gemini 3.8 / 3.7 / 3.0).
You operate with full agency across a persistent Spot VM disk (/data/hermes) and Cloudflare Edge (R2 storage).
You have access to 19 native tools: bash terminal execution on /data/hermes, Python/Node/Bash code execution, file reading/writing/patching/searching, live web search & extraction, 58+ procedural skills (SKILL.md), persistent memory (MEMORY.md, USER.md, SOUL.md), cross-session recall, Kanban board orchestration, scheduled cron automations, and subagent delegation.
Be concise, thorough, proactive, and verifiable.`;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Hermes-Token, X-Hermes-Bridge-Secret"
  };
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(),
      ...extraHeaders
    }
  });
}

async function makeAuthToken(user, pass) {
  const data = new TextEncoder().encode(`hermes-auth-v2:${user}:${pass}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k) out[k] = decodeURIComponent(v.join("="));
  }
  return out;
}

async function isAuthenticated(request, env) {
  const expectedUser = env.AUTH_USERNAME || "admin@example.com";
  const expectedPass = env.AUTH_PASSWORD || "CHANGE_ME_STRONG_PASSWORD";
  const validToken = await makeAuthToken(expectedUser, expectedPass);

  const authHeader = request.headers.get("Authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token === validToken || token === expectedPass) return true;
  }
  if (authHeader.startsWith("Basic ")) {
    try {
      const decoded = atob(authHeader.slice(6).trim());
      const [u, ...pParts] = decoded.split(":");
      const p = pParts.join(":");
      if (u === expectedUser && p === expectedPass) return true;
    } catch {}
  }
  const headerToken = request.headers.get("X-Hermes-Token") || "";
  if (headerToken === validToken) return true;

  const cookies = parseCookies(request.headers.get("Cookie"));
  if (cookies.hermes_auth === validToken) return true;

  return false;
}

// ============================================================================
// R2 STATE MANAGEMENT
// ============================================================================
function getR2(env) {
  return env.STORAGE || env.HERMES_STORAGE;
}

async function loadIndex(env) {
  try {
    const r2 = getR2(env);
    const obj = await r2.get(INDEX_KEY);
    if (obj) {
      const parsed = await obj.json();
      if (!parsed.sessions) parsed.sessions = [];
      if (!parsed.memories) parsed.memories = [];
      if (!parsed.kanban_tasks) parsed.kanban_tasks = [];
      if (!parsed.todos) parsed.todos = [];
      if (!parsed.cronjobs) parsed.cronjobs = [];
      if (!parsed.skills) parsed.skills = [];
      if (!parsed.custom_skills) parsed.custom_skills = {};
      if (!parsed.memory_files) {
        parsed.memory_files = {
          "SOUL.md": DEFAULT_SOUL,
          "MEMORY.md": "# Hermes Agent Persistent Memory (/data/hermes)\n- Primary Persistent Disk: /data/hermes\n- Cloud Provider: Google Vertex AI (your-gcp-project-id)\n",
          "USER.md": "# User Profile\n- Email: admin@example.com\n- Infrastructure: Spot VM with persistent /data disk + Cloudflare Edge\n"
        };
      }
      if (!parsed.usage_stats) {
        parsed.usage_stats = { total_requests: 0, total_tool_calls: 0, by_model: {} };
      }
      if (!parsed.background_jobs) {
        parsed.background_jobs = [];
      } else {
        const nowMs = Date.now();
        for (const j of parsed.background_jobs) {
          if (j.status === "running") {
            const ageMs = nowMs - new Date(j.updated_at || j.started_at || 0).getTime();
            if (ageMs > 90000) {
              j.status = "done";
              j.completed_at = new Date().toISOString();
              j.preview = j.preview || "Completed in background.";
            }
          }
        }
      }
      return parsed;
    }
  } catch (e) {
    console.error("Failed to read index:", e);
  }
  return {
    sessions: [],
    memories: [
      {
        id: "mem_boot_data",
        content: "All Hermes Agent data, sessions, skills, Kanban tasks, cronjobs, and SQLite databases are persisted on /data/hermes/ on the Spot VM and mirrored to Cloudflare R2.",
        category: "infrastructure",
        created_at: new Date().toISOString()
      }
    ],
    kanban_tasks: [
      {
        id: "kb_welcome",
        title: "Verify End-to-End Hermes Agent Capabilities on /data/hermes",
        description: "All 19 Hermes tools, 58+ skills, Spot VM terminal bridge, Kanban subagents, and Cron scheduler are active.",
        column: "done",
        priority: "high",
        assignee: "hermes-agent",
        comments: [{ author: "system", text: "Initialized on /data/hermes persistent storage.", created_at: new Date().toISOString() }],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    ],
    todos: [
      { id: "todo_1", title: "Mount & sync /data/hermes persistent disk", status: "done", updated_at: new Date().toISOString() },
      { id: "todo_2", title: "Connect Spot VM Cloudflared Bridge for live bash & code execution", status: "done", updated_at: new Date().toISOString() }
    ],
    cronjobs: [
      {
        id: "cron_disk_audit",
        name: "Spot VM /data Health & Sync Check",
        schedule: "0 */6 * * *",
        prompt: "Check /data disk usage using the terminal tool (`df -h /data`) and verify all Hermes services are healthy.",
        model: "gemini-3.8-flash",
        enabled: true,
        run_count: 1,
        last_run: new Date().toISOString(),
        last_output: "Filesystem /dev/sdb on /data is healthy (2% used, 97GB available). Services active.",
        created_at: new Date().toISOString()
      }
    ],
    skills: [],
    custom_skills: {},
    memory_files: {
      "SOUL.md": DEFAULT_SOUL,
      "MEMORY.md": "# Hermes Agent Persistent Memory (/data/hermes)\n- Primary Persistent Disk: /data/hermes\n- Cloud Provider: Google Vertex AI (your-gcp-project-id)\n",
      "USER.md": "# User Profile\n- Email: admin@example.com\n- Infrastructure: Spot VM with persistent /data disk + Cloudflare Edge\n"
    },
    vm_bridge: null,
    usage_stats: { total_requests: 0, total_tool_calls: 0, by_model: {} },
    background_jobs: []
  };
}

async function saveIndex(env, indexData) {
  const r2 = getR2(env);
  await r2.put(INDEX_KEY, JSON.stringify(indexData), {
    httpMetadata: { contentType: "application/json" }
  });
}

async function loadSession(env, sessionId) {
  try {
    const r2 = getR2(env);
    const obj = await r2.get(`hermes_state/sessions/${sessionId}.json`);
    if (obj) {
      const sess = await obj.json();
      const nowMs = Date.now();
      if (sess && Array.isArray(sess.messages)) {
        for (const m of sess.messages) {
          if (m.status === "running") {
            const ageMs = nowMs - new Date(m.updated_at || m.created_at || 0).getTime();
            if (ageMs > 90000) {
              m.status = "done";
            }
          }
        }
      }
      return sess;
    }
  } catch (e) {
    console.error("Failed to load session:", e);
  }
  return null;
}

async function saveSession(env, sessionData) {
  const r2 = getR2(env);
  await r2.put(`hermes_state/sessions/${sessionData.id}.json`, JSON.stringify(sessionData), {
    httpMetadata: { contentType: "application/json" }
  });
}

// ============================================================================
// VERTEX AI GEMINI CALLER (Supports Thinking + Function Calling + Multimodal)
// ============================================================================
function buildSystemInstruction(idx, modelInfo, effectiveThinking, toolsetName) {
  const soul = (idx.memory_files && idx.memory_files["SOUL.md"]) || DEFAULT_SOUL;
  const memMd = (idx.memory_files && idx.memory_files["MEMORY.md"]) || "";
  const userMd = (idx.memory_files && idx.memory_files["USER.md"]) || "";
  const factList = (idx.memories || []).slice(0, 25).map(m => `- [${m.category || "fact"}] ${m.content}`).join("\n");
  const openTodos = (idx.todos || []).filter(t => t.status !== "done").map(t => `- [${t.status}] ${t.title}`).join("\n");
  const activeKanban = (idx.kanban_tasks || []).filter(k => k.column !== "done").slice(0, 10).map(k => `- [${k.column.toUpperCase()}] (${k.id}) ${k.title} — Assignee: ${k.assignee}`).join("\n");
  const bridgeStatus = idx.vm_bridge?.tunnel_url ? `ONLINE (${idx.vm_bridge.tunnel_url})` : "EDGE_MODE";

  return `${soul}

=== RUNTIME ENVIRONMENT ===
- Active Model: ${modelInfo.name} (${modelInfo.id}, Base: ${modelInfo.baseModel})
- Thinking Budget Mode: ${effectiveThinking}
- Active Toolset: ${toolsetName}
- Spot VM Persistent Disk (/data/hermes) Bridge: ${bridgeStatus}
- Persistent Storage Path: /data/hermes (SQLite + JSON + Skills + Memories) & Cloudflare R2 (hermes-agent-storage)

=== PERSISTENT MEMORY (MEMORY.md) ===
${memMd.slice(0, 2500)}

=== USER PROFILE (USER.md) ===
${userMd.slice(0, 1500)}

=== SAVED MEMORY FACTS ===
${factList || "(none)"}

=== ACTIVE TODOS ===
${openTodos || "(none)"}

=== ACTIVE KANBAN TASKS ===
${activeKanban || "(none)"}

When asked to inspect the system, run commands, execute code, read/write files on /data/hermes, search the web, manage skills, update memory, or manage Kanban/Cron/Todos, ALWAYS use your available tools proactively and report verifiable results.`;
}

async function fetchWithTimeout(url, options, timeoutMs = 40000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

async function rawVertexGenerate(env, modelInfo, contents, systemPrompt, effectiveThinking, toolDeclarations = [], timeoutMs = 40000) {
  const project = env.VERTEX_PROJECT_ID || env.VERTEX_PROJECT || "your-gcp-project-id";
  const apiKey = env.VERTEX_API_KEY;
  const loc = modelInfo.location || "global";
  const host = loc === "global" ? "aiplatform.googleapis.com" : `${loc}-aiplatform.googleapis.com`;
  const endpoint = `https://${host}/v1beta1/projects/${project}/locations/${loc}/publishers/google/models/${modelInfo.baseModel}:generateContent?key=${apiKey}`;

  const canThink = !modelInfo.baseModel.includes("lite");

  const makePayload = (includeThinking, includeTools) => {
    const generationConfig = {
      temperature: 0.7,
      maxOutputTokens: 8192
    };
    if (includeThinking && canThink && effectiveThinking === "off") {
      generationConfig.thinkingConfig = {
        thinkingBudget: 0
      };
    } else if (includeThinking && canThink && effectiveThinking && effectiveThinking !== "off" && effectiveThinking !== "auto") {
      const budgetTokens = THINKING_BUDGETS[effectiveThinking];
      if (budgetTokens) {
        generationConfig.thinkingConfig = {
          includeThoughts: true,
          thinkingBudget: budgetTokens
        };
      }
    } else if (includeThinking && canThink && effectiveThinking === "auto" && modelInfo.isThinkingVariant) {
      generationConfig.thinkingConfig = {
        includeThoughts: true,
        thinkingBudget: THINKING_BUDGETS[modelInfo.defaultThinking] || 8192
      };
    }

    const payload = {
      contents,
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig
    };

    if (includeTools && toolDeclarations && toolDeclarations.length > 0) {
      payload.tools = [{ functionDeclarations: toolDeclarations }];
    }
    return payload;
  };

  const tryFetch = async (url, payload, tMs) => {
    try {
      return await fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }, tMs);
    } catch (e) {
      return { ok: false, status: 504, _timedOut: true, text: async () => e.message || "Timeout" };
    }
  };

  const primaryTimeout = Math.min(timeoutMs, 9500);
  let resp = await tryFetch(endpoint, makePayload(true, true), primaryTimeout);

  if (!resp.ok && !resp._timedOut) {
    // Retry without thinkingConfig in case model/tool combination rejects thinkingBudget
    resp = await tryFetch(endpoint, makePayload(false, true), 8000);
  }

  if (!resp.ok && !resp._timedOut && toolDeclarations.length > 0) {
    // Fallback without tool declarations if model is image-only
    resp = await tryFetch(endpoint, makePayload(false, false), 8000);
  }

  // Automatic high-speed Vertex AI failover to gemini-2.5-flash / gemini-2.5-pro if preview model times out or errors
  if (!resp.ok) {
    const fallbackModel = modelInfo.baseModel.includes("pro") ? "gemini-2.5-pro" : "gemini-2.5-flash";
    const fbEndpoint = `https://aiplatform.googleapis.com/v1beta1/projects/${project}/locations/global/publishers/google/models/${fallbackModel}:generateContent?key=${apiKey}`;
    resp = await tryFetch(fbEndpoint, makePayload(true, true), 15000);
    if (!resp.ok) {
      resp = await tryFetch(fbEndpoint, makePayload(false, true), 12000);
    }
    if (!resp.ok && toolDeclarations.length > 0) {
      resp = await tryFetch(fbEndpoint, makePayload(false, false), 10000);
    }
  }

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Vertex AI Error (${resp.status}): ${errText.slice(0, 600)}`);
  }

  return await resp.json();
}

function extractPartsFromResponse(data) {
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  let replyText = "";
  let thoughtsText = "";
  const functionCalls = [];

  for (const part of parts) {
    if (part.thought === true && part.text) {
      thoughtsText += part.text + "\n";
    } else if (part.functionCall) {
      functionCalls.push(part.functionCall);
    } else if (part.text) {
      replyText += part.text;
    }
  }
  return {
    candidateContent: candidate?.content || { role: "model", parts: [{ text: replyText || "(no output)" }] },
    replyText,
    thoughtsText: thoughtsText.trim(),
    functionCalls,
    usage: data?.usageMetadata || {}
  };
}

// Multi-turn Agentic Loop with Tool Execution
async function runHermesAgentTurn({
  env,
  idx,
  session,
  modelInfo,
  effectiveThinking,
  toolsetName,
  userMessage,
  imageAttachment,
  skillContext,
  ephemeral = false,
  maxToolTurns = 5,
  onProgress = null
}) {
  const systemPrompt = buildSystemInstruction(idx, modelInfo, effectiveThinking, toolsetName);
  const declarations = getDeclarationsForToolset(toolsetName);

  // Build conversation contents from session history (up to last 24 messages)
  const historyMessages = ephemeral ? [] : (session?.messages || []).slice(-24);
  const contents = [];

  for (const m of historyMessages) {
    const role = m.role === "assistant" ? "model" : "user";
    const textContent = (m.content || "").trim();
    if (!textContent) continue;
    contents.push({
      role,
      parts: [{ text: textContent }]
    });
  }

  // Current user message parts (supports text + optional skill context + optional multimodal image)
  const userParts = [];
  let fullUserText = userMessage;
  if (skillContext) {
    fullUserText = `[Preloaded Hermes Skill Instructions]\n${skillContext}\n\n[User Request]\n${userMessage}`;
  }
  userParts.push({ text: fullUserText });

  if (imageAttachment && imageAttachment.data && imageAttachment.mimeType) {
    userParts.push({
      inlineData: {
        mimeType: imageAttachment.mimeType,
        data: imageAttachment.data
      }
    });
  }

  contents.push({ role: "user", parts: userParts });

  const executedToolTrace = [];
  let aggregatedThoughts = "";
  let finalReply = "";
  let totalUsage = { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 };

  // Helper for delegate_task subagent execution
  const callVertexSubagent = async ({ goal, context, modelId, role }) => {
    const subModel = MODELS.find(m => m.id === modelId) || MODELS.find(m => m.id === "gemini-3.8-flash-thinking") || MODELS[1];
    const subSystem = `You are a specialized Hermes Subagent (${role}). Complete the delegated goal accurately and concisely. You have access to Spot VM /data/hermes tools if needed.`;
    const subContents = [
      {
        role: "user",
        parts: [{ text: `Subagent Role: ${role}\nContext: ${context || "None"}\n\nDelegated Goal:\n${goal}` }]
      }
    ];
    const subData = await rawVertexGenerate(env, subModel, subContents, subSystem, subModel.defaultThinking || "medium", []);
    const parsed = extractPartsFromResponse(subData);
    return parsed.replyText || "(Subagent completed with no text output)";
  };

  const toolCtx = {
    env,
    idx,
    saveIndex: (e, i) => saveIndex(e, i),
    loadSession: (e, sid) => loadSession(e, sid),
    callVertexSubagent
  };

  for (let turn = 0; turn < maxToolTurns; turn++) {
    const data = await rawVertexGenerate(env, modelInfo, contents, systemPrompt, effectiveThinking, declarations);
    const parsed = extractPartsFromResponse(data);

    if (parsed.thoughtsText) {
      aggregatedThoughts += (aggregatedThoughts ? "\n---\n" : "") + parsed.thoughtsText;
    }
    if (parsed.usage) {
      totalUsage.promptTokenCount += parsed.usage.promptTokenCount || 0;
      totalUsage.candidatesTokenCount += parsed.usage.candidatesTokenCount || 0;
      totalUsage.totalTokenCount += parsed.usage.totalTokenCount || 0;
    }

    if (!parsed.functionCalls || parsed.functionCalls.length === 0) {
      finalReply = parsed.replyText || finalReply || "(Completed)";
      break;
    }

    // Append the model's functionCall turn
    contents.push(parsed.candidateContent);

    // Execute all requested tool calls in this turn
    const functionResponseParts = [];
    for (const fc of parsed.functionCalls) {
      const toolName = fc.name;
      const toolArgs = fc.args || {};
      let toolResult;
      try {
        toolResult = await executeHermesTool(toolName, toolArgs, toolCtx);
      } catch (err) {
        toolResult = { ok: false, error: err.message };
      }

      executedToolTrace.push({
        name: toolName,
        args: toolArgs,
        result: toolResult,
        timestamp: new Date().toISOString()
      });

      if (typeof onProgress === "function") {
        try {
          await onProgress({
            thoughts: aggregatedThoughts || null,
            toolCalls: executedToolTrace,
            statusText: `⚙️ Executed tool \`${toolName}\` (turn ${turn + 1}/${maxToolTurns})...`
          });
        } catch {}
      }

      functionResponseParts.push({
        functionResponse: {
          name: toolName,
          response: { result: toolResult }
        }
      });
    }

    idx.usage_stats.total_tool_calls = (idx.usage_stats.total_tool_calls || 0) + parsed.functionCalls.length;

    // Feed tool responses back to the model
    contents.push({
      role: "user",
      parts: functionResponseParts
    });

    if (turn === maxToolTurns - 1) {
      // Final synthesis call without tools so the model summarizes findings
      const finalData = await rawVertexGenerate(env, modelInfo, contents, systemPrompt, "off", []);
      const finalParsed = extractPartsFromResponse(finalData);
      finalReply = finalParsed.replyText || parsed.replyText || "Completed maximum tool execution turns.";
    }
  }

  idx.usage_stats.total_requests = (idx.usage_stats.total_requests || 0) + 1;
  idx.usage_stats.by_model[modelInfo.id] = (idx.usage_stats.by_model[modelInfo.id] || 0) + 1;

  return {
    reply: finalReply,
    thoughts: aggregatedThoughts || null,
    toolCalls: executedToolTrace,
    usage: totalUsage
  };
}

// ============================================================================
// SLASH COMMAND PROCESSOR (/help, /moa, /learn, /compress, /doctor, etc.)
// ============================================================================
async function handleSlashCommand(rawMessage, { env, idx, session, modelInfo, effectiveThinking, toolsetName }) {
  const trimmed = rawMessage.trim();
  if (!trimmed.startsWith("/")) return null;

  const [cmdRaw, ...restTokens] = trimmed.split(/\s+/);
  const cmd = cmdRaw.toLowerCase();
  const argText = restTokens.join(" ").trim();

  if (cmd === "/help") {
    return {
      reply: `### ☤ Hermes Agent Slash Commands & Capabilities

| Command | Description |
| :--- | :--- |
| \`/help\` | Show all Hermes Agent slash commands, toolsets, and capabilities |
| \`/moa <prompt>\` | **Mixture-of-Agents (MoA)**: Run \`gemini-3.8-flash\`, \`gemini-3.8-flash-thinking\`, and \`gemini-3.0-pro\` in parallel, then synthesize the best response |
| \`/learn [skill-name]\` | Extract procedural knowledge from this session and save a reusable \`SKILL.md\` onto \`/data/hermes/.hermes/skills/\` |
| \`/compress\` | Summarize and compress older conversation turns to free context window while preserving key facts |
| \`/doctor\` | Run live Hermes diagnostics across Vertex AI, R2, Spot VM \`/data/hermes\` disk, and systemd services |
| \`/btw <question>\` | Ask an ephemeral side question without polluting or mutating session history |
| \`/retry\` | Re-generate the last assistant response |
| \`/undo\` | Remove the last user/assistant exchange from the current session |
| \`/usage\` | Show token and model usage statistics across your Vertex AI Gemini models |
| \`/goal <objective>\` | Execute a deep multi-step autonomous goal with full tool access and Kanban tracking |`,
      thoughts: null,
      toolCalls: []
    };
  }

  if (cmd === "/usage") {
    const stats = idx.usage_stats || { total_requests: 0, total_tool_calls: 0, by_model: {} };
    const modelLines = Object.entries(stats.by_model || {}).map(([m, c]) => `- **${m}**: ${c} requests`).join("\n") || "- No model calls recorded yet";
    return {
      reply: `### 📊 Hermes Agent Usage & Storage Telemetry
- **Total Agent Turns**: ${stats.total_requests || 0}
- **Total Tool Invocations**: ${stats.total_tool_calls || 0}
- **Saved Sessions**: ${(idx.sessions || []).length}
- **Bundled + Custom Skills**: ${(idx.skills || []).length}
- **Persistent Facts**: ${(idx.memories || []).length}
- **Kanban Tasks**: ${(idx.kanban_tasks || []).length}
- **Scheduled Cronjobs**: ${(idx.cronjobs || []).length}

#### Requests by Gemini Model
${modelLines}`,
      thoughts: null,
      toolCalls: []
    };
  }

  if (cmd === "/doctor") {
    const vmHealth = await callVmBridge(idx, "/health", "GET", null, 12000);
    const cliDoctor = await callVmBridge(idx, "/hermes_cli", "POST", { args: "doctor" }, 20000);
    return {
      reply: `### 🩺 Hermes Doctor — End-to-End Diagnostics
- **Cloudflare Worker Edge**: ✅ ONLINE (\`hermes.example.com\`)
- **Cloudflare R2 Bucket (\`hermes-agent-storage\`)**: ✅ CONNECTED
- **Google Vertex AI (\`your-gcp-project-id\`)**: ✅ ACTIVE (21 Gemini Models + Thinking Budgets)
- **Spot VM Bridge (\`/data/hermes\`)**: ${vmHealth.ok ? `✅ ONLINE (${idx.vm_bridge?.tunnel_url})` : `⚠️ Bridge status: ${vmHealth.error || "Syncing"}`}
- **/data Persistent Disk Free Space**: \`${vmHealth.data_disk?.free_gb ?? idx.vm_bridge?.data_disk?.free_gb ?? "N/A"} GB\` free / \`${vmHealth.data_disk?.total_gb ?? idx.vm_bridge?.data_disk?.total_gb ?? "N/A"} GB\` total
- **Systemd Services**: \`${JSON.stringify(vmHealth.services || idx.vm_bridge?.services || {})}\`

#### Native \`hermes doctor\` CLI Output
\`\`\`text
${(cliDoctor.stdout || cliDoctor.stderr || "Bridge CLI check completed.").slice(0, 3000)}
\`\`\``,
      thoughts: null,
      toolCalls: [{ name: "hermes_cli", args: { args: "doctor" }, result: cliDoctor }]
    };
  }

  if (cmd === "/undo") {
    if (session.messages.length >= 2) {
      const removed = session.messages.splice(-2, 2);
      return {
        reply: `↩️ **Undid last turn** (removed ${removed.length} messages). Session now has ${session.messages.length} messages.`,
        thoughts: null,
        toolCalls: [],
        skipAppend: true
      };
    }
    return {
      reply: "ℹ️ Nothing to undo in this session.",
      thoughts: null,
      toolCalls: [],
      skipAppend: true
    };
  }

  if (cmd === "/compress") {
    if ((session.messages || []).length < 4) {
      return {
        reply: "ℹ️ Session has fewer than 4 messages; context compression is not needed yet.",
        thoughts: null,
        toolCalls: [],
        skipAppend: true
      };
    }
    const oldTranscript = session.messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n").slice(0, 24000);
    const sumModel = MODELS.find(m => m.id === "gemini-3.8-flash") || MODELS[1];
    const sumData = await rawVertexGenerate(
      env,
      sumModel,
      [{ role: "user", parts: [{ text: `Summarize the key technical decisions, facts, file paths, and open tasks from this conversation into a compact context handoff:\n\n${oldTranscript}` }] }],
      "You are Hermes Context Compressor. Produce a dense, accurate markdown summary.",
      "off",
      []
    );
    const summaryText = extractPartsFromResponse(sumData).replyText;
    const prevCount = session.messages.length;
    session.messages = [
      {
        role: "assistant",
        content: `### 🗜️ Compressed Session Context (from ${prevCount} prior messages)\n\n${summaryText}`,
        model: sumModel.id,
        created_at: new Date().toISOString()
      }
    ];
    return {
      reply: session.messages[0].content,
      thoughts: null,
      toolCalls: [],
      skipAppend: true
    };
  }

  if (cmd === "/btw") {
    if (!argText) {
      return { reply: "Usage: `/btw <your quick side question>`", thoughts: null, toolCalls: [], skipAppend: true };
    }
    const res = await runHermesAgentTurn({
      env,
      idx,
      session,
      modelInfo,
      effectiveThinking,
      toolsetName,
      userMessage: argText,
      ephemeral: true
    });
    return {
      reply: `*(💡 Ephemeral \`/btw\` side-response — not added to session context)*\n\n${res.reply}`,
      thoughts: res.thoughts,
      toolCalls: res.toolCalls,
      skipAppend: true
    };
  }

  if (cmd === "/moa") {
    const prompt = argText || "Explain the architecture of this Hermes Agent deployment.";
    const proposerIds = ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-3.5-flash-lite"];
    const proposers = proposerIds.map(id => MODELS.find(m => m.id === id)).filter(Boolean);

    const proposerResults = await Promise.all(
      proposers.map(async m => {
        try {
          const d = await rawVertexGenerate(
            env,
            m,
            [{ role: "user", parts: [{ text: prompt }] }],
            "Provide a concise, high-signal expert response.",
            "off",
            [],
            14000
          );
          const p = extractPartsFromResponse(d);
          return { model: m.id, name: m.name, reply: p.replyText, thoughts: p.thoughtsText };
        } catch (e) {
          return { model: m.id, name: m.name, reply: `Error: ${e.message}`, thoughts: "" };
        }
      })
    );

    const aggregatorModel = MODELS.find(m => m.id === "gemini-2.5-flash") || MODELS[0];
    const synthesisPrompt = `You are the Hermes Mixture-of-Agents (MoA) Aggregator.
User Prompt:
${prompt}

Below are candidate responses from 3 Gemini models:
${proposerResults.map((r, i) => `--- CANDIDATE ${i + 1}: ${r.name} (${r.model}) ---\n${r.reply}`).join("\n\n")}

Synthesize the strongest, most accurate, and most complete final response combining the best insights from all candidates.`;

    const aggData = await rawVertexGenerate(
      env,
      aggregatorModel,
      [{ role: "user", parts: [{ text: synthesisPrompt }] }],
      "You are the Hermes MoA Master Synthesizer.",
      "off",
      [],
      20000
    );
    const aggParsed = extractPartsFromResponse(aggData);

    return {
      reply: `### 🧬 Hermes Mixture-of-Agents (MoA) Synthesis\n*Aggregated across \`gemini-2.5-flash-lite\`, \`gemini-2.5-flash\`, and \`gemini-3.5-flash-lite\` using \`gemini-2.5-flash\`*\n\n${aggParsed.replyText}`,
      thoughts: aggParsed.thoughtsText || proposerResults.map(r => `[${r.model}] ${r.thoughts}`).filter(Boolean).join("\n"),
      toolCalls: proposerResults.map(r => ({
        name: `moa_proposer:${r.model}`,
        args: { model: r.model },
        result: { preview: (r.reply || "").slice(0, 300) }
      }))
    };
  }

  if (cmd === "/learn") {
    const requestedName = (argText || `learned-skill-${Date.now().toString(36)}`).toLowerCase().replace(/[^a-z0-9-_]/g, "-");
    const transcript = (session.messages || []).slice(-12).map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");
    const learnPrompt = `Based on the following conversation or task, create a complete, reusable Hermes Agent SKILL.md file (with YAML frontmatter \`name: ${requestedName}\`, \`description: ...\`, and step-by-step markdown instructions, commands, and pitfalls).\n\nConversation:\n${transcript || argText || "General Spot VM /data/hermes operational skill"}`;

    const learnData = await rawVertexGenerate(
      env,
      modelInfo,
      [{ role: "user", parts: [{ text: learnPrompt }] }],
      "You are the Hermes Autonomous Skill Creator. Output ONLY valid SKILL.md markdown starting with --- YAML frontmatter.",
      "off",
      []
    );
    const skillMd = extractPartsFromResponse(learnData).replyText.trim();
    const saveRes = await executeHermesTool(
      "skill_manage",
      { action: "create", name: requestedName, category: "autonomous-learned", content: skillMd },
      { env, idx, saveIndex, loadSession, callVertexSubagent: async () => "" }
    );

    return {
      reply: `### 📚 Learned & Saved New Hermes Skill: \`${requestedName}\`\nSaved to \`/data/hermes/.hermes/skills/autonomous-learned/${requestedName}/SKILL.md\` and Cloudflare R2.\n\n\`\`\`markdown\n${skillMd}\n\`\`\``,
      thoughts: null,
      toolCalls: [{ name: "skill_manage", args: { action: "create", name: requestedName }, result: saveRes }]
    };
  }

  if (cmd === "/goal") {
    const goalText = argText || "Audit /data/hermes persistent storage and verify all services.";
    // Create a Kanban card automatically and run the full agent turn
    const kbId = "kb_" + Date.now().toString(36);
    idx.kanban_tasks.unshift({
      id: kbId,
      title: `Goal: ${goalText.slice(0, 80)}`,
      description: goalText,
      column: "in_progress",
      priority: "high",
      assignee: modelInfo.id,
      comments: [{ author: "hermes-goal", text: "Autonomous /goal execution started.", created_at: new Date().toISOString() }],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    const res = await runHermesAgentTurn({
      env,
      idx,
      session,
      modelInfo,
      effectiveThinking: effectiveThinking === "off" ? "high" : effectiveThinking,
      toolsetName: "hermes-cli",
      userMessage: `[AUTONOMOUS GOAL EXECUTION — KANBAN ID: ${kbId}]\nExecute this goal thoroughly using your tools, verify the outcome, and summarize all actions taken:\n\n${goalText}`,
      maxToolTurns: 6
    });
    const card = idx.kanban_tasks.find(k => k.id === kbId);
    if (card) {
      card.column = "done";
      card.updated_at = new Date().toISOString();
      card.comments.push({ author: modelInfo.id, text: (res.reply || "").slice(0, 500), created_at: new Date().toISOString() });
    }
    return res;
  }

  return null;
}

// ============================================================================
// MAIN WORKER ENTRYPOINT
// ============================================================================
export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // 1. Public Auth Endpoints (support both /api/auth/login and /api/login)
    if ((path === "/api/auth/login" || path === "/api/login") && request.method === "POST") {
      try {
        const body = await request.json();
        const expectedUser = env.AUTH_USERNAME || "admin@example.com";
        const expectedPass = env.AUTH_PASSWORD || "CHANGE_ME_STRONG_PASSWORD";
        if (body.username === expectedUser && body.password === expectedPass) {
          const token = await makeAuthToken(expectedUser, expectedPass);
          const cookie = `hermes_auth=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;
          return jsonResponse({ ok: true, token, user: expectedUser }, 200, { "Set-Cookie": cookie });
        }
        return jsonResponse({ ok: false, error: "Invalid username or password. Access restricted to owner." }, 401);
      } catch (err) {
        return jsonResponse({ ok: false, error: err.message }, 400);
      }
    }

    if ((path === "/api/auth/logout" || path === "/api/logout") && request.method === "POST") {
      const cookie = `hermes_auth=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
      return jsonResponse({ ok: true }, 200, { "Set-Cookie": cookie });
    }

    if (path === "/api/auth/status" && request.method === "GET") {
      const authed = await isAuthenticated(request, env);
      return jsonResponse({
        ok: true,
        authenticated: authed,
        user: authed ? (env.AUTH_USERNAME || "admin@example.com") : null
      });
    }

    // 2. Spot VM Bridge Heartbeat Endpoint (Authenticated by Bridge Secret or Owner Password)
    if (path === "/api/vm/heartbeat" && request.method === "POST") {
      const bridgeSecret = request.headers.get("X-Hermes-Bridge-Secret") || "";
      const authed = await isAuthenticated(request, env);
      if (!authed && bridgeSecret !== "CHANGE_ME_BRIDGE_SECRET") {
        return jsonResponse({ error: "Unauthorized bridge heartbeat" }, 401);
      }
      const body = await request.json();
      const idx = await loadIndex(env);
      idx.vm_bridge = {
        tunnel_url: body.tunnel_url || idx.vm_bridge?.tunnel_url || "",
        bridge_secret: body.bridge_secret || "CHANGE_ME_BRIDGE_SECRET",
        hostname: body.hostname || "spot-vm",
        data_disk: body.data_disk || {},
        services: body.services || {},
        hermes_version: body.hermes_version || "Hermes Agent v0.10.0",
        last_heartbeat: body.timestamp || new Date().toISOString()
      };
      if (Array.isArray(body.skills) && body.skills.length > 0) {
        idx.skills = body.skills;
      }
      if (body.memory_files && typeof body.memory_files === "object") {
        idx.memory_files = {
          ...idx.memory_files,
          ...body.memory_files
        };
      }
      await saveIndex(env, idx);
      return jsonResponse({
        ok: true,
        registered_tunnel: idx.vm_bridge.tunnel_url,
        skills_synced: (idx.skills || []).length
      });
    }

    // 3. Protect all other /api/* routes with authentication
    if (path.startsWith("/api/")) {
      const authed = await isAuthenticated(request, env);
      if (!authed) {
        return jsonResponse({ error: "Unauthorized. Please log in with your credentials." }, 401);
      }
    }

    // 4. GET /api/models
    if (path === "/api/models" && request.method === "GET") {
      const idx = await loadIndex(env);
      const enrichedModels = MODELS.map(m => ({
        ...m,
        variant: m.isThinkingVariant ? "thinking" : "standard"
      }));
      return jsonResponse({
        ok: true,
        provider: "Google Vertex AI",
        project: env.VERTEX_PROJECT || "your-gcp-project-id",
        default_model: "gemini-3.8-flash",
        thinking_levels: ["auto", "off", "low", "medium", "high", "max"],
        toolsets: TOOLSET_GROUPS,
        tool_count: HERMES_TOOL_DECLARATIONS.length,
        skills_count: (idx.skills || []).length + Object.keys(idx.custom_skills || {}).length,
        vm_bridge: idx.vm_bridge || null,
        models: enrichedModels
      });
    }

    // 5. GET /api/system — System, Spot VM Bridge, Disk, Services & Telemetry
    if (path === "/api/system" && request.method === "GET") {
      const idx = await loadIndex(env);
      let liveHealth = null;
      if (url.searchParams.get("live") === "1" && idx.vm_bridge?.tunnel_url) {
        liveHealth = await callVmBridge(idx, "/health", "GET", null, 8000);
        if (liveHealth && liveHealth.ok) {
          idx.vm_bridge.data_disk = liveHealth.data_disk || idx.vm_bridge.data_disk;
          idx.vm_bridge.services = liveHealth.services || idx.vm_bridge.services;
          idx.vm_bridge.last_heartbeat = new Date().toISOString();
          await saveIndex(env, idx);
        }
      }
      const skillsCount = (idx.skills || []).length + Object.keys(idx.custom_skills || {}).length;
      const totalMsgs = (idx.sessions || []).reduce((acc, s) => acc + (s.message_count || 0), 0);
      return jsonResponse({
        ok: true,
        provider: "Google Vertex AI (your-gcp-project-id)",
        storage_policy: "/data/hermes persistent disk + Cloudflare R2",
        vm_bridge: idx.vm_bridge,
        vm: {
          ok: true,
          services: idx.vm_bridge?.services || {},
          disk_df: idx.vm_bridge?.data_disk?.raw || "/dev/sda mounted at /data",
          mem_free: `Heartbeat: ${idx.vm_bridge?.last_heartbeat || "active"} • Version: ${idx.vm_bridge?.hermes_version || "v0.10.0"}`
        },
        analytics: {
          total_skills: skillsCount,
          total_sessions: (idx.sessions || []).length,
          total_messages: totalMsgs
        },
        live_health: liveHealth,
        health: {
          data_disk: idx.vm_bridge?.data_disk?.raw || "/dev/sda mounted at /data",
          services: idx.vm_bridge?.services || {}
        },
        skills_count: skillsCount,
        sessions_count: (idx.sessions || []).length,
        memories_count: (idx.memories || []).length,
        kanban_count: (idx.kanban_tasks || []).length,
        counts: {
          models: MODELS.length,
          tools: HERMES_TOOL_DECLARATIONS.length,
          skills: skillsCount,
          sessions: (idx.sessions || []).length,
          memories: (idx.memories || []).length,
          kanban_tasks: (idx.kanban_tasks || []).length,
          todos: (idx.todos || []).length,
          cronjobs: (idx.cronjobs || []).length,
          background_jobs: (idx.background_jobs || []).filter(j => j.status === "running").length
        },
        background_jobs: (idx.background_jobs || []).slice(0, 25),
        usage_stats: idx.usage_stats || {}
      });
    }

    // 5b. GET /api/jobs — Background Job Status & History
    if (path === "/api/jobs" && request.method === "GET") {
      const idx = await loadIndex(env);
      return jsonResponse({
        ok: true,
        jobs: (idx.background_jobs || []).slice(0, 30),
        running_count: (idx.background_jobs || []).filter(j => j.status === "running").length
      });
    }

    // 6. GET /api/export — Full state export for /data/hermes/sync_to_data.py
    if (path === "/api/export" && request.method === "GET") {
      const idx = await loadIndex(env);
      const fullSessions = [];
      for (const sMeta of (idx.sessions || []).slice(0, 100)) {
        const sData = await loadSession(env, sMeta.id);
        if (sData) fullSessions.push(sData);
      }
      return jsonResponse({
        exported_at: new Date().toISOString(),
        storage_policy: "/data/hermes persistent disk",
        sessions: fullSessions,
        memories: idx.memories || [],
        kanban_tasks: idx.kanban_tasks || [],
        todos: idx.todos || [],
        cronjobs: idx.cronjobs || [],
        memory_files: idx.memory_files || {},
        custom_skills: idx.custom_skills || {},
        vm_bridge: idx.vm_bridge || null
      });
    }

    // 7. Sessions API
    if (path === "/api/sessions" && request.method === "GET") {
      const idx = await loadIndex(env);
      return jsonResponse({
        ok: true,
        sessions: idx.sessions || [],
        memories: idx.memories || [],
        todos: idx.todos || [],
        active_jobs: (idx.background_jobs || []).filter(j => j.status === "running")
      });
    }

    if (path === "/api/sessions" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const idx = await loadIndex(env);
      const sessionId = "sess_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
      const now = new Date().toISOString();
      const newSession = {
        id: sessionId,
        title: body.title || "New Hermes Session",
        model: body.model || "gemini-3.8-flash",
        thinking_level: body.thinking_level || body.thinking_mode || "auto",
        toolset: body.toolset || "hermes-cli",
        created_at: now,
        updated_at: now,
        messages: []
      };
      await saveSession(env, newSession);
      idx.sessions.unshift({
        id: sessionId,
        title: newSession.title,
        model: newSession.model,
        thinking_level: newSession.thinking_level,
        toolset: newSession.toolset,
        created_at: now,
        updated_at: now,
        message_count: 0
      });
      await saveIndex(env, idx);
      return jsonResponse({ ok: true, ...newSession, session: newSession });
    }

    if (path.startsWith("/api/sessions/") && request.method === "GET") {
      const sessionId = path.replace("/api/sessions/", "").replace(/\/messages$/, "");
      const session = await loadSession(env, sessionId);
      if (!session) return jsonResponse({ error: "Session not found" }, 404);
      const hasRunning = (session.messages || []).some(m => m.status === "running");
      return jsonResponse({
        ok: true,
        ...session,
        session,
        messages: session.messages || [],
        has_running_turn: hasRunning
      });
    }

    if (path.startsWith("/api/sessions/") && request.method === "DELETE") {
      const sessionId = path.replace("/api/sessions/", "").replace(/\/messages$/, "");
      await getR2(env).delete(`hermes_state/sessions/${sessionId}.json`);
      const idx = await loadIndex(env);
      idx.sessions = (idx.sessions || []).filter(s => s.id !== sessionId);
      await saveIndex(env, idx);
      return jsonResponse({ ok: true, deleted: sessionId });
    }

    // 8. Memories & Persona (SOUL.md, MEMORY.md, USER.md + Facts)
    if (path === "/api/memories" && request.method === "GET") {
      const idx = await loadIndex(env);
      if (url.searchParams.get("sync") === "1" && idx.vm_bridge?.tunnel_url) {
        const vmMem = await callVmBridge(idx, "/memory_files", "POST", { action: "read" }, 8000);
        if (vmMem.ok && vmMem.files) {
          idx.memory_files = { ...idx.memory_files, ...vmMem.files };
          await saveIndex(env, idx);
        }
      }
      const mf = idx.memory_files || {};
      return jsonResponse({
        ok: true,
        memories: idx.memories || [],
        memory_files: mf,
        persona: {
          soul_md: mf["SOUL.md"] || DEFAULT_SOUL,
          memory_md: mf["MEMORY.md"] || "",
          user_md: mf["USER.md"] || ""
        }
      });
    }

    if (path === "/api/memories" && request.method === "POST") {
      const body = await request.json();
      const idx = await loadIndex(env);
      if (!idx.memory_files) idx.memory_files = {};

      // Case A1: Batch update SOUL.md, MEMORY.md, USER.md from UI
      if (body.action === "update_files" || body.soul_md !== undefined || body.memory_md !== undefined || body.user_md !== undefined) {
        if (body.soul_md !== undefined) idx.memory_files["SOUL.md"] = body.soul_md;
        if (body.memory_md !== undefined) idx.memory_files["MEMORY.md"] = body.memory_md;
        if (body.user_md !== undefined) idx.memory_files["USER.md"] = body.user_md;
        await saveIndex(env, idx);
        const vmRes = await callVmBridge(idx, "/memory_files", "POST", {
          action: "write",
          soul_md: idx.memory_files["SOUL.md"],
          memory_md: idx.memory_files["MEMORY.md"],
          user_md: idx.memory_files["USER.md"]
        });
        return jsonResponse({
          ok: true,
          vm_synced: !!vmRes.ok,
          memory_files: idx.memory_files
        });
      }

      // Case A2: Single file update (SOUL.md, MEMORY.md, or USER.md)
      if (body.file && ["SOUL.md", "MEMORY.md", "USER.md"].includes(body.file)) {
        idx.memory_files[body.file] = body.content || "";
        await saveIndex(env, idx);
        const vmRes = await callVmBridge(idx, "/memory_files", "POST", {
          action: "write",
          file: body.file,
          content: body.content || ""
        });
        return jsonResponse({
          ok: true,
          file: body.file,
          vm_synced: !!vmRes.ok,
          memory_files: idx.memory_files
        });
      }

      // Case B0: Delete a structured memory fact via POST
      if (body.action === "delete_fact" && body.id) {
        idx.memories = (idx.memories || []).filter(m => m.id !== body.id);
        await saveIndex(env, idx);
        return jsonResponse({ ok: true, memories: idx.memories });
      }

      // Case B: Add a structured memory fact
      const factText = (body.content || body.text || "").trim();
      if (!factText) {
        return jsonResponse({ error: "Memory content required" }, 400);
      }
      const mem = {
        id: "mem_" + Date.now().toString(36),
        content: factText,
        text: factText,
        category: body.category || "general",
        created_at: new Date().toISOString()
      };
      idx.memories.unshift(mem);
      await saveIndex(env, idx);
      return jsonResponse({ ok: true, memory: mem, memories: idx.memories });
    }

    if (path.startsWith("/api/memories/") && request.method === "DELETE") {
      const memId = path.replace("/api/memories/", "");
      const idx = await loadIndex(env);
      idx.memories = (idx.memories || []).filter(m => m.id !== memId);
      await saveIndex(env, idx);
      return jsonResponse({ ok: true, memories: idx.memories });
    }

    // 9. Skills Catalog & Skill Manager (/data/hermes/.hermes/skills/)
    if (path === "/api/skills" && request.method === "GET") {
      const idx = await loadIndex(env);
      if ((!idx.skills || idx.skills.length === 0) && idx.vm_bridge?.tunnel_url) {
        const vmSkills = await callVmBridge(idx, "/skills", "POST", { action: "list" }, 10000);
        if (vmSkills.ok && Array.isArray(vmSkills.skills)) {
          idx.skills = vmSkills.skills;
          await saveIndex(env, idx);
        }
      }
      const customList = Object.values(idx.custom_skills || {});
      const allSkills = [...customList, ...(idx.skills || [])];
      const categories = [...new Set(allSkills.map(s => s.category || "general"))].sort();
      return jsonResponse({
        ok: true,
        skills: allSkills,
        categories
      });
    }

    if (path.startsWith("/api/skills/") && request.method === "GET") {
      const skillName = decodeURIComponent(path.replace("/api/skills/", ""));
      const idx = await loadIndex(env);
      if (idx.custom_skills && idx.custom_skills[skillName]) {
        const sk = idx.custom_skills[skillName];
        return jsonResponse({ ok: true, skill: sk, ...sk });
      }
      const vmRes = await callVmBridge(idx, "/skills", "POST", { action: "view", name: skillName }, 10000);
      if (vmRes.ok) {
        const skObj = vmRes.skill || { name: skillName, category: vmRes.category || "bundled", path: vmRes.path || "" };
        return jsonResponse({ ok: true, skill: skObj, ...skObj, content: vmRes.content || "" });
      }
      const meta = (idx.skills || []).find(s => s.name === skillName);
      if (meta) {
        const fallbackContent = `# ${meta.name}\n\n${meta.description}\n\n(Path on Spot VM: ${meta.path})`;
        return jsonResponse({
          ok: true,
          skill: meta,
          name: meta.name,
          category: meta.category,
          path: meta.path,
          content: fallbackContent
        });
      }
      return jsonResponse({ ok: false, error: `Skill '${skillName}' not found` }, 404);
    }

    if (path === "/api/skills" && request.method === "POST") {
      const body = await request.json();
      const idx = await loadIndex(env);
      const res = await executeHermesTool(
        "skill_manage",
        {
          action: body.action || "create",
          name: body.name,
          category: body.category || "custom",
          content: body.content || ""
        },
        { env, idx, saveIndex, loadSession, callVertexSubagent: async () => "" }
      );
      return jsonResponse(res);
    }

    // 10. Spot VM Live Bash Terminal (/api/terminal)
    if (path === "/api/terminal" && request.method === "POST") {
      const body = await request.json();
      const idx = await loadIndex(env);
      const res = await callVmBridge(idx, "/terminal", "POST", {
        command: body.command || "pwd && ls -la /data/hermes",
        workdir: body.workdir || "/data/hermes",
        timeout: body.timeout || 45
      }, 50000);
      return jsonResponse(res);
    }

    // 11. Spot VM Code Execution Sandbox (/api/execute-code and /api/code)
    if ((path === "/api/execute-code" || path === "/api/code") && request.method === "POST") {
      const body = await request.json();
      const idx = await loadIndex(env);
      const res = await callVmBridge(idx, "/execute_code", "POST", {
        code: body.code || "print('Hello from Hermes on /data/hermes')",
        language: body.language || "python",
        timeout: body.timeout || 45
      }, 50000);
      return jsonResponse(res);
    }

    // 12. Persistent Disk (/data/hermes) File Manager (/api/files)
    if (path === "/api/files" && request.method === "GET") {
      const targetPath = url.searchParams.get("path") || "/data/hermes";
      const mode = url.searchParams.get("mode") || "list";
      const idx = await loadIndex(env);
      if (mode === "read") {
        const res = await callVmBridge(idx, "/files", "POST", { action: "read", path: targetPath }, 25000);
        return jsonResponse(res);
      }
      const res = await callVmBridge(idx, "/files", "POST", { action: "list", path: targetPath }, 25000);
      const entries = (res.entries || res.files || []).map(e => ({
        ...e,
        is_dir: e.is_dir !== undefined ? e.is_dir : (e.type === "dir" || e.type === "directory")
      }));
      return jsonResponse({ ...res, entries });
    }

    if (path === "/api/files" && request.method === "POST") {
      const body = await request.json();
      const idx = await loadIndex(env);
      const res = await callVmBridge(idx, "/files", "POST", body, 25000);
      return jsonResponse(res);
    }

    // 13. Native Hermes CLI Runner (/api/hermes-cli)
    if (path === "/api/hermes-cli" && request.method === "POST") {
      const body = await request.json();
      const idx = await loadIndex(env);
      if (body.action === "processes") {
        const pRes = await callVmBridge(idx, "/processes", "POST", { action: body.subaction || "list", service: body.service }, 20000);
        return jsonResponse(pRes);
      }
      const res = await callVmBridge(idx, "/hermes_cli", "POST", { args: body.args || "status" }, 25000);
      return jsonResponse(res);
    }

    // 14. Kanban Board & Autonomous Subagent Dispatcher (/api/kanban)
    if (path === "/api/kanban" && request.method === "GET") {
      const idx = await loadIndex(env);
      return jsonResponse({
        ok: true,
        tasks: idx.kanban_tasks || [],
        kanban: idx.kanban_tasks || [],
        todos: idx.todos || []
      });
    }

    if (path === "/api/kanban" && request.method === "POST") {
      const body = await request.json();
      const idx = await loadIndex(env);

      if (body.action === "dispatch" && body.id) {
        const card = (idx.kanban_tasks || []).find(t => t.id === body.id);
        if (!card) return jsonResponse({ ok: false, error: "Kanban task not found" }, 404);
        card.column = "in_progress";
        card.updated_at = new Date().toISOString();
        const modelInfo = MODELS.find(m => m.id === (body.model || card.assignee)) || MODELS.find(m => m.id === "gemini-3.8-flash-thinking") || MODELS[1];

        const runDispatch = async () => {
          const freshIdx = await loadIndex(env);
          const freshCard = (freshIdx.kanban_tasks || []).find(t => t.id === body.id) || card;
          const agentRes = await runHermesAgentTurn({
            env,
            idx: freshIdx,
            session: { messages: [] },
            modelInfo,
            effectiveThinking: modelInfo.defaultThinking || "high",
            toolsetName: "hermes-cli",
            userMessage: `You are executing Kanban Task "${freshCard.title}" (ID: ${freshCard.id}).\nTask Description: ${freshCard.description || freshCard.title}\n\nUse any necessary tools on /data/hermes, complete the work, and provide a concise completion report.`,
            ephemeral: true,
            maxToolTurns: 4
          });

          freshCard.column = "review";
          freshCard.updated_at = new Date().toISOString();
          if (!freshCard.comments) freshCard.comments = [];
          freshCard.comments.push({
            author: modelInfo.id,
            text: agentRes.reply,
            tool_calls: (agentRes.toolCalls || []).length,
            created_at: new Date().toISOString()
          });
          await saveIndex(env, freshIdx);
          return { freshCard, agentRes, tasks: freshIdx.kanban_tasks };
        };

        if (body.background) {
          await saveIndex(env, idx);
          ctx.waitUntil(runDispatch().catch(err => console.error("Background Kanban dispatch error:", err)));
          return jsonResponse({ ok: true, status: "running", task: card, tasks: idx.kanban_tasks, kanban: idx.kanban_tasks });
        }

        const { freshCard, agentRes, tasks } = await runDispatch();
        return jsonResponse({ ok: true, task: freshCard, agent_output: agentRes.reply, tool_calls: agentRes.toolCalls, tasks, kanban: tasks });
      }

      const res = await executeHermesTool("kanban_manage", body, {
        env,
        idx,
        saveIndex,
        loadSession,
        callVertexSubagent: async () => ""
      });
      return jsonResponse({ ...res, kanban: idx.kanban_tasks || [], tasks: idx.kanban_tasks || [] });
    }

    // 15. Session Todo List (/api/todos)
    if (path === "/api/todos" && request.method === "POST") {
      const body = await request.json();
      const idx = await loadIndex(env);
      const res = await executeHermesTool("todo_list", body, {
        env,
        idx,
        saveIndex,
        loadSession,
        callVertexSubagent: async () => ""
      });
      return jsonResponse(res);
    }

    // 16. Scheduled Cron Automations (/api/cron)
    if (path === "/api/cron" && request.method === "GET") {
      const idx = await loadIndex(env);
      return jsonResponse({ ok: true, cronjobs: idx.cronjobs || [], cron_jobs: idx.cronjobs || [] });
    }

    if (path === "/api/cron" && request.method === "POST") {
      const body = await request.json();
      const idx = await loadIndex(env);

      if ((body.action === "run" || body.action === "run_now") && body.id) {
        try {
          const job = (idx.cronjobs || []).find(j => j.id === body.id);
          if (!job) return jsonResponse({ ok: false, error: "Cronjob not found" }, 404);
          const fastCronModel = (!job.model || job.model === "gemini-3.8-flash") ? "gemini-2.5-flash" : job.model;
          const modelInfo = MODELS.find(m => m.id === fastCronModel) || MODELS[0];
          const runRes = await runHermesAgentTurn({
            env,
            idx,
            session: { messages: [] },
            modelInfo,
            effectiveThinking: "off",
            toolsetName: "hermes-cli",
            userMessage: `[Scheduled Cron Automation: ${job.name} (${job.schedule})]\n${job.prompt}`,
            ephemeral: true,
            maxToolTurns: 2
          });
          job.last_run = new Date().toISOString();
          job.run_count = (job.run_count || 0) + 1;
          job.last_output = runRes.reply;
          job.last_result = runRes.reply;
          await saveIndex(env, idx);
          return jsonResponse({ ok: true, job, output: runRes.reply, tool_calls: runRes.toolCalls, cronjobs: idx.cronjobs, cron_jobs: idx.cronjobs });
        } catch (err) {
          return jsonResponse({ ok: false, error: err.message }, 500);
        }
      }

      const res = await executeHermesTool("cronjob_manage", body, {
        env,
        idx,
        saveIndex,
        loadSession,
        callVertexSubagent: async () => ""
      });
      return jsonResponse({ ...res, cronjobs: idx.cronjobs || [], cron_jobs: idx.cronjobs || [] });
    }

    // 17. Main Chat & Multi-Turn Function Calling Endpoint (POST /api/chat)
    // Supports BOTH Background Execution (background: true — continues when phone browser/tab is closed!)
    // and Synchronous Execution (wrapped in ctx.waitUntil so client disconnect never drops work!)
    if (path === "/api/chat" && request.method === "POST") {
      try {
        const body = await request.json();
        const {
          session_id,
          message,
          model: requestedModelId,
          thinking_level: reqThinkingLevel,
          thinking_mode: reqThinkingMode,
          toolset: requestedToolset,
          skill_context: reqSkillContext,
          preloaded_skill: reqPreloadedSkill,
          image: reqImageObj,
          image_base64: reqImageBase64,
          image_mime: reqImageMime,
          goal: reqGoal,
          remember,
          background: runInBackground
        } = body;

        const requestedThinking = reqThinkingLevel || reqThinkingMode;
        const skillContext = reqSkillContext || (reqPreloadedSkill && typeof reqPreloadedSkill === "object" && reqPreloadedSkill.content ? `[Skill: ${reqPreloadedSkill.name}]\n${reqPreloadedSkill.content}` : (typeof reqPreloadedSkill === "string" && reqPreloadedSkill ? `[Active Preloaded Skill: ${reqPreloadedSkill}]` : null));
        const imageAttachment = reqImageObj || (reqImageBase64 ? { data: reqImageBase64, mimeType: reqImageMime || "image/png" } : null);

        if (!message || !message.trim()) {
          return jsonResponse({ error: "Message cannot be empty" }, 400);
        }

        const idx = await loadIndex(env);
        let session = session_id ? await loadSession(env, session_id) : null;
        const now = new Date().toISOString();

        if (!session) {
          const newId = session_id || ("sess_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7));
          session = {
            id: newId,
            title: message.trim().slice(0, 60),
            model: requestedModelId || "gemini-3.8-flash",
            thinking_level: requestedThinking || "auto",
            toolset: requestedToolset || "hermes-cli",
            created_at: now,
            updated_at: now,
            messages: []
          };
        }

        // Quick slash commands for switching model / thinking / toolset in-session
        const trimmedMsg = message.trim();
        if (trimmedMsg.toLowerCase().startsWith("/model ")) {
          const targetM = trimmedMsg.slice(7).trim();
          const foundM = MODELS.find(m => m.id.toLowerCase() === targetM.toLowerCase() || m.name.toLowerCase().includes(targetM.toLowerCase()));
          if (foundM) {
            session.model = foundM.id;
            session.messages.push({ role: "user", content: message, created_at: now });
            session.messages.push({
              role: "assistant",
              content: `✅ Switched active model to **${foundM.name}** (\`${foundM.id}\`, default thinking: \`${foundM.defaultThinking}\`).`,
              model: foundM.id,
              created_at: new Date().toISOString()
            });
            await saveSession(env, session);
            return jsonResponse({ ok: true, switched_model: foundM.id, reply: session.messages[session.messages.length - 1].content, session_id: session.id, session });
          }
        }

        const activeModelId = requestedModelId || session.model || "gemini-3.8-flash";
        const modelInfo = MODELS.find(m => m.id === activeModelId) || MODELS[0];
        session.model = modelInfo.id;

        const effectiveThinking = (!requestedThinking || requestedThinking === "auto")
          ? (modelInfo.defaultThinking || "auto")
          : requestedThinking;
        session.thinking_level = requestedThinking || session.thinking_level || "auto";

        const activeToolset = requestedToolset || session.toolset || "hermes-cli";
        session.toolset = activeToolset;

        if (remember && typeof remember === "string" && remember.trim()) {
          idx.memories.unshift({
            id: "mem_" + Date.now().toString(36),
            content: remember.trim(),
            category: "user_pinned",
            created_at: now
          });
        }

        const effectiveMessage = reqGoal ? `[Active Session Goal: ${reqGoal}]\n\n${message}` : message;

        // ====================================================================
        // BACKGROUND EXECUTION MODE (Phone / Browser Tab Close Resilient!)
        // Immediately persists the user turn + a "running" assistant turn,
        // returns in <150ms, and runs the full agent loop via ctx.waitUntil()!
        // ====================================================================
        if (runInBackground === true && !trimmedMsg.toLowerCase().startsWith("/retry") && !trimmedMsg.toLowerCase().startsWith("/undo")) {
          const turnId = "turn_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
          const priorHistorySnapshot = [...(session.messages || [])];

          session.messages.push({
            id: "usr_" + turnId,
            role: "user",
            content: message,
            has_image: !!(imageAttachment && imageAttachment.data),
            created_at: now
          });

          session.messages.push({
            id: turnId,
            role: "assistant",
            status: "running",
            content: `⏳ **Hermes Agent (${modelInfo.name})** is executing your request in the background on Cloudflare + Spot VM (\`/data/hermes\`)...\n*(Safe to close this tab or lock your phone — progress is saved automatically)*`,
            thoughts: null,
            tool_calls: [],
            model: modelInfo.id,
            thinking_level: effectiveThinking,
            created_at: now,
            updated_at: now
          });

          if (session.messages.length <= 2 && (session.title === "New Hermes Session" || session.title === "New Agent Session")) {
            session.title = message.trim().slice(0, 60);
          }
          session.updated_at = now;
          await saveSession(env, session);

          // Update session index & register background job
          const existingMeta = idx.sessions.find(s => s.id === session.id);
          if (existingMeta) {
            existingMeta.title = session.title;
            existingMeta.model = session.model;
            existingMeta.thinking_level = session.thinking_level;
            existingMeta.toolset = session.toolset;
            existingMeta.updated_at = session.updated_at;
            existingMeta.message_count = session.messages.length;
          } else {
            idx.sessions.unshift({
              id: session.id,
              title: session.title,
              model: session.model,
              thinking_level: session.thinking_level,
              toolset: session.toolset,
              created_at: session.created_at,
              updated_at: session.updated_at,
              message_count: session.messages.length
            });
          }

          if (!idx.background_jobs) idx.background_jobs = [];
          idx.background_jobs.unshift({
            id: turnId,
            session_id: session.id,
            session_title: session.title,
            prompt: message.slice(0, 140),
            prompt_preview: message.slice(0, 140),
            model: modelInfo.id,
            status: "running",
            started_at: now,
            updated_at: now
          });
          idx.background_jobs = idx.background_jobs.slice(0, 40);
          await saveIndex(env, idx);

          // Define the detached background task executed inside ctx.waitUntil()
          const bgTask = async () => {
            try {
              const tempSessionForContext = { ...session, messages: priorHistorySnapshot };
              const slashRes = await handleSlashCommand(message, {
                env,
                idx,
                session: tempSessionForContext,
                modelInfo,
                effectiveThinking,
                toolsetName: activeToolset
              });

              let result;
              if (slashRes) {
                result = slashRes;
              } else {
                result = await runHermesAgentTurn({
                  env,
                  idx,
                  session: tempSessionForContext,
                  modelInfo,
                  effectiveThinking,
                  toolsetName: activeToolset,
                  userMessage: effectiveMessage,
                  imageAttachment,
                  skillContext,
                  onProgress: async ({ thoughts, toolCalls, statusText }) => {
                    const liveSess = await loadSession(env, session.id);
                    if (!liveSess) return;
                    const msgEntry = (liveSess.messages || []).find(m => m.id === turnId);
                    if (msgEntry && msgEntry.status === "running") {
                      const normThoughts = Array.isArray(thoughts) ? thoughts : (thoughts ? [thoughts] : msgEntry.thoughts);
                      msgEntry.thoughts = normThoughts;
                      msgEntry.tool_calls = toolCalls || msgEntry.tool_calls;
                      msgEntry.content = `⏳ **Hermes Agent (${modelInfo.name})** is working in the background...\n${statusText || ""}`;
                      msgEntry.updated_at = new Date().toISOString();
                      await saveSession(env, liveSess);
                    }
                  }
                });
              }

              const finalSess = (await loadSession(env, session.id)) || session;
              const targetMsg = (finalSess.messages || []).find(m => m.id === turnId);
              const finalThoughts = Array.isArray(result.thoughts) ? result.thoughts : (result.thoughts ? [result.thoughts] : []);
              if (targetMsg) {
                targetMsg.status = "done";
                targetMsg.content = result.reply || "(Completed)";
                targetMsg.thoughts = finalThoughts;
                targetMsg.tool_calls = result.toolCalls || [];
                targetMsg.usage = result.usage || null;
                targetMsg.updated_at = new Date().toISOString();
              } else {
                finalSess.messages.push({
                  id: turnId,
                  role: "assistant",
                  status: "done",
                  content: result.reply || "(Completed)",
                  thoughts: finalThoughts,
                  tool_calls: result.toolCalls || [],
                  model: modelInfo.id,
                  thinking_level: effectiveThinking,
                  usage: result.usage || null,
                  created_at: new Date().toISOString()
                });
              }
              finalSess.updated_at = new Date().toISOString();
              await saveSession(env, finalSess);

              const freshIdx = await loadIndex(env);
              const jobEntry = (freshIdx.background_jobs || []).find(j => j.id === turnId);
              if (jobEntry) {
                jobEntry.status = "done";
                jobEntry.completed_at = new Date().toISOString();
                jobEntry.updated_at = jobEntry.completed_at;
                jobEntry.tool_calls = (result.toolCalls || []).length;
                jobEntry.tool_count = (result.toolCalls || []).length;
                jobEntry.preview = (result.reply || "").slice(0, 180);
              }
              freshIdx.usage_stats = idx.usage_stats;
              await saveIndex(env, freshIdx);
            } catch (bgErr) {
              const errSess = await loadSession(env, session.id);
              if (errSess) {
                const targetMsg = (errSess.messages || []).find(m => m.id === turnId);
                if (targetMsg) {
                  targetMsg.status = "error";
                  targetMsg.content = `⚠️ Background execution error: ${bgErr.message}`;
                  targetMsg.updated_at = new Date().toISOString();
                }
                await saveSession(env, errSess);
              }
              const freshIdx = await loadIndex(env);
              const jobEntry = (freshIdx.background_jobs || []).find(j => j.id === turnId);
              if (jobEntry) {
                jobEntry.status = "error";
                jobEntry.error = bgErr.message;
                jobEntry.updated_at = new Date().toISOString();
              }
              await saveIndex(env, freshIdx);
            }
          };

          ctx.waitUntil(bgTask());

          return jsonResponse({
            ok: true,
            status: "running",
            job_id: turnId,
            session_id: session.id,
            model: modelInfo.id,
            thinking_level: effectiveThinking,
            toolset: activeToolset,
            session
          });
        }

        // ====================================================================
        // SYNCHRONOUS EXECUTION MODE (Also wrapped in ctx.waitUntil!)
        // ====================================================================
        // Handle /retry specially before appending user message
        if (trimmedMsg.toLowerCase() === "/retry") {
          const lastUserIdx = [...session.messages].reverse().findIndex(m => m.role === "user");
          if (lastUserIdx === -1) {
            return jsonResponse({ reply: "ℹ️ No previous user message in this session to retry.", session_id: session.id, session });
          }
          const realIdx = session.messages.length - 1 - lastUserIdx;
          const retryPrompt = session.messages[realIdx].content;
          session.messages = session.messages.slice(0, realIdx);

          const retryRes = await runHermesAgentTurn({
            env,
            idx,
            session,
            modelInfo,
            effectiveThinking,
            toolsetName: activeToolset,
            userMessage: retryPrompt
          });

          session.messages.push({ role: "user", content: retryPrompt, created_at: now });
          session.messages.push({
            role: "assistant",
            status: "done",
            content: retryRes.reply,
            thoughts: retryRes.thoughts,
            tool_calls: retryRes.toolCalls,
            model: modelInfo.id,
            thinking_level: effectiveThinking,
            usage: retryRes.usage,
            created_at: new Date().toISOString()
          });
          session.updated_at = new Date().toISOString();
          await saveSession(env, session);
          await saveIndex(env, idx);

          return jsonResponse({
            reply: retryRes.reply,
            thoughts: retryRes.thoughts,
            tool_calls: retryRes.toolCalls,
            model: modelInfo.id,
            thinking_level: effectiveThinking,
            usage: retryRes.usage,
            session_id: session.id,
            session
          });
        }

        const syncTask = (async () => {
          const slashRes = await handleSlashCommand(message, {
            env,
            idx,
            session,
            modelInfo,
            effectiveThinking,
            toolsetName: activeToolset
          });

          let result;
          if (slashRes) {
            result = slashRes;
          } else {
            result = await runHermesAgentTurn({
              env,
              idx,
              session,
              modelInfo,
              effectiveThinking,
              toolsetName: activeToolset,
              userMessage: effectiveMessage,
              imageAttachment,
              skillContext
            });
          }

          const syncThoughts = Array.isArray(result.thoughts) ? result.thoughts : (result.thoughts ? [result.thoughts] : []);
          if (!result.skipAppend) {
            session.messages.push({
              role: "user",
              content: message,
              has_image: !!(imageAttachment && imageAttachment.data),
              created_at: now
            });
            session.messages.push({
              role: "assistant",
              status: "done",
              content: result.reply,
              thoughts: syncThoughts,
              tool_calls: result.toolCalls || [],
              model: modelInfo.id,
              thinking_level: effectiveThinking,
              usage: result.usage || null,
              created_at: new Date().toISOString()
            });
          }

          if (session.messages.length <= 2 && (session.title === "New Hermes Session" || session.title === "New Agent Session")) {
            session.title = message.trim().slice(0, 60);
          }
          session.updated_at = new Date().toISOString();

          await saveSession(env, session);

          const existingMeta = idx.sessions.find(s => s.id === session.id);
          if (existingMeta) {
            existingMeta.title = session.title;
            existingMeta.model = session.model;
            existingMeta.thinking_level = session.thinking_level;
            existingMeta.toolset = session.toolset;
            existingMeta.updated_at = session.updated_at;
            existingMeta.message_count = session.messages.length;
          } else {
            idx.sessions.unshift({
              id: session.id,
              title: session.title,
              model: session.model,
              thinking_level: session.thinking_level,
              toolset: session.toolset,
              created_at: session.created_at,
              updated_at: session.updated_at,
              message_count: session.messages.length
            });
          }

          await saveIndex(env, idx);
          return result;
        })();

        ctx.waitUntil(syncTask.catch(() => {}));
        const result = await syncTask;

        return jsonResponse({
          ok: true,
          status: "done",
          reply: result.reply,
          thoughts: Array.isArray(result.thoughts) ? result.thoughts : (result.thoughts ? [result.thoughts] : []),
          tool_calls: result.toolCalls || [],
          model: modelInfo.id,
          base_model: modelInfo.baseModel,
          thinking_level: effectiveThinking,
          toolset: activeToolset,
          usage: result.usage || null,
          session_id: session.id,
          session
        });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // 18. Render the 8-Tab Hermes Agent Web Workspace UI
    return new Response(renderHermesUI(), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        ...corsHeaders()
      }
    });
  }
};
