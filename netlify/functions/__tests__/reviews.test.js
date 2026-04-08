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

describe('reviews — GET', () => {
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

  test('POST valid review by verified buyer → 200', async () => {
    // Sequence: verifyToken, get orders (has product), check existing review (none), save review
    mockHttpsSequence(https, [
      { statusCode: 200, body: USER },
      { statusCode: 200, body: [{ items: [{ name: PRODUCT, size: 'M' }] }] },
      { statusCode: 200, body: [] }, // no existing review
      { statusCode: 201, body: [{ id: 'rev-1', ...VALID_REVIEW }] },
    ]);
    const res = await postReview(VALID_REVIEW);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).success).toBe(true);
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
      { statusCode: 200, body: [{ id: 'existing-rev' }] }, // already reviewed
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
