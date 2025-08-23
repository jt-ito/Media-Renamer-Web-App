import React from 'react';

type Candidate = { id:number; name:string; year?:number; extra?: any };
export default function MatchPicker({
  candidates, onPick
}: {
  candidates: Candidate[];
  onPick: (c: Candidate) => void;
}) {
  return (
    <div style={{ maxHeight: 260, overflow: 'auto' }}>
      {candidates.map(c => (
        <div key={c.id}
             onClick={() => onPick(c)}
             className="card"
             style={{ padding:8, marginBottom:8, cursor:'pointer', position: 'relative' }}>
          <div style={{ fontWeight: 600 }}>{c.name}{c.year ? ` (${c.year})` : ''}</div>
          {c.extra?.nameSource ? (
            <div style={{ position: 'absolute', right:8, top:8, fontSize:11, color:'#666' }}>{String(c.extra.nameSource)}</div>
          ) : null}
          {c.extra?.audit ? (
            <div style={{ marginTop:6, fontSize:12, color:'#444' }}>
              <details>
                <summary style={{ cursor:'pointer', fontSize:12 }}>Details</summary>
                <pre style={{ whiteSpace:'pre-wrap', marginTop:6 }}>{JSON.stringify(c.extra.audit, null, 2)}</pre>
              </details>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}