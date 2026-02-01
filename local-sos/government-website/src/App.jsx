import React, { useEffect, useState } from 'react'

function colorForCapacity(capacity, filled) {
  const free = capacity - filled;
  if (free <= 0) return 'red';
  if (free < Math.ceil(capacity * 0.2)) return 'yellow';
  return 'green';
}

export default function App(){
  const [events, setEvents] = useState([]);
  const [bases, setBases] = useState([]);

  useEffect(()=>{
    fetch('http://localhost:3000/safe_bases').then(r=>r.json()).then(setBases).catch(()=>{});

    const ws = new WebSocket('ws://localhost:6060');
    ws.onopen = () => console.log('ws open');
    ws.onmessage = (m) => {
      try {
        const data = JSON.parse(m.data);
        if (data.type === 'sos') {
          setEvents((e) => [data, ...e]);
        }
      } catch (err) { console.warn(err); }
    };

    return () => ws.close();
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Government SOS Monitor</h1>
      <div className="grid grid-cols-2 gap-6">
        <div className="border rounded p-4">
          <h2 className="font-bold mb-2">Safe Bases</h2>
          <ul>
            {bases.map(b => (
              <li key={b.id} className="flex items-center gap-3 my-2">
                <div style={{width:16,height:16,background: colorForCapacity(b.capacity,b.filled), borderRadius:4}} />
                <div>
                  <div className="font-bold">{b.name}</div>
                  <div className="text-xs text-slate-600">{b.id} — {b.capacity - b.filled} free</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="border rounded p-4">
          <h2 className="font-bold mb-2">Live SOS Events</h2>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {events.map((ev, idx) => (
              <div key={idx} className="p-2 border rounded">
                <div className="font-mono text-sm">{ev.ack}</div>
                <div>{ev.deviceId} at {ev.lat.toFixed(4)}, {ev.lon.toFixed(4)}</div>
                <div className="text-xs text-slate-600">{ev.emergency} — {new Date(ev.time).toLocaleString()}</div>
              </div>
            ))}
            {events.length === 0 && <div className="text-slate-500">No events yet</div>}
          </div>
        </div>
      </div>

      <div className="mt-6">
        <h3 className="font-bold mb-2">Map (mock grid)</h3>
        <div className="w-full h-64 bg-slate-100 border rounded relative">
          {/* mock plotting: scale lat/lon onto box */}
          {bases.map((b)=>{
            // simple scale: lat 12.7..13.2 -> y, lon 80.1..80.3 -> x
            const x = ((b.lon - 80.1) / 0.2) * 100;
            const y = ((13.2 - b.lat) / 0.5) * 100;
            return <div key={b.id} title={b.name} style={{position:'absolute', left:`calc(${x}% - 8px)`, top:`calc(${y}% - 8px)`}}>
              <div style={{width:16,height:16,background: colorForCapacity(b.capacity,b.filled), borderRadius:8, border:'2px solid #fff'}} />
            </div>
          })}

          {events.map((ev, i)=>{
            const x = ((ev.lon - 80.1) / 0.2) * 100;
            const y = ((13.2 - ev.lat) / 0.5) * 100;
            return <div key={i} title={ev.deviceId} style={{position:'absolute', left:`calc(${x}% - 6px)`, top:`calc(${y}% - 6px)`}}>
              <div style={{width:12,height:12,background:'red', borderRadius:6,border:'2px solid #fff'}} />
            </div>
          })}
        </div>
      </div>
    </div>
  )
}
