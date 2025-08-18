import { useEffect, useMemo, useState } from 'react';
import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import { Settings } from './components/Settings';
import ThemeToggle from './components/ThemeToggle';
import LogsDrawer from './components/LogsDrawer';
import './styles.css';

type Theme = 'light' | 'dark';
type ButtonClasses = { base: string };

const STORAGE_KEY = 'theme';
const prefersDark = () =>
  window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {}
  return prefersDark() ? 'dark' : 'light';
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    const t = getInitialTheme();
    applyTheme(t);
    return t;
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, theme); } catch {}
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored !== 'dark' && stored !== 'light') {
        setTheme(media.matches ? 'dark' : 'light');
      }
    };
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, []);

  const darkMode = theme === 'dark';
  const setDarkMode = (next: boolean) => setTheme(next ? 'dark' : 'light');

  const buttons: ButtonClasses = useMemo(() => ({
    base: 'btn'
  }), []);

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    ['btn', 'nav-button', isActive ? 'nav-button--active' : ''].join(' ').trim();

  const location = useLocation();

  // Header View Logs toggles the global LogsDrawer via custom event
  const viewLogs = () => {
    window.dispatchEvent(new CustomEvent('toggle-logs'));
  };

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
        <nav className="flex gap-3">
          <NavLink to="/" className={navLinkClass}>Dashboard</NavLink>
          <NavLink to="/settings" className={navLinkClass}>Settings</NavLink>
        </nav>
        <div className="flex items-center gap-3">
          {location.pathname === '/' && (
            <button title="Open the live logs overlay" type="button" className={buttons.base} onClick={viewLogs}>
              View Logs
            </button>
          )}
          <ThemeToggle
            value={darkMode}
            onChange={setDarkMode}
            className={`${buttons.base} btn-theme`}
          />
        </div>
      </header>

      <main className="p-4">
        <Routes>
          <Route path="/" element={<Dashboard buttons={buttons} />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>

  {/* Global LogsDrawer (renders portal at top when opened) */}
  <LogsDrawer />
    </div>
  );
}
