Hand Gesture Music
A web app that turns hand gestures into chords in real time. It uses your webcam and MediaPipe Hands to count extended fingers, then plays the chord with the Web Audio API.
How it works
Left hand picks the root note by finger count: 1 = C, 2 = D, 3 = E, 4 = F, 5 = G
Right hand picks the chord quality: 1 = major, 2 = minor, 3 = diminished, 4 = sus4, 5 = dominant 7
One hand alone plays a plain major chord on that root. No hands means silence.
The Key dropdown transposes every root.
Tech
JavaScript, HTML, CSS
MediaPipe Hands (hand landmark detection)
Web Audio API (oscillators, filter, gain envelopes)
Run locally
Camera access needs `localhost` or HTTPS, so don't just double-click the file.
```bash
python -m http.server 8000
```
Then open http://localhost:8000 and allow camera access.
Project structure
```
index.html   page structure
style.css    styling
script.js    hand tracking, chord logic, audio
```
