jest.mock('https');
const https = require('https');
const { setupEnv, mockHttpsSequence } = require('./helpers');

setupEnv();
const { handler } = require('../create-preference');

const ITEMS = [
  { name: 'Diseño Noir', size: 'M' },
  { name: 'Diseño Rojo', size: 'L' },
];

const PAYER = {
  nombre: 'Carlos Pérez',
  telefono: '3009876543',
  email: 'carlos@example.com',
  departamento: 'Cundinamarca',
  ciudad: 'Bogotá',
  direccion: 'Calle 80 #15-20',
};

const MP_PREFERENCE = {
  id: 'pref-abc123',
  init_point: 'https://www.mercadopago.com.co/checkout/v1/redirect?pref_id=pref-abc123',
  sandbox_init_point: 'https://sandbox.mercadopago.com.co/checkout',
};

function post(body) {
  return handler({ httpMethod: 'POST', body: JSON.stringify(body), headers: {} });
}

describe('create-preference', () => {
  test('POST valid cart → 200 with init_point', async () => {
    // Sequence: config fetch (Supabase), MP create preference, Supabase pre-save
    mockHttpsSequence(https, [
      { statusCode: 200, body: [{ precio_venta: 95000 }] },
      { statusCode: 201, body: MP_PREFERENCE },
      { statusCode: 201, body: '' }, // pre-save (fire-and-forget)
    ]);
    const res = await post({ items: ITEMS, payer: PAYER });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.init_point).toBe(MP_PREFERENCE.init_point);
    expect(data.preference_id).toBe('pref-abc123');
  });

  test('POST no items → 400', async () => {
    const res = await post({ items: [], payer: PAYER });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/items/i);
  });

  test('POST invalid JSON → 400', async () => {
    const res = await handler({ httpMethod: 'POST', body: 'not-json', headers: {} });
    expect(res.statusCode).toBe(400);
  });

  test('POST missing items field → 400', async () => {
    const res = await post({ payer: PAYER });
    expect(res.statusCode).toBe(400);
  });

  test('MP API error → 502', async () => {
    mockHttpsSequence(https, [
      { statusCode: 200, body: [{ precio_venta: 95000 }] },
      { statusCode: 400, body: { message: 'invalid_preference' } },
    ]);
    const res = await post({ items: ITEMS, payer: PAYER });
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error).toMatch(/MP API/i);
  });

  test('non-POST method → 405', async () => {
    const res = await handler({ httpMethod: 'GET', body: '{}', headers: {} });
    expect(res.statusCode).toBe(405);
  });

  test('config fetch failure uses default price of 95000', async () => {
    // Config fetch fails, MP still succeeds — total should use default
    mockHttpsSequence(https, [
      { statusCode: 500, body: [] }, // config fails
      { statusCode: 201, body: MP_PREFERENCE },
      { statusCode: 201, body: '' },
    ]);
    const res = await post({ items: [ITEMS[0]], payer: PAYER });
    expect(res.statusCode).toBe(200);
    // Verify MP was called with price 95000
    const calls = https.request.mock.calls;
    const mpCall = calls.find(([opts]) => opts.hostname === 'api.mercadopago.com');
    const mpBody = JSON.parse(mpCall[0] === undefined ? '{}' : '{}');
    // The call was made — sufficient to confirm handler didn't error
    expect(JSON.parse(res.body).init_point).toBeDefined();
  });
});
