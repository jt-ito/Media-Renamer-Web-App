import React, { useEffect, useRef, useState } from 'react';

export default function LogsDrawer() {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [headerH, setHeaderH] = useState(0);
  const [follow, setFollow] = useState(false);
  const GAP = 8;
  
  // load logs and subscribe to stream while open
  useEffect(() => {
  if (!open) return;

    let es: EventSource | null = null;

    (async () => {
      try {
        const res = await fetch('/api/logs');
        if (res.ok) {
          const js = await res.json();
          if (Array.isArray(js)) setLogs(js.slice(-1000));
        }
      } catch (e) {}
    })();

    try {
      es = new EventSource('/api/logs/stream');
      const handler = (e: MessageEvent) => {
        try {
          const d = JSON.parse((e as any).data);
          setLogs(prev => [...prev.slice(-999), d]);
        } catch (err) {
          setLogs(prev => [...prev.slice(-999), { time: Date.now(), level: 'info', msg: (e as any).data }]);
        }
      };
      // @ts-ignore
      es.addEventListener && es.addEventListener('log', handler);
      es.addEventListener('message', handler as any);
    } catch (err) {
      // ignore EventSource errors
    }

    return () => { try { es?.close(); } catch {} };
  }, [open]);

  // listen for open/toggle events from header
  useEffect(() => {
    const openHandler = () => setOpen(true);
    const toggleHandler = () => setOpen(s => !s);
    window.addEventListener('open-logs', openHandler as EventListener);
    window.addEventListener('toggle-logs', toggleHandler as EventListener);
    const updateHeader = () => {
      const header = document.querySelector('header') as HTMLElement | null;
      const h = header ? header.offsetHeight : 0;
      setHeaderH(h);
    };
    updateHeader();
    window.addEventListener('resize', updateHeader);
    const onScroll = () => {
      const header = document.querySelector('header');
      const bottom = header ? header.getBoundingClientRect().bottom : 0;
      setFollow(bottom <= 0);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('open-logs', openHandler as EventListener);
      window.removeEventListener('toggle-logs', toggleHandler as EventListener);
      window.removeEventListener('resize', updateHeader);
      window.removeEventListener('scroll', onScroll as EventListener);
    };
  }, []);
  return (
    <>
      {open && (
        <div
          className={`logs-floating ${follow ? 'follow' : ''}`}
          role="region"
          aria-label="Logs"
          style={{ ['--floating-top' as any]: `${headerH + GAP}px` }}
        >
          <div ref={panelRef} className="logs-panel">
            <div className="row" style={{ justifyContent:'space-between', padding:12, borderBottom:'1px solid var(--border)' }}>
              <div style={{ fontWeight:600 }}>Logs</div>
              <button title="Close the logs viewer" className="btn" onClick={() => setOpen(false)}>Close</button>
            </div>
            <pre className="logs">
              {logs.map(l => {
                const time = l?.time ? new Date(l.time).toLocaleString() : '';
                const level = (l?.level || '').toString().toUpperCase();
                const raw = l?.msg ?? l?.message ?? l;
                const msg = (typeof raw === 'string') ? raw : JSON.stringify(raw, null, 2);
                return `[${time}] ${level} ${msg}`;
              }).join('\n\n')}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}