const https = require('https');

// ── Consultar pago en MP ──
function getMPPayment(paymentId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.mercadopago.com',
      path: `/v1/payments/${paymentId}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      },
    };
    const req = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { reject(new Error('Invalid MP response')); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ── Actualizar pedido en Supabase ──
function updateOrder(preferenceId, paymentId, mpStatus, estado) {
  const body = JSON.stringify({
    mp_payment_id: String(paymentId),
    mp_status: mpStatus,
    estado,
  });
  const supaUrl = new URL(
    `${process.env.SUPABASE_URL}/rest/v1/pedidos?mp_preference_id=eq.${preferenceId}`
  );
  return new Promise((resolve, reject) => {
    const options = {
      hostname: supaUrl.hostname,
      path: supaUrl.pathname + supaUrl.search,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        'Prefer': 'return=representation',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d ? JSON.parse(d) : [] }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Incrementar stock vendido ──
async function incrementStock(items) {
  if (!items || !Array.isArray(items)) return;
  const unique = [...new Set(items.map(i => i.name))];
  for (const nombre of unique) {
    const count = items.filter(i => i.name === nombre).length;
    const url = new URL(
      `${process.env.SUPABASE_URL}/rest/v1/rpc/increment_stock`
    );
    const body = JSON.stringify({ p_nombre: nombre, p_cantidad: count });
    await new Promise((resolve) => {
      const opts = {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
          'Content-Length': Buffer.byteLength(body),
        },
      };
      const req = require('https').request(opts, res => {
        res.on('data', () => {});
        res.on('end', resolve);
      });
      req.on('error', resolve);
      req.write(body);
      req.end();
    });
  }
}

// ── Enviar email via Resend ──
function sendEmail(order, payment) {
  const items = Array.isArray(order.items) ? order.items : [];
  const itemsHtml = items.map(i => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #1a1a1a;color:#d9cdb8">${i.name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #1a1a1a;color:#b01a1a;text-align:center">T.${i.size}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #1a1a1a;color:#c8a84b;text-align:right">$95.000</td>
    </tr>
  `).join('');

  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="background:#080808;color:#d9cdb8;font-family:monospace;padding:0;margin:0">
  <div style="max-width:560px;margin:0 auto;padding:2rem">

    <div style="border-bottom:3px solid #b01a1a;padding-bottom:1rem;margin-bottom:2rem">
      <p style="font-size:1.4rem;color:#f0ebe0;letter-spacing:.1em;margin:0">
        CRAZY<span style="color:#b01a1a">M</span>ONKEY
      </p>
      <p style="font-size:.6rem;letter-spacing:.4em;color:#8a8a8a;margin:.3rem 0 0;text-transform:uppercase">
        ✦ Nuevo pedido confirmado
      </p>
    </div>

    <div style="background:#0d0d0d;border:1px solid #1e1e1e;border-left:3px solid #b01a1a;padding:1.5rem;margin-bottom:1.5rem">
      <p style="font-size:.5rem;letter-spacing:.4em;color:#b01a1a;text-transform:uppercase;margin-bottom:.8rem">Cliente</p>
      <p style="font-size:1rem;color:#f0ebe0;margin-bottom:.3rem">${order.nombre}</p>
      <p style="font-size:.75rem;color:#8a8a8a;margin-bottom:.2rem">📞 ${order.telefono}</p>
      <p style="font-size:.75rem;color:#8a8a8a">📍 ${order.ciudad}, ${order.departamento}</p>
      ${order.direccion ? `<p style="font-size:.7rem;color:#555;margin-top:.4rem">${order.direccion}</p>` : ''}
    </div>

    <div style="background:#0d0d0d;border:1px solid #1e1e1e;padding:1.5rem;margin-bottom:1.5rem">
      <p style="font-size:.5rem;letter-spacing:.4em;color:#b01a1a;text-transform:uppercase;margin-bottom:1rem">Productos</p>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr>
            <th style="padding:6px 12px;font-size:.5rem;letter-spacing:.2em;color:#555;text-align:left;border-bottom:1px solid #1e1e1e">Diseño</th>
            <th style="padding:6px 12px;font-size:.5rem;letter-spacing:.2em;color:#555;text-align:center;border-bottom:1px solid #1e1e1e">Talla</th>
            <th style="padding:6px 12px;font-size:.5rem;letter-spacing:.2em;color:#555;text-align:right;border-bottom:1px solid #1e1e1e">Precio</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <div style="display:flex;justify-content:space-between;margin-top:1rem;padding-top:1rem;border-top:1px solid #2a2a2a">
        <span style="font-size:.6rem;letter-spacing:.3em;color:#8a8a8a;text-transform:uppercase">Total</span>
        <span style="font-size:1.1rem;color:#c8a84b">$${(order.total||0).toLocaleString('es-CO')} COP</span>
      </div>
    </div>

    <div style="background:#0d0d0d;border:1px solid #1e1e1e;padding:1rem;margin-bottom:1.5rem">
      <p style="font-size:.5rem;letter-spacing:.4em;color:#555;text-transform:uppercase;margin-bottom:.5rem">Pago</p>
      <p style="font-size:.65rem;color:#8a8a8a">ID MP: ${payment.id || '—'}</p>
      <p style="font-size:.65rem;color:#4a9a4a;margin-top:.2rem">✓ ${payment.status_detail || 'Aprobado'}</p>
    </div>

    <div style="text-align:center;padding-top:1rem;border-top:1px solid #1a1a1a">
      <a href="${process.env.SITE_URL}/admin.html"
        style="display:inline-block;font-family:monospace;font-size:.6rem;letter-spacing:.25em;color:#d9cdb8;text-decoration:none;border:1px solid #2a2a2a;padding:.6rem 1.5rem;text-transform:uppercase">
        Ver en panel admin →
      </a>
      <p style="font-size:.5rem;color:#333;margin-top:1rem;letter-spacing:.2em">
        Crazy Monkey Collection Noir · ${new Date().getFullYear()}
      </p>
    </div>
  </div>
</body>
</html>`;

  const emailBody = JSON.stringify({
    from: 'Crazy Monkey <pedidos@crazymonkey.store>',
    to: [process.env.ADMIN_EMAIL],
    subject: `✦ Nuevo pedido — ${order.nombre} · $${(order.total||0).toLocaleString('es-CO')} COP`,
    html,
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Length': Buffer.byteLength(emailBody),
      },
    };
    const req = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', reject);
    req.write(emailBody);
    req.end();
  });
}

// ── HANDLER PRINCIPAL ──
exports.handler = async (event) => {
  // MP solo hace POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 200, body: 'OK' };
  }

  let notification;
  try {
    notification = JSON.parse(event.body);
  } catch {
    return { statusCode: 200, body: 'OK' };
  }

  console.log('MP Webhook received:', JSON.stringify(notification));

  // Solo procesamos notificaciones de tipo "payment"
  if (notification.type !== 'payment' || !notification.data?.id) {
    return { statusCode: 200, body: 'OK' };
  }

  const paymentId = notification.data.id;

  // Verificar pago con la API de MP
  const mpResult = await getMPPayment(paymentId);
  if (mpResult.status !== 200) {
    console.error('Could not fetch payment:', mpResult.body);
    return { statusCode: 200, body: 'OK' };
  }

  const payment = mpResult.body;
  const preferenceId = payment.preference_id;
  const mpStatus = payment.status; // approved, pending, rejected

  console.log(`Payment ${paymentId}: status=${mpStatus}, preference=${preferenceId}`);

  // Solo actualizamos si está aprobado o rechazado
  if (!['approved', 'rejected', 'cancelled'].includes(mpStatus)) {
    return { statusCode: 200, body: 'OK' };
  }

  const estado = mpStatus === 'approved' ? 'confirmado' : 'pendiente';

  // Actualizar en Supabase
  const updateResult = await updateOrder(preferenceId, paymentId, mpStatus, estado);
  const orders = Array.isArray(updateResult.body) ? updateResult.body : [];
  const order = orders[0];

  console.log(`Order updated: ${orders.length} row(s), estado=${estado}`);

  // Incrementar stock vendido si fue aprobado
  if (mpStatus === 'approved' && order) {
    try {
      await incrementStock(order.items);
    } catch(e) {
      console.error('Stock increment error:', e);
    }
  }

  // Enviar email solo si el pago fue aprobado
  if (mpStatus === 'approved' && order && process.env.RESEND_API_KEY && process.env.ADMIN_EMAIL) {
    try {
      await sendEmail(order, payment);
      console.log('Email sent OK');
    } catch (e) {
      console.error('Email error:', e);
      // No bloqueamos — el pedido ya está guardado
    }
  }

  // MP requiere respuesta 200 rápida
  return { statusCode: 200, body: 'OK' };
};
