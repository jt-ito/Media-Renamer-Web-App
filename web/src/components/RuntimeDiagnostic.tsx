import React, { useEffect, useState } from 'react';

export default function RuntimeDiagnostic() {
  const [vars, setVars] = useState<Record<string, string>>({});
  const [themeClass, setThemeClass] = useState<string>('');

  useEffect(() => {
    try {
      const root = document.documentElement;
      const style = getComputedStyle(root);
      const interesting = ['--bg', '--text', '--surface', '--border', '--muted'];
      const found: Record<string, string> = {};
      interesting.forEach((k) => (found[k] = style.getPropertyValue(k).trim()));
      // Also capture root children count and top-level elements that could overlay
      const rootChildren = Array.from(document.body.children).map((c) => ({ tag: c.tagName, id: c.id || null, class: c.className || null }));
      // console output for easier remote inspection
      // eslint-disable-next-line no-console
      console.info('[RuntimeDiagnostic] themeClass=', root.className, 'vars=', found, 'bodyChildren=', rootChildren);
      setVars(found);
      setThemeClass(root.className);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('RuntimeDiagnostic failed', e);
    }
  }, []);

  return (
    <div style={{ position: 'fixed', right: 12, bottom: 12, zIndex: 9998, background: 'rgba(0,0,0,0.6)', color: '#fff', padding: 8, borderRadius: 6, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>Diagnostic</div>
      <div>theme class: <code style={{ color: '#ffd' }}>{themeClass || '(none)'}</code></div>
      {Object.keys(vars).length > 0 && (
        <div style={{ marginTop: 6 }}>
          {Object.entries(vars).map(([k, v]) => (
            <div key={k}><strong>{k}</strong>: <code style={{ color: '#ffd' }}>{v || '(empty)'}</code></div>
          ))}
        </div>
      )}
    </div>
  );
}
