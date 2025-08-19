import fs from 'fs';
import path from 'path';
// Default SETTINGS_PATH. Keep the Docker-friendly default unless the user
// explicitly overrides with the SETTINGS_PATH environment variable. This avoids
// surprising resets when the server is started from a different working directory.
// To persist settings on non-container hosts, set SETTINGS_PATH to a writable
// path (for example: C:\\path\\to\\media-renamer\\config\\settings.json).
const SETTINGS_PATH = process.env.SETTINGS_PATH || '/app/config/settings.json';
export function loadSettings() {
    if (!fs.existsSync(SETTINGS_PATH))
        return {};
    try {
        return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    }
    catch {
        return {};
    }
}
export function saveSettings(s) {
    try {
        fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
        // If a settings file already exists, merge unknown keys to avoid accidental wipes
        let existing = {};
        if (fs.existsSync(SETTINGS_PATH)) {
            try {
                existing = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8') || '{}');
            }
            catch {
                existing = {};
            }
        }
        const merged = { ...existing, ...s };
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(merged, null, 2));
    }
    catch (e) {
        // If writing fails, prefer to throw so caller can surface the error
        throw e;
    }
}
