jest.mock('https');
const https = require('https');
const { setupEnv, mockHttpsSequence } = require('./helpers');

setupEnv();
const { handler } = require('../mp-webhook');

const ORDER = {
  id: 'order-1',
  nombre: 'Ana Torres',
  telefono: '3001234567',
  email: 'ana@example.com',
  ciudad: 'Medellín',
  departamento: 'Antioquia',
  direccion: 'Calle 1',
  items: [{ name: 'Diseño Noir', size: 'M' }],
  total: 95000,
};

// Metadata fetch que incrementStock hace para decidir si usar increment_stock_talla o no
const STOCK_META = [{ nombre: 'Diseño Noir', stock_tallas: null }];
const STOCK_META_CON_TALLAS = [{ nombre: 'Diseño Noir', stock_tallas: { M: { total: 10, vendido: 3 }, L: { total: 5, vendido: 0 } } }];

const APPROVED_PAYMENT = {
  id: 'pay-999',
  status: 'approved',
  preference_id: 'pref-abc',
  status_detail: 'accredited',
};

const REJECTED_PAYMENT = {
  id: 'pay-888',
  status: 'rejected',
  preference_id: 'pref-xyz',
};

// Respuesta de getOrder para pedido aún no procesado
const ORDER_PENDIENTE = [{ mp_payment_id: null, estado: 'pendiente' }];
// Respuesta de getOrder para pedido ya procesado (webhook duplicado)
const ORDER_YA_CONFIRMADO = [{ mp_payment_id: 'pay-999', estado: 'confirmado' }];

function postWebhook(notification) {
  return handler({ httpMethod: 'POST', body: JSON.stringify(notification), headers: {} });
}

describe('mp-webhook', () => {
  test('always returns 200 for non-POST methods', async () => {
    const res = await handler({ httpMethod: 'GET', body: '', headers: {} });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('OK');
  });

  test('invalid JSON body → 200 OK (ignored)', async () => {
    const res = await handler({ httpMethod: 'POST', body: 'bad json', headers: {} });
    expect(res.statusCode).toBe(200);
  });

  test('non-payment notification type → 200 OK (ignored)', async () => {
    const res = await postWebhook({ type: 'merchant_order', data: { id: '123' } });
    expect(res.statusCode).toBe(200);
  });

  test('payment with pending status → 200, no order update', async () => {
    // pending no pasa el filtro de aprobado/rechazado → no llega al check de idempotencia
    const pendingPayment = { id: 'pay-777', status: 'pending', preference_id: 'pref-pend' };
    mockHttpsSequence(https, [{ statusCode: 200, body: pendingPayment }]);
    const res = await postWebhook({ type: 'payment', data: { id: 'pay-777' } });
    expect(res.statusCode).toBe(200);
    expect(https.request).toHaveBeenCalledTimes(1);
  });

  test('MP fetch fails → 200, no further processing', async () => {
    mockHttpsSequence(https, [
      { statusCode: 500, body: { message: 'server error' } },
    ]);
    const res = await postWebhook({ type: 'payment', data: { id: 'pay-000' } });
    expect(res.statusCode).toBe(200);
    expect(https.request).toHaveBeenCalledTimes(1);
  });

  // ── Idempotencia ──────────────────────────────────────────────────────────

  test('webhook duplicado → 200 sin procesar (idempotencia)', async () => {
    // El pedido ya tiene mp_payment_id y estado confirmado → ignorar
    mockHttpsSequence(https, [
      { statusCode: 200, body: APPROVED_PAYMENT },    // getMPPayment
      { statusCode: 200, body: ORDER_YA_CONFIRMADO }, // getOrder → ya procesado
    ]);
    const res = await postWebhook({ type: 'payment', data: { id: 'pay-999' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('OK');
    // Solo 2 llamadas: MP fetch + getOrder — nada más se ejecuta
    expect(https.request).toHaveBeenCalledTimes(2);
  });

  test('webhook duplicado con estado revisar_stock → también se ignora', async () => {
    mockHttpsSequence(https, [
      { statusCode: 200, body: APPROVED_PAYMENT },
      { statusCode: 200, body: [{ mp_payment_id: 'pay-999', estado: 'revisar_stock' }] },
    ]);
    const res = await postWebhook({ type: 'payment', data: { id: 'pay-999' } });
    expect(res.statusCode).toBe(200);
    expect(https.request).toHaveBeenCalledTimes(2);
  });

  test('mismo preference_id pero distinto payment_id → se procesa (no es duplicado)', async () => {
    // MP puede generar un nuevo pago para la misma preferencia (reintento del comprador)
    mockHttpsSequence(https, [
      { statusCode: 200, body: { ...APPROVED_PAYMENT, id: 'pay-nuevo' } },
      { statusCode: 200, body: [{ mp_payment_id: 'pay-viejo', estado: 'confirmado' }] }, // distinto payment_id
      { statusCode: 200, body: [ORDER] },   // updateOrder
      { statusCode: 200, body: STOCK_META },// incrementStock — meta GET
      { statusCode: 200, body: true },      // incrementStock — RPC call
      { statusCode: 200, body: [] },        // getLowStockProducts
      { statusCode: 200, body: '' },        // clientEmail
      { statusCode: 200, body: '' },        // adminEmail
    ]);
    const res = await postWebhook({ type: 'payment', data: { id: 'pay-nuevo' } });
    expect(res.statusCode).toBe(200);
    expect(https.request).toHaveBeenCalledTimes(8);
  });

  // ── Flujo normal ──────────────────────────────────────────────────────────

  test('approved payment → 200, updates order and increments stock', async () => {
    // Sequence: getMPPayment, getOrder(pendiente), updateOrder,
    //           incrementStock(meta GET + RPC), getLowStockProducts, clientEmail, adminEmail
    mockHttpsSequence(https, [
      { statusCode: 200, body: APPROVED_PAYMENT },    // getMPPayment
      { statusCode: 200, body: ORDER_PENDIENTE },     // getOrder → no procesado
      { statusCode: 200, body: [ORDER] },             // updateOrder → confirmado
      { statusCode: 200, body: STOCK_META },          // incrementStock — meta GET
      { statusCode: 200, body: true },                // incrementStock — RPC → true
      { statusCode: 200, body: [] },                  // getLowStockProducts
      { statusCode: 200, body: '' },                  // clientEmail
      { statusCode: 200, body: '' },                  // adminEmail
    ]);
    const res = await postWebhook({ type: 'payment', data: { id: 'pay-999' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('OK');
    expect(https.request).toHaveBeenCalledTimes(8);
  });

  test('rejected payment → 200, updates order to pendiente, no emails', async () => {
    mockHttpsSequence(https, [
      { statusCode: 200, body: REJECTED_PAYMENT },    // getMPPayment
      { statusCode: 200, body: ORDER_PENDIENTE },     // getOrder → no procesado
      { statusCode: 200, body: [ORDER] },             // updateOrder
    ]);
    const res = await postWebhook({ type: 'payment', data: { id: 'pay-888' } });
    expect(res.statusCode).toBe(200);
    expect(https.request).toHaveBeenCalledTimes(3);
  });

  test('oversell detectado → pedido marcado como revisar_stock y alerta al admin', async () => {
    // Sequence: getMPPayment, getOrder, updateOrder(confirmado),
    //           incrementStock(meta GET + RPC→false),
    //           updateOrder(revisar_stock), oversellAlertEmail,
    //           getLowStockProducts, clientEmail, adminEmail
    mockHttpsSequence(https, [
      { statusCode: 200, body: APPROVED_PAYMENT },    // getMPPayment
      { statusCode: 200, body: ORDER_PENDIENTE },     // getOrder
      { statusCode: 200, body: [ORDER] },             // updateOrder → confirmado
      { statusCode: 200, body: STOCK_META },          // incrementStock — meta GET
      { statusCode: 200, body: false },               // incrementStock — RPC → false (agotado)
      { statusCode: 200, body: [] },                  // updateOrder → revisar_stock
      { statusCode: 200, body: '' },                  // oversellAlertEmail (Resend)
      { statusCode: 200, body: [] },                  // getLowStockProducts
      { statusCode: 200, body: '' },                  // clientEmail
      { statusCode: 200, body: '' },                  // adminEmail
    ]);
    const res = await postWebhook({ type: 'payment', data: { id: 'pay-999' } });
    expect(res.statusCode).toBe(200);
    expect(https.request).toHaveBeenCalledTimes(10);

    // Verificar que hubo dos PATCHes a Supabase (confirmado + revisar_stock)
    const patchCalls = https.request.mock.calls.filter(
      ([opts]) => opts.hostname === 'test.supabase.co' && opts.method === 'PATCH'
    );
    expect(patchCalls).toHaveLength(2);

    // El segundo PATCH debe contener estado 'revisar_stock' (índice 5)
    const secondPatchWriteBody = https.request.mock.results[5].value.write.mock.calls[0][0];
    expect(JSON.parse(secondPatchWriteBody).estado).toBe('revisar_stock');

    // El email de alerta al admin debe mencionar el producto agotado (índice 6)
    const alertWrite = https.request.mock.results[6].value.write.mock.calls[0][0];
    const alertEmail = JSON.parse(alertWrite);
    expect(alertEmail.subject).toContain('Oversell');
    expect(alertEmail.html).toContain('Diseño Noir');
    expect(alertEmail.html).toContain('revisar_stock');
  });

  test('datos de pedido con HTML malicioso son escapados en emails', async () => {
    const maliciousOrder = {
      ...ORDER,
      nombre: '<script>alert(1)</script>',
      ciudad: '<img src=x onerror=alert(1)>',
      items: [{ name: '<b>Diseño</b>', size: '"><svg/onload=alert(1)>' }],
    };
    mockHttpsSequence(https, [
      { statusCode: 200, body: APPROVED_PAYMENT },
      { statusCode: 200, body: ORDER_PENDIENTE },     // getOrder
      { statusCode: 200, body: [maliciousOrder] },    // updateOrder
      { statusCode: 200, body: STOCK_META },          // incrementStock — meta GET
      { statusCode: 200, body: true },                // incrementStock — RPC
      { statusCode: 200, body: [] },                  // getLowStockProducts
      { statusCode: 200, body: '' },                  // clientEmail
      { statusCode: 200, body: '' },                  // adminEmail
    ]);
    await postWebhook({ type: 'payment', data: { id: 'pay-999' } });

    // adminEmail es la 8va llamada (índice 7)
    const adminEmailCall = https.request.mock.results[7].value.write.mock.calls[0][0];
    const adminEmail = JSON.parse(adminEmailCall);
    expect(adminEmail.html).not.toContain('<script>');
    expect(adminEmail.html).toContain('&lt;script&gt;');
    expect(adminEmail.html).not.toContain('<img src=x');
  });

  test('envía alerta de stock bajo cuando hay productos por debajo del umbral', async () => {
    const lowStockProducts = [
      { nombre: 'Camiseta Noir', stock_total: 10, stock_vendido: 8 }, // 2 restantes
    ];
    mockHttpsSequence(https, [
      { statusCode: 200, body: APPROVED_PAYMENT },
      { statusCode: 200, body: ORDER_PENDIENTE },     // getOrder
      { statusCode: 200, body: [ORDER] },             // updateOrder
      { statusCode: 200, body: STOCK_META },          // incrementStock — meta GET
      { statusCode: 200, body: true },                // incrementStock — RPC
      { statusCode: 200, body: lowStockProducts },    // getLowStockProducts → bajo stock
      { statusCode: 200, body: '' },                  // alerta stock (Resend)
      { statusCode: 200, body: '' },                  // clientEmail
      { statusCode: 200, body: '' },                  // adminEmail
    ]);
    await postWebhook({ type: 'payment', data: { id: 'pay-999' } });
    expect(https.request).toHaveBeenCalledTimes(9);

    // alerta es la 7ma llamada (índice 6)
    const alertEmailCall = https.request.mock.results[6].value.write.mock.calls[0][0];
    const alertEmail = JSON.parse(alertEmailCall);
    expect(alertEmail.subject).toContain('Stock bajo');
    expect(alertEmail.html).toContain('Camiseta Noir');
  });

  test('email de alerta de stock agotado tiene asunto con 🔴', async () => {
    const agotadoProducts = [
      { nombre: 'Sudadera Crimson', stock_total: 5, stock_vendido: 5 }, // 0 restantes
    ];
    mockHttpsSequence(https, [
      { statusCode: 200, body: APPROVED_PAYMENT },
      { statusCode: 200, body: ORDER_PENDIENTE },     // getOrder
      { statusCode: 200, body: [ORDER] },
      { statusCode: 200, body: STOCK_META },          // incrementStock — meta GET
      { statusCode: 200, body: true },                // incrementStock — RPC
      { statusCode: 200, body: agotadoProducts },     // getLowStockProducts
      { statusCode: 200, body: '' },                  // alerta
      { statusCode: 200, body: '' },                  // clientEmail
      { statusCode: 200, body: '' },                  // adminEmail
    ]);
    await postWebhook({ type: 'payment', data: { id: 'pay-999' } });

    const alertEmailCall = https.request.mock.results[6].value.write.mock.calls[0][0];
    const alertEmail = JSON.parse(alertEmailCall);
    expect(alertEmail.subject).toContain('agotado');
    expect(alertEmail.subject).toContain('🔴');
  });

  test('no envía alerta cuando todos los productos tienen stock suficiente', async () => {
    mockHttpsSequence(https, [
      { statusCode: 200, body: APPROVED_PAYMENT },
      { statusCode: 200, body: ORDER_PENDIENTE },     // getOrder
      { statusCode: 200, body: [ORDER] },
      { statusCode: 200, body: STOCK_META },          // incrementStock — meta GET
      { statusCode: 200, body: true },                // incrementStock — RPC
      { statusCode: 200, body: [{ nombre: 'X', stock_total: 20, stock_vendido: 5 }] },
      { statusCode: 200, body: '' },                  // clientEmail
      { statusCode: 200, body: '' },                  // adminEmail
    ]);
    await postWebhook({ type: 'payment', data: { id: 'pay-999' } });
    // Sin alerta → 8 llamadas (no 9)
    expect(https.request).toHaveBeenCalledTimes(8);
  });

  // ── Email admin usa precio real ──────────────────────────────────────────────

  test('email admin usa precio calculado desde total, no hardcodeado', async () => {
    // 1 item con total 120000 → precio unitario = 120000 (≠ 95000 hardcodeado)
    const orderPrecioDistinto = { ...ORDER, total: 120000, items: [{ name: 'Diseño Noir', size: 'M' }] };
    mockHttpsSequence(https, [
      { statusCode: 200, body: APPROVED_PAYMENT },    // getMPPayment
      { statusCode: 200, body: ORDER_PENDIENTE },     // getOrder
      { statusCode: 200, body: [orderPrecioDistinto] }, // updateOrder
      { statusCode: 200, body: STOCK_META },          // incrementStock — meta GET
      { statusCode: 200, body: true },                // incrementStock — RPC
      { statusCode: 200, body: [] },                  // getLowStockProducts
      { statusCode: 200, body: '' },                  // clientEmail
      { statusCode: 200, body: '' },                  // adminEmail
    ]);
    await postWebhook({ type: 'payment', data: { id: 'pay-999' } });

    const adminEmailWrite = https.request.mock.results[7].value.write.mock.calls[0][0];
    const adminEmail = JSON.parse(adminEmailWrite);
    // Precio calculado = 120.000 COP (no hardcodeado 95.000)
    expect(adminEmail.html).toContain('120');
    expect(adminEmail.html).not.toContain('95.000</td>');
  });
});

// ── Verificación de firma MP ──────────────────────────────────────────────────

describe('mp-webhook — verificación de firma', () => {
  const SECRET = 'test-webhook-secret';
  const DATA_ID = 'pay-sig-123';
  const REQUEST_ID = 'req-abc';
  const TS = '1712345678';

  function makeSignature(dataId, requestId, ts, secret) {
    const crypto = require('crypto');
    const manifest = `id:${dataId};request-id:${requestId};ts:${ts}`;
    const v1 = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
    return `ts=${ts},v1=${v1}`;
  }

  beforeEach(() => { process.env.MP_WEBHOOK_SECRET = SECRET; });
  afterEach(() => { delete process.env.MP_WEBHOOK_SECRET; });

  test('firma válida → procesa normalmente (llama a getMPPayment)', async () => {
    const sig = makeSignature(DATA_ID, REQUEST_ID, TS, SECRET);
    mockHttpsSequence(https, [
      { statusCode: 200, body: { id: DATA_ID, status: 'pending', preference_id: 'pref-sig' } },
    ]);
    const res = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({ type: 'payment', data: { id: DATA_ID } }),
      headers: { 'x-signature': sig, 'x-request-id': REQUEST_ID },
    });
    expect(res.statusCode).toBe(200);
    expect(https.request).toHaveBeenCalledTimes(1); // getMPPayment fue invocado
  });

  test('firma inválida → 200 silencioso, no procesa nada', async () => {
    const res = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({ type: 'payment', data: { id: DATA_ID } }),
      headers: { 'x-signature': `ts=${TS},v1=firma_incorrecta_hex_padding_0000000000000000`, 'x-request-id': REQUEST_ID },
    });
    expect(res.statusCode).toBe(200);
    expect(https.request).not.toHaveBeenCalled();
  });

  test('sin x-signature cuando hay secreto → rechazado silenciosamente', async () => {
    const res = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({ type: 'payment', data: { id: DATA_ID } }),
      headers: {},
    });
    expect(res.statusCode).toBe(200);
    expect(https.request).not.toHaveBeenCalled();
  });

  test('sin MP_WEBHOOK_SECRET → fail-open, procesa sin verificar firma', async () => {
    delete process.env.MP_WEBHOOK_SECRET;
    mockHttpsSequence(https, [
      { statusCode: 200, body: { id: DATA_ID, status: 'pending', preference_id: 'pref-sig' } },
    ]);
    const res = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({ type: 'payment', data: { id: DATA_ID } }),
      headers: {}, // sin firma — pasa porque no hay secreto configurado
    });
    expect(res.statusCode).toBe(200);
    expect(https.request).toHaveBeenCalledTimes(1);
  });
});
