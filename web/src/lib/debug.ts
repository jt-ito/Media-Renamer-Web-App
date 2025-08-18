// lightweight debug gate: enable in browser by setting localStorage.devDebug = '1'
export default function debug(...args: any[]) {
  try {
    if (typeof window === 'undefined') return;
    const on = window.localStorage && window.localStorage.getItem && window.localStorage.getItem('devDebug') === '1';
    if (on) console.debug(...args);
  } catch (e) {
    // ignore
  }
}
