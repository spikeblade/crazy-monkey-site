'use strict';

const { EventEmitter } = require('events');

jest.mock('https');
const https = require('https');

function setupEnv() {
  process.env.SUPABASE_URL    = 'https://test.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'test-key';
  process.env.ADMIN_PASSWORD  = 'secret';
}

function mockResponse(https, statusCode, body) {
  https.request.mockImplementation((options, callback) => {
    const mockRes = Object.assign(new EventEmitter(), { statusCode });
    const mockReq = Object.assign(new EventEmitter(), {
      write: jest.fn(),
      end: jest.fn(() => {
        process.nextTick(() => {
          if (callback) callback(mockRes);
          process.nextTick(() => {
            mockRes.emit('data', JSON.stringify(body));
            mockRes.emit('end');
          });
        });
      }),
    });
    return mockReq;
  });
}

setupEnv();
const { handler } = require('../taxonomias');

const ADMIN_HEADERS = { 'x-admin-password': 'secret' };

describe('taxonomias', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('OPTIONS', () => {
    it('responde 204', async () => {
      const res = await handler({ httpMethod: 'OPTIONS' });
      expect(res.statusCode).toBe(204);
    });
  });

  describe('GET', () => {
    it('devuelve lista de colecciones', async () => {
      const data = [{ id: 'uuid-1', nombre: 'Collection Noir', orden: 1 }];
      mockResponse(https, 200, data);
      const res = await handler({
        httpMethod: 'GET',
        queryStringParameters: { tipo: 'colecciones' },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual(data);
    });

    it('devuelve lista de categorias', async () => {
      const data = [{ id: 'uuid-2', nombre: 'Noir', slug: 'noir', orden: 1 }];
      mockResponse(https, 200, data);
      const res = await handler({
        httpMethod: 'GET',
        queryStringParameters: { tipo: 'categorias' },
      });
      expect(res.statusCode).toBe(200);
    });

    it('rechaza tipo inválido', async () => {
      const res = await handler({
        httpMethod: 'GET',
        queryStringParameters: { tipo: 'invalido' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rechaza sin tipo', async () => {
      const res = await handler({ httpMethod: 'GET', queryStringParameters: {} });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST', () => {
    it('rechaza sin admin password', async () => {
      const res = await handler({
        httpMethod: 'POST',
        headers: {},
        body: JSON.stringify({ tipo: 'colecciones', nombre: 'Nueva' }),
      });
      expect(res.statusCode).toBe(401);
    });

    it('crea colección correctamente', async () => {
      mockResponse(https, 201, [{ id: 'new-id', nombre: 'Nueva Colección' }]);
      const res = await handler({
        httpMethod: 'POST',
        headers: ADMIN_HEADERS,
        body: JSON.stringify({ tipo: 'colecciones', nombre: 'Nueva Colección' }),
      });
      expect(res.statusCode).toBe(201);
    });

    it('crea categoría y genera slug automáticamente', async () => {
      mockResponse(https, 201, [{ id: 'cat-id', nombre: 'Dark Gothic', slug: 'dark-gothic' }]);
      const res = await handler({
        httpMethod: 'POST',
        headers: ADMIN_HEADERS,
        body: JSON.stringify({ tipo: 'categorias', nombre: 'Dark Gothic' }),
      });
      expect(res.statusCode).toBe(201);
      // Verifica que se pasó slug en el body al Supabase
      const reqBody = JSON.parse(https.request.mock.results[0].value.write.mock.calls[0][0]);
      expect(reqBody.slug).toBe('dark-gothic');
    });

    it('rechaza nombre vacío', async () => {
      const res = await handler({
        httpMethod: 'POST',
        headers: ADMIN_HEADERS,
        body: JSON.stringify({ tipo: 'categorias', nombre: '' }),
      });
      expect(res.statusCode).toBe(400);
    });

    it('rechaza tipo inválido en body', async () => {
      const res = await handler({
        httpMethod: 'POST',
        headers: ADMIN_HEADERS,
        body: JSON.stringify({ tipo: 'usuarios', nombre: 'Hack' }),
      });
      expect(res.statusCode).toBe(400);
    });

    it('slug normaliza acentos y espacios', async () => {
      mockResponse(https, 201, [{}]);
      await handler({
        httpMethod: 'POST',
        headers: ADMIN_HEADERS,
        body: JSON.stringify({ tipo: 'categorias', nombre: 'Gótico & Oscuro' }),
      });
      const reqBody = JSON.parse(https.request.mock.results[0].value.write.mock.calls[0][0]);
      expect(reqBody.slug).toBe('gotico-oscuro');
    });
  });

  describe('PATCH', () => {
    it('rechaza sin id', async () => {
      const res = await handler({
        httpMethod: 'PATCH',
        headers: ADMIN_HEADERS,
        queryStringParameters: { tipo: 'colecciones' },
        body: JSON.stringify({ nombre: 'Actualizado' }),
      });
      expect(res.statusCode).toBe(400);
    });

    it('actualiza colección', async () => {
      mockResponse(https, 200, [{ id: 'uuid-1', nombre: 'Actualizado' }]);
      const res = await handler({
        httpMethod: 'PATCH',
        headers: ADMIN_HEADERS,
        queryStringParameters: { tipo: 'colecciones', id: 'uuid-1' },
        body: JSON.stringify({ activo: false }),
      });
      expect(res.statusCode).toBe(200);
    });

    it('actualizar nombre de categoría actualiza el slug', async () => {
      mockResponse(https, 200, [{}]);
      await handler({
        httpMethod: 'PATCH',
        headers: ADMIN_HEADERS,
        queryStringParameters: { tipo: 'categorias', id: 'uuid-2' },
        body: JSON.stringify({ nombre: 'Nuevo Nombre' }),
      });
      const reqBody = JSON.parse(https.request.mock.results[0].value.write.mock.calls[0][0]);
      expect(reqBody.slug).toBe('nuevo-nombre');
    });

    it('no permite modificar campos fuera de la lista blanca', async () => {
      mockResponse(https, 200, [{}]);
      await handler({
        httpMethod: 'PATCH',
        headers: ADMIN_HEADERS,
        queryStringParameters: { tipo: 'colecciones', id: 'uuid-1' },
        body: JSON.stringify({ id: 'hacked', nombre: 'OK' }),
      });
      const reqBody = JSON.parse(https.request.mock.results[0].value.write.mock.calls[0][0]);
      expect(reqBody.id).toBeUndefined();
      expect(reqBody.nombre).toBe('OK');
    });
  });

  describe('DELETE', () => {
    it('elimina por id y tipo', async () => {
      mockResponse(https, 204, []);
      const res = await handler({
        httpMethod: 'DELETE',
        headers: ADMIN_HEADERS,
        queryStringParameters: { tipo: 'categorias', id: 'uuid-2' },
      });
      expect(res.statusCode).toBe(200);
    });

    it('rechaza DELETE sin autenticación', async () => {
      const res = await handler({
        httpMethod: 'DELETE',
        headers: {},
        queryStringParameters: { tipo: 'categorias', id: 'uuid-2' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('método no permitido', () => {
    it('devuelve 405 para PUT', async () => {
      const res = await handler({ httpMethod: 'PUT', headers: ADMIN_HEADERS, queryStringParameters: {} });
      expect(res.statusCode).toBe(405);
    });
  });
});
