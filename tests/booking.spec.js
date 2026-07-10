// @ts-check
const { test, expect } = require('@playwright/test');

// Helper: get a date 60 days from now in YYYY-MM-DD
function futureDate(daysAhead = 60) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

// Helper: open booking modal and pick a date via the calendar UI.
// #session-date is now a hidden input set by dpSelectDate(); we use evaluate
// to set it directly (simulating a calendar day click) so tests stay fast.
async function openAndPickDate(page, daysAhead = 60) {
  await page.locator('button:has-text("Book a Session")').first().click();
  await page.locator('#booking-overlay').waitFor({ state: 'visible' });
  const date = futureDate(daysAhead);
  // Wait for calendar to render, then click the matching day cell
  await page.locator('#dp-grid').waitFor({ state: 'visible' });
  // Try clicking the rendered day cell; fall back to JS if not visible yet
  const dayCell = page.locator(`#dp-grid .dp-day[aria-label="${date}"]`);
  if (await dayCell.isVisible().catch(() => false)) {
    await dayCell.click();
  } else {
    // Navigate to the correct month if needed, then set via JS
    await page.evaluate(d => {
      document.getElementById('session-date').value = d;
      window._dpState && (window._dpState.selectedDate = d);
    }, date);
  }
}

test.describe('Booking wizard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('opens when Book a Session is clicked', async ({ page }) => {
    await page.locator('button:has-text("Book a Session")').first().click();
    await expect(page.locator('#booking-overlay')).toBeVisible();
  });

  test('shows step 1 (Date) on open', async ({ page }) => {
    await page.locator('button:has-text("Book a Session")').first().click();
    await expect(page.locator('#step-1')).toBeVisible();
    await expect(page.locator('[data-step="1"]')).toHaveClass(/active/);
  });

  test('close button dismisses the modal', async ({ page }) => {
    await page.locator('button:has-text("Book a Session")').first().click();
    await expect(page.locator('#booking-overlay')).toBeVisible();
    await page.locator('#booking-close').click();
    await expect(page.locator('#booking-overlay')).not.toBeVisible();
  });

  test('calendar renders month grid with day cells', async ({ page }) => {
    await page.locator('button:has-text("Book a Session")').first().click();
    await page.locator('#dp-grid').waitFor({ state: 'visible' });
    await expect(page.locator('#dp-month-label')).toBeVisible();
    // At least 28 day cells should render
    const days = page.locator('#dp-grid .dp-day');
    await expect(days.first()).toBeVisible({ timeout: 8_000 });
    expect(await days.count()).toBeGreaterThanOrEqual(28);
  });

  test('calendar prev/next navigation changes month', async ({ page }) => {
    await page.locator('button:has-text("Book a Session")').first().click();
    await page.locator('#dp-grid').waitFor({ state: 'visible' });
    const labelBefore = await page.locator('#dp-month-label').textContent();
    await page.locator('#dp-next').click();
    const labelAfter = await page.locator('#dp-month-label').textContent();
    expect(labelAfter).not.toBe(labelBefore);
  });

  test('clicking a future date selects it and shows status', async ({ page }) => {
    await page.locator('button:has-text("Book a Session")').first().click();
    await page.locator('#dp-grid').waitFor({ state: 'visible' });
    // Find first non-disabled available day
    const availableDay = page.locator('#dp-grid .dp-day:not(.dp-day--disabled):not(.dp-day--other):not(.dp-day--past):not(.dp-day--busy)').first();
    await expect(availableDay).toBeVisible({ timeout: 8_000 });
    await availableDay.click();
    await expect(availableDay).toHaveClass(/dp-day--selected/);
    await expect(page.locator('#dp-status')).toContainText(/Selected:/);
  });

  test('past dates are not selectable', async ({ page }) => {
    await page.locator('button:has-text("Book a Session")').first().click();
    await page.locator('#dp-grid').waitFor({ state: 'visible' });
    const pastDay = page.locator('#dp-grid .dp-day--past').first();
    if (await pastDay.count() > 0) {
      const before = await page.locator('#dp-status').textContent();
      await pastDay.click();
      await expect(page.locator('#dp-status')).toHaveText(before ?? '');
    }
  });

  test('step 1 requires a date to advance', async ({ page }) => {
    await page.locator('button:has-text("Book a Session")').first().click();
    // Click Next without a date — should stay on step 1
    await page.locator('#btn-next').click();
    await expect(page.locator('#step-1')).toBeVisible();
    await expect(page.locator('#step-2')).not.toBeVisible();
  });

  test('step 2 renders session type cards from config', async ({ page }) => {
    await openAndPickDate(page);
    await page.locator('#btn-next').click();
    await expect(page.locator('#step-2')).toBeVisible();
    const cards = page.locator('#session-type-options .option-card');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThan(0);
  });

  test('selecting a session type card marks it selected', async ({ page }) => {
    await openAndPickDate(page);
    await page.locator('#btn-next').click();
    const firstCard = page.locator('#session-type-options .option-card').first();
    await firstCard.click();
    await expect(firstCard).toHaveClass(/selected/);
  });

  test('step 3 shows mini and full length cards with prices', async ({ page }) => {
    await openAndPickDate(page);
    await page.locator('#btn-next').click();
    await page.locator('#session-type-options .option-card').first().click();
    await page.locator('#btn-next').click();
    await expect(page.locator('#step-3')).toBeVisible();
    await expect(page.locator('.length-card[data-value="mini"]')).toBeVisible();
    await expect(page.locator('.length-card[data-value="full"]')).toBeVisible();
    await expect(page.locator('.length-card[data-value="mini"] .length-card-price')).toContainText('$');
    await expect(page.locator('.length-card[data-value="full"] .length-card-price')).toContainText('$');
  });

  test('step 4 shows location cards', async ({ page }) => {
    await openAndPickDate(page);
    await page.locator('#btn-next').click();
    await page.locator('#session-type-options .option-card').first().click();
    await page.locator('#btn-next').click();
    await page.locator('.length-card[data-value="mini"]').click();
    await page.locator('#btn-next').click();
    await expect(page.locator('#step-4')).toBeVisible();
    const locationCards = page.locator('.location-card');
    await expect(locationCards.first()).toBeVisible();
    expect(await locationCards.count()).toBeGreaterThan(0);
  });

  test('clicking a location card selects it and opens detail panel', async ({ page }) => {
    await openAndPickDate(page);
    await page.locator('#btn-next').click();
    await page.locator('#session-type-options .option-card').first().click();
    await page.locator('#btn-next').click();
    await page.locator('.length-card[data-value="mini"]').click();
    await page.locator('#btn-next').click();
    const firstLocation = page.locator('.location-card').first();
    await firstLocation.click();
    await expect(firstLocation).toHaveClass(/selected/);
    await expect(page.locator('.location-detail.open').first()).toBeVisible();
  });

  test('step 5 renders name, email, phone inputs', async ({ page }) => {
    await openAndPickDate(page);
    await page.locator('#btn-next').click();
    await page.locator('#session-type-options .option-card').first().click();
    await page.locator('#btn-next').click();
    await page.locator('.length-card[data-value="mini"]').click();
    await page.locator('#btn-next').click();
    await page.locator('.location-card').first().click();
    await page.locator('#btn-next').click();
    await expect(page.locator('#step-5')).toBeVisible();
    await expect(page.locator('#client-name').first()).toBeVisible();
    await expect(page.locator('#client-email').first()).toBeVisible();
    await expect(page.locator('#client-phone').first()).toBeVisible();
  });

  test('step 5 blocks advance when name/email are empty', async ({ page }) => {
    await openAndPickDate(page);
    await page.locator('#btn-next').click();
    await page.locator('#session-type-options .option-card').first().click();
    await page.locator('#btn-next').click();
    await page.locator('.length-card[data-value="mini"]').click();
    await page.locator('#btn-next').click();
    await page.locator('.location-card').first().click();
    await page.locator('#btn-next').click();
    // Try advancing with empty fields
    await page.locator('#btn-next').click();
    await expect(page.locator('#step-5')).toBeVisible();
    await expect(page.locator('#step-6')).not.toBeVisible();
  });

  test('full wizard flow submits and shows success screen', async ({ page }) => {
    const uniqueEmail = `playwright-${Date.now()}@test.lisilou`;

    await openAndPickDate(page, 65);

    // Step 1 → 2
    await page.locator('#btn-next').click();
    await expect(page.locator('#step-2')).toBeVisible();

    // Step 2: pick first session type
    await page.locator('#session-type-options .option-card').first().click();
    await page.locator('#btn-next').click();
    await expect(page.locator('#step-3')).toBeVisible();

    // Step 3: mini
    await page.locator('.length-card[data-value="mini"]').click();
    await page.locator('#btn-next').click();
    await expect(page.locator('#step-4')).toBeVisible();

    // Step 4: first location
    await page.locator('.location-card').first().click();
    await page.locator('#btn-next').click();
    await expect(page.locator('#step-5')).toBeVisible();

    // Step 5: client info
    await page.locator('#client-name').first().fill('Playwright Test');
    await page.locator('#client-email').first().fill(uniqueEmail);
    await page.locator('#client-phone').first().fill('555-000-0001');
    await page.locator('#btn-next').click();
    await expect(page.locator('#step-6')).toBeVisible();

    // Step 6: contract
    await expect(page.locator('#step-6')).toBeVisible();
    // Wait for the async initContractStep to finish loading
    await expect(page.locator('#contract-loading')).not.toBeAttached({ timeout: 8_000 });
    // Scroll only the contract-viewer element (not the modal) to bottom via JS,
    // then dispatch scroll so the event listener fires and sets contractScrolled = true
    await page.locator('#contract-viewer').evaluate(el => {
      el.scrollTop = el.scrollHeight;
      el.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(200);
    await expect(page.locator('#sig-section')).not.toHaveClass(/locked/, { timeout: 5_000 });
    // Scroll the canvas into view, then draw a signature
    await page.locator('#sig-canvas').scrollIntoViewIfNeeded();
    const sigCanvas = page.locator('#sig-canvas');
    const box = await sigCanvas.boundingBox();
    if (box && box.width > 0) {
      await page.mouse.move(box.x + 20, box.y + box.height / 2);
      await page.mouse.down();
      for (let x = 30; x < box.width - 20; x += 8) {
        await page.mouse.move(box.x + x, box.y + box.height / 2);
      }
      await page.mouse.up();
    }
    // Type full name
    await page.locator('#contract-name').fill('Playwright Test');
    // scrollIntoViewIfNeeded doesn't work reliably inside a fixed-position modal;
    // use JS click to bypass viewport coordinate checks while still firing the click handler
    await page.evaluate(() => document.getElementById('btn-next').click());

    // Step 7: payment
    await expect(page.locator('#step-7')).toBeVisible();
    await page.locator('#payment-sent').check();
    await page.locator('#btn-next').click();

    // Success
    await expect(page.locator('#step-success')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#step-success')).toContainText(/thank|confirm|success|session/i);
  });
});
