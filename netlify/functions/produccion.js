const https = require('https');
const { escapeHtml: h } = require('./lib/escape-html');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

async function getConfig() {
  const result = await supabaseRequest('configuracion?id=eq.1&select=precio_venta,costo_produccion');
  return Array.isArray(result.body) && result.body[0]
    ? result.body[0]
    : { precio_venta: 95000, costo_produccion: 49000 };
}

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
  const config = await getConfig();
  const COSTO_UNIT = config.costo_produccion;
  const PRECIO_UNIT = config.precio_venta;
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

  // Enriquecer diseños con arte_url desde la tabla productos
  const productosResult = await supabaseRequest('productos?select=nombre,arte_url');
  if (Array.isArray(productosResult.body)) {
    const arteMap = {};
    productosResult.body.forEach(p => { arteMap[p.nombre] = p.arte_url || null; });
    Object.keys(byDesign).forEach(key => { byDesign[key].arte_url = arteMap[key] || null; });
  }

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

// ── Notificar a clientes del lote ──
async function notifyClientsLoteReady(pedidosIds) {
  if (!pedidosIds || !pedidosIds.length) return;
  if (!process.env.RESEND_API_KEY) return;

  // Get order details for these pedidos
  const ids = pedidosIds.map(id => `"${id}"`).join(',');
  const ordersResult = await supabaseRequest(
    `pedidos?id=in.(${ids})&select=nombre,email,telefono,items,ciudad`
  );
  const orders = Array.isArray(ordersResult.body) ? ordersResult.body : [];

  for (const order of orders) {
    if (!order.email) continue;

    const items = Array.isArray(order.items) ? order.items : [];
    const itemsText = items.map(i => `${i.name} — Talla ${i.size}`).join(', ');
    const waMsg = encodeURIComponent(
      `Hola ${h(order.nombre)}! Tu pedido de Crazy Monkey está listo y pronto lo recibirás 🖤
${itemsText}`
    );

    const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="background:#080808;color:#d9cdb8;font-family:monospace;margin:0;padding:0">
  <div style="max-width:540px;margin:0 auto;padding:2rem">
    <div style="border-bottom:3px solid #b01a1a;padding-bottom:1rem;margin-bottom:2rem">
      <p style="font-size:1.4rem;color:#f0ebe0;letter-spacing:.1em;margin:0">CRAZY<span style="color:#b01a1a">M</span>ONKEY</p>
      <p style="font-size:.6rem;letter-spacing:.4em;color:#8a8a8a;margin:.3rem 0 0;text-transform:uppercase">✦ Tu pedido está listo</p>
    </div>

    <p style="font-size:.9rem;color:#d9cdb8;line-height:2;margin-bottom:1.5rem">
      Hola ${h(order.nombre)},<br><br>
      Tu pedido terminó producción y está listo para ser enviado. En los próximos días hábiles lo despacharemos a ${h(order.ciudad)}.
    </p>

    <div style="background:#0d0d0d;border:1px solid #1e1e1e;border-left:3px solid #4a9a4a;padding:1.5rem;margin-bottom:1.5rem">
      <p style="font-size:.5rem;letter-spacing:.4em;color:#4a9a4a;text-transform:uppercase;margin-bottom:.8rem">✓ Producción completada</p>
      ${items.map(i => `
        <div style="display:flex;justify-content:space-between;padding:.5rem 0;border-bottom:1px solid #1a1a1a">
          <span style="color:#d9cdb8;font-size:.75rem">${h(i.name)}</span>
          <span style="color:#b01a1a;font-size:.65rem">Talla ${h(i.size)}</span>
        </div>`).join('')}
    </div>

    <div style="background:rgba(74,154,74,.05);border-left:2px solid #4a9a4a;padding:1rem 1.2rem;margin-bottom:1.5rem">
      <p style="font-size:.7rem;color:#d9cdb8;line-height:1.9">
        Recibirás una notificación con el número de guía cuando sea despachado.<br>
        El tiempo de entrega es de <strong style="color:#f0ebe0">3 a 5 días hábiles</strong> desde el despacho.
      </p>
    </div>

    <div style="text-align:center;margin-bottom:1.5rem">
      <a href="https://wa.me/573016568222?text=${waMsg}"
        style="display:inline-block;font-family:monospace;font-size:.6rem;letter-spacing:.25em;color:#d9cdb8;text-decoration:none;border:1px solid #2a2a2a;padding:.7rem 1.5rem;text-transform:uppercase">
        ¿Tienes dudas? Escríbenos →
      </a>
    </div>

    <p style="font-size:.6rem;color:#555;line-height:2;text-align:center">
      Crazy Monkey Collection Noir · Medellín, Colombia<br>
      WhatsApp: +57 301 656 8222
    </p>
  </div>
</body></html>`;

    const emailBody = JSON.stringify({
      from: 'Crazy Monkey <pedidos@crazymonkey.store>',
      to: [order.email],
      subject: `Tu pedido está listo — ${itemsText} · Crazy Monkey`,
      html,
    });

    await new Promise((resolve) => {
      const url = require('https');
      const opts = {
        hostname: 'api.resend.com',
        path: '/emails',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Length': Buffer.byteLength(emailBody),
        },
      };
      const req = url.request(opts, res => {
        res.on('data', () => {});
        res.on('end', resolve);
      });
      req.on('error', resolve);
      req.write(emailBody);
      req.end();
    });

    console.log(`Ready notification sent to ${order.email}`);
  }
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
      costo_unit: (await getConfig()).costo_produccion,
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

    // If estado changed to 'listo' — notify all clients in this lot
    if (estado === 'listo') {
      try {
        // Get the lote to find pedidos_ids
        const loteResult = await supabaseRequest(`lotes_produccion?id=eq.${id}&select=pedidos_ids`);
        const lote = Array.isArray(loteResult.body) ? loteResult.body[0] : null;
        if (lote && Array.isArray(lote.pedidos_ids) && lote.pedidos_ids.length > 0) {
          await notifyClientsLoteReady(lote.pedidos_ids);
        }
      } catch(e) {
        console.error('Notify clients error:', e);
      }
    }

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
