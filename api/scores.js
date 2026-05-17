// Vercel serverless function — /api/scores
// GET  → returns top-10 global leaderboard
// POST → upserts a score (best time per name), returns updated board
//
// Backed by Vercel KV (Upstash Redis REST).
// Needs env vars:  KV_REST_API_URL  and  KV_REST_API_TOKEN
// — these are added automatically when you connect a Vercel KV store to the project.

const KEY = 'anthony_scores';

async function kvGet(base, token) {
  try {
    const r = await fetch(`${base}/get/${KEY}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = await r.json();
    return j.result ? JSON.parse(j.result) : [];
  } catch { return []; }
}

async function kvSet(base, token, value) {
  await fetch(`${base}/set/${KEY}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(JSON.stringify(value)),
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const base  = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  // KV not configured (local dev without env vars) — return empty list
  if (!base || !token) {
    res.status(200).json([]);
    return;
  }

  if (req.method === 'GET') {
    const lb = await kvGet(base, token);
    res.status(200).json(lb);
    return;
  }

  if (req.method === 'POST') {
    const { name, time } = req.body || {};
    if (typeof name !== 'string' || typeof time !== 'number' || time <= 0) {
      res.status(400).json({ error: 'name (string) and time (positive ms number) required' });
      return;
    }

    const n  = name.trim().slice(0, 18) || 'Anon';
    let lb   = await kvGet(base, token);
    const idx = lb.findIndex(e => e.name.toLowerCase() === n.toLowerCase());

    if (idx !== -1) {
      if (time < lb[idx].time) lb[idx].time = time; // keep personal best
    } else {
      lb.push({ name: n, time });
    }

    lb.sort((a, b) => a.time - b.time);
    lb.splice(10); // top 10 only
    await kvSet(base, token, lb);
    res.status(200).json(lb);
    return;
  }

  res.status(405).end();
};
