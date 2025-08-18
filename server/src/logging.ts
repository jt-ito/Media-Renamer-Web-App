import pino from 'pino';
const initialLevel = (process.env.LOG_LEVEL as any) || 'info';
const logger = pino({ level: initialLevel });

type Entry = { level: string; msg: string; time: number };
const ring: Entry[] = [];
const RING_MAX = 2000;

let runtimeLevel: 'info'|'warn'|'error'|'debug' = (initialLevel === 'debug' ? 'debug' : (initialLevel === 'warn' ? 'warn' : (initialLevel === 'error' ? 'error' : 'info')));
let skipStdoutCapture = false;

// Capture writes to stdout/stderr and push into ring buffer
try {
  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: any, ...args: any[]) => {
    try {
      if (!skipStdoutCapture) {
        ring.push({ level: 'info', msg: String(chunk), time: Date.now() });
        if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
      }
    } catch (e) {}
    return origStdoutWrite(chunk, ...args);
  }) as any;
  process.stderr.write = ((chunk: any, ...args: any[]) => {
    try {
      if (!skipStdoutCapture) {
        ring.push({ level: 'error', msg: String(chunk), time: Date.now() });
        if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
      }
    } catch (e) {}
    return origStderrWrite(chunk, ...args);
  }) as any;
} catch (e) {
  // ignore if process streams are not writable in this environment
}

// Unhandled exceptions/rejections
process.on('uncaughtException', (err) => {
  try { ring.push({ level: 'error', msg: `uncaughtException: ${String(err)}`, time: Date.now() }); } catch {}
  try { console.error('uncaughtException:', err && (err.stack || err)); } catch {};
});
process.on('unhandledRejection', (r) => {
  try { ring.push({ level: 'error', msg: `unhandledRejection: ${String(r)}`, time: Date.now() }); } catch {}
  try { console.error('unhandledRejection:', r && ((r as any).stack || r)); } catch {};
});

export function setLogLevel(level: 'info'|'warn'|'error'|'debug') {
  runtimeLevel = level;
  try { logger.level = level; } catch (e) { /* best-effort */ }
}

export function getLogLevel() { return runtimeLevel; }

export function log(level: 'info'|'warn'|'error'|'debug', msg: string) {
  // Push into the ring buffer so the UI can request logs even when
  // the pino logger is configured to a higher threshold.
  try {
    ring.push({ level, msg, time: Date.now() });
    if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
  } catch (e) {}
  // Emit to pino for console output, but avoid having our stdout/stderr
  // capture duplicate the same message. Use a skip flag around the write.
  try {
    skipStdoutCapture = true;
    try { logger[level](msg); } catch (e) { try { logger.info(msg); } catch {} }
  } finally {
    skipStdoutCapture = false;
  }
}

export function getLogs(since?: number) {
  return ring.filter(e => !since || e.time > since);
}

// Capture console.* calls into ring buffer too
try {
  const origConsoleLog = console.log.bind(console);
  const origConsoleError = console.error.bind(console);
  const origConsoleWarn = console.warn.bind(console);
  const origConsoleDebug = console.debug ? console.debug.bind(console) : origConsoleLog;

  console.log = (...args: any[]) => {
    try { ring.push({ level: 'info', msg: args.map(a => String(a)).join(' '), time: Date.now() }); if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX); } catch (e) {}
    return origConsoleLog(...args);
  };
  console.error = (...args: any[]) => {
    try { ring.push({ level: 'error', msg: args.map(a => String(a)).join(' '), time: Date.now() }); if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX); } catch (e) {}
    return origConsoleError(...args);
  };
  console.warn = (...args: any[]) => {
    try { ring.push({ level: 'warn', msg: args.map(a => String(a)).join(' '), time: Date.now() }); if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX); } catch (e) {}
    return origConsoleWarn(...args);
  };
  console.debug = (...args: any[]) => {
    try { ring.push({ level: 'debug', msg: args.map(a => String(a)).join(' '), time: Date.now() }); if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX); } catch (e) {}
    return origConsoleDebug(...args);
  };
} catch (e) {
  // ignore if console cannot be overridden in this environment
}