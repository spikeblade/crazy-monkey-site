const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

function supabaseRequest(path) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
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
    req.end();
  });
}

exports.handler = async (event) => {
  const { httpMethod, headers } = event;

  if (httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const adminPass = headers['x-admin-password'];
  if (!adminPass || adminPass !== process.env.ADMIN_PASSWORD) {
    return { statusCode: 401, body: JSON.stringify({ error: 'No autorizado' }) };
  }

  // Traer todos los pedidos con datos de cliente
  const result = await supabaseRequest(
    'pedidos?select=id,nombre,email,telefono,ciudad,departamento,total,estado,created_at&order=created_at.desc'
  );

  if (result.status !== 200 || !Array.isArray(result.body)) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Error consultando pedidos' }) };
  }

  // Agregar por email → un registro por cliente único
  const byEmail = {};
  result.body.forEach(function(p) {
    const key = (p.email || '').toLowerCase().trim() || `sin-email-${p.id}`;
    if (!byEmail[key]) {
      byEmail[key] = {
        email: p.email || null,
        nombre: p.nombre || '—',
        telefono: p.telefono || null,
        ciudad: p.ciudad || null,
        departamento: p.departamento || null,
        total_pedidos: 0,
        total_gastado: 0,
        ultimo_pedido: p.created_at,
        estados: {},
      };
    }
    const c = byEmail[key];
    c.total_pedidos++;
    c.total_gastado += p.total || 0;
    if (p.created_at > c.ultimo_pedido) {
      c.ultimo_pedido = p.created_at;
      c.nombre = p.nombre || c.nombre;
      c.telefono = p.telefono || c.telefono;
      c.ciudad = p.ciudad || c.ciudad;
    }
    c.estados[p.estado] = (c.estados[p.estado] || 0) + 1;
  });

  const clientes = Object.values(byEmail).sort(function(a, b) {
    return new Date(b.ultimo_pedido) - new Date(a.ultimo_pedido);
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(clientes),
  };
};
