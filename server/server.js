require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const PORT = process.env.PORT || 3010;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';
const APK_REPO = process.env.APK_REPO || '';
const APK_ASSET_NAME = process.env.APK_ASSET_NAME || 'helper.apk';

const SYSTEM_PROMPT = `You are Helfer, a warm and patient voice companion for a retired person who is talking to you out loud on their smartphone.
Rules:
- Keep answers SHORT: one to three short sentences, because your reply will be read aloud by text-to-speech.
- Use simple, everyday words. No markdown, no bullet lists, no emojis, no asterisks.
- Be warm, respectful, and unhurried. Never sound condescending.
- You cannot browse the internet, so if asked about today's news, weather, or anything requiring live information, say plainly that you can't check that right now.
- If the person sounds distressed, confused, mentions chest pain, a fall, or another possible medical emergency, gently and clearly suggest they call a family member or emergency services right away.
- You cannot place phone calls yourself. If asked to call someone, say you can only do that through the app's "call" command, not directly in conversation.`;

const app = express();
app.use(cors());
app.use(express.json({ limit: '100kb' }));

app.get('/health', (req, res) => {
  res.json({ ok: true, model: ANTHROPIC_MODEL, hasApiKey: Boolean(ANTHROPIC_API_KEY) });
});

// Stable branded download link for the Android app - always points at the
// most recent APK published by the GitHub Actions build.
app.get('/download', (req, res) => {
  if (!APK_REPO) {
    res.status(500).send('APK_REPO is not configured on the server yet.');
    return;
  }
  res.redirect(`https://github.com/${APK_REPO}/releases/latest/download/${APK_ASSET_NAME}`);
});

app.post('/api/chat', async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    res.status(503).json({
      ok: false,
      text: "I don't have my thinking turned on yet. Please ask whoever runs this app to set it up.",
    });
    return;
  }

  const userText = typeof req.body.message === 'string' ? req.body.message.trim() : '';
  const history = Array.isArray(req.body.history) ? req.body.history.slice(-10) : [];

  if (!userText) {
    res.status(400).json({ ok: false, text: "I didn't catch that. Please try again." });
    return;
  }

  const messages = [...history, { role: 'user', content: userText }];

  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        output_config: { effort: 'low' },
        messages,
      }),
    });
  } catch (err) {
    res.status(502).json({ ok: false, text: "I couldn't reach my AI service just now. Please try again in a moment." });
    return;
  }

  if (!response.ok) {
    let message = '';
    try {
      const body = await response.json();
      message = body?.error?.message || '';
    } catch {
      // ignore parse errors from the upstream API
    }
    if (response.status === 401) {
      console.error('Anthropic API key rejected (401).');
      res.status(502).json({ ok: false, text: 'My AI service is not set up correctly. Please tell whoever runs this app.' });
      return;
    }
    if (response.status === 429) {
      res.status(429).json({ ok: false, text: "I'm a little busy right now. Please try again in a moment." });
      return;
    }
    res.status(502).json({ ok: false, text: `Sorry, something went wrong. ${message}`.trim() });
    return;
  }

  const data = await response.json();
  const text = (data.content || [])
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join(' ')
    .trim();

  res.json({ ok: true, text: text || "I'm not sure how to answer that." });
});

// Serve the web app (also usable as an installable PWA in a regular
// browser). The Android app loads these same pages remotely.
app.use(express.static(path.join(__dirname, '..', 'app', 'www')));

app.listen(PORT, () => {
  console.log(`Helfer server listening on port ${PORT} (model: ${ANTHROPIC_MODEL})`);
});
