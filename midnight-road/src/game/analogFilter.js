// ============================================================
// src/game/analogFilter.js
// The "analog horror" look. After the scene is drawn at LOW resolution we
// run every pixel through this filter:
//   1. VHS tracking: some rows slide sideways; a rolling band moves down
//   2. colour bleed: red and blue are shifted 1 pixel apart
//   3. washed-out, cold colours
//   4. static noise (more when `burst` is high)
//   5. scanlines
//   6. a small palette (6 levels per channel) with ordered dithering
//   7. dark corners
// `anomaly` (0..1) makes everything slowly worse as the story gets stranger.
// ============================================================

// 4x4 ordered-dither pattern (values 0..15)
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const LEVELS = 8;
const STEP = 255 / (LEVELS - 1);

export function createAnalogFilter(ctx) {
  let w = 0;
  let h = 0;
  let out = null;
  let vignette = null;

  function setup(width, height) {
    w = width;
    h = height;
    out = ctx.createImageData(w, h);
    vignette = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (x / w - 0.5) * 1.5;
        const dy = y / h - 0.5;
        vignette[y * w + x] = Math.max(0.5, 1 - (dx * dx + dy * dy) * 0.9);
      }
    }
  }

  // opts: { time, anomaly (0..1), burst (0..1) }
  function apply(width, height, opts) {
    if (width !== w || height !== h) setup(width, height);
    const { time = 0, anomaly = 0, burst = 0 } = opts;
    const src = ctx.getImageData(0, 0, w, h).data;
    const dst = out.data;

    // rolling tracking band
    const bandPeriod = 7 - anomaly * 4;                       // seconds
    const bandPos = ((time % bandPeriod) / bandPeriod) * (h + 20) - 10;
    const bandHeight = 4 + anomaly * 6;
    const noiseAmp = 5 + anomaly * 9 + burst * 70;

    for (let y = 0; y < h; y++) {
      // sideways shift for this row
      let shift = 0;
      const inBand = Math.abs(y - bandPos) < bandHeight;
      if (inBand) shift = Math.round((Math.random() - 0.5) * (4 + anomaly * 6));
      if (burst > 0 && Math.random() < burst * 0.5) shift += Math.round((Math.random() - 0.5) * 24 * burst);
      const scan = y & 1 ? 0.8 : 1;

      for (let x = 0; x < w; x++) {
        const sx = x + shift;
        const xr = Math.min(w - 1, Math.max(0, sx - 1));
        const xg = Math.min(w - 1, Math.max(0, sx));
        const xb = Math.min(w - 1, Math.max(0, sx + 1));
        const row = y * w;
        let r = src[(row + xr) * 4];
        let g = src[(row + xg) * 4 + 1];
        let b = src[(row + xb) * 4 + 2];

        // washed-out cold colours
        const l = 0.3 * r + 0.59 * g + 0.11 * b;
        r = l + (r - l) * 0.7;
        g = l + (g - l) * 0.7;
        b = l + (b - l) * 0.7;
        r *= 0.95;
        b *= 1.04;

        // noise (+ full static during a burst)
        let n = (Math.random() - 0.5) * noiseAmp;
        if (inBand) n += 14;
        if (burst > 0.4 && Math.random() < burst * 0.3) {
          const s = Math.random() * 255;
          r = g = b = s;
          n = 0;
        }

        // scanlines + dark corners
        const k = scan * vignette[row + x] * 1.3; // slight brightness lift

        // palette + dither
        const t = (BAYER[((y & 3) << 2) | (x & 3)] / 16 - 0.5) * STEP * 0.6;
        const i = (row + x) * 4;
        dst[i] = Math.round((r * k + n + t) / STEP) * STEP;
        dst[i + 1] = Math.round((g * k + n + t) / STEP) * STEP;
        dst[i + 2] = Math.round((b * k + n + t) / STEP) * STEP;
        dst[i + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
  }

  return { apply };
}
