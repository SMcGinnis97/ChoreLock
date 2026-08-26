// Minimal leveled logger. Timestamps in local time so logs line up with the
// family's day. No deps.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
let threshold = LEVELS.info;

export function setLevel(name) {
  threshold = LEVELS[name] ?? LEVELS.info;
}

function emit(level, args) {
  if (LEVELS[level] < threshold) return;
  const ts = new Date().toLocaleString('sv'); // "YYYY-MM-DD HH:mm:ss"
  const line = `${ts} ${level.toUpperCase().padEnd(5)}`;
  const sink = level === 'error' || level === 'warn' ? console.error : console.log;
  sink(line, ...args);
}

export const log = {
  debug: (...a) => emit('debug', a),
  info: (...a) => emit('info', a),
  warn: (...a) => emit('warn', a),
  error: (...a) => emit('error', a),
};
