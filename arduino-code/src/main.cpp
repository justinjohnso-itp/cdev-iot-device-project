#include <Arduino.h>
#include <WiFiNINA.h>  
#include <ArduinoMqttClient.h>
#include <Wire.h> 
#include <VL53L0X.h> 
#include <Adafruit_SSD1306.h>
#include <Adafruit_GFX.h>
#include "arduino_secrets.h" 

const int micPin = A0;
const int sampleSize = 10;
const int playThreshold = 350;
const int stopThreshold = 347; //this threshold is weirdly specific because the range outputted by the mic sensor is pretty small
const int stopDelay = 30;
const int maxDistance = 250;
const int changeThreshold = 2;
const long oledTimeout = 10000;  // oled timeout

int readings[sampleSize];  
int bufferIndex = 0;
int total = 0;
bool isPlaying = false;
int belowThresholdCount = 0;
bool personDetected = false;
int lastSensorVal = 0;
long lastSoundTime = 0;
long lastPersonTime = 0;  // Last time a person was detected
long lastTimeSent = 0;
int interval = 2000;  // Send MQTT data every 2 seconds

const int SCREEN_WIDTH = 128;
const int SCREEN_HEIGHT = 32;
#define OLED_RESET -1
#define SCREEN_ADDRESS 0x3C 
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

VL53L0X sensor;

WiFiClient wifi;
MqttClient mqttClient(wifi);
char broker[] = "tigoe.net";  
int port = 1883;
char topic[] = "conndev/piano";
String clientID = "justin-nano33iot-";

void connectToNetwork() {
  while (WiFi.status() != WL_CONNECTED) {
    Serial.println("Attempting WiFi connection...");
    WiFi.begin(SECRET_SSID, SECRET_PASS);
    delay(2000);
  }
  Serial.println("Connected to WiFi!");
}

boolean connectToBroker() {
  Serial.println("Connecting to MQTT...");
  mqttClient.setId(clientID);
  mqttClient.setUsernamePassword(SECRET_MQTT_USER, SECRET_MQTT_PASS);
  
  if (!mqttClient.connect(broker, port)) {
    Serial.print("MQTT failed. Error: ");
    Serial.println(mqttClient.connectError());
    return false;
  }

  Serial.println("MQTT connected!");
  mqttClient.subscribe(topic);
  return true;
}

void setup() {
  Serial.begin(9600);
  if (!Serial) delay(3000);

  //oled initialized
  if (!display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS)) {
    Serial.println("SSD1306 allocation failed");
    while (1);
  }
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println("Initializing...");
  display.display();


  connectToNetwork();
  if (!connectToBroker()) {
    Serial.println("Retrying MQTT...");
    delay(2000);
    connectToBroker();
  }

  
  Wire.begin();
  sensor.setTimeout(500);
  if (!sensor.init()) {
    Serial.println("Failed to initialize ToF sensor!");
    while (1);
  }
  sensor.startContinuous(50);

  
  for (int i = 0; i < sampleSize; i++) {
    readings[i] = 0;
  }


  display.clearDisplay();
  display.setCursor(0, 0);
  display.println("Ready!");
  display.display();
}

// smoothing out the mic readings here... it still doesn't work super great, hence the small range
int getSmoothedMicValue() {
  int rawMicValue = analogRead(micPin);
  total -= readings[bufferIndex]; 
  readings[bufferIndex] = rawMicValue;  
  total += rawMicValue;  
  bufferIndex = (bufferIndex + 1) % sampleSize;  
  return total / sampleSize;
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectToNetwork();
    return;
  }
  if (!mqttClient.connected()) {
    Serial.println("Reconnecting MQTT...");
    connectToBroker();
  }
  mqttClient.poll();

  // detect a person 
  int sensorVal = sensor.readRangeContinuousMillimeters();
  int sensorValSmoothed = lastSensorVal * 0.9 + sensorVal * 0.1;
  lastSensorVal = sensorValSmoothed;
  personDetected = (sensorValSmoothed < maxDistance);

  if (personDetected) {
    lastPersonTime = millis();  
  }

  // detect microphone playing
  int smoothedMicValue = getSmoothedMicValue();
  isPlaying = (smoothedMicValue > playThreshold);

  // continue sending MQTT if the person is still sitting there (they might start again)
  if (personDetected) {
    if (millis() - lastTimeSent > interval) {
      lastTimeSent = millis();
      
      // send message MQTT
      String message = "distance: " + String(sensorValSmoothed) + " volume: " + String(smoothedMicValue);
      mqttClient.beginMessage(topic);
      mqttClient.print(message);
      mqttClient.endMessage();
      Serial.println("Published: " + message);
    }

    // display the message on the oled when they sit down and start playing
    if (isPlaying) {
        lastSoundTime = millis();  
        display.clearDisplay();
        display.setCursor(0, 0);
        display.println("Thanks for playing!");
        display.display();
    }
  } 

  // wait 10s then turn off the oled if the person has left to conserve energy
  if (!personDetected && millis() - lastPersonTime > oledTimeout) { 
    display.clearDisplay();
    display.display();
  }

  delay(100);
}