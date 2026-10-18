// ============================================================
// src/game/events.js
// THE HORROR EVENTS, as a table (data-driven).
//
// Each event says:
//   id    : its name
//   at    : the story km where it triggers   (or `check` for special rules)
//   when  : optional rule about WHEN it may happen (loop number, choices...)
//   run   : a function that takes the game state and returns a NEW state
//
// An event fires once per loop: the key "loop:id" is stored in
// state.triggeredEvents. Environmental events never open a popup; they change
// the radio, the mirror, the passenger seat, the engine or the screen
// interference, and sometimes a short subtitle (caption) appears.
// (Conversations and clues are in dialogue.js; the chase and fear are in threats.js.)
// ============================================================
import { STORY, MAX_LOOPS } from "./world";
import { say, burst, mirror, radio, anomaly, endGame } from "./stateTools";

// ---------- timers: called once per telemetry tick (0.1 s) ----------
export function tickTimers(s) {
  const n = { ...s, radioTicks: s.radioTicks + 1 };
  if (n.caption) n.caption = n.caption.ticks > 1 ? { ...n.caption, ticks: n.caption.ticks - 1 } : null;
  if (n.glitch > 0) n.glitch -= 1;
  if (n.carTrouble > 0) n.carTrouble -= 1;
  if (n.lightsOut > 0) n.lightsOut -= 1;
  if (n.mirrorTicks > 0) {
    n.mirrorTicks -= 1;
    if (n.mirrorTicks === 0) n.mirrorState = "normal";
  }
  if (n.passengerTicks > 0) {
    n.passengerTicks -= 1;
    if (n.passengerTicks === 0 && n.passenger === "glitching") n.passenger = s.flags.tookHim ? "seated" : "none";
  }
  return n;
}

// ---------- text that changes with the loop number ----------
const RADIO_LINES = [
  "THE RADIO CUTS TO STATIC.",
  "A VOICE IN THE STATIC: \"MILE TWENTY-SEVEN.\"",
  "A VOICE: \"YOU ALREADY PASSED THIS.\"",
  "A VOICE: \"DON'T STOP.\"",
  "A VOICE: \"HE NEVER GOT HOME.\"",
  "A VOICE: \"NEED A RIDE?\"",
  "A VOICE: \"12:47. 12:47. 12:47.\"",
];
const MILE_LINES = ["", "MILE 27. AGAIN.", "MILE 27.", "MILE 27. IT IS CLOSER.", "MILE 27.", "MILE 27. MILE 27.", "MILE 27."];
const FAMILIAR_LINES = ["", "THE SAME SIGN.", "THE SAME SIGN. THE SAME WORDS.", "THE SIGN IS ON THE OTHER SIDE.", "THE SIGN FACES THE WRONG WAY.", "NONE OF THIS IS REAL.", "THE SIGN FACES THE WRONG WAY."];
const WRECK_LINES = [
  "BROKEN GLASS. TIRE MARKS. A WHITE SEDAN.",
  "THE WHITE SEDAN IS STILL HERE.",
  "THE DOORS ARE OPEN. THE ENGINE IS WARM.",
  "THE SEDAN HAS MOVED.",
  "THE SEDAN IS ON THE ROAD NOW.",
  "THE SEDAN IS ON THE ROAD NOW.",
  "THE SEDAN IS ON THE ROAD NOW.",
];
const GHOST_LINES = [
  "",
  "HE IS STANDING THERE AGAIN.",
  "HE HAS NOT MOVED.",
  "HE IS CLOSER TO THE ROAD.",
  "HE IS IN YOUR LANE.",
  "HE IS WAVING.",
  "HE IS SMILING.",
  "HE IS SMILING.",
];
export const LOOP_LINES = ["", "MILE 27.", "MILE 27.", "12:47 AM.", "12:47 AM.", "12:47 AM.", "12:47 AM.", "12:47 AM."];

const cap = (arr, i) => arr[Math.min(i, arr.length - 1)];

// ---------- the events ----------
// (keep sorted by `at`)
const EVENTS = [
  // --- first pass only: the road signs (the signs themselves are in world.js) ---
  { id: "warning_sign", at: STORY.warning, when: (s) => s.loopNumber === 0, run: (s) => s },
  { id: "drive_slow", at: STORY.slow, when: (s) => s.loopNumber === 0, run: (s) => s },
  { id: "forest_area", at: STORY.forest, when: (s) => s.loopNumber === 0, run: (s) => s },

  // --- MILE 27: nothing happens the first time. Later it hurts. ---
  {
    id: "mile_27", at: STORY.mile27,
    run: (s) => (s.loopNumber === 0 ? s : burst(say(s, cap(MILE_LINES, s.loopNumber)), 8)),
  },

  // --- the radio ---
  {
    id: "radio_disturbance", at: STORY.radio,
    run: (s) => {
      const L = s.loopNumber;
      const n = anomaly(burst(say(s, cap(RADIO_LINES, L)), L === 0 ? 8 : 6), 1);
      return radio(n, L >= 5 ? "strange" : "static");
    },
  },

  // --- the headlights behind you start following (every loop, a little closer each time) ---
  {
    id: "chaser_start", at: STORY.chaser,
    run: (s) => {
      const gap = Math.max(90, 230 - 20 * s.loopNumber);
      const n = { ...s, chaser: { active: true, gap } };
      return s.loopNumber === 0 ? burst(say(n, "HEADLIGHTS BEHIND YOU. THEY ARE NOT SLOWING DOWN. (Q: MIRROR)", 55), 5) : n;
    },
  },
  {
    id: "ghost_sighted", at: 9.7, when: (s) => s.loopNumber === 0,
    run: (s) => say(s, "SOMEONE IS STANDING BY THE ROAD AHEAD. STOP NEXT TO HIM AND PRESS T.", 60),
  },
  // later loops: you drive past him and he is still there
  {
    id: "ghost_again", at: STORY.ghost + 0.35, when: (s) => s.loopNumber >= 1 && !s.flags.tookHim,
    run: (s) => burst(say(s, cap(GHOST_LINES, s.loopNumber)), 5),
  },

  // --- loop 1+: the same sign again ---
  {
    id: "familiar_sign", at: 12.1, when: (s) => s.loopNumber >= 1,
    run: (s) => say(s, cap(FAMILIAR_LINES, s.loopNumber)),
  },

  // --- first pass: what your choice at the roadside caused ---
  {
    id: "branch_a", at: STORY.branchA, when: (s) => s.loopNumber === 0,
    run: (s) => {
      const choice = s.strangerChoice || "ignore";
      if (choice === "take") return burst(say(radio(s, "strange"), "THE RADIO TURNS ITSELF ON."), 6);
      if (choice === "reject") return burst(say({ ...s, carTrouble: 45 }, "THE ENGINE STUTTERS."), 6);
      return mirror(say(s, "SOMETHING IS IN THE MIRROR."), "stranger", 70);
    },
  },
  {
    id: "branch_b", at: STORY.branchB, when: (s) => s.loopNumber === 0,
    run: (s) => {
      const choice = s.strangerChoice || "ignore";
      if (choice === "take") return say(s, "HE WHISPERS: \"I KNOW THIS ROAD.\" (T: TALK TO HIM)", 50);
      if (choice === "reject") return burst(say({ ...s, passenger: "glitching", passengerTicks: 25 }, "FOOTSTEPS ON GRAVEL. THE PASSENGER SEAT IS NOT EMPTY."), 6);
      return say(s, "HE IS STANDING THERE AGAIN. AHEAD OF YOU.");
    },
  },
  // loops 3+: the mirror shows what the windshield does not
  {
    id: "impossible_mirror", at: 12.8, when: (s) => s.loopNumber >= 3 && s.loopNumber < 5,
    run: (s) => mirror(s, "stranger", 80),
  },
  {
    id: "player_in_mirror", at: 13.0, when: (s) => s.loopNumber >= 5,
    run: (s) => burst(say(mirror(s, "player", 130), "THE MIRROR SHOWS YOU. YOU ARE NOT DRIVING."), 6),
  },
  { id: "same_car", at: 13.2, when: (s) => s.loopNumber >= 2, run: (s) => say(s, "THE SAME CAR. THE SAME HEADLIGHTS.") },

  // --- the passenger seat ---
  {
    id: "seat_glitch", at: STORY.seatGlitch, when: (s) => s.flags.tookHim,
    run: (s) => burst(say({ ...s, passenger: "glitching", passengerTicks: 0 }, "THE PASSENGER SEAT FLICKERS."), 6),
  },
  {
    id: "mirror_crash", at: STORY.mirrorCrash, when: (s) => s.loopNumber >= 1,
    run: (s) => mirror(s, "crash", 60),
  },
  {
    id: "passenger_gone", at: 16.1, when: (s) => s.flags.tookHim && s.passenger !== "gone",
    run: (s) => say({ ...s, passenger: "gone", passengerTicks: 0 }, "THE SEAT IS EMPTY. HE IS STANDING BY THE WRECK."),
  },

  // --- the accident site ---
  {
    id: "accident_site", at: 16.15,
    run: (s) => burst(say(s, cap(WRECK_LINES, s.loopNumber), 55), 4),
  },
  { id: "radio_replay", at: 17.0, when: (s) => s.loopNumber >= 5, run: (s) => say(radio(s, "strange"), "THE RADIO REPEATS EVERYTHING THAT HAS HAPPENED.", 50) },
  { id: "clock_glitch", at: 17.8, when: (s) => s.loopNumber >= 4, run: (s) => burst(say(s, "THE CLOCK STILL SAYS 12:47."), 10) },
  {
    id: "candle_near", at: STORY.shrine - 0.45, when: (s) => s.chaser.active,
    run: (s) => say(s, "A CANDLE FLICKERS BESIDE THE ROAD. THE ENGINE IS LOUD. (R: ENGINE)", 50),
  },
];

export function runEvents(state, tel) {
  let s = state;
  for (const ev of EVENTS) {
    const key = `${s.loopNumber}:${ev.id}`;
    if (s.triggeredEvents.includes(key)) continue;
    if (ev.when && !ev.when(s)) continue;
    const hit = ev.check ? ev.check(s, tel) : s.distance >= ev.at;
    if (!hit) continue;
    s = ev.run({ ...s, triggeredEvents: [...s.triggeredEvents, key] });
  }
  return s;
}

// ---------- the loop: reaching the second Mile 27 sends you back ----------
export function checkLoop(s) {
  if (s.ending || s.distance < STORY.loopEnd) return s;

  const loop = s.loopNumber + 1;
  if (loop > MAX_LOOPS) return endGame(s, "road"); // the road keeps you

  return {
    ...s,
    loopNumber: loop,
    distance: STORY.loopStart,
    teleport: { id: s.teleport.id + 1, toKm: STORY.loopStart },
    anomalyLevel: Math.min(8, Math.max(s.anomalyLevel, 3) + 1),
    glitch: 14,
    mirrorState: "normal",
    mirrorTicks: 0,
    carTrouble: 0,
    chaser: { active: false, gap: 230 }, // it comes back at 10.6 each loop
    passenger: s.flags.tookHim ? "seated" : s.passenger === "glitching" ? "none" : s.passenger,
    passengerTicks: 0,
    radio: "music",
    radioFreq: 93.5,
    radioTicks: 0, // the song starts again at exactly the same second
    idleTicks: 0,
    stopTicks: 0,
    dread: Math.min(100, s.dread + 4), // repeating is tiring
    caption: { text: cap(LOOP_LINES, loop), ticks: 35 },
  };
}

// ---------- after a good ending: silence, then the road is normal and counts up to HOME ----------
export function advanceEnding(s) {
  if (s.ending === "silence") {
    const endingTicks = s.endingTicks + 1;
    if (endingTicks >= 45) {
      return {
        ...s,
        ending: "home",
        engine: "normal",
        endingTicks: 0,
        homeBase: s.distance,
        time: "1:12 AM",
        radio: "music",
        radioTicks: 0,
        anomalyLevel: 0,
        dread: 0,
        passenger: s.endingId === "home" ? "seated" : "none",
        passengerTicks: 0,
        escapedLoop: true,
        caption: { text: "THE ROAD IS QUIET.", ticks: 50 },
        glitch: 8,
      };
    }
    return { ...s, endingTicks };
  }
  if (s.ending === "home" && s.distance >= s.homeBase + 4.15) {
    return endGame(s, s.endingId);
  }
  return s;
}

