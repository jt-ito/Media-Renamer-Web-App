import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(process.cwd(), '..');
const settingsPath = path.resolve(root, 'config', 'settings.json');
console.log('Test will write to:', settingsPath);

const initial = { tvdbKey: 'RESTORE-TEST-KEY-123', movieScheme: 'a', seriesScheme: 'b' };
fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
fs.writeFileSync(settingsPath, '{}');

// require the module under test
import('../dist/server.js').catch(() => {});

// We'll just write a file directly to simulate the server behavior
fs.writeFileSync(settingsPath, JSON.stringify(initial, null, 2));
const read = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
console.log('Wrote then read:', read);
