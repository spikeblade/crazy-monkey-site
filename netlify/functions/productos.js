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
  const { httpMethod, queryStringParameters, headers, body } = event;
  const adminPass = headers['x-admin-password'];
  const isAdmin = adminPass && adminPass === process.env.ADMIN_PASSWORD;

  // ── GET: catálogo público (solo activos) o completo para admin ──
  if (httpMethod === 'GET') {
    const filter = isAdmin
      ? 'productos?order=orden.asc&select=*'
      : 'productos?activo=eq.true&order=orden.asc&select=*';

    const result = await supabaseRequest(filter);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
      },
      body: JSON.stringify(result.body),
    };
  }

  // Todo lo siguiente requiere admin
  if (!isAdmin) {
    return { statusCode: 401, body: JSON.stringify({ error: 'No autorizado' }) };
  }

  // ── POST: crear producto nuevo ──
  if (httpMethod === 'POST') {
    let data;
    try { data = JSON.parse(body); }
    catch { return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) }; }

    const { nombre, coleccion, categoria, descripcion, imagen, precio, activo, orden } = data;
    if (!nombre || !coleccion || !categoria || !descripcion || !imagen) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Faltan campos obligatorios' }) };
    }

    const result = await supabaseRequest('productos', 'POST', {
      nombre, coleccion, categoria, descripcion, imagen,
      precio: precio || 95000,
      activo: activo !== false,
      orden: orden || 99,
    });

    return {
      statusCode: result.status === 201 ? 200 : 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result.status === 201 ? { success: true, producto: result.body[0] } : { error: 'Error creando producto' }),
    };
  }

  // ── PATCH: editar producto (nombre, desc, precio, activo, orden) ──
  if (httpMethod === 'PATCH') {
    let data;
    try { data = JSON.parse(body); }
    catch { return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) }; }

    const { id, ...fields } = data;
    if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'Falta id' }) };

    const allowed = ['nombre', 'coleccion', 'categoria', 'descripcion', 'imagen', 'precio', 'activo', 'orden'];
    const clean = Object.fromEntries(Object.entries(fields).filter(([k]) => allowed.includes(k)));

    const result = await supabaseRequest(`productos?id=eq.${id}`, 'PATCH', clean);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }),
    };
  }

  // ── DELETE: eliminar producto ──
  if (httpMethod === 'DELETE') {
    const id = queryStringParameters?.id;
    if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'Falta id' }) };

    await supabaseRequest(`productos?id=eq.${id}`, 'DELETE');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }),
    };
  }

  return { statusCode: 405, body: 'Method Not Allowed' };
};
