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

const MAX_TEXT_LENGTH = 500;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://mimimiapp.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limit
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  const apiKey = process.env.GOOGLE_TTS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GOOGLE_TTS_API_KEY not configured' });

  const { text } = req.body || {};
  if (!text || typeof text !== 'string') return res.status(400).json({ error: 'Missing text' });
  if (text.length > MAX_TEXT_LENGTH) return res.status(400).json({ error: 'Text too long (max 500 chars)' });

  try {
    const resp = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: 'he-IL', name: 'he-IL-Wavenet-D' },
          audioConfig: { audioEncoding: 'MP3', speakingRate: 0.95 },
        }),
      }
    );

    if (!resp.ok) {
      console.error('Google TTS API error:', resp.status);
      return res.status(502).json({ error: 'TTS service error' });
    }

    const data = await resp.json();
    const audioContent = data?.audioContent || '';

    return res.status(200).json({ audioContent });
  } catch (e) {
    console.error('TTS proxy error:', e.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
