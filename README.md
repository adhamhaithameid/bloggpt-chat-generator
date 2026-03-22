# AI-Powered Blog Generator

A full-stack blog writing platform that generates article drafts from a topic/title using Gemini API.

## What this project does

- Accepts a topic/title input
- Accepts a writing tone selection
- Accepts an article length selection
- Uses a backend API to call Gemini and generate a full draft
- Shows an editable Markdown editor
- Shows a live post preview
- Exports/downloads the final post as `.md`, `.txt`, or `.html`

## Tech stack

- Frontend: React + Vite
- Backend: Node.js + Express
- AI API: Gemini (`@google/generative-ai`)

## Project structure

- `client` - React frontend
- `server` - Express API

## Setup

### 1. Install dependencies

Run this in the project root:

```bash
npm install
npm install --prefix server
npm install --prefix client
```

### 2. Add Gemini API key

Create a `.env` file in `server`:

```bash
cp server/.env.example server/.env
```

Then edit `server/.env` and set:

```env
GEMINI_API_KEY=your_real_key_here
```

Optional: if you deploy the backend separately, create `client/.env`:

```bash
cp client/.env.example client/.env
```

### 3. Start the app

From root:

```bash
npm run dev
```

- Frontend runs at `http://localhost:5173`
- Backend runs at `http://localhost:5001`

## API endpoint

- `POST /api/generate`

Request body:

```json
{
  "topic": "How AI changes product management",
  "tone": "professional",
  "length": "medium"
}
```

## Notes

- Keep your API key only in `server/.env` (never commit it)
- Default Gemini model is `gemini-1.5-flash` (changeable via `GEMINI_MODEL`)

## Internship demo idea

1. Enter a trending topic
2. Generate a draft in different tones (professional vs casual)
3. Edit a section live
4. Download as `.html` and open it in browser
