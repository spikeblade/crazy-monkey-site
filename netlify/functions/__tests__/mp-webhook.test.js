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
      { statusCode: 200, body: true },      // incrementStock
      { statusCode: 200, body: [] },        // getLowStockProducts
      { statusCode: 200, body: '' },        // clientEmail
      { statusCode: 200, body: '' },        // adminEmail
    ]);
    const res = await postWebhook({ type: 'payment', data: { id: 'pay-nuevo' } });
    expect(res.statusCode).toBe(200);
    expect(https.request).toHaveBeenCalledTimes(7);
  });

  // ── Flujo normal ──────────────────────────────────────────────────────────

  test('approved payment → 200, updates order and increments stock', async () => {
    // Sequence: getMPPayment, getOrder(pendiente), updateOrder, incrementStock,
    //           getLowStockProducts, clientEmail, adminEmail
    mockHttpsSequence(https, [
      { statusCode: 200, body: APPROVED_PAYMENT },    // getMPPayment
      { statusCode: 200, body: ORDER_PENDIENTE },     // getOrder → no procesado
      { statusCode: 200, body: [ORDER] },             // updateOrder → confirmado
      { statusCode: 200, body: true },                // incrementStock → true
      { statusCode: 200, body: [] },                  // getLowStockProducts
      { statusCode: 200, body: '' },                  // clientEmail
      { statusCode: 200, body: '' },                  // adminEmail
    ]);
    const res = await postWebhook({ type: 'payment', data: { id: 'pay-999' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('OK');
    expect(https.request).toHaveBeenCalledTimes(7);
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
    // Sequence: getMPPayment, getOrder, updateOrder(confirmado), incrementStock→false,
    //           updateOrder(revisar_stock), oversellAlertEmail,
    //           getLowStockProducts, clientEmail, adminEmail
    mockHttpsSequence(https, [
      { statusCode: 200, body: APPROVED_PAYMENT },    // getMPPayment
      { statusCode: 200, body: ORDER_PENDIENTE },     // getOrder
      { statusCode: 200, body: [ORDER] },             // updateOrder → confirmado
      { statusCode: 200, body: false },               // incrementStock → false (agotado)
      { statusCode: 200, body: [] },                  // updateOrder → revisar_stock
      { statusCode: 200, body: '' },                  // oversellAlertEmail (Resend)
      { statusCode: 200, body: [] },                  // getLowStockProducts
      { statusCode: 200, body: '' },                  // clientEmail
      { statusCode: 200, body: '' },                  // adminEmail
    ]);
    const res = await postWebhook({ type: 'payment', data: { id: 'pay-999' } });
    expect(res.statusCode).toBe(200);
    expect(https.request).toHaveBeenCalledTimes(9);

    // Verificar que hubo dos PATCHes a Supabase (confirmado + revisar_stock)
    const patchCalls = https.request.mock.calls.filter(
      ([opts]) => opts.hostname === 'test.supabase.co' && opts.method === 'PATCH'
    );
    expect(patchCalls).toHaveLength(2);

    // El segundo PATCH debe contener estado 'revisar_stock'
    const secondPatchWriteBody = https.request.mock.results[4].value.write.mock.calls[0][0];
    expect(JSON.parse(secondPatchWriteBody).estado).toBe('revisar_stock');

    // El email de alerta al admin debe mencionar el producto agotado
    const alertWrite = https.request.mock.results[5].value.write.mock.calls[0][0];
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
      { statusCode: 200, body: true },                // incrementStock
      { statusCode: 200, body: [] },                  // getLowStockProducts
      { statusCode: 200, body: '' },                  // clientEmail
      { statusCode: 200, body: '' },                  // adminEmail
    ]);
    await postWebhook({ type: 'payment', data: { id: 'pay-999' } });

    // adminEmail es la 7ma llamada (índice 6)
    const adminEmailCall = https.request.mock.results[6].value.write.mock.calls[0][0];
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
      { statusCode: 200, body: true },                // incrementStock
      { statusCode: 200, body: lowStockProducts },    // getLowStockProducts → bajo stock
      { statusCode: 200, body: '' },                  // alerta stock (Resend)
      { statusCode: 200, body: '' },                  // clientEmail
      { statusCode: 200, body: '' },                  // adminEmail
    ]);
    await postWebhook({ type: 'payment', data: { id: 'pay-999' } });
    expect(https.request).toHaveBeenCalledTimes(8);

    // alerta es la 6ta llamada (índice 5)
    const alertEmailCall = https.request.mock.results[5].value.write.mock.calls[0][0];
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
      { statusCode: 200, body: true },
      { statusCode: 200, body: agotadoProducts },     // getLowStockProducts
      { statusCode: 200, body: '' },                  // alerta
      { statusCode: 200, body: '' },                  // clientEmail
      { statusCode: 200, body: '' },                  // adminEmail
    ]);
    await postWebhook({ type: 'payment', data: { id: 'pay-999' } });

    const alertEmailCall = https.request.mock.results[5].value.write.mock.calls[0][0];
    const alertEmail = JSON.parse(alertEmailCall);
    expect(alertEmail.subject).toContain('agotado');
    expect(alertEmail.subject).toContain('🔴');
  });

  test('no envía alerta cuando todos los productos tienen stock suficiente', async () => {
    mockHttpsSequence(https, [
      { statusCode: 200, body: APPROVED_PAYMENT },
      { statusCode: 200, body: ORDER_PENDIENTE },     // getOrder
      { statusCode: 200, body: [ORDER] },
      { statusCode: 200, body: true },
      { statusCode: 200, body: [{ nombre: 'X', stock_total: 20, stock_vendido: 5 }] },
      { statusCode: 200, body: '' },                  // clientEmail
      { statusCode: 200, body: '' },                  // adminEmail
    ]);
    await postWebhook({ type: 'payment', data: { id: 'pay-999' } });
    // Sin alerta → 7 llamadas (no 8)
    expect(https.request).toHaveBeenCalledTimes(7);
  });
});
