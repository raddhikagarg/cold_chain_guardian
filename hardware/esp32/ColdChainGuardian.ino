/*
 * Cold Chain Guardian - DOIT ESP32 DEVKIT V1
 * Existing wiring preserved:
 * DS18B20 DQ GPIO4; DHT11 DATA GPIO27; MPU6050 SDA GPIO21/SCL GPIO22,
 * AD0 to GND (0x68); CAAV-023 IR OUT to GPIO34.
 *
 * CAAV-023 is sent as the explicit boolean field irDetected.
 * HTTPS certificate verification is temporarily disabled for first
 * Codespaces connectivity test. Replace with CA validation before production.
 */
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
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>

// Fill locally. Do not commit Wi-Fi credentials.
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* API_BASE = "https://YOUR-CODESPACE-5000.app.github.dev/api";
const char* DEVICE_ID = "ESP32-COLD-CHAIN-01";
const char* DEVICE_NAME = "Cold Chain Guardian - ESP32";
const char* FIRMWARE = "0.3.0";

constexpr uint8_t DS18B20_PIN = 4;
constexpr uint8_t DHT11_PIN = 27;
constexpr uint8_t CAAV023_OUT_PIN = 34;
constexpr bool CAAV023_ACTIVE_LOW = true; // LM393 IR modules commonly pull OUT LOW on detection
constexpr uint8_t MPU6050_SDA_PIN = 21;
constexpr uint8_t MPU6050_SCL_PIN = 22;
#define DHT_TYPE DHT11

DHT dht(DHT11_PIN, DHT_TYPE);
OneWire oneWire(DS18B20_PIN);
DallasTemperature ds18b20(&oneWire);
Adafruit_MPU6050 mpu;
WiFiClientSecure secureClient;

bool dsReady = false;
bool mpuReady = false;
constexpr unsigned long SAMPLE_INTERVAL_MS = 5000;
unsigned long lastSampleAt = 0;
unsigned long lastHeartbeatAt = 0;

bool postJson(const String& path, JsonDocument& payload) {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  if (!http.begin(secureClient, String(API_BASE) + path)) {
    Serial.println("Could not initialise HTTPS connection.");
    return false;
  }
  http.addHeader("Content-Type", "application/json");
  String body;
  serializeJson(payload, body);
  const int status = http.POST(body);
  Serial.printf("POST %s -> HTTP %d\n", path.c_str(), status);
  if (status > 0) Serial.println(http.getString());
  else Serial.printf("HTTPS error: %s\n", http.errorToString(status).c_str());
  http.end();
  return status >= 200 && status < 300;
}

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
  Serial.println("Attempting device registration. A conflict can mean this device ID already exists.");
  postJson("/devices", doc);
}

void sendHeartbeat() {
  StaticJsonDocument<192> doc;
  doc["signalDbm"] = WiFi.RSSI();
  doc["signal"] = WiFi.RSSI() > -60 ? "Strong" : (WiFi.RSSI() > -75 ? "Medium" : "Weak");
  doc["firmware"] = FIRMWARE;
  doc["connectivity"] = "Wi-Fi";
  postJson(String("/devices/") + DEVICE_ID + "/heartbeat", doc);
}

bool utcTimestamp(char* out, size_t len) {
  struct tm ti;
  if (!getLocalTime(&ti, 3000)) return false;
  strftime(out, len, "%Y-%m-%dT%H:%M:%S.000Z", &ti);
  return true;
}

void sendReading() {
  StaticJsonDocument<384> doc;
  char recordedAt[32];
  if (!utcTimestamp(recordedAt, sizeof(recordedAt))) {
    Serial.println("NTP clock not synchronised; skipping sample.");
    return;
  }
  doc["recordedAt"] = recordedAt;
  bool hasValue = false;

  // DS18B20 supplies the backend's shipment temperature field.
  if (dsReady) {
    ds18b20.requestTemperatures();
    const float c = ds18b20.getTempCByIndex(0);
    if (c != DEVICE_DISCONNECTED_C && isfinite(c) && c >= -55.0f && c <= 125.0f) {
      doc["temperature"] = c;
      hasValue = true;
      Serial.printf("DS18B20: %.2f C\n", c);
    } else Serial.println("DS18B20 read failed.");
  }

  // DHT11 humidity is sent; its temperature is diagnostic only to avoid
  // silently mixing two temperature sources in the single API field.
  const float rh = dht.readHumidity();
  const float dhtC = dht.readTemperature();
  if (isfinite(rh) && rh >= 0.0f && rh <= 100.0f) {
    doc["humidity"] = rh;
    hasValue = true;
    Serial.printf("DHT11 humidity: %.1f %%RH\n", rh);
  } else Serial.println("DHT11 humidity read failed.");
  if (isfinite(dhtC)) Serial.printf("DHT11 temperature (reference): %.1f C\n", dhtC);

  // Provisional shock metric: deviation of acceleration magnitude from 1 g.
  // It is not a calibrated impact peak and needs field calibration.
  if (mpuReady) {
    sensors_event_t a, g, t;
    mpu.getEvent(&a, &g, &t);
    const float mag = sqrtf(a.acceleration.x*a.acceleration.x +
                            a.acceleration.y*a.acceleration.y +
                            a.acceleration.z*a.acceleration.z);
    const float shockG = fabsf(mag / 9.80665f - 1.0f);
    if (isfinite(shockG)) {
      doc["shock"] = shockG;
      hasValue = true;
      Serial.printf("MPU6050 acceleration magnitude: %.3f g; deviation: %.3f g\n",
                    mag/9.80665f, shockG);
    }
  }

  // MQ135 analogue output is diagnostic only; no false ethylene conversion.
  Serial.printf("MQ135 raw ADC (0-4095): %d\n", analogRead(MQ135_AO_PIN));

  if (!hasValue) {
    Serial.println("No valid supported measurement; not posting.");
    return;
  }
  Serial.print("Posting reading: ");
  serializeJson(doc, Serial);
  Serial.println();
  postJson(String("/devices/") + DEVICE_ID + "/readings", doc);
}

void setup() {
  Serial.begin(115200);
  delay(500);
  pinMode(CAAV023_OUT_PIN, INPUT);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println();
  Serial.print("ESP32 IP: ");
  Serial.println(WiFi.localIP());

  // Temporary for initial HTTPS test only. Use certificate validation in production.
  secureClient.setInsecure();

  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  Serial.println("Waiting for NTP time...");
  for (int i=0; i<30; i++) {
    struct tm ti;
    if (getLocalTime(&ti, 1000)) { Serial.println("Clock synchronised."); break; }
    delay(300);
  }

  pinMode(CAAV023_OUT_PIN, INPUT);
  Serial.println("CAAV-023 digital input ready on GPIO34.");
  dht.begin();
  ds18b20.begin();
  dsReady = ds18b20.getDeviceCount() > 0;
  Serial.printf("DS18B20 devices found: %d\n", ds18b20.getDeviceCount());

  Wire.begin(MPU6050_SDA_PIN, MPU6050_SCL_PIN);
  mpuReady = mpu.begin(0x68, &Wire);
  if (mpuReady) {
    mpu.setAccelerometerRange(MPU6050_RANGE_4_G);
    mpu.setGyroRange(MPU6050_RANGE_500_DEG);
    mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
    Serial.println("MPU6050 detected at 0x68.");
  } else Serial.println("MPU6050 not detected at 0x68. Check existing wiring/AD0.");

  registerDevice();
  sendHeartbeat();
  lastHeartbeatAt = millis();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi lost; reconnecting.");
    WiFi.reconnect();
    delay(1000);
    return;
  }
  const unsigned long now = millis();
  if (now - lastHeartbeatAt >= 30000UL) {
    lastHeartbeatAt = now;
    sendHeartbeat();
  }
  if (now - lastSampleAt >= SAMPLE_INTERVAL_MS) {
    lastSampleAt = now;
    sendReading();
  }
}
