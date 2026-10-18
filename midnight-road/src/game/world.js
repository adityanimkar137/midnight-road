// ============================================================
// src/game/world.js
// WHAT EXISTS ON THE ROAD, decided from the game state.
//
// buildWorld(state) returns a list of objects. Every object has
//   distance : position along the road in STORY km (same numbers as events.js)
//   type     : sign | ghost | car | sedan | barrier | skid | stop | shrine |
//              phone | treemark | fuel | turnoff
// POIS lists the things you can TALK to or EXAMINE (see gameEngine.js).
// ============================================================

// Story positions (story km). events.js and threats.js use the same table.
export const STORY = {
  warning: 5,
  slow: 7.5,
  forest: 8.7,
  mile27: 10,
  radio: 10.5,
  chaser: 10.6,
  ghost: 11,
  carvedTree: 12.4,
  branchA: 12.5,
  branchB: 13.5,
  phone: 13.8,
  fakeStop: 14.6,
  seatGlitch: 15,
  mirrorCrash: 15.3,
  barrier: 15.9,
  wreckGhost: 16.3,
  sedan: 16.5,
  fuel: 17.2,
  turnoff: 18.2,
  shrine: 19.5,
  loopMarker: 20,
  loopEnd: 20.4,
  loopStart: 9,
};

export const MAX_LOOPS = 7; // after the 7th repeat the road keeps you

const GREEN_SIGN = { bg: [24, 96, 62], border: [235, 235, 235], textColor: [240, 240, 240] };
const YELLOW_SIGN = { bg: [222, 188, 40], border: [15, 15, 15], textColor: [15, 15, 15] };
const WHITE_SIGN = { bg: [226, 226, 216], border: [190, 30, 30], textColor: [20, 20, 20] };

const mile27 = (id, distance, side) => ({
  id, type: "sign", distance, side, w: 2.6, ...GREEN_SIGN,
  lines: [{ text: "MILE", scale: 1 }, { text: "27", scale: 2 }],
});

// ---- things you can interact with ----
// kind "talk"    -> press T   (the ghost)
// kind "examine" -> press E   (objects)
// `mustStop` ghosts punish you if you drive past them without stopping.
export const POIS = [
  {
    id: "ghost_roadside", km: STORY.ghost, kind: "talk", ghost: true, mustStop: true,
    when: (s) => !s.flags.firstDone || !s.flags.tookHim,
    label: "TALK TO THE MAN BESIDE THE ROAD",
  },
  { id: "tree", km: STORY.carvedTree, kind: "examine", when: () => true, label: "READ THE CARVED TREE" },
  { id: "phone", km: STORY.phone, kind: "examine", when: (s) => s.loopNumber >= 1, label: "ANSWER THE PAYPHONE" },
  { id: "ghost_wreck", km: STORY.sedan, kind: "talk", ghost: true, mustStop: true, when: () => true, label: "TALK TO HIM" },
  { id: "wreck", km: STORY.sedan, kind: "examine", when: () => true, label: "LOOK INSIDE THE WHITE SEDAN" },
  { id: "fuel", km: STORY.fuel, kind: "examine", when: (s) => s.flags.fuelLoop !== s.loopNumber, label: "TAKE THE FUEL CAN" },
  { id: "shrine", km: STORY.shrine, kind: "examine", when: () => true, label: "READ THE SHRINE" },
  { id: "ghost_shrine", km: STORY.shrine, kind: "talk", ghost: true, when: (s) => s.engine === "off", label: "SPEAK TO HIM" },
];

// How angry / how close the ghost looks (0..3). Drawn bigger and worse each stage.
export const ghostStage = (s) =>
  Math.min(3, Math.floor((s.hostility + (s.flags.missed || 0)) / 2) + (s.loopNumber >= 4 ? 1 : 0));

export function buildWorld(state) {
  const L = state.loopNumber;
  const choice = state.strangerChoice;
  const stage = ghostStage(state);
  const objects = [];

  // ---- GOOD ENDINGS: the road is normal again and counts up to HOME ----
  if (state.ending === "home") {
    const b = state.homeBase;
    const miles = [28, 29, 30];
    miles.forEach((m, i) =>
      objects.push({ id: `m${m}`, type: "sign", distance: b + 1 + i, side: "left", w: 2.6, ...GREEN_SIGN, lines: [{ text: "MILE", scale: 1 }, { text: String(m), scale: 2 }] })
    );
    objects.push({ id: "home", type: "sign", distance: b + 4, side: "right", w: 3.4, ...GREEN_SIGN, lines: ["HOME", "2 KM"] });
    return { objects, treeDensity: 1 };
  }

  // Loops 3, 5, 7...: the signs swap sides ("objects move")
  const flip = L >= 3 && L % 2 === 1;
  const side = (s) => (flip ? (s === "left" ? "right" : "left") : s);

  // ---- FIRST PASS ONLY: the signs at the start of the road ----
  if (L === 0) {
    objects.push({ id: "warning", type: "sign", distance: STORY.warning, side: "left", w: 3.4, ...YELLOW_SIGN, lines: ["WARNING", "ACCIDENT", "PRONE AREA", "DRIVE SAFE"] });
    objects.push({ id: "slow", type: "sign", distance: STORY.slow, side: "right", w: 3.4, ...WHITE_SIGN, lines: ["DRIVE SLOW", "NIGHT", "VISIBILITY", "LOW"] });
    objects.push({ id: "forest", type: "sign", distance: STORY.forest, side: "left", w: 3.4, ...GREEN_SIGN, lines: ["FOREST", "AREA", "WATCH FOR", "WILDLIFE"] });
  }

  // ---- MILE 27 (first marker, always there) ----
  objects.push(mile27("mile-27", STORY.mile27, side("right")));

  // ---- THE GHOST by the road (until you take him in) ----
  if (!state.flags.firstDone || !state.flags.tookHim) {
    objects.push({
      id: "ghost-roadside", type: "ghost", distance: STORY.ghost, stage,
      // if you drove past him he stands IN your lane next time
      lateral: state.flags.missedRoadside ? -1.7 : undefined, side: "left",
    });
  }
  // ... and he is standing there AGAIN further on (hostile or drive-past branches, later loops)
  if ((L === 0 && choice === "ignore") || L >= 2) {
    objects.push({ id: "ghost-2", type: "ghost", distance: 14.2, side: "right", stage: Math.max(1, stage) });
  }
  if (L >= 4) objects.push({ id: "ghost-3", type: "ghost", distance: 18.4, lateral: 1.4, stage: 3 });

  // ---- A CARVED TREE (a clue) and the PAYPHONE (rings from loop 1) ----
  objects.push({ id: "carved-tree", type: "treemark", distance: STORY.carvedTree, side: "left" });
  if (L >= 1) objects.push({ id: "payphone", type: "phone", distance: STORY.phone, side: "right" });

  // ---- "FAMILIAR OBJECTS": same sign, same vehicle ----
  if (L >= 1) objects.push({ id: "warning-again", type: "sign", distance: 12.3, side: side("left"), w: 3.4, ...YELLOW_SIGN, lines: ["WARNING", "ACCIDENT", "PRONE AREA", "DRIVE SAFE"], back: L >= 4 });
  if (L >= 2) objects.push({ id: "same-car", type: "car", distance: 13.2, lateral: 1.7 });
  if (L >= 4) objects.push({ id: "forest-back", type: "sign", distance: 18.0, side: side("left"), w: 3.4, ...GREEN_SIGN, lines: ["FOREST", "AREA", "WATCH FOR", "WILDLIFE"], back: true });
  if (L >= 5) {
    objects.push({ id: "same-car-2", type: "car", distance: 15.0, lateral: 1.7 });
    [12.0, 13.0, 14.6, 15.4, 17.6, 18.6].forEach((d, i) => objects.push(mile27(`mile-27-x${i}`, d, i % 2 ? "left" : "right")));
  }

  // ---- A FAKE STOP SIGN (a trap: stopping here calls the headlights) ----
  if (L >= 1) objects.push({ id: "fake-stop", type: "stop", distance: STORY.fakeStop, side: "left" });

  // ---- THE ACCIDENT SITE ----
  for (let i = 0; i < 5; i++) {
    objects.push({ id: `barrier-${i}`, type: "barrier", distance: STORY.barrier + i * 0.1, side: "right", broken: i === 1 || i === 2 });
  }
  objects.push({ id: "skid", type: "skid", distance: 16.0, length: 0.35 });
  objects.push({
    id: "sedan", type: "sedan", distance: STORY.sedan,
    // the wrecked car "moves" in later loops: shoulder -> road edge -> oncoming lane
    lateral: L >= 4 ? 1.4 : L === 3 ? 3.6 : 5.6,
  });
  objects.push({ id: "ghost-wreck", type: "ghost", distance: STORY.sedan - 0.12, lateral: 2.4, stage });

  if (state.flags.fuelLoop !== L) objects.push({ id: "fuel-can", type: "fuel", distance: STORY.fuel, side: "right" });

  // ---- THE HIDDEN OLD ROAD (secret ending) ----
  objects.push({ id: "turnoff", type: "turnoff", distance: STORY.turnoff });

  // ---- THE SHRINE: where he really fell (the only safe place to stop) ----
  objects.push({ id: "shrine", type: "shrine", distance: STORY.shrine, side: "left" });
  if (state.engine === "off") objects.push({ id: "ghost-shrine", type: "ghost", distance: STORY.shrine, lateral: -2.6, stage: Math.min(stage, 2) });

  // ---- LOOP MARKER: the second Mile 27 ----
  objects.push(mile27("mile-27-again", STORY.loopMarker, side("left")));

  // trees thin out from loop 3 onward
  const treeDensity = L >= 3 ? Math.max(0.25, 1 - 0.2 * (L - 2)) : 1;
  return { objects, treeDensity };
}
