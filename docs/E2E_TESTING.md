# End-to-End Automated Testing with `tester-army/e2e` (`docs/E2E_TESTING.md`)

This project uses [**`tester-army/e2e`**](https://github.com/tester-army/e2e) (`e2e v0.21.2` + `@e2e-dev/web` + `@ai-sdk/google-vertex`) to validate the entire live web workspace across both **`desktop` (`1440×900`)** and **`phone` (`390×844`)** viewports.

---

## 1. Why `tester-army/e2e`?

Traditional Playwright tests either rely purely on brittle CSS selectors or purely on slow LLM loops. `tester-army/e2e` provides five composable fixtures that we use together in [`e2e/tests/`](../e2e/tests/):

1. **`app`**: Navigation and lifecycle (`await app.open('/')`).
2. **`screen`**: Accessibility-first locators (`screen.getByRole('heading', 'Hermes Skills Hub')`, `screen.getByPlaceholder(...)`, `screen.getByText(...)`).
3. **`browser`**: Escape-hatch raw Playwright locators (`browser.locator('#modelSelect').selectOption(...)`, `browser.reload()`) for custom DOM widgets and browser reload simulation.
4. **`agent`**: Natural-language AI actions and assertions (`await agent.act('open the Doctor & Stats tab')`, `await agent.assert('the screen shows Hermes Doctor diagnostics and Spot VM /data persistence status')`) backed by Google Vertex AI (`gemini-2.5-flash`) with automatic action-plan caching in `.e2e/cache/`.
5. **`credentials`**: Secret-handle credential management (`credentials.admin`) so usernames and passwords never leak into test traces or LLM prompts.

---

## 2. Test Suite Architecture (`e2e/`)

### `e2e/e2e.config.ts`
Configures two targets (`desktop` at `1440×900` and `phone` at `390×844`) and connects the `default` agent to Vertex AI (`gemini-2.5-flash`):

```ts
export default {
  tests: 'tests/**/*.e2e.ts',
  targets: [
    { name: 'desktop', engine: web({ viewport: { width: 1440, height: 900 } }), app },
    { name: 'phone',   engine: web({ viewport: { width: 390, height: 844 } }),  app },
  ],
  agents: {
    default: {
      model: vertex('gemini-2.5-flash'),
      system: 'You are a thorough QA agent testing the Hermes Agent web workspace. Verify every outcome on screen.',
    },
  },
  credentials: {
    admin: {
      username: process.env.HERMES_AUTH_USER ?? 'admin@example.com',
      password: process.env.HERMES_AUTH_PASSWORD ?? 'CHANGE_ME_STRONG_PASSWORD',
    },
  },
  trace: 'on',
} satisfies E2EConfig;
```

### `e2e/tests/auth.setup.e2e.ts`
Runs once per target (`desktop` and `phone`) before the main suite, logs in through `#loginOverlay` using `credentials.admin`, verifies `#loginOverlay` is hidden and `#modelSelect` is visible, and saves the authenticated `localStorage` + cookie snapshot as session `'admin'`.

### `e2e/tests/workspace.e2e.ts`
Reuses `{ session: 'admin' }` and executes 4 comprehensive end-to-end tests on both `desktop` and `phone`:

1. **`model selector (21 Vertex AI models), thinking budget, toolsets, and / slash menu`**:
   - Waits for `/api/models` and `/api/sessions` initialization to populate all 21 Vertex AI models.
   - Switches `#modelSelect` between `gemini-3.8-flash-thinking` and `gemini-3.8-flash`.
   - Switches `#thinkingSelect` to `high` (`16K` tokens) and `#toolsetSelect` to `hermes-cli` (`All 19`).
   - Taps `#slashBtn` (`/`), verifies `#slashPopup` renders `/help` and `/doctor`, and executes `/doctor` end-to-end.
2. **`all 9 workspace tabs render and interactive tools execute on /data`**:
   - Navigates through all 9 tabs (`Chat`, `Background Jobs`, `Terminal & Code`, `Skills Hub`, `Memory & SOUL`, `Kanban & Todos`, `Cron Scheduler`, `/data Files`, `Doctor & Stats`).
   - Executes a real bash command (`echo TESTER_ARMY_TERM_OK && pwd`) on the Spot VM via the Terminal tab and asserts stdout in `#termOutput`.
   - Verifies all 60 skills load in the Skills Hub and `SOUL.md` loads in the Memory tab.
3. **`background execution continues when browser restarts/closes (phone off-screen resilience)`**:
   - Verifies `Keep-Alive: ON` is active (`#bgModeBtn`).
   - Dispatches a background prompt instructing Hermes Agent to write a unique timestamp marker (`E2E_BG_<timestamp>`) to `/data/hermes/tester_army_bg.txt` using the `terminal` tool.
   - Immediately reloads the browser mid-execution (`await browser.reload()`) to simulate closing/reopening a mobile tab.
   - Waits for `⚡ Running in Background...` to clear from `#chatMessages` as the server-side job finishes on `/data/hermes`, then opens the `Background Jobs` tab and verifies the job is marked `✅ DONE`.
4. **`agentic UI verification with agent.act and agent.assert`**:
   - Uses AI-driven `await agent.act('open the Doctor & Stats tab')` and `await agent.assert('the screen shows Hermes Doctor diagnostics and Spot VM /data persistence status')`.

---

## 3. Running the Suite & Inspecting Traces

```bash
cd e2e
npm install
E2E_TELEMETRY_DISABLED=1 npx e2e run --reporter list,markdown
```

After every run:
- **Summary Report**: `.e2e/summary.md` contains a Markdown table of all 10 test executions, token usage, and timings.
- **Step-by-Step Traces**: `.e2e/results/<test-slug>/trace.md` contains every step, console warning, DOM mutation diff, and accessibility tree snapshot.
