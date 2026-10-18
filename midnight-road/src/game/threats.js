// ============================================================
// src/game/threats.js
// THE PRESSURE: things that happen every 0.1 s while you drive.
//
//   dread      your fear. Rises near the headlights, in the dark, when you
//              anger him. At 100 the road keeps you.
//   chaser     headlights behind you. Faster than ~60 km/h pulls away;
//              stopping lets them close in. Reach you 3 times = replaced.
//   encounters the ghost waits for you. Drive past him without stopping and
//              you pay (fear, anger, the headlights get closer).
//   secrets    the radio, the fake STOP sign, the hidden old road.
// ============================================================
import { CONFIG, storyToWorldMetres } from "./driving";
import { STORY, POIS } from "./world";
import {
  say, burst, addDread, addTrust, addHostility, addClue, setFlag, moveChaser,
  caught, endGame, mirror,
} from "./stateTools";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// metres between the car and a place on the road (positive = still ahead)
export function metresTo(state, km) {
  const car = (state.distance / CONFIG.storyKmPerRealKm) * 1000;
  return storyToWorldMetres(km) - car;
}

// ---------------------------------------------------------------- fear
export function tickDread(s, tel) {
  let d = 0;
  if (s.chaser.active && s.chaser.gap < 80) d += 0.06;          // headlights right behind you
  if (s.headlights === "off" && tel.speed > 5) d += 0.03;        // driving blind
  if (s.hostility >= 3) d += 0.015;                               // he is angry
  if (d === 0 && s.chaser.gap > 150 && s.hostility <= 1) d -= 0.04; // calm
  const dread = clamp(s.dread + d, 0, 100);
  let n = { ...s, dread };

  // high fear: the mirror shows his face for a few frames
  if (dread > 70 && Math.random() < 0.012 && n.mirrorState === "normal") {
    n = burst(mirror(n, "ghost_face", 3), 6);
  }
  return n;
}

// ---------------------------------------------------------------- the headlights
export function tickChaser(s, tel) {
  if (!s.chaser.active) return s;
  const dialogue = s.currentEvent?.type === "dialogue";
  if (dialogue) return s; // talking is turn-based: each answer costs distance instead

  const v = tel.speed / 3.6;                  // our speed, m/s
  const chaserSpeed = 15 + 0.8 * s.loopNumber; // its speed, m/s (about 54 km/h and rising)
  let delta = (v - chaserSpeed) * 0.1;         // + we pull away, - it closes in
  if (v < 2) delta = s.currentEvent ? -0.3 : -0.6; // parked: it walks up to us
  const gap = clamp(s.chaser.gap + delta, -5, 260);
  const n = { ...s, chaser: { ...s.chaser, gap } };
  return gap <= 0 ? caught(n) : n;
}

// ---------------------------------------------------------------- meeting the ghost
// Drive past a ghost who wanted you to stop and you pay for it.
function missed(s, poi) {
  let n = addDread(addHostility(addTrust(s, -1), 1), 15);
  n = setFlag(n, "missed", (n.flags.missed || 0) + 1);
  if (poi.id === "ghost_roadside") {
    n = setFlag(n, "missedRoadside", (n.flags.missedRoadside || 0) + 1);
    if (n.strangerChoice === null) n = { ...n, strangerChoice: "ignore" };
  }
  n = moveChaser(n, -40);
  return burst(say(n, "YOU DROVE PAST HIM. HE WAS WAITING FOR YOU.", 45), 12);
}

export function tickEncounters(s, tel) {
  let n = s;
  const L = s.loopNumber;

  for (const poi of POIS) {
    if (!poi.ghost || !poi.mustStop || !poi.when(n)) continue;
    const key = `${L}:${poi.id}`;
    if (n.passed.includes(key) || n.talked.includes(key)) continue;
    if (metresTo(n, poi.km) < -14) {
      n = missed({ ...n, passed: [...n.passed, key] }, poi);
    }
  }

  // sitting beside him without speaking: he comes closer
  const nearGhost = POIS.some((p) => p.ghost && p.when(n) && Math.abs(metresTo(n, p.km)) < 14);
  if (nearGhost && tel.speed === 0 && !n.currentEvent) {
    const idleTicks = n.idleTicks + 1;
    n = { ...n, idleTicks };
    if (idleTicks > 100 && idleTicks % 70 === 0) {
      n = burst(say(addDread(n, 8), idleTicks > 200 ? "HIS FACE IS PRESSED AGAINST THE GLASS." : "SOMETHING KNOCKS ON THE WINDOW.", 40), 7);
    }
  } else if (n.idleTicks !== 0) {
    n = { ...n, idleTicks: 0 };
  }
  return n;
}

// ---------------------------------------------------------------- secrets and traps
export function tickRadio(s) {
  const f = s.radioFreq;
  if (Math.abs(f - 91.7) < 0.15 && s.radio !== "silence" && s.engine !== "off") {
    const tuneTicks = s.tuneTicks + 1;
    let n = { ...s, tuneTicks };
    if (tuneTicks === 25) {
      n = addClue(n, s.loopNumber >= 3 ? "radio_voice2" : "radio_voice");
      n = burst(say(addDread(n, 6), s.loopNumber >= 3 ? "THE VOICE: \"NOT THE OTHER NAME. THE REAL ONE.\"" : "A VOICE IN THE STATIC KEEPS SAYING A NAME.", 50), 6);
    }
    return n;
  }
  return s.tuneTicks ? { ...s, tuneTicks: 0 } : s;
}

export function tickSecrets(s, tel) {
  let n = s;

  // the fake STOP sign: sit there and the headlights come
  if (s.loopNumber >= 1) {
    const d = metresTo(s, STORY.fakeStop);
    const key = `${s.loopNumber}:fakestop`;
    if (tel.speed === 0 && d > -6 && d < 12 && !s.currentEvent) {
      const stopTicks = s.stopTicks + 1;
      n = { ...n, stopTicks };
      if (stopTicks >= 20 && !s.triggeredEvents.includes(key)) {
        n = { ...n, triggeredEvents: [...n.triggeredEvents, key] };
        n = moveChaser(burst(say(addDread(n, 15), "THE SIGN WAS A LIE. THE HEADLIGHTS ARE CLOSER.", 50), 12), -80);
      }
    } else if (s.stopTicks !== 0) {
      n = { ...n, stopTicks: 0 };
    }
  }

  // the hidden old road: lights off, hug the left shoulder at the gap in the trees
  const t = metresTo(s, STORY.turnoff);
  if (s.headlights === "off" && tel.lanePosition <= -1.35 && Math.abs(t) < 9 && tel.speed >= 8 && tel.speed <= 50) {
    return endGame(n, "oldroad");
  }
  return n;
}

