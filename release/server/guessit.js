import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { log } from './logging.js';
let proc = null;
let buffer = '';
const pending = new Map();
let guessitEnabled = true;
let scriptPathCached = null;
function findGuessitScript() {
    // Try a few likely locations to cope with different cwd when launching the server
    const candidates = [
        path.resolve(process.cwd(), 'server', 'guessit_server.py'),
        path.resolve(process.cwd(), '..', 'server', 'guessit_server.py'),
        path.resolve(process.cwd(), 'guessit_server.py'),
        path.resolve(__dirname, '..', 'guessit_server.py')
    ];
    for (const c of candidates) {
        try {
            if (fs.existsSync(c))
                return c;
        }
        catch (e) { /* ignore */ }
    }
    return null;
}
function ensureProc() {
    if (proc && !proc.killed)
        return proc;
    if (!guessitEnabled)
        return null;
    const script = scriptPathCached || findGuessitScript();
    if (!script) {
        try {
            log('warn', `guessit script not found; disabling guessit parsing`);
        }
        catch { }
        guessitEnabled = false;
        return null;
    }
    scriptPathCached = script;
    // Try to use 'python' from PATH. If unavailable, this will error and callers will see it.
    proc = spawn('python', [script], { stdio: ['pipe', 'pipe', 'pipe'] });
    if (!proc || !proc.stdout)
        return proc;
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
        try {
            log('debug', `[guessit stdout] ${String(chunk).trim()}`);
        }
        catch { }
        buffer += chunk;
        let idx;
        while ((idx = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line)
                continue;
            try {
                const msg = JSON.parse(line);
                const id = msg.id;
                if (id && pending.has(id)) {
                    const cb = pending.get(id);
                    pending.delete(id);
                    cb(msg);
                }
            }
            catch (e) {
                // ignore parse errors
            }
        }
    });
    proc.on('exit', () => {
        try {
            log('info', `guessit child exited`);
        }
        catch { }
        proc = null;
        buffer = '';
        for (const [, cb] of pending)
            cb({ error: 'child_exited' });
        pending.clear();
    });
    proc.on('error', (err) => { try {
        log('error', `guessit process error: ${String(err)}`);
    }
    catch { } });
    if (proc.stderr) {
        proc.stderr.setEncoding('utf8');
        proc.stderr.on('data', (c) => { try {
            log('error', `[guessit stderr] ${String(c).trim()}`);
        }
        catch { } });
    }
    return proc;
}
export async function parseWithGuessit(filename) {
    try {
        ensureProc();
        if (!proc)
            throw new Error('failed_to_start_python');
        const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
        const msg = { id, path: filename };
        const p = new Promise((resolve) => {
            pending.set(id, resolve);
            // fallback timeout
            setTimeout(() => {
                if (pending.has(id)) {
                    pending.delete(id);
                    resolve({ error: 'timeout' });
                }
            }, 5000);
        });
        proc.stdin.write(JSON.stringify(msg) + '\n');
        return await p;
    }
    catch (e) {
        return { error: e.message };
    }
}
export function isGuessitEnabled() {
    return guessitEnabled;
}
export function setGuessitEnabled(v) {
    guessitEnabled = !!v;
}
