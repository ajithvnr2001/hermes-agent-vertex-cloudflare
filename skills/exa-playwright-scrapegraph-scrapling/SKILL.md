---
name: exa-playwright-scrapegraph-scrapling
description: "Unified web search, browser automation, adaptive stealth scraping, and AI-driven structured extraction using Exa MCP, Microsoft Playwright, D4Vinci Scrapling, and ScrapeGraphAI."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Exa, MCP, Playwright, ScrapeGraphAI, Scrapling, WebScraping, Search]
    related_skills: [blocked-page-recovery]
---

# Exa MCP + Playwright + Scrapling + ScrapeGraphAI Suite

This skill integrates four complementary web intelligence layers configured on this Hermes Agent instance:

1. **Exa MCP Server (`mcp__exa__*`) & `exa_py` SDK**
   - Native MCP tools: `mcp__exa__web_search_exa`, `mcp__exa__web_fetch_exa`, `mcp__exa__agent_run`
   - Configured in `/data/hermes/.hermes/config.yaml` under `mcp_servers.exa`
2. **D4Vinci Scrapling (`scrapling`)**
   - Adaptive, anti-bot stealth HTTP/TLS fetching (`Fetcher`, `StealthyFetcher`, `DynamicFetcher`)
3. **Microsoft Playwright (`playwright`)**
   - Headless Chromium browser automation (`sync_playwright`, `async_playwright`) for full JS SPAs and interactive flows
4. **ScrapeGraphAI (`scrapegraphai`)**
   - `SmartScraperGraph` powered by Google Cloud Vertex AI (`google/gemini-3-flash-preview` / `google/gemini-3.1-pro-preview`) for schema-guided JSON extraction

## Usage Examples

### 1. Native Exa MCP Tool Call
Call `mcp__exa__web_search_exa` or `mcp__exa__web_fetch_exa` directly as a tool call in any turn.

### 2. Scrapling Stealth Fetch
```python
from scrapling.fetchers import Fetcher

page = Fetcher.get("https://example.com", stealthy_headers=True)
print(page.css("h1::text").getall())
```

### 3. Playwright Headless Chromium
```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto("https://example.com", wait_until="domcontentloaded")
    print(page.title())
    browser.close()
```

### 4. ScrapeGraphAI SmartScraperGraph (Vertex AI Gemini)
```python
from scrapegraphai.graphs import SmartScraperGraph

graph = SmartScraperGraph(
    prompt="Extract the main heading, summary, and links as JSON.",
    source="https://example.com",
    config={"llm": {"model": "google/gemini-3-flash-preview"}},
)
print(graph.run())
```
