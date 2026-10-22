import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

describe('Hermes Agent Web Workspace E2E', { session: 'admin' }, () => {
  test('model selector (21 Vertex AI models), thinking budget, toolsets, and / slash menu', async ({
    app,
    browser,
  }) => {
    await app.open('/');
    await expect(browser.locator('#loginOverlay')).toBeHidden();

    // Wait for /api/models and /api/sessions initialization to settle
    await expect(
      browser.locator('#modelSelect option[value="gemini-4-argon"]'),
    ).toBeAttached({ timeout: 15_000 });
    await expect
      .poll(
        async () => ((await browser.locator('#chatMessages').textContent()) ?? '').trim().length,
        { timeout: 15_000 },
      )
      .toBeGreaterThan(10);
    await expect
      .poll(async () => await browser.locator('#modelSelect option').count(), {
        timeout: 15_000,
      })
      .toBeGreaterThanOrEqual(21);

    // Switch models and thinking budget using actual Vertex AI model IDs
    await browser.locator('#modelSelect').selectOption({ value: 'gemini-3.8-flash-thinking' });
    await expect(browser.locator('#modelSelect')).toHaveValue('gemini-3.8-flash-thinking');

    await browser.locator('#modelSelect').selectOption({ value: 'gemini-3.8-flash' });
    await expect(browser.locator('#modelSelect')).toHaveValue('gemini-3.8-flash');

    await browser.locator('#thinkingSelect').selectOption({ value: 'high' });
    await expect(browser.locator('#thinkingSelect')).toHaveValue('high');

    await browser.locator('#toolsetSelect').selectOption({ value: 'hermes-cli' });
    await expect(browser.locator('#toolsetSelect')).toHaveValue('hermes-cli');

    // Open the "/" Slash Command menu via #slashBtn
    await browser.locator('#slashBtn').tap();
    await expect(browser.locator('#slashPopup')).toBeVisible();
    await expect(browser.locator('#slashPopup')).toContainText('/help');
    await expect(browser.locator('#slashPopup')).toContainText('/doctor');

    // Execute /doctor slash command and verify output appears in chat
    await browser.locator('#chatInput').fill('/doctor');
    await browser.locator('#sendBtn').tap();
    await expect(browser.locator('#chatMessages')).toContainText('Hermes Doctor', {
      timeout: 25_000,
    });
  });

  test('all 9 workspace tabs render and interactive tools execute on /data', async ({
    app,
    screen,
    browser,
  }) => {
    await app.open('/');
    await expect(browser.locator('#loginOverlay')).toBeHidden();

    // 1. Background Jobs tab
    await browser.locator('#tabBtn-jobs').tap();
    await expect(browser.locator('#tab-jobs')).toBeVisible();

    // 2. Terminal & Code tab - run real command on Spot VM /data/hermes
    await browser.locator('#tabBtn-terminal').tap();
    await expect(browser.locator('#tab-terminal')).toBeVisible();
    await browser.locator('#termCmdInput').fill('echo TESTER_ARMY_TERM_OK && pwd');
    await browser.locator('#tab-terminal button[type="submit"]').tap();
    await expect(browser.locator('#termOutput')).toContainText('TESTER_ARMY_TERM_OK', {
      timeout: 20_000,
    });

    // 3. Skills Hub tab (60 skills)
    await browser.locator('#tabBtn-skills').tap();
    await expect(browser.locator('#tab-skills')).toBeVisible();
    await expect(screen.getByRole('heading', 'Hermes Skills Hub')).toBeVisible();
    await expect(screen.getByText('hermes-agent')).toBeVisible({ timeout: 15_000 });

    // 4. Memory & SOUL tab
    await browser.locator('#tabBtn-memory').tap();
    await expect(browser.locator('#tab-memory')).toBeVisible();
    await expect(browser.locator('#soulMdInput')).toBeVisible();

    // 5. Kanban & Todos tab
    await browser.locator('#tabBtn-kanban').tap();
    await expect(browser.locator('#tab-kanban')).toBeVisible();

    // 6. Cron Scheduler tab
    await browser.locator('#tabBtn-cron').tap();
    await expect(browser.locator('#tab-cron')).toBeVisible();

    // 7. /data Files Explorer tab
    await browser.locator('#tabBtn-files').tap();
    await expect(browser.locator('#tab-files')).toBeVisible();

    // 8. Doctor & Stats tab
    await browser.locator('#tabBtn-system').tap();
    await expect(browser.locator('#tab-system')).toBeVisible();
    await expect(screen.getByRole('heading', '🩺 Hermes Doctor & CLI Diagnostics')).toBeVisible();
    await expect(screen.getByText('Spot VM /data Persistence')).toBeVisible();

    // 9. Return to Chat tab
    await browser.locator('#tabBtn-chat').tap();
    await expect(browser.locator('#tab-chat')).toBeVisible();
  });

  test('background execution continues when browser restarts/closes (phone off-screen resilience)', async ({
    app,
    browser,
  }) => {
    await app.open('/');
    await expect(browser.locator('#loginOverlay')).toBeHidden();
    await expect(
      browser.locator('#modelSelect option[value="gemini-4-argon"]'),
    ).toBeAttached({ timeout: 15_000 });
    await expect
      .poll(
        async () => ((await browser.locator('#chatMessages').textContent()) ?? '').trim().length,
        { timeout: 15_000 },
      )
      .toBeGreaterThan(10);
    await expect(browser.locator('#bgModeBtn')).toContainText('Keep-Alive: ON');

    // Select fast Gemini 2.5 Flash for quick background tool execution
    await browser.locator('#modelSelect').selectOption({ value: 'gemini-2.5-flash' });

    const marker = `E2E_BG_${Date.now()}`;
    await browser
      .locator('#chatInput')
      .fill(
        `Use the terminal tool to write "${marker}" into /data/hermes/tester_army_bg.txt and confirm when saved.`,
      );
    await browser.locator('#sendBtn').tap();

    // Wait for the POST /api/chat dispatch to register in the session before reloading
    await expect(browser.locator('#chatMessages')).toContainText(marker, {
      timeout: 15_000,
    });

    // Reload the browser mid-execution (simulating closing/reopening the phone browser tab)
    await browser.reload();
    await expect(browser.locator('#loginOverlay')).toBeHidden();

    // Ensure session history loaded after reload, then wait for background execution to finish
    await expect(browser.locator('#chatMessages')).toContainText(marker, {
      timeout: 20_000,
    });
    await expect(browser.locator('#chatMessages')).not.toContainText('⚡ Running in Background...', {
      timeout: 60_000,
    });

    // Check Background Jobs tab shows our job and ✅ DONE status (with live 2.2s auto-refresh)
    await browser.locator('#tabBtn-jobs').tap();
    await expect(browser.locator('#jobsListContainer')).toContainText(marker, {
      timeout: 30_000,
    });
    await expect(browser.locator('#jobsListContainer')).not.toContainText('⚡ RUNNING', {
      timeout: 60_000,
    });
    await expect(browser.locator('#jobsListContainer')).toContainText('✅ DONE', {
      timeout: 30_000,
    });
  });

  test('agentic UI verification with agent.act and agent.assert', async ({
    app,
    agent,
    browser,
  }) => {
    await app.open('/');
    await expect(browser.locator('#loginOverlay')).toBeHidden();

    await agent.act('open the Doctor & Stats tab');
    await expect(browser.locator('#tab-system')).toBeVisible();

    await agent.assert(
      'the screen shows Hermes Doctor diagnostics and Spot VM /data persistence status',
    );
  });
});
