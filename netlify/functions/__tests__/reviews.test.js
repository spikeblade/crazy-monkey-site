/**
 * reviews.js captures SUPABASE_URL / SUPABASE_ANON_KEY at module load.
 */
jest.mock('https');
const https = require('https');
const { setupEnv, mockHttpsSequence } = require('./helpers');

setupEnv();
const { handler } = require('../reviews');

const VALID_TOKEN = 'Bearer valid-jwt';
const USER = { id: 'user-1', email: 'fan@example.com' };
const PRODUCT = 'Diseño Noir';

describe('reviews — GET público', () => {
  test('GET reviews for product → 200 with avg', async () => {
    const reviews = [
      { estrellas: 4, comentario: 'Muy buena calidad', aprobada: true },
      { estrellas: 5, comentario: 'Excelente diseño', aprobada: true },
    ];
    mockHttpsSequence(https, [{ statusCode: 200, body: reviews }]);
    const res = await handler({
      httpMethod: 'GET',
      queryStringParameters: { producto: PRODUCT },
      headers: {},
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.reviews).toHaveLength(2);
    expect(parseFloat(data.avg)).toBe(4.5);
    expect(data.total).toBe(2);
  });

  test('GET missing producto param → 400', async () => {
    const res = await handler({
      httpMethod: 'GET',
      queryStringParameters: {},
      headers: {},
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/producto/i);
  });

  test('GET empty reviews → avg is null', async () => {
    mockHttpsSequence(https, [{ statusCode: 200, body: [] }]);
    const res = await handler({
      httpMethod: 'GET',
      queryStringParameters: { producto: PRODUCT },
      headers: {},
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.avg).toBeNull();
    expect(data.total).toBe(0);
  });
});

describe('reviews — GET admin', () => {
  function adminGet() {
    return handler({
      httpMethod: 'GET',
      queryStringParameters: {},
      headers: { 'x-admin-password': 'test-admin-pass' },
    });
  }

  test('admin GET sin producto → devuelve todas las reseñas', async () => {
    const allReviews = [
      { id: 'r1', aprobada: true, estrellas: 5 },
      { id: 'r2', aprobada: false, estrellas: 3 },
    ];
    mockHttpsSequence(https, [{ statusCode: 200, body: allReviews }]);
    const res = await adminGet();
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.reviews).toHaveLength(2);
  });

  test('sin password → GET público normal (requiere producto param)', async () => {
    const res = await handler({
      httpMethod: 'GET',
      queryStringParameters: {},
      headers: {},
    });
    expect(res.statusCode).toBe(400); // falta producto
  });
});

describe('reviews — POST', () => {
  function postReview(body, authHeader = VALID_TOKEN) {
    return handler({
      httpMethod: 'POST',
      queryStringParameters: {},
      headers: { authorization: authHeader },
      body: JSON.stringify(body),
    });
  }

  const VALID_REVIEW = {
    producto: PRODUCT,
    estrellas: 5,
    comentario: 'Me encanta este diseño, muy buena calidad.',
  };

  test('POST valid review by verified buyer → 200, aprobada false', async () => {
    mockHttpsSequence(https, [
      { statusCode: 200, body: USER },
      { statusCode: 200, body: [{ items: [{ name: PRODUCT, size: 'M' }] }] },
      { statusCode: 200, body: [] }, // no existing review
      { statusCode: 201, body: [{ id: 'rev-1', ...VALID_REVIEW, aprobada: false }] },
    ]);
    const res = await postReview(VALID_REVIEW);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).success).toBe(true);

    // Verificar que se guardó con aprobada: false
    const saveWrite = https.request.mock.results[3].value.write.mock.calls[0][0];
    const saved = JSON.parse(saveWrite);
    expect(saved.aprobada).toBe(false);
  });

  test('POST no token → 401', async () => {
    const res = await postReview(VALID_REVIEW, '');
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toMatch(/sesión/i);
  });

  test('POST invalid token → 401', async () => {
    mockHttpsSequence(https, [{ statusCode: 401, body: { message: 'Invalid JWT' } }]);
    const res = await postReview(VALID_REVIEW);
    expect(res.statusCode).toBe(401);
  });

  test('POST product not purchased → 403', async () => {
    mockHttpsSequence(https, [
      { statusCode: 200, body: USER },
      { statusCode: 200, body: [{ items: [{ name: 'Otro Diseño', size: 'L' }] }] },
    ]);
    const res = await postReview(VALID_REVIEW);
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toMatch(/comprado/i);
  });

  test('POST duplicate review → 409', async () => {
    mockHttpsSequence(https, [
      { statusCode: 200, body: USER },
      { statusCode: 200, body: [{ items: [{ name: PRODUCT, size: 'M' }] }] },
      { statusCode: 200, body: [{ id: 'existing-rev' }] },
    ]);
    const res = await postReview(VALID_REVIEW);
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toMatch(/ya dejaste/i);
  });

  test('POST estrellas out of range → 400', async () => {
    mockHttpsSequence(https, [{ statusCode: 200, body: USER }]);
    const res = await postReview({ ...VALID_REVIEW, estrellas: 6 });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/estrellas/i);
  });

  test('POST comentario too short → 400', async () => {
    mockHttpsSequence(https, [{ statusCode: 200, body: USER }]);
    const res = await postReview({ ...VALID_REVIEW, comentario: 'Corto' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/10 caracteres/i);
  });

  test('POST missing fields → 400', async () => {
    mockHttpsSequence(https, [{ statusCode: 200, body: USER }]);
    const res = await postReview({ producto: PRODUCT });
    expect(res.statusCode).toBe(400);
  });
});

describe('reviews — PATCH admin (aprobar/rechazar)', () => {
  function patchReview(id, aprobada) {
    return handler({
      httpMethod: 'PATCH',
      queryStringParameters: { id },
      headers: { 'x-admin-password': 'test-admin-pass', 'content-type': 'application/json' },
      body: JSON.stringify({ aprobada }),
    });
  }

  test('PATCH aprobar → 200', async () => {
    mockHttpsSequence(https, [{ statusCode: 200, body: [] }]);
    const res = await patchReview('rev-1', true);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).success).toBe(true);
  });

  test('PATCH rechazar → 200', async () => {
    mockHttpsSequence(https, [{ statusCode: 200, body: [] }]);
    const res = await patchReview('rev-1', false);
    expect(res.statusCode).toBe(200);
  });

  test('PATCH sin password → 401', async () => {
    const res = await handler({
      httpMethod: 'PATCH',
      queryStringParameters: { id: 'rev-1' },
      headers: {},
      body: JSON.stringify({ aprobada: true }),
    });
    expect(res.statusCode).toBe(401);
  });

  test('PATCH sin id → 400', async () => {
    const res = await handler({
      httpMethod: 'PATCH',
      queryStringParameters: {},
      headers: { 'x-admin-password': 'test-admin-pass' },
      body: JSON.stringify({ aprobada: true }),
    });
    expect(res.statusCode).toBe(400);
  });

  test('PATCH aprobada no boolean → 400', async () => {
    const res = await handler({
      httpMethod: 'PATCH',
      queryStringParameters: { id: 'rev-1' },
      headers: { 'x-admin-password': 'test-admin-pass' },
      body: JSON.stringify({ aprobada: 'si' }),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('reviews — DELETE admin', () => {
  test('DELETE con password → 200', async () => {
    mockHttpsSequence(https, [{ statusCode: 200, body: [] }]);
    const res = await handler({
      httpMethod: 'DELETE',
      queryStringParameters: { id: 'rev-1' },
      headers: { 'x-admin-password': 'test-admin-pass' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).success).toBe(true);
  });

  test('DELETE sin password → 401', async () => {
    const res = await handler({
      httpMethod: 'DELETE',
      queryStringParameters: { id: 'rev-1' },
      headers: {},
    });
    expect(res.statusCode).toBe(401);
  });

  test('DELETE sin id → 400', async () => {
    const res = await handler({
      httpMethod: 'DELETE',
      queryStringParameters: {},
      headers: { 'x-admin-password': 'test-admin-pass' },
    });
    expect(res.statusCode).toBe(400);
  });
});
