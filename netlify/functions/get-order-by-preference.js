/**
 * GET /.netlify/functions/get-order-by-preference?preference_id=...
 *
 * Consulta pública para la página de post-pago (pago-exitoso.html).
 * MercadoPago agrega `preference_id` a la URL de retorno — funciona como
 * token de acceso de un solo pedido (igual de público que el link de
 * retorno que ya envía MP), no expone email/teléfono/dirección.
 */
const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

function getOrderByPreference(preferenceId) {
  const path = `pedidos?mp_preference_id=eq.${encodeURIComponent(preferenceId)}&select=nombre,estado,mp_status,items,total,created_at`;
  const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: [] }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function mapEstado(order) {
  if (order.mp_status === 'rejected' || order.mp_status === 'cancelled') {
    return { label: 'Pago rechazado', status: 'rejected' };
  }
  if (order.mp_status === 'pending' || order.mp_status === 'in_process') {
    return { label: 'Verificando tu pago', status: 'pending' };
  }
  return { label: 'Pago confirmado', status: 'approved' };
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  const preferenceId = event.queryStringParameters?.preference_id;
  if (!preferenceId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Falta preference_id' }) };
  }

  const result = await getOrderByPreference(preferenceId);
  if (result.status !== 200) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'Error consultando el pedido' }) };
  }

  const order = Array.isArray(result.body) ? result.body[0] : null;
  if (!order) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Pedido no encontrado' }) };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      nombre: order.nombre,
      estado: mapEstado(order),
      items: Array.isArray(order.items) ? order.items : [],
      total: order.total,
      created_at: order.created_at,
    }),
  };
};
