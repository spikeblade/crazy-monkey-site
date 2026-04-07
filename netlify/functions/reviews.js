const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

function supabaseRequest(path, method = 'GET', body = null, token = null) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
  const bodyStr = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token || SUPABASE_ANON_KEY}`,
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

function verifyToken(token) {
  const url = new URL(`${SUPABASE_URL}/auth/v1/user`);
  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'GET',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token}`,
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

exports.handler = async (event) => {
  const { httpMethod, queryStringParameters, headers, body } = event;
  const producto = queryStringParameters?.producto;

  // ── GET: obtener reviews de un producto ──
  if (httpMethod === 'GET') {
    if (!producto) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Falta producto' }) };
    }

    const encodedProducto = encodeURIComponent(producto);
    const result = await supabaseRequest(
      `reviews?producto=eq.${encodedProducto}&aprobada=eq.true&order=created_at.desc&select=*`
    );

    // Calculate average
    const reviews = Array.isArray(result.body) ? result.body : [];
    const avg = reviews.length
      ? (reviews.reduce((s, r) => s + r.estrellas, 0) / reviews.length).toFixed(1)
      : null;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviews, avg, total: reviews.length }),
    };
  }

  // ── POST: crear review (requiere auth + verificar compra) ──
  if (httpMethod === 'POST') {
    const token = (headers.authorization || '').replace('Bearer ', '');
    if (!token) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Debes iniciar sesión para dejar una review.' }) };
    }

    // Verify user
    const userResult = await verifyToken(token);
    if (userResult.status !== 200) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Sesión inválida.' }) };
    }

    const userId = userResult.body.id;
    const userEmail = userResult.body.email;

    let data;
    try { data = JSON.parse(body); }
    catch { return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) }; }

    const { producto: prod, estrellas, comentario, nombre } = data;

    if (!prod || !estrellas || !comentario) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Faltan campos obligatorios.' }) };
    }
    if (estrellas < 1 || estrellas > 5) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Estrellas debe ser entre 1 y 5.' }) };
    }
    if (comentario.trim().length < 10) {
      return { statusCode: 400, body: JSON.stringify({ error: 'El comentario debe tener al menos 10 caracteres.' }) };
    }

    // Verify purchase — check if user has an order with this product
    const ordersResult = await supabaseRequest(
      `pedidos?user_id=eq.${userId}&select=items`,
      'GET', null, token
    );

    const orders = Array.isArray(ordersResult.body) ? ordersResult.body : [];
    const hasPurchased = orders.some(order => {
      const items = Array.isArray(order.items) ? order.items : [];
      return items.some(item =>
        item.name && item.name.toLowerCase().trim() === prod.toLowerCase().trim()
      );
    });

    if (!hasPurchased) {
      return {
        statusCode: 403,
        body: JSON.stringify({ error: 'Solo puedes reseñar productos que hayas comprado.' }),
      };
    }

    // Check if user already reviewed this product
    const existingResult = await supabaseRequest(
      `reviews?user_id=eq.${userId}&producto=eq.${encodeURIComponent(prod)}&select=id`,
      'GET', null, token
    );
    if (Array.isArray(existingResult.body) && existingResult.body.length > 0) {
      return {
        statusCode: 409,
        body: JSON.stringify({ error: 'Ya dejaste una reseña para este producto.' }),
      };
    }

    // Save review
    const review = {
      user_id: userId,
      producto: prod,
      estrellas: parseInt(estrellas),
      comentario: comentario.trim(),
      nombre: nombre || userEmail.split('@')[0],
      aprobada: true,
    };

    const saveResult = await supabaseRequest('reviews', 'POST', review, token);

    if (saveResult.status !== 201) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Error guardando la reseña.' }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, review: saveResult.body[0] }),
    };
  }

  return { statusCode: 405, body: 'Method Not Allowed' };
};
