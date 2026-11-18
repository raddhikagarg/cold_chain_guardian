# Cold Chain Guardian — Demo & Setup

## Local run

1. Copy `backend/.env.example` to `backend/.env` and set `MONGODB_URI`.
2. Terminal 1:
   ```bash
   cd backend
   npm install
   npm run dev
   ```
   Backend API: `http://localhost:5000/api`
3. Terminal 2:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   Open the Vite URL shown in the terminal. During development, Vite proxies `/api` to `http://localhost:5000`. For a hosted API, configure `VITE_API_BASE_URL`.

## Demo telemetry (opt-in)

The dashboard's **Start simulation** control enables generated telemetry for an assigned, in-transit shipment. Simulation is **off by default**. Simulated values are posted to the same backend reading-ingestion API as device readings, stored in MongoDB, evaluated against shipment thresholds, and then fetched back for analytics.

Generated readings are not physical sensor measurements. The shipment detail tiles show persisted readings only; Sensor Analytics explicitly labels its demo fallback.

## Register a test device

If no ESP32 has registered, you can create a local demo device once (the ID must be unique):

```bash
curl -X POST http://localhost:5000/api/devices \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"ESP32-01","name":"Demo ESP32","status":"offline","connectivity":"Wi-Fi","firmware":"demo","sensors":["temperature","humidity","shock","light","door","ethylene"]}'
```

Then send a heartbeat:

```bash
curl -X POST http://localhost:5000/api/devices/ESP32-01/heartbeat \
  -H "Content-Type: application/json" \
  -d '{"battery":100,"signal":"Strong","signalDbm":-45,"firmware":"demo","connectivity":"Wi-Fi"}'
```

If the device already exists, skip registration and send the heartbeat.

## Shipment demo flow

1. Register a device and ensure it is online.
2. Create a shipment with cargo, origin/destination, monitoring limits, and an available device.
3. Schedule the shipment and mark it in transit.
4. On the Overview, enable **Start simulation** to send backend-validated samples.
5. View the latest stored samples and charts; temporarily lower the temperature warning threshold if you want to demonstrate alert generation.
6. Acknowledge/resolve alerts from the Alerts page. The UI waits for the API operation and reports failures.

## ESP32 sketch

`hardware/esp32/ColdChainGuardian.ino` is an integration starter. Configure Wi-Fi and API host. It currently uses simulated values. Before using actual hardware, implement and verify the sensor drivers and GPIO pin mappings in `readSensorValues()`. Do not claim physical sensor telemetry or GPS tracking unless the board and sensor readings have been tested.

## Current limitations

- No GPS/location hardware or live route-progress pipeline is included; route progress is not presented as measured.
- Firmware sensor drivers and board pin mapping are not yet verified.
- CI workflow runs the frontend production build and backend unit tests. Live MongoDB integration tests and hardware tests require a configured environment and are not run here.
