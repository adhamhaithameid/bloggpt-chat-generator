# BlogGPT Chat - AI Blog Generator

A full-stack, chat-style AI writing platform for internship demos.

Users can chat with an AI assistant to generate and refine blog drafts, choose tone and length, and export responses.

## Features

- ChatGPT/Claude/Gemini-style minimal chat interface
- 2-line composer layout: line 1 message input, line 2 controls/actions
- Dedicated Settings page for API routing, themes, and defaults
- Gemini-powered AI responses for blog drafting and rewriting
- API target switching:
  - Built-in local API (`/api/chat`)
  - Custom local API endpoint
  - Custom external API endpoint
- Fully customizable custom API request body template and response path mapping
- Tone control: professional, casual, friendly, persuasive, witty
- Length control: short, medium, long
- Multiple themes:
  - White Mode
  - Dark Mode
  - Matrix White
  - Matrix Dark
  - GitHub White
  - GitHub Dark
- Export latest assistant response as `.md` or `.txt`
- Responsive layout for desktop and mobile

## Tech Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- AI: Google Gemini API (`@google/generative-ai`)
- Package manager: pnpm workspace

## Project Structure

- `client` - React chat app
- `server` - Express API (`/api/chat`, `/api/generate`, `/api/health`)

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

Create backend env file:

```bash
cp server/.env.example server/.env
```

Set your key inside `server/.env`:

```env
GEMINI_API_KEY=your_real_key_here
```

Optional frontend env (if backend is hosted elsewhere):

```bash
cp client/.env.example client/.env
```

## Run in development

```bash
pnpm dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:5001`

## Useful Scripts

- `pnpm dev` - run frontend and backend in parallel
- `pnpm dev:client` - run only frontend
- `pnpm dev:server` - run only backend
- `pnpm build` - build frontend
- `pnpm lint` - lint frontend

## API Endpoints

### `POST /api/chat`

Request:

```json
{
  "message": "Write a blog post about AI in education",
  "history": [],
  "tone": "professional",
  "length": "medium"
}
```

Response includes `reply` (Markdown text).

### `POST /api/generate`

Backward-compatible endpoint for one-shot blog generation from a topic/title.

### `GET /api/health`

Basic health check.

## Demo Flow (Internship)

1. Start a new chat
2. Ask for a blog draft on a topic
3. Ask follow-up edits (tone/length changes)
4. Switch theme and show UI personalization
5. Switch API target to custom local or external and test custom mapping
6. Export the final response as `.md`

## Custom API Placeholders

When using `Custom Local` or `Custom External`, these placeholders can be used inside the JSON request template:

- `{{message}}`
- `{{history}}`
- `{{tone}}`
- `{{length}}`
- `{{openaiMessages}}`
