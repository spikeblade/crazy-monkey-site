'use strict';

const { EventEmitter } = require('events');

jest.mock('https');
const https = require('https');

function setupEnv() {
  process.env.SUPABASE_URL     = 'https://test.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'test-key';
  process.env.ADMIN_PASSWORD   = 'secret';
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
const { handler, _computeAnalytics } = require('../analytics');

const NOW = new Date();
const thisMonth = new Date(NOW.getFullYear(), NOW.getMonth(), 10).toISOString();
const lastMonth = new Date(NOW.getFullYear(), NOW.getMonth() - 1, 10).toISOString();

const ORDERS = [
  {
    total: 95000, created_at: thisMonth, estado: 'confirmado',
    items: [{ name: 'Noir Shirt', size: 'M' }, { name: 'Gothic Tee', size: 'S' }],
    departamento: 'Antioquia',
  },
  {
    total: 95000, created_at: thisMonth, estado: 'enviado',
    items: [{ name: 'Noir Shirt', size: 'L' }],
    departamento: 'Bogotá D.C.',
  },
  {
    total: 95000, created_at: lastMonth, estado: 'entregado',
    items: [{ name: 'Gothic Tee', size: 'M' }],
    departamento: 'Antioquia',
  },
];

describe('analytics — handler', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rechaza sin admin password', async () => {
    const res = await handler({ httpMethod: 'GET', headers: {} });
    expect(res.statusCode).toBe(401);
  });

  it('rechaza métodos distintos de GET', async () => {
    const res = await handler({ httpMethod: 'POST', headers: { 'x-admin-password': 'secret' } });
    expect(res.statusCode).toBe(405);
  });

  it('devuelve 502 si Supabase falla', async () => {
    mockResponse(https, 500, { error: 'DB error' });
    const res = await handler({ httpMethod: 'GET', headers: { 'x-admin-password': 'secret' } });
    expect(res.statusCode).toBe(502);
  });

  it('devuelve analytics correctamente', async () => {
    mockResponse(https, 200, ORDERS);
    const res = await handler({ httpMethod: 'GET', headers: { 'x-admin-password': 'secret' } });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data).toHaveProperty('resumen');
    expect(data).toHaveProperty('por_semana');
    expect(data).toHaveProperty('top_productos');
    expect(data).toHaveProperty('por_estado');
  });
});

describe('analytics — _computeAnalytics', () => {
  it('calcula ingresos totales correctamente', () => {
    const data = _computeAnalytics(ORDERS);
    expect(data.resumen.ingresos_total).toBe(285000);
  });

  it('calcula pedidos del mes actual', () => {
    const data = _computeAnalytics(ORDERS);
    expect(data.resumen.pedidos_mes).toBe(2);
    expect(data.resumen.ingresos_mes).toBe(190000);
  });

  it('calcula pedidos del mes anterior', () => {
    const data = _computeAnalytics(ORDERS);
    expect(data.resumen.pedidos_mes_anterior).toBe(1);
    expect(data.resumen.ingresos_mes_anterior).toBe(95000);
  });

  it('calcula variación porcentual vs mes anterior', () => {
    const data = _computeAnalytics(ORDERS);
    // 190000 vs 95000 → +100%
    expect(data.resumen.variacion_ingresos).toBe(100);
  });

  it('calcula ticket promedio', () => {
    const data = _computeAnalytics(ORDERS);
    expect(data.resumen.ticket_promedio).toBe(95000);
  });

  it('agrupa productos correctamente', () => {
    const data = _computeAnalytics(ORDERS);
    const noirShirt = data.top_productos.find(p => p.nombre === 'Noir Shirt');
    const gothicTee = data.top_productos.find(p => p.nombre === 'Gothic Tee');
    expect(noirShirt.unidades).toBe(2);
    expect(gothicTee.unidades).toBe(2);
  });

  it('cuenta tallas correctamente', () => {
    const data = _computeAnalytics(ORDERS);
    const m = data.tallas.find(t => t.talla === 'M');
    expect(m.cantidad).toBe(2);
  });

  it('cuenta estados correctamente', () => {
    const data = _computeAnalytics(ORDERS);
    expect(data.por_estado.confirmado).toBe(1);
    expect(data.por_estado.enviado).toBe(1);
    expect(data.por_estado.entregado).toBe(1);
  });

  it('agrupa departamentos correctamente', () => {
    const data = _computeAnalytics(ORDERS);
    const antioquia = data.top_departamentos.find(d => d.departamento === 'Antioquia');
    expect(antioquia.pedidos).toBe(2);
  });

  it('devuelve 8 semanas en por_semana', () => {
    const data = _computeAnalytics(ORDERS);
    expect(data.por_semana).toHaveLength(8);
  });

  it('variacion_ingresos es null sin datos del mes anterior', () => {
    const soloEsteMes = ORDERS.filter(o => o.created_at === thisMonth);
    const data = _computeAnalytics(soloEsteMes);
    expect(data.resumen.variacion_ingresos).toBeNull();
  });

  it('top_productos limitado a 6', () => {
    const muchos = Array.from({ length: 10 }, (_, i) => ({
      total: 95000, created_at: thisMonth, estado: 'confirmado',
      items: [{ name: `Producto ${i}`, size: 'M' }], departamento: 'Antioquia',
    }));
    const data = _computeAnalytics(muchos);
    expect(data.top_productos.length).toBeLessThanOrEqual(6);
  });

  it('maneja pedidos sin items graciosamente', () => {
    const sinItems = [{ total: 50000, created_at: thisMonth, estado: 'confirmado', items: null, departamento: 'Valle' }];
    expect(() => _computeAnalytics(sinItems)).not.toThrow();
  });
});
