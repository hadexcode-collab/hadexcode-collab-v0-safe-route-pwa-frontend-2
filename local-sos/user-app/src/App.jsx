import React, { useEffect, useState, useRef } from 'react'

function directionFromHeading(heading) {
  if (heading == null) return 'N/A';
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  const idx = Math.round(((heading % 360) + 360) % 360 / 45) % 8;
  return dirs[idx];
}

export default function App() {
  const [online, setOnline] = useState(navigator.onLine);
  const [healthOk, setHealthOk] = useState(true);
  const [heading, setHeading] = useState(null);
  const [location, setLocation] = useState(() => {
    try { return JSON.parse(localStorage.getItem('lastLocation') || 'null'); } catch { return null }
  });
  const [ack, setAck] = useState(null);
  const [sending, setSending] = useState(false);
  const queueRef = useRef([]);

  useEffect(() => {
    function check() {
      fetch('http://localhost:5050/health', {cache: 'no-store', mode: 'cors'})
        .then(r => r.json()).then(() => setHealthOk(true)).catch(() => setHealthOk(false));
    }
    check();
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    function onOnline() { setOnline(true); }
    function onOffline() { setOnline(false); }
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); }
  }, []);

  useEffect(() => {
    if ('DeviceOrientationEvent' in window && typeof DeviceOrientationEvent.requestPermission === 'function') {
      // iOS
      DeviceOrientationEvent.requestPermission().then((p) => {
        if (p === 'granted') {
          window.addEventListener('deviceorientation', (e) => {
            const h = e.webkitCompassHeading ?? e.alpha ?? null;
            if (h != null) setHeading(Math.round(h));
          });
        }
      }).catch(()=>{});
    } else if ('DeviceOrientationEvent' in window) {
      window.addEventListener('deviceorientation', (e) => {
        const h = e.webkitCompassHeading ?? e.alpha ?? null;
        if (h != null) setHeading(Math.round(h));
      });
    }
  }, []);

  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    const id = navigator.geolocation.watchPosition((pos)=>{
      const loc = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy };
      setLocation(loc);
      localStorage.setItem('lastLocation', JSON.stringify(loc));
    }, (err) => {
      console.warn('geo error', err);
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 });
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // SMS queue retry if gateway is down
  useEffect(() => {
    const id = setInterval(async () => {
      const q = JSON.parse(localStorage.getItem('smsQueue') || '[]');
      if (q.length === 0) return;
      for (const item of q.slice()) {
        try {
          const r = await fetch('http://localhost:5050/sms-receiver', {
            method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ payload: item.payload })
          });
          if (r.status === 200) {
            const j = await r.json();
            setAck(j.ack || 'ACK');
            // remove from queue
            const nq = JSON.parse(localStorage.getItem('smsQueue') || '[]').filter(x=>x.id !== item.id);
            localStorage.setItem('smsQueue', JSON.stringify(nq));
          }
        } catch (err) {
          // still offline/gateway down
        }
      }
    }, 5000);
    return () => clearInterval(id);
  }, []);

  async function sendSOS() {
    setSending(true);
    const id = localStorage.getItem('deviceId') || ('HX' + Math.random().toString(36).slice(2,7).toUpperCase());
    localStorage.setItem('deviceId', id);
    const loc = location || { latitude: 12.8296, longitude: 80.2270 };
    const dir = directionFromHeading(heading);
    const time = new Date().toISOString();
    const payload = `SOS|ID=${id}|LAT=${loc.latitude}|LON=${loc.longitude}|DIR=${dir}|TYPE=TSUNAMI|TIME=${time}`;

    try {
      const r = await fetch('http://localhost:5050/sms-receiver', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ payload }) });
      if (r.status === 200) {
        const j = await r.json();
        setAck(j.ack || 'ACK');
      } else if (r.status === 202) {
        // queued by gateway
        setAck('QUEUED');
      } else {
        // queue locally
        const q = JSON.parse(localStorage.getItem('smsQueue') || '[]');
        const item = { id: Date.now(), payload };
        q.push(item);
        localStorage.setItem('smsQueue', JSON.stringify(q));
        setAck('QUEUED_LOCAL');
      }
    } catch (err) {
      // gateway down — queue locally
      const q = JSON.parse(localStorage.getItem('smsQueue') || '[]');
      const item = { id: Date.now(), payload };
      q.push(item);
      localStorage.setItem('smsQueue', JSON.stringify(q));
      setAck('QUEUED_LOCAL');
    }

    setSending(false);
  }

  return (
    <div className="p-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-4">SafeRoute - Offline-First SOS</h1>

      <div className="mb-4 p-4 rounded bg-slate-800">
        <div>Network: <span className={navigator.onLine ? 'text-green-300' : 'text-red-400'}>{navigator.onLine ? 'ONLINE' : 'OFFLINE'}</span></div>
        <div>Gateway health: <span className={healthOk ? 'text-green-300' : 'text-yellow-300'}>{healthOk ? 'OK' : 'UNREACHABLE'}</span></div>
      </div>

      <div className="mb-4 p-4 rounded bg-slate-800">
        <div className="mb-2">Compass: <span className="font-bold">{heading ?? 'N/A'}</span> ({directionFromHeading(heading)})</div>
        <div>Location: <span className="font-bold">{location ? `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}` : 'unknown'}</span></div>
      </div>

      <div className="mb-4">
        <button onClick={sendSOS} disabled={sending} className="w-full py-3 bg-red-600 rounded font-bold hover:brightness-110">{sending ? 'Sending...' : 'SOS - Send'}</button>
      </div>

      <div className="mb-4 p-4 rounded bg-slate-800">
        <div className="text-sm">ACK / Status:</div>
        <div className="font-mono mt-2">{ack || '—'}</div>
      </div>

      <div className="text-xs text-slate-400">* If offline, message will be sent to local SMS Gateway which forwards to Government backend. Messages are queued if gateway/backend are down.</div>
    </div>
  )
}
