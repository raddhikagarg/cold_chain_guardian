
/*
 * COLD CHAIN GUARDIAN
 * Board: DOIT ESP32 DEVKIT V1
 *
 * SENSOR CONNECTIONS
 * DS18B20 DATA  -> GPIO 4
 * DHT11 DATA    -> GPIO 27
 * MPU SDA       -> GPIO 21
 * MPU SCL       -> GPIO 22
 * MPU AD0       -> GND (address 0x68)
 * CAAV-023 OUT  -> GPIO 34
 *
 * MPU is read directly through I2C registers.
 * This avoids relying on the MPU6050 chip-ID check,
 * since the tested module returned WHO_AM_I = 0x70.
 */
#include "secrets.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include <math.h>
#include <DHT.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Wire.h>

// --------------------------------------------------
// 1. CONFIGURATION - EDIT THESE VALUES
// --------------------------------------------------

const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Replace with your currently active Codespaces backend URL.
const char* API_BASE =
  "https://YOUR-CODESPACE-5000.app.github.dev/api";

const char* DEVICE_ID = "ESP32-COLD-CHAIN-01";
const char* DEVICE_NAME = "Cold Chain Guardian - ESP32";
const char* FIRMWARE = "1.0.0";

// --------------------------------------------------
// 2. GPIO CONFIGURATION
// --------------------------------------------------

constexpr uint8_t DS18B20_PIN = 4;
constexpr uint8_t DHT11_PIN = 27;
constexpr uint8_t CAAV023_OUT_PIN = 34;

constexpr uint8_t MPU_SDA_PIN = 21;
constexpr uint8_t MPU_SCL_PIN = 22;

constexpr uint8_t MPU_ADDR = 0x68;

#define DHT_TYPE DHT11

// Most LM393-based IR modules are active LOW.
// Change to false only if your own test confirms
// that detection produces HIGH.
constexpr bool IR_ACTIVE_LOW = true;

// MPU accelerometer configured for +/-4g.
constexpr float ACCEL_LSB_PER_G = 8192.0f;
constexpr float GRAVITY = 9.80665f;

// --------------------------------------------------
// 3. SENSOR OBJECTS
// --------------------------------------------------

DHT dht(DHT11_PIN, DHT_TYPE);

OneWire oneWire(DS18B20_PIN);
DallasTemperature ds18b20(&oneWire);

WiFiClientSecure secureClient;

bool dsReady = false;
bool mpuReady = false;

unsigned long lastSampleAt = 0;
unsigned long lastHeartbeatAt = 0;

constexpr unsigned long SAMPLE_INTERVAL_MS = 5000;
constexpr unsigned long HEARTBEAT_INTERVAL_MS = 30000;

// --------------------------------------------------
// 4. MPU I2C FUNCTIONS
// --------------------------------------------------

bool writeMPURegister(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(value);

  return Wire.endTransmission() == 0;
}

uint8_t readMPURegister(uint8_t reg) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);

  if (Wire.endTransmission(false) != 0) {
    return 0xFF;
  }

  if (Wire.requestFrom(MPU_ADDR, (uint8_t)1) != 1) {
    return 0xFF;
  }

  return Wire.read();
}

bool initialiseMPU() {
  uint8_t identity = readMPURegister(0x75);

  Serial.print("MPU WHO_AM_I: 0x");
  Serial.println(identity, HEX);

  if (identity == 0xFF) {
    Serial.println("MPU I2C communication failed.");
    return false;
  }

  // Wake up sensor.
  if (!writeMPURegister(0x6B, 0x00)) {
    Serial.println("MPU wake-up failed.");
    return false;
  }

  delay(100);

  // Accelerometer range: +/-4g.
  if (!writeMPURegister(0x1C, 0x08)) {
    Serial.println("MPU accelerometer configuration failed.");
    return false;
  }

  // Gyroscope range: +/-500 degrees/second.
  writeMPURegister(0x1B, 0x08);

  Serial.println("MPU accelerometer initialised.");

  return true;
}

bool readMPUAcceleration(
  float &x,
  float &y,
  float &z
) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);

  if (Wire.endTransmission(false) != 0) {
    return false;
  }

  if (Wire.requestFrom(MPU_ADDR, (uint8_t)6) != 6) {
    return false;
  }

  uint8_t data[6];

  for (int i = 0; i < 6; i++) {
    data[i] = Wire.read();
  }

  int16_t rawX = (int16_t)((data[0] << 8) | data[1]);
  int16_t rawY = (int16_t)((data[2] << 8) | data[3]);
  int16_t rawZ = (int16_t)((data[4] << 8) | data[5]);

  x = (float)rawX / ACCEL_LSB_PER_G;
  y = (float)rawY / ACCEL_LSB_PER_G;
  z = (float)rawZ / ACCEL_LSB_PER_G;

  return true;
}

// --------------------------------------------------
// 5. NETWORK FUNCTIONS
// --------------------------------------------------

bool postJson(const String& path, JsonDocument& payload) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi disconnected. Cannot send data.");
    return false;
  }

  HTTPClient http;

  String url = String(API_BASE) + path;

  if (!http.begin(secureClient, url)) {
    Serial.println("HTTPS initialisation failed.");
    return false;
  }

  http.addHeader("Content-Type", "application/json");

  String body;
  serializeJson(payload, body);

  int status = http.POST(body);

  Serial.printf(
    "POST %s -> HTTP %d\n",
    path.c_str(),
    status
  );

  if (status > 0) {
    Serial.println(http.getString());
  } else {
    Serial.println(http.errorToString(status));
  }

  http.end();

  return status >= 200 && status < 300;
}

// --------------------------------------------------
// 6. DEVICE REGISTRATION
// --------------------------------------------------

void registerDevice() {
  StaticJsonDocument<384> doc;

  doc["deviceId"] = DEVICE_ID;
  doc["name"] = DEVICE_NAME;
  doc["firmware"] = FIRMWARE;
  doc["connectivity"] = "Wi-Fi";
  doc["status"] = "offline";

  JsonArray sensors = doc.createNestedArray("sensors");

  sensors.add("temperature");
  sensors.add("humidity");
  sensors.add("shock");
  sensors.add("ir");

  Serial.println("Registering Cold Chain Guardian device...");

  postJson("/devices", doc);
}

// --------------------------------------------------
// 7. HEARTBEAT
// --------------------------------------------------

void sendHeartbeat() {
  StaticJsonDocument<192> doc;

  int rssi = WiFi.RSSI();

  doc["signalDbm"] = rssi;

  doc["signal"] =
    rssi > -60 ? "Strong" :
    rssi > -75 ? "Medium" : "Weak";

  doc["firmware"] = FIRMWARE;
  doc["connectivity"] = "Wi-Fi";

  postJson(
    String("/devices/") + DEVICE_ID + "/heartbeat",
    doc
  );
}

// --------------------------------------------------
// 8. TIME SYNCHRONISATION
// --------------------------------------------------

bool utcTimestamp(char* output, size_t length) {
  struct tm timeInfo;

  if (!getLocalTime(&timeInfo, 3000)) {
    return false;
  }

  strftime(
    output,
    length,
    "%Y-%m-%dT%H:%M:%S.000Z",
    &timeInfo
  );

  return true;
}

// --------------------------------------------------
// 9. SENSOR DATA COLLECTION
// --------------------------------------------------

void sendReading() {
  StaticJsonDocument<384> doc;

  char recordedAt[32];

  if (!utcTimestamp(recordedAt, sizeof(recordedAt))) {
    Serial.println("NTP time unavailable. Skipping reading.");
    return;
  }

  doc["recordedAt"] = recordedAt;

  bool hasValue = false;

  Serial.println("\n========== SENSOR READINGS ==========");

  // ----------------------------------------------
  // DS18B20 TEMPERATURE
  // ----------------------------------------------

  if (dsReady) {
    ds18b20.requestTemperatures();

    float temperature = ds18b20.getTempCByIndex(0);

    if (
      temperature != DEVICE_DISCONNECTED_C &&
      isfinite(temperature) &&
      temperature >= -55.0 &&
      temperature <= 125.0
    ) {
      doc["temperature"] = temperature;

      hasValue = true;

      Serial.printf(
        "DS18B20 Temperature: %.2f C\n",
        temperature
      );
    } else {
      Serial.println("DS18B20 reading failed.");
    }
  }

  // ----------------------------------------------
  // DHT11 HUMIDITY
  // ----------------------------------------------

  float humidity = dht.readHumidity();
  float dhtTemperature = dht.readTemperature();

  if (
    isfinite(humidity) &&
    humidity >= 0 &&
    humidity <= 100
  ) {
    doc["humidity"] = humidity;

    hasValue = true;

    Serial.printf(
      "DHT11 Humidity: %.1f %%RH\n",
      humidity
    );
  } else {
    Serial.println("DHT11 humidity reading failed.");
  }

  if (isfinite(dhtTemperature)) {
    Serial.printf(
      "DHT11 Temperature (reference): %.1f C\n",
      dhtTemperature
    );
  }

  // ----------------------------------------------
  // MPU ACCELEROMETER / SHOCK
  // ----------------------------------------------

  if (mpuReady) {
    float ax, ay, az;

    if (readMPUAcceleration(ax, ay, az)) {

      float magnitude = sqrtf(
        ax * ax +
        ay * ay +
        az * az
      );

      // Provisional shock metric:
      // deviation of acceleration magnitude from 1g.
      float shock = fabsf(magnitude - 1.0f);

      if (isfinite(shock)) {
        doc["shock"] = shock;

        hasValue = true;

        Serial.printf(
          "Acceleration X: %.3f g | Y: %.3f g | Z: %.3f g\n",
          ax, ay, az
        );

        Serial.printf(
          "Acceleration magnitude: %.3f g\n",
          magnitude
        );

        Serial.printf(
          "Shock deviation: %.3f g\n",
          shock
        );
      }
    } else {
      Serial.println("MPU acceleration read failed.");
    }
  }

  // ----------------------------------------------
  // CAAV-023 IR SENSOR
  // ----------------------------------------------

  bool irRawHigh =
    digitalRead(CAAV023_OUT_PIN) == HIGH;

  bool irDetected =
    IR_ACTIVE_LOW ? !irRawHigh : irRawHigh;

  doc["irDetected"] = irDetected;

  hasValue = true;

  Serial.printf(
    "CAAV-023 IR: %s | OUT: %s\n",
    irDetected ? "DETECTED" : "CLEAR",
    irRawHigh ? "HIGH" : "LOW"
  );

  // ----------------------------------------------
  // SEND DATA TO BACKEND
  // ----------------------------------------------

  if (!hasValue) {
    Serial.println("No valid sensor measurements.");
    return;
  }

  Serial.println("Sending sensor data to backend:");

  serializeJsonPretty(doc, Serial);
  Serial.println();

  postJson(
    String("/devices/") + DEVICE_ID + "/readings",
    doc
  );

  Serial.println("=====================================");
}

// --------------------------------------------------
// 10. SETUP
// --------------------------------------------------

void setup() {
  Serial.begin(115200);

  delay(1000);

  Serial.println();
  Serial.println("====================================");
  Serial.println("       COLD CHAIN GUARDIAN");
  Serial.println("       ESP32 SENSOR FIRMWARE");
  Serial.println("====================================");

  // IR sensor.
  pinMode(CAAV023_OUT_PIN, INPUT);

  // DHT11.
  dht.begin();

  // DS18B20.
  ds18b20.begin();

  int deviceCount = ds18b20.getDeviceCount();

  dsReady = deviceCount > 0;

  Serial.printf(
    "DS18B20 devices found: %d\n",
    deviceCount
  );

  // MPU.
  Wire.begin(MPU_SDA_PIN, MPU_SCL_PIN);

  mpuReady = initialiseMPU();

  // WiFi.
  WiFi.mode(WIFI_STA);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting to WiFi");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();

  Serial.println("WiFi connected.");

  Serial.print("ESP32 IP address: ");
  Serial.println(WiFi.localIP());

  // Temporary HTTPS configuration for testing.
  // Replace with certificate validation before production.
  secureClient.setInsecure();

  // UTC time.
  configTime(
    0,
    0,
    "pool.ntp.org",
    "time.nist.gov"
  );

  Serial.println("Synchronising time...");

  bool timeReady = false;

  for (int i = 0; i < 20; i++) {
    struct tm timeInfo;

    if (getLocalTime(&timeInfo, 1000)) {
      timeReady = true;
      break;
    }

    delay(250);
  }

  Serial.println(
    timeReady ? "Clock synchronised." :
                "NTP synchronisation pending."
  );

  // Backend registration and heartbeat.
  registerDevice();

  sendHeartbeat();

  lastHeartbeatAt = millis();
  lastSampleAt = millis();

  Serial.println();
  Serial.println("All sensor initialisation complete.");
  Serial.println("Live monitoring started.");
}

// --------------------------------------------------
// 11. MAIN LOOP
// --------------------------------------------------

void loop() {

  // Reconnect WiFi if disconnected.
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi lost. Reconnecting...");

    WiFi.reconnect();

    delay(1000);

    return;
  }

  unsigned long now = millis();

  // Heartbeat every 30 seconds.
  if (
    now - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS
  ) {
    lastHeartbeatAt = now;

    sendHeartbeat();
  }

  // Sensor readings every 5 seconds.
  if (
    now - lastSampleAt >= SAMPLE_INTERVAL_MS
  ) {
    lastSampleAt = now;

    sendReading();
  }
}
