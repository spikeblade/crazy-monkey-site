jest.mock('https');
const https = require('https');
const { setupEnv, mockHttpsSequence } = require('./helpers');

setupEnv();
const { handler } = require('../get-orders');

const ADMIN_HEADERS = { 'x-admin-password': 'test-admin-pass' };

describe('get-orders', () => {
  test('GET valid admin password → 200 with orders list', async () => {
    const orders = [{ id: '1', nombre: 'Ana', estado: 'confirmado' }];
    mockHttpsSequence(https, [{ statusCode: 200, body: orders }]);
    const res = await handler({ httpMethod: 'GET', headers: ADMIN_HEADERS });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(orders);
  });

  test('GET wrong admin password → 401', async () => {
    const res = await handler({
      httpMethod: 'GET',
      headers: { 'x-admin-password': 'wrong' },
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toMatch(/autorizado/i);
  });

  test('GET no password header → 401', async () => {
    const res = await handler({ httpMethod: 'GET', headers: {} });
    expect(res.statusCode).toBe(401);
  });

  test('PATCH valid estado → 200 success', async () => {
    mockHttpsSequence(https, [{ statusCode: 200, body: [{ id: '5', estado: 'enviado' }] }]);
    const res = await handler({
      httpMethod: 'PATCH',
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ id: '5', estado: 'enviado' }),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).success).toBe(true);
  });

  test('PATCH invalid estado → 400', async () => {
    const res = await handler({
      httpMethod: 'PATCH',
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ id: '5', estado: 'inventado' }),
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/inválido/i);
  });

  test('PATCH missing id → 400', async () => {
    const res = await handler({
      httpMethod: 'PATCH',
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ estado: 'enviado' }),
    });
    expect(res.statusCode).toBe(400);
  });

  test('non-GET/PATCH method → 405', async () => {
    const res = await handler({ httpMethod: 'DELETE', headers: ADMIN_HEADERS });
    expect(res.statusCode).toBe(405);
  });
});
