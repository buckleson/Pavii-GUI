/**
 * E2E: Team rename + pin/unpin via sidebar context menu.
 */
import { test, expect } from '../../fixtures';
import { cleanupTeamsByName, createTeam } from '../../helpers';

// Kebab (three-dot) menu trigger button
const MENU_TRIGGER = '[data-testid="sider-item-menu-trigger"]';

/**
 * Find the given team in the sidebar, hover it, open the three-dot menu, and click the named item.
 */
async function clickTeamMenuItem(
  page: import('@playwright/test').Page,
  teamName: string,
  menuKey: string
): Promise<void> {
  // The SiderItem row that contains the team name
  const row = page.locator('.group').filter({ hasText: teamName }).first();
  await expect(row).toBeVisible({ timeout: 10_000 });

  // Hovering reveals the three-dot menu
  await row.hover();
  const trigger = row.locator(MENU_TRIGGER);
  await expect(trigger).toBeVisible({ timeout: 3_000 });
  await trigger.click();

  // Wait for the dropdown to open, then click the menu item matching the key by text
  const item = page
    .locator('.arco-dropdown-menu-item')
    .or(page.locator('.arco-menu-item'))
    .filter({ hasText: new RegExp(menuKey, 'i') })
    .first();
  await expect(item).toBeVisible({ timeout: 3_000 });
  await item.click();
}

/**
 * Collect every team name in the sidebar list, in display order.
 */
async function getSidebarTeamNames(page: import('@playwright/test').Page): Promise<string[]> {
  // Wait for the Teams section to load
  const section = page.locator('text=Teams');
  await expect(section.first()).toBeVisible({ timeout: 10_000 });

  // The name text inside each SiderItem row
  const items = page.locator('.group .text-ellipsis span');
  const count = await items.count();
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const text = await items.nth(i).textContent();
    if (text?.trim()) names.push(text.trim());
  }
  return names;
}

test.describe('Team Rename & Pin', () => {
  const RENAME_ORIG = 'E2E-Rename-Orig';
  const RENAME_NEW = 'E2E-Rename-New';
  const PIN_A = 'E2E-Pin-A';
  const PIN_B = 'E2E-Pin-B';

  // Clear any teams left behind by a previous run before each test
  test.beforeEach(async ({ page }) => {
    for (const name of [RENAME_ORIG, RENAME_NEW, PIN_A, PIN_B]) {
      await cleanupTeamsByName(page, name);
    }
  });

  test.afterEach(async ({ page }) => {
    for (const name of [RENAME_ORIG, RENAME_NEW, PIN_A, PIN_B]) {
      await cleanupTeamsByName(page, name);
    }
  });

  test('rename team', async ({ page }) => {
    // 1. Create the team through the UI
    await createTeam(page, RENAME_ORIG);

    // 2. Sidebar -> hover -> three-dot menu -> rename
    await clickTeamMenuItem(page, RENAME_ORIG, 'rename');

    // 3. The rename modal opens: clear the input and type the new name
    const modal = page.locator('.arco-modal').last();
    await expect(modal).toBeVisible({ timeout: 5_000 });
    const input = modal.locator('[data-testid="team-create-name-input"]');
    await input.clear();
    await input.fill(RENAME_NEW);

    // 4. Confirm
    const okBtn = modal.locator('.arco-btn-primary');
    await expect(okBtn).toBeEnabled({ timeout: 3_000 });
    await okBtn.click();

    // Wait for the modal to close
    await expect(modal).toBeHidden({ timeout: 5_000 });

    // 5. The sidebar should show the new name and no longer show the old one
    const newName = page.locator('.group').filter({ hasText: RENAME_NEW });
    await expect(newName.first()).toBeVisible({ timeout: 10_000 });
    const oldName = page.locator('.group').filter({ hasText: RENAME_ORIG });
    await expect(oldName).toHaveCount(0, { timeout: 5_000 });
  });

  test('pin/unpin team changes ordering', async ({ page }) => {
    // 1. Create two teams; A is created first so it sorts ahead of B
    await createTeam(page, PIN_A);
    // Return to the home route so the second creation is not blocked
    await page.goto(page.url().replace(/#.*/, '#/'), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1_000);
    await createTeam(page, PIN_B);

    // Return to the home route so the sidebar renders in full
    await page.goto(page.url().replace(/#.*/, '#/'), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1_000);

    // Confirm the initial order: A before B
    let names = await getSidebarTeamNames(page);
    const idxA1 = names.indexOf(PIN_A);
    const idxB1 = names.indexOf(PIN_B);
    expect(idxA1).toBeGreaterThanOrEqual(0);
    expect(idxB1).toBeGreaterThanOrEqual(0);
    expect(idxA1).toBeLessThan(idxB1);

    // 2. Pin B -> B should move ahead of A
    await clickTeamMenuItem(page, PIN_B, 'pin');
    await page.waitForTimeout(500);

    names = await getSidebarTeamNames(page);
    const idxA2 = names.indexOf(PIN_A);
    const idxB2 = names.indexOf(PIN_B);
    expect(idxB2).toBeLessThan(idxA2);

    // 3. Unpin B -> the original order is restored
    await clickTeamMenuItem(page, PIN_B, 'pin');
    await page.waitForTimeout(500);

    names = await getSidebarTeamNames(page);
    const idxA3 = names.indexOf(PIN_A);
    const idxB3 = names.indexOf(PIN_B);
    expect(idxA3).toBeLessThan(idxB3);
  });
});
