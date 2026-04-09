/**
 * GET /.netlify/functions/analytics
 * Requiere header x-admin-password.
 *
 * Obtiene todos los pedidos aprobados y calcula métricas en memoria.
 * Para el volumen de una tienda pequeña (< 5.000 pedidos) esto es suficiente
 * y evita agregar funciones SQL adicionales en Supabase.
 */
const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

function fetchOrders() {
  const url = new URL(
    `${SUPABASE_URL}/rest/v1/pedidos?mp_status=eq.approved&select=total,created_at,estado,items,departamento&order=created_at.asc&limit=5000`
  );
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

function weekLabel(date) {
  return `${String(date.getDate()).padStart(2,'0')}/${String(date.getMonth()+1).padStart(2,'0')}`;
}

function computeAnalytics(orders) {
  const now = new Date();
  const startOfMonth     = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

  // Últimas 8 semanas (de más antigua a más reciente)
  const semanas = [];
  for (let i = 7; i >= 0; i--) {
    const start = new Date(now);
    start.setDate(start.getDate() - (i + 1) * 7);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    semanas.push({ start, end, label: weekLabel(start), ingresos: 0, pedidos: 0 });
  }

  let ingresos_total = 0;
  let ingresos_mes = 0;
  let ingresos_mes_anterior = 0;
  let pedidos_mes = 0;
  let pedidos_mes_anterior = 0;

  const por_estado = { confirmado: 0, en_produccion: 0, listo: 0, enviado: 0, entregado: 0 };
  const productosMap = {};
  const departamentosMap = {};
  const tallasMap = {};

  for (const order of orders) {
    const fecha = new Date(order.created_at);
    const total = order.total || 0;

    ingresos_total += total;

    if (fecha >= startOfMonth) {
      ingresos_mes += total;
      pedidos_mes++;
    }
    if (fecha >= startOfLastMonth && fecha <= endOfLastMonth) {
      ingresos_mes_anterior += total;
      pedidos_mes_anterior++;
    }

    if (order.estado && order.estado in por_estado) por_estado[order.estado]++;

    if (order.departamento) {
      departamentosMap[order.departamento] = (departamentosMap[order.departamento] || 0) + 1;
    }

    const items = Array.isArray(order.items) ? order.items : [];
    for (const item of items) {
      const nombre = item.name || item.nombre || '?';
      productosMap[nombre] = (productosMap[nombre] || 0) + 1;
      const talla = item.size || item.talla || '?';
      tallasMap[talla] = (tallasMap[talla] || 0) + 1;
    }

    for (const s of semanas) {
      if (fecha >= s.start && fecha < s.end) {
        s.ingresos += total;
        s.pedidos++;
        break;
      }
    }
  }

  const variacion_ingresos = ingresos_mes_anterior > 0
    ? Math.round(((ingresos_mes - ingresos_mes_anterior) / ingresos_mes_anterior) * 100)
    : null;

  const variacion_pedidos = pedidos_mes_anterior > 0
    ? Math.round(((pedidos_mes - pedidos_mes_anterior) / pedidos_mes_anterior) * 100)
    : null;

  const top_productos = Object.entries(productosMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([nombre, unidades]) => ({ nombre, unidades }));

  const top_departamentos = Object.entries(departamentosMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([departamento, pedidos]) => ({ departamento, pedidos }));

  const tallas = Object.entries(tallasMap)
    .sort((a, b) => b[1] - a[1])
    .map(([talla, cantidad]) => ({ talla, cantidad }));

  return {
    resumen: {
      ingresos_total,
      ingresos_mes,
      ingresos_mes_anterior,
      variacion_ingresos,
      pedidos_total: orders.length,
      pedidos_mes,
      pedidos_mes_anterior,
      variacion_pedidos,
      ticket_promedio: orders.length ? Math.round(ingresos_total / orders.length) : 0,
    },
    por_semana: semanas.map(s => ({ label: s.label, ingresos: s.ingresos, pedidos: s.pedidos })),
    top_productos,
    por_estado,
    top_departamentos,
    tallas,
  };
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  if (event.headers?.['x-admin-password'] !== process.env.ADMIN_PASSWORD) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'No autorizado' }) };
  }

  const result = await fetchOrders();
  if (result.status !== 200 || !Array.isArray(result.body)) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'Error consultando pedidos' }) };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(computeAnalytics(result.body)),
  };
};

// Exportar para tests
exports._computeAnalytics = computeAnalytics;
