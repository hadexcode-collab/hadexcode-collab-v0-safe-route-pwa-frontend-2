Local SOS Demo

This repository contains a local offline-first SOS demo with the following components:

- SMS Gateway Simulator: http://localhost:5050 (Express)
- Government Backend: http://localhost:6060 (Express + SQLite + WebSocket)
- User App: http://localhost:3000 (Vite + React) — offline-first
- Government Website: http://localhost:4000 (static + WebSocket)

Quick start (requires Node 18+ and npm):

# from local-sos root
cd local-sos/sms-gateway
npm install
npm run dev

# in a new terminal
cd local-sos/government-backend
npm install
npm run dev

# in a new terminal (user app)
cd local-sos/user-app
npm install
npm run dev

# in a new terminal (government website)
cd local-sos/government-website
npm install
npm run dev

Notes:
- The system is entirely local. Turn off your network adapter or use airplane mode to test offline flow.
- When offline, press SOS in the User App. The app will POST the SMS-like payload to the SMS Gateway. The SMS Gateway forwards to Government Backend which responds with an ACK that will be shown in the User App.
- If the gateway is down, messages are queued locally by the gateway and retried.

Ports used:
- 3000: User App (frontend)
- 4000: Government Website (frontend)
- 5050: SMS Gateway (bridge)
- 6060: Government Backend (API + WebSocket)

