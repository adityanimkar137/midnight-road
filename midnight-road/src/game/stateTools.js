// ============================================================
// src/game/stateTools.js
// Small helper functions used by events.js, dialogue.js, threats.js and
// gameEngine.js. Each one takes the game state and returns a NEW state.
// ============================================================
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const say = (s, text, ticks = 40) => ({ ...s, caption: { text, ticks } });   // subtitle
export const burst = (s, ticks = 8) => ({ ...s, glitch: Math.max(s.glitch, ticks) }); // static burst
export const mirror = (s, name, ticks = 0) => ({ ...s, mirrorState: name, mirrorTicks: ticks });
export const radio = (s, name) => ({ ...s, radio: name, radioTicks: 0 });
export const anomaly = (s, level) => ({ ...s, anomalyLevel: Math.max(s.anomalyLevel, level) });

// The three numbers that decide how the story ends:
export const addDread = (s, n) => ({ ...s, dread: clamp(s.dread + n, 0, 100) });          // your fear
export const addTrust = (s, n) => ({ ...s, trust: clamp(s.trust + n, 0, 10) });           // his trust in you
export const addHostility = (s, n) => ({ ...s, hostility: clamp(s.hostility + n, 0, 6) }); // his anger

export const hasClue = (s, id) => s.clues.includes(id);
export const addClue = (s, id) => (hasClue(s, id) ? s : { ...s, clues: [...s.clues, id] });
export const setFlag = (s, key, value = true) => ({ ...s, flags: { ...s.flags, [key]: value } });
export const flag = (s, key) => s.flags[key];

// The headlights behind you: change the gap (metres). Only matters while the chase is on.
export const moveChaser = (s, meters) =>
  s.chaser.active ? { ...s, chaser: { ...s.chaser, gap: clamp(s.chaser.gap + meters, -5, 260) } } : s;

// ---- endings ----
export const endGame = (s, id) => ({
  ...s, gameStatus: "ended", endingId: id, currentEvent: null, speed: 0,
});

// Good endings that end with a drive down a normal road: engine off, silence, then HOME.
export const startHomeRoad = (s, id) => ({
  ...s,
  ending: "silence",
  endingId: id,
  endingTicks: 0,
  radio: "silence",
  mirrorState: "normal",
  mirrorTicks: 0,
  carTrouble: 0,
  currentEvent: null,
  chaser: { ...s.chaser, active: false },
  caption: { text: "THE HEADLIGHTS BEHIND YOU WERE YOUR OWN. THEY GO OUT.", ticks: 60 },
  glitch: Math.max(s.glitch, 6),
});

// The chaser reached you. The third time, it keeps you.
export function caught(s) {
  const catches = s.catches + 1;
  if (catches >= 3) return endGame({ ...s, catches }, "replaced");
  return burst(
    say(
      {
        ...addDread(s, 25),
        catches,
        carTrouble: 50,
        lightsOut: 40,
        currentEvent: null,
        chaser: { ...s.chaser, gap: 110 },
      },
      catches === 1 ? "THE HEADLIGHTS FILL THE CAR. THEN THEY LET GO." : "THE HEADLIGHTS ARE INSIDE THE CAR. ONE MORE TIME.",
      55
    ),
    14
  );
}
