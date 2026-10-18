// ============================================================
// src/game/driving.js
// DRIVING PHYSICS + WORLD DATA for MIDNIGHT ROAD
//
// ONE source of truth: `d.distance` (kilometres travelled).
//
//   keys -> pedals -> acceleration -> speed -> distance -> world position
//
// Nothing in here draws anything. The renderer (renderer.js) only READS this
// state, so the road, trees and signs can never drift out of sync with speed.
// ============================================================

// ---------- TUNING VALUES (change these to adjust the "feel") ----------
export const CONFIG = {
  // Car
  maxSpeed: 100 / 3.6,   // metres/second  (100 km/h)
  engineAccel: 4.0,      // m/s^2 at low speed with the pedal fully down
  engineTaper: 0.8,      // how much the engine weakens as speed rises (0..1)
  rollingDrag: 0.25,     // m/s^2 constant friction from the tyres
  airDrag: 0.0004,       // m/s^2 per (m/s)^2 -> grows fast at high speed
  engineBraking: 0.025,  // extra slowing when the pedal is released (per m/s)
  brakeDecel: 8.0,       // m/s^2 with the brake fully down

  // Pedals move gradually (per second) instead of snapping on/off
  throttleRise: 2.5,
  throttleFall: 5.0,
  brakeRise: 6.0,
  brakeFall: 8.0,

  // Steering
  steerPressRate: 4.0,   // how quickly the wheel turns while A/D is held
  steerReturnRate: 3.0,  // how quickly the wheel re-centres after release
  lateralSpeed: 1.0,     // lane-units per second at full steering
  lanePositionLimit: 1.5,

  // Road geometry (metres)
  roadHalfWidth: 3.4,    // centre line to road edge
  laneCenterOffset: 1.7, // centre line to the middle of our lane
  laneHalfWidth: 1.3,    // lanePosition +-1 = +-1.3 m from the lane middle
  driveOnLeft: true,     // India drives on the left. Set false for right-hand traffic.

  // Camera
  cameraHeight: 1.25,    // eye height above the road (m)
  drawDistance: 220,     // how far ahead we draw (m)

  // Story distances (5 km, 10 km, 11 km...) are "story kilometres".
  // 1 real kilometre of driving = 8 story kilometres, so Mile 27 (story km 10)
  // is about 1.25 real km away: roughly 45-75 seconds of driving instead of 10 minutes.
  // Raise this number to make the road feel shorter, lower it to make it longer.
  storyKmPerRealKm: 8,
};

// Story kilometres -> metres along the real world road.
export const storyToWorldMetres = (storyKm) => (storyKm / CONFIG.storyKmPerRealKm) * 1000;

// ---------- SMALL MATH HELPERS ----------
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Move `current` toward `target` by at most `maxStep`.
const approach = (current, target, maxStep) =>
  current < target ? Math.min(current + maxStep, target) : Math.max(current - maxStep, target);

const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Deterministic pseudo-random number 0..1 from a number.
// Same input -> same output, so trees are always in the same place.
export function hash(n) {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

// ---------- DRIVING STATE ----------
// Kept in a React ref (not React state) because it changes 60 times a second.
export function createDrivingState(initialDistanceKm = 0) {
  return {
    distance: initialDistanceKm, // real km travelled  <-- the single source of truth
    speed: 0,         // m/s (use speed * 3.6 for km/h)
    throttle: 0,      // 0..1  accelerator pedal position
    brake: 0,         // 0..1  brake pedal position
    steer: 0,         // -1..1 steering wheel position (smoothed)
    lanePosition: 0,  // -1..1 position inside our lane (0 = lane middle)
  };
}

export const speedKmh = (d) => d.speed * 3.6;

// ---------- THE PHYSICS STEP ----------
// Called once per animation frame.
//   input = { forward: bool, brake: bool, steer: -1 | 0 | 1 }
//   dt    = seconds since last frame (so 30 fps and 144 fps behave the same)
export function updateDriving(d, input, dt) {
  const c = CONFIG;

  // 1. Pedals move gradually toward where the keys want them.
  const throttleTarget = input.forward ? 1 : 0;
  const brakeTarget = input.brake ? 1 : 0;
  d.throttle = approach(d.throttle, throttleTarget, (throttleTarget > d.throttle ? c.throttleRise : c.throttleFall) * dt);
  d.brake = approach(d.brake, brakeTarget, (brakeTarget > d.brake ? c.brakeRise : c.brakeFall) * dt);

  // 2. Add up the forces (as accelerations, m/s^2).
  const ratio = d.speed / c.maxSpeed;
  let accel = d.throttle * c.engineAccel * (1 - c.engineTaper * ratio); // engine pushes
  if (d.speed > 0) {
    accel -= c.rollingDrag;                                  // tyres
    accel -= c.airDrag * d.speed * d.speed;                  // air resistance
    accel -= c.engineBraking * d.speed * (1 - d.throttle);   // lifting off the pedal
    accel -= c.brakeDecel * d.brake;                         // brakes
  }

  // 3. Speed changes by acceleration x time. Never below 0, never above the cap.
  d.speed = clamp(d.speed + accel * dt, 0, c.maxSpeed);

  // 4. DISTANCE: speed x time. Speed 0 means distance never changes.
  d.distance += (d.speed * dt) / 1000;

  // 5. Steering: the wheel eases toward the target, and the car slides
  //    sideways inside its lane only while it is actually moving.
  const rate = input.steer === 0 ? c.steerReturnRate : c.steerPressRate;
  d.steer += (input.steer - d.steer) * (1 - Math.exp(-rate * dt));
  const grip = clamp(d.speed / 6, 0, 1); // can't steer sideways while parked
  d.lanePosition = clamp(d.lanePosition + d.steer * c.lateralSpeed * grip * dt, -c.lanePositionLimit, c.lanePositionLimit);
}

// ---------- ROAD SHAPE ----------

// roadCenter(z): sideways position (metres) of the road centre line at
// world position z (metres from the start). Two slow sine waves added together
// give gentle left/right bends. smoothstep keeps the first ~500 m straight.
export function roadCenter(z) {
  const ramp = smoothstep(0, 600, z);
  const wave1 = 90 * Math.sin(z / 260);
  const wave2 = 140 * (Math.sin(z / 510 + 1.0) - Math.sin(1.0));
  return ramp * (wave1 + wave2);
}

// makeRoadFrame(playerZ): builds a helper for ONE frame.
// offsetAt(dz) answers: "dz metres ahead of the car, how far to the side is the
// road centre, compared with where the car is currently pointing?"
// We subtract the car's current heading, so the road directly in front of the
// bumper always looks straight and the bend only shows up further away.
export function makeRoadFrame(playerZ) {
  const here = roadCenter(playerZ);
  const heading = roadCenter(playerZ + 1) - here; // sideways metres per forward metre
  return {
    offsetAt(dz) {
      return roadCenter(playerZ + dz) - here - heading * dz;
    },
  };
}

// Sideways position of the car (metres from the road centre line).
// lanePosition changes this, but it never changes the road's own shape.
export function carLateral(lanePosition) {
  const side = CONFIG.driveOnLeft ? -1 : 1;
  return side * CONFIG.laneCenterOffset + lanePosition * CONFIG.laneHalfWidth;
}

// ---------- WORLD OBJECT HELPERS ----------
// The list of objects (signs, stranger, wreck...) is built by world.js.
// Each object has a `distance` in STORY km; storyToWorldMetres() turns it into
// a position on the road, and the renderer subtracts the car's position.

// Sideways position of an object (metres from the road centre line).
export function objectLateral(obj) {
  if (obj.lateral !== undefined) return obj.lateral;
  const side = obj.side === "right" ? 1 : -1;
  const gap = obj.type === "person" ? 0.8 : 1.5;
  return side * (CONFIG.roadHalfWidth + gap);
}

// ---------- PROCEDURAL FOREST ----------
// Three rows of trees on each side of the road. Positions come from hash(),
// so the forest is "random-looking" but identical every time, and we only
// create the trees near the player (no thousands of objects per frame).
const TREE_ROWS = [
  { spacing: 13, minOffset: 3.2, maxOffset: 7,  minHeight: 8,  maxHeight: 13 }, // near
  { spacing: 11, minOffset: 7,   maxOffset: 24, minHeight: 9,  maxHeight: 16 }, // far
];

// density: 1 = full forest, 0.3 = the trees have started to disappear.
export function generateTrees(playerZ, drawDistance, density = 1) {
  const trees = [];
  TREE_ROWS.forEach((row, rowIndex) => {
    const first = Math.ceil((playerZ + 1.5) / row.spacing);
    const last = Math.floor((playerZ + drawDistance) / row.spacing);
    for (let i = first; i <= last; i++) {
      for (const side of [-1, 1]) {
        const seed = i * 13.37 + rowIndex * 101.1 + side * 7.7;
        if (hash(seed) > 0.9 * density) continue; // random gaps in the forest
        const offset = row.minOffset + hash(seed + 2) * (row.maxOffset - row.minOffset);
        trees.push({
          z: i * row.spacing + (hash(seed + 1) - 0.5) * row.spacing * 0.8, // metres along the road
          lateral: side * (CONFIG.roadHalfWidth + offset),                // metres from centre line
          height: row.minHeight + hash(seed + 3) * (row.maxHeight - row.minHeight),
          tone: hash(seed + 4),                                           // colour variation
        });
      }
    }
  });
  return trees;
}
