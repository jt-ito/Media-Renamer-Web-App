import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
const APPROVED_PATH = process.env.APPROVED_PATH || '/app/config/approved.json';
let cache = [];
function safeLoad() {
    if (!fs.existsSync(APPROVED_PATH))
        return [];
    try {
        return JSON.parse(fs.readFileSync(APPROVED_PATH, 'utf8'));
    }
    catch {
        return [];
    }
}
function save() {
    fs.mkdirSync(path.dirname(APPROVED_PATH), { recursive: true });
    fs.writeFileSync(APPROVED_PATH, JSON.stringify(cache, null, 2));
}
function hashPathSize(filePath, size) {
    return crypto.createHash('sha1').update(filePath + '|' + size).digest('hex');
}
export function initApproved() { cache = safeLoad(); }
export function markApproved(original, size, tvdbId, type, output) {
    const hash = hashPathSize(original, size);
    cache.push({ original, hash, tvdbId, type, approvedAt: Date.now(), output });
    save();
}
export function isApproved(original, size) {
    const hash = hashPathSize(original, size);
    return cache.some(e => e.hash === hash);
}
export function approvedList() {
    return cache.slice();
}
export function unapproveLast(n) {
    if (!n || n <= 0)
        return [];
    const removed = [];
    for (let i = 0; i < n; i++) {
        const e = cache.pop();
        if (!e)
            break;
        removed.push(e);
    }
    save();
    return removed;
}
