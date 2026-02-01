const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 5050;

// In-memory SMSC log and retry queue
const messages = [];
const retryQueue = [];
let isProcessingQueue = false;

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/messages', (req, res) => {
  res.json({ messages, queueSize: retryQueue.length });
});

// Receive SMS-like payload from user app
app.post('/sms-receiver', async (req, res) => {
  try {
    const { payload } = req.body;
    if (!payload) return res.status(400).json({ error: 'missing payload' });

    const receivedAt = Date.now();
    const rec = { id: messages.length + 1, raw: payload, receivedAt, status: 'received' };
    messages.push(rec);

    // Forward to government backend
    try {
      const r = await axios.post('http://localhost:6060/sos', { raw: payload }, { timeout: 5000 });
      const ack = r.data?.ack ?? 'ACK|UNKNOWN';
      rec.status = 'forwarded';
      rec.ack = ack;
      return res.json({ ack });
    } catch (err) {
      // Queue for retry
      rec.status = 'queued';
      retryQueue.push({ id: rec.id, payload, attempts: 0, lastError: err.message });
      processQueue();
      return res.status(202).json({ queued: true });
    }
  } catch (err) {
    console.error('sms-receiver error', err);
    res.status(500).json({ error: 'internal' });
  }
});

// Retry processor
async function processQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (retryQueue.length > 0) {
    const item = retryQueue[0];
    try {
      const r = await axios.post('http://localhost:6060/sos', { raw: item.payload }, { timeout: 5000 });
      const ack = r.data?.ack ?? 'ACK|UNKNOWN';
      const msg = messages.find((m) => m.id === item.id);
      if (msg) { msg.status = 'forwarded'; msg.ack = ack; }
      retryQueue.shift();
    } catch (err) {
      item.attempts += 1;
      item.lastError = err.message;
      // exponential backoff up to 1 minute
      const delay = Math.min(60000, 1000 * Math.pow(2, item.attempts));
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  isProcessingQueue = false;
}

app.listen(PORT, () => {
  console.log(`SMS Gateway Simulator listening on http://localhost:${PORT}`);
});
