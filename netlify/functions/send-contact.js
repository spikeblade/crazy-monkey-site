const https = require('https');
const { escapeHtml: h } = require('./lib/escape-html');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  const { nombre, email, telefono, asunto, mensaje } = data;

  if (!nombre || !email || !asunto || !mensaje) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Faltan campos obligatorios' }) };
  }

  if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Email inválido' }) };
  }

  if (mensaje.trim().length < 10) {
    return { statusCode: 400, body: JSON.stringify({ error: 'El mensaje es demasiado corto' }) };
  }

  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="background:#080808;color:#d9cdb8;font-family:monospace;margin:0;padding:0">
  <div style="max-width:520px;margin:0 auto;padding:2rem">

    <div style="border-bottom:3px solid #b01a1a;padding-bottom:1rem;margin-bottom:2rem">
      <p style="font-size:1.4rem;color:#f0ebe0;letter-spacing:.1em;margin:0">
        CRAZY<span style="color:#b01a1a">M</span>ONKEY
      </p>
      <p style="font-size:.6rem;letter-spacing:.4em;color:#8a8a8a;margin:.3rem 0 0;text-transform:uppercase">
        ✦ Nuevo mensaje de contacto
      </p>
    </div>

    <div style="background:#0d0d0d;border:1px solid #1e1e1e;border-left:3px solid #b01a1a;padding:1.5rem;margin-bottom:1.5rem">
      <p style="font-size:.5rem;letter-spacing:.4em;color:#b01a1a;text-transform:uppercase;margin-bottom:.8rem">Remitente</p>
      <p style="font-size:1rem;color:#f0ebe0;margin-bottom:.3rem">${h(nombre)}</p>
      <p style="font-size:.75rem;color:#8a8a8a;margin-bottom:.2rem">✉ ${h(email)}</p>
      ${telefono ? `<p style="font-size:.75rem;color:#8a8a8a">☎ ${h(telefono)}</p>` : ''}
    </div>

    <div style="background:#0d0d0d;border:1px solid #1e1e1e;padding:1.5rem;margin-bottom:1.5rem">
      <p style="font-size:.5rem;letter-spacing:.4em;color:#b01a1a;text-transform:uppercase;margin-bottom:.6rem">Asunto</p>
      <p style="font-size:.85rem;color:#d9cdb8">${h(asunto)}</p>
    </div>

    <div style="background:#0d0d0d;border:1px solid #1e1e1e;padding:1.5rem;margin-bottom:1.5rem">
      <p style="font-size:.5rem;letter-spacing:.4em;color:#b01a1a;text-transform:uppercase;margin-bottom:.8rem">Mensaje</p>
      <p style="font-size:.8rem;color:#d9cdb8;line-height:1.9;white-space:pre-wrap">${h(mensaje)}</p>
    </div>

    <div style="text-align:center;padding-top:1rem;border-top:1px solid #1a1a1a">
      <a href="mailto:${email}?subject=Re: [CrazyMonkey] ${encodeURIComponent(asunto)}"
        style="display:inline-block;font-family:monospace;font-size:.6rem;letter-spacing:.25em;color:#d9cdb8;text-decoration:none;border:1px solid #2a2a2a;padding:.6rem 1.5rem;text-transform:uppercase">
        Responder a ${h(nombre)} →
      </a>
      <p style="font-size:.5rem;color:#333;margin-top:1rem;letter-spacing:.2em">
        Crazy Monkey Collection Noir · Medellín, Colombia
      </p>
    </div>

  </div>
</body>
</html>`;

  const emailBody = JSON.stringify({
    from: 'Crazy Monkey <contacto@crazymonkey.store>',
    to: [process.env.ADMIN_EMAIL],
    reply_to: email,
    subject: `[CrazyMonkey] ${asunto} — ${nombre}`,
    html,
  });

  const result = await new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Length': Buffer.byteLength(emailBody),
      },
    };
    const req = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.write(emailBody);
    req.end();
  });

  if (result.status !== 200 && result.status !== 201) {
    console.error('Resend error:', result.body);
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Error enviando el mensaje. Intenta de nuevo.' }),
    };
  }

  // Also send confirmation to the person who wrote
  const confirmBody = JSON.stringify({
    from: 'Crazy Monkey <contacto@crazymonkey.store>',
    to: [email],
    subject: 'Recibimos tu mensaje — Crazy Monkey',
    html: `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="background:#080808;color:#d9cdb8;font-family:monospace;margin:0;padding:0">
  <div style="max-width:480px;margin:0 auto;padding:2rem">
    <div style="border-bottom:3px solid #b01a1a;padding-bottom:1rem;margin-bottom:2rem">
      <p style="font-size:1.4rem;color:#f0ebe0;letter-spacing:.1em;margin:0">CRAZY<span style="color:#b01a1a">M</span>ONKEY</p>
    </div>
    <p style="font-size:.85rem;color:#d9cdb8;line-height:2;margin-bottom:1.5rem">
      Hola ${h(nombre)},<br><br>
      Recibimos tu mensaje. Te respondemos pronto.
    </p>
    <div style="background:#0d0d0d;border:1px solid #1e1e1e;border-left:3px solid #b01a1a;padding:1.2rem;margin-bottom:1.5rem">
      <p style="font-size:.5rem;letter-spacing:.3em;color:#8a8a8a;text-transform:uppercase;margin-bottom:.5rem">Tu mensaje</p>
      <p style="font-size:.75rem;color:#8a8a8a;line-height:1.8;white-space:pre-wrap">${h(mensaje)}</p>
    </div>
    <p style="font-size:.6rem;color:#555;line-height:2;text-align:center">
      Crazy Monkey Collection Noir · Medellín, Colombia<br>
      WhatsApp: +57 301 656 8222
    </p>
  </div>
</body>
</html>`,
  });

  // Send confirmation async — don't block response
  https.request({
    hostname: 'api.resend.com',
    path: '/emails',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Length': Buffer.byteLength(confirmBody),
    },
  }, () => {}).on('error', () => {}).end(confirmBody);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true }),
  };
};
