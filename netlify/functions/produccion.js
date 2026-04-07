const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const COSTO_UNIT = 49000;
const PRECIO_UNIT = 95000;

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

// Build production summary from confirmed orders not yet in a lot
async function buildSummary(pedidoIds = null) {
  // Get confirmed orders
  let query = 'pedidos?estado=in.(confirmado,enviado)&select=id,nombre,items,total,created_at,estado';
  const ordersResult = await supabaseRequest(query);
  let orders = Array.isArray(ordersResult.body) ? ordersResult.body : [];

  // Filter to specific pedido IDs if provided
  if (pedidoIds && pedidoIds.length > 0) {
    orders = orders.filter(o => pedidoIds.includes(o.id));
  }

  // Aggregate by product + size
  const byDesign = {};
  let totalUnidades = 0;
  let totalIngresos = 0;

  orders.forEach(order => {
    const items = Array.isArray(order.items) ? order.items : [];
    totalIngresos += order.total || 0;
    items.forEach(item => {
      const key = item.name;
      if (!byDesign[key]) {
        byDesign[key] = { nombre: item.name, tallas: {}, subtotal: 0 };
      }
      const talla = item.size || '?';
      byDesign[key].tallas[talla] = (byDesign[key].tallas[talla] || 0) + 1;
      byDesign[key].subtotal++;
      totalUnidades++;
    });
  });

  const totalCosto = totalUnidades * COSTO_UNIT;
  const margen = totalIngresos - totalCosto;

  return {
    designs: Object.values(byDesign).sort((a, b) => b.subtotal - a.subtotal),
    totalUnidades,
    totalIngresos,
    totalCosto,
    margen,
    pedidosCount: orders.length,
    orders,
  };
}

exports.handler = async (event) => {
  const { httpMethod, queryStringParameters, headers, body } = event;
  const adminPass = headers['x-admin-password'];
  if (adminPass !== process.env.ADMIN_PASSWORD) {
    return { statusCode: 401, body: JSON.stringify({ error: 'No autorizado' }) };
  }

  // ── GET summary: pedidos confirmados pendientes de producción ──
  if (httpMethod === 'GET' && queryStringParameters?.action === 'summary') {
    const summary = await buildSummary();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(summary),
    };
  }

  // ── GET lotes: lista de lotes de producción ──
  if (httpMethod === 'GET') {
    const result = await supabaseRequest('lotes_produccion?order=created_at.desc&select=*');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result.body),
    };
  }

  // ── POST: crear nuevo lote ──
  if (httpMethod === 'POST') {
    let data;
    try { data = JSON.parse(body); }
    catch { return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) }; }

    const { nombre, notas, pedidos_ids } = data;
    if (!nombre) return { statusCode: 400, body: JSON.stringify({ error: 'Nombre requerido' }) };

    // Build summary for this lot
    const summary = await buildSummary(pedidos_ids);

    const lote = {
      nombre,
      estado: 'borrador',
      costo_unit: COSTO_UNIT,
      notas: notas || null,
      pedidos_ids: pedidos_ids || summary.orders.map(o => o.id),
      // Store summary snapshot
      snapshot: {
        designs: summary.designs,
        totalUnidades: summary.totalUnidades,
        totalIngresos: summary.totalIngresos,
        totalCosto: summary.totalCosto,
        margen: summary.margen,
        pedidosCount: summary.pedidosCount,
        generado: new Date().toISOString(),
      },
    };

    const result = await supabaseRequest('lotes_produccion', 'POST', lote);
    return {
      statusCode: result.status === 201 ? 200 : 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        result.status === 201
          ? { success: true, lote: result.body[0] }
          : { error: 'Error creando lote' }
      ),
    };
  }

  // ── PATCH: actualizar estado del lote ──
  if (httpMethod === 'PATCH') {
    let data;
    try { data = JSON.parse(body); }
    catch { return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) }; }

    const { id, estado, notas } = data;
    if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'Falta id' }) };

    const update = {};
    if (estado) update.estado = estado;
    if (notas !== undefined) update.notas = notas;

    await supabaseRequest(`lotes_produccion?id=eq.${id}`, 'PATCH', update);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }),
    };
  }

  // ── DELETE: eliminar lote ──
  if (httpMethod === 'DELETE') {
    const id = queryStringParameters?.id;
    if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'Falta id' }) };
    await supabaseRequest(`lotes_produccion?id=eq.${id}`, 'DELETE');
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  }

  return { statusCode: 405, body: 'Method Not Allowed' };
};
