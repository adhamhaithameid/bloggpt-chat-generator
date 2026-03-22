import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { getStarterPrompts, promptLibrary } from './prompt-library';
import './App.css';

const CHAT_STORAGE_KEY = 'compose-chat-state-v1';

const WELCOME_MESSAGE = {
  id: 'assistant-welcome',
  role: 'assistant',
  content:
    "Hey there! I'm **Compose** — your AI writing assistant.\n\nTell me a topic and I'll draft a polished blog post for you. You can ask me to adjust the tone, expand sections, shorten it, or rewrite entirely.",
};

const toneOptions = [
  { value: 'professional', label: 'Professional' },
  { value: 'casual', label: 'Casual' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'persuasive', label: 'Persuasive' },
  { value: 'witty', label: 'Witty' },
];

const lengthOptions = [
  { value: 'short', label: 'Short' },
  { value: 'medium', label: 'Medium' },
  { value: 'long', label: 'Long' },
];

/* Themes grouped by mode */
const lightThemes = [
  { value: 'white', label: 'Default Light', dot: '#2563eb' },
  { value: 'matrix-white', label: 'Matrix Light', dot: '#16a34a' },
  { value: 'github-white', label: 'GitHub Light', dot: '#0969da' },
];

const darkThemes = [
  { value: 'dark', label: 'Default Dark', dot: '#27c296' },
  { value: 'matrix-dark', label: 'Matrix Dark', dot: '#4ade80' },
  { value: 'github-dark', label: 'GitHub Dark', dot: '#58a6ff' },
];

const allThemes = [...lightThemes, ...darkThemes];

const apiTargetOptions = [
  { value: 'local', label: 'Local API' },
  { value: 'external', label: 'External API' },
];

const settingsTabs = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'writing', label: 'Writing' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'api', label: 'API' },
  { id: 'export', label: 'Export' },
];

const COMPOSE_TEMPLATE = `{
  "message": "{{message}}",
  "history": "{{history}}",
  "tone": "{{tone}}",
  "length": "{{length}}"
}`;

const OPENAI_TEMPLATE = `{
  "model": "gpt-4o-mini",
  "messages": "{{openaiMessages}}",
  "temperature": 0.7
}`;

const defaultLocalApi = {
  url: 'http://localhost:5001/api/chat',
  headersJson: '{}',
  bodyTemplateJson: COMPOSE_TEMPLATE,
  responsePath: 'reply',
  errorPath: 'message',
  apiKey: '',
  apiKeyHeader: 'Authorization',
  apiKeyPrefix: 'Bearer ',
};

const defaultExternalApi = {
  url: 'https://api.openai.com/v1/chat/completions',
  headersJson: '{}',
  bodyTemplateJson: OPENAI_TEMPLATE,
  responsePath: 'choices.0.message.content',
  errorPath: 'error.message',
  apiKey: '',
  apiKeyHeader: 'Authorization',
  apiKeyPrefix: 'Bearer ',
};

/* ─── Utility helpers ─── */

function createMessage(role, content, images = []) {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content,
    images,
  };
}

function toPlainText(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[>*_-]{2,}/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60);
}

function downloadFile({ fileName, mimeType, content }) {
  const blob = new Blob([content], { type: mimeType });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

function renderMarkdown(content) {
  const rendered = marked.parse(content);
  const html = typeof rendered === 'string' ? rendered : '';
  return DOMPurify.sanitize(html);
}

function parseJSON(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
}

function readPath(source, path) {
  if (!path || !path.trim()) return source;
  return path.split('.').reduce((current, segment) => {
    if (current === undefined || current === null) return undefined;
    if (/^\d+$/.test(segment)) return current[Number(segment)];
    return current[segment];
  }, source);
}

function injectTemplateValues(node, context) {
  if (Array.isArray(node)) return node.map((item) => injectTemplateValues(item, context));
  if (node && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [key, injectTemplateValues(value, context)]),
    );
  }
  if (typeof node !== 'string') return node;
  const wholeTokenMatch = node.match(/^{{\s*([a-zA-Z0-9_]+)\s*}}$/);
  if (wholeTokenMatch) {
    const token = wholeTokenMatch[1];
    return context[token] ?? '';
  }
  return node.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, token) => {
    const value = context[token];
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  });
}

function normalizeLoadedMessages(rawMessages) {
  if (!Array.isArray(rawMessages)) return null;
  const hydratedMessages = rawMessages
    .filter(
      (message) =>
        message &&
        typeof message.role === 'string' &&
        typeof message.content === 'string' &&
        message.content.trim().length > 0,
    )
    .map((message) => ({
      id: message.id || `${message.role}-${Math.random().toString(16).slice(2)}`,
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content,
      images: message.images || [],
    }));
  return hydratedMessages.length ? hydratedMessages : null;
}

function getThemeMode(themeValue) {
  return lightThemes.some((t) => t.value === themeValue) ? 'light' : 'dark';
}

function loadInitialState() {
  const fallback = {
    messages: [WELCOME_MESSAGE],
    tone: 'professional',
    length: 'medium',
    theme: 'dark',
    activeApiTarget: 'local',
    localApi: defaultLocalApi,
    externalApi: defaultExternalApi,
  };

  if (typeof window === 'undefined') return fallback;

  try {
    const rawState = localStorage.getItem(CHAT_STORAGE_KEY);
    if (!rawState) return fallback;

    const parsed = JSON.parse(rawState);
    const loadedMessages = normalizeLoadedMessages(parsed.messages);

    return {
      messages: loadedMessages || fallback.messages,
      tone: toneOptions.some((o) => o.value === parsed.tone) ? parsed.tone : fallback.tone,
      length: lengthOptions.some((o) => o.value === parsed.length) ? parsed.length : fallback.length,
      theme: allThemes.some((o) => o.value === parsed.theme) ? parsed.theme : fallback.theme,
      activeApiTarget: apiTargetOptions.some((o) => o.value === parsed.activeApiTarget)
        ? parsed.activeApiTarget
        : fallback.activeApiTarget,
      localApi: { ...defaultLocalApi, ...(parsed.localApi || {}) },
      externalApi: { ...defaultExternalApi, ...(parsed.externalApi || {}) },
    };
  } catch {
    return fallback;
  }
}

async function requestCustomChat(config, context) {
  if (!config.url.trim()) throw new Error('Custom API URL is required.');

  const parsedHeaders = parseJSON(config.headersJson || '{}', 'Headers JSON');
  const parsedTemplate = parseJSON(config.bodyTemplateJson || '{}', 'Request body template');
  const requestBody = injectTemplateValues(parsedTemplate, context);

  const headers = { 'Content-Type': 'application/json', ...parsedHeaders };

  if (config.apiKey.trim()) {
    const headerName = config.apiKeyHeader.trim() || 'Authorization';
    headers[headerName] = `${config.apiKeyPrefix || ''}${config.apiKey}`;
  }

  const response = await fetch(config.url.trim(), {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  });

  const rawResponseText = await response.text();
  let parsedPayload = rawResponseText;

  if (rawResponseText) {
    try {
      parsedPayload = JSON.parse(rawResponseText);
    } catch {
      parsedPayload = rawResponseText;
    }
  }

  if (!response.ok) {
    if (typeof parsedPayload === 'object' && parsedPayload !== null) {
      const extractedError = readPath(parsedPayload, config.errorPath || 'message');
      if (typeof extractedError === 'string' && extractedError.trim()) {
        throw new Error(extractedError);
      }
    }
    throw new Error(`Custom API request failed with status ${response.status}.`);
  }

  let replyValue;
  if (typeof parsedPayload === 'object' && parsedPayload !== null) {
    replyValue = readPath(parsedPayload, config.responsePath || 'reply');
  } else {
    replyValue = parsedPayload;
  }

  if (typeof replyValue !== 'string' || !replyValue.trim()) {
    throw new Error('Could not extract a reply from the API response.');
  }

  return replyValue;
}

/* ─── Icons ─── */
const Icons = {
  send: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  ),
  image: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  ),
  settings: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  plus: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  back: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  ),
  copy: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  ),
  check: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  download: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
  x: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  chevron: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  ),
  sun: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  ),
  moon: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  ),
  attach: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
};

/* ─── App ─── */

function App() {
  const initialState = useMemo(() => loadInitialState(), []);
  const [activePage, setActivePage] = useState('chat');
  const [messages, setMessages] = useState(initialState.messages);
  const [input, setInput] = useState('');
  const [attachedImages, setAttachedImages] = useState([]);
  const [tone, setTone] = useState(initialState.tone);
  const [length, setLength] = useState(initialState.length);
  const [theme, setTheme] = useState(initialState.theme);
  const [activeApiTarget, setActiveApiTarget] = useState(initialState.activeApiTarget);
  const [localApi, setLocalApi] = useState(initialState.localApi);
  const [externalApi, setExternalApi] = useState(initialState.externalApi);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [settingsTab, setSettingsTab] = useState('appearance');
  const [themeMode, setThemeMode] = useState(() => getThemeMode(initialState.theme));
  const [promptSearch, setPromptSearch] = useState('');
  const [promptCategory, setPromptCategory] = useState('all');

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  /* ── Side effects ── */
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  useEffect(() => {
    const snapshot = {
      messages: messages.slice(-40),
      tone,
      length,
      theme,
      activeApiTarget,
      localApi: { ...localApi, apiKey: '' },
      externalApi: { ...externalApi, apiKey: '' },
    };
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(snapshot));
  }, [messages, tone, length, theme, activeApiTarget, localApi, externalApi]);

  /* ── Textarea auto-resize ── */
  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, []);

  useEffect(() => {
    autoResize();
  }, [input, autoResize]);

  /* ── Computed ── */
  const isEmptyChat = messages.length <= 1;
  const currentThemes = themeMode === 'light' ? lightThemes : darkThemes;
  const starterPrompts = useMemo(() => getStarterPrompts(4), []);
  const promptCategories = useMemo(
    () => ['all', ...new Set(promptLibrary.map((entry) => entry.category))],
    [],
  );
  const filteredPromptLibrary = useMemo(() => {
    const normalizedTerm = promptSearch.trim().toLowerCase();
    return promptLibrary.filter((entry) => {
      const categoryMatch = promptCategory === 'all' || entry.category === promptCategory;
      if (!categoryMatch) return false;
      if (!normalizedTerm) return true;
      return (
        entry.title.toLowerCase().includes(normalizedTerm) ||
        entry.prompt.toLowerCase().includes(normalizedTerm) ||
        entry.tags.join(' ').toLowerCase().includes(normalizedTerm)
      );
    });
  }, [promptCategory, promptSearch]);

  /* ── Handlers ── */
  const sendMessage = async (text) => {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;

    setError('');

    const history = messages
      .filter((m) => m.id !== WELCOME_MESSAGE.id)
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, createMessage('user', trimmed, attachedImages)]);
    setInput('');
    setAttachedImages([]);
    setIsSending(true);

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      const openaiMessages = [
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: trimmed },
      ];

      const context = {
        message: trimmed,
        history,
        tone,
        length,
        openaiMessages,
        timestamp: new Date().toISOString(),
      };

      let reply;
      if (activeApiTarget === 'local') {
        reply = await requestCustomChat(localApi, context);
      } else {
        reply = await requestCustomChat(externalApi, context);
      }

      setMessages((prev) => [...prev, createMessage('assistant', reply)]);
    } catch (requestError) {
      setError(requestError.message || 'Failed to send message.');
    } finally {
      setIsSending(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    await sendMessage(input);
  };

  const handleKeyDown = async (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      await sendMessage(input);
    }
  };

  const handleNewChat = () => {
    setMessages([WELCOME_MESSAGE]);
    setInput('');
    setAttachedImages([]);
    setError('');
  };

  const handleFileAttach = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event) => {
    const files = Array.from(event.target.files || []);
    files.forEach((file) => {
      if (!file.type.startsWith('image/') && !file.type.startsWith('application/')) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        setAttachedImages((prev) => [...prev, { name: file.name, data: e.target.result }]);
      };
      reader.readAsDataURL(file);
    });
    event.target.value = '';
  };

  const removeImage = (index) => {
    setAttachedImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCopyMessage = async (content, messageId) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(messageId);
      setTimeout(() => setCopiedId(null), 1600);
    } catch {
      setError('Copy failed. Your browser may not allow clipboard access.');
    }
  };

  const handleExportMessage = (content, format) => {
    const snippet = content.slice(0, 60);
    const fileBaseName = slugify(snippet) || 'compose-draft';
    if (format === 'md') {
      downloadFile({
        fileName: `${fileBaseName}.md`,
        mimeType: 'text/markdown;charset=utf-8',
        content,
      });
    } else {
      downloadFile({
        fileName: `${fileBaseName}.txt`,
        mimeType: 'text/plain;charset=utf-8',
        content: toPlainText(content),
      });
    }
  };

  const handleDownload = (format) => {
    const latest = [...messages].reverse().find((m) => m.role === 'assistant')?.content || '';
    if (!latest.trim()) {
      setError('Generate at least one response before downloading.');
      return;
    }
    const basePrompt = messages.find((m) => m.role === 'user')?.content || 'compose-draft';
    const fileBaseName = slugify(basePrompt) || 'compose-draft';

    if (format === 'md') {
      downloadFile({
        fileName: `${fileBaseName}.md`,
        mimeType: 'text/markdown;charset=utf-8',
        content: latest,
      });
    } else {
      downloadFile({
        fileName: `${fileBaseName}.txt`,
        mimeType: 'text/plain;charset=utf-8',
        content: toPlainText(latest),
      });
    }
  };

  const handleModeSwitch = (mode) => {
    setThemeMode(mode);
    const defaultTheme = mode === 'light' ? 'white' : 'dark';
    const themes = mode === 'light' ? lightThemes : darkThemes;
    if (!themes.some((t) => t.value === theme)) {
      setTheme(defaultTheme);
    }
  };

  const updateLocalApiField = (field, value) => setLocalApi((prev) => ({ ...prev, [field]: value }));
  const updateExternalApiField = (field, value) => setExternalApi((prev) => ({ ...prev, [field]: value }));
  const applyPrompt = (entry, options = {}) => {
    const { send = false } = options;
    setTone(entry.tone);
    setLength(entry.length);
    setActivePage('chat');

    if (send) {
      sendMessage(entry.prompt);
      return;
    }

    setInput(entry.prompt);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  /* ─── Render: Settings Page ─── */
  const renderSettings = () => (
    <main className="settings-page">
      <header className="settings-header">
        <button type="button" className="back-btn" onClick={() => setActivePage('chat')}>
          {Icons.back}
          <span>Back to Chat</span>
        </button>
        <h1>Settings</h1>
      </header>

      <nav className="settings-tabs">
        {settingsTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`tab-btn ${settingsTab === tab.id ? 'active' : ''}`}
            onClick={() => setSettingsTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="settings-body">
        {settingsTab === 'appearance' && (
          <section className="settings-section" key="appearance">
            <h2>Appearance</h2>
            <p className="section-desc">Choose mode and theme</p>

            <div className="mode-switcher">
              <button
                type="button"
                className={`mode-btn ${themeMode === 'light' ? 'active' : ''}`}
                onClick={() => handleModeSwitch('light')}
              >
                {Icons.sun}
                <span>Light</span>
              </button>
              <button
                type="button"
                className={`mode-btn ${themeMode === 'dark' ? 'active' : ''}`}
                onClick={() => handleModeSwitch('dark')}
              >
                {Icons.moon}
                <span>Dark</span>
              </button>
            </div>

            <div className="theme-grid">
              {currentThemes.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  className={`theme-option ${theme === t.value ? 'active' : ''}`}
                  onClick={() => setTheme(t.value)}
                >
                  <span className="theme-dot" style={{ background: t.dot }} />
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {settingsTab === 'writing' && (
          <section className="settings-section" key="writing">
            <h2>Writing Defaults</h2>
            <p className="section-desc">Set the default tone and length for new prompts</p>
            <div className="field-row">
              <label className="field">
                <span className="field-label">Tone</span>
                <select value={tone} onChange={(e) => setTone(e.target.value)}>
                  {toneOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Length</span>
                <select value={length} onChange={(e) => setLength(e.target.value)}>
                  {lengthOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="starter-grid">
              {starterPrompts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="starter-chip"
                  onClick={() => applyPrompt(p, { send: true })}
                >
                  <span className="chip-icon">{p.emoji}</span>
                  <span>{p.title}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {settingsTab === 'prompts' && (
          <section className="settings-section" key="prompts">
            <h2>Prompt Library</h2>
            <p className="section-desc">Browse templates and apply them to chat instantly</p>

            <div className="prompt-library-toolbar">
              <label className="field prompt-field">
                <span className="field-label">Search</span>
                <input
                  type="text"
                  placeholder="Find by topic, keyword, or tag"
                  value={promptSearch}
                  onChange={(event) => setPromptSearch(event.target.value)}
                />
              </label>

              <label className="field prompt-field">
                <span className="field-label">Category</span>
                <select
                  value={promptCategory}
                  onChange={(event) => setPromptCategory(event.target.value)}
                >
                  {promptCategories.map((category) => (
                    <option key={category} value={category}>
                      {category === 'all' ? 'All categories' : category}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="prompt-library-list">
              {filteredPromptLibrary.map((entry) => (
                <article key={entry.id} className="prompt-card">
                  <header className="prompt-card-header">
                    <h3>
                      <span>{entry.emoji}</span>
                      <span>{entry.title}</span>
                    </h3>
                    <span className="prompt-category">{entry.category}</span>
                  </header>
                  <p>{entry.prompt}</p>
                  <footer className="prompt-card-footer">
                    <div className="prompt-tags">
                      {entry.tags.slice(0, 4).map((tag) => (
                        <span key={tag}>#{tag}</span>
                      ))}
                    </div>
                    <button type="button" className="prompt-use-btn" onClick={() => applyPrompt(entry)}>
                      Use Prompt
                    </button>
                  </footer>
                </article>
              ))}
              {!filteredPromptLibrary.length && (
                <p className="prompt-empty">No prompts matched your search.</p>
              )}
            </div>
          </section>
        )}

        {settingsTab === 'api' && (
          <section className="settings-section" key="api">
            <h2>API Source</h2>
            <p className="section-desc">Configure your API connection</p>

            <div className="api-switcher">
              {apiTargetOptions.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={activeApiTarget === o.value ? 'active' : ''}
                  onClick={() => setActiveApiTarget(o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>

            {renderConnectionForm(
              activeApiTarget === 'local' ? localApi : externalApi,
              activeApiTarget === 'local' ? updateLocalApiField : updateExternalApiField,
              activeApiTarget,
            )}
          </section>
        )}

        {settingsTab === 'export' && (
          <section className="settings-section" key="export">
            <h2>Export</h2>
            <p className="section-desc">Export the latest assistant response</p>
            <div className="export-row">
              <button type="button" className="export-btn" onClick={() => handleDownload('md')}>
                {Icons.download}
                <span>Export .md</span>
              </button>
              <button type="button" className="export-btn" onClick={() => handleDownload('txt')}>
                {Icons.download}
                <span>Export .txt</span>
              </button>
            </div>
          </section>
        )}
      </div>

      {error && <p className="error-toast">{error}</p>}
    </main>
  );

  /* ─── Render: Connection form ─── */
  const renderConnectionForm = (config, updateConfig, type) => (
    <div className="connection-form">
      <label className="field">
        <span className="field-label">Endpoint URL</span>
        <input
          type="text"
          value={config.url}
          onChange={(e) => updateConfig('url', e.target.value)}
          placeholder={type === 'local' ? 'http://localhost:5001/api/chat' : 'https://api.example.com/v1/chat'}
        />
      </label>

      <div className="field-row">
        <label className="field">
          <span className="field-label">Reply Path</span>
          <input
            type="text"
            value={config.responsePath}
            onChange={(e) => updateConfig('responsePath', e.target.value)}
            placeholder="reply"
          />
        </label>
        <label className="field">
          <span className="field-label">Error Path</span>
          <input
            type="text"
            value={config.errorPath}
            onChange={(e) => updateConfig('errorPath', e.target.value)}
            placeholder="message"
          />
        </label>
      </div>

      <div className="field-row">
        <label className="field">
          <span className="field-label">API Key Header</span>
          <input
            type="text"
            value={config.apiKeyHeader}
            onChange={(e) => updateConfig('apiKeyHeader', e.target.value)}
            placeholder="Authorization"
          />
        </label>
        <label className="field">
          <span className="field-label">API Key Prefix</span>
          <input
            type="text"
            value={config.apiKeyPrefix}
            onChange={(e) => updateConfig('apiKeyPrefix', e.target.value)}
            placeholder="Bearer "
          />
        </label>
      </div>

      <label className="field">
        <span className="field-label">API Key (session only)</span>
        <input
          type="password"
          value={config.apiKey}
          onChange={(e) => updateConfig('apiKey', e.target.value)}
          placeholder="Optional"
        />
      </label>

      <button type="button" className="advanced-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>
        <span className={`toggle-chevron ${showAdvanced ? 'open' : ''}`}>{Icons.chevron}</span>
        Advanced
      </button>

      {showAdvanced && (
        <div className="advanced-section">
          <label className="field">
            <span className="field-label">Additional Headers (JSON)</span>
            <textarea
              value={config.headersJson}
              onChange={(e) => updateConfig('headersJson', e.target.value)}
              rows={3}
            />
          </label>

          <label className="field">
            <span className="field-label">Request Body Template (JSON)</span>
            <textarea
              value={config.bodyTemplateJson}
              onChange={(e) => updateConfig('bodyTemplateJson', e.target.value)}
              rows={6}
            />
          </label>

          <div className="template-btns">
            <button type="button" onClick={() => updateConfig('bodyTemplateJson', COMPOSE_TEMPLATE)}>
              Compose Template
            </button>
            <button type="button" onClick={() => updateConfig('bodyTemplateJson', OPENAI_TEMPLATE)}>
              OpenAI Template
            </button>
          </div>

          <p className="helper-note">
            Placeholders: <code>{'{{message}}'}</code>, <code>{'{{history}}'}</code>,{' '}
            <code>{'{{tone}}'}</code>, <code>{'{{length}}'}</code>, <code>{'{{openaiMessages}}'}</code>.
          </p>
        </div>
      )}
    </div>
  );

  /* ─── Render: Chat Page ─── */
  const renderChat = () => (
    <main className="chat-page">
      {/* Top bar */}
      <header className="chat-topbar">
        <div className="topbar-left">
          <span className="brand">
            <span className="brand-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2"/><circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="2"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>
              </svg>
            </span>
            Compose
          </span>
        </div>
        <div className="topbar-right">
          <button type="button" className="icon-btn" onClick={handleNewChat} title="New Chat">
            {Icons.plus}
          </button>
          <button type="button" className="icon-btn" onClick={() => setActivePage('settings')} title="Settings">
            {Icons.settings}
          </button>
        </div>
      </header>

      {/* Messages */}
      <section className="messages-area">
        <div className="messages-container">
          {isEmptyChat ? (
            <div className="empty-state">
              <div className="empty-logo">
                <span className="empty-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2"/><circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="2"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>
                  </svg>
                </span>
              </div>
              <h2>What can I help you write?</h2>
              <div className="suggestion-grid">
                {starterPrompts.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="suggestion-card"
                    onClick={() => applyPrompt(p, { send: true })}
                  >
                    <span className="suggestion-icon">{p.emoji}</span>
                    <span className="suggestion-text">{p.title}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} className={`msg ${msg.role}`}>
                {msg.role === 'assistant' && (
                  <div className="msg-avatar">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2"/><circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="2"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>
                    </svg>
                  </div>
                )}
                <div className="msg-content">
                  {msg.role === 'assistant' ? (
                    <div
                      className="markdown-body"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                    />
                  ) : (
                    <>
                      {msg.images && msg.images.length > 0 && (
                        <div className="msg-images">
                          {msg.images.map((img, i) => (
                            <img key={i} src={img.data} alt={img.name} className="msg-attached-img" />
                          ))}
                        </div>
                      )}
                      <p>{msg.content}</p>
                    </>
                  )}
                  {msg.role === 'assistant' && msg.id !== 'assistant-welcome' && (
                    <div className="msg-actions">
                      <button
                        type="button"
                        className="msg-action-btn"
                        onClick={() => handleCopyMessage(msg.content, msg.id)}
                        title="Copy"
                      >
                        {copiedId === msg.id ? Icons.check : Icons.copy}
                        <span>{copiedId === msg.id ? 'Copied' : 'Copy'}</span>
                      </button>
                      <button
                        type="button"
                        className="msg-action-btn"
                        onClick={() => handleExportMessage(msg.content, 'md')}
                        title="Export as Markdown"
                      >
                        {Icons.download}
                        <span>Export</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}

          {isSending && (
            <div className="msg assistant">
              <div className="msg-avatar">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2"/><circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="2"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>
                </svg>
              </div>
              <div className="msg-content">
                <div className="typing-indicator">
                  <span /><span /><span />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </section>

      {/* Composer */}
      <div className="composer-wrapper">
        {error && <p className="error-toast">{error}</p>}

        {attachedImages.length > 0 && (
          <div className="attached-preview">
            {attachedImages.map((img, i) => (
              <div key={i} className="attached-thumb">
                <img src={img.data} alt={img.name} />
                <button type="button" className="remove-img" onClick={() => removeImage(i)}>
                  {Icons.x}
                </button>
              </div>
            ))}
          </div>
        )}

        <form className="composer" onSubmit={handleSubmit}>
          <button type="button" className="composer-icon-btn" onClick={handleFileAttach} title="Attach file">
            {Icons.attach}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.doc,.docx,.txt,.md"
            multiple
            hidden
            onChange={handleFileChange}
          />
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message Compose..."
            rows={1}
          />
          <button
            type="submit"
            className={`send-btn ${input.trim() ? 'active' : ''}`}
            disabled={isSending || !input.trim()}
          >
            {Icons.send}
          </button>
        </form>
        <p className="composer-hint">
          Compose can make mistakes. Review important outputs carefully.
        </p>
      </div>
    </main>
  );

  /* ─── Root render ─── */
  return (
    <div className="app-shell">
      {activePage === 'chat' ? renderChat() : renderSettings()}
    </div>
  );
}

export default App;
