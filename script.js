const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const startBtn = document.getElementById('startBtn');
const mirrorBtn = document.getElementById('mirrorBtn');
const keySelect = document.getElementById('keySelect');
const overlayMsg = document.getElementById('overlayMsg');
const rootValueEl = document.getElementById('rootValue');
const qualityValueEl = document.getElementById('qualityValue');
const chordNameEl = document.getElementById('chordName');

// ---------- note math: compute any frequency, no manual table needed ----------
const NOTE_INDEX = { C:0, 'C#':1, D:2, 'D#':3, E:4, F:5, 'F#':6, G:7, 'G#':8, A:9, 'A#':10, B:11 };
function noteToFreq(name, octave) {
  const semitonesFromC0 = NOTE_INDEX[name] + octave * 12;
  const semitonesFromA4 = semitonesFromC0 - (NOTE_INDEX['A'] + 4 * 12);
  return 440 * Math.pow(2, semitonesFromA4 / 12);
}
function chordFreqs(rootFreq, intervals) {
  return intervals.map(iv => rootFreq * Math.pow(2, iv / 12));
}

// root note names by left-hand finger count (base octave 4), before key transposition
const ROOT_BY_COUNT = { 1: ['C',4], 2: ['D',4], 3: ['E',4], 4: ['F',4], 5: ['G',4] };

// chord quality by right-hand finger count, as semitone intervals from the root
const QUALITY_BY_COUNT = {
  1: { name: 'major', intervals: [0, 4, 7] },
  2: { name: 'minor', intervals: [0, 3, 7] },
  3: { name: 'diminished', intervals: [0, 3, 6] },
  4: { name: 'sus4', intervals: [0, 5, 7] },
  5: { name: 'dominant7', intervals: [0, 4, 7, 10] },
};

let keyOffset = 0; // semitones added to every root, set by the Key dropdown
keySelect.addEventListener('change', () => {
  keyOffset = parseInt(keySelect.value, 10);
  // re-render/re-play using whatever hand shape is currently showing,
  // even though (rootCount, qualityCount) itself hasn't changed
  updateChord(currentRootCount, currentQualityCount, true);
});

function rootNoteInfo(count) {
  const [name, octave] = ROOT_BY_COUNT[count];
  const baseSemitone = NOTE_INDEX[name] + octave * 12 + keyOffset;
  const wrappedName = Object.keys(NOTE_INDEX).find(k => NOTE_INDEX[k] === (((baseSemitone % 12) + 12) % 12));
  const wrappedOctave = Math.floor(baseSemitone / 12);
  return { name: wrappedName, octave: wrappedOctave, freq: noteToFreq(wrappedName, wrappedOctave) };
}

// ---------- audio ----------
let audioCtx = null;
let activeVoices = [];

function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function stopChord() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  activeVoices.forEach(v => {
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setValueAtTime(v.gain.gain.value, now);
    v.gain.gain.linearRampToValueAtTime(0, now + 0.12);
    v.osc.stop(now + 0.14);
  });
  activeVoices = [];
}

function playFreqs(freqs) {
  stopChord();
  const now = audioCtx.currentTime;
  freqs.forEach(f => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = f;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1400;

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.05);

    osc.connect(filter).connect(gain).connect(audioCtx.destination);
    osc.start(now);
    activeVoices.push({ osc, gain });
  });
}

// ---------- state machine: turn (rootCount, qualityCount) into sound ----------
let lastRootCount = null;
let lastQualityCount = null; // null = only one hand / no quality hand present
let currentRootCount = null;
let currentQualityCount = null;

function updateChord(rootCount, qualityCount, force) {
  if (!force && rootCount === lastRootCount && qualityCount === lastQualityCount) return;
  lastRootCount = rootCount;
  lastQualityCount = qualityCount;

  if (!rootCount) {
    rootValueEl.textContent = '–';
    rootValueEl.classList.remove('active');
    qualityValueEl.textContent = '–';
    qualityValueEl.classList.remove('active');
    chordNameEl.textContent = '–';
    chordNameEl.classList.remove('active');
    stopChord();
    return;
  }

  const quality = qualityCount ? QUALITY_BY_COUNT[qualityCount] : QUALITY_BY_COUNT[1]; // default to major
  const root = rootNoteInfo(rootCount); // transposed by the current key
  const freqs = chordFreqs(root.freq, quality.intervals);

  rootValueEl.textContent = root.name;
  rootValueEl.classList.add('active');
  qualityValueEl.textContent = qualityCount ? quality.name : '(major, default)';
  qualityValueEl.classList.toggle('active', !!qualityCount);
  chordNameEl.textContent = `${root.name} ${quality.name}`;
  chordNameEl.classList.add('active');

  playFreqs(freqs);
}

// ---------- hand tracking ----------
function countExtendedFingers(landmarks, handednessLabel) {
  let count = 0;
  const thumbExtended = handednessLabel === 'Right'
    ? landmarks[4].x < landmarks[3].x
    : landmarks[4].x > landmarks[3].x;
  if (thumbExtended) count++;

  const pairs = [[8,6],[12,10],[16,14],[20,18]];
  for (const [tip, pip] of pairs) {
    if (landmarks[tip].y < landmarks[pip].y) count++;
  }
  return count;
}

const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});
hands.setOptions({
  maxNumHands: 2,
  modelComplexity: 1,
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.6
});

// debounce: require a stable (rootCount, qualityCount) pair before triggering
let stablePair = null;
let stableFrames = 0;
const DEBOUNCE_FRAMES = 4;

hands.onResults((results) => {
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

  let rootCount = null;
  let qualityCount = null;

  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    results.multiHandLandmarks.forEach((landmarks, i) => {
      const handedness = results.multiHandedness[i].label; // 'Left' or 'Right' as reported by the model
      const count = countExtendedFingers(landmarks, handedness);

      drawConnectors(ctx, landmarks, HAND_CONNECTIONS, {
        color: handedness === 'Left' ? '#f2a65a' : '#7fb8e0',
        lineWidth: 3
      });
      drawLandmarks(ctx, landmarks, { color: '#e8e6e1', radius: 3 });

      if (handedness === 'Left') rootCount = count;
      else qualityCount = count;
    });
  }

  currentRootCount = rootCount;
  currentQualityCount = qualityCount;

  const pairKey = rootCount + ':' + qualityCount;
  if (pairKey === stablePair) {
    stableFrames++;
  } else {
    stablePair = pairKey;
    stableFrames = 0;
  }
  if (stableFrames === DEBOUNCE_FRAMES) {
    updateChord(rootCount, qualityCount);
  }

  ctx.restore();
});

let camera = null;
let mirrored = false;

mirrorBtn.addEventListener('click', () => {
  mirrored = !mirrored;
  canvas.style.transform = mirrored ? 'scaleX(-1)' : 'none';
  mirrorBtn.textContent = mirrored ? 'Mirror: on' : 'Mirror: off';
});

startBtn.addEventListener('click', async () => {
  ensureAudio();
  if (audioCtx.state === 'suspended') await audioCtx.resume();

  startBtn.disabled = true;
  startBtn.textContent = 'starting…';
  overlayMsg.style.display = 'none';

  try {
    camera = new Camera(video, {
      onFrame: async () => { await hands.send({ image: video }); },
      width: 640,
      height: 480
    });
    await camera.start();
    startBtn.textContent = 'camera running';
  } catch (err) {
    overlayMsg.style.display = 'flex';
    overlayMsg.textContent = 'camera access failed — check permissions and reload';
    startBtn.disabled = false;
    startBtn.textContent = 'Start camera';
  }
});
