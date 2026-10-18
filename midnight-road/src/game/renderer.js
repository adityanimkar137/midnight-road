// ============================================================
// src/game/renderer.js
// LOW-RESOLUTION PIXEL RENDERER for MIDNIGHT ROAD (analog horror look)
//
// The whole scene is drawn on a tiny canvas (about 320 x 180 pixels), run
// through the VHS filter (analogFilter.js), and the browser scales it up with
// crisp pixels (CSS image-rendering: pixelated).
//
// Everything is still DRAWN FROM WORLD POSITION:
//     metres ahead = object position - car position
//     scale        = focal / metres ahead      (far = small, near = big)
// so nothing moves unless the car does.
// ============================================================
import {
  CONFIG, makeRoadFrame, carLateral, generateTrees, objectLateral, storyToWorldMetres, hash,
} from "./driving.js";
import { drawText, textWidth } from "./pixelFont.js";
import { createAnalogFilter } from "./analogFilter.js";

const TAU = Math.PI * 2;
const FOG = [44, 56, 62]; // colour that distant things fade into

// ---------- small helpers ----------
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
const fogAmount = (dz) => smoothstep(0.15, 1, dz / CONFIG.drawDistance) * 0.9;
const fade = (dz) => 1 - smoothstep(0.9, 1, dz / CONFIG.drawDistance); // fade in from the fog

// ---------- ROAD OUTLINE SAMPLES ----------
// The road is described by sampling it at 1 m, 1.06 m, 1.12 m ... (each step 6%
// further than the last: dense near the car, sparse far away).
const SAMPLE_DZ = [];
for (let dz = 1; dz < CONFIG.drawDistance; dz *= 1.06) SAMPLE_DZ.push(dz);
SAMPLE_DZ.push(CONFIG.drawDistance);
const N = SAMPLE_DZ.length;
const sampleX = new Float32Array(N); // screen x of the road centre
const sampleY = new Float32Array(N); // screen y of the road surface
const sampleS = new Float32Array(N); // pixels per metre at that depth

// PERSPECTIVE PROJECTION (the heart of the pseudo-3D effect):
//   y = horizon + cameraHeight * scale    (nearer -> lower on screen)
//   x = centre + sideways offset * scale  (nearer -> further from centre)
function computeRoadSamples(v) {
  for (let i = 0; i < N; i++) {
    const dz = SAMPLE_DZ[i];
    const s = v.focal / dz;
    sampleS[i] = s;
    sampleY[i] = v.horizonY + v.camH * s;
    sampleX[i] = v.W / 2 + (v.frame.offsetAt(dz) - v.carX) * s;
  }
}

// A strip that follows the road between two sideways offsets (metres).
function ribbonPath(ctx, latA, latB) {
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    const x = sampleX[i] + latA * sampleS[i];
    if (i === 0) ctx.moveTo(x, sampleY[i]);
    else ctx.lineTo(x, sampleY[i]);
  }
  for (let i = N - 1; i >= 0; i--) ctx.lineTo(sampleX[i] + latB * sampleS[i], sampleY[i]);
  ctx.closePath();
}

// A flat rectangle lying on the road surface (dz0..dz1 metres ahead).
function addRoadQuad(ctx, v, dz0, dz1, lat0, lat1) {
  const s0 = v.focal / dz0;
  const s1 = v.focal / dz1;
  const c0 = v.W / 2 + (v.frame.offsetAt(dz0) - v.carX) * s0;
  const c1 = v.W / 2 + (v.frame.offsetAt(dz1) - v.carX) * s1;
  const y0 = v.horizonY + v.camH * s0;
  const y1 = v.horizonY + v.camH * s1;
  ctx.moveTo(c0 + lat0 * s0, y0);
  ctx.lineTo(c0 + lat1 * s0, y0);
  ctx.lineTo(c1 + lat1 * s1, y1);
  ctx.lineTo(c1 + lat0 * s1, y1);
  ctx.closePath();
}

// Screen position of an object standing dz metres ahead at a given sideways offset.
function place(v, dz, lateral) {
  const s = v.focal / dz;
  return {
    s,
    x: v.W / 2 + (v.frame.offsetAt(dz) + lateral - v.carX) * s,
    y: v.horizonY + v.camH * s,
  };
}

// ============================================================
// createRenderer: call once. Returns { resize, draw, drawPump }.
// ============================================================
export function createRenderer(canvas, options = {}) {
  const makeCanvas =
    options.createCanvas ||
    ((w, h) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      return c;
    });

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const mask = makeCanvas(2, 2); // off-screen "darkness" layer used for headlights
  const mctx = mask.getContext("2d");
  const filter = createAnalogFilter(ctx);

  let W = 320;
  let H = 180;

  // The canvas is LOW resolution on purpose: 1 canvas pixel = 1 big screen pixel.
  function resize(width, height) {
    W = Math.round(width);
    H = Math.round(height);
    canvas.width = W;
    canvas.height = H;
    mask.width = W;
    mask.height = H;
  }

  // ---------------------------------------------------------
  // THE DRIVING SCENE
  //   d      = driving state (distance, speed, steer...)
  //   extras = things from the game state (see defaults below)
  // ---------------------------------------------------------
  function draw(d, extras) {
    const e = {
      time: 0, headlights: "normal", headlightIntensity: 1, fuel: 100,
      radio: "music", radioTicks: 0, mirrorState: "normal", mirrorCheck: 0,
      clock: "12:47 AM", passenger: "none", world: { objects: [], treeDensity: 1 },
      glitch: 0, anomaly: 0, carTrouble: 0,
      radioFreq: 93.5, engineOn: true, dread: 0, hostility: 0, chaserActive: false, chaserGap: 230,
      ...extras,
    };
    const playerZ = d.distance * 1000; // km -> metres: where the car is in the world
    const v = {
      W, H,
      horizonY: Math.round(H * 0.46),
      focal: Math.min(W * 0.5, H * 0.95),
      camH: CONFIG.cameraHeight,
      playerZ,
      carX: carLateral(d.lanePosition),
      frame: makeRoadFrame(playerZ),
      time: e.time,
      speedRatio: d.speed / CONFIG.maxSpeed,
    };

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;

    // 1. the world (a tiny vibration that grows with speed)
    ctx.save();
    const shake = v.speedRatio > 0.55 ? Math.round(Math.sin(e.time * 60)) * (v.speedRatio > 0.85 ? 1 : 0) : 0;
    ctx.translate(0, shake);
    drawSky(ctx, v);
    drawTreeLine(ctx, v);
    drawGroundAndRoad(ctx, v);
    drawRoadMarkings(ctx, v, e.world.objects);
    const lights = drawWorldObjects(ctx, v, e);
    drawHallucinations(ctx, v, e);
    drawFog(ctx, v);
    ctx.restore();

    // 2. darkness + headlights
    applyLighting(v, e);
    drawGlows(ctx, lights);

    // 3. the inside of the car
    drawPassenger(ctx, v, e);
    drawPillars(ctx, v);
    drawMirror(ctx, v, e);
    drawDashboard(ctx, v, d, e);
    const bend = clamp(v.frame.offsetAt(40) / 1.4, -1, 1); // the driver turns the wheel into bends
    drawWheelAndHands(ctx, v, d.steer * 0.7 + bend * 0.25);
    drawOSD(ctx, v, e);
    drawChaseGlare(ctx, v, e);
    drawDreadOverlay(ctx, v, e);

    // 4. the analog / VHS look
    filter.apply(W, H, {
      time: e.time,
      anomaly: clamp(e.anomaly / 8, 0, 1),
      burst: clamp(e.glitch / 10, 0, 1),
    });
  }

  // The light mask lives inside createRenderer because it needs `mask` and `mctx`.
  function applyLighting(v, e) {
    const { W: w, H: h, horizonY } = v;
    const on = e.headlights !== "off";
    let power = on ? e.headlightIntensity : 0;
    // engine trouble makes the lights flicker
    if (on && e.carTrouble > 0) power *= Math.random() > 0.35 ? 1 : 0.15;

    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.globalCompositeOperation = "source-over";
    mctx.clearRect(0, 0, w, h);
    mctx.fillStyle = on ? "rgba(2,4,8,0.62)" : "rgba(2,4,8,0.9)"; // night darkness
    mctx.fillRect(0, 0, w, h);

    mctx.globalCompositeOperation = "destination-out"; // erase darkness = let light through

    // moonlit sky
    const fadeEnd = horizonY + 14;
    const sg = mctx.createLinearGradient(0, 0, 0, fadeEnd);
    sg.addColorStop(0, "rgba(0,0,0,0.95)");
    sg.addColorStop(horizonY / fadeEnd, "rgba(0,0,0,0.8)");
    sg.addColorStop(1, "rgba(0,0,0,0)");
    mctx.fillStyle = sg;
    mctx.fillRect(0, 0, w, fadeEnd);

    if (power > 0) {
      const cy = horizonY + (h - horizonY) * 0.3;
      const R = (h - horizonY) * 0.7;
      mctx.save();
      mctx.translate(w / 2, cy);
      mctx.scale(2.2, 1);
      mctx.globalAlpha = power;
      const bg = mctx.createRadialGradient(0, 0, 0, 0, 0, R);
      bg.addColorStop(0, "rgba(0,0,0,0.98)");
      bg.addColorStop(0.5, "rgba(0,0,0,0.72)");
      bg.addColorStop(1, "rgba(0,0,0,0)");
      mctx.fillStyle = bg;
      mctx.beginPath();
      mctx.arc(0, 0, R, 0, TAU);
      mctx.fill();
      mctx.restore();
    }

    mctx.globalCompositeOperation = "source-over";
    ctx.drawImage(mask, 0, 0);
  }

  // ---------------------------------------------------------
  // THE PETROL PUMP SCENE (same pixel + analog look)
  // ---------------------------------------------------------
  function drawPump(extras) {
    const e = { time: 0, fuel: 18, glitch: 0, anomaly: 1, ...extras };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    drawPumpScene(ctx, W, H, e);
    filter.apply(W, H, { time: e.time, anomaly: clamp(e.anomaly / 8, 0, 1), burst: clamp(e.glitch / 10, 0, 1) });
  }

  return { resize, draw, drawPump };
}

// ============================================================
// WORLD DRAWING
// ============================================================

function drawSky(ctx, v) {
  const { W, horizonY } = v;
  const g = ctx.createLinearGradient(0, 0, 0, horizonY);
  g.addColorStop(0, "#03060b");
  g.addColorStop(0.7, "#0e1923");
  g.addColorStop(1, "#2c3a44");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, horizonY + 2);

  // a small square-ish moon (pixel art)
  const mx = Math.round(W * 0.74);
  const my = Math.round(horizonY * 0.4);
  ctx.fillStyle = "#cfd9e0";
  ctx.fillRect(mx - 3, my - 4, 7, 9);
  ctx.fillRect(mx - 4, my - 3, 9, 7);
}

// Far forest: one jagged silhouette along the horizon. It shifts a little when
// the road bends (parallax) but never with distance travelled.
function drawTreeLine(ctx, v) {
  const { W, horizonY } = v;
  const shift = v.frame.offsetAt(200) * (v.focal / 200) * 0.5;
  ctx.fillStyle = "rgb(18,30,34)";
  ctx.beginPath();
  ctx.moveTo(0, horizonY + 2);
  for (let x = 0; x <= W; x += 2) {
    const px = x + shift;
    const i = Math.floor(px / 9);
    const u = px / 9 - i;
    const treeH = 22 * (0.5 + 0.5 * hash(i + 3));
    ctx.lineTo(x, horizonY + 2 - treeH * (0.25 + 0.75 * (1 - Math.abs(2 * u - 1))));
  }
  ctx.lineTo(W, horizonY + 2);
  ctx.closePath();
  ctx.fill();
}

function drawGroundAndRoad(ctx, v) {
  const { W, H, horizonY } = v;
  const rh = CONFIG.roadHalfWidth;

  // forest floor
  const gg = ctx.createLinearGradient(0, horizonY, 0, H);
  gg.addColorStop(0, css(mix([24, 34, 30], FOG, 0.7)));
  gg.addColorStop(0.3, "rgb(20,28,24)");
  gg.addColorStop(1, "rgb(12,17,14)");
  ctx.fillStyle = gg;
  ctx.fillRect(0, horizonY, W, H - horizonY);

  computeRoadSamples(v);

  // gravel shoulder
  ribbonPath(ctx, -(rh + 1.3), rh + 1.3);
  ctx.fillStyle = "rgb(70,66,56)";
  ctx.fill();

  // asphalt
  const ag = ctx.createLinearGradient(0, horizonY, 0, H);
  ag.addColorStop(0, css(mix([66, 70, 76], FOG, 0.8)));
  ag.addColorStop(0.4, "rgb(78,83,90)");
  ag.addColorStop(1, "rgb(66,70,76)");
  ribbonPath(ctx, -rh, rh);
  ctx.fillStyle = ag;
  ctx.fill();
}

// Edge lines, centre dashes and tar seams. They are placed by WORLD distance,
// so when the car moves they move, and when it stops they stop. Also draws
// the flat decals of the accident (skid marks + glass).
function drawRoadMarkings(ctx, v, objects) {
  const rh = CONFIG.roadHalfWidth;
  const pz = v.playerZ;

  // tar seams every 8 m (they make speed easy to feel)
  ctx.fillStyle = "rgba(8,10,12,0.55)";
  ctx.beginPath();
  for (let k = Math.ceil((pz + 1.5) / 8); k * 8 - pz < 90; k++) {
    const dz = k * 8 - pz;
    addRoadQuad(ctx, v, dz, dz + 0.1 + dz * 0.006, -rh, rh);
  }
  ctx.fill();

  // skid marks and broken glass
  for (const o of objects) {
    if (o.type !== "skid") continue;
    const z0 = storyToWorldMetres(o.distance) - pz;
    const z1 = z0 + storyToWorldMetres(o.length);
    if (z1 < 1.5 || z0 > CONFIG.drawDistance) continue;
    ctx.fillStyle = "rgba(6,7,8,0.8)";
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      // two dark streaks that curve toward the right shoulder
      const a = z0 + ((z1 - z0) * i) / 12;
      const b = z0 + ((z1 - z0) * (i + 1)) / 12;
      if (b < 1.5) continue;
      const drift = (i / 12) * 3.2;
      addRoadQuad(ctx, v, Math.max(a, 1.5), b, -0.9 + drift, -0.65 + drift);
      addRoadQuad(ctx, v, Math.max(a, 1.5), b, 0.1 + drift, 0.35 + drift);
    }
    ctx.fill();
    ctx.fillStyle = "rgba(200,225,235,0.7)"; // glass
    for (let i = 0; i < 14; i++) {
      const gz = z1 - 1 - hash(i * 2.3) * 9;
      if (gz < 1.5) continue;
      const p = place(v, gz, 1.2 + hash(i * 5.7) * 3.4);
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }
  }

  // solid edge lines
  ctx.fillStyle = "rgb(190,190,184)";
  ribbonPath(ctx, -(rh - 0.5), -(rh - 0.3));
  ctx.fill();
  ribbonPath(ctx, rh - 0.5, rh - 0.3);
  ctx.fill();

  // centre line: 3 m dash, 6 m gap
  ctx.beginPath();
  for (let k = Math.floor((pz - 3) / 9); k * 9 - pz < CONFIG.drawDistance; k++) {
    const dz0 = Math.max(k * 9 - pz, 1.1);
    const dz1 = k * 9 + 3 - pz;
    if (dz1 <= 1.1) continue;
    addRoadQuad(ctx, v, dz0, dz1, -0.1, 0.1);
  }
  ctx.fillStyle = "rgb(206,192,130)";
  ctx.fill();
}

// ---------- roadside objects: trees, signs, people, cars, wreck... ----------
// Returns a list of lights (other cars' headlights, hazard lights) that stay
// bright through the darkness layer.
function drawWorldObjects(ctx, v, e) {
  const pz = v.playerZ;
  const maxD = CONFIG.drawDistance;
  const items = [];
  const lights = [];

  for (const t of generateTrees(pz, maxD, e.world.treeDensity)) items.push({ dz: t.z - pz, kind: "tree", data: t });
  for (const o of e.world.objects) {
    if (o.type === "skid") continue; // drawn flat on the road already
    const dz = storyToWorldMetres(o.distance) - pz;
    if (dz > 1.2 && dz < maxD) items.push({ dz, kind: o.type, data: o });
  }
  for (let k = Math.ceil((pz + 1.5) / 30); k * 30 - pz < maxD; k++) {
    items.push({ dz: k * 30 - pz, kind: "post", data: -1 });
    items.push({ dz: k * 30 - pz, kind: "post", data: 1 });
  }

  // Painter's algorithm: draw the farthest first, so near objects cover far ones.
  items.sort((a, b) => b.dz - a.dz);

  for (const it of items) {
    const d = it.data;
    if (it.kind === "tree") drawTree(ctx, v, d, it.dz);
    else if (it.kind === "sign") drawSign(ctx, v, d, it.dz);
    else if (it.kind === "person") drawPerson(ctx, v, d, it.dz);
    else if (it.kind === "ghost") drawGhost(ctx, v, d, it.dz, lights, e.time);
    else if (it.kind === "shrine") drawShrine(ctx, v, d, it.dz, lights, e.time);
    else if (it.kind === "phone") drawPhone(ctx, v, d, it.dz, lights, e.time);
    else if (it.kind === "treemark") drawTreeMark(ctx, v, d, it.dz);
    else if (it.kind === "fuel") drawFuelCan(ctx, v, d, it.dz);
    else if (it.kind === "turnoff") drawTurnoff(ctx, v, d, it.dz);
    else if (it.kind === "car") drawCar(ctx, v, d, it.dz, lights, [30, 34, 36], true);
    else if (it.kind === "sedan") drawCar(ctx, v, d, it.dz, lights, [150, 152, 148], false, e.time);
    else if (it.kind === "barrier") drawBarrier(ctx, v, d, it.dz);
    else if (it.kind === "stop") drawStopSign(ctx, v, d, it.dz);
    else drawPost(ctx, v, d, it.dz);
  }
  return lights;
}

// Simple two-triangle pine tree.
function drawTree(ctx, v, t, dz) {
  if (dz < 1.5) return;
  const p = place(v, dz, t.lateral);
  const hPx = t.height * p.s;
  const wPx = hPx * 0.36;
  if (hPx < 2 || p.x + wPx < 0 || p.x - wPx > v.W || p.y - hPx > v.H) return;

  const f = fogAmount(dz);
  ctx.globalAlpha = fade(dz);
  ctx.fillStyle = css(mix([22 + t.tone * 14, 44 + t.tone * 20, 36 + t.tone * 10], FOG, f));
  ctx.beginPath();
  for (let k = 0; k < 2; k++) {
    const bottom = p.y - hPx * (0.1 + k * 0.32);
    const top = bottom - hPx * 0.6;
    const half = wPx * 0.5 * (1 - k * 0.3);
    ctx.moveTo(p.x - half, bottom);
    ctx.lineTo(p.x, top);
    ctx.lineTo(p.x + half, bottom);
    ctx.closePath();
  }
  ctx.fill();
  ctx.fillStyle = css(mix([30, 24, 20], FOG, f));
  ctx.fillRect(Math.round(p.x - wPx * 0.05), Math.round(p.y - hPx * 0.12), Math.max(1, Math.round(wPx * 0.1)), Math.max(1, Math.round(hPx * 0.12)));
  ctx.globalAlpha = 1;
}

function drawPost(ctx, v, side, dz) {
  if (dz < 1.3) return;
  const p = place(v, dz, side * (CONFIG.roadHalfWidth + 1.0));
  if (p.x < -10 || p.x > v.W + 10) return;
  const f = fogAmount(dz);
  ctx.globalAlpha = fade(dz);
  ctx.fillStyle = css(mix([140, 140, 135], FOG, f));
  const h = Math.max(1, Math.round(0.95 * p.s));
  ctx.fillRect(Math.round(p.x), Math.round(p.y - h), Math.max(1, Math.round(0.1 * p.s)), h);
  ctx.fillStyle = css(mix(side < 0 ? [240, 240, 235] : [225, 40, 40], FOG, f)); // white left, red right
  ctx.fillRect(Math.round(p.x), Math.round(p.y - h), Math.max(1, Math.round(0.14 * p.s)), Math.max(1, Math.round(0.2 * p.s)));
  ctx.globalAlpha = 1;
}

// A roadside sign. Text is drawn with the pixel font, in whole-pixel sizes.
function drawSign(ctx, v, obj, dz) {
  const p = place(v, dz, objectLateral(obj));
  const lines = obj.lines.map((l) => (typeof l === "string" ? { text: l, scale: 1 } : l));
  const wM = obj.w || 3;
  const unitsTall = lines.reduce((sum, l) => sum + 6 * l.scale, 0) + 2; // in font pixels
  const widest = Math.max(...lines.map((l) => l.text.length * 4 * l.scale));
  const hM = (wM * unitsTall) / Math.max(widest + 4, unitsTall * 1.2); // keep a pleasant shape
  const bottom = 1.3;
  const wPx = wM * p.s;
  const hPx = hM * p.s;
  if (p.x + wPx < 0 || p.x - wPx > v.W) return;

  const f = fogAmount(dz);
  ctx.globalAlpha = fade(dz);
  const top = p.y - (bottom + hM) * p.s;

  // post
  ctx.fillStyle = css(mix([70, 72, 76], FOG, f));
  ctx.fillRect(Math.round(p.x), Math.round(top + hPx), Math.max(1, Math.round(0.14 * p.s)), Math.round(p.y - top - hPx));

  const bx = Math.round(p.x - wPx / 2);
  const by = Math.round(top);
  const bw = Math.max(2, Math.round(wPx));
  const bh = Math.max(2, Math.round(hPx));

  if (obj.back) {
    // the BACK of the sign: grey metal, no words (it faces the wrong way)
    ctx.fillStyle = css(mix([58, 60, 62], FOG, f));
    ctx.fillRect(bx, by, bw, bh);
    ctx.globalAlpha = 1;
    return;
  }

  // border + face
  ctx.fillStyle = css(mix(obj.border, FOG, f));
  ctx.fillRect(bx, by, bw, bh);
  const inset = bw > 12 ? 1 : 0;
  ctx.fillStyle = css(mix(obj.bg, FOG, f));
  ctx.fillRect(bx + inset, by + inset, bw - inset * 2, bh - inset * 2);

  // text: biggest whole-pixel size that fits; otherwise grey bars stand in for text
  const px = Math.floor(Math.min((bw - 2) / widest, (bh - 2) / unitsTall));
  const textColor = css(mix(obj.textColor, FOG, f));
  if (px >= 1) {
    let y = by + (bh - unitsTall * px) / 2 + px;
    for (const l of lines) {
      drawText(ctx, l.text, bx + bw / 2, y, px * l.scale, textColor, "center");
      y += 6 * l.scale * px;
    }
  } else if (bh >= 4) {
    ctx.fillStyle = textColor;
    const rows = lines.length;
    for (let i = 0; i < rows; i++) {
      ctx.fillRect(bx + 2, by + 1 + Math.round(((i + 0.5) * (bh - 2)) / rows), Math.max(1, bw - 4), 1);
    }
  }
  ctx.globalAlpha = 1;
}

function drawStopSign(ctx, v, obj, dz) {
  const p = place(v, dz, objectLateral(obj));
  const r = 0.7 * p.s;
  const cy = p.y - 2.2 * p.s;
  if (r < 1 || p.x + r < 0 || p.x - r > v.W) return;
  const f = fogAmount(dz);
  ctx.globalAlpha = fade(dz);
  ctx.fillStyle = css(mix([70, 72, 76], FOG, f));
  ctx.fillRect(Math.round(p.x), Math.round(cy), Math.max(1, Math.round(0.14 * p.s)), Math.round(p.y - cy));
  // octagon
  ctx.fillStyle = css(mix([200, 24, 24], FOG, f));
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (TAU * (i + 0.5)) / 8;
    ctx.lineTo(p.x + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  const px = Math.floor((r * 1.5) / 15);
  if (px >= 1) drawText(ctx, "STOP", p.x, cy - 2.5 * px, px, css(mix([240, 240, 235], FOG, f)), "center");
  else {
    ctx.fillStyle = css(mix([240, 240, 235], FOG, f));
    ctx.fillRect(Math.round(p.x - r * 0.6), Math.round(cy), Math.max(1, Math.round(r * 1.2)), 1);
  }
  ctx.globalAlpha = 1;
}

// The roadside stranger: a still figure in a pale coat with a pale face.
function drawPerson(ctx, v, obj, dz) {
  const p = place(v, dz, objectLateral(obj));
  if (p.x < -20 || p.x > v.W + 20) return;
  const f = fogAmount(dz);
  ctx.globalAlpha = fade(dz);
  const s = p.s;
  const R = Math.round;
  const at = (m) => Math.max(1, R(m * s));
  ctx.fillStyle = css(mix([40, 41, 46], FOG, f));
  ctx.fillRect(R(p.x - 0.28 * s), R(p.y - 0.95 * s), at(0.56), at(0.95));           // legs
  ctx.fillStyle = css(mix([96, 99, 106], FOG, f));
  ctx.fillRect(R(p.x - 0.4 * s), R(p.y - 1.62 * s), at(0.8), at(0.75));             // coat
  ctx.fillRect(R(p.x - 0.56 * s), R(p.y - 1.55 * s), at(0.16), at(0.7));            // arm
  ctx.fillStyle = css(mix([150, 140, 130], FOG, f));
  const head = at(0.32);
  ctx.fillRect(R(p.x - head / 2), R(p.y - 1.98 * s), head, head);                    // pale face
  ctx.globalAlpha = 1;
}

// A car facing us. `lit` cars have headlights on (they glow through the darkness).
// The white sedan is the wreck: hazard lights blink slowly.
function drawCar(ctx, v, obj, dz, lights, bodyColor, lit, time = 0) {
  const p = place(v, dz, objectLateral(obj));
  const s = p.s;
  if (p.x < -60 || p.x > v.W + 60 || s < 1) return;
  const f = fogAmount(dz);
  ctx.globalAlpha = fade(dz);
  const R = Math.round;
  const x = p.x;
  const y = p.y;

  // body, cabin, wheels
  ctx.fillStyle = css(mix(bodyColor, FOG, f));
  ctx.fillRect(R(x - 0.9 * s), R(y - 0.95 * s), Math.max(2, R(1.8 * s)), Math.max(1, R(0.7 * s)));
  ctx.fillRect(R(x - 0.6 * s), R(y - 1.45 * s), Math.max(1, R(1.2 * s)), Math.max(1, R(0.55 * s)));
  ctx.fillStyle = css(mix([8, 8, 9], FOG, f));
  ctx.fillRect(R(x - 0.85 * s), R(y - 0.3 * s), Math.max(1, R(0.28 * s)), Math.max(1, R(0.3 * s)));
  ctx.fillRect(R(x + 0.57 * s), R(y - 0.3 * s), Math.max(1, R(0.28 * s)), Math.max(1, R(0.3 * s)));
  // dark windscreen
  ctx.fillStyle = css(mix([14, 18, 20], FOG, f));
  ctx.fillRect(R(x - 0.5 * s), R(y - 1.38 * s), Math.max(1, R(1.0 * s)), Math.max(1, R(0.38 * s)));

  for (const side of [-1, 1]) {
    const hx = x + side * 0.62 * s;
    const hy = y - 0.62 * s;
    if (lit) {
      ctx.fillStyle = css(mix([255, 235, 185], FOG, f * 0.5));
      ctx.fillRect(R(hx), R(hy), Math.max(1, R(0.24 * s)), Math.max(1, R(0.2 * s)));
      lights.push({ x: hx, y: hy, r: clamp(1.2 * s, 3, 40), color: [255, 240, 205], a: 0.8 * (1 - f * 0.6) });
    } else if (Math.floor(time * 1.2) % 2 === 0) {
      // hazard lights blink
      ctx.fillStyle = css([255, 150, 40]);
      ctx.fillRect(R(hx), R(hy), Math.max(1, R(0.24 * s)), Math.max(1, R(0.2 * s)));
      lights.push({ x: hx, y: hy, r: clamp(0.9 * s, 2, 30), color: [255, 150, 40], a: 0.7 * (1 - f * 0.6) });
    }
  }
  ctx.globalAlpha = 1;
}

// Guard rail segment. Broken segments are bent and have a gap.
function drawBarrier(ctx, v, obj, dz) {
  if (dz < 1.3) return;
  const p = place(v, dz, CONFIG.roadHalfWidth + 1.4);
  if (p.x < -20 || p.x > v.W + 20) return;
  const f = fogAmount(dz);
  ctx.globalAlpha = fade(dz);
  const len = storyToWorldMetres(0.1) * p.s * 0.02; // visual width of a segment
  const h = Math.max(1, Math.round(0.8 * p.s));
  ctx.fillStyle = css(mix([120, 126, 126], FOG, f));
  if (obj.broken) {
    // bent rail: lower, tilted, with a gap
    ctx.fillRect(Math.round(p.x), Math.round(p.y - h * 0.45), Math.max(2, Math.round(1.6 * p.s)), Math.max(1, Math.round(0.18 * p.s)));
    ctx.fillRect(Math.round(p.x + 1.8 * p.s), Math.round(p.y - h * 0.2), Math.max(1, Math.round(0.9 * p.s)), Math.max(1, Math.round(0.16 * p.s)));
  } else {
    ctx.fillRect(Math.round(p.x), Math.round(p.y - h * 0.8), Math.max(2, Math.round(3.4 * p.s)), Math.max(1, Math.round(0.2 * p.s)));
    ctx.fillRect(Math.round(p.x), Math.round(p.y - h), Math.max(1, Math.round(0.14 * p.s)), h);
  }
  void len;
  ctx.globalAlpha = 1;
}

function drawFog(ctx, v) {
  const y0 = v.horizonY - 18;
  const y1 = v.horizonY + 34;
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, "rgba(64,80,88,0)");
  g.addColorStop(0.45, "rgba(64,80,88,0.45)");
  g.addColorStop(1, "rgba(64,80,88,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, y0, v.W, y1 - y0);
}

// Glow of other cars' lights, drawn on top of the darkness layer.
function drawGlows(ctx, lights) {
  if (lights.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const l of lights) {
    const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
    g.addColorStop(0, css(l.color, l.a));
    g.addColorStop(1, css(l.color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
  }
  ctx.restore();
}

// ============================================================
// THE INSIDE OF THE CAR (kept very simple)
// ============================================================

function drawPillars(ctx, v) {
  const { W, H } = v;
  ctx.fillStyle = "#07080a";
  // roof
  ctx.fillRect(0, 0, W, Math.round(H * 0.05));
  // pillars
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(W * 0.1, 0);
  ctx.lineTo(W * 0.04, H * 0.78);
  ctx.lineTo(0, H * 0.8);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(W, 0);
  ctx.lineTo(W * 0.9, 0);
  ctx.lineTo(W * 0.96, H * 0.78);
  ctx.lineTo(W, H * 0.8);
  ctx.closePath();
  ctx.fill();
}

// The passenger seat is on the LEFT (right-hand-drive car, traffic on the left).
// The more he distrusts you, the more his head turns toward you.
function drawPassenger(ctx, v, e) {
  if (e.passenger === "none" || e.passenger === "gone") return;
  // while the seat "glitches" the figure flickers in and out
  if (e.passenger === "glitching" && Math.sin(e.time * 23) + Math.sin(e.time * 7.3) < 0.2) return;
  const { W, H } = v;
  const cx = Math.round(W * 0.17);
  const top = Math.round(H * 0.55);
  ctx.fillStyle = "#171b21";
  ctx.fillRect(cx - 12, Math.round(H * 0.7), 24, Math.round(H * 0.3));  // shoulders
  ctx.fillStyle = "#222932";
  ctx.fillRect(cx - 7, top, 14, 16);                                      // head
  ctx.fillStyle = "#47525e";
  ctx.fillRect(cx - 7, top, 14, 2);                                       // faint highlight
  if (e.hostility >= 2) {
    // his face turns to look at the driver
    ctx.fillStyle = "#8b949c";
    ctx.fillRect(cx + 2, top + 4, 5, 9);                                  // pale side of the face
    ctx.fillStyle = e.hostility >= 4 ? "#ffffff" : "#d8dde0";
    ctx.fillRect(cx + 3, top + 6, 2, 2);                                  // eye
    if (e.hostility >= 4) ctx.fillRect(cx + 6, top + 6, 1, 2);
  }
}

// Rear-view mirror: a tiny second camera looking BACKWARD down the same road.
// Behind distance = playerZ - objectZ, so it also follows the car's real position.
function drawMirror(ctx, v, e) {
  const k = e.mirrorCheck; // 0 = glance, 1 = looking right at it (Q held)
  const w = Math.round(v.W * (0.24 + 0.14 * k));
  const h = Math.round(v.H * (0.12 + 0.07 * k));
  const x = Math.round(v.W / 2 - w / 2);
  const y = Math.round(v.H * 0.035);
  const rh = CONFIG.roadHalfWidth;

  ctx.fillStyle = "#050607";
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  const horizon = y + Math.round(h * 0.4);
  ctx.fillStyle = "#15212b";
  ctx.fillRect(x, y, w, horizon - y);
  ctx.fillStyle = "#0a100d";
  ctx.fillRect(x, horizon, w, y + h - horizon);

  const fm = w * 0.5;
  const mx0 = x + w / 2;
  const pz = v.playerZ;

  // road behind us
  const nearB = 2;
  const farB = 200;
  const sN = fm / nearB;
  const sF = fm / farB;
  ctx.fillStyle = "#23282d";
  ctx.beginPath();
  ctx.moveTo(mx0 + (-rh - v.carX) * sN, horizon + v.camH * sN);
  ctx.lineTo(mx0 + (rh - v.carX) * sN, horizon + v.camH * sN);
  ctx.lineTo(mx0 + (rh - v.carX) * sF, horizon + v.camH * sF);
  ctx.lineTo(mx0 + (-rh - v.carX) * sF, horizon + v.camH * sF);
  ctx.closePath();
  ctx.fill();

  // trees behind us
  ctx.fillStyle = "#0b1311";
  for (let i = Math.floor((pz - 120) / 16); i <= Math.floor((pz - 5) / 16); i++) {
    for (const side of [-1, 1]) {
      const seed = i * 3.7 + side * 9.1;
      const b = pz - (i * 16 + hash(seed) * 6);
      if (b < 4) continue;
      const s = fm / b;
      const tx = mx0 + (side * (rh + 2 + hash(seed + 1) * 5) - v.carX) * s;
      const yb = horizon + v.camH * s;
      const hp = 11 * s;
      ctx.beginPath();
      ctx.moveTo(tx - hp * 0.2, yb);
      ctx.lineTo(tx, yb - hp);
      ctx.lineTo(tx + hp * 0.2, yb);
      ctx.closePath();
      ctx.fill();
    }
  }

  // dashes behind us
  ctx.fillStyle = "#b8a878";
  ctx.beginPath();
  for (let i = Math.floor((pz - 100) / 9); i <= Math.floor((pz - 2) / 9); i++) {
    const bNear = Math.max(pz - (i * 9 + 3), nearB);
    const bFar = pz - i * 9;
    if (bFar <= nearB) continue;
    const s0 = fm / bNear;
    const s1 = fm / bFar;
    ctx.moveTo(mx0 + (-0.1 - v.carX) * s0, horizon + v.camH * s0);
    ctx.lineTo(mx0 + (0.1 - v.carX) * s0, horizon + v.camH * s0);
    ctx.lineTo(mx0 + (0.1 - v.carX) * s1, horizon + v.camH * s1);
    ctx.lineTo(mx0 + (-0.1 - v.carX) * s1, horizon + v.camH * s1);
    ctx.closePath();
  }
  ctx.fill();

  // the headlights behind you (they get bigger as the gap closes)
  if (e.chaserActive && e.chaserGap < 235) {
    const k = clamp(1 - e.chaserGap / 240, 0.08, 1);
    const spread = 3 + 15 * k;
    const size = 1 + Math.round(3 * k);
    const ly = horizon + Math.round(h * 0.1) + Math.round(k * h * 0.12);
    const flick = e.chaserGap < 40 && Math.random() > 0.7 ? 0.5 : 1;
    ctx.globalAlpha = flick;
    ctx.fillStyle = "rgba(255,243,207,0.3)";
    ctx.fillRect(Math.round(mx0 - spread - size * 2), ly - size, size * 4, size * 3);
    ctx.fillRect(Math.round(mx0 + spread - size * 2), ly - size, size * 4, size * 3);
    ctx.fillStyle = "#fff6d8";
    ctx.fillRect(Math.round(mx0 - spread - size / 2), ly, size, size);
    ctx.fillRect(Math.round(mx0 + spread - size / 2), ly, size, size);
    ctx.globalAlpha = 1;
  }

  // what the mirror shows (the story controls this with state.mirrorState)
  const state = e.mirrorState;
  if (state === "ghost_face") {
    // his face, for a few frames
    ctx.fillStyle = "#030304";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#c4ccd0";
    ctx.fillRect(mx0 - 9, y + 2, 18, h - 4);
    ctx.fillStyle = "#000";
    ctx.fillRect(mx0 - 6, y + Math.round(h * 0.3), 4, 5);
    ctx.fillRect(mx0 + 2, y + Math.round(h * 0.3), 4, 5);
    ctx.fillRect(mx0 - 3, y + Math.round(h * 0.65), 6, 3);
  } else if (state === "following_car") {
    // a car following us: two headlights that drift a little closer and further
    const lx = mx0 - Math.round(carLateral(0) * 0 + 0);
    const gap = 5 + 2 * Math.sin(e.time * 0.7);
    const ly = horizon + Math.round(h * 0.12);
    ctx.fillStyle = "#fff3cf";
    ctx.fillRect(Math.round(lx - gap - 1), ly, 2, 2);
    ctx.fillRect(Math.round(lx + gap - 1), ly, 2, 2);
    ctx.fillStyle = "rgba(255,243,207,0.25)";
    ctx.fillRect(Math.round(lx - gap - 3), ly - 1, 6, 4);
    ctx.fillRect(Math.round(lx + gap - 3), ly - 1, 6, 4);
  } else if (state === "stranger") {
    // the stranger standing in the middle of the road behind us
    ctx.fillStyle = "#050606";
    ctx.fillRect(mx0 - 1, horizon + Math.round(h * 0.06), 3, Math.round(h * 0.22));
    ctx.fillStyle = "#b0a498";
    ctx.fillRect(mx0 - 1, horizon + Math.round(h * 0.03), 3, 3);
  } else if (state === "crash") {
    // a crashed car behind us, hazard lights blinking
    const cy = horizon + Math.round(h * 0.1);
    ctx.fillStyle = "#c8cbc6";
    ctx.fillRect(mx0 - 7, cy, 14, 6);
    ctx.fillRect(mx0 - 4, cy - 3, 8, 3);
    if (Math.floor(e.time * 2) % 2 === 0) {
      ctx.fillStyle = "#ff9a28";
      ctx.fillRect(mx0 - 7, cy + 1, 2, 2);
      ctx.fillRect(mx0 + 5, cy + 1, 2, 2);
    }
  } else if (state === "player") {
    // YOU, sitting in the back seat, looking at the back of your own head
    ctx.fillStyle = "#030304";
    ctx.fillRect(mx0 - 7, y + Math.round(h * 0.45), 14, h);
    ctx.fillRect(mx0 - 4, y + Math.round(h * 0.18), 8, 10);
    ctx.fillStyle = "#bfb4a8";
    ctx.fillRect(mx0 - 2, y + Math.round(h * 0.3), 1, 1);
    ctx.fillRect(mx0 + 1, y + Math.round(h * 0.3), 1, 1);
  }

  // glass: darken
  ctx.fillStyle = `rgba(0,0,0,${0.3 * (1 - k * 0.6)})`;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

function drawDashboard(ctx, v, d, e) {
  const { W, H } = v;

  // dashboard body
  ctx.beginPath();
  ctx.moveTo(0, H * 0.8);
  ctx.quadraticCurveTo(W / 2, H * 0.66, W, H * 0.8);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fillStyle = "#1a1d22";
  ctx.fill();
  ctx.fillStyle = "#23262c";
  ctx.fillRect(0, Math.round(H * 0.9), W, Math.round(H * 0.1));

  // speed: big digital readout on the left
  let kmh = Math.round(d.speed * 3.6);
  if (e.dread > 65 && Math.random() < 0.2) kmh = Math.floor(Math.random() * 180); // fear makes the dial lie
  drawText(ctx, String(kmh).padStart(3, "0"), W * 0.2, H * 0.78, 3, "#d8a35a", "center");
  if (!e.engineOn) drawText(ctx, "ENGINE OFF", W / 2, H * 0.92, 1, "#d24a2a", "center");
  drawText(ctx, "KMH", W * 0.2, H * 0.78 + 17, 1, "#7a6a4a", "center");

  // fuel: five little bars on the right
  const lit = Math.ceil(clamp(e.fuel, 0, 100) / 20);
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i < lit ? (lit <= 1 ? "#d24a2a" : "#7fd0b0") : "#1a1d20";
    ctx.fillRect(Math.round(W * 0.8 - 14 + i * 6), Math.round(H * 0.8), 4, 8);
  }
  drawText(ctx, "FUEL", W * 0.8, H * 0.78 + 17, 1, "#6a7a74", "center");

  // radio
  drawRadio(ctx, v, e);

  // indicator lights: engine trouble, headlights on
  ctx.fillStyle = e.carTrouble > 0 && Math.floor(e.time * 4) % 2 === 0 ? "#ff9a28" : "#1b1b1e";
  ctx.fillRect(Math.round(W * 0.36), Math.round(H * 0.74), 3, 3);
  ctx.fillStyle = e.headlights !== "off" ? "#3cc86a" : "#1b1b1e";
  ctx.fillRect(Math.round(W * 0.62), Math.round(H * 0.74), 3, 3);
}

function drawRadio(ctx, v, e) {
  const w = Math.round(v.W * 0.22);
  const h = 11;
  const x = Math.round(v.W / 2 - w / 2);
  const y = Math.round(v.H * 0.73);
  ctx.fillStyle = "#040709";
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = "#05090b";
  ctx.fillRect(x, y, w, h);

  if (!e.engineOn) {
    drawText(ctx, "OFF", v.W / 2, y + 3, 1, "#2c4540", "center");
    return;
  }

  // the dial: 93.5 plays the story, 91.7 hides a voice, everything else is static
  const f = e.radioFreq;
  const mode = Math.abs(f - 93.5) < 0.05 ? e.radio : Math.abs(f - 91.7) < 0.15 ? "voice" : "static";
  const secs = Math.floor(e.radioTicks / 10) + 14; // the song always starts at the same second
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const freq = f.toFixed(1);

  if (mode === "music") {
    drawText(ctx, `${freq} ${clock}`, v.W / 2, y + 3, 1, "#7fe0c0", "center");
  } else if (mode === "static") {
    drawText(ctx, `${freq} ~~~`, v.W / 2, y + 3, 1, Math.random() > 0.3 ? "#9ae6d2" : "#335048", "center");
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = "rgba(180,230,220,0.5)";
      ctx.fillRect(x + 1 + Math.floor(Math.random() * (w - 2)), y + 1 + Math.floor(Math.random() * (h - 2)), 1 + Math.floor(Math.random() * 4), 1);
    }
  } else if (mode === "voice") {
    drawText(ctx, `${freq} ${Math.floor(e.time * 3) % 2 ? "VOICE" : "-----"}`, v.W / 2, y + 3, 1, "#e6f0ea", "center");
  } else if (mode === "strange") {
    const word = Math.floor(e.time * 1.5) % 3 === 0 ? "MILE 27" : Math.random() > 0.5 ? "?? ?? ??" : "- - - -";
    drawText(ctx, word, v.W / 2, y + 3, 1, "#d6e8e2", "center");
  } else {
    drawText(ctx, "-----", v.W / 2, y + 3, 1, "#2c4540", "center");
  }
}

// Steering wheel: a circle squashed vertically so it looks tilted toward the
// driver, then rotated by the steering angle. Two simple hands ride on the rim.
function drawWheelAndHands(ctx, v, angle) {
  const { W, H } = v;
  const cx = W / 2;
  const cy = H * 1.0;
  const a = W * 0.17;
  const squash = 0.5;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, squash);
  ctx.rotate(angle);
  ctx.lineCap = "butt";
  ctx.lineWidth = 5;
  ctx.strokeStyle = "#3a3e47";
  ctx.beginPath();
  ctx.arc(0, 0, a, 0, TAU);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#6a707c";
  ctx.beginPath();
  ctx.arc(0, 0, a + 2, Math.PI * 1.1, Math.PI * 1.9);
  ctx.stroke();
  ctx.lineWidth = 5;
  ctx.strokeStyle = "#2c2f36";
  for (const sa of [0, Math.PI, Math.PI / 2]) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(sa) * a * 0.95, Math.sin(sa) * a * 0.95);
    ctx.stroke();
  }
  ctx.fillStyle = "#16181c";
  ctx.beginPath();
  ctx.arc(0, 0, a * 0.2, 0, TAU);
  ctx.fill();
  ctx.restore();

  // hands at "10 and 2 o'clock", following the rim as the wheel turns
  for (const side of [-1, 1]) {
    const t = side < 0 ? -Math.PI * 0.67 : -Math.PI * 0.33;
    const hx = Math.round(cx + a * Math.cos(t + angle));
    const hy = Math.round(cy + a * squash * Math.sin(t + angle));
    // forearm (dark sleeve) rising from the bottom of the screen
    ctx.strokeStyle = "#242830";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(hx, hy + 2);
    ctx.lineTo(hx + side * 14, H + 4);
    ctx.stroke();
    // hand: palm, four knuckle pixels, thumb
    ctx.fillStyle = "#8a6a58";
    ctx.fillRect(hx - 4, hy - 2, 8, 5);
    ctx.fillStyle = "#b08a74";
    ctx.fillRect(hx - 4, hy - 3, 8, 1);
    ctx.fillStyle = "#3e2d26";
    ctx.fillRect(hx - side * 5 - (side > 0 ? 0 : 0), hy, 2, 3); // thumb side
  }
}

// On-screen display like a camcorder: PLAY and the clock.
function drawOSD(ctx, v, e) {
  const glitchy = e.glitch > 3 && Math.random() > 0.5;
  drawText(ctx, "PLAY >", 5, 5, 1, "#e6e6e0");
  drawText(ctx, glitchy ? "--:-- --" : e.clock, v.W - 5, 5, 1, "#e6e6e0", "right");
}

// ============================================================
// THE GHOST AND THE SECRETS
// ============================================================

// The ghost. `stage` 0..3: the angrier he is, the worse he looks (head tilts,
// dark eyes, glowing eyes and raised arms). He glows a little in the dark.
function drawGhost(ctx, v, obj, dz, lights, time) {
  const p = place(v, dz, objectLateral(obj));
  if (p.x < -30 || p.x > v.W + 30 || p.s < 0.6) return;
  const stage = obj.stage || 0;
  const f = fogAmount(dz) * 0.2;
  const flicker = Math.sin(time * 13 + dz) > -0.85 ? 1 : 0.35;
  ctx.globalAlpha = fade(dz) * flicker * 0.92;
  const s = p.s;
  const R = Math.round;
  const at = (m) => Math.max(1, R(m * s));
  const tilt = stage * 0.07 * s;

  ctx.fillStyle = css(mix([60, 66, 74], FOG, f));
  ctx.fillRect(R(p.x - 0.25 * s), R(p.y - 0.95 * s), at(0.5), at(0.95));               // legs
  ctx.fillStyle = css(mix([196, 206, 216], FOG, f));
  ctx.fillRect(R(p.x - 0.42 * s), R(p.y - 1.7 * s), at(0.84), at(0.8));                // coat
  if (stage >= 2) {
    ctx.fillRect(R(p.x - 0.62 * s), R(p.y - 1.6 * s), at(0.16), at(stage >= 3 ? 1.4 : 0.9)); // long arms
    ctx.fillRect(R(p.x + 0.46 * s), R(p.y - 1.6 * s), at(0.16), at(stage >= 3 ? 1.4 : 0.9));
  } else {
    ctx.fillRect(R(p.x - 0.58 * s), R(p.y - 1.62 * s), at(0.16), at(0.7));
  }
  const head = at(0.34);
  const hx = R(p.x - head / 2 + tilt);
  const hy = R(p.y - 2.08 * s + stage * 0.04 * s);
  ctx.fillStyle = css(mix([205, 214, 220], FOG, f));
  ctx.fillRect(hx, hy, head, head);                                                     // face
  // eyes
  const eye = Math.max(1, R(0.07 * s));
  if (stage >= 1) {
    ctx.fillStyle = stage >= 3 ? "#ffffff" : "#050607";
    ctx.fillRect(hx + R(head * 0.2), hy + R(head * 0.32), eye, eye * (stage >= 3 ? 1 : 2));
    ctx.fillRect(hx + R(head * 0.62), hy + R(head * 0.32), eye, eye * (stage >= 3 ? 1 : 2));
    if (stage >= 2) ctx.fillRect(hx + R(head * 0.3), hy + R(head * 0.7), Math.max(1, R(head * 0.4)), eye); // mouth
  }
  ctx.globalAlpha = 1;
  lights.push({ x: p.x, y: p.y - 1.5 * s, r: clamp(1.5 * s, 3, 36), color: [150, 205, 235], a: 0.1 + 0.05 * stage });
}

// The shrine: stones, a name plate, and a candle that glows warm through the dark.
function drawShrine(ctx, v, obj, dz, lights, time) {
  const p = place(v, dz, objectLateral(obj));
  if (p.x < -30 || p.x > v.W + 30 || p.s < 0.6) return;
  const f = fogAmount(dz);
  ctx.globalAlpha = fade(dz);
  const s = p.s;
  const R = Math.round;
  const at = (m) => Math.max(1, R(m * s));
  ctx.fillStyle = css(mix([86, 88, 90], FOG, f));
  ctx.fillRect(R(p.x - 0.7 * s), R(p.y - 0.45 * s), at(1.4), at(0.45));                // stones
  ctx.fillStyle = css(mix([120, 118, 112], FOG, f));
  ctx.fillRect(R(p.x - 0.25 * s), R(p.y - 1.2 * s), at(0.5), at(0.8));                 // plate
  ctx.fillStyle = css(mix([236, 226, 170], FOG, f));
  ctx.fillRect(R(p.x + 0.35 * s), R(p.y - 0.8 * s), at(0.1), at(0.35));                // candle
  const flame = 0.8 + 0.2 * Math.sin(time * 9 + dz);
  ctx.fillStyle = css([255, 190, 80]);
  ctx.fillRect(R(p.x + 0.35 * s), R(p.y - 0.95 * s), at(0.1), Math.max(1, R(0.18 * s * flame)));
  ctx.globalAlpha = 1;
  lights.push({ x: p.x + 0.4 * s, y: p.y - 0.9 * s, r: clamp(3.2 * s, 4, 70), color: [255, 180, 80], a: 0.6 * flame });
}

// The payphone booth. Its light blinks when it rings (from loop 1).
function drawPhone(ctx, v, obj, dz, lights, time) {
  const p = place(v, dz, objectLateral(obj));
  if (p.x < -30 || p.x > v.W + 30 || p.s < 0.6) return;
  const f = fogAmount(dz);
  ctx.globalAlpha = fade(dz);
  const s = p.s;
  const R = Math.round;
  const at = (m) => Math.max(1, R(m * s));
  ctx.fillStyle = css(mix([22, 62, 60], FOG, f));
  ctx.fillRect(R(p.x - 0.5 * s), R(p.y - 2.3 * s), at(1), at(2.3));
  ctx.fillStyle = css(mix([8, 14, 14], FOG, f));
  ctx.fillRect(R(p.x - 0.36 * s), R(p.y - 1.9 * s), at(0.72), at(1.4));
  const ring = Math.floor(time * 3) % 2 === 0;
  ctx.fillStyle = ring ? css([240, 245, 205]) : css(mix([60, 80, 70], FOG, f));
  ctx.fillRect(R(p.x - 0.4 * s), R(p.y - 2.3 * s), at(0.8), at(0.28));
  ctx.globalAlpha = 1;
  if (ring) lights.push({ x: p.x, y: p.y - 2.1 * s, r: clamp(2.6 * s, 4, 60), color: [235, 245, 200], a: 0.55 });
}

// A tree with letters carved into it (a clue).
function drawTreeMark(ctx, v, obj, dz) {
  if (dz < 1.5) return;
  drawTree(ctx, v, { lateral: objectLateral(obj), height: 11, tone: 0.5 }, dz);
  const p = place(v, dz, objectLateral(obj));
  if (p.s < 5) return;
  ctx.globalAlpha = fade(dz);
  ctx.fillStyle = css(mix([36, 28, 22], FOG, fogAmount(dz)));
  ctx.fillRect(Math.round(p.x - 0.35 * p.s), Math.round(p.y - 2.6 * p.s), Math.max(2, Math.round(0.7 * p.s)), Math.round(2.6 * p.s)); // thick trunk
  ctx.fillStyle = css(mix([215, 205, 170], FOG, fogAmount(dz)));
  const m = Math.max(1, Math.round(0.07 * p.s));
  const mx = Math.round(p.x - 0.2 * p.s);
  const my = Math.round(p.y - 1.5 * p.s);
  ctx.fillRect(mx, my, m, m * 4);                  // A
  ctx.fillRect(mx + m * 2, my, m, m * 4);
  ctx.fillRect(mx, my, m * 3, m);
  ctx.fillRect(mx + m * 4, my + m, m * 3, m);      // +
  ctx.fillRect(mx + m * 5, my, m, m * 3);
  ctx.globalAlpha = 1;
}

// A dented red petrol can by the road.
function drawFuelCan(ctx, v, obj, dz) {
  if (dz < 1.3) return;
  const p = place(v, dz, objectLateral(obj));
  if (p.x < -20 || p.x > v.W + 20 || p.s < 1) return;
  const f = fogAmount(dz);
  ctx.globalAlpha = fade(dz);
  const s = p.s;
  ctx.fillStyle = css(mix([176, 42, 32], FOG, f));
  ctx.fillRect(Math.round(p.x - 0.2 * s), Math.round(p.y - 0.5 * s), Math.max(1, Math.round(0.4 * s)), Math.max(1, Math.round(0.5 * s)));
  ctx.fillStyle = css(mix([90, 20, 16], FOG, f));
  ctx.fillRect(Math.round(p.x - 0.1 * s), Math.round(p.y - 0.62 * s), Math.max(1, Math.round(0.2 * s)), Math.max(1, Math.round(0.12 * s)));
  ctx.globalAlpha = 1;
}

// A gap in the trees on the left shoulder: the old road. Easy to miss.
function drawTurnoff(ctx, v, obj, dz) {
  const rh = CONFIG.roadHalfWidth;
  const z0 = Math.max(dz, 1.2);
  if (dz + 12 < 1.2) return;
  ctx.fillStyle = "rgba(6,8,6,0.9)";
  ctx.beginPath();
  addRoadQuad(ctx, v, z0, dz + 12, -(rh + 1.1), -(rh + 4));
  ctx.fill();
  if (dz > 1.5) {
    ctx.globalAlpha = fade(dz);
    for (const lat of [-(rh + 1.3), -(rh + 3.8)]) {
      const p = place(v, dz, lat);
      ctx.fillStyle = css(mix([200, 200, 196], FOG, fogAmount(dz)));
      ctx.fillRect(Math.round(p.x), Math.round(p.y - 0.7 * p.s), Math.max(1, Math.round(0.1 * p.s)), Math.max(1, Math.round(0.7 * p.s)));
    }
    ctx.globalAlpha = 1;
  }
}

// When you are scared you see people at the edge of the road that are not there.
function drawHallucinations(ctx, v, e) {
  if (e.dread < 40) return;
  const count = 1 + (e.dread > 65 ? 1 : 0) + (e.dread > 85 ? 1 : 0);
  const slot = Math.floor(e.time * 0.8);
  const phase = (e.time * 0.8) % 1;
  if (phase > 0.5) return;
  for (let i = 0; i < count; i++) {
    const seed = slot * 7.3 + i * 31.7;
    if (hash(seed) < 0.4) continue;
    const dz = 22 + hash(seed + 1) * 70;
    const side = hash(seed + 2) > 0.5 ? 1 : -1;
    const p = place(v, dz, side * (CONFIG.roadHalfWidth + 1.2 + hash(seed + 3) * 5));
    const s = p.s;
    const R = Math.round;
    ctx.globalAlpha = 0.55 * (1 - phase * 1.6);
    ctx.fillStyle = "rgb(150,160,172)";
    ctx.fillRect(R(p.x - 0.35 * s), R(p.y - 1.7 * s), Math.max(1, R(0.7 * s)), Math.max(1, R(1.7 * s)));
    ctx.fillStyle = "rgb(210,216,220)";
    ctx.fillRect(R(p.x - 0.15 * s), R(p.y - 2.05 * s), Math.max(1, R(0.3 * s)), Math.max(1, R(0.3 * s)));
  }
  ctx.globalAlpha = 1;
}

// The headlights behind you light up the inside of the car when they get close.
function drawChaseGlare(ctx, v, e) {
  if (!e.chaserActive || e.chaserGap > 80) return;
  const k = (80 - Math.max(0, e.chaserGap)) / 80;
  const flick = 0.75 + 0.25 * Math.sin(e.time * 31);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = `rgba(255,246,220,${(k * 0.28 * flick).toFixed(3)})`;
  ctx.fillRect(0, 0, v.W, v.H);
  ctx.fillStyle = `rgba(255,255,255,${(k * 0.5).toFixed(3)})`;
  ctx.fillRect(Math.round(v.W * 0.38), 0, Math.round(v.W * 0.24), Math.round(v.H * 0.2)); // mirror glare
  ctx.restore();
}

// Fear: the edges of the screen pulse red, faster as it rises.
function drawDreadOverlay(ctx, v, e) {
  if (e.dread < 30) return;
  const pulse = 0.65 + 0.35 * Math.sin(e.time * (4 + e.dread / 12));
  const a = ((e.dread - 30) / 70) * 0.5 * pulse;
  const g = ctx.createRadialGradient(v.W / 2, v.H / 2, v.H * 0.3, v.W / 2, v.H / 2, v.W * 0.62);
  g.addColorStop(0, "rgba(120,0,0,0)");
  g.addColorStop(1, `rgba(120,0,0,${a.toFixed(3)})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, v.W, v.H);
}

// ============================================================
// PETROL PUMP SCENE
// ============================================================
function drawPumpScene(ctx, W, H, e) {
  const R = Math.round;
  const horizon = R(H * 0.55);

  // sky
  const g = ctx.createLinearGradient(0, 0, 0, horizon);
  g.addColorStop(0, "#03060b");
  g.addColorStop(1, "#24323c");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, horizon);
  ctx.fillStyle = "#cfd9e0";
  ctx.fillRect(R(W * 0.8) - 3, R(H * 0.14) - 4, 7, 9);
  ctx.fillRect(R(W * 0.8) - 4, R(H * 0.14) - 3, 9, 7);

  // trees on both sides
  ctx.fillStyle = "#0b1311";
  for (let i = 0; i < W; i += 7) {
    const h = 14 + hash(i * 0.37) * 26;
    if (i > W * 0.3 && i < W * 0.78 && hash(i) > 0.35) continue; // clearing around the station
    ctx.beginPath();
    ctx.moveTo(i - 5, horizon);
    ctx.lineTo(i, horizon - h);
    ctx.lineTo(i + 5, horizon);
    ctx.closePath();
    ctx.fill();
  }

  // ground + road
  ctx.fillStyle = "#171c19";
  ctx.fillRect(0, horizon, W, H - horizon);
  ctx.fillStyle = "#32363b";
  ctx.fillRect(0, R(H * 0.82), W, R(H * 0.18));
  ctx.fillStyle = "#c2b27a";
  for (let x = 6; x < W; x += 28) ctx.fillRect(x, R(H * 0.91), 14, 1);

  // station building
  const bx = R(W * 0.18);
  const bw = R(W * 0.34);
  const by = R(H * 0.36);
  const bh = horizon - by + 4;
  ctx.fillStyle = "#1c2024";
  ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = "#101316";
  ctx.fillRect(bx - 3, by - 5, bw + 6, 6);
  drawText(ctx, "ROADWAY PETROL", bx + bw / 2, by - 12, 1, "#e6d890", "center");
  // lit windows (one flickers)
  const flicker = Math.sin(e.time * 11) + Math.sin(e.time * 3.1) > 1.2 ? "#4a4630" : "#d9c878";
  ctx.fillStyle = "#d9c878";
  ctx.fillRect(bx + 8, by + 12, 22, 16);
  ctx.fillStyle = flicker;
  ctx.fillRect(bx + 38, by + 12, 22, 16);
  ctx.fillStyle = "#0a0c0e";
  ctx.fillRect(bx + bw - 24, by + 10, 16, bh - 10);
  drawText(ctx, "OPEN", bx + bw - 16, by + 14, 1, "#e6e6e0", "center");

  // fuel pump
  const px = R(W * 0.62);
  ctx.fillStyle = "#6a2a24";
  ctx.fillRect(px, R(H * 0.44), 24, horizon - R(H * 0.44) + 6);
  ctx.fillStyle = "#050909";
  ctx.fillRect(px + 3, R(H * 0.47), 18, 12);
  drawText(ctx, `${Math.round(e.fuel)}%`, px + 12, R(H * 0.47) + 3, 1, "#7fe0c0", "center");
  ctx.fillStyle = "#14161a";
  ctx.fillRect(px + 24, R(H * 0.5), 2, 18); // hose

  // road sign
  const sx = R(W * 0.9);
  ctx.fillStyle = "#3a3d40";
  ctx.fillRect(sx, R(H * 0.52), 2, horizon - R(H * 0.52) + 8);
  ctx.fillStyle = "#1e5d3b";
  ctx.fillRect(sx - 18, R(H * 0.42), 38, 14);
  drawText(ctx, "FOREST", sx + 1, R(H * 0.42) + 2, 1, "#f0f0ea", "center");
  drawText(ctx, "ROAD", sx + 1, R(H * 0.42) + 8, 1, "#f0f0ea", "center");

  // street light with a cone of light
  const lx = R(W * 0.56);
  ctx.fillStyle = "#2a2d30";
  ctx.fillRect(lx, R(H * 0.3), 2, horizon - R(H * 0.3) + 6);
  ctx.fillStyle = "#e6d890";
  ctx.fillRect(lx - 4, R(H * 0.3), 9, 2);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = "rgba(230,216,144,0.08)";
  ctx.beginPath();
  ctx.moveTo(lx, R(H * 0.31));
  ctx.lineTo(lx - 34, R(H * 0.82));
  ctx.lineTo(lx + 36, R(H * 0.82));
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  drawText(ctx, "PLAY >", 5, 5, 1, "#e6e6e0");
  drawText(ctx, "12:47 AM", W - 5, 5, 1, "#e6e6e0", "right");
}

export { textWidth };
