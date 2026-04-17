const https = require('https');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const BUCKET = 'productos';

const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

function uploadToStorage(filename, buffer, contentType) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${filename}`);
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

  const { filename, content, contentType } = data;
  if (!filename || !content || !contentType) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Faltan campos obligatorios: filename, content, contentType' }) };
  }

  if (!ALLOWED_TYPES.includes(contentType.toLowerCase())) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Tipo de archivo no permitido. Solo imágenes JPEG, PNG, WEBP o GIF.' }) };
  }

  let buffer;
  try {
    buffer = Buffer.from(content, 'base64');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Contenido base64 inválido' }) };
  }

  if (buffer.length > MAX_SIZE_BYTES) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Imagen demasiado grande. Máximo 5MB.' }) };
  }

  // Nombre único: timestamp + nombre original sanitizado
  const safeName = path.basename(filename)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .toLowerCase();
  const uniqueName = `${Date.now()}_${safeName}`;

  const result = await uploadToStorage(uniqueName, buffer, contentType);

  if (result.status !== 200) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Error subiendo imagen al storage' }) };
  }

  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${uniqueName}`;
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: publicUrl }),
  };
};
