// ============================================================
// src/game/pixelFont.js
// A tiny 3x5 pixel font. Each letter is 15 characters: 5 rows of 3 pixels
// ("1" = pixel on). Drawing text with fillRect keeps the text perfectly
// sharp at our low resolution, which canvas fonts cannot do.
// ============================================================
const GLYPHS = {
  A: "010101111101101", B: "110101110101110", C: "011100100100011", D: "110101101101110",
  E: "111100110100111", F: "111100110100100", G: "011100101101011", H: "101101111101101",
  I: "111010010010111", J: "001001001101010", K: "101101110101101", L: "100100100100111",
  M: "101111111101101", N: "110101101101101", O: "010101101101010", P: "110101110100100",
  Q: "010101101111011", R: "110101110101101", S: "011100010001110", T: "111010010010010",
  U: "101101101101111", V: "101101101101010", W: "101101111111101", X: "101101010101101",
  Y: "101101010010010", Z: "111001010100111",
  0: "111101101101111", 1: "010110010010111", 2: "110001010100111", 3: "110001010001110",
  4: "101101111001001", 5: "111100110001110", 6: "011100111101111", 7: "111001010010010",
  8: "111101111101111", 9: "111101111001110",
  ":": "000010000010000", ".": "000000000000010", "-": "000000111000000", "!": "010010010000010",
  "?": "110001010000010", "'": "010010000000000", "/": "001001010100100", ",": "000000000010100",
  "_": "000000000000111", "%": "101001010100101", ">": "100010001010100", "~": "000011110000000", " ": "000000000000000",
};

export const glyphWidth = (px) => 4 * px; // 3 pixels + 1 gap

export function textWidth(text, px = 1) {
  return text.length * glyphWidth(px) - px;
}

// Draw `text` with its top-left corner at (x, y). align: "left" | "center" | "right"
export function drawText(ctx, text, x, y, px = 1, color = "#fff", align = "left") {
  const str = String(text).toUpperCase();
  let cx = x;
  if (align === "center") cx = x - textWidth(str, px) / 2;
  if (align === "right") cx = x - textWidth(str, px);
  cx = Math.round(cx);
  y = Math.round(y);
  ctx.fillStyle = color;
  for (const ch of str) {
    const g = GLYPHS[ch] || GLYPHS["?"];
    for (let i = 0; i < 15; i++) {
      if (g[i] === "1") ctx.fillRect(cx + (i % 3) * px, y + Math.floor(i / 3) * px, px, px);
    }
    cx += glyphWidth(px);
  }
}
