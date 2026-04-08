/**
 * abandoned-cart.js captura SUPABASE_URL / SUPABASE_ANON_KEY al cargar el módulo.
 *
 * Requisito en Supabase antes de usar en producción:
 *   ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS recovery_sent boolean DEFAULT false;
 */
jest.mock('https');
const https = require('https');
const { setupEnv, mockHttpsSequence } = require('./helpers');

setupEnv();
const { handler } = require('../abandoned-cart');

const ADMIN_HEADERS = { 'x-admin-password': 'test-admin-pass' };

const ABANDONED_ORDERS = [
  {
    id: 'ped-abandoned-1',
    nombre: 'Laura Gómez',
    email: 'laura@example.com',
    items: [{ name: 'Diseño Noir', size: 'M' }],
    total: 95000,
    created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), // 3h ago
  },
  {
    id: 'ped-abandoned-2',
    nombre: 'Diego Ríos',
    email: 'diego@example.com',
    items: [{ name: 'Diseño Rojo', size: 'L' }, { name: 'Diseño Noir', size: 'S' }],
    total: 190000,
    created_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(), // 5h ago
  },
];

function scheduledEvent() {
  // Netlify scheduled functions envían un POST sin body específico
  return { httpMethod: 'POST', headers: {}, body: null, queryStringParameters: {} };
}

function manualGet(headers = ADMIN_HEADERS) {
  return { httpMethod: 'GET', headers, body: null, queryStringParameters: {} };
}

describe('abandoned-cart — disparo programado', () => {
  test('detecta carritos abandonados y envía emails → 200 con conteo', async () => {
    // Sequence: GET abandoned orders, email×1 + PATCH×1 (ped-1), email×1 + PATCH×1 (ped-2)
    mockHttpsSequence(https, [
      { statusCode: 200, body: ABANDONED_ORDERS },       // GET abandoned orders
      { statusCode: 200, body: { id: 'email-1' } },      // Resend email laura
      { statusCode: 200, body: [{ id: 'ped-abandoned-1', recovery_sent: true }] }, // PATCH
      { statusCode: 200, body: { id: 'email-2' } },      // Resend email diego
      { statusCode: 200, body: [{ id: 'ped-abandoned-2', recovery_sent: true }] }, // PATCH
    ]);

    const res = await handler(scheduledEvent());
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.checked).toBe(2);
    expect(data.sent).toBe(2);
    expect(data.failed).toBe(0);
  });

  test('sin carritos abandonados → checked:0 sent:0', async () => {
    mockHttpsSequence(https, [
      { statusCode: 200, body: [] },
    ]);
    const res = await handler(scheduledEvent());
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.checked).toBe(0);
    expect(data.sent).toBe(0);
    expect(https.request).toHaveBeenCalledTimes(1); // solo la consulta
  });

  test('Resend rechaza un email → cuenta como failed, continúa con el siguiente', async () => {
    mockHttpsSequence(https, [
      { statusCode: 200, body: ABANDONED_ORDERS },
      { statusCode: 422, body: { message: 'invalid email' } }, // falla para laura
      { statusCode: 200, body: { id: 'email-2' } },            // ok para diego
      { statusCode: 200, body: [{ id: 'ped-abandoned-2' }] },  // PATCH diego
    ]);

    const res = await handler(scheduledEvent());
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.sent).toBe(1);
    expect(data.failed).toBe(1);
  });

  test('el email contiene los items del carrito escapados', async () => {
    const maliciousOrder = [{
      ...ABANDONED_ORDERS[0],
      nombre: '<script>alert(1)</script>',
      items: [{ name: '<b>Diseño</b>', size: 'M' }],
    }];
    mockHttpsSequence(https, [
      { statusCode: 200, body: maliciousOrder },
      { statusCode: 200, body: { id: 'email-1' } },
      { statusCode: 200, body: [{ id: 'ped-abandoned-1' }] },
    ]);

    await handler(scheduledEvent());

    const emailWrite = https.request.mock.results[1].value.write.mock.calls[0][0];
    const emailPayload = JSON.parse(emailWrite);
    expect(emailPayload.html).not.toContain('<script>');
    expect(emailPayload.html).toContain('&lt;script&gt;');
    expect(emailPayload.html).not.toContain('<b>Diseño</b>');
    expect(emailPayload.html).toContain('&lt;b&gt;Diseño&lt;/b&gt;');
  });
});

describe('abandoned-cart — disparo manual (GET admin)', () => {
  test('GET con contraseña válida → ejecuta el mismo flujo', async () => {
    mockHttpsSequence(https, [
      { statusCode: 200, body: [ABANDONED_ORDERS[0]] },
      { statusCode: 200, body: { id: 'email-1' } },
      { statusCode: 200, body: [{ id: 'ped-abandoned-1' }] },
    ]);
    const res = await handler(manualGet());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).sent).toBe(1);
  });

  test('GET sin contraseña → 401', async () => {
    const res = await handler(manualGet({ 'x-admin-password': 'mal' }));
    expect(res.statusCode).toBe(401);
  });

  test('GET sin header → 401', async () => {
    const res = await handler(manualGet({}));
    expect(res.statusCode).toBe(401);
  });
});

describe('abandoned-cart — RESEND_API_KEY ausente', () => {
  test('sin clave de email configurada → 500', async () => {
    const original = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;

    const res = await handler(scheduledEvent());
    expect(res.statusCode).toBe(500);

    process.env.RESEND_API_KEY = original;
  });
});
