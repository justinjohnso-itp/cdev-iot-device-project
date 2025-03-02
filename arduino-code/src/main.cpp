//This version of the code has a working OLED screen tht shows the value from the ToF sensor and can publish via MQTT

#include <Arduino.h>
#include <WiFiNINA.h>  // use this for Nano 33 IoT, MKR1010, Uno WiFi
// #include <WiFi101.h>    // use this for MKR1000
// #include <WiFiS3.h>  // use this for Uno R4 WiFi
// #include <ESP8266WiFi.h>  // use this for ESP8266-based boards
#include <ArduinoMqttClient.h>
#include "arduino_secrets.h"

#include <Wire.h> // I2C library
#include <VL53L0X.h> // TOF sensor library

#include <Adafruit_SSD1306.h>
#include <Adafruit_GFX.h>

const int SCREEN_WIDTH = 128; // OLED display width, in pixels
const int SCREEN_HEIGHT = 32; // OLED display height, in pixels
#define OLED_RESET    -1 // Reset pin # (not used on most Adafruit OLEDs)
#define SCREEN_ADDRESS 0x3C // I2C address for the OLED display

// initialize the OLED display
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

VL53L0X sensor;

const int changeThreshold = 2; // change threshold for sensor readings
const int maxDistance = 250; // max distance in mm
int lastSensorVal = 0;

// initialize WiFi connection as SSL:
WiFiClient wifi;
MqttClient mqttClient(wifi);

// details for MQTT client:
char broker[] = "tigoe.net";
int port = 1883;
char topic[] = "conndev/piano";
String clientID = "justin-nano33iot-";

// last time the client sent a message, in ms:
long lastTimeSent = 0;
// message sending interval:
int interval = 10 * 1000;

void onMqttMessage(int messageSize) {
  Serial.println("Received a message with topic ");
  Serial.print(mqttClient.messageTopic());
  Serial.print(", length ");
  Serial.print(messageSize);
  Serial.println(" bytes:");
  String incoming = "";
  while (mqttClient.available()) {
    incoming += (char)mqttClient.read();
  }
  int result = incoming.toInt();
  if (result > 0) {
    analogWrite(LED_BUILTIN, result);
  }
  Serial.println(result);
  delay(100);
}

boolean connectToBroker() {
  if (!mqttClient.connect(broker, port)) {
    Serial.print("MQTT connection failed. Error no: ");
    Serial.println(mqttClient.connectError());
    return false;
  }
  mqttClient.onMessage(onMqttMessage);
  Serial.print("Subscribing to topic: ");
  Serial.println(topic);
  mqttClient.subscribe(topic);
  return true;
}

void connectToNetwork() {
  while (WiFi.status() != WL_CONNECTED) {
    Serial.println("Attempting to connect to: " + String(SECRET_SSID));
    WiFi.begin(SECRET_SSID, SECRET_PASS);
    delay(2000);
  }
  Serial.print("Connected. My IP address: ");
  Serial.println(WiFi.localIP());
}

void setup() {
  Serial.begin(9600);
  if (!Serial) delay(3000);

  // Initialize OLED display
  if (!display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS)) {
    Serial.println(F("SSD1306 allocation failed"));
    for (;;);
  }
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println("Initializing...");
  display.display();

  pinMode(LED_BUILTIN, OUTPUT);
  connectToNetwork();
  byte mac[6];
  WiFi.macAddress(mac);
  for (int i = 0; i < 3; i++) {
    clientID += String(mac[i], HEX);
  }
  mqttClient.setId(clientID);
  mqttClient.setUsernamePassword(SECRET_MQTT_USER, SECRET_MQTT_PASS);

  // Initialize TOF sensor
  Wire.begin();
  sensor.setTimeout(500);
  if (!sensor.init()) {
    Serial.println("Failed to detect and initialize TOF sensor!");
    display.clearDisplay();
    display.setCursor(0, 0);
    display.println("TOF Sensor Error!");
    display.display();
    while (1);
  }
  
  sensor.startContinuous(50);
  display.clearDisplay();
  display.setCursor(0, 0);
  display.println("Ready!");
  display.display();
}

void loop() {
// if you disconnected from the network, reconnect:
  if (WiFi.status() != WL_CONNECTED) {
    connectToNetwork();
   // skip the rest of the loop until you are connected:
    return;
  }
  if (!mqttClient.connected()) {
    Serial.println("attempting to connect to broker");
    connectToBroker();
  }
  mqttClient.poll();

  /* TOF SENSOR LOOP */

  int sensorVal = sensor.readRangeContinuousMillimeters();
  int sensorValSmoothed = lastSensorVal * 0.9 + sensorVal * 0.1;

  if (sensorVal < maxDistance && abs(sensorVal - lastSensorVal) > changeThreshold) {
    lastSensorVal = sensorVal;
    if (mqttClient.connected()) {
      // start a new message on the topic:
      mqttClient.beginMessage(topic);
      // print the body of the message:
      mqttClient.print(sensorValSmoothed);
      // send the message:
      mqttClient.endMessage();
      // send a serial notification:
      Serial.print("Published: ");
      Serial.println(sensorValSmoothed);
      // timestamp this message:
      lastTimeSent = WiFi.getTime();
    }
  }

  // Display distance on OLED
  display.clearDisplay();
  display.setCursor(0, 0);
  display.print("Distance: ");
  display.print(sensorVal);
  display.println(" mm");
  display.display();
}
