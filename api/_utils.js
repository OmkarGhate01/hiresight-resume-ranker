// Small helpers shared by the API routes. Files starting with "_" are not
// exposed as endpoints by Vercel.

export function allowCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export function readBody(req) {
  // Vercel already parses JSON bodies, but keep a fallback for local `node` runs
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  if (typeof req.body === 'string') return Promise.resolve(JSON.parse(req.body || '{}'));
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch (e) {
        reject(e);
      }
    });
  });
}

export function fail(res, status, message) {
  res.status(status).json({ error: message });
}

// the raw text is big and the API caller already has it
export function slimCandidate(c) {
  const { text, ...rest } = c;
  return rest;
}
