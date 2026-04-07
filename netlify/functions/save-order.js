const https = require('https');

// POST a Supabase REST API
function supabaseInsert(table, data) {
  const url = new URL(`${process.env.SUPABASE_URL}/rest/v1/${table}`);
  const body = JSON.stringify(data);
  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
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
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Send WhatsApp notification via wa.me link (just logs — WA Business API needed for push)
function buildWAMessage(order) {
  const lines = order.items.map((item, i) =>
    `${i + 1}. ${item.name} — Talla ${item.size} — $${(95000).toLocaleString('es-CO')} COP`
  ).join('\n');
  return [
    `🛍 NUEVO PEDIDO — Crazy Monkey`,
    ``,
    `👤 ${order.nombre}`,
    `📞 ${order.telefono}`,
    `📍 ${order.ciudad}, ${order.departamento}`,
    ``,
    lines,
    ``,
    `💰 Total: $${order.total.toLocaleString('es-CO')} COP`,
    `🔖 ID: ${order.mp_preference_id || 'N/A'}`,
  ].join('\n');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const {
    nombre, telefono, departamento, ciudad,
    items, total,
    mp_preference_id, mp_payment_id, mp_status,
  } = body;

  if (!nombre || !telefono || !departamento || !ciudad || !items || !total) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Faltan campos obligatorios' }) };
  }

  const order = {
    nombre, telefono, departamento, ciudad,
    items,
    total,
    mp_preference_id: mp_preference_id || null,
    mp_payment_id: mp_payment_id || null,
    mp_status: mp_status || 'pending',
    estado: mp_status === 'approved' ? 'confirmado' : 'pendiente',
  };

  const result = await supabaseInsert('pedidos', order);

  if (result.status !== 201) {
    console.error('Supabase error:', result.body);
    return { statusCode: 502, body: JSON.stringify({ error: 'Error guardando pedido' }) };
  }

  const savedOrder = result.body[0];
  const waMsg = buildWAMessage(order);
  console.log('WA Notification:\n', waMsg);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: true,
      order_id: savedOrder.id,
      wa_message: encodeURIComponent(waMsg),
    }),
  };
};
