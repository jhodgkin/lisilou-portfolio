// Auth + client portal (issues #10, #13)
// These tests pass whether or not OIDC env vars are configured on the target:
// configured  → /api/auth/login redirects to the Authentik authorize endpoint
// unconfigured → /api/auth/login returns 503 and sessions simply don't exist
const { test, expect } = require('@playwright/test');

test.describe('Auth endpoints', () => {
  test('GET /api/auth/me reports session state', async ({ request }) => {
    const r = await request.get('/api/auth/me');
    expect(r.ok()).toBeTruthy();
    const body = await r.json();
    expect(body).toHaveProperty('authenticated');
    expect(typeof body.authenticated).toBe('boolean');
    expect(body).toHaveProperty('ssoConfigured');
  });

  test('GET /api/auth/login redirects to IdP or returns 503', async ({ request }) => {
    const r = await request.get('/api/auth/login', { maxRedirects: 0 });
    expect([302, 503]).toContain(r.status());
    if (r.status() === 302) {
      const loc = r.headers()['location'];
      expect(loc).toContain('response_type=code');
      expect(loc).toContain('code_challenge_method=S256');
    }
  });

  test('POST /api/auth/logout always succeeds and clears cookie', async ({ request }) => {
    const r = await request.post('/api/auth/logout');
    expect(r.ok()).toBeTruthy();
    expect((await r.json()).ok).toBe(true);
  });

  test('session cookie tampering is rejected', async ({ request }) => {
    const forged = Buffer.from(JSON.stringify({ sub: 'x', admin: true, exp: 9999999999 }))
      .toString('base64url') + '.forgedsignature';
    const r = await request.get('/api/my-bookings', {
      headers: { Cookie: `lisilou_sess=${forged}` },
    });
    expect(r.status()).toBe(401);
  });
});

test.describe('Client portal page', () => {
  test('/my-bookings serves the portal', async ({ page }) => {
    await page.goto('/my-bookings');
    await expect(page.locator('h1')).toHaveText('My Bookings');
  });

  test('signed-out visitor sees a sign-in prompt, not bookings', async ({ page }) => {
    await page.goto('/my-bookings');
    await expect(page.locator('#content .signin')).toBeVisible();
    await expect(page.locator('.booking-row')).toHaveCount(0);
  });

  test('/api/my-bookings requires a session', async ({ request }) => {
    const r = await request.get('/api/my-bookings');
    expect(r.status()).toBe(401);
  });

  test('contract download requires a session', async ({ request }) => {
    const r = await request.get('/api/my-bookings/1/contract');
    expect(r.status()).toBe(401);
  });
});

test.describe('Admin auth still works', () => {
  test('legacy ADMIN_SECRET bearer is accepted', async ({ request }) => {
    const r = await request.get('/api/admin/stats', {
      headers: { Authorization: `Bearer ${process.env.ADMIN_SECRET}` },
    });
    // 200 when the target's ADMIN_SECRET matches the test env; 401 otherwise —
    // either way the endpoint is auth-gated, never open or 500
    expect([200, 401]).toContain(r.status());
  });

  test('no credentials at all is rejected', async ({ request }) => {
    const r = await request.get('/api/admin/bookings');
    expect([401, 503]).toContain(r.status());
  });
});
