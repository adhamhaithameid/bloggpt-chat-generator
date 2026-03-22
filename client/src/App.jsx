import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import './App.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const CHAT_STORAGE_KEY = 'bloggpt-chat-state-v1';

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

const starterPrompts = [
  'Write a blog post about AI trends in 2026',
  'Create a persuasive blog about remote work productivity',
  'Draft a beginner-friendly article about prompt engineering',
  'Rewrite my post with a more casual and witty tone',
];

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

function App() {
  const welcomeMessage = useMemo(
    () =>
      createMessage(
        'assistant',
        '# Welcome to BlogGPT\n\nDescribe your topic and I will generate a full blog draft. You can ask for rewrites, different tones, or shorter/longer versions.',
      ),
    [],
  );

  const [messages, setMessages] = useState([welcomeMessage]);
  const [input, setInput] = useState('');
  const [tone, setTone] = useState('professional');
  const [length, setLength] = useState('medium');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    try {
      const rawState = localStorage.getItem(CHAT_STORAGE_KEY);

      if (!rawState) {
        return;
      }

      const parsedState = JSON.parse(rawState);

      if (Array.isArray(parsedState.messages) && parsedState.messages.length > 0) {
        const hydratedMessages = parsedState.messages
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

        if (hydratedMessages.length > 0) {
          setMessages(hydratedMessages);
        }
      }

      if (typeof parsedState.tone === 'string') {
        setTone(parsedState.tone);
      }

      if (typeof parsedState.length === 'string') {
        setLength(parsedState.length);
      }
    } catch {
      localStorage.removeItem(CHAT_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  useEffect(() => {
    const snapshot = {
      messages: messages.slice(-30),
      tone,
      length,
    };

    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(snapshot));
  }, [messages, tone, length]);

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

    const history = messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));

    setMessages((prev) => [...prev, createMessage('user', trimmed)]);
    setInput('');
    setIsSending(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: trimmed,
          history,
          tone,
          length,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message || 'Chat request failed.');
      }

      setMessages((prev) => [...prev, createMessage('assistant', payload.reply)]);
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
    setMessages([welcomeMessage]);
    setInput('');
    setError('');
  };

  const handleDownload = (format) => {
    if (!latestAssistantMessage.trim()) {
      setError('Generate at least one assistant response before downloading.');
      return;
    }

    const fileBaseName = slugify(messages.find((message) => message.role === 'user')?.content || 'blog-draft') || 'blog-draft';

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
      setTimeout(() => setIsCopied(false), 1500);
    } catch {
      setError('Copy failed. Your browser may not allow clipboard access.');
    }
  };

  return (
    <div className="chat-page">
      <aside className="sidebar">
        <div className="sidebar-top">
          <h1>BlogGPT</h1>
          <p>AI writing partner</p>
        </div>

        <button type="button" className="new-chat-btn" onClick={handleNewChat}>
          + New chat
        </button>

        <section className="prompt-list">
          <h2>Quick prompts</h2>
          {starterPrompts.map((prompt) => (
            <button key={prompt} type="button" className="prompt-chip" onClick={() => sendMessage(prompt)}>
              {prompt}
            </button>
          ))}
        </section>

        <footer className="sidebar-footer">
          <span>Powered by Gemini API</span>
        </footer>
      </aside>

      <main className="chat-main">
        <header className="chat-header">
          <div className="settings-row">
            <label htmlFor="tone">Tone</label>
            <select id="tone" value={tone} onChange={(event) => setTone(event.target.value)}>
              {toneOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="settings-row">
            <label htmlFor="length">Length</label>
            <select id="length" value={length} onChange={(event) => setLength(event.target.value)}>
              {lengthOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="header-actions">
            <button type="button" onClick={() => handleDownload('md')}>
              Export .md
            </button>
            <button type="button" onClick={() => handleDownload('txt')}>
              Export .txt
            </button>
            <button type="button" onClick={handleCopyLatest}>
              {isCopied ? 'Copied' : 'Copy last'}
            </button>
          </div>
        </header>

        <section className="messages-panel">
          {messages.map((message) => (
            <article key={message.id} className={`message-row ${message.role}`}>
              <div className="avatar">{message.role === 'assistant' ? 'AI' : 'You'}</div>
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

          <div ref={messagesEndRef} />
        </section>

        <form className="composer" onSubmit={handleSubmit}>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="Message BlogGPT to generate or refine your blog draft..."
          />
          <button type="submit" disabled={isSending || !input.trim()}>
            {isSending ? 'Sending...' : 'Send'}
          </button>
        </form>

        {error ? <p className="error-banner">{error}</p> : null}
      </main>
    </div>
  );
}

export default App;
