/**
 * /.netlify/functions/taxonomias
 *
 * GET  ?tipo=categorias|colecciones          → lista (público)
 * POST   { tipo, nombre, slug?, descripcion?, orden? }  → crear (admin)
 * PATCH  ?id=<uuid>&tipo=...  body: campos   → editar (admin)
 * DELETE ?id=<uuid>&tipo=...                 → eliminar (admin)
 *
 * Admin: header x-admin-password requerido en POST/PATCH/DELETE.
 */
const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

const TABLAS_VALIDAS = new Set(['categorias', 'colecciones']);

function supabaseReq(path, method = 'GET', body = null) {
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

function isAdmin(event) {
  return event.headers?.['x-admin-password'] === process.env.ADMIN_PASSWORD;
}

function slugify(str) {
  return str
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, x-admin-password',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const params = event.queryStringParameters || {};
  const tipo = params.tipo;

  // ── GET: lista pública ordenada ───────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    if (!tipo || !TABLAS_VALIDAS.has(tipo)) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'tipo inválido (categorias|colecciones)' }) };
    }
    const result = await supabaseReq(`${tipo}?order=orden.asc,nombre.asc`);
    return { statusCode: 200, headers: CORS, body: JSON.stringify(result.body) };
  }

  // ── Escritura: requiere admin ─────────────────────────────────────────────
  if (!isAdmin(event)) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'No autorizado' }) };
  }

  // ── POST: crear ───────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let payload;
    try { payload = JSON.parse(event.body || '{}'); }
    catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'JSON inválido' }) }; }

    const { tipo: bodyTipo, nombre, descripcion, orden } = payload;
    const tabla = bodyTipo;

    if (!tabla || !TABLAS_VALIDAS.has(tabla)) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'tipo inválido' }) };
    }
    if (!nombre || typeof nombre !== 'string' || !nombre.trim()) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'nombre requerido' }) };
    }

    const data = { nombre: nombre.trim(), orden: orden ?? 0 };
    if (tabla === 'categorias') data.slug = payload.slug ? payload.slug.trim() : slugify(nombre);
    if (tabla === 'colecciones' && descripcion) data.descripcion = descripcion.trim();

    const result = await supabaseReq(tabla, 'POST', data);
    if (result.status !== 201) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Error al crear', detail: result.body }) };
    }
    return { statusCode: 201, headers: CORS, body: JSON.stringify(result.body) };
  }

  // ── PATCH: editar ─────────────────────────────────────────────────────────
  if (event.httpMethod === 'PATCH') {
    const { id } = params;
    if (!tipo || !TABLAS_VALIDAS.has(tipo) || !id) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'tipo e id requeridos' }) };
    }
    let payload;
    try { payload = JSON.parse(event.body || '{}'); }
    catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'JSON inválido' }) }; }

    // Solo se permite actualizar campos válidos
    const allowed = tipo === 'categorias'
      ? ['nombre', 'slug', 'orden']
      : ['nombre', 'descripcion', 'orden', 'activo'];

    const data = {};
    for (const key of allowed) {
      if (key in payload) data[key] = payload[key];
    }
    // Si cambia el nombre en categorias, actualizar slug automáticamente
    if (tipo === 'categorias' && data.nombre && !data.slug) {
      data.slug = slugify(data.nombre);
    }

    if (Object.keys(data).length === 0) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Sin campos para actualizar' }) };
    }

    const result = await supabaseReq(`${tipo}?id=eq.${id}`, 'PATCH', data);
    return { statusCode: 200, headers: CORS, body: JSON.stringify(result.body) };
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'DELETE') {
    const { id } = params;
    if (!tipo || !TABLAS_VALIDAS.has(tipo) || !id) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'tipo e id requeridos' }) };
    }
    const result = await supabaseReq(`${tipo}?id=eq.${id}`, 'DELETE');
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Método no permitido' }) };
};
