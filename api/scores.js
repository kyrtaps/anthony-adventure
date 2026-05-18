// Vercel serverless function — /api/scores
// GET  → returns top-10 global leaderboard
// POST → upserts a score (best time per name), returns updated board
//
// Backed by Upstash Redis (Vercel Marketplace → Upstash → Redis).
// Env vars injected automatically after connecting the store:
//   UPSTASH_REDIS_REST_URL   and   UPSTASH_REDIS_REST_TOKEN

const KEY = 'anthony_scores';

// Send a single Redis command via Upstash REST pipeline format.
// POST {base} with body ["COMMAND", "arg1", "arg2", ...]
async function upstash(base, token, ...args) {
  const r = await fetch(base, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Upstash ${args[0]} failed: ${r.status} ${text}`);
  }
  const j = await r.json();
  if (j.error) throw new Error(`Upstash error: ${j.error}`);
  return j.result;
}

async function kvGet(base, token) {
  try {
    const result = await upstash(base, token, 'GET', KEY);
    if (!result) return [];
    // result is the stored string — parse it, handling any legacy double-encoding
    let val = result;
    try { val = JSON.parse(val); } catch {}
    if (typeof val === 'string') {
      try { val = JSON.parse(val); } catch {}
    }
    return Array.isArray(val) ? val : [];
  } catch { return []; }
}

async function kvSet(base, token, value) {
  // Store array as a JSON string so GET can always parse it back
  await upstash(base, token, 'SET', KEY, JSON.stringify(value));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // Support both Upstash marketplace vars and legacy KV vars
  const base  = process.env.UPSTASH_REDIS_REST_URL  || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!base || !token) {
    // KV not configured — return empty list gracefully
    res.status(200).json([]);
    return;
  }

  if (req.method === 'GET') {
    const lb = await kvGet(base, token);
    res.status(200).json(lb);
    return;
  }

  if (req.method === 'POST') {
    // Ensure body is parsed (Vercel auto-parses application/json)
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

    const { name, time } = body || {};
    if (typeof name !== 'string' || typeof time !== 'number' || time <= 0) {
      res.status(400).json({ error: 'name (string) and time (positive ms number) required' });
      return;
    }

    const n = name.trim().slice(0, 18) || 'Anon';
    const lb = await kvGet(base, token);
    const idx = lb.findIndex(e => e.name.toLowerCase() === n.toLowerCase());

    if (idx !== -1) {
      if (time < lb[idx].time) lb[idx].time = time; // keep personal best
    } else {
      lb.push({ name: n, time });
    }

    lb.sort((a, b) => a.time - b.time);
    lb.splice(10);
    await kvSet(base, token, lb);
    res.status(200).json(lb);
    return;
  }

  res.status(405).end();
};
