// ============================================================
// src/game/audio.js
// SOUND, made with the Web Audio API (no sound files needed).
//
//   engine hum   pitch follows speed
//   road wind    louder with speed
//   radio        a slow minor-key pad (music), or hiss (static / off-station)
//   heartbeat    starts when your fear is high, faster as it rises
//   chase rumble the headlights behind you, louder as they get closer
//   stings       short scary noises (called from GameScreen when events fire)
//
// Browsers only allow sound after a click or key press, so audio.start() is
// called from the first key press / button click. M mutes.
// ============================================================
let ac = null;
let master = null;
let muted = false;
const n = {}; // the audio nodes we keep adjusting
let heartTimer = 0;
let lastTime = 0;

function noiseBuffer(ctx) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function gainNode(ctx, value = 0) {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

function start() {
  try {
    if (ac) {
      if (ac.state === "suspended") ac.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    ac = new Ctx();
    master = gainNode(ac, muted ? 0 : 0.55);
    master.connect(ac.destination);

    const noise = noiseBuffer(ac);
    const loopNoise = () => {
      const src = ac.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      src.start();
      return src;
    };

    // engine
    n.engineOsc = ac.createOscillator();
    n.engineOsc.type = "sawtooth";
    n.engineOsc.frequency.value = 40;
    const engineLP = ac.createBiquadFilter();
    engineLP.type = "lowpass";
    engineLP.frequency.value = 220;
    n.engineGain = gainNode(ac, 0);
    n.engineOsc.connect(engineLP).connect(n.engineGain).connect(master);
    n.engineOsc.start();

    // wind
    const windLP = ac.createBiquadFilter();
    windLP.type = "lowpass";
    windLP.frequency.value = 500;
    n.windGain = gainNode(ac, 0);
    loopNoise().connect(windLP).connect(n.windGain).connect(master);

    // static
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2400;
    bp.Q.value = 0.6;
    n.staticGain = gainNode(ac, 0);
    loopNoise().connect(bp).connect(n.staticGain).connect(master);

    // music pad: two slightly detuned minor-third notes with a slow wobble
    n.padGain = gainNode(ac, 0);
    const padLP = ac.createBiquadFilter();
    padLP.type = "lowpass";
    padLP.frequency.value = 700;
    for (const [freq, det] of [[110, 0], [130.8, 6], [164.8, -5], [55, 3]]) {
      const o = ac.createOscillator();
      o.type = "triangle";
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(padLP);
      o.start();
    }
    padLP.connect(n.padGain).connect(master);
    const lfo = ac.createOscillator();
    lfo.frequency.value = 0.15;
    const lfoGain = gainNode(ac, 0.02);
    lfo.connect(lfoGain).connect(n.padGain.gain);
    lfo.start();

    // chase rumble
    n.chaseOsc = ac.createOscillator();
    n.chaseOsc.type = "square";
    n.chaseOsc.frequency.value = 38;
    const chaseLP = ac.createBiquadFilter();
    chaseLP.type = "lowpass";
    chaseLP.frequency.value = 120;
    n.chaseGain = gainNode(ac, 0);
    n.chaseOsc.connect(chaseLP).connect(n.chaseGain).connect(master);
    n.chaseOsc.start();

    n.noise = noise;
  } catch {
    ac = null; // sound is optional: the game works without it
  }
}

const ramp = (param, value, time = 0.12) => param.setTargetAtTime(value, ac.currentTime, time);

function thump() {
  const o = ac.createOscillator();
  const g = gainNode(ac, 0);
  o.type = "sine";
  o.frequency.setValueAtTime(70, ac.currentTime);
  o.frequency.exponentialRampToValueAtTime(38, ac.currentTime + 0.16);
  g.gain.setValueAtTime(0, ac.currentTime);
  g.gain.linearRampToValueAtTime(0.7, ac.currentTime + 0.015);
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.2);
  o.connect(g).connect(master);
  o.start();
  o.stop(ac.currentTime + 0.25);
}

// Called every frame by DrivingCanvas.
function update(s) {
  if (!ac || ac.state !== "running") return;
  try {
    const now = ac.currentTime;
    const dt = Math.min(0.1, now - lastTime);
    lastTime = now;
    const speedRatio = Math.min(1, s.speed / 100);

    ramp(n.engineGain.gain, s.engineOn ? 0.05 + speedRatio * 0.05 : 0);
    ramp(n.engineOsc.frequency, 38 + speedRatio * 70);
    ramp(n.windGain.gain, speedRatio * 0.12);

    const mode = Math.abs(s.radioFreq - 93.5) < 0.05 ? s.radio : Math.abs(s.radioFreq - 91.7) < 0.15 ? "voice" : "static";
    const radioOn = s.engineOn;
    ramp(n.padGain.gain, radioOn && mode === "music" ? 0.05 : 0, 0.3);
    const hiss = !radioOn ? 0 : mode === "static" ? 0.07 : mode === "strange" || mode === "voice" ? 0.1 : 0;
    ramp(n.staticGain.gain, Math.min(0.25, hiss + s.glitch * 0.025), 0.05);

    const chase = s.chaserActive ? Math.max(0, 1 - s.chaserGap / 200) : 0;
    ramp(n.chaseGain.gain, chase * 0.12, 0.2);
    ramp(n.chaseOsc.frequency, 34 + chase * 30);

    // heartbeat when you are afraid
    if (s.dread > 45) {
      heartTimer += dt;
      const period = 60 / (55 + s.dread * 0.9);
      if (heartTimer > period) {
        heartTimer = 0;
        thump();
        setTimeout(() => ac && thump(), 160);
      }
    }
  } catch {
    /* ignore */
  }
}

// A short scary noise. strength 1 = small, 3 = big.
function sting(strength = 1) {
  if (!ac || ac.state !== "running") return;
  try {
    const t = ac.currentTime;
    const src = ac.createBufferSource();
    src.buffer = n.noise;
    const hp = ac.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1200;
    const g = gainNode(ac, 0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.18 * strength, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    src.connect(hp).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.6);

    const o = ac.createOscillator();
    const og = gainNode(ac, 0);
    o.type = "sawtooth";
    o.frequency.setValueAtTime(520 * (0.8 + strength * 0.2), t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.9);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.linearRampToValueAtTime(0.08 * strength, t + 0.03);
    og.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
    o.connect(og).connect(master);
    o.start(t);
    o.stop(t + 1.1);
  } catch {
    /* ignore */
  }
}

function toggleMute() {
  muted = !muted;
  if (ac && master) master.gain.value = muted ? 0 : 0.55;
  return muted;
}

export const audio = { start, update, sting, toggleMute };
