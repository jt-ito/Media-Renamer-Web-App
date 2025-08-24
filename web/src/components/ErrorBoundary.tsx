import React from 'react';

type State = { error: Error | null };

export default class ErrorBoundary extends React.Component<unknown, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: any) {
    // Log to console for now; remote reporting could be added later
    // Keep minimal to avoid importing other libs
    // eslint-disable-next-line no-console
    console.error('Uncaught render error:', error, info);
  }

  render() {
    if (this.state.error) {
      const err = this.state.error;
      return (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'var(--bg)',
          color: 'var(--text)',
          padding: 24,
          zIndex: 9999,
          overflow: 'auto',
        }}>
          <div style={{ maxWidth: 900, margin: '0 auto' }}>
            <h2 style={{ marginTop: 0 }}>Application error</h2>
            <p style={{ color: 'var(--muted)' }}>The app encountered an error while rendering. The error is shown below and also logged to the browser console.</p>
            <pre style={{ whiteSpace: 'pre-wrap', background: 'rgba(0,0,0,0.04)', padding: 12, borderRadius: 6 }}>{String(err && err.message)}</pre>
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: 'pointer' }}>Stack / details</summary>
              <pre style={{ whiteSpace: 'pre-wrap', background: 'rgba(0,0,0,0.03)', padding: 12, borderRadius: 6 }}>{String(err && (err as any).stack)}</pre>
            </details>
            <div style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => location.reload()}>Reload</button>
            </div>
          </div>
        </div>
      );
    }
    // @ts-ignore allow children
    return this.props.children;
  }
}
