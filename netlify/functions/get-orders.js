const https = require('https');
const { escapeHtml: h } = require('./lib/escape-html');

// URLs de rastreo por transportadora.
// Verificar con cada operador antes de activar en producción.
const CARRIER_URLS = {
  servientrega:    num => `https://www.servientrega.com.co/envios-y-seguimiento?guia=${encodeURIComponent(num)}`,
  coordinadora:    num => `https://coordinadora.com/portafolio-de-servicios/servicios-para-envios/rastreo-de-guias/?guia=${encodeURIComponent(num)}`,
  interrapidisimo: num => `https://www.interrapidisimo.com/seguimiento/?numero=${encodeURIComponent(num)}`,
  tcc:             num => `https://www.tcc.com.co/rastreo/?guia=${encodeURIComponent(num)}`,
};

function supabaseQuery(path) {
  const url = new URL(`${process.env.SUPABASE_URL}/rest/v1/${path}`);
  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'apikey': process.env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
      },
    };
    const req = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
    });
    req.on('error', reject);
    req.end();
  });
}

function supabasePatch(table, id, data) {
  const body = JSON.stringify(data);
  return new Promise((resolve, reject) => {
    const supaUrl = new URL(`${process.env.SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`);
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
      res.on('end', () => resolve({ status: res.statusCode, body: d ? JSON.parse(d) : {} }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sendTrackingEmail(order, trackingNumber, carrier) {
  const carrierName = carrier
    ? carrier.charAt(0).toUpperCase() + carrier.slice(1)
    : 'la transportadora';
  const trackingUrl = CARRIER_URLS[carrier?.toLowerCase()]
    ? CARRIER_URLS[carrier.toLowerCase()](trackingNumber)
    : null;

  const items = Array.isArray(order.items) ? order.items : [];
  const itemsHtml = items.map(i => `
    <div style="display:flex;justify-content:space-between;padding:.6rem 0;border-bottom:1px solid #1a1a1a">
      <span style="color:#d9cdb8;font-size:.8rem">${h(i.name)}</span>
      <span style="color:#b01a1a;font-size:.7rem">Talla ${h(i.size)}</span>
    </div>`).join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="background:#080808;color:#d9cdb8;font-family:monospace;margin:0;padding:0">
  <div style="max-width:520px;margin:0 auto;padding:2rem">

    <div style="border-bottom:3px solid #b01a1a;padding-bottom:1rem;margin-bottom:2rem">
      <p style="font-size:1.4rem;color:#f0ebe0;letter-spacing:.1em;margin:0">CRAZY<span style="color:#b01a1a">M</span>ONKEY</p>
      <p style="font-size:.6rem;letter-spacing:.4em;color:#8a8a8a;margin:.3rem 0 0;text-transform:uppercase">✦ Tu pedido está en camino</p>
    </div>

    <p style="font-size:.9rem;color:#d9cdb8;line-height:2;margin-bottom:1.5rem">
      Hola ${h(order.nombre)},<br><br>
      Tu pedido fue despachado y está en camino a ${h(order.ciudad)}.
    </p>

    <div style="background:#0d0d0d;border:1px solid #1e1e1e;border-left:3px solid #4a9a4a;padding:1.5rem;margin-bottom:1.5rem">
      <p style="font-size:.5rem;letter-spacing:.4em;color:#4a9a4a;text-transform:uppercase;margin-bottom:.8rem">📦 Información de envío</p>
      <p style="font-size:.7rem;color:#8a8a8a;margin-bottom:.3rem">Transportadora</p>
      <p style="font-size:.95rem;color:#f0ebe0;margin-bottom:1rem">${h(carrierName)}</p>
      <p style="font-size:.7rem;color:#8a8a8a;margin-bottom:.3rem">Número de guía</p>
      <p style="font-size:1.2rem;color:#c8a84b;letter-spacing:.1em">${h(trackingNumber)}</p>
    </div>

    ${trackingUrl ? `
    <div style="text-align:center;margin-bottom:1.5rem">
      <a href="${h(trackingUrl)}"
        style="display:inline-block;font-family:monospace;font-size:.65rem;letter-spacing:.3em;color:#080808;background:#4a9a4a;text-decoration:none;padding:.9rem 2rem;text-transform:uppercase">
        Rastrear mi pedido →
      </a>
    </div>` : `
    <div style="background:rgba(74,154,74,.05);border-left:2px solid #4a9a4a;padding:1rem 1.2rem;margin-bottom:1.5rem">
      <p style="font-size:.7rem;color:#8a8a8a;line-height:1.9;margin:0">
        Ingresa tu número de guía <strong style="color:#c8a84b">${h(trackingNumber)}</strong> en el sitio web de ${h(carrierName)} para rastrear tu envío.
      </p>
    </div>`}

    <div style="background:#0d0d0d;border:1px solid #1e1e1e;padding:1.2rem;margin-bottom:1.5rem">
      <p style="font-size:.5rem;letter-spacing:.4em;color:#b01a1a;text-transform:uppercase;margin-bottom:.8rem">Tu pedido</p>
      ${itemsHtml}
    </div>

    <p style="font-size:.6rem;color:#555;line-height:2;text-align:center">
      Crazy Monkey Collection Noir · Medellín, Colombia<br>
      <a href="https://wa.me/573016568222" style="color:#555">¿Dudas? WhatsApp: +57 301 656 8222</a>
    </p>
  </div>
</body>
</html>`;

  const emailBody = JSON.stringify({
    from: 'Crazy Monkey <pedidos@crazymonkey.store>',
    to: [order.email],
    subject: `Tu pedido está en camino — Guía ${h(trackingNumber)} · Crazy Monkey`,
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
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', () => resolve({ status: 500 }));
    req.write(emailBody);
    req.end();
  });
}

exports.handler = async (event) => {
  // Verificar contraseña admin
  const adminPass = event.headers['x-admin-password'];
  if (adminPass !== process.env.ADMIN_PASSWORD) {
    return { statusCode: 401, body: JSON.stringify({ error: 'No autorizado' }) };
  }

  // PATCH — actualizar estado, tracking o ambos
  if (event.httpMethod === 'PATCH') {
    const { id, estado, tracking_number, carrier } = JSON.parse(event.body);
    const validStates = ['pendiente', 'confirmado', 'enviado', 'entregado'];

    if (!id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Falta id' }) };
    }
    if (estado && !validStates.includes(estado)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Estado inválido' }) };
    }
    if (!estado && !tracking_number) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Datos inválidos' }) };
    }

    const update = {};
    if (estado) update.estado = estado;
    if (tracking_number) update.tracking_number = tracking_number;
    if (carrier) update.carrier = carrier;

    const result = await supabasePatch('pedidos', id, update);
    const order = Array.isArray(result.body) ? result.body[0] : null;

    // Email de envío si corresponde.
    // Usa order?.estado (estado actualizado) para cubrir también el caso de agregar
    // tracking a un pedido ya marcado como enviado en un paso anterior.
    if (order?.estado === 'enviado' && tracking_number && order?.email && process.env.RESEND_API_KEY) {
      try {
        await sendTrackingEmail(order, tracking_number, carrier);
        console.log(`Tracking email sent to ${order.email} — guía ${tracking_number}`);
      } catch (e) {
        console.error('Tracking email error:', e.message);
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }),
    };
  }

  // GET — obtener todos los pedidos ordenados por fecha
  if (event.httpMethod === 'GET') {
    const result = await supabaseQuery('pedidos?order=created_at.desc&limit=200');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result.body),
    };
  }

  return { statusCode: 405, body: 'Method Not Allowed' };
};
