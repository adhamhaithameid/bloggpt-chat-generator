# WriteFlow — AI Writing Assistant

A full-stack, chat-style AI writing platform.

Chat with an AI assistant to generate and refine blog drafts, choose tone and length, and export polished responses.

## Features

- Modern ChatGPT/Claude-style full-page chat interface
- Pinned composer bar with image attachment support
- Dedicated Settings page:
  - 6 themes (Dark, Light, Matrix Dark/Light, GitHub Dark/Light)
  - Writing defaults (tone & length)
  - API source routing (Local / External)
  - Export latest response (.md / .txt)
- Gemini-powered AI responses
- Custom API request body template and response path mapping
- Responsive layout for desktop and mobile

## Tech Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- AI: Google Gemini API (`@google/generative-ai`)
- Package manager: pnpm workspace

## Project Structure

- `client` — React chat app
- `server` — Express API (`/api/chat`, `/api/generate`, `/api/health`)

## Requirements

- Node.js 18+
- pnpm 10+
- Gemini API key

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

```bash
cp server/.env.example server/.env
```

Set your key inside `server/.env`:

```env
GEMINI_API_KEY=your_real_key_here
```

## Run in development

```bash
pnpm dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:5001`

## Scripts

| Script | Description |
|---|---|
| `pnpm dev` | Run frontend + backend in parallel |
| `pnpm dev:client` | Run only frontend |
| `pnpm dev:server` | Run only backend |
| `pnpm build` | Build frontend |
| `pnpm lint` | Lint frontend |

## GitHub Workflow Files

- `.github/PULL_REQUEST_TEMPLATE.md` — Pull request checklist for WriteFlow changes
- `.github/ISSUE_TEMPLATE/bug_report.yml` — Structured bug reports
- `.github/ISSUE_TEMPLATE/feature_request.yml` — Structured feature requests

## API Endpoints

### `POST /api/chat`

```json
{
  "message": "Write a blog post about AI in education",
  "history": [],
  "tone": "professional",
  "length": "medium"
}
```

### `POST /api/generate`

One-shot blog generation from a topic/title.

### `GET /api/health`

Basic health check.

## Custom API Placeholders

When using Custom Local or Custom External API, these placeholders can be used:

- `{{message}}`, `{{history}}`, `{{tone}}`, `{{length}}`, `{{openaiMessages}}`
