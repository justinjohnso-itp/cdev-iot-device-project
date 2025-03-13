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
const long oledTimeout = 10000;  // oled timeout

// Add distance threshold constants
const int DISTANCE_MIN_THRESHOLD = 75;  // Minimum distance threshold (75mm)
const int DISTANCE_MAX_THRESHOLD = 400; // Maximum distance threshold (400mm)

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

// Replace the current DisplayState enum with this clearer PianoState
enum PianoState {
  STATE_NO_PRESENCE,    // No one at piano
  STATE_PRESENCE_ONLY,  // Someone at piano but not playing
  STATE_PLAYING         // Someone at piano and playing
};

PianoState currentState = STATE_NO_PRESENCE;

// Microphone calibration constants for MAX9814 AGC Electret Microphone
const int MIC_DC_OFFSET = 512;  // Microphone DC offset (for a 10-bit ADC, 0-1023 range)
const int MIC_NOISE_FLOOR = 25; // Noise floor level to filter out background noise
const int MIC_MIN_THRESHOLD = 130;  // Adjusted to 150 (was 40)
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

// Add these variables near other timing variables at the top
unsigned long lastDisplayUpdateTime = 0;  // Last time display was updated
const long DISPLAY_UPDATE_INTERVAL = 250; // Minimum 250ms between display updates
String lastDisplayedNote = "";   // Track the last displayed note
int lastDisplayedOctave = 0;     // Track the last displayed octave
double lastDisplayedFrequency = 0.0; // Last displayed frequency

// Function prototypes - must be before they're used
void frequencyToNote(float frequency, String &note, int &octave);
double calculateDominantFrequency();
void connectToNetwork();
boolean connectToBroker();
int getSmoothedMicValue();
void calculateAndProcessAudio(int distance, int volume);
bool needsDisplayUpdate(PianoState state, int micValue);
void updateDisplay(PianoState state, int micValue);
void handleState(PianoState state, bool personDetected, bool isPlaying, int distance, int volume);

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
    // Serial.print("Raw freq: ");
    // Serial.print(frequency);
    // Serial.print(" Hz, Corrected: ");
    // Serial.print(correctedFreq);
    // Serial.print(" Hz -> ");
    // Serial.print(note);
    // Serial.print(octave);
    // Serial.print(" (");
    // Serial.print(NOTE_FREQUENCIES[closestNoteIndex]);
    // Serial.print(" Hz, diff: ");
    // Serial.print(minDifference * 100);
    // Serial.println("%)");
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
  // if (peakValue > MIC_MIN_THRESHOLD) {
  //   Serial.print("FFT Peak: bin ");
  //   Serial.print(peakIndex);
  //   Serial.print(", value ");
  //   Serial.print(peakValue);
  //   Serial.print(", actual sampling rate: ");
  //   Serial.print(actualSamplingFreq);
  //   Serial.print(" Hz, calculated frequency: ");
  //   Serial.print(peakFreq);
  //   Serial.println(" Hz");
  // }
  
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

void loop() {
  // Check network connections
  if (WiFi.status() != WL_CONNECTED) {
    connectToNetwork();
    return;
  }
  if (!mqttClient.connected()) {
    connectToBroker();
  }
  mqttClient.poll();

  // Read and smooth sensor values
  int sensorVal = sensor.readRangeContinuousMillimeters();
  int sensorValSmoothed = lastSensorVal * 0.9 + sensorVal * 0.1;
  lastSensorVal = sensorValSmoothed;
  
  // Detect presence - person is in valid distance range
  bool personDetected = (sensorValSmoothed >= DISTANCE_MIN_THRESHOLD && 
                         sensorValSmoothed <= DISTANCE_MAX_THRESHOLD);
  
  // Get microphone value
  int smoothedMicValue = getSmoothedMicValue();
  
  // Detect if playing - needs both presence AND volume above threshold
  bool isPlaying = personDetected && (smoothedMicValue > MIC_MIN_THRESHOLD);

  // Determine current state
  PianoState newState;
  if (!personDetected) {
    newState = STATE_NO_PRESENCE;
  } else if (!isPlaying) {
    newState = STATE_PRESENCE_ONLY;
  } else {
    newState = STATE_PLAYING;
  }

  // Handle state transition or continued state
  handleState(newState, personDetected, isPlaying, sensorValSmoothed, smoothedMicValue);
  
  // Update display if needed
  // If state has changed, always update the display
  if (currentState != newState) {
    updateDisplay(newState, smoothedMicValue);
    currentState = newState;
  } 
  // Otherwise only update if the current state needs it
  else if (needsDisplayUpdate(newState, smoothedMicValue)) {
    updateDisplay(newState, smoothedMicValue);
  }
  
  // Power saving: turn off display after timeout period of no presence
  if (newState == STATE_NO_PRESENCE && 
      millis() - lastPersonTime > oledTimeout) {
    display.clearDisplay();
    display.display();
  }

  delay(10);
}

void handleState(PianoState state, bool personDetected, bool isPlaying, 
                int distance, int volume) {
  
  // Update timing variables
  if (personDetected) {
    lastPersonTime = millis();
  }
  
  // Execute state-specific logic
  switch (state) {
    case STATE_NO_PRESENCE:
      // No presence - nothing to do
      // When appropriate, send a message indicating no presence
      if ((unsigned long)(millis() - lastTimeSent) > (unsigned long)interval) {
        lastTimeSent = millis();
        
        // Create JSON formatted string with all fields - null for audio data, false for presence
        String jsonMessage = "{";
        jsonMessage += "\"distance\":" + String(distance) + ",";
        jsonMessage += "\"volume\":" + String(volume) + ",";
        jsonMessage += "\"frequency\":null,";
        jsonMessage += "\"note\":null,";
        jsonMessage += "\"octave\":null,";
        jsonMessage += "\"presence\":false,";
        jsonMessage += "\"playing\":false";
        jsonMessage += "}";
        
        mqttClient.beginMessage(topic);
        mqttClient.print(jsonMessage);
        mqttClient.endMessage();
        Serial.println("Published no presence: " + jsonMessage);
      }
      break;
      
    case STATE_PRESENCE_ONLY:
      // Person present but not playing
      // Send presence data every interval
      if ((unsigned long)(millis() - lastTimeSent) > (unsigned long)interval) {
        lastTimeSent = millis();
        
        // Create JSON formatted string - include all fields, null for audio data
        String jsonMessage = "{";
        jsonMessage += "\"distance\":" + String(distance) + ",";
        jsonMessage += "\"volume\":" + String(volume) + ",";
        jsonMessage += "\"frequency\":null,";
        jsonMessage += "\"note\":null,";
        jsonMessage += "\"octave\":null,";
        jsonMessage += "\"presence\":true,";
        jsonMessage += "\"playing\":false";
        jsonMessage += "}";
        
        mqttClient.beginMessage(topic);
        mqttClient.print(jsonMessage);
        mqttClient.endMessage();
        Serial.println("Published presence: " + jsonMessage);
      }
      break;
      
    case STATE_PLAYING:
      // Person present and playing - calculate frequency and send data
      calculateAndProcessAudio(distance, volume);
      break;
  }
}

void calculateAndProcessAudio(int distance, int volume) {
  // Only calculate frequency if we're actively playing
  double newFrequency = calculateDominantFrequency();
  
  if (newFrequency > 0) {
    dominantFrequency = newFrequency;
    frequencyToNote(dominantFrequency, currentNote, currentOctave);
    lastNoteTime = millis();
    
    // Send MQTT message with all the data we have
    if ((unsigned long)(millis() - lastTimeSent) > (unsigned long)interval) {
      lastTimeSent = millis();
      
      // Create JSON formatted string - include all fields
      String jsonMessage = "{";
      jsonMessage += "\"distance\":" + String(distance) + ",";
      jsonMessage += "\"volume\":" + String(volume) + ",";
      
      // Include note and frequency data - always include fields
      jsonMessage += "\"frequency\":" + String(int(dominantFrequency)) + ",";
      
      // Check if we have valid note data
      if (currentNote != "" && currentNote != "---") {
        jsonMessage += "\"note\":\"" + currentNote + "\",";
        jsonMessage += "\"octave\":" + String(currentOctave) + ",";
      } else {
        jsonMessage += "\"note\":null,";
        jsonMessage += "\"octave\":null,";
      }
      
      jsonMessage += "\"presence\":true,";
      jsonMessage += "\"playing\":true";
      jsonMessage += "}";
      
      mqttClient.beginMessage(topic);
      mqttClient.print(jsonMessage);
      mqttClient.endMessage();
      Serial.println("Published playing: " + jsonMessage);
    }
  }
}

bool needsDisplayUpdate(PianoState state, int micValue) {
  // Always enforce minimum time between any display updates
  if (millis() - lastDisplayUpdateTime < DISPLAY_UPDATE_INTERVAL) {
    return false; // Too soon for another update
  }
  
  // Check if we need to update display based on current state
  switch(state) {
    case STATE_NO_PRESENCE:
      // Only update once when transitioning to this state
      // The display will show static "Ready" message until timeout
      return false; // No periodic updates for this state
    
    case STATE_PRESENCE_ONLY:
      // Update volume bar every 500ms
      return ((unsigned long)(millis() - lastSoundTime) > 500UL);
    
    case STATE_PLAYING:
      // Only update when the note or frequency changes significantly
      if (currentNote != lastDisplayedNote || 
          currentOctave != lastDisplayedOctave ||
          abs(dominantFrequency - lastDisplayedFrequency) > 2.0) {
        return true;
      }
      // Otherwise update periodically but not too often
      return ((millis() - lastDisplayUpdateTime) > 750);
  }
  return false;
}

void updateDisplay(PianoState state, int micValue) {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  
  // Variable declarations outside of case statements to avoid jump errors
  int barLength = 0;
  
  switch(state) {
    case STATE_NO_PRESENCE:
      // "Ready" display
      display.setTextSize(1);
      display.setCursor(0, 0);
      display.println("Ready to play!");
      display.setCursor(0, 16);
      display.println("Please sit down");
      break;
      
    case STATE_PRESENCE_ONLY:
      // "Listening" display
      display.setTextSize(1);
      display.setCursor(0, 0);
      display.println("Listening...");
      
      // Simple volume bar
      display.setCursor(0, 12);
      display.print("Volume: ");
      barLength = map(constrain(micValue, 0, MIC_MAX_AMPLITUDE), 
                      0, MIC_MAX_AMPLITUDE, 0, 40);
      for (int i = 0; i < barLength; i++) {
        display.fillRect(40 + i, 12, 1, 8, SSD1306_WHITE);
      }
      break;
      
    case STATE_PLAYING:
      // "Playing" display with note information
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
      
      // Save what we displayed for comparison later
      lastDisplayedNote = currentNote;
      lastDisplayedOctave = currentOctave;
      lastDisplayedFrequency = dominantFrequency;
      break;
  }
  
  display.display();
  lastSoundTime = millis();
  lastDisplayUpdateTime = millis(); // Track when we updated the display
}