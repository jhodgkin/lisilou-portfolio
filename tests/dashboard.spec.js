// @ts-check
const { test, expect } = require('@playwright/test');

const ADMIN_SECRET = process.env.ADMIN_SECRET || '9yPuNfYjy5kisRKrowhmH42PTeEgH';

test.describe('Admin dashboard — auth', () => {
  test('loads the login screen at /dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('#login-screen')).toBeVisible();
    await expect(page.locator('#login-screen')).toContainText(/Admin/i);
  });

  test('wrong passphrase shows error message', async ({ page }) => {
    await page.goto('/dashboard');
    await page.locator('#login-input').fill('wrongpassphrase');
    await page.locator('button:has-text("Sign In")').click();
    await expect(page.locator('#login-error')).toBeVisible({ timeout: 6_000 });
  });

  test('correct passphrase shows the app', async ({ page }) => {
    await page.goto('/dashboard');
    await page.locator('#login-input').fill(ADMIN_SECRET);
    await page.locator('button:has-text("Sign In")').click();
    await expect(page.locator('#app')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('#login-screen')).not.toBeVisible();
  });

  test('Enter key submits login form', async ({ page }) => {
    await page.goto('/dashboard');
    await page.locator('#login-input').fill(ADMIN_SECRET);
    await page.locator('#login-input').press('Enter');
    await expect(page.locator('#app')).toBeVisible({ timeout: 8_000 });
  });

  test('Sign Out returns to login screen', async ({ page }) => {
    await page.goto('/dashboard');
    await page.locator('#login-input').fill(ADMIN_SECRET);
    await page.locator('button:has-text("Sign In")').click();
    await expect(page.locator('#app')).toBeVisible({ timeout: 8_000 });
    await page.locator('button:has-text("Sign Out")').click();
    await expect(page.locator('#login-screen')).toBeVisible();
  });
});

test.describe('Admin dashboard — panels', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard');
    await page.locator('#login-input').fill(ADMIN_SECRET);
    await page.locator('button:has-text("Sign In")').click();
    await expect(page.locator('#app')).toBeVisible({ timeout: 8_000 });
  });

  test('Overview panel shows stat cards', async ({ page }) => {
    await expect(page.locator('.stat-card')).toHaveCount(4);
    // At least one stat value should be rendered (not just —)
    const values = page.locator('.stat-card .value');
    await expect(values.first()).toBeVisible();
  });

  test('Overview shows next upcoming sessions list', async ({ page }) => {
    const list = page.locator('#next-up-list');
    await expect(list).toBeVisible();
    // Should load (not show loading spinner indefinitely)
    await expect(list.locator('.loading')).not.toBeVisible({ timeout: 8_000 });
  });

  test('Calendar panel renders a month grid', async ({ page }) => {
    await page.locator('#nav-calendar').click();
    await expect(page.locator('#panel-calendar')).toBeVisible();
    await expect(page.locator('#cal-month-label')).toBeVisible();
    // Grid should have at least 28 day cells + 7 header cells
    const days = page.locator('.cal-day');
    const count = await days.count();
    expect(count).toBeGreaterThanOrEqual(28);
  });

  test('Calendar prev/next navigation changes month', async ({ page }) => {
    await page.locator('#nav-calendar').click();
    const labelBefore = await page.locator('#cal-month-label').textContent();
    await page.locator('button:has-text("Next")').click();
    const labelAfter = await page.locator('#cal-month-label').textContent();
    expect(labelAfter).not.toBe(labelBefore);
  });

  test('Bookings panel renders table with results', async ({ page }) => {
    await page.locator('#nav-bookings').click();
    await expect(page.locator('#panel-bookings')).toBeVisible();
    // Table or empty state should appear
    const wrap = page.locator('#bookings-table-wrap');
    await expect(wrap).not.toBeEmpty({ timeout: 8_000 });
  });

  test('Bookings panel search filter narrows results', async ({ page }) => {
    await page.locator('#nav-bookings').click();
    await page.locator('#b-search').fill('Smoke Test');
    await page.waitForTimeout(500); // debounce
    const wrap = page.locator('#bookings-table-wrap');
    await expect(wrap).not.toBeEmpty({ timeout: 6_000 });
    // All visible names should include Smoke Test (or empty state)
    const cells = page.locator('table tbody td strong');
    const count = await cells.count();
    for (let i = 0; i < count; i++) {
      const text = await cells.nth(i).textContent();
      expect(text).toContain('Smoke Test');
    }
  });

  test('Bookings panel clear filter button works', async ({ page }) => {
    await page.locator('#nav-bookings').click();
    await page.locator('#b-search').fill('xyz-nobody');
    await page.waitForTimeout(400);
    await page.locator('button:has-text("Clear")').click();
    await expect(page.locator('#b-search')).toHaveValue('');
    await expect(page.locator('#bookings-table-wrap')).not.toBeEmpty({ timeout: 6_000 });
  });

  test('Expanding a booking row shows client and payment details', async ({ page }) => {
    await page.locator('#nav-bookings').click();
    const firstRow = page.locator('table tbody tr.expandable').first();
    await expect(firstRow).toBeVisible({ timeout: 8_000 });
    await firstRow.click();
    // Expand row with detail should appear
    const expandRow = page.locator('.expand-row').first();
    await expect(expandRow).toBeVisible({ timeout: 5_000 });
    await expect(expandRow).toContainText(/Client|Payment|Session/i);
  });

  test('Payments panel shows revenue summary', async ({ page }) => {
    await page.locator('#nav-payments').click();
    await expect(page.locator('#panel-payments')).toBeVisible();
    await expect(page.locator('#revenue-summary')).not.toBeEmpty({ timeout: 8_000 });
    await expect(page.locator('.revenue-card')).toHaveCount(3);
  });

  test('Payments panel CSV export triggers download', async ({ page }) => {
    await page.locator('#nav-payments').click();

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 10_000 }),
      page.locator('button:has-text("Export CSV")').click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/lisilou-bookings.*\.csv/);
  });
});
