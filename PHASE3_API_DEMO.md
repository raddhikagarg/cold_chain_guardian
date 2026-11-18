# Phase 3: real API integration + demo telemetry

## Local run (backend + frontend)

1. Copy `backend/.env.example` to `backend/.env` and set `MONGODB_URI`.
2. In terminal 1:
   ```bash
   cd backend
   npm install
   npm run dev
   ```
   API: `http://localhost:5000/api`
3. In terminal 2:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   Vite proxies `/api` to localhost:5000. For a deployed API, set `VITE_API_BASE_URL` in frontend env.

## ESP32 device onboarding

Register each ESP32 once:
```http
POST /api/devices
Content-Type: application/json
```
```json
{
  "deviceId": "ESP32-01",
  "name": "Cold Chain Logger 01",
  "status": "offline",
  "connectivity": "Wi-Fi",
  "firmware": "0.1.0",
  "sensors": ["temperature", "humidity", "shock", "light", "door", "ethylene"]
}
```
The firmware starter in `hardware/esp32/ColdChainGuardian.ino` demonstrates registration, heartbeat and readings. Configure Wi-Fi/API host, then replace `readSensorValues()` with the actual sensor-library reads and pin mappings. Board GPIO assignments are intentionally not guessed.

## Demo/test telemetry

When a shipment is `in-transit` and has a device assigned, the frontend demo timer sends generated readings every 5 seconds to the same endpoint used by the ESP32:
```http
POST /api/devices/:deviceId/readings
```
These values are **simulated**, but they are persisted by MongoDB and passed through the real backend reading validation and cargo alert evaluation. Latest persisted readings are fetched back and shown on shipment detail. Disable/remove the demo timer before claiming a hardware run.

## End-to-end smoke test

- Register a device; verify it appears in Devices.
- Assign it to a shipment, schedule it, then mark it In Transit (set the shipment's scheduled departure to now/past before departure).
- Watch for 5-second simulated telemetry in MongoDB and Shipment detail.
- Temporarily set a low temperature threshold, let a demo reading exceed it, and verify an alert appears.
- When hardware is available, turn off demo telemetry and send real sensor values with an NTP timestamp.

The API implementation is committed on branch `phase-3-shipment-device-apis`. It has not been executed against a live MongoDB instance or built locally in this environment, so run the smoke test before presenting.
