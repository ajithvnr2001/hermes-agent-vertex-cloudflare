import { test } from '@e2e-dev/web';
import { expect, credentials } from 'e2e';

test.setup(
  'authenticate as admin',
  { sessions: ['admin'] },
  async ({ app, screen, session, browser }) => {
    const admin = credentials.user('admin');

    await app.open('/');
    await expect(browser.locator('#loginOverlay')).toBeVisible();

    await screen.getByPlaceholder('admin@example.com').fill(admin.username);
    await screen.getByPlaceholder('Enter owner password').fill(admin.password);
    await screen.getByRole('button', 'Unlock Hermes Workspace').tap();

    await expect(browser.locator('#loginOverlay')).toBeHidden({ timeout: 15_000 });
    await expect(screen.getByText('Hermes Agent')).toBeVisible();

    await session.save('admin');
  },
);
