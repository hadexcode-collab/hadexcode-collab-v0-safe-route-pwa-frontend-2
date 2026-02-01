const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const http = require('http');
const WebSocket = require('ws');

const PORT = 6060;

async function init() {
  const app = express();
  app.use(cors());
  app.use(bodyParser.json());

  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server });

  const db = await open({ filename: './safebase.db', driver: sqlite3.Database });

  // Initialize tables
  await db.exec(`
    CREATE TABLE IF NOT EXISTS safe_bases (
      id TEXT PRIMARY KEY,
      name TEXT,
      lat REAL,
      lon REAL,
      capacity INTEGER,
      filled INTEGER
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS sos_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT,
      lat REAL,
      lon REAL,
      type TEXT,
      time TEXT,
      status TEXT
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS sms_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_message TEXT,
      received_at INTEGER
    );
  `);

  // Preload safe bases if empty
  const row = await db.get('SELECT COUNT(*) as c FROM safe_bases');
  if (row.c === 0) {
    const bases = [
      { id: 'BASE_SHOLI', name: 'Sholinganallur Safe Base', lat: 12.8296, lon: 80.2270, capacity: 100, filled: 10 },
      { id: 'BASE_SATHYA', name: 'Sathyabama University', lat: 13.0520, lon: 80.2043, capacity: 80, filled: 70 },
    ];
    const stmt = await db.prepare('INSERT INTO safe_bases (id,name,lat,lon,capacity,filled) VALUES (?,?,?,?,?,?)');
    for (const b of bases) {
      await stmt.run(b.id, b.name, b.lat, b.lon, b.capacity, b.filled);
    }
    await stmt.finalize();
  }

  // Utility: haversine
  function toRad(v) { return v * Math.PI / 180; }
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371; // km
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)*Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.post('/sos', async (req, res) => {
    try {
      const { raw } = req.body;
      if (!raw) return res.status(400).json({ error: 'missing raw payload' });

      // Log raw message
      await db.run('INSERT INTO sms_logs (raw_message, received_at) VALUES (?, ?)', raw, Date.now());

      // Parse payload: SOS|ID=HX001|LAT=12.8721|LON=80.2254|DIR=NE|TYPE=TSUNAMI|TIME=ISO
      const parts = raw.split('|');
      const payload: any = {};
      for (const p of parts) {
        if (p.includes('=')) {
          const [k, v] = p.split('=');
          payload[k] = v;
        } else {
          payload.typeFlag = p;
        }
      }

      const deviceId = (payload.ID) || 'UNKNOWN';
      const lat = parseFloat(payload.LAT) || 0;
      const lon = parseFloat(payload.LON) || 0;
      const type = payload.TYPE || 'UNKNOWN';
      const time = payload.TIME || new Date().toISOString();

      // Store SOS event
      await db.run('INSERT INTO sos_events (device_id,lat,lon,type,time,status) VALUES (?,?,?,?,?,?)', deviceId, lat, lon, type, time, 'received');

      // Determine nearest safe base
      const bases = await db.all('SELECT * FROM safe_bases');
      let nearest = null;
      let minD = Infinity;
      for (const b of bases) {
        const d = haversine(lat, lon, b.lat, b.lon);
        if (d < minD) { minD = d; nearest = b; }
      }

      let capacityStatus = 'AVAILABLE';
      if (nearest) {
        const free = nearest.capacity - nearest.filled;
        if (free <= 0) capacityStatus = 'FULL';
        else if (free < Math.ceil(nearest.capacity * 0.2)) capacityStatus = 'NEARLY_FULL';
        else capacityStatus = 'AVAILABLE';
      }

      const distKm = minD.toFixed(2);
      const ack = `ACK|SAFEBASE=${nearest ? nearest.id : 'NONE'}|DIST=${distKm}KM|CAPACITY=${capacityStatus}`;

      // Broadcast via WebSocket
      const event = { type: 'sos', deviceId, lat, lon, emergency: type, time, ack };
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(event));
        }
      });

      return res.json({ ack });
    } catch (err) {
      console.error('sos error', err);
      res.status(500).json({ error: 'internal' });
    }
  });

  // Simple listing endpoints
  app.get('/safe_bases', async (req, res) => {
    const bases = await db.all('SELECT * FROM safe_bases');
    res.json(bases);
  });

  app.get('/events', async (req, res) => {
    const events = await db.all('SELECT * FROM sos_events ORDER BY id DESC LIMIT 100');
    res.json(events);
  });

  // start server
  server.listen(PORT, () => {
    console.log(`Government backend listening on http://localhost:${PORT} (WS enabled)`);
  });
}

init().catch((err) => {
  console.error('Failed to start government backend', err);
  process.exit(1);
});
