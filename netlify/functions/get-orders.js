const https = require('https');

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

exports.handler = async (event) => {
  // Verificar contraseña admin
  const adminPass = event.headers['x-admin-password'];
  if (adminPass !== process.env.ADMIN_PASSWORD) {
    return { statusCode: 401, body: JSON.stringify({ error: 'No autorizado' }) };
  }

  // PATCH — actualizar estado de un pedido
  if (event.httpMethod === 'PATCH') {
    const { id, estado } = JSON.parse(event.body);
    const validStates = ['pendiente', 'confirmado', 'enviado', 'entregado'];
    if (!id || !validStates.includes(estado)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Datos inválidos' }) };
    }
    const result = await supabasePatch('pedidos', id, { estado });
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
