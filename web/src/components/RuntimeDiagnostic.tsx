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
      const rootChildren = Array.from(document.body.children).map((c) => ({ tag: c.tagName, id: c.id || null, class: c.className || null }));

      // Find potential overlay elements (fixed/absolute positioned near top-right)
      const overlays = Array.from(document.body.querySelectorAll('*')).filter(el => {
        try {
          const st = getComputedStyle(el);
          return (st.position === 'fixed' || st.position === 'absolute') && (st.pointerEvents !== 'none' || st.zIndex);
        } catch (e) { return false; }
      }).slice(0, 30).map((el: Element) => ({ tag: el.tagName, id: el.id || null, class: el.className || null, pointerEvents: (getComputedStyle(el).pointerEvents), zIndex: (getComputedStyle(el).zIndex) }));

      // log a friendly summary to the console for remote inspection
      /* eslint-disable no-console */
      console.groupCollapsed('[RuntimeDiagnostic] Page diagnostic');
      console.log('themeClass=', root.className);
      console.log('css vars=', found);
      console.log('top-level body children:', rootChildren);
      console.log('overlay candidates (first 30):', overlays);
      console.log('current body.classList:', Array.from(document.body.classList));
      console.groupEnd();
      /* eslint-enable no-console */

      setVars(found);
      setThemeClass(root.className);

      // Watch for classList mutations on body so changes like `logs-open` are visible in console
      const mo = new MutationObserver(muts => {
        muts.forEach(m => {
          if (m.type === 'attributes' && (m as any).attributeName === 'class') {
            // eslint-disable-next-line no-console
            console.info('[RuntimeDiagnostic] body.class changed ->', document.body.className);
          }
        });
      });
      mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      return () => mo.disconnect();
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
