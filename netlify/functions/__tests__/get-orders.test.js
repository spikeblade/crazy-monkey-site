jest.mock('https');
const https = require('https');
const { setupEnv, mockHttpsSequence } = require('./helpers');

setupEnv();
const { handler } = require('../get-orders');

const ADMIN_HEADERS = { 'x-admin-password': 'test-admin-pass' };

const ORDER_WITH_EMAIL = {
  id: '5',
  nombre: 'Ana Torres',
  email: 'ana@example.com',
  ciudad: 'Medellín',
  departamento: 'Antioquia',
  items: [{ name: 'Diseño Noir', size: 'M' }],
  total: 95000,
  estado: 'enviado',
};

function patch(body) {
  return handler({ httpMethod: 'PATCH', headers: ADMIN_HEADERS, body: JSON.stringify(body) });
}

// ── GET ──────────────────────────────────────
describe('get-orders — GET', () => {
  test('contraseña válida → 200 con lista de pedidos', async () => {
    const orders = [{ id: '1', nombre: 'Ana', estado: 'confirmado' }];
    mockHttpsSequence(https, [{ statusCode: 200, body: orders }]);
    const res = await handler({ httpMethod: 'GET', headers: ADMIN_HEADERS });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(orders);
  });

  test('contraseña incorrecta → 401', async () => {
    const res = await handler({ httpMethod: 'GET', headers: { 'x-admin-password': 'wrong' } });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toMatch(/autorizado/i);
  });

  test('sin header → 401', async () => {
    const res = await handler({ httpMethod: 'GET', headers: {} });
    expect(res.statusCode).toBe(401);
  });
});

// ── PATCH — estado ────────────────────────────
describe('get-orders — PATCH estado', () => {
  test('estado válido sin tracking → 200, sin email', async () => {
    mockHttpsSequence(https, [{ statusCode: 200, body: [{ id: '5', estado: 'confirmado' }] }]);
    const res = await patch({ id: '5', estado: 'confirmado' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).success).toBe(true);
    expect(https.request).toHaveBeenCalledTimes(1); // solo el PATCH, sin email
  });

  test('estado inválido → 400', async () => {
    const res = await patch({ id: '5', estado: 'inventado' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/inválido/i);
  });

  test('falta id → 400', async () => {
    const res = await patch({ estado: 'enviado' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/id/i);
  });

  test('ni estado ni tracking_number → 400', async () => {
    const res = await patch({ id: '5' });
    expect(res.statusCode).toBe(400);
  });
});

// ── PATCH — tracking ──────────────────────────
describe('get-orders — PATCH tracking', () => {
  test('estado=enviado + tracking_number → 200 y envía email al cliente', async () => {
    // Sequence: PATCH supabase, Resend email
    mockHttpsSequence(https, [
      { statusCode: 200, body: [ORDER_WITH_EMAIL] },
      { statusCode: 200, body: { id: 'email-1' } },
    ]);
    const res = await patch({ id: '5', estado: 'enviado', tracking_number: '9876543210', carrier: 'coordinadora' });
    expect(res.statusCode).toBe(200);
    expect(https.request).toHaveBeenCalledTimes(2); // PATCH + email
  });

  test('email contiene número de guía y transportadora', async () => {
    mockHttpsSequence(https, [
      { statusCode: 200, body: [ORDER_WITH_EMAIL] },
      { statusCode: 200, body: { id: 'email-1' } },
    ]);
    await patch({ id: '5', estado: 'enviado', tracking_number: '9876543210', carrier: 'servientrega' });

    const emailWrite = https.request.mock.results[1].value.write.mock.calls[0][0];
    const emailPayload = JSON.parse(emailWrite);
    expect(emailPayload.html).toContain('9876543210');
    expect(emailPayload.html).toContain('Servientrega');
    expect(emailPayload.subject).toContain('9876543210');
  });

  test('email incluye link de rastreo para transportadoras conocidas', async () => {
    mockHttpsSequence(https, [
      { statusCode: 200, body: [ORDER_WITH_EMAIL] },
      { statusCode: 200, body: { id: 'email-1' } },
    ]);
    await patch({ id: '5', estado: 'enviado', tracking_number: '111222333', carrier: 'coordinadora' });

    const emailWrite = https.request.mock.results[1].value.write.mock.calls[0][0];
    const emailPayload = JSON.parse(emailWrite);
    expect(emailPayload.html).toContain('coordinadora.com');
    expect(emailPayload.html).toContain('111222333');
  });

  test('transportadora desconocida → email sin link pero con número de guía', async () => {
    mockHttpsSequence(https, [
      { statusCode: 200, body: [ORDER_WITH_EMAIL] },
      { statusCode: 200, body: { id: 'email-1' } },
    ]);
    await patch({ id: '5', estado: 'enviado', tracking_number: '444555666', carrier: 'mototaxi-express' });

    const emailWrite = https.request.mock.results[1].value.write.mock.calls[0][0];
    const emailPayload = JSON.parse(emailWrite);
    expect(emailPayload.html).toContain('444555666');
    expect(emailPayload.html).not.toContain('Rastrear mi pedido'); // no hay link
  });

  test('estado=enviado sin tracking_number → 200, sin email', async () => {
    mockHttpsSequence(https, [{ statusCode: 200, body: [ORDER_WITH_EMAIL] }]);
    const res = await patch({ id: '5', estado: 'enviado' });
    expect(res.statusCode).toBe(200);
    expect(https.request).toHaveBeenCalledTimes(1); // solo el PATCH
  });

  test('pedido sin email → 200, sin email de tracking', async () => {
    mockHttpsSequence(https, [
      { statusCode: 200, body: [{ ...ORDER_WITH_EMAIL, email: null }] },
    ]);
    const res = await patch({ id: '5', estado: 'enviado', tracking_number: '9999', carrier: 'servientrega' });
    expect(res.statusCode).toBe(200);
    expect(https.request).toHaveBeenCalledTimes(1); // solo el PATCH
  });

  test('agregar tracking a pedido ya enviado → 200 y envía email', async () => {
    // El admin primero marcó enviado, luego agrega tracking por separado
    // ORDER_WITH_EMAIL.estado === 'enviado' → el email debe dispararse igual
    mockHttpsSequence(https, [
      { statusCode: 200, body: [ORDER_WITH_EMAIL] },    // PATCH
      { statusCode: 200, body: { id: 'email-1' } },    // Resend
    ]);
    const res = await patch({ id: '5', tracking_number: '1234567890', carrier: 'tcc' });
    expect(res.statusCode).toBe(200);
    expect(https.request).toHaveBeenCalledTimes(2); // PATCH + email
  });

  test('inputs maliciosos son escapados en el email', async () => {
    mockHttpsSequence(https, [
      { statusCode: 200, body: [{ ...ORDER_WITH_EMAIL, nombre: '<script>alert(1)</script>' }] },
      { statusCode: 200, body: { id: 'email-1' } },
    ]);
    await patch({ id: '5', estado: 'enviado', tracking_number: '<img/onerror=x>', carrier: 'servientrega' });

    const emailWrite = https.request.mock.results[1].value.write.mock.calls[0][0];
    const emailPayload = JSON.parse(emailWrite);
    expect(emailPayload.html).not.toContain('<script>');
    expect(emailPayload.html).toContain('&lt;script&gt;');
    expect(emailPayload.html).not.toContain('<img/onerror=x>');
  });
});

// ── Método no soportado ───────────────────────
describe('get-orders — método no soportado', () => {
  test('DELETE → 405', async () => {
    const res = await handler({ httpMethod: 'DELETE', headers: ADMIN_HEADERS });
    expect(res.statusCode).toBe(405);
  });
});
