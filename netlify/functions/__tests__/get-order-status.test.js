'use strict';

const { EventEmitter } = require('events');

jest.mock('https');
const https = require('https');

function setupEnv() {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key';
}

function mockHttpsResponse(https, statusCode, body) {
  https.request.mockImplementation((options, callback) => {
    const mockRes = Object.assign(new EventEmitter(), { statusCode });
    const mockReq = Object.assign(new EventEmitter(), {
      write: jest.fn(),
      end: jest.fn(() => {
        process.nextTick(() => {
          if (callback) callback(mockRes);
          process.nextTick(() => {
            mockRes.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
            mockRes.emit('end');
          });
        });
      }),
    });
    return mockReq;
  });
}

setupEnv();
const { handler } = require('../get-order-status');

const SAMPLE_ORDER = {
  id: 'uuid-123',
  nombre: 'Ana García',
  estado: 'confirmado',
  mp_status: 'approved',
  items: [{ name: 'Camiseta Noir', size: 'M', price: 95000 }],
  total: 95000,
  created_at: '2026-04-01T10:00:00Z',
  tracking_number: null,
  carrier: null,
};

describe('GET /get-order-status', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('método no permitido', () => {
    it('rechaza GET', async () => {
      const res = await handler({ httpMethod: 'GET', body: null });
      expect(res.statusCode).toBe(405);
    });

    it('responde OPTIONS con 204', async () => {
      const res = await handler({ httpMethod: 'OPTIONS', body: null });
      expect(res.statusCode).toBe(204);
    });
  });

  describe('validación de email', () => {
    it('rechaza body vacío', async () => {
      const res = await handler({ httpMethod: 'POST', body: '{}' });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toMatch(/email/i);
    });

    it('rechaza email sin @', async () => {
      const res = await handler({ httpMethod: 'POST', body: JSON.stringify({ email: 'notanemail' }) });
      expect(res.statusCode).toBe(400);
    });

    it('rechaza JSON malformado', async () => {
      const res = await handler({ httpMethod: 'POST', body: 'not-json' });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('consulta exitosa', () => {
    it('devuelve pedidos para email válido', async () => {
      mockHttpsResponse(https, 200, [SAMPLE_ORDER]);
      const res = await handler({
        httpMethod: 'POST',
        body: JSON.stringify({ email: 'ana@test.com' }),
      });
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.orders).toHaveLength(1);
      expect(data.orders[0].id).toBe('uuid-123');
      expect(data.orders[0].nombre).toBe('Ana García');
    });

    it('devuelve array vacío cuando no hay pedidos', async () => {
      mockHttpsResponse(https, 200, []);
      const res = await handler({
        httpMethod: 'POST',
        body: JSON.stringify({ email: 'nadie@test.com' }),
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).orders).toHaveLength(0);
    });

    it('normaliza email a minúsculas antes de consultar', async () => {
      mockHttpsResponse(https, 200, []);
      await handler({
        httpMethod: 'POST',
        body: JSON.stringify({ email: 'ANA@TEST.COM' }),
      });
      const callPath = https.request.mock.calls[0][0].path;
      expect(callPath).toContain('ana%40test.com');
    });
  });

  describe('mapeo de estado', () => {
    it('mapea mp_status=pending → step 1', async () => {
      mockHttpsResponse(https, 200, [{ ...SAMPLE_ORDER, mp_status: 'pending', estado: 'pendiente' }]);
      const res = await handler({ httpMethod: 'POST', body: JSON.stringify({ email: 'x@x.com' }) });
      const order = JSON.parse(res.body).orders[0];
      expect(order.estado.step).toBe(1);
      expect(order.estado.label).toMatch(/proceso/i);
    });

    it('mapea estado=enviado → step 4', async () => {
      mockHttpsResponse(https, 200, [{ ...SAMPLE_ORDER, estado: 'enviado' }]);
      const res = await handler({ httpMethod: 'POST', body: JSON.stringify({ email: 'x@x.com' }) });
      expect(JSON.parse(res.body).orders[0].estado.step).toBe(4);
    });

    it('mapea estado=entregado → step 5', async () => {
      mockHttpsResponse(https, 200, [{ ...SAMPLE_ORDER, estado: 'entregado' }]);
      const res = await handler({ httpMethod: 'POST', body: JSON.stringify({ email: 'x@x.com' }) });
      expect(JSON.parse(res.body).orders[0].estado.step).toBe(5);
    });

    it('mapea mp_status=rejected → step 0', async () => {
      mockHttpsResponse(https, 200, [{ ...SAMPLE_ORDER, mp_status: 'rejected' }]);
      const res = await handler({ httpMethod: 'POST', body: JSON.stringify({ email: 'x@x.com' }) });
      expect(JSON.parse(res.body).orders[0].estado.step).toBe(0);
    });
  });

  describe('tracking', () => {
    it('incluye tracking_url para Servientrega', async () => {
      mockHttpsResponse(https, 200, [{
        ...SAMPLE_ORDER,
        estado: 'enviado',
        tracking_number: 'ABC123',
        carrier: 'servientrega',
      }]);
      const res = await handler({ httpMethod: 'POST', body: JSON.stringify({ email: 'x@x.com' }) });
      const order = JSON.parse(res.body).orders[0];
      expect(order.tracking_url).toContain('servientrega.com');
      expect(order.tracking_url).toContain('ABC123');
    });

    it('tracking_url es null para transportadora desconocida', async () => {
      mockHttpsResponse(https, 200, [{
        ...SAMPLE_ORDER,
        tracking_number: 'XYZ',
        carrier: 'desconocida',
      }]);
      const res = await handler({ httpMethod: 'POST', body: JSON.stringify({ email: 'x@x.com' }) });
      expect(JSON.parse(res.body).orders[0].tracking_url).toBeNull();
    });

    it('no expone campos sensibles de MercadoPago', async () => {
      mockHttpsResponse(https, 200, [{ ...SAMPLE_ORDER, mp_preference_id: 'PREF-SECRET' }]);
      const res = await handler({ httpMethod: 'POST', body: JSON.stringify({ email: 'x@x.com' }) });
      const body = res.body;
      expect(body).not.toContain('mp_preference_id');
      expect(body).not.toContain('PREF-SECRET');
    });
  });

  describe('error de Supabase', () => {
    it('devuelve 502 si Supabase falla', async () => {
      mockHttpsResponse(https, 500, { message: 'error' });
      const res = await handler({ httpMethod: 'POST', body: JSON.stringify({ email: 'x@x.com' }) });
      expect(res.statusCode).toBe(502);
    });
  });
});
