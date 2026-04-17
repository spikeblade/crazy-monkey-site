jest.mock('https');
const https = require('https');
const { setupEnv, mockHttpsSequence } = require('./helpers');

setupEnv();
const { handler } = require('../upload-imagen');

const VALID_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function makeEvent(overrides = {}) {
  return {
    httpMethod: 'POST',
    headers: { 'x-admin-password': 'test-admin-pass' },
    body: JSON.stringify({
      filename: 'test-shirt.png',
      content: VALID_PNG_BASE64,
      contentType: 'image/png',
    }),
    ...overrides,
  };
}

describe('upload-imagen', () => {
  test('POST imagen válida → 200 con url pública', async () => {
    mockHttpsSequence(https, [{ statusCode: 200, body: { Key: 'productos/test.png' } }]);
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.url).toMatch(/storage\/v1\/object\/public\/productos\//);
    expect(body.url).toContain('test-shirt.png');
  });

  test('GET → 405', async () => {
    const res = await handler(makeEvent({ httpMethod: 'GET' }));
    expect(res.statusCode).toBe(405);
  });

  test('Sin header de admin → 401', async () => {
    const res = await handler(makeEvent({ headers: {} }));
    expect(res.statusCode).toBe(401);
  });

  test('Contraseña incorrecta → 401', async () => {
    const res = await handler(makeEvent({ headers: { 'x-admin-password': 'wrong' } }));
    expect(res.statusCode).toBe(401);
  });

  test('JSON inválido → 400', async () => {
    const res = await handler(makeEvent({ body: 'not-json' }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/JSON/i);
  });

  test('Faltan campos → 400', async () => {
    const res = await handler(makeEvent({ body: JSON.stringify({ filename: 'test.png' }) }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/campos/i);
  });

  test('Tipo de archivo no permitido → 400', async () => {
    const res = await handler(makeEvent({
      body: JSON.stringify({ filename: 'doc.pdf', content: VALID_PNG_BASE64, contentType: 'application/pdf' }),
    }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/tipo/i);
  });

  test('Imagen demasiado grande → 400', async () => {
    const bigContent = Buffer.alloc(6 * 1024 * 1024).toString('base64');
    const res = await handler(makeEvent({
      body: JSON.stringify({ filename: 'big.png', content: bigContent, contentType: 'image/png' }),
    }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/grande/i);
  });

  test('Error en Supabase Storage → 502', async () => {
    mockHttpsSequence(https, [{ statusCode: 400, body: { message: 'Bucket not found' } }]);
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error).toMatch(/error subiendo/i);
  });

  test('Nombre de archivo con caracteres especiales es sanitizado', async () => {
    mockHttpsSequence(https, [{ statusCode: 200, body: { Key: 'productos/test.png' } }]);
    const res = await handler(makeEvent({
      body: JSON.stringify({
        filename: 'mi foto bonita (1).PNG',
        content: VALID_PNG_BASE64,
        contentType: 'image/png',
      }),
    }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.url).not.toContain(' ');
    expect(body.url).not.toContain('(');
    expect(body.url).toMatch(/\.png$/);
  });

  test('URL pública tiene el formato correcto de Supabase Storage', async () => {
    mockHttpsSequence(https, [{ statusCode: 200, body: { Key: 'productos/test.png' } }]);
    const res = await handler(makeEvent());
    const body = JSON.parse(res.body);
    expect(body.url).toMatch(/^https:\/\/test\.supabase\.co\/storage\/v1\/object\/public\/productos\//);
  });

  test('bucket "artes" acepta PDF y sube con límite de 20MB', async () => {
    mockHttpsSequence(https, [{ statusCode: 200, body: { Key: 'artes/etiqueta.pdf' } }]);
    const pdfBase64 = Buffer.alloc(100).toString('base64');
    const res = await handler(makeEvent({
      body: JSON.stringify({ filename: 'etiqueta.pdf', content: pdfBase64, contentType: 'application/pdf', bucket: 'artes' }),
    }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.url).toMatch(/\/public\/artes\//);
  });

  test('bucket "artes" rechaza PDF en bucket "productos"', async () => {
    const res = await handler(makeEvent({
      body: JSON.stringify({ filename: 'etiqueta.pdf', content: Buffer.alloc(100).toString('base64'), contentType: 'application/pdf', bucket: 'productos' }),
    }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/tipo/i);
  });

  test('bucket inválido → 400', async () => {
    const res = await handler(makeEvent({
      body: JSON.stringify({ filename: 'test.png', content: VALID_PNG_BASE64, contentType: 'image/png', bucket: 'malicioso' }),
    }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/bucket/i);
  });
});
