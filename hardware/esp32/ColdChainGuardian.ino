/*
 * Cold Chain Guardian - DOIT ESP32 DEVKIT V1
 * Confirmed wiring:
 * DS18B20 DATA GPIO4; DHT11 DATA GPIO27;
 * MPU-compatible accelerometer SDA GPIO21 / SCL GPIO22, address 0x68;
 * CAAV-023 digital OUT GPIO34.
 *
 * Backend endpoints:
 * POST /api/devices
 * POST /api/devices/:deviceId/heartbeat
 * POST /api/devices/:deviceId/readings
 *
 * Keep secrets.h local and excluded by .gitignore.
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

const char* DEVICE_ID = "ESP32-COLD-CHAIN-01";
const char* DEVICE_NAME = "Cold Chain Guardian - ESP32";
const char* FIRMWARE = "1.0.0";

constexpr uint8_t DS18B20_PIN = 4;
constexpr uint8_t DHT11_PIN = 27;
constexpr uint8_t IR_OUT_PIN = 34;
constexpr uint8_t MPU_SDA_PIN = 21;
constexpr uint8_t MPU_SCL_PIN = 22;
constexpr uint8_t MPU_ADDRESS = 0x68;
constexpr bool IR_ACTIVE_LOW = true;
#define DHT_TYPE DHT11

// Direct-register access is used because this tested board returned
// WHO_AM_I = 0x70 while still providing valid changing acceleration data.
constexpr uint8_t REG_WHO_AM_I = 0x75;
constexpr uint8_t REG_PWR_MGMT_1 = 0x6B;
constexpr uint8_t REG_ACCEL_CONFIG = 0x1C;
constexpr uint8_t REG_ACCEL_XOUT_H = 0x3B;
constexpr float ACCEL_LSB_PER_G = 8192.0f; // +/-4g

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

bool writeMpuRegister(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(MPU_ADDRESS);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

bool readMpuRegisters(uint8_t startReg, uint8_t* buffer, size_t length) {
  Wire.beginTransmission(MPU_ADDRESS);
  Wire.write(startReg);
  if (Wire.endTransmission(false) != 0) return false;

  const size_t received = Wire.requestFrom((int)MPU_ADDRESS, (int)length, (int)true);
  if (received != length) return false;

  for (size_t i = 0; i < length; i++) buffer[i] = Wire.read();
  return true;
}

int16_t combineBytes(uint8_t highByte, uint8_t lowByte) {
  return (int16_t)(((uint16_t)highByte << 8) | lowByte);
}

bool initialiseMpu() {
  uint8_t identity = 0;
  if (!readMpuRegisters(REG_WHO_AM_I, &identity, 1)) {
    Serial.println("MPU register read failed.");
    return false;
  }

  Serial.printf("Accelerometer WHO_AM_I: 0x%02X\n", identity);

  if (!writeMpuRegister(REG_PWR_MGMT_1, 0x00)) return false;
  delay(100);
  if (!writeMpuRegister(REG_ACCEL_CONFIG, 0x08)) return false;
  delay(50);

  Serial.println("MPU-compatible accelerometer configured for +/-4g.");
  return true;
}

bool readAcceleration(float& xG, float& yG, float& zG) {
  uint8_t data[6];
  if (!readMpuRegisters(REG_ACCEL_XOUT_H, data, sizeof(data))) return false;

  xG = combineBytes(data[0], data[1]) / ACCEL_LSB_PER_G;
  yG = combineBytes(data[2], data[3]) / ACCEL_LSB_PER_G;
  zG = combineBytes(data[4], data[5]) / ACCEL_LSB_PER_G;

  return isfinite(xG) && isfinite(yG) && isfinite(zG);
}

bool postJson(const String& path, JsonDocument& payload) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("POST skipped: Wi-Fi disconnected.");
    return false;
  }

  HTTPClient http;
  const String url = String(API_BASE) + path;

  if (!http.begin(secureClient, url)) {
    Serial.println("Could not initialise HTTPS request.");
    return false;
  }

  http.addHeader("Content-Type", "application/json");
  String body;
  serializeJson(payload, body);

  const int status = http.POST(body);
  Serial.printf("POST %s -> HTTP %d\n", path.c_str(), status);

  if (status > 0) Serial.println(http.getString());
  else Serial.printf("HTTP error: %s\n", http.errorToString(status).c_str());

  http.end();
  return status >= 200 && status < 300;
}

void registerDevice() {
  StaticJsonDocument<384> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["name"] = DEVICE_NAME;
  doc["status"] = "offline";
  doc["connectivity"] = "Wi-Fi";
  doc["firmware"] = FIRMWARE;

  JsonArray sensors = doc.createNestedArray("sensors");
  sensors.add("temperature");
  sensors.add("humidity");
  sensors.add("shock");
  sensors.add("ir");

  Serial.println("Registering device. HTTP 409 can mean it is already registered.");
  postJson("/devices", doc);
}

void sendHeartbeat() {
  StaticJsonDocument<192> doc;
  const int rssi = WiFi.RSSI();

  doc["signalDbm"] = rssi;
  doc["signal"] = rssi > -60 ? "Strong" : (rssi > -75 ? "Medium" : "Weak");
  doc["firmware"] = FIRMWARE;
  doc["connectivity"] = "Wi-Fi";

  postJson(String("/devices/") + DEVICE_ID + "/heartbeat", doc);
}

bool makeUtcTimestamp(char* output, size_t outputLength) {
  struct tm timeInfo;
  if (!getLocalTime(&timeInfo, 3000)) return false;

  strftime(output, outputLength, "%Y-%m-%dT%H:%M:%S.000Z", &timeInfo);
  return true;
}

void sendSensorReading() {
  StaticJsonDocument<384> doc;
  char timestamp[32];

  if (!makeUtcTimestamp(timestamp, sizeof(timestamp))) {
    Serial.println("NTP time unavailable; skipping sample.");
    return;
  }

  doc["recordedAt"] = timestamp;
  bool hasMeasurement = false;

  // DS18B20: temperature in degrees Celsius.
  if (dsReady) {
    ds18b20.requestTemperatures();
    const float temperatureC = ds18b20.getTempCByIndex(0);

    if (temperatureC != DEVICE_DISCONNECTED_C &&
        isfinite(temperatureC) &&
        temperatureC >= -55.0f && temperatureC <= 125.0f) {
      doc["temperature"] = temperatureC;
      hasMeasurement = true;
      Serial.printf("DS18B20: %.2f C\n", temperatureC);
    } else {
      Serial.println("DS18B20 read failed.");
    }
  }

  // DHT11: humidity is transmitted; temperature is printed for reference.
  const float humidity = dht.readHumidity();
  const float dhtTemperature = dht.readTemperature();

  if (isfinite(humidity) && humidity >= 0.0f && humidity <= 100.0f) {
    doc["humidity"] = humidity;
    hasMeasurement = true;
    Serial.printf("DHT11 humidity: %.1f %%RH\n", humidity);
  } else {
    Serial.println("DHT11 humidity read failed.");
  }

  if (isfinite(dhtTemperature)) {
    Serial.printf("DHT11 temperature (reference): %.1f C\n", dhtTemperature);
  }

  // Provisional shock indicator = deviation of acceleration magnitude from 1g.
  // This is not a calibrated impact peak; field calibration is still required.
  if (mpuReady) {
    float xG, yG, zG;

    if (readAcceleration(xG, yG, zG)) {
      const float magnitudeG = sqrtf(xG*xG + yG*yG + zG*zG);
      const float shockG = fabsf(magnitudeG - 1.0f);

      if (isfinite(shockG)) {
        doc["shock"] = shockG;
        hasMeasurement = true;
        Serial.printf("MPU acceleration X=%.3f Y=%.3f Z=%.3f g; shock indicator=%.3f g\n",
                      xG, yG, zG, shockG);
      }
    } else {
      Serial.println("MPU accelerometer read failed.");
    }
  }

  // CAAV-023 digital proximity state. It is not ethylene or door status.
  const bool outputHigh = digitalRead(IR_OUT_PIN) == HIGH;
  const bool irDetected = IR_ACTIVE_LOW ? !outputHigh : outputHigh;

  doc["irDetected"] = irDetected;
  hasMeasurement = true;
  Serial.printf("CAAV-023 IR: %s (OUT=%s)\n",
                irDetected ? "DETECTED" : "clear",
                outputHigh ? "HIGH" : "LOW");

  if (!hasMeasurement) {
    Serial.println("No valid sensor measurements; not posting.");
    return;
  }

  Serial.print("Sending sensor payload: ");
  serializeJson(doc, Serial);
  Serial.println();

  postJson(String("/devices/") + DEVICE_ID + "/readings", doc);
}

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting to Wi-Fi");
  const unsigned long startedAt = millis();

  while (WiFi.status() != WL_CONNECTED &&
         millis() - startedAt < 30000UL) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("ESP32 IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("Wi-Fi connection timed out; loop will retry.");
  }
}

void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(IR_OUT_PIN, INPUT);
  dht.begin();

  ds18b20.begin();
  dsReady = ds18b20.getDeviceCount() > 0;
  Serial.printf("DS18B20 devices found: %d\n", ds18b20.getDeviceCount());

  Wire.begin(MPU_SDA_PIN, MPU_SCL_PIN);
  mpuReady = initialiseMpu();

  connectWiFi();

  if (WiFi.status() == WL_CONNECTED) {
    // Temporary for initial Codespaces HTTPS testing only.
    // Replace with CA certificate validation before production.
    secureClient.setInsecure();

    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    Serial.println("Waiting for network time...");

    for (int i = 0; i < 20; i++) {
      struct tm timeInfo;
      if (getLocalTime(&timeInfo, 1000)) {
        Serial.println("Clock synchronised.");
        break;
      }
      delay(250);
    }

    registerDevice();
    sendHeartbeat();
    lastHeartbeatAt = millis();
  }

  lastSampleAt = millis();
  Serial.println("Sensor initialisation complete; monitoring loop started.");
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi disconnected; attempting reconnection.");
    WiFi.reconnect();
    delay(1000);
    return;
  }

  const unsigned long now = millis();

  if (now - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeatAt = now;
    sendHeartbeat();
  }

  if (now - lastSampleAt >= SAMPLE_INTERVAL_MS) {
    lastSampleAt = now;
    sendSensorReading();
  }
}
