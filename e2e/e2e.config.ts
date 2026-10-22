import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { createVertex } from '@ai-sdk/google-vertex';

const vertex = createVertex({
  project: process.env.GCP_PROJECT_ID ?? 'your-gcp-project-id',
  location: process.env.GCP_LOCATION ?? 'us-central1',
});

const app = {
  url: process.env.HERMES_WORKER_URL ?? 'https://hermes.example.com',
};

export default {
  tests: 'tests/**/*.e2e.ts',
  targets: [
    {
      name: 'desktop',
      engine: web({ viewport: { width: 1440, height: 900 } }),
      app,
    },
    {
      name: 'phone',
      engine: web({ viewport: { width: 390, height: 844 } }),
      app,
    },
  ],
  agents: {
    default: {
      model: vertex('gemini-2.5-flash'),
      system: 'You are a thorough QA agent testing the Hermes Agent web workspace. Verify every outcome on screen.',
      context:
        'Hermes Agent is a web workspace hosted at https://hermes.example.com. ' +
        'Sign-in requires Email / Username and Password, then clicking "Unlock Hermes Workspace". ' +
        'Once signed in, the workspace has 9 navigation tabs (Chat & Sessions, Background Jobs, Terminal & Code, Skills Hub, Memory & SOUL.md, Kanban & Todos, Cron Scheduler, /data Files, Doctor & Stats), ' +
        'a model dropdown with 21 Google Vertex AI models, a Thinking level dropdown, a Toolset dropdown, a Keep-Alive background toggle, and a "/" button that opens the Slash Command popup menu.',
    },
  },
  credentials: {
    admin: {
      username: process.env.HERMES_AUTH_USER ?? 'admin@example.com',
      password: process.env.HERMES_AUTH_PASSWORD ?? 'CHANGE_ME_STRONG_PASSWORD',
    },
  },
  workers: 1,
  timeout: 120_000,
  actionTimeout: 30_000,
  assertionTimeout: 15_000,
  trace: 'on',
} satisfies E2EConfig;
