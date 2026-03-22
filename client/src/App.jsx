import { useMemo, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import './App.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

const toneOptions = [
  { value: 'professional', label: 'Professional' },
  { value: 'casual', label: 'Casual' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'persuasive', label: 'Persuasive' },
  { value: 'witty', label: 'Witty' },
];

const lengthOptions = [
  { value: 'short', label: 'Short (350-500 words)' },
  { value: 'medium', label: 'Medium (700-900 words)' },
  { value: 'long', label: 'Long (1200-1500 words)' },
];

const initialForm = {
  topic: '',
  tone: 'professional',
  length: 'medium',
};

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

function getWordCount(text) {
  const words = text.match(/\b[\w'-]+\b/g);
  return words ? words.length : 0;
}

function downloadFile({ fileName, mimeType, content }) {
  const blob = new Blob([content], { type: mimeType });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

function App() {
  const [form, setForm] = useState(initialForm);
  const [content, setContent] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const previewHtml = useMemo(() => {
    if (!content.trim()) {
      return '<p class="empty-preview">Your generated article preview will appear here.</p>';
    }

    const rendered = marked.parse(content);
    const html = typeof rendered === 'string' ? rendered : '';
    return DOMPurify.sanitize(html);
  }, [content]);

  const words = useMemo(() => getWordCount(content), [content]);

  const handleFieldChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleGenerate = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (!form.topic.trim()) {
      setError('Please enter a topic or title first.');
      return;
    }

    setIsGenerating(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(form),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message || 'Generation failed. Please try again.');
      }

      setContent(payload.content);
      setSuccess('Draft generated. You can now edit and export your post.');
    } catch (apiError) {
      setError(apiError.message || 'Failed to generate blog post.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = (format) => {
    if (!content.trim()) {
      setError('Generate or write a post before downloading.');
      return;
    }

    const safeTopic = slugify(form.topic || 'blog-post') || 'blog-post';

    if (format === 'md') {
      downloadFile({
        fileName: `${safeTopic}.md`,
        mimeType: 'text/markdown;charset=utf-8',
        content,
      });
      return;
    }

    if (format === 'txt') {
      downloadFile({
        fileName: `${safeTopic}.txt`,
        mimeType: 'text/plain;charset=utf-8',
        content: toPlainText(content),
      });
      return;
    }

    if (format === 'html') {
      const documentHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${form.topic || 'Generated Blog Post'}</title>
    <style>
      body { max-width: 760px; margin: 40px auto; padding: 0 16px; font-family: Georgia, serif; line-height: 1.7; color: #1e293b; }
      h1, h2, h3 { line-height: 1.2; }
      pre { overflow: auto; background: #f7f7f7; padding: 12px; border-radius: 8px; }
      code { background: #f4f4f5; padding: 2px 4px; border-radius: 4px; }
    </style>
  </head>
  <body>
    ${previewHtml}
  </body>
</html>`;

      downloadFile({
        fileName: `${safeTopic}.html`,
        mimeType: 'text/html;charset=utf-8',
        content: documentHtml,
      });
    }
  };

  return (
    <div className="app-shell">
      <header className="hero">
        <p className="eyebrow">Internship Project</p>
        <h1>AI-Powered Blog Generator</h1>
        <p className="subhead">
          Create full article drafts with Gemini AI, edit them in-place, and export in multiple formats.
        </p>
      </header>

      <main className="workspace">
        <section className="card controls">
          <h2>Generate Draft</h2>
          <form onSubmit={handleGenerate} className="form">
            <label htmlFor="topic">Topic or Title</label>
            <input
              id="topic"
              name="topic"
              placeholder="e.g. How AI is changing remote work in 2026"
              value={form.topic}
              onChange={handleFieldChange}
            />

            <label htmlFor="tone">Tone</label>
            <select id="tone" name="tone" value={form.tone} onChange={handleFieldChange}>
              {toneOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <label htmlFor="length">Length</label>
            <select id="length" name="length" value={form.length} onChange={handleFieldChange}>
              {lengthOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <button type="submit" disabled={isGenerating}>
              {isGenerating ? 'Generating...' : 'Generate Blog Draft'}
            </button>
          </form>

          <div className="status-block" aria-live="polite">
            {error ? <p className="error">{error}</p> : null}
            {success ? <p className="success">{success}</p> : null}
          </div>

          <div className="meta">
            <p>
              <span>Word Count</span>
              <strong>{words}</strong>
            </p>
            <p>
              <span>Reading Time</span>
              <strong>{Math.max(1, Math.round(words / 220))} min</strong>
            </p>
          </div>
        </section>

        <section className="card editor">
          <div className="card-head">
            <h2>Editable Draft (Markdown)</h2>
            <div className="actions">
              <button type="button" onClick={() => handleDownload('md')}>
                Download .md
              </button>
              <button type="button" onClick={() => handleDownload('txt')}>
                Download .txt
              </button>
              <button type="button" onClick={() => handleDownload('html')}>
                Download .html
              </button>
            </div>
          </div>
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Generated blog content will appear here. You can edit everything before export."
          />
        </section>

        <section className="card preview">
          <h2>Live Preview</h2>
          <article
            className="markdown-preview"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        </section>
      </main>
    </div>
  );
}

export default App;
