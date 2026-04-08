jest.mock('https');
const https = require('https');
const { setupEnv, mockHttpsSequence } = require('./helpers');

setupEnv();
const { handler } = require('../send-contact');

const VALID_BODY = {
  nombre: 'María López',
  email: 'maria@example.com',
  telefono: '3001112233',
  asunto: 'Consulta sobre tallas',
  mensaje: 'Hola, quiero saber si tienen talla XL disponible.',
};

function post(body) {
  return handler({ httpMethod: 'POST', body: JSON.stringify(body), headers: {} });
}

describe('send-contact', () => {
  test('POST valid contact form → 200 success', async () => {
    // First call: send to admin (blocks response); second: confirmation to sender (fire-and-forget)
    mockHttpsSequence(https, [
      { statusCode: 200, body: { id: 'email-1' } },
      { statusCode: 200, body: '' }, // confirmation email
    ]);
    const res = await post(VALID_BODY);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).success).toBe(true);
  });

  test('POST missing required field → 400', async () => {
    const res = await post({ nombre: 'María', email: 'maria@example.com', mensaje: 'Consulta larga' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/campos/i);
  });

  test('POST invalid email → 400', async () => {
    const res = await post({ ...VALID_BODY, email: 'not-an-email' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/email/i);
  });

  test('POST message too short → 400', async () => {
    const res = await post({ ...VALID_BODY, mensaje: 'Corto' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/corto/i);
  });

  test('POST invalid JSON → 400', async () => {
    const res = await handler({ httpMethod: 'POST', body: 'not-json', headers: {} });
    expect(res.statusCode).toBe(400);
  });

  test('Resend API failure → 502', async () => {
    mockHttpsSequence(https, [{ statusCode: 422, body: { message: 'invalid recipient' } }]);
    const res = await post(VALID_BODY);
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error).toMatch(/enviando/i);
  });

  test('non-POST method → 405', async () => {
    const res = await handler({ httpMethod: 'GET', body: '{}', headers: {} });
    expect(res.statusCode).toBe(405);
  });
});
