// ============================================================
// src/components/DrivingCanvas.jsx
// The React side of the driving scene.
//
// React handles: props, keyboard events, starting/stopping the loop.
// Canvas  handles: all the drawing (see game/renderer.js).
//
// THE GAME LOOP (runs once per screen refresh):
//   time delta -> updateDriving (physics) -> distance -> renderer.draw
// The driving numbers live in a useRef (not useState) because they change
// 60 times a second and we don't want React to re-render that often.
//
// The canvas is LOW resolution (180 pixels tall). CSS scales it up with
// crisp pixels, which is what gives the pixel-art / analog look.
// ============================================================
import { useEffect, useRef } from "react";
import { CONFIG, createDrivingState, updateDriving } from "../game/driving.js";
import { createRenderer } from "../game/renderer.js";
import { audio } from "../game/audio.js";

const RES_HEIGHT = 180; // internal resolution (pixels tall)
const DEBUG = typeof window !== "undefined" && window.location.hash.includes("debug");

// Which keyboard key does which action (e.code = physical key, works on any layout)
const KEY_MAP = {
  KeyW: "forward", ArrowUp: "forward",
  KeyS: "brake", ArrowDown: "brake", Space: "brake",
  KeyA: "left", ArrowLeft: "left",
  KeyD: "right", ArrowRight: "right",
  KeyQ: "mirror",
};

export default function DrivingCanvas({
  headlights = "normal",
  fuel = 18,
  radio = "music",
  radioFreq = 93.5,
  radioTicks = 0,
  mirrorState = "normal",
  clock = "12:47 AM",
  passenger = "none",
  world = { objects: [], treeDensity: 1 },
  glitch = 0,
  anomaly = 0,
  carTrouble = 0,
  dread = 0,
  hostility = 0,
  chaser = { active: false, gap: 230 },
  lightsOut = 0,
  engineOn = true,         // false when the tank is empty or the engine is switched off
  controlsLocked = false,  // true during a conversation: the car brakes to a stop by itself
  teleport = { id: 0, toKm: 0 }, // the story asks the car to jump (loop reset)
  initialDistanceKm = 0,
  paused = false,
  onTelemetry,             // called ~10x/second: { speed, distance, steering, lanePosition, teleportId }
  onHeadlightsChange,      // F
  onInteract,              // E  (examine)
  onTalk,                  // T  (talk to him)
  onToggleEngine,          // R
  onTune,                  // , and .  (radio)
  onDebugJump,             // only with #debug in the address: press ]
}) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const drivingRef = useRef(null);
  if (drivingRef.current === null) drivingRef.current = createDrivingState(initialDistanceKm);

  // Held keys. W stays true for as long as the key is down.
  const keysRef = useRef({ forward: false, brake: false, left: false, right: false, mirror: false });

  // The loop reads the latest props through refs so it never has to restart.
  const headlightsRef = useRef(headlights);
  const propsRef = useRef({});
  const appliedTeleportRef = useRef(teleport.id);

  useEffect(() => {
    propsRef.current = {
      fuel, radio, radioFreq, radioTicks, mirrorState, clock, passenger, world, glitch, anomaly,
      carTrouble, dread, hostility, chaser, lightsOut, engineOn, controlsLocked, teleport, paused,
      onTelemetry, onHeadlightsChange, onInteract, onTalk, onToggleEngine, onTune, onDebugJump,
    };
  });

  useEffect(() => {
    headlightsRef.current = headlights;
  }, [headlights]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const driving = drivingRef.current;
    const keys = keysRef.current;
    const renderer = createRenderer(canvas);

    // ---- low-res canvas: always 180 px tall, width follows the window shape ----
    function resize() {
      const rect = wrap.getBoundingClientRect();
      const aspect = Math.max(0.5, rect.width / Math.max(1, rect.height));
      const width = Math.min(400, Math.max(240, Math.round(RES_HEIGHT * aspect)));
      renderer.resize(width, RES_HEIGHT);
    }
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    // ---- keyboard ----
    function onKeyDown(event) {
      audio.start(); // browsers only allow sound after a key press / click
      const action = KEY_MAP[event.code];
      if (action) {
        keys[action] = true;
        event.preventDefault();
        return;
      }
      const p = propsRef.current;
      // the radio dial can be held down
      if (event.code === "Comma") p.onTune?.(-0.1);
      if (event.code === "Period") p.onTune?.(0.1);
      if (event.repeat) return;
      if (event.code === "KeyF") {
        const next = headlightsRef.current === "off" ? "normal" : "off";
        headlightsRef.current = next;
        p.onHeadlightsChange?.(next);
      }
      if (event.code === "KeyE") p.onInteract?.();
      if (event.code === "KeyT") p.onTalk?.();
      if (event.code === "KeyR") p.onToggleEngine?.();
      if (event.code === "KeyM") audio.toggleMute();
      if (DEBUG && event.code === "BracketRight") p.onDebugJump?.();
    }
    function onKeyUp(event) {
      const action = KEY_MAP[event.code];
      if (action) keys[action] = false;
    }
    // If the window loses focus we never get the keyup, so release everything.
    function onBlur() {
      Object.keys(keys).forEach((k) => (keys[k] = false));
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    // ---- the game loop ----
    let rafId = 0;
    let last = performance.now();
    let telemetryTimer = 0;
    let mirrorCheck = 0; // eases 0 -> 1 while Q is held

    function frame(now) {
      const dt = Math.min(Math.max((now - last) / 1000, 0), 0.05); // seconds, capped
      last = now;
      const p = propsRef.current;
      const seconds = now / 1000;

      // 0. the story can move the car (the loop sends you back down the road)
      if (p.teleport && p.teleport.id !== appliedTeleportRef.current) {
        appliedTeleportRef.current = p.teleport.id;
        driving.distance = p.teleport.toKm / CONFIG.storyKmPerRealKm;
      }

      // 1. physics: keys -> speed -> distance
      if (!p.paused) {
        const locked = p.controlsLocked;
        // engine trouble: the engine cuts in and out
        const stutter = p.carTrouble > 0 && Math.sin(seconds * 14) < -0.3;
        updateDriving(driving, {
          forward: keys.forward && p.engineOn && !locked && !stutter,
          brake: keys.brake || locked,                    // during a conversation the car stops itself
          steer: locked ? 0 : (keys.right ? 1 : 0) - (keys.left ? 1 : 0),
        }, dt);
      }
      mirrorCheck += ((keys.mirror ? 1 : 0) - mirrorCheck) * Math.min(1, dt * 8);

      // 2. draw the world from the new distance
      const lights = p.lightsOut > 0 ? "off" : headlightsRef.current; // the headlights can die
      renderer.draw(driving, {
        time: seconds,
        headlights: lights,
        fuel: p.fuel,
        radio: p.radio,
        radioFreq: p.radioFreq,
        radioTicks: p.radioTicks,
        mirrorState: p.mirrorState,
        mirrorCheck,
        clock: p.clock,
        passenger: p.passenger,
        world: p.world,
        glitch: p.glitch,
        anomaly: Math.max(p.anomaly, p.dread / 14),
        carTrouble: p.carTrouble,
        dread: p.dread,
        hostility: p.hostility,
        engineOn: p.engineOn,
        chaserActive: p.chaser.active,
        chaserGap: p.chaser.gap,
      });

      // 3. sound follows the same numbers
      audio.update({
        speed: driving.speed * 3.6,
        engineOn: p.engineOn,
        radio: p.radio,
        radioFreq: p.radioFreq,
        dread: p.dread,
        glitch: p.glitch,
        chaserActive: p.chaser.active,
        chaserGap: p.chaser.gap,
      });

      // 4. tell the rest of the game (events, HUD) a few times per second
      telemetryTimer += dt;
      if (telemetryTimer >= 0.1) {
        telemetryTimer = 0;
        p.onTelemetry?.({
          speed: Math.round(driving.speed * 3.6),        // km/h
          distance: driving.distance,                    // real km
          steering: driving.steer,
          lanePosition: driving.lanePosition,
          teleportId: appliedTeleportRef.current,
        });
      }

      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);

    // cleanup when the component goes away
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%", height: "100%", background: "#000" }}>
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%", imageRendering: "pixelated" }}
      />
    </div>
  );
}
