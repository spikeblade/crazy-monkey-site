const https = require('https');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const BUCKET_CONFIG = {
  productos: {
    allowedTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'],
    maxBytes: 5 * 1024 * 1024, // 5 MB
    errorMsg: 'Solo imágenes JPEG, PNG, WEBP o GIF. Máximo 5MB.',
  },
  artes: {
    allowedTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/svg+xml', 'application/pdf'],
    maxBytes: 20 * 1024 * 1024, // 20 MB
    errorMsg: 'Solo imágenes o PDF. Máximo 20MB.',
  },
};

function uploadToStorage(bucket, filename, buffer, contentType) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(`${SUPABASE_URL}/storage/v1/object/${bucket}/${filename}`);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'apikey': SUPABASE_KEY,
        'Content-Type': contentType,
        'Content-Length': buffer.length,
        'x-upsert': 'true',
      },
    };
    const req = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.write(buffer);
    req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const adminPass = event.headers['x-admin-password'];
  if (!adminPass || adminPass !== ADMIN_PASSWORD) {
    return { statusCode: 401, body: JSON.stringify({ error: 'No autorizado' }) };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  const { filename, content, contentType, bucket = 'productos' } = data;
  if (!filename || !content || !contentType) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Faltan campos obligatorios: filename, content, contentType' }) };
  }

  const config = BUCKET_CONFIG[bucket];
  if (!config) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Bucket no válido. Usa "productos" o "artes".' }) };
  }

  if (!config.allowedTypes.includes(contentType.toLowerCase())) {
    return { statusCode: 400, body: JSON.stringify({ error: `Tipo de archivo no permitido. ${config.errorMsg}` }) };
  }

  let buffer;
  try {
    buffer = Buffer.from(content, 'base64');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Contenido base64 inválido' }) };
  }

  if (buffer.length > config.maxBytes) {
    return { statusCode: 400, body: JSON.stringify({ error: `Archivo demasiado grande. ${config.errorMsg}` }) };
  }

  const safeName = path.basename(filename)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .toLowerCase();
  const uniqueName = `${Date.now()}_${safeName}`;

  const result = await uploadToStorage(bucket, uniqueName, buffer, contentType);

  if (result.status !== 200) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Error subiendo archivo al storage' }) };
  }

  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${uniqueName}`;
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: publicUrl }),
  };
};
