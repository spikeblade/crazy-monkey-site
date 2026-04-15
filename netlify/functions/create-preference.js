const https = require('https');

function mpRequest(path, body) {
  const postData = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.mercadopago.com',
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        'Content-Length': Buffer.byteLength(postData),
      },
    };
    const req = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { reject(new Error('Invalid MP response')); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { items, payer } = body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No items in cart' }) };
  }

  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) {
    return { statusCode: 500, body: JSON.stringify({ error: 'MP_ACCESS_TOKEN not configured' }) };
  }

  // ── Verificar stock antes de crear la preferencia ──
  // Contamos cuántas unidades de cada producto pide el carrito
  const stockNeeded = {};
  for (const item of items) {
    stockNeeded[item.name] = (stockNeeded[item.name] || 0) + 1;
  }

  for (const [nombre, cantidad] of Object.entries(stockNeeded)) {
    const url = new URL(
      `${process.env.SUPABASE_URL}/rest/v1/productos?nombre=eq.${encodeURIComponent(nombre)}&select=stock_total,stock_vendido&activo=eq.true`
    );
    let stockOk = true;
    try {
      const rows = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: url.hostname,
          path: url.pathname + url.search,
          method: 'GET',
          headers: {
            'apikey': process.env.SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
          },
        }, res => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve([]); } });
        });
        req.on('error', reject);
        req.end();
      });

      const producto = rows[0];
      if (producto && producto.stock_total !== null) {
        const disponible = (producto.stock_total || 0) - (producto.stock_vendido || 0);
        if (disponible < cantidad) stockOk = false;
      }
    } catch (e) {
      console.error('Stock check error:', e);
      // Si falla la verificación, dejamos pasar (fail open) — el webhook hará la guarda final
    }

    if (!stockOk) {
      return {
        statusCode: 409,
        body: JSON.stringify({ error: 'stock_agotado', producto: nombre }),
      };
    }
  }

  // total already calculated above from config

  // Obtener precio actual desde configuración
  let precioVenta = 95000;
  try {
    const url = new URL(`${process.env.SUPABASE_URL}/rest/v1/configuracion?id=eq.1&select=precio_venta`);
    const rows = await new Promise((resolve) => {
      const req = https.request({
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        },
      }, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve([]); } });
      });
      req.on('error', () => resolve([]));
      req.end();
    });
    if (rows[0]?.precio_venta) precioVenta = rows[0].precio_venta;
  } catch(e) {
    console.error('Config fetch error:', e);
  }

  const total = items.reduce((sum, item) => sum + precioVenta, 0);

  const preference = {
    items: items.map(item => ({
      id: (item.name || 'producto').replace(/\s+/g, '-').toLowerCase(),
      title: `${item.name} — Talla ${item.size}`,
      description: 'Crazy Monkey Collection Noir — Edición Limitada',
      category_id: 'fashion',
      quantity: 1,
      currency_id: 'COP',
      unit_price: precioVenta,
    })),
    payer: payer ? {
      name: payer.nombre || '',
      phone: { number: payer.telefono || '' },
      address: {
        city: payer.ciudad || '',
        state_name: payer.departamento || '',
        country: 'CO',
      },
    } : {},
    back_urls: {
      success: `${process.env.SITE_URL}/pago-exitoso.html`,
      failure: `${process.env.SITE_URL}/pago-fallido.html`,
      pending: `${process.env.SITE_URL}/pago-exitoso.html`,
    },
    auto_return: 'approved',
    payment_methods: { installments: 1 },
    statement_descriptor: 'CRAZY MONKEY',
    external_reference: `CM-${Date.now()}`,
    metadata: {
      nombre: payer?.nombre,
      telefono: payer?.telefono,
      departamento: payer?.departamento,
      ciudad: payer?.ciudad,
    },
  };

  const mpResponse = await mpRequest('/checkout/preferences', preference);

  if (mpResponse.status !== 201) {
    console.error('MP Error:', mpResponse.body);
    return { statusCode: 502, body: JSON.stringify({ error: 'MP API error' }) };
  }

  // Pre-guardar el pedido en Supabase como "pendiente"
  // Se confirmará cuando MP notifique el pago aprobado
  try {
    const saveBody = JSON.stringify({
      nombre: payer?.nombre || 'Anónimo',
      telefono: payer?.telefono || '',
      email: payer?.email || null,
      departamento: payer?.departamento || '',
      ciudad: payer?.ciudad || '',
      direccion: payer?.direccion || '',
      items,
      total,
      mp_preference_id: mpResponse.body.id,
      mp_status: 'pending',
      ...(payer?.userId ? { user_id: payer.userId } : {}),
    });

    const supaUrl = new URL(`${process.env.SUPABASE_URL}/rest/v1/pedidos`);
    await new Promise((resolve, reject) => {
      const opts = {
        hostname: supaUrl.hostname,
        path: supaUrl.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
          'Prefer': 'return=minimal',
          'Content-Length': Buffer.byteLength(saveBody),
        },
      };
      const req = https.request(opts, res => {
        res.on('data', () => {});
        res.on('end', resolve);
      });
      req.on('error', reject);
      req.write(saveBody);
      req.end();
    });
  } catch (e) {
    console.error('Supabase pre-save error:', e);
    // No bloqueamos el flujo — el pedido igual va a MP
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      init_point: mpResponse.body.init_point,
      sandbox_init_point: mpResponse.body.sandbox_init_point,
      preference_id: mpResponse.body.id,
    }),
  };
};
