const https = require('https');

function supabaseGet(userId) {
  const url = new URL(`${process.env.SUPABASE_URL}/rest/v1/perfiles?id=eq.${userId}&select=*`);
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

// Verify JWT token with Supabase
function verifyToken(token) {
  const url = new URL(`${process.env.SUPABASE_URL}/auth/v1/user`);
  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'GET',
      headers: {
        'apikey': process.env.SUPABASE_ANON_KEY,
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
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const token = (event.headers.authorization || '').replace('Bearer ', '');
  if (!token) {
    return { statusCode: 401, body: JSON.stringify({ error: 'No token' }) };
  }

  // Verify token and get user
  const userResult = await verifyToken(token);
  if (userResult.status !== 200) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid token' }) };
  }

  const userId = userResult.body.id;
  const email = userResult.body.email;

  // Get profile
  const profileResult = await supabaseGet(userId);
  const profile = profileResult.body[0] || null;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile, email, userId }),
  };
};
