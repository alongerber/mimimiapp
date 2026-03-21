// In-memory rate limiter (per Vercel instance)
const rateLimiter = new Map();
const RATE_LIMIT = 20; // max requests per IP per minute
const RATE_WINDOW = 60000;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimiter.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW) {
    rateLimiter.set(ip, { start: now, count: 1 });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// Validate request type
const ALLOWED_TYPES = ['mic', 'summary'];
const MAX_PROMPT_LENGTH = 2000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limit
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });

  const { prompt, type } = req.body || {};
  if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'Missing prompt' });
  if (!type || !ALLOWED_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid type' });
  if (prompt.length > MAX_PROMPT_LENGTH) return res.status(400).json({ error: 'Prompt too long' });

  const maxTokens = type === 'summary' ? 500 : 300;
  const temperature = type === 'summary' ? 0.95 : 0.9;

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature, maxOutputTokens: maxTokens },
        }),
      }
    );

    if (!resp.ok) {
      console.error('Gemini API error:', resp.status);
      return res.status(502).json({ error: 'AI service error' });
    }

    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    return res.status(200).json({ text });
  } catch (e) {
    console.error('Gemini proxy error:', e.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
