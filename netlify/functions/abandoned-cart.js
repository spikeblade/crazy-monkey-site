/**
 * Scheduled function: detecta carritos abandonados y envía email de recuperación.
 *
 * Requisito previo en Supabase:
 *   ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS recovery_sent boolean DEFAULT false;
 *
 * Se ejecuta cada 2 horas vía Netlify Scheduled Functions (ver netlify.toml).
 * También puede dispararse manualmente con GET + x-admin-password.
 */
const https = require('https');
const { escapeHtml: h } = require('./lib/escape-html');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

function supabaseRequest(path, method = 'GET', body = null) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
  const bodyStr = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };
    const req = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: d ? JSON.parse(d) : [] }); }
        catch { resolve({ status: res.statusCode, body: [] }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function getAbandonedOrders() {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Pedidos pending con email, sin recovery enviado, entre 2 y 24 horas de antigüedad
  const query = `pedidos?mp_status=eq.pending&email=not.is.null&recovery_sent=not.eq.true&created_at=lte.${encodeURIComponent(twoHoursAgo)}&created_at=gte.${encodeURIComponent(twentyFourHoursAgo)}&select=id,nombre,email,items,total,created_at`;
  return supabaseRequest(query);
}

function markRecoverySent(orderId) {
  return supabaseRequest(`pedidos?id=eq.${orderId}`, 'PATCH', { recovery_sent: true });
} 

function sendRecoveryEmail(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const itemsHtml = items.map(i => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:.7rem 0;border-bottom:1px solid #1a1a1a">
      <span style="color:#d9cdb8;font-size:.8rem">${h(i.name)}</span>
      <span style="color:#b01a1a;font-size:.7rem;font-weight:bold">Talla ${h(i.size)}</span>
    </div>`).join('');

  const storeUrl = process.env.SITE_URL || 'https://crazymonkey.store';

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="background:#080808;color:#d9cdb8;font-family:monospace;margin:0;padding:0">
  <div style="max-width:520px;margin:0 auto;padding:2rem">

    <div style="border-bottom:3px solid #b01a1a;padding-bottom:1rem;margin-bottom:2rem">
      <p style="font-size:1.4rem;color:#f0ebe0;letter-spacing:.1em;margin:0">CRAZY<span style="color:#b01a1a">M</span>ONKEY</p>
      <p style="font-size:.6rem;letter-spacing:.4em;color:#8a8a8a;margin:.3rem 0 0;text-transform:uppercase">✦ Collection Noir — Edición Limitada</p>
    </div>

    <p style="font-size:.9rem;color:#d9cdb8;line-height:2;margin-bottom:1.5rem">
      Hola ${h(order.nombre)},<br><br>
      Dejaste algo en tu carrito. Las piezas de edición limitada tienen stock reducido — no te quedes sin la tuya.
    </p>

    <div style="background:#0d0d0d;border:1px solid #1e1e1e;border-left:3px solid #b01a1a;padding:1.5rem;margin-bottom:1.5rem">
      <p style="font-size:.5rem;letter-spacing:.4em;color:#b01a1a;text-transform:uppercase;margin-bottom:1rem">Tu carrito</p>
      ${itemsHtml}
      <div style="display:flex;justify-content:space-between;margin-top:1rem;padding-top:1rem;border-top:1px solid #2a2a2a">
        <span style="font-size:.6rem;letter-spacing:.3em;color:#8a8a8a;text-transform:uppercase">Total</span>
        <span style="font-size:1.1rem;color:#c8a84b">$${(order.total || 0).toLocaleString('es-CO')} COP</span>
      </div>
    </div>

    <div style="text-align:center;margin-bottom:2rem">
      <a href="${storeUrl}"
        style="display:inline-block;font-family:monospace;font-size:.65rem;letter-spacing:.3em;color:#080808;background:#b01a1a;text-decoration:none;padding:.9rem 2rem;text-transform:uppercase">
        Completar mi pedido →
      </a>
    </div>

    <div style="background:rgba(176,26,26,.05);border-left:2px solid #b01a1a;padding:1rem 1.2rem;margin-bottom:1.5rem">
      <p style="font-size:.7rem;color:#8a8a8a;line-height:1.9;margin:0">
        Fabricamos bajo pedido para garantizar calidad en cada pieza.<br>
        Tiempo de producción: <strong style="color:#d9cdb8">5 a 10 días hábiles</strong>.
      </p>
    </div>

    <p style="font-size:.6rem;color:#555;line-height:2;text-align:center">
      Crazy Monkey Collection Noir · Medellín, Colombia<br>
      <a href="https://wa.me/573016568222" style="color:#555">WhatsApp: +57 301 656 8222</a>
    </p>
  </div>
</body>
</html>`;

  const emailBody = JSON.stringify({
    from: 'Crazy Monkey <pedidos@crazymonkey.store>',
    to: [order.email],
    subject: `${h(order.nombre)}, tu carrito te espera — Crazy Monkey`,
    html,
  });

  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Length': Buffer.byteLength(emailBody),
      },
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.write(emailBody);
    req.end();
  });
}

exports.handler = async (event) => {
  // Permite disparo manual desde el admin con contraseña
  const isManual = event.httpMethod === 'GET';
  if (isManual && event.headers?.['x-admin-password'] !== process.env.ADMIN_PASSWORD) {
    return { statusCode: 401, body: JSON.stringify({ error: 'No autorizado' }) };
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured');
    return { statusCode: 500, body: JSON.stringify({ error: 'Email service not configured' }) };
  }

  const ordersResult = await getAbandonedOrders();
  const orders = Array.isArray(ordersResult.body) ? ordersResult.body : [];

  console.log(`Abandoned cart check: found ${orders.length} orders`);

  let sent = 0;
  let failed = 0;

  for (const order of orders) {
    try {
      const emailResult = await sendRecoveryEmail(order);
      if (emailResult.status === 200 || emailResult.status === 201) {
        await markRecoverySent(order.id);
        console.log(`Recovery email sent: ${order.email} (order ${order.id})`);
        sent++;
      } else {
        console.error(`Resend rejected email for order ${order.id}:`, emailResult.body);
        failed++;
      }
    } catch (e) {
      console.error(`Recovery email failed for order ${order.id}:`, e.message);
      failed++;
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ checked: orders.length, sent, failed }),
  };
};
