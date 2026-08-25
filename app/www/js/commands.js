const CALL_PATTERN = /\b(call|phone|dial|ring)\s+(.+)/i;
const TIME_PATTERN = /what(?:'s| is)?\s*(the\s*)?time|what time is it/i;
const DATE_PATTERN = /what(?:'s| is)?\s*(the\s*)?date|what day is it|what's today|what is today/i;
const STOP_PATTERN = /^(stop|cancel|never ?mind|nothing|forget it)\.?$/i;
const HELP_PATTERN = /what can you do|how does this work|help me( please)?$|what do you do/i;
const TOOK_PILL_PATTERN = /\b(i took|took my|already took|i've taken)\b.*(pill|medicine|medication)/i;

export function parseCommand(rawText) {
  const text = (rawText || '').trim();
  if (!text) return { type: 'empty' };

  if (STOP_PATTERN.test(text)) {
    return { type: 'stop' };
  }

  const callMatch = text.match(CALL_PATTERN);
  if (callMatch) {
    let name = callMatch[2].trim();
    name = name.replace(/^(my|the)\s+/i, '').replace(/[.?!]$/, '');
    return { type: 'call', name };
  }

  if (TIME_PATTERN.test(text)) {
    return { type: 'time' };
  }

  if (DATE_PATTERN.test(text)) {
    return { type: 'date' };
  }

  if (HELP_PATTERN.test(text)) {
    return { type: 'help' };
  }

  if (TOOK_PILL_PATTERN.test(text)) {
    return { type: 'took_pill' };
  }

  return { type: 'ai', text };
}
