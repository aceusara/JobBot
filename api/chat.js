// api/chat.js — Secure OpenRouter proxy
// API key lives ONLY here in Vercel env vars, never in the browser.

const ALLOWED_ORIGINS = [
  'https://job-bot-orcin.vercel.app',
  'https://jobbot.vercel.app'
];

const ALLOWED_MODELS = new Set([
  'openai/gpt-4o-mini',
  'openai/gpt-4o',
  'anthropic/claude-3-haiku',
  'anthropic/claude-3.5-sonnet',
  'meta-llama/llama-3.1-8b-instruct:free',
  'google/gemma-2-9b-it:free',
]);

const DEFAULT_MODEL = 'openai/gpt-4o-mini';

// In-memory rate limiter: max 20 requests / minute / IP
const rateLimitMap = new Map();
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, resetAt: now + RATE_WINDOW_MS };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + RATE_WINDOW_MS; }
  entry.count++;
  rateLimitMap.set(ip, entry);
  return entry.count <= RATE_LIMIT;
}

function sanitize(str, maxLen = 12000) {
  if (typeof str !== 'string') return '';
  return str.replace(/\0/g, '').slice(0, maxLen);
}

export default async function handler(req, res) {
  // ── CORS ─────────────────────────────────────────────────
  const origin = req.headers['origin'] || '';
  const isDev = process.env.NODE_ENV === 'development' || process.env.VERCEL_ENV === 'development';
  const originAllowed = isDev || ALLOWED_ORIGINS.includes(origin);

  if (originAllowed) {
    res.setHeader('Access-Control-Allow-Origin', isDev ? '*' : origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!originAllowed) return res.status(403).json({ error: 'Forbidden' });

  // ── RATE LIMIT ────────────────────────────────────────────
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  }

  // ── PARSE & VALIDATE ──────────────────────────────────────
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const { messages, model: requestedModel, system } = body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }

  const model = ALLOWED_MODELS.has(requestedModel) ? requestedModel : DEFAULT_MODEL;

  // Sanitize user messages
  const safeUserMessages = messages
    .filter(m => m && typeof m === 'object' && ['user', 'assistant'].includes(m.role))
    .slice(-20)
    .map(m => ({ role: m.role, content: sanitize(String(m.content || ''), 12000) }));

  if (safeUserMessages.length === 0) {
    return res.status(400).json({ error: 'No valid messages provided' });
  }

  // ── BUILD MESSAGE ARRAY ───────────────────────────────────
  // For OpenAI-compatible models (gpt-4o-mini etc.) the system prompt
  // must be injected as role:"system" inside the messages array.
  // Sending it as a top-level "system" key is Anthropic's format only.
  const safeSystem = system ? sanitize(String(system), 4000) : null;

  const fullMessages = safeSystem
    ? [{ role: 'system', content: safeSystem }, ...safeUserMessages]
    : safeUserMessages;

  // ── CALL OPENROUTER ───────────────────────────────────────
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('[jobbot] OPENROUTER_API_KEY not set');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const payload = {
    model,
    max_tokens: 2000,
    messages: fullMessages,
  };

  try {
    const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://job-bot-puce.vercel.app',
        'X-Title': 'JobBot',
      },
      body: JSON.stringify(payload),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      console.error('[jobbot] OpenRouter error:', upstream.status, errText.slice(0, 200));
      return res.status(upstream.status).json({ error: 'AI service error. Please try again.' });
    }

    const data = await upstream.json();
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      return res.status(502).json({ error: 'Empty response from AI service.' });
    }

    return res.status(200).json({ content });

  } catch (err) {
    console.error('[jobbot] Fetch error:', err.message);
    return res.status(500).json({ error: 'Failed to reach AI service. Check your connection.' });
  }
}
