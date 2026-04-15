/**
 * produccion.js captura SUPABASE_URL / SUPABASE_ANON_KEY al cargar el módulo,
 * así que process.env debe estar configurado antes del primer require.
 */
jest.mock('https');
const https = require('https');
const { setupEnv, mockHttpsSequence } = require('./helpers');

setupEnv();
const { handler } = require('../produccion');

const ADMIN_HEADERS = { 'x-admin-password': 'test-admin-pass' };

const CONFIG = { precio_venta: 95000, costo_produccion: 49000 };

const ORDERS = [
  {
    id: 'ped-1',
    nombre: 'Ana Torres',
    email: 'ana@example.com',
    telefono: '3001234567',
    ciudad: 'Medellín',
    items: [
      { name: 'Diseño Noir', size: 'M' },
      { name: 'Diseño Rojo', size: 'L' },
    ],
    total: 190000,
    estado: 'confirmado',
  },
  {
    id: 'ped-2',
    nombre: 'Carlos Pérez',
    email: 'carlos@example.com',
    telefono: '3009876543',
    ciudad: 'Bogotá',
    items: [{ name: 'Diseño Noir', size: 'S' }],
    total: 95000,
    estado: 'confirmado',
  },
];

const LOTE = {
  id: 'lote-1',
  nombre: 'Lote Abril',
  estado: 'borrador',
  pedidos_ids: ['ped-1', 'ped-2'],
};

function event(httpMethod, opts = {}) {
  return {
    httpMethod,
    headers: ADMIN_HEADERS,
    queryStringParameters: opts.query || {},
    body: opts.body !== undefined ? JSON.stringify(opts.body) : null,
  };
}

// ─────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────
describe('produccion — auth', () => {
  test('sin contraseña admin → 401', async () => {
    const res = await handler({
      httpMethod: 'GET',
      headers: {},
      queryStringParameters: {},
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toMatch(/autorizado/i);
  });

  test('contraseña incorrecta → 401', async () => {
    const res = await handler({
      httpMethod: 'GET',
      headers: { 'x-admin-password': 'mal' },
      queryStringParameters: {},
    });
    expect(res.statusCode).toBe(401);
  });
});

// ─────────────────────────────────────────────
// GET summary
// ─────────────────────────────────────────────
const PRODUCTOS = [
  { nombre: 'Diseño Noir', arte_url: 'https://drive.google.com/file/noir' },
  { nombre: 'Diseño Rojo', arte_url: null },
];

describe('produccion — GET summary', () => {
  test('devuelve resumen con totales y diseños agregados', async () => {
    // Sequence: getConfig, get pedidos, get productos (arte_url)
    mockHttpsSequence(https, [
      { statusCode: 200, body: [CONFIG] },
      { statusCode: 200, body: ORDERS },
      { statusCode: 200, body: PRODUCTOS },
    ]);
    const res = await handler(event('GET', { query: { action: 'summary' } }));
    expect(res.statusCode).toBe(200);

    const data = JSON.parse(res.body);
    expect(data.pedidosCount).toBe(2);
    expect(data.totalUnidades).toBe(3); // 2 items de ped-1 + 1 de ped-2
    expect(data.totalIngresos).toBe(285000); // 190000 + 95000
    expect(data.totalCosto).toBe(3 * 49000); // 147000
    expect(data.margen).toBe(285000 - 147000); // 138000
    expect(data.designs).toHaveLength(2);

    // Diseño Noir aparece primero (más unidades) y tiene arte_url
    const noir = data.designs.find(d => d.nombre === 'Diseño Noir');
    expect(noir.subtotal).toBe(2);
    expect(noir.tallas).toEqual({ M: 1, S: 1 });
    expect(noir.arte_url).toBe('https://drive.google.com/file/noir');

    // Diseño Rojo sin arte_url
    const rojo = data.designs.find(d => d.nombre === 'Diseño Rojo');
    expect(rojo.subtotal).toBe(1);
    expect(rojo.tallas).toEqual({ L: 1 });
    expect(rojo.arte_url).toBeNull();
  });

  test('sin pedidos confirmados → totales en cero', async () => {
    // Sequence: getConfig, get pedidos, get productos
    mockHttpsSequence(https, [
      { statusCode: 200, body: [CONFIG] },
      { statusCode: 200, body: [] },
      { statusCode: 200, body: [] },
    ]);
    const res = await handler(event('GET', { query: { action: 'summary' } }));
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.totalUnidades).toBe(0);
    expect(data.totalIngresos).toBe(0);
    expect(data.designs).toHaveLength(0);
    expect(data.pedidosCount).toBe(0);
  });

  test('config falla → usa precios por defecto (95000 / 49000)', async () => {
    // Sequence: config falla, 1 pedido, get productos
    mockHttpsSequence(https, [
      { statusCode: 500, body: [] },              // config falla
      { statusCode: 200, body: [ORDERS[1]] },     // 1 pedido, 1 item, total 95000
      { statusCode: 200, body: PRODUCTOS },
    ]);
    const res = await handler(event('GET', { query: { action: 'summary' } }));
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.totalCosto).toBe(1 * 49000); // precio por defecto
  });
});

// ─────────────────────────────────────────────
// GET list
// ─────────────────────────────────────────────
describe('produccion — GET list', () => {
  test('devuelve lista de lotes', async () => {
    mockHttpsSequence(https, [{ statusCode: 200, body: [LOTE] }]);
    const res = await handler(event('GET'));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([LOTE]);
  });
});

// ─────────────────────────────────────────────
// POST — crear lote
// ─────────────────────────────────────────────
describe('produccion — POST', () => {
  test('crea lote con pedidos específicos → 200', async () => {
    // Sequence: buildSummary→getConfig, buildSummary→pedidos, buildSummary→productos, getConfig (costo_unit), insert lote
    mockHttpsSequence(https, [
      { statusCode: 200, body: [CONFIG] },
      { statusCode: 200, body: ORDERS },
      { statusCode: 200, body: PRODUCTOS },
      { statusCode: 200, body: [CONFIG] },
      { statusCode: 201, body: [{ ...LOTE, id: 'lote-nuevo' }] },
    ]);
    const res = await handler(event('POST', {
      body: { nombre: 'Lote Abril', pedidos_ids: ['ped-1', 'ped-2'] },
    }));
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.success).toBe(true);
    expect(data.lote).toBeDefined();
  });

  test('crea lote sin especificar pedidos → incluye todos los confirmados', async () => {
    mockHttpsSequence(https, [
      { statusCode: 200, body: [CONFIG] },
      { statusCode: 200, body: ORDERS },
      { statusCode: 200, body: PRODUCTOS },
      { statusCode: 200, body: [CONFIG] },
      { statusCode: 201, body: [LOTE] },
    ]);
    const res = await handler(event('POST', { body: { nombre: 'Lote Sin Filtro' } }));
    expect(res.statusCode).toBe(200);
    // Verificar que se enviaron todos los ids de pedidos al insert
    const insertCall = https.request.mock.calls[4];
    const insertBody = JSON.parse(insertCall[0].path ? '{}' : '{}'); // workaround: check via write
    const written = https.request.mock.results[4].value.write.mock.calls[0][0];
    const loteInserted = JSON.parse(written);
    expect(loteInserted.pedidos_ids).toEqual(['ped-1', 'ped-2']);
  });

  test('falta nombre → 400', async () => {
    const res = await handler(event('POST', { body: { notas: 'sin nombre' } }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/nombre/i);
  });

  test('JSON inválido → 400', async () => {
    const res = await handler({
      httpMethod: 'POST',
      headers: ADMIN_HEADERS,
      queryStringParameters: {},
      body: 'not-json',
    });
    expect(res.statusCode).toBe(400);
  });

  test('Supabase error al insertar → 502', async () => {
    mockHttpsSequence(https, [
      { statusCode: 200, body: [CONFIG] },
      { statusCode: 200, body: ORDERS },
      { statusCode: 200, body: [CONFIG] },
      { statusCode: 500, body: { message: 'db error' } },
    ]);
    const res = await handler(event('POST', { body: { nombre: 'Lote Fail' } }));
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error).toMatch(/creando/i);
  });
});

// ─────────────────────────────────────────────
// PATCH — actualizar lote
// ─────────────────────────────────────────────
describe('produccion — PATCH', () => {
  test('actualizar estado → 200 success', async () => {
    mockHttpsSequence(https, [
      { statusCode: 200, body: [{ ...LOTE, estado: 'en_produccion' }] },
    ]);
    const res = await handler(event('PATCH', {
      body: { id: 'lote-1', estado: 'en_produccion' },
    }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).success).toBe(true);
  });

  test('actualizar notas sin cambiar estado → 200', async () => {
    mockHttpsSequence(https, [
      { statusCode: 200, body: [LOTE] },
    ]);
    const res = await handler(event('PATCH', {
      body: { id: 'lote-1', notas: 'Nota nueva' },
    }));
    expect(res.statusCode).toBe(200);
  });

  test('estado=listo → notifica a clientes del lote', async () => {
    // Sequence: PATCH lote, GET lote (pedidos_ids), GET pedidos detalle, email×2
    mockHttpsSequence(https, [
      { statusCode: 200, body: [LOTE] },                           // PATCH update
      { statusCode: 200, body: [{ pedidos_ids: ['ped-1', 'ped-2'] }] }, // GET lote→pedidos_ids
      { statusCode: 200, body: ORDERS },                           // GET pedidos detalle
      { statusCode: 200, body: '' },                               // email ana
      { statusCode: 200, body: '' },                               // email carlos
    ]);
    const res = await handler(event('PATCH', {
      body: { id: 'lote-1', estado: 'listo' },
    }));
    expect(res.statusCode).toBe(200);
    // 5 llamadas: patch + get lote + get pedidos + 2 emails
    expect(https.request).toHaveBeenCalledTimes(5);
  });

  test('estado=listo pero pedidos sin email → no envía emails', async () => {
    const ordersNoEmail = ORDERS.map(o => ({ ...o, email: null }));
    mockHttpsSequence(https, [
      { statusCode: 200, body: [LOTE] },
      { statusCode: 200, body: [{ pedidos_ids: ['ped-1'] }] },
      { statusCode: 200, body: ordersNoEmail },
    ]);
    const res = await handler(event('PATCH', {
      body: { id: 'lote-1', estado: 'listo' },
    }));
    expect(res.statusCode).toBe(200);
    // Solo 3 llamadas — sin emails porque no hay addresses
    expect(https.request).toHaveBeenCalledTimes(3);
  });

  test('falta id → 400', async () => {
    const res = await handler(event('PATCH', { body: { estado: 'listo' } }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/id/i);
  });

  test('JSON inválido → 400', async () => {
    const res = await handler({
      httpMethod: 'PATCH',
      headers: ADMIN_HEADERS,
      queryStringParameters: {},
      body: 'not-json',
    });
    expect(res.statusCode).toBe(400);
  });

  test('datos de pedido con HTML malicioso son escapados en el email', async () => {
    const maliciousOrders = [{
      ...ORDERS[0],
      nombre: '<script>alert(1)</script>',
      ciudad: '<img src=x onerror=alert(1)>',
      items: [{ name: '<b>Diseño</b>', size: 'M' }],
    }];
    mockHttpsSequence(https, [
      { statusCode: 200, body: [LOTE] },
      { statusCode: 200, body: [{ pedidos_ids: ['ped-1'] }] },
      { statusCode: 200, body: maliciousOrders },
      { statusCode: 200, body: '' }, // email
    ]);
    await handler(event('PATCH', { body: { id: 'lote-1', estado: 'listo' } }));

    const emailCall = https.request.mock.results[3].value.write.mock.calls[0][0];
    const emailPayload = JSON.parse(emailCall);
    expect(emailPayload.html).not.toContain('<script>');
    expect(emailPayload.html).toContain('&lt;script&gt;');
    expect(emailPayload.html).not.toContain('<img src=x');
  });
});

// ─────────────────────────────────────────────
// DELETE
// ─────────────────────────────────────────────
describe('produccion — DELETE', () => {
  test('delete con id → 200', async () => {
    mockHttpsSequence(https, [{ statusCode: 200, body: [] }]);
    const res = await handler(event('DELETE', { query: { id: 'lote-1' } }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).success).toBe(true);
  });

  test('delete sin id → 400', async () => {
    const res = await handler(event('DELETE'));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/id/i);
  });
});

// ─────────────────────────────────────────────
// Método no soportado
// ─────────────────────────────────────────────
describe('produccion — método no soportado', () => {
  test('PUT → 405', async () => {
    const res = await handler(event('PUT'));
    expect(res.statusCode).toBe(405);
  });
});
