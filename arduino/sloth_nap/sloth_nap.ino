// Sloth Nap button for an Arduino UNO Q.
// Hold the button to start a nap. The LED breathes while the host agent works.
// The host reads and writes one JSON object per line at 115200 baud.

const int buttonPin = 2;
const int ledPin = LED_BUILTIN;

bool napping = false;
unsigned long lastBreath = 0;

void setup() {
  pinMode(buttonPin, INPUT_PULLUP);
  pinMode(ledPin, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  bool pressed = digitalRead(buttonPin) == LOW;
  if (pressed && !napping) {
    napping = true;
    Serial.println("{\"event\":\"button\",\"nap\":true}");
  }

  if (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    if (line.indexOf("\"phase\":\"done\"") >= 0) {
      napping = false;
      digitalWrite(ledPin, LOW);
    }
  }

  if (napping) {
    unsigned long now = millis();
    float breath = (sin((now - lastBreath) / 600.0) + 1.0) / 2.0;
    analogWrite(ledPin, (int)(breath * 180));
  }
}
