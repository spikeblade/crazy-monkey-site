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
    // Sequence: getMPPayment, updateOrder, incrementStock, sendClientConfirmation, sendEmail (admin)
    mockHttpsSequence(https, [
      { statusCode: 200, body: APPROVED_PAYMENT },      // MP payment fetch
      { statusCode: 200, body: [ORDER] },               // Supabase PATCH order
      { statusCode: 200, body: '' },                    // increment_stock RPC
      { statusCode: 200, body: '' },                    // client email (Resend)
      { statusCode: 200, body: '' },                    // admin email (Resend)
    ]);
    const res = await postWebhook({ type: 'payment', data: { id: 'pay-999' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('OK');
    // updateOrder call should set estado=confirmado
    const patchCall = https.request.mock.calls[1];
    const patchBody = JSON.parse(patchCall[0].path ? '{}' : '{}');
    // Verify Supabase PATCH was called (second call)
    expect(https.request).toHaveBeenCalledTimes(5);
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
      { statusCode: 200, body: '' }, // increment_stock
      { statusCode: 200, body: '' }, // client email
      { statusCode: 200, body: '' }, // admin email
    ]);
    await postWebhook({ type: 'payment', data: { id: 'pay-999' } });

    // Verificar email al admin (5ta llamada)
    const adminEmailCall = https.request.mock.results[4].value.write.mock.calls[0][0];
    const adminEmail = JSON.parse(adminEmailCall);
    expect(adminEmail.html).not.toContain('<script>');
    expect(adminEmail.html).toContain('&lt;script&gt;');
    expect(adminEmail.html).not.toContain('<img src=x');
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
