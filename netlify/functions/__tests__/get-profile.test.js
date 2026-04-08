jest.mock('https');
const https = require('https');
const { setupEnv, mockHttpsSequence } = require('./helpers');

setupEnv();
const { handler } = require('../get-profile');

const USER = { id: 'user-1', email: 'fan@example.com' };
const PROFILE = {
  id: 'user-1',
  nombre: 'Fan Eterno',
  telefono: '3009876543',
  ciudad: 'Medellín',
  departamento: 'Antioquia',
  direccion: 'Calle 2 #10-30',
};

function get(authHeader) {
  return handler({
    httpMethod: 'GET',
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

describe('get-profile', () => {
  test('GET with valid token → 200 with profile and email', async () => {
    mockHttpsSequence(https, [
      { statusCode: 200, body: USER },
      { statusCode: 200, body: [PROFILE] },
    ]);
    const res = await get('Bearer valid-jwt');
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.email).toBe(USER.email);
    expect(data.userId).toBe(USER.id);
    expect(data.profile).toEqual(PROFILE);
  });

  test('GET with valid token but no profile → profile is null', async () => {
    mockHttpsSequence(https, [
      { statusCode: 200, body: USER },
      { statusCode: 200, body: [] }, // no profile row
    ]);
    const res = await get('Bearer valid-jwt');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).profile).toBeNull();
  });

  test('GET no authorization header → 401', async () => {
    const res = await get(null);
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toMatch(/token/i);
  });

  test('GET invalid token → 401', async () => {
    mockHttpsSequence(https, [{ statusCode: 401, body: { message: 'Invalid JWT' } }]);
    const res = await get('Bearer invalid-jwt');
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toMatch(/invalid token/i);
  });

  test('non-GET method → 405', async () => {
    const res = await handler({ httpMethod: 'POST', headers: {} });
    expect(res.statusCode).toBe(405);
  });
});
