// @ts-check
const { test, expect } = require('@playwright/test');

const ADMIN_SECRET = process.env.ADMIN_SECRET || '9yPuNfYjy5kisRKrowhmH42PTeEgH';
const authHeaders = { Authorization: `Bearer ${ADMIN_SECRET}` };

test.describe('Booking API — public routes', () => {
  test('GET /api/health → {ok:true}', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  test('POST /api/bookings creates a booking and returns id', async ({ request }) => {
    const res = await request.post('/api/bookings', {
      data: {
        client_name: 'API Test',
        client_email: `api-test-${Date.now()}@test.lisilou`,
        client_phone: '555-000-0002',
        session_date: '2099-11-15',
        session_type: 'individual',
        session_length: 'mini',
        location: 'studio',
      },
    });
    expect(res.status()).toBe(201);
    const json = await res.json();
    expect(typeof json.id).toBe('number');
    expect(json.id).toBeGreaterThan(0);
  });

  test('POST /api/bookings with payment_status=pending_confirmation accepted', async ({ request }) => {
    const res = await request.post('/api/bookings', {
      data: {
        client_name: 'Payment Test',
        client_email: `pay-test-${Date.now()}@test.lisilou`,
        session_date: '2099-12-01',
        session_type: 'couple',
        session_length: 'full',
        location: 'downtown',
        payment_status: 'pending_confirmation',
      },
    });
    expect(res.status()).toBe(201);
    expect((await res.json()).id).toBeGreaterThan(0);
  });

  test('POST /api/bookings with missing required fields returns 400', async ({ request }) => {
    const res = await request.post('/api/bookings', {
      data: { client_name: 'Incomplete' },
    });
    expect(res.status()).toBe(400);
  });

  test('GET /api/bookings/99999/contract returns 404 for unknown booking', async ({ request }) => {
    const res = await request.get('/api/bookings/99999/contract');
    expect(res.status()).toBe(404);
  });

  test('GET /api/contracts/template returns 404 (no template on file yet)', async ({ request }) => {
    const res = await request.get('/api/contracts/template');
    // Either 404 (no template uploaded) or 200 (uploaded) — both are valid; just not 500
    expect(res.status()).not.toBe(500);
  });
});

test.describe('Admin API — authentication', () => {
  test('GET /api/admin/stats without token returns 401 or 503', async ({ request }) => {
    const res = await request.get('/api/admin/stats');
    expect([401, 503]).toContain(res.status());
  });

  test('GET /api/admin/stats with wrong token returns 401', async ({ request }) => {
    const res = await request.get('/api/admin/stats', {
      headers: { Authorization: 'Bearer wrongtoken' },
    });
    expect(res.status()).toBe(401);
  });

  test('GET /api/admin/stats with correct token returns stats', async ({ request }) => {
    const res = await request.get('/api/admin/stats', { headers: authHeaders });
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(typeof json.upcoming).toBe('number');
    expect(typeof json.pending_payment).toBe('number');
    expect(typeof json.confirmed_payment).toBe('number');
    expect(Array.isArray(json.nextUpcoming)).toBe(true);
  });
});

test.describe('Admin API — bookings CRUD', () => {
  let createdId;

  test('GET /api/admin/bookings returns array', async ({ request }) => {
    const res = await request.get('/api/admin/bookings', { headers: authHeaders });
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
  });

  test('GET /api/admin/bookings filters by payment_status', async ({ request }) => {
    const res = await request.get('/api/admin/bookings?payment_status=pending', { headers: authHeaders });
    expect(res.status()).toBe(200);
    const json = await res.json();
    for (const b of json) {
      expect(b.payment_status).toBe('pending');
    }
  });

  test('GET /api/admin/bookings?search= filters by name', async ({ request }) => {
    const res = await request.get('/api/admin/bookings?search=Smoke+Test', { headers: authHeaders });
    expect(res.status()).toBe(200);
    const json = await res.json();
    for (const b of json) {
      const matches = b.client_name?.includes('Smoke') || b.client_email?.includes('Smoke');
      expect(matches).toBeTruthy();
    }
  });

  test('PATCH /api/admin/bookings/:id updates payment_status', async ({ request }) => {
    // Create a booking to patch
    const createRes = await request.post('/api/bookings', {
      data: {
        client_name: 'Admin Patch Test',
        client_email: `patch-${Date.now()}@test.lisilou`,
        session_date: '2099-10-10',
        session_type: 'family',
        session_length: 'full',
        location: 'park',
        payment_status: 'pending_confirmation',
      },
    });
    createdId = (await createRes.json()).id;

    const patchRes = await request.patch(`/api/admin/bookings/${createdId}`, {
      headers: authHeaders,
      data: { payment_status: 'confirmed' },
    });
    expect(patchRes.status()).toBe(200);
    const updated = await patchRes.json();
    expect(updated.payment_status).toBe('confirmed');
  });

  test('PATCH /api/admin/bookings/:id updates notes', async ({ request }) => {
    // Reuse createdId from previous test or create new
    const createRes = await request.post('/api/bookings', {
      data: {
        client_name: 'Notes Test',
        client_email: `notes-${Date.now()}@test.lisilou`,
        session_date: '2099-09-09',
        session_type: 'individual',
        session_length: 'mini',
        location: 'studio',
      },
    });
    const id = (await createRes.json()).id;

    const patchRes = await request.patch(`/api/admin/bookings/${id}`, {
      headers: authHeaders,
      data: { notes: 'Playwright test note' },
    });
    expect(patchRes.status()).toBe(200);
    expect((await patchRes.json()).notes).toBe('Playwright test note');
  });

  test('GET /api/admin/bookings/:id returns single booking', async ({ request }) => {
    const listRes = await request.get('/api/admin/bookings', { headers: authHeaders });
    const bookings = await listRes.json();
    if (!bookings.length) return; // skip if empty DB

    const id = bookings[0].id;
    const res = await request.get(`/api/admin/bookings/${id}`, { headers: authHeaders });
    expect(res.status()).toBe(200);
    const b = await res.json();
    expect(b.id).toBe(id);
    expect(b).toHaveProperty('client_name');
    expect(b).toHaveProperty('session_date');
  });

  test('GET /api/admin/bookings/99999 returns 404', async ({ request }) => {
    const res = await request.get('/api/admin/bookings/99999', { headers: authHeaders });
    expect(res.status()).toBe(404);
  });

  test('GET /api/admin/payments/export returns CSV', async ({ request }) => {
    const res = await request.get('/api/admin/payments/export', { headers: authHeaders });
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/csv');
    const body = await res.text();
    expect(body).toContain('client_name');
    expect(body).toContain('session_date');
    expect(body).toContain('payment_status');
  });
});
