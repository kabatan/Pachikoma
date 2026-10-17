// Pachikoma cabinet controller for ESP32 DevKit / WROOM-32.
// Microswitches: GPIO25 = FIRE, GPIO26 = CHALLENGE, each NO contact to GND.
// Optional LED driver inputs: GPIO27 = FIRE, GPIO14 = CHALLENGE (active HIGH).
// With switches only, leave GPIO27/GPIO14 and both LED terminals unconnected.
// Lighting the 12 V LEDs later requires their own 12 V supply and MOSFET drivers.

#include <Arduino.h>
#include <string.h>

constexpr uint8_t FIRE_BUTTON = 25;
constexpr uint8_t CHALLENGE_BUTTON = 26;
constexpr uint8_t FIRE_LED = 27;
constexpr uint8_t CHALLENGE_LED = 14;
constexpr unsigned long DEBOUNCE_MS = 30;
constexpr unsigned long LED_LINK_TIMEOUT_MS = 2500;

struct Button {
  uint8_t pin;
  const char* name;
  bool raw;
  bool stable;
  unsigned long changedAt;
};

Button buttons[] = {
  {FIRE_BUTTON, "FIRE", HIGH, HIGH, 0},
  {CHALLENGE_BUTTON, "CHALLENGE", HIGH, HIGH, 0},
};

char line[32];
uint8_t lineLength = 0;
unsigned long lastLedCommand = 0;
bool ledsEnabled = false;

void setLeds(bool fire, bool challenge) {
  digitalWrite(FIRE_LED, fire ? HIGH : LOW);
  digitalWrite(CHALLENGE_LED, challenge ? HIGH : LOW);
}

void command(const char* text) {
  if (strcmp(text, "PING") == 0) {
    Serial.println("PACHIKOMA,READY,1");
    return;
  }
  if (strncmp(text, "LED,", 4) == 0 && strlen(text) == 7 &&
      (text[4] == '0' || text[4] == '1') && text[5] == ',' &&
      (text[6] == '0' || text[6] == '1')) {
    setLeds(text[4] == '1', text[6] == '1');
    lastLedCommand = millis();
    ledsEnabled = true;
  }
}

void pollSerial() {
  while (Serial.available()) {
    const char c = (char)Serial.read();
    if (c == '\n') {
      line[lineLength] = '\0';
      command(line);
      lineLength = 0;
    } else if (c != '\r') {
      if (lineLength < sizeof(line) - 1) line[lineLength++] = c;
      else lineLength = 0;  // Discard an overlong or corrupt command.
    }
  }
}

void pollButton(Button& button, unsigned long now) {
  const bool reading = digitalRead(button.pin);
  if (reading != button.raw) {
    button.raw = reading;
    button.changedAt = now;
  }
  if (reading != button.stable && now - button.changedAt >= DEBOUNCE_MS) {
    button.stable = reading;
    if (reading == LOW) {
      Serial.print("BTN,");
      Serial.println(button.name);
    }
  }
}

void setup() {
  pinMode(FIRE_LED, OUTPUT);
  pinMode(CHALLENGE_LED, OUTPUT);
  setLeds(false, false);
  for (Button& button : buttons) {
    pinMode(button.pin, INPUT_PULLUP);
    button.raw = button.stable = digitalRead(button.pin);
    button.changedAt = millis();
  }
  Serial.begin(115200);
  Serial.println("PACHIKOMA,READY,1");
}

void loop() {
  const unsigned long now = millis();
  pollSerial();
  for (Button& button : buttons) pollButton(button, now);
  if (ledsEnabled && now - lastLedCommand > LED_LINK_TIMEOUT_MS) {
    setLeds(false, false);
    ledsEnabled = false;
  }
  delay(1);
}
