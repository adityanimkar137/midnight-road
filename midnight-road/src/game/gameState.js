export const gameState = {
    gameStatus: "menu",

    location: "petrol_pump",

    time: "12:47 AM",

    fuel: 18,
    money: 500,

    carCondition: 100,
    speed: 0,
    distance: 0,

    headlights: "normal",
    engine: "normal",
    radio: "music",

    strangerChoice: null,

    loopNumber: 0,

    clues: [],
    inventory: [],

    mirrorState: "normal",

    anomalyLevel: 0,

    finalAnswerFound: false,
    escapedLoop: false,

    fuelFilled: false,
    newsRead: false,

    steering: 0,

    currentEvent: null,

    triggeredEvents: [],

    // ---- horror events ----
    caption: null,          // { text, ticks }  subtitle line (ticks = 0.1 s each)
    glitch: 0,              // static burst, ticks left
    mirrorTicks: 0,         // > 0: mirror returns to "normal" when it reaches 0
    passenger: "none",      // none | seated | glitching | gone
    passengerTicks: 0,
    carTrouble: 0,          // engine stutter, ticks left
    radioTicks: 0,          // how long the current song has been playing
    teleport: { id: 0, toKm: 0 }, // tells the driving loop to jump (loop reset)
    ending: null,           // null | silence | home   (the drive home after a good ending)
    endingTicks: 0,
    homeBase: 0,

    // ---- v3: the ghost, the chase, fear, secrets ----
    dread: 0,               // 0..100  your fear. 100 = the road keeps you
    trust: 0,               // 0..10   the ghost's trust in you
    hostility: 0,           // 0..6    the ghost's anger
    chaser: { active: false, gap: 230 }, // the headlights behind you (metres)
    catches: 0,             // times the headlights caught you (3 = replaced)
    lightsOut: 0,           // headlights dead, ticks left
    flags: {},              // small facts: tookHim, firstDone, missed, wrongNames...
    talked: [],             // "loop:id" of conversations already had
    passed: [],             // "loop:id" of meetings you drove past
    idleTicks: 0,           // how long you sat next to the ghost without talking
    stopTicks: 0,           // how long you sat at the fake STOP sign
    radioFreq: 93.5,
    tuneTicks: 0,
    truth: {                // chosen fresh every playthrough (see journal.js)
        name: "Arun",
        decoys: ["Anil", "Ajay"],
        order: ["Anil", "Arun", "Ajay"],
        surname: "Deshmukh"
    },
    endingId: null          // which ending you got
};
