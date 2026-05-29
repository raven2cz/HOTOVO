import { test, expect } from '@playwright/test';

test.describe('Aether Todo E2E Flow', () => {

  test.beforeEach(async ({ page }) => {
    // Capture page console logs and runtime exceptions for easy debugging
    page.on('console', msg => console.log(`BROWSER CONSOLE LOG [${msg.type()}]:`, msg.text()));
    page.on('pageerror', exception => console.error('BROWSER RUNTIME EXCEPTION:', exception.message));
    
    // Explicitly set a wide desktop screen size to guarantee sidebar visibility (avoids tailwind md hiding)
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('should load the app and display default workspaces', async ({ page }) => {
    await page.goto('/');
    
    // Check main branding header
    const brand = page.locator('span:has-text("Aether Todo")');
    await expect(brand).toBeVisible();

    // Check if default projects are listed in sidebar
    await expect(page.locator('aside span:has-text("Nakup a prodej domu")').first()).toBeVisible();
    await expect(page.locator('aside span:has-text("Prace")').first()).toBeVisible();
    await expect(page.locator('aside span:has-text("Open-Source")').first()).toBeVisible();
  });

  test('should create a new task and toggle its state', async ({ page }) => {
    await page.goto('/');
    
    // Select first project workspace
    await page.locator('aside span:has-text("Nakup a prodej domu")').first().click();

    // Create a new task
    const taskInput = page.locator('input[placeholder="Naplánujte nový úkol..."]');
    await taskInput.fill('E2E Testovací úkol');
    await page.click('button:has-text("Přidat")');

    // Find the task node row specifically
    const taskRow = page.locator('[id^="task-node-"]', { hasText: 'E2E Testovací úkol' }).first();
    await expect(taskRow).toBeVisible();

    // Toggle Checkbox via click (controlled component with async API sync)
    const checkbox = taskRow.locator('input[type="checkbox"]');
    await checkbox.click();

    // Verify task is completed (strikethrough styling class on title span)
    const titleSpan = taskRow.locator('span').first();
    await expect(titleSpan).toHaveClass(/line-through/);
  });

  test('should open command palette on Ctrl+K shortcut', async ({ page }) => {
    await page.goto('/');
    
    // Press Ctrl+K
    await page.keyboard.press('Control+KeyK');

    // Check if command palette search box appeared
    const searchInput = page.locator('input[placeholder*="Hledejte úkoly, projekty"]');
    await expect(searchInput).toBeVisible();

    // Press Escape to close it
    await page.keyboard.press('Escape');
    
    // Check it's not visible
    await expect(searchInput).not.toBeVisible();
  });

  test('should open settings and switch tabs', async ({ page }) => {
    await page.goto('/');

    // Click on Settings in the bottom-left sidebar
    await page.click('button:has-text("Nastavení & Integrace")');

    // Check if modal title is present
    await expect(page.locator('h2:has-text("Nastavení Systému")')).toBeVisible();

    // Verify default tab content (Google calendar settings inputs)
    await expect(page.locator('label:has-text("Google Client ID")')).toBeVisible();

    // Switch to Export tab
    await page.click('button:has-text("Export Dat")');

    // Check if download buttons are visible
    await expect(page.locator('h4:has-text("Formát JSON")')).toBeVisible();
    await expect(page.locator('h4:has-text("Formát Markdown")')).toBeVisible();
    await expect(page.locator('h4:has-text("Formát CSV")')).toBeVisible();
  });

  test('should navigate from calendar task click to list view and open drawer', async ({ page }) => {
    await page.goto('/');

    // 1. Create a task with a date first so it is visible in the Calendar
    await page.locator('aside span:has-text("Nakup a prodej domu")').first().click();
    const taskInput = page.locator('input[placeholder="Naplánujte nový úkol..."]');
    await taskInput.fill('Kalendářový úkol');
    
    // Set due date to today
    const todayStr = new Date().toISOString().split('T')[0];
    const dateInput = page.locator('input[type="date"]');
    await dateInput.fill(todayStr);

    await page.click('button:has-text("Přidat")');
    
    // Verify task created
    await expect(page.locator('[id^="task-node-"]', { hasText: 'Kalendářový úkol' }).first()).toBeVisible();

    // 2. Switch to Calendar View
    await page.click('button:has-text("Kalendář")');
    
    // 3. Click the task node inside the calendar grid cell
    const taskInCalendar = page.locator('div[title*="Kalendářový úkol"]').first();
    await expect(taskInCalendar).toBeVisible();
    await taskInCalendar.click();

    // 4. Verify view mode switches back to list and task drawer opens
    const drawerTitle = page.locator('h3:has-text("Upravit detaily úkolu")');
    await expect(drawerTitle).toBeVisible();
    
    // Input for task title inside drawer should have the task title
    const drawerInput = page.locator('input[value="Kalendářový úkol"]');
    await expect(drawerInput).toBeVisible();
  });

  test('should dynamically calculate productivity score based on task completions', async ({ page }) => {
    await page.goto('/');

    // 1. Select the empty seeded project "Prace"
    await page.locator('aside span:has-text("Prace")').first().click();

    // 2. Add a task to this empty list
    const taskInput = page.locator('input[placeholder="Naplánujte nový úkol..."]');
    await taskInput.fill('Dlouhý úkol');
    await page.click('button:has-text("Přidat")');

    // 3. Verify task is created and productivity is 0% ("Ještě nezačato 💤")
    const taskRow = page.locator('[id^="task-node-"]', { hasText: 'Dlouhý úkol' }).first();
    await expect(taskRow).toBeVisible();
    await expect(page.locator('span:has-text("Ještě nezačato 💤")')).toBeVisible();

    // 4. Click the checkbox
    const checkbox = taskRow.locator('input[type="checkbox"]');
    await checkbox.click();

    // 5. Verify productivity changes to 100% ("Vše splněno! 🎉")
    await expect(page.locator('span:has-text("Vše splněno! 🎉")')).toBeVisible();
  });

  test('should propagate status cascadingly and render subtask progress badges', async ({ page }) => {
    await page.goto('/');

    // 1. Select "Prace" project
    await page.locator('aside span:has-text("Prace")').first().click();

    // 2. Add parent task
    const taskInput = page.locator('input[placeholder="Naplánujte nový úkol..."]');
    await taskInput.fill('E2E Cascading Task');
    await page.click('button:has-text("Přidat")');

    // 3. Find parent task row
    const parentRow = page.locator('[id^="task-node-"]', { hasText: 'E2E Cascading Task' }).first();
    await expect(parentRow).toBeVisible();

    // 4. Click "Přidat podúkol" button on the parent task row
    const addSubtaskBtn = parentRow.locator('button[title="Přidat podúkol"]');
    await addSubtaskBtn.click();

    // 5. Fill and submit subtask A
    const subtaskInput = page.locator('input[placeholder="Název podúkolu..."]');
    await subtaskInput.fill('E2E Subtask A');
    await subtaskInput.press('Enter');

    // 6. Click "Přidat podúkol" button again to add subtask B
    await addSubtaskBtn.click();
    await subtaskInput.fill('E2E Subtask B');
    await subtaskInput.press('Enter');

    // 7. Verify subtask progress badge is visible on the parent task row showing 0/2 podúkolů (0%)
    const badge = parentRow.locator('[data-testid="subtask-progress"]');
    await expect(badge).toHaveText('0/2 podúkolů (0%)');

    // 8. Find subtask A row and check it (target the checkbox by its accessible name)
    const subtaskARow = page.locator('[id^="task-node-"]', { hasText: 'E2E Subtask A' }).first();
    await expect(subtaskARow).toBeVisible();
    await page.getByRole('checkbox', { name: /E2E Subtask A/ }).click();

    // 9. Verify subtask progress badge updates to 1/2 podúkolů (50%)
    await expect(parentRow.locator('[data-testid="subtask-progress"]')).toHaveText('1/2 podúkolů (50%)');

    // 10. Check parent task
    await page.getByRole('checkbox', { name: /E2E Cascading Task/ }).click();

    // 11. Verify parent task and all subtasks are completed (strike-through)
    await expect(parentRow.locator('span').first()).toHaveClass(/line-through/);
    await expect(subtaskARow.locator('span').first()).toHaveClass(/line-through/);
    
    const subtaskBRow = page.locator('[id^="task-node-"]', { hasText: 'E2E Subtask B' }).first();
    await expect(subtaskBRow.locator('span').first()).toHaveClass(/line-through/);

    // 12. Verify badge is updated to 2/2 (100%)
    await expect(parentRow.locator('[data-testid="subtask-progress"]')).toHaveText('2/2 podúkolů (100%)');
  });
});
