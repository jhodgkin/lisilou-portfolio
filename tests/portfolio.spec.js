// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Portfolio site', () => {
  test('loads and shows site name in nav', async ({ page }) => {
    await page.goto('/');
    // #header-logo is the visible nav brand link
    const logo = page.locator('#header-logo, .logo').filter({ visible: true }).first();
    await expect(logo).toBeVisible();
    await expect(logo).toContainText(/.+/); // non-empty
  });

  test('navigation renders with Book a Session button', async ({ page }) => {
    await page.goto('/');
    const bookBtn = page.locator('button:has-text("Book a Session"), a:has-text("Book a Session")').first();
    await expect(bookBtn).toBeVisible();
  });

  test('portfolio section is visible', async ({ page }) => {
    await page.goto('/');
    // Wait for page to load config and render
    await page.waitForLoadState('networkidle');
    const portfolio = page.locator('#portfolio, section#portfolio, [id*="portfolio"]').first();
    await expect(portfolio).toBeAttached();
  });

  test('config/site.json is served', async ({ page }) => {
    const res = await page.request.get('/config/site.json');
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('site');
    expect(json).toHaveProperty('booking');
    expect(json).toHaveProperty('theme');
  });

  test('health endpoint returns ok', async ({ page }) => {
    const res = await page.request.get('/health');
    expect(res.status()).toBe(200);
  });

  test('API health returns {ok:true}', async ({ page }) => {
    const res = await page.request.get('/api/health');
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  test('configured theme is applied (primary color matches site.json)', async ({ page, request }) => {
    const config = await (await request.get('/config/site.json')).json();
    const expected = (config.theme?.primaryColor || '').toLowerCase();
    expect(expected).toMatch(/^#[a-f0-9]{6}$/);

    await page.goto('/');
    // Config is fetched on window load; wait until the var flips from the CSS default
    await page.waitForFunction(
      exp => getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim().toLowerCase() === exp,
      expected,
      { timeout: 8_000 }
    );
  });
});
