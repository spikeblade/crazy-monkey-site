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

  test('approved payment → 200, updates order and increments stock', async () => {
    // Sequence: getMPPayment, updateOrder, incrementStock, getLowStockProducts, sendClientConfirmation, sendEmail (admin)
    mockHttpsSequence(https, [
      { statusCode: 200, body: APPROVED_PAYMENT },      // MP payment fetch
      { statusCode: 200, body: [ORDER] },               // Supabase PATCH order
      { statusCode: 200, body: true },                  // increment_stock RPC → true (éxito)
      { statusCode: 200, body: [] },                    // getLowStockProducts (sin stock bajo)
      { statusCode: 200, body: '' },                    // client email (Resend)
      { statusCode: 200, body: '' },                    // admin email (Resend)
    ]);
    const res = await postWebhook({ type: 'payment', data: { id: 'pay-999' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('OK');
    expect(https.request).toHaveBeenCalledTimes(6);
  });

  test('oversell detectado → pedido marcado como revisar_stock', async () => {
    // increment_stock retorna false → race condition ganada por otro comprador
    // Sequence: getMPPayment, updateOrder(confirmado), incrementStock→false,
    //           updateOrder(revisar_stock), getLowStockProducts, clientEmail, adminEmail
    mockHttpsSequence(https, [
      { statusCode: 200, body: APPROVED_PAYMENT },      // MP payment fetch
      { statusCode: 200, body: [ORDER] },               // updateOrder → confirmado
      { statusCode: 200, body: false },                 // increment_stock → false (agotado)
      { statusCode: 200, body: [] },                    // updateOrder → revisar_stock
      { statusCode: 200, body: [] },                    // getLowStockProducts
      { statusCode: 200, body: '' },                    // client email
      { statusCode: 200, body: '' },                    // admin email
    ]);
    const res = await postWebhook({ type: 'payment', data: { id: 'pay-999' } });
    expect(res.statusCode).toBe(200);
    expect(https.request).toHaveBeenCalledTimes(7);

    // Verificar que hubo dos PATCHes a Supabase (confirmado + revisar_stock)
    const patchCalls = https.request.mock.calls.filter(
      ([opts]) => opts.hostname === 'test.supabase.co' && opts.method === 'PATCH'
    );
    expect(patchCalls).toHaveLength(2);

    // El segundo PATCH (índice 3 del total) debe contener estado 'revisar_stock'
    const secondPatchWriteBody = https.request.mock.results[3].value.write.mock.calls[0][0];
    expect(JSON.parse(secondPatchWriteBody).estado).toBe('revisar_stock');
  });

  test('rejected payment → 200, updates order to pendiente, no emails', async () => {
    mockHttpsSequence(https, [
      { statusCode: 200, body: REJECTED_PAYMENT },
      { statusCode: 200, body: [ORDER] },               // Supabase PATCH
    ]);
    const res = await postWebhook({ type: 'payment', data: { id: 'pay-888' } });
    expect(res.statusCode).toBe(200);
    // Only 2 calls: MP fetch + order update (no stock/email for rejected)
    expect(https.request).toHaveBeenCalledTimes(2);
  });

  test('MP fetch fails → 200, no further processing', async () => {
    mockHttpsSequence(https, [
      { statusCode: 500, body: { message: 'server error' } },
    ]);
    const res = await postWebhook({ type: 'payment', data: { id: 'pay-000' } });
    expect(res.statusCode).toBe(200);
    expect(https.request).toHaveBeenCalledTimes(1);
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
      { statusCode: 200, body: [maliciousOrder] },
      { statusCode: 200, body: true }, // increment_stock RPC → true (éxito)
      { statusCode: 200, body: [] }, // getLowStockProducts
      { statusCode: 200, body: '' }, // client email
      { statusCode: 200, body: '' }, // admin email
    ]);
    await postWebhook({ type: 'payment', data: { id: 'pay-999' } });

    // Verificar email al admin (6ta llamada)
    const adminEmailCall = https.request.mock.results[5].value.write.mock.calls[0][0];
    const adminEmail = JSON.parse(adminEmailCall);
    expect(adminEmail.html).not.toContain('<script>');
    expect(adminEmail.html).toContain('&lt;script&gt;');
    expect(adminEmail.html).not.toContain('<img src=x');
  });

  test('envía alerta de stock bajo cuando hay productos por debajo del umbral', async () => {
    const lowStockProducts = [
      { nombre: 'Camiseta Noir', stock_total: 10, stock_vendido: 8 },  // 2 restantes
    ];
    mockHttpsSequence(https, [
      { statusCode: 200, body: APPROVED_PAYMENT },
      { statusCode: 200, body: [ORDER] },
      { statusCode: 200, body: '' },               // increment_stock
      { statusCode: 200, body: lowStockProducts }, // getLowStockProducts → bajo stock
      { statusCode: 200, body: '' },               // alerta stock (Resend)
      { statusCode: 200, body: '' },               // client email
      { statusCode: 200, body: '' },               // admin email
    ]);
    await postWebhook({ type: 'payment', data: { id: 'pay-999' } });
    expect(https.request).toHaveBeenCalledTimes(7);

    // Verificar que el email de alerta fue enviado (5ta llamada = índice 4)
    const alertEmailCall = https.request.mock.results[4].value.write.mock.calls[0][0];
    const alertEmail = JSON.parse(alertEmailCall);
    expect(alertEmail.subject).toContain('Stock bajo');
    expect(alertEmail.html).toContain('Camiseta Noir');
  });

  test('email de alerta de stock agotado tiene asunto con 🔴', async () => {
    const agotadoProducts = [
      { nombre: 'Sudadera Crimson', stock_total: 5, stock_vendido: 5 },  // 0 restantes
    ];
    mockHttpsSequence(https, [
      { statusCode: 200, body: APPROVED_PAYMENT },
      { statusCode: 200, body: [ORDER] },
      { statusCode: 200, body: '' },
      { statusCode: 200, body: agotadoProducts },
      { statusCode: 200, body: '' }, // alerta
      { statusCode: 200, body: '' }, // client email
      { statusCode: 200, body: '' }, // admin email
    ]);
    await postWebhook({ type: 'payment', data: { id: 'pay-999' } });

    const alertEmailCall = https.request.mock.results[4].value.write.mock.calls[0][0];
    const alertEmail = JSON.parse(alertEmailCall);
    expect(alertEmail.subject).toContain('agotado');
    expect(alertEmail.subject).toContain('🔴');
  });

  test('no envía alerta cuando todos los productos tienen stock suficiente', async () => {
    mockHttpsSequence(https, [
      { statusCode: 200, body: APPROVED_PAYMENT },
      { statusCode: 200, body: [ORDER] },
      { statusCode: 200, body: '' },
      { statusCode: 200, body: [{ nombre: 'X', stock_total: 20, stock_vendido: 5 }] }, // 15 restantes
      { statusCode: 200, body: '' }, // client email
      { statusCode: 200, body: '' }, // admin email
    ]);
    await postWebhook({ type: 'payment', data: { id: 'pay-999' } });
    // Sin alerta → 6 llamadas (no 7)
    expect(https.request).toHaveBeenCalledTimes(6);
  });

  test('payment with pending status → 200, no order update', async () => {
    const pendingPayment = { id: 'pay-777', status: 'pending', preference_id: 'pref-pend' };
    mockHttpsSequence(https, [{ statusCode: 200, body: pendingPayment }]);
    const res = await postWebhook({ type: 'payment', data: { id: 'pay-777' } });
    expect(res.statusCode).toBe(200);
    // Only the MP fetch call — pending status is ignored
    expect(https.request).toHaveBeenCalledTimes(1);
  });
});
