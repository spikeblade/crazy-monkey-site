const https = require('https');

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

exports.handler = async (event) => {
  const { httpMethod, headers, body } = event;

  // ── GET: lectura pública (precio de venta visible en tienda) ──
  if (httpMethod === 'GET') {
    const result = await supabaseRequest('configuracion?id=eq.1&select=precio_venta,costo_produccion');
    const config = Array.isArray(result.body) && result.body[0]
      ? result.body[0]
      : { precio_venta: 95000, costo_produccion: 49000 };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300', // cache 5 min
      },
      body: JSON.stringify(config),
    };
  }

  // ── PATCH: actualizar (solo admin) ──
  if (httpMethod === 'PATCH') {
    const adminPass = headers['x-admin-password'];
    if (adminPass !== process.env.ADMIN_PASSWORD) {
      return { statusCode: 401, body: JSON.stringify({ error: 'No autorizado' }) };
    }

    let data;
    try { data = JSON.parse(body); }
    catch { return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) }; }

    const { precio_venta, costo_produccion } = data;

    if (!precio_venta || !costo_produccion) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Ambos valores son obligatorios' }) };
    }

    if (precio_venta < costo_produccion) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'El precio de venta no puede ser menor al costo de producción' }),
      };
    }

    const update = {
      precio_venta: parseInt(precio_venta),
      costo_produccion: parseInt(costo_produccion),
      updated_at: new Date().toISOString(),
    };

    const result = await supabaseRequest('configuracion?id=eq.1', 'PATCH', update);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, config: update }),
    };
  }

  return { statusCode: 405, body: 'Method Not Allowed' };
};
