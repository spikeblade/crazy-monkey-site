jest.mock('https');
const https = require('https');
const { setupEnv, mockHttpsSequence } = require('./helpers');

setupEnv();
const { handler } = require('../get-clientes');

const ADMIN_HEADERS = { 'x-admin-password': 'test-admin-pass' };

const PEDIDOS = [
  { id: 'p1', nombre: 'Ana Torres',   email: 'ana@example.com',   telefono: '3001234567', ciudad: 'Medellín',   departamento: 'Antioquia', total: 95000,  estado: 'confirmado', created_at: '2026-04-01T10:00:00Z' },
  { id: 'p2', nombre: 'Ana Torres',   email: 'ana@example.com',   telefono: '3001234567', ciudad: 'Medellín',   departamento: 'Antioquia', total: 95000,  estado: 'enviado',    created_at: '2026-04-10T10:00:00Z' },
  { id: 'p3', nombre: 'Carlos Pérez', email: 'carlos@example.com', telefono: '3009876543', ciudad: 'Bogotá',    departamento: 'Cundinamarca', total: 95000, estado: 'pendiente',  created_at: '2026-04-05T10:00:00Z' },
  { id: 'p4', nombre: 'Sin Email',    email: null,                 telefono: null,          ciudad: 'Cali',      departamento: 'Valle',     total: 95000,  estado: 'confirmado', created_at: '2026-04-08T10:00:00Z' },
];

function event(httpMethod, opts = {}) {
  return {
    httpMethod,
    headers: opts.headers || ADMIN_HEADERS,
    queryStringParameters: {},
    body: null,
  };
}

// ─────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────
describe('get-clientes — auth', () => {
  test('sin contraseña → 401', async () => {
    const res = await handler({ httpMethod: 'GET', headers: {}, queryStringParameters: {} });
    expect(res.statusCode).toBe(401);
  });

  test('contraseña incorrecta → 401', async () => {
    const res = await handler({ httpMethod: 'GET', headers: { 'x-admin-password': 'wrong' }, queryStringParameters: {} });
    expect(res.statusCode).toBe(401);
  });

  test('método no GET → 405', async () => {
    const res = await handler(event('POST'));
    expect(res.statusCode).toBe(405);
  });
});

// ─────────────────────────────────────────────
// GET — agregar clientes
// ─────────────────────────────────────────────
describe('get-clientes — GET', () => {
  test('agrega pedidos por email → un registro por cliente', async () => {
    mockHttpsSequence(https, [{ statusCode: 200, body: PEDIDOS }]);
    const res = await handler(event('GET'));
    expect(res.statusCode).toBe(200);
    const clientes = JSON.parse(res.body);
    // Ana tiene 2 pedidos, Carlos 1, Sin Email 1
    expect(clientes).toHaveLength(3);
  });

  test('cliente con 2 pedidos → totales correctos', async () => {
    mockHttpsSequence(https, [{ statusCode: 200, body: PEDIDOS }]);
    const res = await handler(event('GET'));
    const clientes = JSON.parse(res.body);
    const ana = clientes.find(c => c.email === 'ana@example.com');
    expect(ana.total_pedidos).toBe(2);
    expect(ana.total_gastado).toBe(190000);
    expect(ana.nombre).toBe('Ana Torres');
  });

  test('cliente sin email → incluido con clave generada', async () => {
    mockHttpsSequence(https, [{ statusCode: 200, body: PEDIDOS }]);
    const res = await handler(event('GET'));
    const clientes = JSON.parse(res.body);
    const sinEmail = clientes.find(c => c.email === null);
    expect(sinEmail).toBeDefined();
    expect(sinEmail.total_pedidos).toBe(1);
  });

  test('ordenados por último pedido (más reciente primero)', async () => {
    mockHttpsSequence(https, [{ statusCode: 200, body: PEDIDOS }]);
    const res = await handler(event('GET'));
    const clientes = JSON.parse(res.body);
    // Ana tiene último pedido 2026-04-10, debe ser primero
    expect(clientes[0].email).toBe('ana@example.com');
  });

  test('sin pedidos → lista vacía', async () => {
    mockHttpsSequence(https, [{ statusCode: 200, body: [] }]);
    const res = await handler(event('GET'));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveLength(0);
  });

  test('error de Supabase → 502', async () => {
    mockHttpsSequence(https, [{ statusCode: 500, body: null }]);
    const res = await handler(event('GET'));
    expect(res.statusCode).toBe(502);
  });
});
