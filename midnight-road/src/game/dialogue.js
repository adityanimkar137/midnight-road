// ============================================================
// src/game/dialogue.js
// CONVERSATIONS WITH THE GHOST, as data.
//
// A tree has nodes. A node has what HE says and your options. An option has:
//   text     what you say
//   next     the node to go to (or `end: true` to close the conversation)
//   requires (state) -> true/false : the option only appears if you earned it
//   effect   (state) -> new state  : what it changes (trust, fear, clues, endings)
//   cost     metres the headlights behind you gain while you talk (default 15)
//   reply    what he says if you stay on the same node
// Options with `next` disappear once used, so you cannot just click them all.
// Some options only appear if you found the right EVIDENCE (see journal.js).
// ============================================================
import {
  say, burst, addDread, addTrust, addHostility, addClue, hasClue, setFlag,
  moveChaser, endGame, startHomeRoad, caught,
} from "./stateTools";

const has = (...ids) => (s) => ids.every((id) => hasClue(s, id));

// The conversation by the road. Sets state.strangerChoice (take / reject / ignore)
// so the rest of the game keeps working.
const takeHim = (s) => {
  let n = setFlag(setFlag(addTrust(s, 2), "tookHim"), "firstDone");
  n = { ...n, strangerChoice: "take", passenger: "seated", passengerTicks: 0, anomalyLevel: 2 };
  return say(n, "HE SITS BESIDE YOU. \"DON'T STOP AT THE NEXT MARKER.\"", 55);
};

export const TREES = {
  // ---------------------------------------------------------------- first meeting
  first: {
    nodes: {
      start: {
        say: () => "\"...please. I have to get home. Is this the road to town?\"",
        options: [
          { text: "Get in. I'll take you home.", end: true, effect: takeHim },
          { text: "Who are you?", next: "who", cost: 20, effect: (s) => addClue(s, "heard_name_a") },
          { text: "What happened to you?", next: "what", cost: 20, effect: (s) => addClue(addDread(s, 4), "car_didnt_stop") },
          { text: "Are you hurt? Do you need a doctor?", next: "doctor", cost: 15, effect: (s) => addDread(s, 6) },
          {
            text: "I can't help you.", end: true,
            effect: (s) => say({ ...setFlag(addDread(addHostility(addTrust(s, -1), 1), 5), "firstDone"), strangerChoice: "reject", anomalyLevel: 2 }, "HE WALKS INTO THE TREES. HE IS STILL WATCHING.", 45),
          },
          {
            text: "(Say nothing. Drive on.)", end: true,
            effect: (s) => say({ ...setFlag(addDread(s, 6), "firstDone"), strangerChoice: "ignore", anomalyLevel: 3 }, "YOU DRIVE ON. HE DOES NOT TURN HIS HEAD.", 45),
          },
        ],
      },
      who: {
        say: () => "\"It starts with an A... I can't hold the rest. Please. It's so cold.\"",
        options: [{ text: "Go on.", next: "start", once: false, cost: 0 }],
      },
      what: {
        say: () => "\"Headlights. A car that didn't slow down. I called out. It kept going.\"",
        options: [{ text: "Go on.", next: "start", once: false, cost: 0 }],
      },
      doctor: {
        say: () => "\"It's too late for that. It has been for a long time.\"",
        options: [{ text: "Go on.", next: "start", once: false, cost: 0 }],
      },
    },
  },

  // ---------------------------------------------------------------- he is still there
  again: {
    nodes: {
      start: {
        say: (s) => (s.flags.missedRoadside ? "\"You drove past me. Again. ...Will you stop now?\"" : "\"You came back. Will you take me now?\""),
        options: [
          { text: "Get in.", end: true, effect: (s) => takeHim(addTrust(s, 1)) },
          { text: "Why me?", next: "why", cost: 20, effect: (s) => addClue(addDread(s, 8), "ghost_remembers") },
          { text: "No.", end: true, effect: (s) => say(addDread(addHostility(s, 1), 6), "HE DOES NOT ARGUE. THE AIR GETS COLDER.", 40) },
        ],
      },
      why: {
        say: () => "\"Because your headlights are the ones I remember.\"",
        options: [{ text: "Go on.", next: "start", once: false, cost: 0 }],
      },
    },
  },

  // ---------------------------------------------------------------- the passenger
  seat: {
    nodes: {
      start: {
        say: () => "\"The road is wrong tonight. It always is.\"",
        options: [
          { text: "Where is home?", next: "home", cost: 0, effect: (s) => addClue(s, "ghost_no28") },
          { text: "What is special about the next marker?", requires: (s) => s.trust >= 2, next: "marker", cost: 0, effect: (s) => addClue(s, "ghost_place") },
          { text: "What is special about the next marker?", requires: (s) => s.trust < 2, next: "marker_no", cost: 0 },
          { text: "Who is behind us?", next: "behind", cost: 0, effect: (s) => addClue(addDread(s, 8), "ghost_chaser") },
          { text: "Are you dead?", next: "dead", cost: 0, effect: (s) => addDread(s, 10) },
          { text: "Be quiet.", end: true, effect: (s) => say(addTrust(s, -1), "HE TURNS TO THE WINDOW. THE GLASS FOGS.", 40) },
          { text: "That's enough.", end: true },
        ],
      },
      home: { say: () => "\"Past Mile 28. There is no Mile 28. That is the whole problem.\"", options: [{ text: "Go on.", next: "start", once: false, cost: 0 }] },
      marker: { say: () => "\"The marker is wrong. Where I fell is BEFORE it, in the dark, where a candle burns.\"", options: [{ text: "Go on.", next: "start", once: false, cost: 0 }] },
      marker_no: { say: () => "\"...I can't say. Not yet. Ask me when you have been kind.\"", options: [{ text: "Go on.", next: "start", once: false, cost: 0 }] },
      behind: { say: () => "\"Someone who never stopped. Don't let them stop beside you.\"", options: [{ text: "Go on.", next: "start", once: false, cost: 0 }] },
      dead: { say: () => "\"...Are you?\"", options: [{ text: "Go on.", next: "start", once: false, cost: 0 }] },
    },
  },

  // ---------------------------------------------------------------- at the wreck
  wreck: {
    nodes: {
      start: {
        say: () => "\"That's my car. I was almost home.\"",
        options: [
          { text: "Did you see who hit you?", next: "who_hit", effect: (s) => addClue(s, "ghost_passed") },
          { text: "I'm sorry.", next: "sorry", effect: (s) => addDread(addTrust(s, 2), -5) },
          { text: "I wasn't here.", next: "liar", effect: (s) => addDread(addHostility(addTrust(s, -1), 1), 10) },
          {
            text: "I remember... I drove by. I didn't stop.", requires: has("phone", "receipt"), next: "confess",
            effect: (s) => addClue(addDread(addTrust(s, 3), 8), "confessed"),
          },
          {
            text: "(Leave.)", end: true,
            effect: (s) => (s.flags.tookHim && s.trust >= 1 ? { ...s, passenger: "seated", passengerTicks: 0 } : s),
          },
        ],
      },
      who_hit: { say: () => "\"Nobody hit me. Someone drove past. That was worse.\"", options: [{ text: "Go on.", next: "start", once: false, cost: 0 }] },
      sorry: { say: () => "\"You don't know what you're sorry for. Yet.\"", options: [{ text: "Go on.", next: "start", once: false, cost: 0 }] },
      liar: { say: () => "\"Liar. I remember your headlights.\"", options: [{ text: "Go on.", next: "start", once: false, cost: 0 }] },
      confess: { say: () => "\"Yes. Say that again when you reach the candle.\"", options: [{ text: "Go on.", next: "start", once: false, cost: 0 }] },
    },
  },

  // ---------------------------------------------------------------- the candle (final)
  shrine: {
    // If he is furious by the time you stop, he does not wait for questions.
    onOpen: (s) => (s.hostility >= 5 ? endGame(s, "hostile") : s),
    nodes: {
      start: {
        say: () => "\"You stopped. ...Say my name.\"",
        options: (s) =>
          s.truth.order.map((name) => ({
            text: `"${name}."`,
            cost: 12,
            ...(name === s.truth.name
              ? { next: "truth", effect: (n) => addTrust(n, 1) }
              : {
                  next: "start",
                  reply: "\"No.\"",
                  effect: (n) => {
                    const wrong = (n.flags.wrongNames || 0) + 1;
                    const next = setFlag(addDread(addHostility(n, 2), 15), "wrongNames", wrong);
                    return wrong >= 2 ? endGame(next, "hostile") : burst(next, 8);
                  },
                }),
          })),
      },
      truth: {
        say: () => "\"Do you remember the road that night?\"",
        options: [
          { text: "I drove past you. I never stopped.", requires: has("phone", "receipt"), next: "forgive", effect: (s) => addClue(addTrust(s, 3), "confessed") },
          {
            text: "It wasn't me.", next: "truth", cost: 0, reply: "\"Then who is behind you?\"",
            effect: (s) => burst(moveChaser(addDread(addHostility(s, 2), 20), -90), 10),
          },
          { text: "I think I was the one in the sedan.", requires: has("registration", "keychain"), end: true, effect: (s) => endGame(s, "driver") },
          { text: "I don't remember anything.", next: "truth", cost: 30, reply: "\"Then remember.\"", effect: (s) => addHostility(s, 1) },
        ],
      },
      forgive: {
        say: () => "\"I only wanted someone to stop. Take me home.\"",
        options: [
          {
            text: "Get in. We'll go home together.", requires: (s) => s.flags.tookHim || s.trust >= 4, end: true,
            effect: (s) => startHomeRoad(s, "home"),
          },
          {
            text: "I'll tell them where you are. They will find you.", requires: has("map", "shrine_read"), end: true,
            effect: (s) => startHomeRoad(s, "rest"),
          },
          {
            text: "Goodbye.", end: true,
            effect: (s) => burst(say(addDread(addHostility(s, 1), 10), "HE FADES. THE HEADLIGHTS RETURN.", 45), 10),
          },
        ],
      },
    },
  },
};

// the options the player can see right now (some need evidence, some are used up)
export function visibleOptions(state, event) {
  const node = TREES[event.tree].nodes[event.node];
  const list = typeof node.options === "function" ? node.options(state) : node.options;
  return list
    .map((opt, i) => ({ opt, key: `${event.node}:${i}` }))
    .filter(({ opt, key }) => (!opt.requires || opt.requires(state)) && !event.used.includes(key));
}

export function openDialogue(state, treeId) {
  const tree = TREES[treeId];
  let next = {
    ...state,
    currentEvent: { type: "dialogue", tree: treeId, node: "start", used: [], said: null },
  };
  if (tree.onOpen) next = tree.onOpen(next);
  if (next.gameStatus !== "playing") return next;
  const said = tree.nodes.start.say(next);
  return { ...next, currentEvent: { ...next.currentEvent, said } };
}

// the player picked option number `index` of visibleOptions()
export function chooseOption(state, index) {
  const event = state.currentEvent;
  if (event?.type !== "dialogue") return state;
  const choice = visibleOptions(state, event)[index];
  if (!choice) return state;
  const { opt, key } = choice;

  // talking costs time: the headlights behind you get closer
  let next = moveChaser(state, -(opt.cost ?? 15));
  if (opt.effect) next = opt.effect(next);
  if (next.gameStatus !== "playing") return next; // an ending happened
  if (next.chaser.active && next.chaser.gap <= 0) return caught(next); // the headlights arrived while you talked

  if (opt.end) return { ...next, currentEvent: null };

  const used = opt.once === false ? event.used : [...event.used, key];
  const nodeId = opt.next || event.node;
  const node = TREES[event.tree].nodes[nodeId];
  const said = opt.reply || node.say(next);
  return { ...next, currentEvent: { ...event, node: nodeId, used, said } };
}
