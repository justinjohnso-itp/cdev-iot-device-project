#include <Arduino.h>
#include <WiFiNINA.h>  
#include <ArduinoMqttClient.h>
#include <Wire.h> 
#include <VL53L0X.h> 
#include <Adafruit_SSD1306.h>
#include <Adafruit_GFX.h>
#include "arduino_secrets.h" 
#include <arduinoFFT.h>

const int micPin = A0;
const int sampleSize = 10;
const int maxDistance = 250;
const long oledTimeout = 10000;  // oled timeout

// FFT constants
#define SAMPLES 128             // Must be a power of 2
#define SAMPLING_FREQUENCY 5000 // Hz, must be less than 10000 due to ADC

// FFT variables
double vReal[SAMPLES];
double vImag[SAMPLES];
ArduinoFFT<double> FFT = ArduinoFFT<double>(vReal, vImag, SAMPLES, SAMPLING_FREQUENCY);
unsigned int sampling_period_us;
unsigned long microseconds;
double dominantFrequency = 0;

// Note detection
const char* noteNames[] = {"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"};
String currentNote = "";
int currentOctave = 0;

int readings[sampleSize];  
int bufferIndex = 0;
int total = 0;
bool isPlaying = false;
bool personDetected = false;
int lastSensorVal = 0;
long lastSoundTime = 0;
long lastPersonTime = 0;  // Last time a person was detected
long lastTimeSent = 0;
int interval = 2000;  // Send MQTT data every 2 seconds
long lastFFTTime = 0;  // Last time FFT was calculated
long lastNoteTime = 0;  // Last time a note was detected
const long silenceTimeout = 5000; // Reset note after 5 seconds of silence

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

// Add a display state tracking variable
enum DisplayState {
  STATE_PLAYING,
  STATE_LISTENING,
  STATE_READY,
  STATE_OFF
};

DisplayState currentDisplayState = STATE_OFF;

// Microphone calibration constants for MAX9814 AGC Electret Microphone
const int MIC_DC_OFFSET = 512;  // Microphone DC offset (for a 10-bit ADC, 0-1023 range)
const int MIC_NOISE_FLOOR = 25; // Noise floor level to filter out background noise
const int MIC_MIN_THRESHOLD = 150;  // Adjusted to 150 (was 40)
const int MIC_MAX_AMPLITUDE = 350; // Maximum expected amplitude based on AGC settings
const float MIC_SCALE_FACTOR = 1.0;  // Scale factor for normalizing amplitude

// Piano note frequency constraints (A440 standard tuning)
const double LOWEST_PIANO_FREQ = 27.5;  // A0 - lowest note on a standard piano
const double HIGHEST_PIANO_FREQ = 4186.0; // C8 - highest note on a standard piano
const double BACKGROUND_FREQ_THRESHOLD = 40.0; // Filter out frequencies around 39.06 Hz (D#1)
const double BACKGROUND_FREQ_TOLERANCE = 2.0;  // Tolerance range around background frequency

// Piano note frequency constants based on A4 = 440Hz standard tuning
// Using reference from https://muted.io/note-frequencies/
const double NOTE_FREQUENCIES[] = {
  16.35, 17.32, 18.35, 19.45, 20.60, 21.83, 23.12, 24.50, 25.96, 27.50, 29.14, 30.87, // C0 to B0
  32.70, 34.65, 36.71, 38.89, 41.20, 43.65, 46.25, 49.00, 51.91, 55.00, 58.27, 61.74, // C1 to B1
  65.41, 69.30, 73.42, 77.78, 82.41, 87.31, 92.50, 98.00, 103.8, 110.0, 116.5, 123.5, // C2 to B2
  130.8, 138.6, 146.8, 155.6, 164.8, 174.6, 185.0, 196.0, 207.7, 220.0, 233.1, 246.9, // C3 to B3
  261.6, 277.2, 293.7, 311.1, 329.6, 349.2, 370.0, 392.0, 415.3, 440.0, 466.2, 493.9, // C4 to B4
  523.3, 554.4, 587.3, 622.3, 659.3, 698.5, 740.0, 784.0, 830.6, 880.0, 932.3, 987.8, // C5 to B5
  1047, 1109, 1175, 1245, 1319, 1397, 1480, 1568, 1661, 1760, 1865, 1976, // C6 to B6
  2093, 2217, 2349, 2489, 2637, 2794, 2960, 3136, 3322, 3520, 3729, 3951, // C7 to B7
  4186 // C8
};

// Improved frequency detection parameters
const double SAMPLING_FREQUENCY_ACTUAL = 4800; // Adjusted to account for sampling delay
const int FFT_FREQUENCY_CORRECTION = 1;  // Correction factor for FFT frequency calculation

// Update constants to include distance threshold
const int DISTANCE_THRESHOLD = 150;  // Only process audio when distance is below 150mm

// Function to convert frequency to musical note and octave using a lookup approach
void frequencyToNote(float frequency, String &note, int &octave) {
  // Check if this is likely background noise or out of piano range
  if (frequency <= 0 || 
      frequency < LOWEST_PIANO_FREQ || 
      frequency > HIGHEST_PIANO_FREQ ||
      (abs(frequency - BACKGROUND_FREQ_THRESHOLD) < BACKGROUND_FREQ_TOLERANCE)) {
    note = "---";
    octave = 0;
    return;
  }
  
  // Apply frequency correction - the Arduino FFT often reports frequencies as multiples
  // This divides the frequency until it fits within the piano range
  double correctedFreq = frequency;
  while (correctedFreq > HIGHEST_PIANO_FREQ) {
    correctedFreq /= 2.0;
  }
  
  // Find closest note by comparing with reference frequencies
  int closestNoteIndex = -1;
  double minDifference = 99999;
  
  // Search through all piano notes to find the closest match
  for (int i = 0; i < 97; i++) {
    double difference = abs(correctedFreq - NOTE_FREQUENCIES[i]);
    double percentDifference = difference / NOTE_FREQUENCIES[i];
    
    // Find closest note by percentage difference (more accurate across octaves)
    if (percentDifference < minDifference) {
      minDifference = percentDifference;
      closestNoteIndex = i;
    }
  }
  
  // If we found a close match and it's within 10% of a known frequency
  if (closestNoteIndex >= 0 && minDifference < 0.1) {
    // Calculate octave and note - correct indexing for piano octave notation
    octave = closestNoteIndex / 12; // Piano octave numbering starts at 0
    int noteIndex = closestNoteIndex % 12;
    note = noteNames[noteIndex];
    
    // Debug output for verification
    Serial.print("Raw freq: ");
    Serial.print(frequency);
    Serial.print(" Hz, Corrected: ");
    Serial.print(correctedFreq);
    Serial.print(" Hz -> ");
    Serial.print(note);
    Serial.print(octave);
    Serial.print(" (");
    Serial.print(NOTE_FREQUENCIES[closestNoteIndex]);
    Serial.print(" Hz, diff: ");
    Serial.print(minDifference * 100);
    Serial.println("%)");
  } else {
    note = "---";
    octave = 0;
    Serial.print("No matching note for frequency: ");
    Serial.print(frequency);
    Serial.print(" (corrected: ");
    Serial.print(correctedFreq);
    Serial.println(")");
  }
}

// Perform FFT and find dominant frequency - updated to improve accuracy
double calculateDominantFrequency() {
  // Clear imaginary part
  for (int i = 0; i < SAMPLES; i++) {
    vImag[i] = 0;
  }
  
  // Timing variables to measure actual sampling frequency
  unsigned long startTime = micros();
  
  // Sample the audio input with proper calibration
  for (int i = 0; i < SAMPLES; i++) {
    microseconds = micros();
    
    // Read from the ADC, apply offset and scaling
    int rawValue = analogRead(micPin);
    // Center the signal around 0 using the DC offset
    vReal[i] = (rawValue - MIC_DC_OFFSET) * MIC_SCALE_FACTOR;
    
    // Wait for the sampling period
    while (micros() < microseconds + sampling_period_us) {
      // Do nothing - wait
    }
  }
  
  // Calculate actual sampling frequency
  unsigned long totalTime = micros() - startTime;
  double actualSamplingFreq = (SAMPLES * 1000000.0) / totalTime;
  
  // Apply Windowing to reduce spectral leakage
  FFT.windowing(FFT_WIN_TYP_HAMMING, FFT_FORWARD);
  
  // Compute FFT
  FFT.compute(FFT_FORWARD);
  
  // Convert from complex to magnitude
  FFT.complexToMagnitude();
  
  // Find the peak magnitude and its index, avoiding very low frequencies
  double peakValue = 0;
  uint16_t peakIndex = 0;
  
  // Skip the first few bins which often contain DC and very low frequency noise
  // Look for peaks starting from bin 3 (helps avoid low frequency noise)
  for (int i = 3; i < SAMPLES/2; i++) {
    if (vReal[i] > peakValue) {
      peakValue = vReal[i];
      peakIndex = i;
    }
  }
  
  // Calculate frequency using the formula with actual sampling frequency
  double peakFreq = peakIndex * (actualSamplingFreq / SAMPLES);
  
  // Debug info about the FFT calculation
  if (peakValue > MIC_MIN_THRESHOLD) {
    Serial.print("FFT Peak: bin ");
    Serial.print(peakIndex);
    Serial.print(", value ");
    Serial.print(peakValue);
    Serial.print(", actual sampling rate: ");
    Serial.print(actualSamplingFreq);
    Serial.print(" Hz, calculated frequency: ");
    Serial.print(peakFreq);
    Serial.println(" Hz");
  }
  
  // Only return frequency if it's significant and not background noise
  // Added volume threshold check of 150 (MIC_MIN_THRESHOLD)
  if (peakValue > MIC_MIN_THRESHOLD) {
    return peakFreq; // Return the frequency for note determination
  }
  
  return 0;
}

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

  // Calculate the sampling period
  sampling_period_us = round(1000000 * (1.0 / SAMPLING_FREQUENCY));

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

// smoothing out the mic readings here with proper calibration
int getSmoothedMicValue() {
  // Read with proper calibration
  int rawMicValue = analogRead(micPin);
  int calibratedValue = abs(rawMicValue - MIC_DC_OFFSET);
  
  // Apply the smoothing
  total -= readings[bufferIndex]; 
  readings[bufferIndex] = calibratedValue;  
  total += calibratedValue;  
  bufferIndex = (bufferIndex + 1) % sampleSize;  
  
  return total / sampleSize;
}

// Function to update the display based on current state
void updateDisplay(DisplayState state, int micValue) {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  
  switch(state) {
    case STATE_PLAYING:
      {
        // Header
        display.setTextSize(1);
        display.setCursor(0, 0);
        display.println("Playing:");
        
        // Note name in large text
        display.setTextSize(2);
        display.setCursor(0, 10);
        display.print(currentNote);
        display.print(currentOctave);
        
        // Frequency in smaller text
        display.setTextSize(1);
        display.setCursor(70, 16);
        display.print(int(dominantFrequency));
        display.print(" Hz");
      }
      break;
      
    case STATE_LISTENING:
      {
        display.setTextSize(1);
        display.setCursor(0, 0);
        display.println("Listening...");
        
        // Show volume level
        display.setCursor(0, 12);
        display.print("Volume: ");
        
        // Simple volume bar
        int barLength = map(constrain(micValue, 300, 600), 300, 600, 0, 40);
        for (int i = 0; i < barLength; i++) {
          display.fillRect(40 + i, 12, 1, 8, SSD1306_WHITE);
        }
        
        // Last frequency if available
        if (dominantFrequency > 0) {
          display.setCursor(0, 24);
          display.print("Last: ");
          display.print(int(dominantFrequency));
          display.print(" Hz");
        }
      }
      break;
      
    case STATE_READY:
      {
        display.setTextSize(1);
        display.setCursor(0, 0);
        display.println("Ready to play!");
        
        // Animated prompt
        long animTime = millis() % 2000;
        if (animTime < 1000) {
          display.setCursor(0, 16);
          display.println("Please sit down");
        }
      }
      break;
      
    case STATE_OFF:
    default:
      // Display is off, nothing to draw
      break;
  }
  
  display.display();
  currentDisplayState = state;
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

  // detect microphone playing using calibrated values
  int smoothedMicValue = getSmoothedMicValue();
  // Only consider playing if volume is above threshold AND person is close enough
  isPlaying = (smoothedMicValue > MIC_MIN_THRESHOLD && sensorValSmoothed < DISTANCE_THRESHOLD);

  // Determine the display state
  DisplayState newDisplayState;
  
  if (!personDetected && millis() - lastPersonTime > oledTimeout) {
    newDisplayState = STATE_OFF;
  } else if (!personDetected) {
    newDisplayState = STATE_READY;
  } else if (isPlaying && dominantFrequency > 0) {
    newDisplayState = STATE_PLAYING;
  } else {
    newDisplayState = STATE_LISTENING;
  }
  
  // Calculate FFT and detect pitch if playing or every 2 seconds
  // Only process FFT if volume is above threshold AND person is close enough
  if ((smoothedMicValue > MIC_MIN_THRESHOLD && sensorValSmoothed < DISTANCE_THRESHOLD) || 
      (millis() - lastFFTTime > 2000 && personDetected)) {
    lastFFTTime = millis();
    
    // Only proceed with frequency calculation if volume is high enough AND person is close enough
    if (smoothedMicValue > MIC_MIN_THRESHOLD && sensorValSmoothed < DISTANCE_THRESHOLD) {
      // Calculate dominant frequency using FFT
      double newFrequency = calculateDominantFrequency();
      
      // Only update if we have a valid piano frequency
      if (newFrequency > 0) {
        dominantFrequency = newFrequency; // Update the global frequency variable
        frequencyToNote(dominantFrequency, currentNote, currentOctave);
        lastNoteTime = millis(); // Reset silence timer when a note is detected
        
        // Debug output
        Serial.print("Distance: ");
        Serial.print(sensorValSmoothed);
        Serial.print("mm, Volume: ");
        Serial.print(smoothedMicValue);
        Serial.print(", Frequency: ");
        Serial.print(dominantFrequency);
        Serial.print(" Hz, Note: ");
        Serial.print(currentNote);
        Serial.println(currentOctave);
        
        // Immediately update the display if playing
        if (isPlaying) {
          updateDisplay(STATE_PLAYING, smoothedMicValue);
          lastSoundTime = millis();
        }
      }
    }
  }

  // Check if we should reset the note state due to silence
  if (dominantFrequency > 0 && !isPlaying && millis() - lastNoteTime > silenceTimeout) {
    // Reset note state after silence timeout
    dominantFrequency = 0;
    currentNote = "";
    currentOctave = 0;
    Serial.println("Note state reset due to silence");
    
    // Update display to reflect reset
    if (personDetected) {
      updateDisplay(STATE_LISTENING, smoothedMicValue);
    }
  }

  // Update the display if state changes or periodically for animations
  bool updateNeeded = (currentDisplayState != newDisplayState);
  
  // Always update READY state for animation
  if (newDisplayState == STATE_READY && (millis() % 1000) < 50) {
    updateNeeded = true;
  }
  
  // Update LISTENING state periodically to show volume changes
  if (newDisplayState == STATE_LISTENING && millis() - lastSoundTime > 500) {
    updateNeeded = true;
    lastSoundTime = millis();
  }
  
  // Update the display's volume bar with properly scaled values
  if (updateNeeded) {
    updateDisplay(newDisplayState, smoothedMicValue);
  }

  // continue sending MQTT if the person is still sitting there
  if (personDetected && millis() - lastTimeSent > interval) {
    lastTimeSent = millis();
      
    // send message MQTT with pitch information
    String message = "distance: " + String(sensorValSmoothed) + 
                     " volume: " + String(smoothedMicValue);
    
    // Add frequency and note information if available
    if (dominantFrequency > 0) {
      message += " frequency: " + String(int(dominantFrequency));
      
      if (currentNote != "" && currentNote != "---") {
        message += " note: " + currentNote + 
                  " octave: " + String(currentOctave);
      }
    }
    
    mqttClient.beginMessage(topic);
    mqttClient.print(message);
    mqttClient.endMessage();
    Serial.println("Published: " + message);
  }

  // wait 10s then turn off the oled if the person has left to conserve energy
  if (!personDetected && millis() - lastPersonTime > oledTimeout) { 
    display.clearDisplay();
    display.display();
  }

  delay(10); // Reduced delay for better sampling
}