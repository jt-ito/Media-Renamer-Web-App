import React from 'react';

type Candidate = { id:number; name:string; year?:number };
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
             style={{ padding:8, marginBottom:8, cursor:'pointer' }}>
          {c.name}{c.year ? ` (${c.year})` : ''}
        </div>
      ))}
    </div>
  );
}