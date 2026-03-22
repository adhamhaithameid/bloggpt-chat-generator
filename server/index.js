require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = Number(process.env.PORT) || 5001;
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const toneOptions = new Set(['professional', 'casual', 'friendly', 'persuasive', 'witty']);
const lengthOptions = {
  short: '350-500 words',
  medium: '700-900 words',
  long: '1200-1500 words',
};

app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json({ limit: '1mb' }));

function buildPrompt({ topic, tone, length }) {
  return [
    'You are an expert content writer and SEO blog strategist.',
    `Write a full blog post in Markdown about: "${topic}"`,
    `Tone: ${tone}.`,
    `Target length: ${lengthOptions[length]}.`,
    'Requirements:',
    '- Start with an engaging title.',
    '- Include an introduction that hooks the reader.',
    '- Use clear H2/H3 headings.',
    '- Include practical examples or actionable tips.',
    '- End with a concise conclusion and a call to action.',
    '- Keep the writing natural and human, not robotic.',
    '- Return ONLY the blog content in Markdown, with no extra notes.',
  ].join('\n');
}

function getModel() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY. Add it to server/.env before generating content.');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({ model: MODEL_NAME });
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'ai-blog-generator-api',
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/generate', async (req, res) => {
  const { topic, tone = 'professional', length = 'medium' } = req.body ?? {};

  if (!topic || typeof topic !== 'string' || topic.trim().length < 3) {
    return res.status(400).json({
      message: 'Please enter a valid topic/title with at least 3 characters.',
    });
  }

  const normalizedTone = String(tone).toLowerCase();
  const normalizedLength = String(length).toLowerCase();

  if (!toneOptions.has(normalizedTone)) {
    return res.status(400).json({
      message: 'Invalid tone selected.',
    });
  }

  if (!lengthOptions[normalizedLength]) {
    return res.status(400).json({
      message: 'Invalid length selected.',
    });
  }

  try {
    const prompt = buildPrompt({
      topic: topic.trim(),
      tone: normalizedTone,
      length: normalizedLength,
    });

    const model = getModel();
    const result = await model.generateContent(prompt);
    const content = result.response.text()?.trim();

    if (!content) {
      return res.status(502).json({
        message: 'The AI returned an empty response. Please try again.',
      });
    }

    return res.json({
      content,
      meta: {
        topic: topic.trim(),
        tone: normalizedTone,
        length: normalizedLength,
        model: MODEL_NAME,
      },
    });
  } catch (error) {
    const message = error?.message || 'Generation failed unexpectedly.';

    if (message.toLowerCase().includes('api key') || message.includes('GEMINI_API_KEY')) {
      return res.status(401).json({ message });
    }

    return res.status(500).json({
      message: `Generation failed: ${message}`,
    });
  }
});

app.listen(PORT, () => {
  console.log(`AI Blog Generator API running on http://localhost:${PORT}`);
});
