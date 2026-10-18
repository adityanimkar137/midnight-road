# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## MIDNIGHT ROAD: how the game works

A dead man waits on the forest road. Something follows you with its headlights on. The road
repeats. Learn the truth, stop in the right place, and say the right words.

**Look and sound:** drawn on a tiny 180-pixel canvas, run through a VHS filter (`analogFilter.js`),
scaled up with crisp pixels. A 3x5 pixel font (`pixelFont.js`) draws all in-world text. Sound is made
live with the Web Audio API (`audio.js`): engine, wind, radio pad, static, heartbeat, chase rumble, scares. M mutes.

**Controls:** W/Up gas, S/Down/Space brake, A/D steer, F headlights, Q (hold) mirror,
E examine, T talk, R engine on/off, `,` and `.` radio dial, Tab journal.

**The pressure (threats.js)**
- Headlights follow you from story km 10.6 every loop. Faster than ~60 km/h pulls away; stopping lets them close in. Caught 3 times = replaced.
- Talking, examining and investigating each cost distance, so every stop is a decision.
- Fear (dread) rises near the headlights, in the dark and when you anger him. Visions, a lying speedometer, his face in the mirror. At 100 the road keeps you.
- Drive past him without stopping and you pay: fear, his anger, closer headlights, and next loop he stands in your lane.

**The mystery (dialogue.js, journal.js, world.js)**
- His real name is random every playthrough, plus two decoys. Evidence (photo, keychain, shrine) beats guessing; a radio voice at 91.7 gives the wrong name.
- Part of the sedan is locked until the second pass. Secrets: carved tree, payphone (rings from loop 1), fuel can, a fake STOP sign trap, a hidden old road, the shrine.
- Dialogue options appear only if you have the evidence for them.

**Seven endings:** HOME, AT REST, THE DRIVER, THE OLD ROAD (secret), HE GETS HOME, REPLACED, THE ROAD KEEPS YOU.
Found endings are saved in the browser. Bad endings show a hint.

| File | What it does |
|---|---|
| `game/driving.js` | driving physics, road shape, forest. All tuning numbers in `CONFIG`. |
| `game/world.js` | what is on the road + the list of things you can talk to / examine. |
| `game/events.js` | the horror events table, the loop, the drive home. |
| `game/threats.js` | fear, the chase, missing him, radio and secret traps. |
| `game/dialogue.js` | the conversations (data). |
| `game/journal.js`, `endings.js` | clue texts, random truth, ending texts. |
| `game/gameEngine.js` | applyTelemetry(), E/T/R/radio actions. |
| `game/renderer.js`, `analogFilter.js`, `pixelFont.js`, `audio.js` | pixel renderer, VHS filter, font, sound. |
| `components/*.jsx`, `App.jsx` | React: state, loop with delta time, UI. |

`#debug` at the end of the address: press `]` to jump 1 story km ahead.
