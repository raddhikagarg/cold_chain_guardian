# Cold Chain Guardian

Cold Chain Guardian is an IoT-enabled cold-chain monitoring platform for tracking temperature-sensitive shipments. It brings shipment operations, device status, sensor telemetry, analytics, and alerts together in a web dashboard.

> **Project status:** The web application and backend support the shipment monitoring workflow with simulated telemetry. The ESP32 firmware is an integration starter; physical sensor drivers and pin mappings must be configured and verified during hardware integration.

## Features

- **Shipment management** — create shipments, configure cargo monitoring requirements, assign devices, schedule departures, and manage shipment status through delivery.
- **Live monitoring dashboard** — view shipment readings, sensor charts, device status, and monitoring activity.
- **Multi-sensor data model** — supports temperature, humidity, shock, light, ethylene, and door-open readings.
- **Alert management** — evaluate readings against shipment monitoring limits, view alerts, and acknowledge or resolve them. Outstanding shipment alerts are resolved as part of delivery completion.
- **Device management** — register devices, view device health and connectivity, assign or release devices, and receive heartbeat and sensor-reading data.
- **History and exposure analytics** — review stored readings and shipment monitoring history.
- **Opt-in telemetry simulation** — generate demo readings through the same backend ingestion flow used by devices. Simulation is off by default and simulated values are not physical measurements.

## Technology stack

| Layer | Technologies |
|---|---|
| Frontend | React, Vite, JavaScript, CSS |
| Backend | Node.js, Express |
| Database | MongoDB, Mongoose |
| Hardware | ESP32 firmware using Arduino framework |
| CI | GitHub Actions |

## Repository structure

```text
.
├── backend/
│   ├── src/
│   │   ├── config/          # Database configuration
│   │   ├── controllers/     # HTTP request handlers
│   │   ├── models/          # Mongoose models
│   │   ├── routes/          # API routes
│   │   ├── services/        # Shipment, device, reading and alert logic
│   │   └── validation/      # Request validation
│   └── test/
│       ├── unit/
│       └── integration/
├── frontend/
│   └── src/
│       ├── components/
│       ├── pages/
│       ├── data/
│       └── utils/
├── hardware/
│   └── esp32/
│       └── ColdChainGuardian.ino
├── .github/
│   └── workflows/
└── PHASE3_API_DEMO.md
```

## Getting started

### Prerequisites

- Node.js and npm
- MongoDB (local instance or MongoDB Atlas)
- Git

### 1. Clone the repository

```bash
git clone https://github.com/raddhikagarg/cold_chain_guardian.git
cd cold_chain_guardian
```

### 2. Configure the backend

Create a backend environment file from the example:

```bash
cd backend
cp .env.example .env
```

Set `MONGODB_URI` in `backend/.env` to your MongoDB connection string. The example configuration uses:

```env
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/cold-chain-guardian
CLIENT_ORIGIN=http://localhost:5173
```

Install dependencies and start the API:

```bash
npm install
npm run dev
```

The backend runs on port **5000** by default, with API routes under `/api`.

### 3. Start the frontend

In a second terminal, from the repository root:

```bash
cd frontend
npm install
npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`). During local development, Vite proxies `/api` requests to the backend at `http://localhost:5000`.

For a hosted backend, configure `VITE_API_BASE_URL` as described in the frontend API configuration.

## Demo workflow

1. Start MongoDB, the backend, and the frontend.
2. Register a device or use an existing registered device.
3. Create a shipment and configure its cargo monitoring limits.
4. Assign an available device and schedule the shipment.
5. Mark the shipment in transit when it is ready to depart.
6. On the dashboard, enable **Start simulation** to generate demo telemetry.
7. Review the persisted readings, charts, and any generated alerts.
8. Acknowledge or resolve alerts from the Alerts view.
9. Mark the shipment delivered and review its completed status and alert state.

For request examples and a more detailed local demo, see [PHASE3_API_DEMO.md](PHASE3_API_DEMO.md).

## ESP32 integration

The starter sketch is located at [hardware/esp32/ColdChainGuardian.ino](hardware/esp32/ColdChainGuardian.ino).

Before connecting a physical device:

1. Configure the Wi-Fi credentials, device ID, and reachable backend API address in the sketch.
2. Install the Arduino libraries required by the sketch, including **ArduinoJson**.
3. Implement and verify the actual sensor drivers and GPIO/I²C pin mapping for the hardware being used.
4. Ensure the ESP32 can reach the backend over the network.
5. Verify device registration, heartbeat updates, and sensor readings in the application.

The sketch currently has simulated sensor values enabled. Do not treat those values as physical sensor measurements. The actual sensor drivers and board pin mappings are not yet verified by this starter code.

## Testing

Backend scripts are defined in `backend/package.json`:

```bash
cd backend
npm test
npm run test:unit
```

The integration tests that require MongoDB need a separate throwaway test database. Configure `MONGODB_URI_TEST` and follow the safeguards documented in the test setup before running database integration tests.

Frontend scripts are defined in `frontend/package.json`:

```bash
cd frontend
npm run lint
npm run build
```

GitHub Actions runs the configured frontend build and backend unit-test checks. Hardware validation and database-backed integration tests require their respective environments.

## Current scope and limitations

- Physical sensor readings depend on completing and validating the ESP32 sensor drivers and wiring.
- Demo simulation is intended for development and demonstration; it is not a substitute for hardware validation.
- GPS hardware and a live route-progress pipeline are not currently included.

## License

No project license has been specified yet.