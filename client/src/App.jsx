import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import './App.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const CHAT_STORAGE_KEY = 'bloggpt-chat-state-v3';

const WELCOME_MESSAGE = {
  id: 'assistant-welcome',
  role: 'assistant',
  content:
    '# Welcome to BlogGPT\n\nTell me your topic and I will generate a professional blog draft. You can ask me to rewrite with a new tone, shorten it, expand it, or improve SEO.',
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

const themeOptions = [
  { value: 'white', label: 'White Mode' },
  { value: 'dark', label: 'Dark Mode' },
  { value: 'matrix-white', label: 'Matrix White' },
  { value: 'matrix-dark', label: 'Matrix Dark' },
  { value: 'github-white', label: 'GitHub White' },
  { value: 'github-dark', label: 'GitHub Dark' },
];

const starterPrompts = [
  'Write a high-ranking blog about AI trends in 2026',
  'Create a persuasive blog about remote work productivity',
  'Draft a beginner-friendly article about prompt engineering',
  'Rewrite my draft in a more casual and witty tone',
  'Generate an SEO-ready post with headings and CTA',
  'Turn this rough idea into a polished publish-ready article',
];

const apiTargetOptions = [
  { value: 'builtin', label: 'Built-in Local' },
  { value: 'local', label: 'Custom Local' },
  { value: 'external', label: 'Custom External' },
];

const BLOGGPT_TEMPLATE = `{
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
  bodyTemplateJson: BLOGGPT_TEMPLATE,
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

function createMessage(role, content) {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content,
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
  if (!path || !path.trim()) {
    return source;
  }

  return path.split('.').reduce((current, segment) => {
    if (current === undefined || current === null) {
      return undefined;
    }

    if (/^\d+$/.test(segment)) {
      return current[Number(segment)];
    }

    return current[segment];
  }, source);
}

function injectTemplateValues(node, context) {
  if (Array.isArray(node)) {
    return node.map((item) => injectTemplateValues(item, context));
  }

  if (node && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [key, injectTemplateValues(value, context)]),
    );
  }

  if (typeof node !== 'string') {
    return node;
  }

  const wholeTokenMatch = node.match(/^{{\s*([a-zA-Z0-9_]+)\s*}}$/);

  if (wholeTokenMatch) {
    const token = wholeTokenMatch[1];
    return context[token] ?? '';
  }

  return node.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, token) => {
    const value = context[token];

    if (value === undefined || value === null) {
      return '';
    }

    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    return String(value);
  });
}

function normalizeLoadedMessages(rawMessages) {
  if (!Array.isArray(rawMessages)) {
    return null;
  }

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
    }));

  return hydratedMessages.length ? hydratedMessages : null;
}

function loadInitialState() {
  const fallback = {
    messages: [WELCOME_MESSAGE],
    tone: 'professional',
    length: 'medium',
    theme: 'dark',
    activeApiTarget: 'builtin',
    localApi: defaultLocalApi,
    externalApi: defaultExternalApi,
  };

  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    const rawState = localStorage.getItem(CHAT_STORAGE_KEY);

    if (!rawState) {
      return fallback;
    }

    const parsed = JSON.parse(rawState);
    const loadedMessages = normalizeLoadedMessages(parsed.messages);

    return {
      messages: loadedMessages || fallback.messages,
      tone: toneOptions.some((option) => option.value === parsed.tone) ? parsed.tone : fallback.tone,
      length: lengthOptions.some((option) => option.value === parsed.length)
        ? parsed.length
        : fallback.length,
      theme: themeOptions.some((option) => option.value === parsed.theme) ? parsed.theme : fallback.theme,
      activeApiTarget: apiTargetOptions.some((option) => option.value === parsed.activeApiTarget)
        ? parsed.activeApiTarget
        : fallback.activeApiTarget,
      localApi: {
        ...defaultLocalApi,
        ...(parsed.localApi || {}),
      },
      externalApi: {
        ...defaultExternalApi,
        ...(parsed.externalApi || {}),
      },
    };
  } catch {
    return fallback;
  }
}

async function requestBuiltInChat({ message, history, tone, length }) {
  const response = await fetch(`${API_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      history,
      tone,
      length,
    }),
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.message || 'Built-in API request failed.');
  }

  if (!payload.reply || typeof payload.reply !== 'string') {
    throw new Error('Built-in API response did not return a valid reply string.');
  }

  return payload.reply;
}

async function requestCustomChat(config, context) {
  if (!config.url.trim()) {
    throw new Error('Custom API URL is required.');
  }

  const parsedHeaders = parseJSON(config.headersJson || '{}', 'Headers JSON');
  const parsedTemplate = parseJSON(config.bodyTemplateJson || '{}', 'Request body template');
  const requestBody = injectTemplateValues(parsedTemplate, context);

  const headers = {
    'Content-Type': 'application/json',
    ...parsedHeaders,
  };

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

  if (typeof replyValue === 'string' && replyValue.trim()) {
    return replyValue;
  }

  if (replyValue && typeof replyValue === 'object') {
    return JSON.stringify(replyValue, null, 2);
  }

  throw new Error('Could not extract assistant reply using the configured response path.');
}

function App() {
  const initialState = useMemo(() => loadInitialState(), []);
  const [activePage, setActivePage] = useState('chat');
  const [messages, setMessages] = useState(initialState.messages);
  const [input, setInput] = useState('');
  const [tone, setTone] = useState(initialState.tone);
  const [length, setLength] = useState(initialState.length);
  const [theme, setTheme] = useState(initialState.theme);
  const [activeApiTarget, setActiveApiTarget] = useState(initialState.activeApiTarget);
  const [localApi, setLocalApi] = useState(initialState.localApi);
  const [externalApi, setExternalApi] = useState(initialState.externalApi);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const [isCopied, setIsCopied] = useState(false);

  const messagesEndRef = useRef(null);

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
      localApi: {
        ...localApi,
        apiKey: '',
      },
      externalApi: {
        ...externalApi,
        apiKey: '',
      },
    };

    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(snapshot));
  }, [messages, tone, length, theme, activeApiTarget, localApi, externalApi]);

  const latestAssistantMessage = useMemo(
    () => [...messages].reverse().find((message) => message.role === 'assistant')?.content || '',
    [messages],
  );

  const sendMessage = async (text) => {
    const trimmed = text.trim();

    if (!trimmed || isSending) {
      return;
    }

    setError('');

    const history = messages
      .filter((message) => message.id !== WELCOME_MESSAGE.id)
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));

    setMessages((prev) => [...prev, createMessage('user', trimmed)]);
    setInput('');
    setIsSending(true);

    try {
      const openaiMessages = [
        ...history.map((message) => ({ role: message.role, content: message.content })),
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

      if (activeApiTarget === 'builtin') {
        reply = await requestBuiltInChat({ message: trimmed, history, tone, length });
      } else if (activeApiTarget === 'local') {
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

  const handleComposerKeyDown = async (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      await sendMessage(input);
    }
  };

  const handleNewChat = () => {
    setMessages([WELCOME_MESSAGE]);
    setInput('');
    setError('');
  };

  const handleStarterClick = async (prompt) => {
    setActivePage('chat');
    await sendMessage(prompt);
  };

  const handleDownload = (format) => {
    if (!latestAssistantMessage.trim()) {
      setError('Generate at least one assistant response before downloading.');
      return;
    }

    const basePrompt = messages.find((message) => message.role === 'user')?.content || 'blog-draft';
    const fileBaseName = slugify(basePrompt) || 'blog-draft';

    if (format === 'md') {
      downloadFile({
        fileName: `${fileBaseName}.md`,
        mimeType: 'text/markdown;charset=utf-8',
        content: latestAssistantMessage,
      });
      return;
    }

    if (format === 'txt') {
      downloadFile({
        fileName: `${fileBaseName}.txt`,
        mimeType: 'text/plain;charset=utf-8',
        content: toPlainText(latestAssistantMessage),
      });
    }
  };

  const handleCopyLatest = async () => {
    if (!latestAssistantMessage.trim()) {
      setError('Generate at least one assistant response before copying.');
      return;
    }

    try {
      await navigator.clipboard.writeText(latestAssistantMessage);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 1600);
    } catch {
      setError('Copy failed. Your browser may not allow clipboard access.');
    }
  };

  const updateLocalApiField = (field, value) => {
    setLocalApi((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const updateExternalApiField = (field, value) => {
    setExternalApi((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const renderConnectionForm = (config, updateConfig, type) => (
    <div className="connection-form">
      <label>
        Endpoint URL
        <input
          type="text"
          value={config.url}
          onChange={(event) => updateConfig('url', event.target.value)}
          placeholder={type === 'local' ? 'http://localhost:5001/api/chat' : 'https://api.example.com/v1/chat'}
        />
      </label>

      <div className="two-col-grid">
        <label>
          Reply Path
          <input
            type="text"
            value={config.responsePath}
            onChange={(event) => updateConfig('responsePath', event.target.value)}
            placeholder="reply"
          />
        </label>

        <label>
          Error Path
          <input
            type="text"
            value={config.errorPath}
            onChange={(event) => updateConfig('errorPath', event.target.value)}
            placeholder="message"
          />
        </label>
      </div>

      <div className="two-col-grid">
        <label>
          API Key Header
          <input
            type="text"
            value={config.apiKeyHeader}
            onChange={(event) => updateConfig('apiKeyHeader', event.target.value)}
            placeholder="Authorization"
          />
        </label>

        <label>
          API Key Prefix
          <input
            type="text"
            value={config.apiKeyPrefix}
            onChange={(event) => updateConfig('apiKeyPrefix', event.target.value)}
            placeholder="Bearer "
          />
        </label>
      </div>

      <label>
        API Key (session only)
        <input
          type="password"
          value={config.apiKey}
          onChange={(event) => updateConfig('apiKey', event.target.value)}
          placeholder="Optional"
        />
      </label>

      <label>
        Additional Headers (JSON)
        <textarea
          value={config.headersJson}
          onChange={(event) => updateConfig('headersJson', event.target.value)}
          rows={4}
        />
      </label>

      <label>
        Request Body Template (JSON)
        <textarea
          value={config.bodyTemplateJson}
          onChange={(event) => updateConfig('bodyTemplateJson', event.target.value)}
          rows={8}
        />
      </label>

      <div className="template-buttons">
        <button type="button" onClick={() => updateConfig('bodyTemplateJson', BLOGGPT_TEMPLATE)}>
          Use BlogGPT Template
        </button>
        <button type="button" onClick={() => updateConfig('bodyTemplateJson', OPENAI_TEMPLATE)}>
          Use OpenAI Template
        </button>
      </div>

      <p className="helper-note">
        Placeholders: <code>{'{{message}}'}</code>, <code>{'{{history}}'}</code>,{' '}
        <code>{'{{tone}}'}</code>, <code>{'{{length}}'}</code>, <code>{'{{openaiMessages}}'}</code>.
      </p>
    </div>
  );

  return (
    <div className="app-root">
      <header className="topbar">
        <button type="button" className="logo-button" onClick={() => setActivePage('chat')}>
          <span className="logo-dot" />
          BlogGPT
        </button>

        <div className="topbar-actions">
          <button type="button" className="ghost-button" onClick={handleNewChat}>
            New Chat
          </button>
          <button
            type="button"
            className={`ghost-button ${activePage === 'settings' ? 'active' : ''}`}
            onClick={() => setActivePage(activePage === 'chat' ? 'settings' : 'chat')}
          >
            {activePage === 'chat' ? 'Settings' : 'Back to Chat'}
          </button>
        </div>
      </header>

      {activePage === 'chat' ? (
        <main className="chat-page">
          <section className="messages-area">
            <div className="messages-wrap">
              {messages.map((message) => (
                <article key={message.id} className={`message-row ${message.role}`}>
                  <div className="avatar">{message.role === 'assistant' ? 'AI' : 'YOU'}</div>
                  <div className="bubble">
                    {message.role === 'assistant' ? (
                      <div
                        className="markdown-content"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
                      />
                    ) : (
                      <p>{message.content}</p>
                    )}
                  </div>
                </article>
              ))}

              {isSending ? (
                <article className="message-row assistant">
                  <div className="avatar">AI</div>
                  <div className="bubble typing">
                    <span />
                    <span />
                    <span />
                  </div>
                </article>
              ) : null}

              {messages.length <= 1 ? (
                <div className="suggestion-grid">
                  {starterPrompts.slice(0, 4).map((prompt) => (
                    <button key={prompt} type="button" className="suggestion-chip" onClick={() => sendMessage(prompt)}>
                      {prompt}
                    </button>
                  ))}
                </div>
              ) : null}

              <div ref={messagesEndRef} />
            </div>
          </section>

          <form className="composer" onSubmit={handleSubmit}>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="Message BlogGPT..."
            />

            <div className="composer-meta">
              <div className="composer-options">
                <label className="inline-field">
                  Tone
                  <select value={tone} onChange={(event) => setTone(event.target.value)}>
                    {toneOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="inline-field">
                  Length
                  <select value={length} onChange={(event) => setLength(event.target.value)}>
                    {lengthOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="composer-actions">
                <button type="button" onClick={handleCopyLatest}>
                  {isCopied ? 'Copied' : 'Copy'}
                </button>
                <button type="button" onClick={() => handleDownload('md')}>
                  Export
                </button>
                <button type="submit" className="send-button" disabled={isSending || !input.trim()}>
                  {isSending ? 'Sending...' : 'Send'}
                </button>
              </div>
            </div>
          </form>

          {error ? <p className="error-inline">{error}</p> : null}
        </main>
      ) : (
        <main className="settings-page">
          <section className="settings-card">
            <h2>Appearance</h2>
            <p>Choose a theme for the workspace.</p>
            <label className="settings-field">
              Theme
              <select value={theme} onChange={(event) => setTheme(event.target.value)}>
                {themeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className="settings-card">
            <h2>Default Writing Options</h2>
            <p>Set the default tone and length for new prompts.</p>
            <div className="settings-grid-two">
              <label className="settings-field">
                Tone
                <select value={tone} onChange={(event) => setTone(event.target.value)}>
                  {toneOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="settings-field">
                Length
                <select value={length} onChange={(event) => setLength(event.target.value)}>
                  {lengthOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="settings-chip-grid">
              {starterPrompts.map((prompt) => (
                <button key={prompt} type="button" className="settings-chip" onClick={() => handleStarterClick(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>
          </section>

          <section className="settings-card settings-card-wide">
            <h2>API Routing</h2>
            <p>Switch between built-in API, custom local API, or custom external API.</p>

            <div className="target-switcher">
              {apiTargetOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={activeApiTarget === option.value ? 'active' : ''}
                  onClick={() => setActiveApiTarget(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {activeApiTarget === 'builtin' ? (
              <p className="helper-note">
                Built-in mode sends requests to <code>{`${API_BASE_URL || '(same origin)'}/api/chat`}</code>.
              </p>
            ) : null}

            {activeApiTarget === 'local' ? renderConnectionForm(localApi, updateLocalApiField, 'local') : null}
            {activeApiTarget === 'external'
              ? renderConnectionForm(externalApi, updateExternalApiField, 'external')
              : null}
          </section>

          {error ? <p className="error-inline">{error}</p> : null}
        </main>
      )}
    </div>
  );
}

export default App;
