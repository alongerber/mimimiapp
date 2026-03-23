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

const MAX_AUDIO_SIZE = 5 * 1024 * 1024; // 5MB

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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });

  const { audio, claim, playerName, convinced, total } = req.body || {};

  if (!audio || typeof audio !== 'string') return res.status(400).json({ error: 'Missing audio' });
  if (!claim || typeof claim !== 'string') return res.status(400).json({ error: 'Missing claim' });
  if (!playerName || typeof playerName !== 'string') return res.status(400).json({ error: 'Missing playerName' });
  if (typeof convinced !== 'number' || typeof total !== 'number') {
    return res.status(400).json({ error: 'Missing convinced/total' });
  }

  // Check audio size (base64 is ~4/3 of original, so decoded size is smaller)
  const audioSizeBytes = Math.ceil(audio.length * 3 / 4);
  if (audioSizeBytes > MAX_AUDIO_SIZE) {
    return res.status(400).json({ error: 'Audio too large (max 5MB)' });
  }

  const prompt = `אתה שופט במשחק "מי מי מי" - משחק שכנוע בעברית.
השחקן "${playerName}" ניסה לשכנע שהטענה הבאה נכונה: "${claim}"
התוצאה: ${convinced} מתוך ${total} שחקנים השתכנעו.

הקשב להקלטה ובצע את המשימות הבאות:
1. תמלל את מה שנאמר
2. חלץ את הציטוט הכי מצחיק או הכי בלתי נשכח
3. נתח את הביטחון הקולי - היסוסים, צחוקים, שכנוע
4. תן ציון שכנוע מ-1 עד 10

החזר JSON בלבד בפורמט הבא (ללא markdown, ללא backticks):
{"score":N,"transcript":"תמלול מלא","bestQuote":"הציטוט הכי טוב","comment":"תגובה קצרה ומצחיקה על הביצוע","funnyLine":"משפט מצחיק על הביצוע","verdict":"משכנע/לא משכנע/על הגבול"}`;

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: 'audio/webm', data: audio } },
              { text: prompt },
            ],
          }],
          generationConfig: { temperature: 0.9, maxOutputTokens: 400 },
        }),
      }
    );

    if (!resp.ok) {
      console.error('Gemini API error:', resp.status);
      return res.status(502).json({ error: 'AI service error' });
    }

    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Try to parse JSON from the response
    try {
      const parsed = JSON.parse(text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim());
      return res.status(200).json(parsed);
    } catch {
      // If parsing fails, return raw text
      return res.status(200).json({ text });
    }
  } catch (e) {
    console.error('Gemini audio proxy error:', e.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
