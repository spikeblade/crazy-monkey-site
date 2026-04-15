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

// Producto con stock disponible
const STOCK_OK = [{ stock_total: 10, stock_vendido: 5 }];
// Producto agotado
const STOCK_AGOTADO = [{ stock_total: 5, stock_vendido: 5 }];

function post(body) {
  return handler({ httpMethod: 'POST', body: JSON.stringify(body), headers: {} });
}

describe('create-preference', () => {
  test('POST valid cart → 200 with init_point', async () => {
    // Sequence: stock check x2 (2 productos únicos), config fetch, MP create preference, Supabase pre-save
    mockHttpsSequence(https, [
      { statusCode: 200, body: STOCK_OK },             // stock check Diseño Noir
      { statusCode: 200, body: STOCK_OK },             // stock check Diseño Rojo
      { statusCode: 200, body: [{ precio_venta: 95000 }] }, // config fetch
      { statusCode: 201, body: MP_PREFERENCE },        // MP create preference
      { statusCode: 201, body: '' },                   // pre-save (fire-and-forget)
    ]);
    const res = await post({ items: ITEMS, payer: PAYER });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.init_point).toBe(MP_PREFERENCE.init_point);
    expect(data.preference_id).toBe('pref-abc123');
  });

  test('stock agotado → 409 con nombre del producto', async () => {
    mockHttpsSequence(https, [
      { statusCode: 200, body: STOCK_AGOTADO }, // stock check Diseño Noir → agotado
    ]);
    const res = await post({ items: [{ name: 'Diseño Noir', size: 'M' }], payer: PAYER });
    expect(res.statusCode).toBe(409);
    const data = JSON.parse(res.body);
    expect(data.error).toBe('stock_agotado');
    expect(data.producto).toBe('Diseño Noir');
  });

  test('stock agotado → no llega a crear preferencia en MP', async () => {
    mockHttpsSequence(https, [
      { statusCode: 200, body: STOCK_AGOTADO },
    ]);
    await post({ items: [{ name: 'Diseño Noir', size: 'M' }], payer: PAYER });
    // Solo 1 llamada (stock check) — MP no fue contactado
    expect(https.request).toHaveBeenCalledTimes(1);
  });

  test('dos unidades del mismo producto con stock suficiente → 200', async () => {
    // El mismo producto aparece dos veces — stock check se hace una sola vez con cantidad=2
    const dosIguales = [
      { name: 'Diseño Noir', size: 'M' },
      { name: 'Diseño Noir', size: 'L' },
    ];
    const stockParaDos = [{ stock_total: 10, stock_vendido: 8 }]; // 2 disponibles exactas
    mockHttpsSequence(https, [
      { statusCode: 200, body: stockParaDos },         // stock check (cantidad=2)
      { statusCode: 200, body: [{ precio_venta: 95000 }] },
      { statusCode: 201, body: MP_PREFERENCE },
      { statusCode: 201, body: '' },
    ]);
    const res = await post({ items: dosIguales, payer: PAYER });
    expect(res.statusCode).toBe(200);
  });

  test('dos unidades del mismo producto sin stock suficiente → 409', async () => {
    const dosIguales = [
      { name: 'Diseño Noir', size: 'M' },
      { name: 'Diseño Noir', size: 'L' },
    ];
    const soloUna = [{ stock_total: 10, stock_vendido: 9 }]; // solo 1 disponible
    mockHttpsSequence(https, [
      { statusCode: 200, body: soloUna },
    ]);
    const res = await post({ items: dosIguales, payer: PAYER });
    expect(res.statusCode).toBe(409);
  });

  test('error en stock check → deja pasar (fail open)', async () => {
    // Si Supabase falla en el check, no bloqueamos la compra — el webhook tiene la guarda final
    mockHttpsSequence(https, [
      { statusCode: 500, body: [] },                   // stock check falla
      { statusCode: 500, body: [] },                   // stock check falla
      { statusCode: 200, body: [{ precio_venta: 95000 }] },
      { statusCode: 201, body: MP_PREFERENCE },
      { statusCode: 201, body: '' },
    ]);
    const res = await post({ items: ITEMS, payer: PAYER });
    expect(res.statusCode).toBe(200);
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
      { statusCode: 200, body: STOCK_OK },             // stock check Diseño Noir
      { statusCode: 200, body: STOCK_OK },             // stock check Diseño Rojo
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
    mockHttpsSequence(https, [
      { statusCode: 200, body: STOCK_OK },             // stock check
      { statusCode: 500, body: [] },                   // config fails
      { statusCode: 201, body: MP_PREFERENCE },
      { statusCode: 201, body: '' },
    ]);
    const res = await post({ items: [ITEMS[0]], payer: PAYER });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).init_point).toBeDefined();
  });
});
