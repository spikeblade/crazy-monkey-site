const https = require('https');
const { escapeHtml: h } = require('./lib/escape-html');

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

// ── Consultar estado actual del pedido ──
function getOrder(preferenceId) {
  const supaUrl = new URL(
    `${process.env.SUPABASE_URL}/rest/v1/pedidos?mp_preference_id=eq.${preferenceId}&select=mp_payment_id,estado`
  );
  return new Promise((resolve) => {
    const req = https.request({
      hostname: supaUrl.hostname,
      path: supaUrl.pathname + supaUrl.search,
      method: 'GET',
      headers: {
        'apikey': process.env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)[0] || null); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
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

// ── Incrementar stock vendido (atómico y condicional) ──
// Retorna array con los nombres de productos cuyo stock estaba agotado (no se pudo incrementar)
async function incrementStock(items) {
  if (!items || !Array.isArray(items)) return [];
  const unique = [...new Set(items.map(i => i.name))];
  const agotados = [];

  for (const nombre of unique) {
    const count = items.filter(i => i.name === nombre).length;
    const url = new URL(`${process.env.SUPABASE_URL}/rest/v1/rpc/increment_stock`);
    const body = JSON.stringify({ p_nombre: nombre, p_cantidad: count });

    const result = await new Promise((resolve) => {
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
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(true); } });
      });
      req.on('error', () => resolve(true));
      req.write(body);
      req.end();
    });

    // La función SQL retorna false si el stock estaba agotado
    if (result === false) {
      agotados.push(nombre);
      console.warn(`Stock agotado al confirmar pedido — producto: ${nombre}`);
    }
  }

  return agotados;
}

// ── Consultar productos con stock bajo ──
const LOW_STOCK_THRESHOLD = 3;

function getLowStockProducts() {
  const url = new URL(
    `${process.env.SUPABASE_URL}/rest/v1/productos?activo=eq.true&stock_total=not.is.null&select=nombre,stock_total,stock_vendido`
  );
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'apikey': process.env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.end();
  });
}

async function checkLowStock() {
  if (!process.env.RESEND_API_KEY || !process.env.ADMIN_EMAIL) return;

  const productos = await getLowStockProducts();
  const bajos = (Array.isArray(productos) ? productos : [])
    .map(p => ({ ...p, restante: (p.stock_total || 0) - (p.stock_vendido || 0) }))
    .filter(p => p.restante <= LOW_STOCK_THRESHOLD);

  if (bajos.length === 0) return;

  const rows = bajos.map(p => {
    const estado = p.restante <= 0 ? '🔴 AGOTADO' : `🟡 ${p.restante} restante${p.restante !== 1 ? 's' : ''}`;
    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #1a1a1a;color:#d9cdb8">${h(p.nombre)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #1a1a1a;color:#8a8a8a;text-align:center">${h(String(p.stock_total))}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #1a1a1a;text-align:center;color:${p.restante <= 0 ? '#c94a4a' : '#c8a84b'}">${estado}</td>
      </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="background:#080808;color:#d9cdb8;font-family:monospace;margin:0;padding:0">
  <div style="max-width:540px;margin:0 auto;padding:2rem">
    <div style="border-bottom:3px solid #b01a1a;padding-bottom:1rem;margin-bottom:2rem">
      <p style="font-size:1.4rem;color:#f0ebe0;letter-spacing:.1em;margin:0">CRAZY<span style="color:#b01a1a">M</span>ONKEY</p>
      <p style="font-size:.6rem;letter-spacing:.4em;color:#8a8a8a;margin:.3rem 0 0;text-transform:uppercase">✦ Alerta de stock</p>
    </div>
    <div style="background:rgba(176,26,26,.06);border-left:3px solid #b01a1a;padding:1rem 1.2rem;margin-bottom:1.5rem">
      <p style="font-size:.8rem;color:#f0ebe0;margin:0">
        ${bajos.some(p => p.restante <= 0) ? 'Uno o más productos están <strong>agotados</strong>.' : 'Uno o más productos tienen <strong>stock bajo</strong>.'}
      </p>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:1.5rem">
      <thead>
        <tr>
          <th style="padding:8px 12px;font-size:.5rem;letter-spacing:.2em;color:#555;text-align:left;border-bottom:1px solid #1e1e1e">Producto</th>
          <th style="padding:8px 12px;font-size:.5rem;letter-spacing:.2em;color:#555;text-align:center;border-bottom:1px solid #1e1e1e">Stock total</th>
          <th style="padding:8px 12px;font-size:.5rem;letter-spacing:.2em;color:#555;text-align:center;border-bottom:1px solid #1e1e1e">Estado</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="text-align:center">
      <a href="${process.env.SITE_URL || 'https://crazymonkey.store'}/admin.html"
        style="display:inline-block;font-family:monospace;font-size:.6rem;letter-spacing:.25em;color:#d9cdb8;text-decoration:none;border:1px solid #2a2a2a;padding:.6rem 1.5rem;text-transform:uppercase">
        Gestionar productos →
      </a>
    </div>
    <p style="font-size:.5rem;color:#333;margin-top:1.5rem;text-align:center;letter-spacing:.2em">
      Crazy Monkey Collection Noir · Alerta automática
    </p>
  </div>
</body>
</html>`;

  const agotados = bajos.filter(p => p.restante <= 0).map(p => h(p.nombre)).join(', ');
  const subject = agotados
    ? `🔴 Stock agotado: ${agotados} — Crazy Monkey`
    : `🟡 Stock bajo en ${bajos.length} producto${bajos.length !== 1 ? 's' : ''} — Crazy Monkey`;

  const emailBody = JSON.stringify({
    from: 'Crazy Monkey <pedidos@crazymonkey.store>',
    to: [process.env.ADMIN_EMAIL],
    subject,
    html,
  });

  await new Promise((resolve) => {
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
      res.on('data', () => {});
      res.on('end', resolve);
    });
    req.on('error', resolve);
    req.write(emailBody);
    req.end();
  });

  console.log(`Low stock alert sent: ${bajos.map(p => `${p.nombre}(${p.restante})`).join(', ')}`);
}

// ── Enviar email via Resend ──
function sendEmail(order, payment) {
  const items = Array.isArray(order.items) ? order.items : [];
  const itemsHtml = items.map(i => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #1a1a1a;color:#d9cdb8">${h(i.name)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #1a1a1a;color:#b01a1a;text-align:center">T.${h(i.size)}</td>
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
      <p style="font-size:1rem;color:#f0ebe0;margin-bottom:.3rem">${h(order.nombre)}</p>
      <p style="font-size:.75rem;color:#8a8a8a;margin-bottom:.2rem">📞 ${h(order.telefono)}</p>
      <p style="font-size:.75rem;color:#8a8a8a">📍 ${h(order.ciudad)}, ${h(order.departamento)}</p>
      ${order.direccion ? `<p style="font-size:.7rem;color:#555;margin-top:.4rem">${h(order.direccion)}</p>` : ''}
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
      <p style="font-size:.65rem;color:#8a8a8a">ID MP: ${h(payment.id) || '—'}</p>
      <p style="font-size:.65rem;color:#4a9a4a;margin-top:.2rem">✓ ${h(payment.status_detail) || 'Aprobado'}</p>
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

// ── Email de confirmación al cliente ──
async function sendClientConfirmation(order, payment) {
  if (!order.email) return; // No email, skip

  const items = Array.isArray(order.items) ? order.items : [];
  const itemsHtml = items.map(i => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #1a1a1a;color:#d9cdb8">${h(i.name)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #1a1a1a;color:#b01a1a;text-align:center">T.${h(i.size)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #1a1a1a;color:#c8a84b;text-align:right">$${(i.price||95000).toLocaleString('es-CO')} COP</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="background:#080808;color:#d9cdb8;font-family:monospace;margin:0;padding:0">
  <div style="max-width:540px;margin:0 auto;padding:2rem">
    <div style="border-bottom:3px solid #b01a1a;padding-bottom:1rem;margin-bottom:2rem">
      <p style="font-size:1.4rem;color:#f0ebe0;letter-spacing:.1em;margin:0">CRAZY<span style="color:#b01a1a">M</span>ONKEY</p>
      <p style="font-size:.6rem;letter-spacing:.4em;color:#8a8a8a;margin:.3rem 0 0;text-transform:uppercase">✦ Pedido confirmado</p>
    </div>

    <p style="font-size:.9rem;color:#d9cdb8;line-height:2;margin-bottom:1.5rem">
      Hola ${h(order.nombre)},<br><br>
      Recibimos tu pago. Tu pedido entra en producción — al ser una edición limitada fabricamos bajo pedido para garantizar la calidad de cada pieza.
    </p>

    <div style="background:#0d0d0d;border:1px solid #1e1e1e;border-left:3px solid #b01a1a;padding:1.5rem;margin-bottom:1.5rem">
      <p style="font-size:.5rem;letter-spacing:.4em;color:#b01a1a;text-transform:uppercase;margin-bottom:1rem">Tu pedido</p>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr>
          <th style="padding:6px 12px;font-size:.5rem;letter-spacing:.2em;color:#555;text-align:left;border-bottom:1px solid #1e1e1e">Diseño</th>
          <th style="padding:6px 12px;font-size:.5rem;letter-spacing:.2em;color:#555;text-align:center;border-bottom:1px solid #1e1e1e">Talla</th>
          <th style="padding:6px 12px;font-size:.5rem;letter-spacing:.2em;color:#555;text-align:right;border-bottom:1px solid #1e1e1e">Precio</th>
        </tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <div style="display:flex;justify-content:space-between;margin-top:1rem;padding-top:1rem;border-top:1px solid #2a2a2a">
        <span style="font-size:.6rem;letter-spacing:.3em;color:#8a8a8a;text-transform:uppercase">Total</span>
        <span style="font-size:1.1rem;color:#c8a84b">$${(order.total||0).toLocaleString('es-CO')} COP</span>
      </div>
    </div>

    <div style="background:#0d0d0d;border:1px solid #1e1e1e;padding:1.5rem;margin-bottom:1.5rem">
      <p style="font-size:.5rem;letter-spacing:.4em;color:#b01a1a;text-transform:uppercase;margin-bottom:.8rem">Entrega</p>
      <p style="font-size:.75rem;color:#8a8a8a;line-height:1.9">
        📍 ${h(order.ciudad)}, ${h(order.departamento)}<br>
        ${order.direccion ? `🏠 ${h(order.direccion)}<br>` : ''}
        📞 ${h(order.telefono)}
      </p>
    </div>

    <div style="background:rgba(176,26,26,.05);border-left:2px solid #b01a1a;padding:1rem 1.2rem;margin-bottom:1.5rem">
      <p style="font-size:.7rem;color:#d9cdb8;line-height:1.9">
        Te notificaremos por este email cuando tu pedido esté listo para envío.<br>
        El tiempo estimado de producción es de <strong style="color:#f0ebe0">5 a 10 días hábiles</strong>.
      </p>
    </div>

    <p style="font-size:.6rem;color:#555;line-height:2;text-align:center">
      Crazy Monkey Collection Noir · Medellín, Colombia<br>
      WhatsApp: <a href="https://wa.me/573016568222" style="color:#8a8a8a">+57 301 656 8222</a>
    </p>
  </div>
</body></html>`;

  const emailBody = JSON.stringify({
    from: 'Crazy Monkey <pedidos@crazymonkey.store>',
    to: [order.email],
    subject: `Pedido confirmado — ${items.map(i=>i.name).join(', ')} · Crazy Monkey`,
    html,
  });

  return new Promise((resolve) => {
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
    const req = require('https').request(opts, res => {
      res.on('data', () => {});
      res.on('end', resolve);
    });
    req.on('error', resolve);
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

  // ── Idempotencia: ignorar notificaciones duplicadas ──
  // Si el pedido ya tiene este mp_payment_id y no está pendiente, ya fue procesado.
  const currentOrder = await getOrder(preferenceId);
  if (currentOrder && currentOrder.mp_payment_id === String(paymentId) &&
      currentOrder.estado !== 'pendiente') {
    console.log(`Webhook duplicado ignorado — payment ${paymentId} ya procesado (estado: ${currentOrder.estado})`);
    return { statusCode: 200, body: 'OK' };
  }

  const estado = mpStatus === 'approved' ? 'confirmado' : 'pendiente';

  // Actualizar en Supabase
  const updateResult = await updateOrder(preferenceId, paymentId, mpStatus, estado);
  const orders = Array.isArray(updateResult.body) ? updateResult.body : [];
  const order = orders[0];

  console.log(`Order updated: ${orders.length} row(s), estado=${estado}`);

  // Incrementar stock vendido y verificar niveles bajos si fue aprobado
  if (mpStatus === 'approved' && order) {
    try {
      const agotados = await incrementStock(order.items);

      if (agotados.length > 0) {
        // Race condition: este pedido se coló pero el stock ya estaba agotado.
        // Marcamos el pedido con estado especial para revisión manual.
        console.error(`OVERSELL DETECTADO — pedido ${order.mp_preference_id} — productos: ${agotados.join(', ')}`);
        await updateOrder(preferenceId, paymentId, mpStatus, 'revisar_stock');
      }

      await checkLowStock();
    } catch(e) {
      console.error('Stock increment error:', e);
    }
  }

  // Enviar email de confirmación al cliente
  if (mpStatus === 'approved' && order && process.env.RESEND_API_KEY) {
    try {
      await sendClientConfirmation(order, payment);
      console.log('Client confirmation email sent to:', order.email);
    } catch(e) {
      console.error('Client email error:', e);
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
