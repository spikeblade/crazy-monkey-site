jest.mock('https');
const https = require('https');
const { setupEnv, mockHttpsSequence } = require('./helpers');

setupEnv();
const { handler } = require('../save-order');

const BASE_BODY = {
  nombre: 'Ana Torres',
  telefono: '3001234567',
  departamento: 'Antioquia',
  ciudad: 'Medellín',
  items: [{ name: 'Diseño Noir', size: 'M' }],
  total: 95000,
};

function post(body) {
  return handler({ httpMethod: 'POST', body: JSON.stringify(body) });
}

describe('save-order', () => {
  test('POST valid order → 200 with order_id', async () => {
    mockHttpsSequence(https, [{ statusCode: 201, body: [{ id: 'order-42' }] }]);
    const res = await post(BASE_BODY);
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.success).toBe(true);
    expect(data.order_id).toBe('order-42');
    expect(data.wa_message).toBeDefined();
  });

  test('POST missing required fields → 400', async () => {
    const res = await post({ nombre: 'Ana', telefono: '3001234567' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/campos obligatorios/);
  });

  test('POST invalid JSON → 400', async () => {
    const res = await handler({ httpMethod: 'POST', body: 'not-json' });
    expect(res.statusCode).toBe(400);
  });

  test('POST non-POST method → 405', async () => {
    const res = await handler({ httpMethod: 'GET', body: '{}' });
    expect(res.statusCode).toBe(405);
  });

  test('POST Supabase error → 502', async () => {
    mockHttpsSequence(https, [{ statusCode: 400, body: { message: 'db error' } }]);
    const res = await post(BASE_BODY);
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error).toMatch(/guardando/i);
  });

  test('approved mp_status → estado confirmado', async () => {
    mockHttpsSequence(https, [{ statusCode: 201, body: [{ id: 'order-99' }] }]);
    const res = await post({ ...BASE_BODY, mp_status: 'approved' });
    expect(res.statusCode).toBe(200);
    // verify the request body sent to Supabase contained estado=confirmado
    const written = https.request.mock.results[0].value.write.mock.calls[0][0];
    expect(JSON.parse(written).estado).toBe('confirmado');
  });
});
