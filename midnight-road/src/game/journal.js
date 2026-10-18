// ============================================================
// src/game/journal.js
// Everything you can learn is a "clue" with an id. The text is written
// here (some of it uses the secret name chosen for this playthrough).
// ============================================================

// Clues are shown in this order in the journal (Tab).
export const JOURNAL_ORDER = [
  "missing_man_article",
  "heard_name_a", "car_didnt_stop",
  "carved_initials", "phone_call", "radio_voice", "radio_voice2",
  "registration", "receipt", "photograph", "phone", "map", "keychain",
  "shrine_read",
  "ghost_no28", "ghost_place", "ghost_chaser", "ghost_passed", "ghost_remembers", "confessed",
];

const fullName = (s) => `${s.truth.name.toUpperCase()} ${s.truth.surname.toUpperCase()}`;

const TEXT = {
  missing_man_article: () => "NEWS: A man is missing after a night accident. Avoid stopping near Mile 27.",
  heard_name_a: () => "The man by the road could only remember that his name starts with an A.",
  car_didnt_stop: () => "He says a car with headlights passed him and did not slow down.",
  carved_initials: () => "A carved tree: \"A + N\". Under it: \"LEFT, WHERE THE LIGHTS END.\"",
  phone_call: () => "The payphone: \"The marker is wrong. Stop BEFORE it, where the candle burns.\"",
  radio_voice: (s) => `Radio 91.7: a voice repeating "${s.truth.decoys[0].toUpperCase()}... ${s.truth.decoys[0].toUpperCase()}..."`,
  radio_voice2: (s) => `Radio 91.7, later: "NOT ${s.truth.decoys[0].toUpperCase()}. ${s.truth.name.toUpperCase()}."`,
  registration: () => "Sedan: the plate is scratched out. Same make and colour as YOUR car.",
  receipt: () => "Sedan: a petrol receipt. ROADWAY PETROL, 12:47 AM, \u20B9250. Same as yours.",
  photograph: (s) => `Sedan: a photo of a man beside this car. On the back: "${s.truth.name.toUpperCase()}, COMING HOME. 12:47."`,
  phone: () => "Sedan: a cracked phone. 14 missed calls from HOME. Last message: \"A car passed. Nobody stopped.\"",
  map: () => "Sedan: a map. Mile 27 circled. In shaky ink: \"NOT AT THE SIGN. WHERE I FELL.\"",
  keychain: (s) => `Sedan: a brass tag "${s.truth.name.toUpperCase()}". The key fits YOUR ignition.`,
  shrine_read: (s) => `A shrine and a candle before Mile 27: "${fullName(s)}. 12:47 AM."`,
  ghost_no28: () => "He says home is past Mile 28. There is no Mile 28.",
  ghost_place: () => "He says he fell BEFORE the marker, not at it.",
  ghost_chaser: () => "He says the headlights behind you belong to someone who never stopped.",
  ghost_passed: () => "He says nobody hit him. Someone drove past.",
  ghost_remembers: () => "He says your headlights are the ones he remembers.",
  confessed: () => "You admitted it: you drove past him and did not stop.",
};

export function clueText(id, state) {
  const fn = TEXT[id];
  return fn ? fn(state) : id;
}

// the six items inside the white sedan
export const CLUE_BUTTONS = [
  ["registration", "PLATE"],
  ["receipt", "RECEIPT"],
  ["photograph", "PHOTO"],
  ["phone", "PHONE"],
  ["map", "MAP"],
  ["keychain", "KEYCHAIN"],
];

// These items are locked on your FIRST pass. The road opens them when it comes around again.
export const LOCKED_FIRST_LOOP = ["phone", "map", "keychain"];

const NAMES = ["Arun", "Anil", "Ajay", "Amit", "Akash", "Alok", "Anand", "Ashok"];
const SURNAMES = ["Deshmukh", "Kulkarni", "Patil", "Joshi", "Bhosale"];

// Picked at the start of EVERY playthrough, so the answer is never the same twice.
export function makeTruth() {
  const pool = [...NAMES].sort(() => Math.random() - 0.5);
  const [name, d1, d2] = pool;
  const order = [name, d1, d2].sort(() => Math.random() - 0.5);
  return {
    name,
    decoys: [d1, d2],
    order,
    surname: SURNAMES[Math.floor(Math.random() * SURNAMES.length)],
  };
}
