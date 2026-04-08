/**
 * configuracion.js captures SUPABASE_URL / SUPABASE_ANON_KEY at module load,
 * so env vars must be set before the first require.
 */
jest.mock('https');
const https = require('https');
const { setupEnv, mockHttpsSequence } = require('./helpers');

setupEnv();
const { handler } = require('../configuracion');

const ADMIN_HEADERS = { 'x-admin-password': 'test-admin-pass' };

describe('configuracion', () => {
  test('GET → 200 with pricing config', async () => {
    mockHttpsSequence(https, [
      { statusCode: 200, body: [{ precio_venta: 95000, costo_produccion: 49000 }] },
    ]);
    const res = await handler({ httpMethod: 'GET', headers: {} });
    expect(res.statusCode).toBe(200);
    const config = JSON.parse(res.body);
    expect(config.precio_venta).toBe(95000);
    expect(config.costo_produccion).toBe(49000);
    expect(res.headers['Cache-Control']).toMatch(/max-age/);
  });

  test('GET with empty Supabase response → 200 with defaults', async () => {
    mockHttpsSequence(https, [{ statusCode: 200, body: [] }]);
    const res = await handler({ httpMethod: 'GET', headers: {} });
    expect(res.statusCode).toBe(200);
    const config = JSON.parse(res.body);
    expect(config.precio_venta).toBe(95000);
    expect(config.costo_produccion).toBe(49000);
  });

  test('PATCH valid values → 200 success', async () => {
    mockHttpsSequence(https, [
      { statusCode: 200, body: [{ precio_venta: 100000, costo_produccion: 50000 }] },
    ]);
    const res = await handler({
      httpMethod: 'PATCH',
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ precio_venta: 100000, costo_produccion: 50000 }),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).success).toBe(true);
  });

  test('PATCH wrong password → 401', async () => {
    const res = await handler({
      httpMethod: 'PATCH',
      headers: { 'x-admin-password': 'wrong' },
      body: JSON.stringify({ precio_venta: 100000, costo_produccion: 50000 }),
    });
    expect(res.statusCode).toBe(401);
  });

  test('PATCH precio_venta < costo_produccion → 400', async () => {
    const res = await handler({
      httpMethod: 'PATCH',
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ precio_venta: 40000, costo_produccion: 50000 }),
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/menor/i);
  });

  test('PATCH missing fields → 400', async () => {
    const res = await handler({
      httpMethod: 'PATCH',
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ precio_venta: 95000 }),
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/obligatorios/i);
  });

  test('PATCH invalid JSON → 400', async () => {
    const res = await handler({
      httpMethod: 'PATCH',
      headers: ADMIN_HEADERS,
      body: 'not-json',
    });
    expect(res.statusCode).toBe(400);
  });

  test('unsupported method → 405', async () => {
    const res = await handler({ httpMethod: 'DELETE', headers: {} });
    expect(res.statusCode).toBe(405);
  });
});
