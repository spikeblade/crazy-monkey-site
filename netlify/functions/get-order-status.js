/**
 * GET/POST /.netlify/functions/get-order-status
 *
 * Consulta pública: clientes pueden ver el estado de sus pedidos con solo su email.
 * No requiere autenticación — el email actúa como secreto natural.
 *
 * Body JSON: { email: string }
 * Respuesta: array de pedidos (solo campos seguros, sin IDs internos de MP).
 */
const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

// Transportadoras soportadas para links de rastreo
const CARRIER_URLS = {
  servientrega:    num => `https://www.servientrega.com.co/envios-y-seguimiento?guia=${encodeURIComponent(num)}`,
  coordinadora:    num => `https://coordinadora.com/portafolio-de-servicios/servicios-para-envios/rastreo-de-guias/?guia=${encodeURIComponent(num)}`,
  interrapidisimo: num => `https://www.interrapidisimo.com/seguimiento/?numero=${encodeURIComponent(num)}`,
  tcc:             num => `https://www.tcc.com.co/rastreo/?guia=${encodeURIComponent(num)}`,
};

function getOrdersByEmail(email) {
  const encoded = encodeURIComponent(email);
  // Solo traemos pedidos de compras que llegaron al paso de pago (tienen preference)
  // Ordenados del más reciente al más antiguo
  const path = `pedidos?email=eq.${encoded}&mp_preference_id=not.is.null&select=id,nombre,estado,mp_status,items,total,created_at,tracking_number,carrier&order=created_at.desc&limit=10`;
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

function buildTrackingUrl(carrier, trackingNumber) {
  if (!carrier || !trackingNumber) return null;
  const fn = CARRIER_URLS[carrier.toLowerCase()];
  return fn ? fn(trackingNumber) : null;
}

function mapEstado(order) {
  // Normaliza el estado para el cliente, combinando mp_status y estado interno
  if (order.mp_status === 'rejected' || order.mp_status === 'cancelled') {
    return { label: 'Pago rechazado', step: 0, color: '#8a3a3a' };
  }
  if (order.mp_status === 'pending' || order.mp_status === 'in_process') {
    return { label: 'Pago en proceso', step: 1, color: '#c8a84b' };
  }
  // mp_status === 'approved'
  switch (order.estado) {
    case 'confirmado':     return { label: 'Confirmado', step: 2, color: '#b01a1a' };
    case 'revisar_stock':  return { label: 'Confirmado', step: 2, color: '#b01a1a' };
    case 'en_produccion':  return { label: 'En producción', step: 3, color: '#b01a1a' };
    case 'listo':          return { label: 'Listo para envío', step: 3, color: '#b01a1a' };
    case 'enviado':        return { label: 'Enviado', step: 4, color: '#4a9a5a' };
    case 'entregado':      return { label: 'Entregado', step: 5, color: '#4a9a5a' };
    default:               return { label: 'Confirmado', step: 2, color: '#b01a1a' };
  }
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

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  let email;
  try {
    ({ email } = JSON.parse(event.body || '{}'));
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Body inválido' }) };
  }

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email inválido' }) };
  }

  const result = await getOrdersByEmail(email.trim().toLowerCase());

  if (result.status !== 200) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'Error consultando pedidos' }) };
  }

  const orders = (Array.isArray(result.body) ? result.body : []).map(order => ({
    id:              order.id,
    nombre:          order.nombre,
    estado:          mapEstado(order),
    items:           Array.isArray(order.items) ? order.items : [],
    total:           order.total,
    created_at:      order.created_at,
    tracking_number: order.tracking_number || null,
    carrier:         order.carrier || null,
    tracking_url:    buildTrackingUrl(order.carrier, order.tracking_number),
  }));

  return { statusCode: 200, headers, body: JSON.stringify({ orders }) };
};
