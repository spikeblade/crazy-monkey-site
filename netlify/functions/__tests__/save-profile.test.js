jest.mock('https');
const https = require('https');
const { setupEnv, mockHttpsSequence } = require('./helpers');

setupEnv();
const { handler } = require('../save-profile');

const USER = { id: 'user-1', email: 'fan@example.com' };

const VALID_PROFILE = {
  nombre: 'Fan Eterno',
  telefono: '3009876543',
  departamento: 'Antioquia',
  ciudad: 'Medellín',
  barrio: 'El Poblado',
  direccion: 'Calle 2 #10-30',
};

function post(body, token = 'Bearer valid-jwt') {
  return handler({
    httpMethod: 'POST',
    headers: { authorization: token },
    body: JSON.stringify(body),
  });
}

describe('save-profile', () => {
  test('POST válido → 200', async () => {
    mockHttpsSequence(https, [
      { statusCode: 200, body: USER },           // verifyToken
      { statusCode: 200, body: [VALID_PROFILE] }, // upsertProfile
    ]);
    const res = await post(VALID_PROFILE);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).success).toBe(true);
  });

  test('barrio se incluye en el upsert', async () => {
    mockHttpsSequence(https, [
      { statusCode: 200, body: USER },
      { statusCode: 200, body: [VALID_PROFILE] },
    ]);
    await post(VALID_PROFILE);

    const upsertWrite = https.request.mock.results[1].value.write.mock.calls[0][0];
    const upsertBody = JSON.parse(upsertWrite);
    expect(upsertBody.barrio).toBe('El Poblado');
  });

  test('campos no permitidos son descartados (ej: id, role)', async () => {
    mockHttpsSequence(https, [
      { statusCode: 200, body: USER },
      { statusCode: 200, body: [VALID_PROFILE] },
    ]);
    await post({ ...VALID_PROFILE, id: 'otro-user', role: 'admin' });

    const upsertWrite = https.request.mock.results[1].value.write.mock.calls[0][0];
    const upsertBody = JSON.parse(upsertWrite);
    expect(upsertBody.id).toBe(USER.id); // id siempre viene del token, no del body
    expect(upsertBody.role).toBeUndefined();
  });

  test('token inválido → 401', async () => {
    mockHttpsSequence(https, [
      { statusCode: 401, body: { message: 'Invalid JWT' } },
    ]);
    const res = await post(VALID_PROFILE);
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toMatch(/invalid token/i);
  });

  test('sin token → 401', async () => {
    const res = await handler({
      httpMethod: 'POST',
      headers: {},
      body: JSON.stringify(VALID_PROFILE),
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toMatch(/token/i);
  });

  test('JSON inválido → 400', async () => {
    const res = await handler({
      httpMethod: 'POST',
      headers: { authorization: 'Bearer valid-jwt' },
      body: 'not-json',
    });
    // verifyToken se llama primero — mockeamos respuesta válida
    mockHttpsSequence(https, [{ statusCode: 200, body: USER }]);
    const res2 = await handler({
      httpMethod: 'POST',
      headers: { authorization: 'Bearer valid-jwt' },
      body: 'not-json',
    });
    expect(res2.statusCode).toBe(400);
  });

  test('non-POST → 405', async () => {
    const res = await handler({ httpMethod: 'GET', headers: {} });
    expect(res.statusCode).toBe(405);
  });
});
