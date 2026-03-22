const modules = import.meta.glob('./entries/*.js', { eager: true });
const validTones = new Set(['professional', 'casual', 'friendly', 'persuasive', 'witty']);
const validLengths = new Set(['short', 'medium', 'long']);

function isPromptEntry(entry) {
  return (
    entry &&
    typeof entry.id === 'string' &&
    typeof entry.title === 'string' &&
    typeof entry.category === 'string' &&
    typeof entry.emoji === 'string' &&
    typeof entry.prompt === 'string' &&
    validTones.has(entry.tone) &&
    validLengths.has(entry.length) &&
    Array.isArray(entry.tags) &&
    entry.tags.every((tag) => typeof tag === 'string')
  );
}

export const promptLibrary = Object.values(modules)
  .map((module) => module.default)
  .filter(isPromptEntry)
  .sort((a, b) => a.title.localeCompare(b.title));

export function getStarterPrompts(limit = 4) {
  return promptLibrary.slice(0, Math.max(0, limit));
}
