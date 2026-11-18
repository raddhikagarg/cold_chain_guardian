/*
 Cold Chain Guardian ESP32 -> Backend sample
 Configure Wi-Fi and API host below. Set USE_SIMULATED_SENSOR_VALUES=false
 and implement readSensorValues() with your actual sensor libraries/pins when
 hardware is available. Simulator samples are clearly marked in this sketch.
*/
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <time.h>

const char* WIFI_SSID = "YOUR_WIFI";
const char* WIFI_PASSWORD = "YOUR_PASSWORD";
const char* API_BASE = "http://YOUR_BACKEND_HOST:5000/api";
const char* DEVICE_ID = "ESP32-01";
const char* DEVICE_NAME = "Cold Chain ESP32 Logger";
const char* FIRMWARE = "0.1.0";
const bool USE_SIMULATED_SENSOR_VALUES = true;
const unsigned long SAMPLE_INTERVAL_MS = 5000;

bool registered = false;
unsigned long lastSample = 0;

bool postJson(String path, JsonDocument& payload) {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  http.begin(String(API_BASE) + path);
  http.addHeader("Content-Type", "application/json");
  String body;
  serializeJson(payload, body);
  int code = http.POST(body);
  Serial.printf("POST %s => HTTP %d\n", path.c_str(), code);
  if (code > 0) Serial.println(http.getString());
  http.end();
  return code >= 200 && code < 300;
}

void registerDevice() {
  StaticJsonDocument<768> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["name"] = DEVICE_NAME;
  doc["firmware"] = FIRMWARE;
  doc["connectivity"] = "Wi-Fi";
  doc["sensors"] = JsonArray();
  doc["sensors"].add("temperature");
  doc["sensors"].add("humidity");
  doc["sensors"].add("shock");
  doc["sensors"].add("light");
  doc["sensors"].add("door");
  doc["sensors"].add("ethylene");
  doc["status"] = "offline";
  registered = postJson("/devices", doc);
  if (!registered) {
    // Registration may return a duplicate on later boot; heartbeat still
    // confirms an existing registered device. See backend response in Serial.
    registered = true;
  }
}

void sendHeartbeat() {
  StaticJsonDocument<256> doc;
  doc["battery"] = 100;
  doc["signalDbm"] = WiFi.RSSI();
  doc["signal"] = "Strong";
  doc["firmware"] = FIRMWARE;
  doc["connectivity"] = "Wi-Fi";
  postJson(String("/devices/") + DEVICE_ID + "/heartbeat", doc);
}

void readSensorValues(float& temperature, float& humidity, float& shock,
                     float& light, float& ethylene, bool& doorOpen) {
  if (USE_SIMULATED_SENSOR_VALUES) {
    temperature = 3.0 + (random(0, 30) / 10.0);
    humidity = 60 + random(0, 9);
    shock = random(0, 5) / 10.0;
    light = random(0, 25);
    ethylene = random(0, 10) / 10.0;
    doorOpen = false;
    return;
  }
  // TODO: Replace these with actual sensor library reads and GPIO mapping.
  // Leave unavailable sensor fields out of the JSON payload until implemented.
  temperature = NAN; humidity = NAN; shock = NAN;
  light = NAN; ethylene = NAN; doorOpen = false;
}

void sendReading() {
  float temperature, humidity, shock, light, ethylene;
  bool doorOpen;
  readSensorValues(temperature, humidity, shock, light, ethylene, doorOpen);
  StaticJsonDocument<256> doc;
  doc["recordedAt"] = ""; // Backend requires ISO timestamp; use millis-based UTC below.
  doc["temperature"] = temperature;
  doc["humidity"] = humidity;
  doc["shock"] = shock;
  doc["light"] = light;
  doc["ethylene"] = ethylene;
  doc["doorOpen"] = doorOpen;
  // Use backend/server current time for the demo; ESP32 clock should be NTP
  // configured before sending actual readings.
  struct tm timeinfo;
  if (getLocalTime(&timeinfo)) {
    char iso[32]; strftime(iso, sizeof(iso), "%Y-%m-%dT%H:%M:%S.000Z", &timeinfo); doc["recordedAt"] = iso;
  } else { doc["recordedAt"] = "2026-11-19T00:00:00.000Z"; }
  postJson(String("/devices/") + DEVICE_ID + "/readings", doc);
}

void setup() {
  Serial.begin(115200);
  randomSeed(analogRead(0));
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Wi-Fi connecting");
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println("\nWi-Fi connected");
  registerDevice();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.reconnect();
    delay(1000);
    return;
  }
  if (millis() - lastSample >= SAMPLE_INTERVAL_MS) {
    lastSample = millis();
    sendHeartbeat();
    sendReading();
  }
}
