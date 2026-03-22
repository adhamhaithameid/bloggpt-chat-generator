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

function getModel() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY. Add it to server/.env before generating content.');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({ model: MODEL_NAME });
}

function normalizeTone(tone) {
  const normalizedTone = String(tone || 'professional').toLowerCase();

  if (!toneOptions.has(normalizedTone)) {
    throw new Error('Invalid tone selected.');
  }

  return normalizedTone;
}

function normalizeLength(length) {
  const normalizedLength = String(length || 'medium').toLowerCase();

  if (!lengthOptions[normalizedLength]) {
    throw new Error('Invalid length selected.');
  }

  return normalizedLength;
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter((entry) => entry && typeof entry.content === 'string' && typeof entry.role === 'string')
    .map((entry) => ({
      role: entry.role === 'assistant' ? 'Assistant' : 'User',
      content: entry.content.trim(),
    }))
    .filter((entry) => entry.content.length > 0)
    .slice(-10);
}

function buildChatPrompt({ message, history, tone, length }) {
  const transcriptRows = sanitizeHistory(history).map((entry) => `${entry.role}: ${entry.content}`);
  transcriptRows.push(`User: ${message.trim()}`);

  return [
    'You are BlogGPT, an expert blog writing assistant.',
    `Primary tone: ${tone}.`,
    `Target output length: ${lengthOptions[length]}.`,
    'Rules:',
    '- Respond in Markdown only.',
    '- If asked to create a blog post, return a polished article with title, intro, clear headings, practical insights, and conclusion.',
    '- If asked to revise, return the fully updated blog draft.',
    '- Do not include meta commentary about instructions.',
    '',
    'Conversation transcript:',
    transcriptRows.join('\n\n'),
  ].join('\n');
}

async function generateReply({ message, history, tone, length }) {
  const prompt = buildChatPrompt({ message, history, tone, length });
  const model = getModel();
  const result = await model.generateContent(prompt);
  const text = result.response.text()?.trim();

  if (!text) {
    throw new Error('The AI returned an empty response. Please try again.');
  }

  return text;
}

function mapErrorToHttpStatus(message) {
  if (message.toLowerCase().includes('api key') || message.includes('GEMINI_API_KEY')) {
    return 401;
  }

  if (message === 'Invalid tone selected.' || message === 'Invalid length selected.') {
    return 400;
  }

  if (message.includes('empty response')) {
    return 502;
  }

  return 500;
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'ai-blog-generator-api',
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/chat', async (req, res) => {
  const { message, history = [], tone = 'professional', length = 'medium' } = req.body ?? {};

  if (!message || typeof message !== 'string' || message.trim().length < 2) {
    return res.status(400).json({
      message: 'Please enter a valid chat message with at least 2 characters.',
    });
  }

  try {
    const normalizedTone = normalizeTone(tone);
    const normalizedLength = normalizeLength(length);
    const reply = await generateReply({
      message,
      history,
      tone: normalizedTone,
      length: normalizedLength,
    });

    return res.json({
      reply,
      meta: {
        tone: normalizedTone,
        length: normalizedLength,
        model: MODEL_NAME,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    const messageText = error?.message || 'Generation failed unexpectedly.';
    return res.status(mapErrorToHttpStatus(messageText)).json({
      message: `Generation failed: ${messageText}`,
    });
  }
});

app.post('/api/generate', async (req, res) => {
  const { topic, tone = 'professional', length = 'medium' } = req.body ?? {};

  if (!topic || typeof topic !== 'string' || topic.trim().length < 3) {
    return res.status(400).json({
      message: 'Please enter a valid topic/title with at least 3 characters.',
    });
  }

  try {
    const normalizedTone = normalizeTone(tone);
    const normalizedLength = normalizeLength(length);
    const reply = await generateReply({
      message: `Write a complete blog post about "${topic.trim()}".`,
      history: [],
      tone: normalizedTone,
      length: normalizedLength,
    });

    return res.json({
      content: reply,
      meta: {
        topic: topic.trim(),
        tone: normalizedTone,
        length: normalizedLength,
        model: MODEL_NAME,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    const messageText = error?.message || 'Generation failed unexpectedly.';
    return res.status(mapErrorToHttpStatus(messageText)).json({
      message: `Generation failed: ${messageText}`,
    });
  }
});

app.listen(PORT, () => {
  console.log(`AI Blog Generator API running on http://localhost:${PORT}`);
});
