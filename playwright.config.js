import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e-tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker to avoid SQLite database lock issues
  reporter: 'list',
  use: {
    // E2E běží na vyhrazeném portu 3100, NIKDY ne na produkčním 3000.
    baseURL: 'http://127.0.0.1:3100',
    trace: 'on-first-retry',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Vždy spustíme VLASTNÍ server v test režimu na izolovaném portu.
    // NODE_ENV=test -> server/db.js použije todo-test.db (nikdy todo.db).
    // PORT=3100 -> nekoliduje s případně běžícím produkčním serverem na 3000.
    // reuseExistingServer: false -> Playwright NIKDY nepřevezme cizí (produkční) server.
    command: 'NODE_ENV=test PORT=3100 npm start',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
