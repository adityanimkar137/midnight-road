// ============================================================
// src/components/PumpCanvas.jsx
// The petrol pump scene, drawn with the same low-res pixel + analog look.
// (The buttons and the newspaper stay normal HTML on top of it.)
// ============================================================
import { useEffect, useRef } from "react";
import { createRenderer } from "../game/renderer.js";

const RES_HEIGHT = 180;

export default function PumpCanvas({ fuel = 18 }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const fuelRef = useRef(fuel);

  useEffect(() => {
    fuelRef.current = fuel;
  }, [fuel]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const renderer = createRenderer(canvas);

    function resize() {
      const rect = wrap.getBoundingClientRect();
      const aspect = Math.max(0.5, rect.width / Math.max(1, rect.height));
      renderer.resize(Math.min(400, Math.max(240, Math.round(RES_HEIGHT * aspect))), RES_HEIGHT);
    }
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    let rafId = 0;
    let lastDraw = 0;
    function frame(now) {
      // the pump scene is nearly still, so 15 frames a second is plenty (and VHS-like)
      if (now - lastDraw > 66) {
        lastDraw = now;
        renderer.drawPump({ time: now / 1000, fuel: fuelRef.current });
      }
      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={wrapRef} style={{ position: "absolute", inset: 0, background: "#000" }}>
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%", imageRendering: "pixelated" }}
      />
    </div>
  );
}
