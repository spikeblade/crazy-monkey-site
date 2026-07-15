'use strict';

jest.mock('https');
const https = require('https');
const { setupEnv, mockHttpsSequence } = require('./helpers');

setupEnv();
const { handler } = require('../get-order-by-preference');

const SAMPLE_ORDER = {
  nombre: 'Ana García',
  estado: 'confirmado',
  mp_status: 'approved',
  items: [{ name: 'Camiseta Noir', size: 'M', price: 95000 }],
  total: 95000,
  created_at: '2026-04-01T10:00:00Z',
  mp_preference_id: 'PREF-SECRET-123',
};

function makeEvent(preferenceId) {
  return {
    httpMethod: 'GET',
    queryStringParameters: preferenceId ? { preference_id: preferenceId } : {},
  };
}

describe('GET /get-order-by-preference', () => {
  beforeEach(() => jest.clearAllMocks());

  it('responde OPTIONS con 204', async () => {
    const res = await handler({ httpMethod: 'OPTIONS' });
    expect(res.statusCode).toBe(204);
  });

  it('rechaza POST', async () => {
    const res = await handler({ httpMethod: 'POST' });
    expect(res.statusCode).toBe(405);
  });

  it('rechaza sin preference_id', async () => {
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(400);
  });

  it('devuelve 404 si no encuentra el pedido', async () => {
    mockHttpsSequence(https, [{ statusCode: 200, body: [] }]);
    const res = await handler(makeEvent('PREF-123'));
    expect(res.statusCode).toBe(404);
  });

  it('devuelve 502 si Supabase falla', async () => {
    mockHttpsSequence(https, [{ statusCode: 500, body: { message: 'error' } }]);
    const res = await handler(makeEvent('PREF-123'));
    expect(res.statusCode).toBe(502);
  });

  it('devuelve el pedido con estado approved → "Pago confirmado"', async () => {
    mockHttpsSequence(https, [{ statusCode: 200, body: [SAMPLE_ORDER] }]);
    const res = await handler(makeEvent('PREF-123'));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.nombre).toBe('Ana García');
    expect(body.total).toBe(95000);
    expect(body.items).toHaveLength(1);
    expect(body.estado.status).toBe('approved');
    expect(body.estado.label).toMatch(/confirmado/i);
  });

  it('mapea mp_status=pending → "Verificando tu pago"', async () => {
    mockHttpsSequence(https, [{ statusCode: 200, body: [{ ...SAMPLE_ORDER, mp_status: 'pending' }] }]);
    const res = await handler(makeEvent('PREF-123'));
    const body = JSON.parse(res.body);
    expect(body.estado.status).toBe('pending');
    expect(body.estado.label).toMatch(/verificando/i);
  });

  it('mapea mp_status=rejected → "Pago rechazado"', async () => {
    mockHttpsSequence(https, [{ statusCode: 200, body: [{ ...SAMPLE_ORDER, mp_status: 'rejected' }] }]);
    const res = await handler(makeEvent('PREF-123'));
    const body = JSON.parse(res.body);
    expect(body.estado.status).toBe('rejected');
  });

  it('no expone campos sensibles (mp_preference_id, email, teléfono, dirección)', async () => {
    mockHttpsSequence(https, [{
      statusCode: 200,
      body: [{ ...SAMPLE_ORDER, email: 'ana@test.com', telefono: '3001234567', direccion: 'Calle 1' }],
    }]);
    const res = await handler(makeEvent('PREF-123'));
    expect(res.body).not.toContain('PREF-SECRET-123');
    expect(res.body).not.toContain('ana@test.com');
    expect(res.body).not.toContain('3001234567');
    expect(res.body).not.toContain('Calle 1');
  });

  it('codifica el preference_id en la query a Supabase', async () => {
    mockHttpsSequence(https, [{ statusCode: 200, body: [] }]);
    await handler(makeEvent('PREF 123/abc'));
    const callPath = https.request.mock.calls[0][0].path;
    expect(callPath).toContain(encodeURIComponent('PREF 123/abc'));
  });
});
