// ============================================================
// src/game/gameEngine.js
// Game LOGIC: fuel, news, talking, examining, endings.
//
// The driving itself (acceleration, speed, distance) lives in driving.js and
// runs inside the animation loop in DrivingCanvas.jsx. About 10 times per
// second that loop reports { speed, distance, steering, lanePosition } and
// applyTelemetry() below turns it into game events.
// ============================================================
import { CONFIG } from "./driving";
import { POIS } from "./world";
import { gameState as initialGameState } from "./gameState";
import { makeTruth, clueText, CLUE_BUTTONS as BUTTONS, LOCKED_FIRST_LOOP } from "./journal";
import { openDialogue, chooseOption } from "./dialogue";
import {
    say,
    burst,
    addDread,
    addClue,
    setFlag,
    moveChaser,
    endGame,
    caught
} from "./stateTools";
import {
    tickTimers,
    runEvents,
    checkLoop,
    advanceEnding
} from "./events";
import {
    metresTo,
    tickDread,
    tickChaser,
    tickEncounters,
    tickRadio,
    tickSecrets
} from "./threats";

export const CLUE_BUTTONS = BUTTONS;

// Fuel used per story kilometre.
const FUEL_PER_STORY_KM = 0.246;

export function startGame(state) {
    return {
        ...state,
        gameStatus: "playing",
        location: "petrol_pump",
        truth: makeTruth() // a new secret name every playthrough
    };
}

export function restartGame() {
    return {
        ...structuredClone(initialGameState),
        gameStatus: "playing",
        truth: makeTruth()
    };
}

export function fillFuel(state) {
    if (
        state.money <= 0 ||
        state.fuel >= 100
    ) {
        return state;
    }

    const fuelToAdd = Math.min(
        50,
        100 - state.fuel
    );

    return {
        ...state,
        fuel:
            state.fuel +
            fuelToAdd,
        money:
            state.money -
            fuelToAdd * 5,
        fuelFilled: true
    };
}

export function readNews(state) {
    if (
        state.clues.includes(
            "missing_man_article"
        )
    ) {
        return state;
    }

    return {
        ...state,
        newsRead: true,
        clues: [
            ...state.clues,
            "missing_man_article"
        ]
    };
}

export function startDriving(state) {
    if (!state.fuelFilled) {
        return state;
    }

    return {
        ...state,
        location: "road_1",
        speed: 0,
        distance: 0,
        steering: 0,
        currentEvent: null,
        engine: "normal",
        radio: "music",
        radioTicks: 0
    };
}

// Called ~10 times a second by the driving loop.
//   telemetry = { speed (km/h), distance (REAL km), steering, lanePosition, teleportId }
// The game's own `distance` is measured in STORY km (5 = warning sign,
// 10 = Mile 27, 11 = the man), so we convert with CONFIG.storyKmPerRealKm.
export function applyTelemetry(state, telemetry) {
    if (
        state.location !== "road_1" ||
        state.gameStatus !== "playing"
    ) {
        return state;
    }

    // After a loop reset the canvas needs a moment to jump; ignore
    // old readings that still carry the previous teleport number.
    if (telemetry.teleportId !== state.teleport.id) {
        return state;
    }

    const storyDistance =
        telemetry.distance *
        CONFIG.storyKmPerRealKm;

    const storyKmDriven = Math.max(
        0,
        storyDistance - state.distance
    );

    const fuel = Math.max(
        0,
        state.fuel -
            storyKmDriven *
                FUEL_PER_STORY_KM
    );

    let n = tickTimers({
        ...state,
        speed: telemetry.speed,
        steering: Number(
            telemetry.steering.toFixed(2)
        ),
        distance: Number(
            storyDistance.toFixed(3)
        ),
        fuel: Number(fuel.toFixed(2)),
        engine:
            fuel <= 0
                ? "off"
                : state.engine
    });

    // after a good ending the road is calm: no fear, no chase, no events
    if (n.ending) {
        return advanceEnding(n);
    }

    // the pressure
    n = tickDread(n, telemetry);
    n = tickChaser(n, telemetry);
    if (n.gameStatus !== "playing") return n;
    n = tickEncounters(n, telemetry);
    n = tickRadio(n);
    n = tickSecrets(n, telemetry);
    if (n.gameStatus !== "playing") return n;

    // the story
    n = runEvents(n, telemetry);
    n = advanceEnding(n);
    n = checkLoop(n);

    if (
        n.gameStatus === "playing" &&
        n.dread >= 100
    ) {
        n = endGame(n, "road");
    }

    return n;
}

// ---------------------------------------------------------------- what is near the car?

// Is something you can talk to / examine close enough? (E = examine, T = talk)
export function findInteractables(state) {
    const none = {
        talk: null,
        examine: null,
        seat: false,
        tooFast: false
    };

    if (
        state.location !== "road_1" ||
        state.currentEvent ||
        state.ending ||
        state.gameStatus !== "playing"
    ) {
        return none;
    }

    let talk = null;
    let examine = null;

    for (const poi of POIS) {
        if (!poi.when(state)) continue;

        const delta = metresTo(
            state,
            poi.km
        );

        if (delta > -10 && delta < 24) {
            if (poi.kind === "talk" && !talk)
                talk = poi;
            if (
                poi.kind === "examine" &&
                !examine
            )
                examine = poi;
        }
    }

    return {
        talk,
        examine,
        seat:
            !talk &&
            state.passenger === "seated",
        tooFast: state.speed > 12
    };
}

// ---------------------------------------------------------------- E : examine things

const examineActions = {
    tree: (s) =>
        burst(
            say(
                addDread(
                    addClue(s, "carved_initials"),
                    3
                ),
                "A TREE IS CARVED: \"A + N\". UNDER IT: \"LEFT, WHERE THE LIGHTS END.\"",
                55
            ),
            4
        ),

    phone: (s) =>
        burst(
            say(
                addDread(
                    addClue(s, "phone_call"),
                    10
                ),
                "THE PAYPHONE RINGS. A VOICE: \"THE MARKER IS WRONG. STOP BEFORE IT, WHERE THE CANDLE BURNS.\"",
                65
            ),
            9
        ),

    fuel: (s) =>
        say(
            setFlag(
                {
                    ...s,
                    fuel: Math.min(
                        100,
                        s.fuel + 25
                    )
                },
                "fuelLoop",
                s.loopNumber
            ),
            "A DENTED CAN. THERE IS STILL PETROL IN IT. (+25 FUEL)",
            45
        ),

    shrine: (s) =>
        say(
            addDread(
                addClue(s, "shrine_read"),
                -6
            ),
            `A SHRINE. A CANDLE. A NAME: "${s.truth.name.toUpperCase()} ${s.truth.surname.toUpperCase()}". 12:47. THE ENGINE IS LOUD. (R: ENGINE)`,
            70
        ),

    wreck: (s) =>
        burst(
            {
                ...s,
                currentEvent: {
                    type: "investigate",
                    text: "A WHITE SEDAN. DOORS OPEN. ENGINE OFF. SOMETHING IS LEFT ON THE SEATS."
                }
            },
            4
        )
};

export function interact(state) {
    const { examine, tooFast } =
        findInteractables(state);

    if (!examine) return state;

    if (tooFast) {
        return say(
            state,
            "SLOW DOWN.",
            20
        );
    }

    // every moment you spend stopped lets the headlights closer
    const next = moveChaser(
        examineActions[examine.id](
            state
        ),
        -10
    );

    return next.chaser.active &&
        next.chaser.gap <= 0
        ? caught(next)
        : next;
}

// ---------------------------------------------------------------- T : talk to him

export function talk(state) {
    const { talk: poi, seat, tooFast } =
        findInteractables(state);

    if (!poi && !seat) return state;

    if (poi && tooFast) {
        return say(
            state,
            "SLOW DOWN. HE IS RIGHT THERE.",
            20
        );
    }

    if (seat) {
        return openDialogue(
            state,
            "seat"
        );
    }

    const key = `${state.loopNumber}:${poi.id}`;

    const tree =
        poi.id === "ghost_roadside"
            ? state.flags.firstDone
                ? "again"
                : "first"
            : poi.id === "ghost_wreck"
              ? "wreck"
              : "shrine";

    const opened = openDialogue(
        {
            ...state,
            talked: [
                ...state.talked,
                key
            ],
            idleTicks: 0
        },
        tree
    );

    return burst(opened, 4);
}

export function chooseDialogue(
    state,
    index
) {
    return chooseOption(state, index);
}

// ---------------------------------------------------------------- the six items in the sedan

export function examineClue(
    state,
    clueId
) {
    if (
        state.currentEvent?.type !==
        "investigate"
    ) {
        return state;
    }

    // the glovebox and trunk will not open on your first pass
    if (
        state.loopNumber === 0 &&
        LOCKED_FIRST_LOOP.includes(clueId)
    ) {
        return burst(
            {
                ...state,
                currentEvent: {
                    type: "investigate",
                    text: "LOCKED. THE ROAD WILL OPEN IT WHEN IT COMES AROUND AGAIN."
                }
            },
            4
        );
    }

    let next = addClue(state, clueId);

    next = {
        ...next,
        finalAnswerFound:
            state.finalAnswerFound ||
            clueId === "map",
        currentEvent: {
            type: "investigate",
            text: clueText(
                clueId,
                next
            )
        }
    };

    next = addDread(burst(next, 5), 3);
    next = moveChaser(next, -12);

    return next.chaser.active &&
        next.chaser.gap <= 0
        ? caught(next)
        : next;
}

export function leaveEvent(state) {
    return {
        ...state,
        currentEvent: null
    };
}

// ---------------------------------------------------------------- engine + radio

// R: switch the engine off/on (only when stopped)
export function toggleEngine(state) {
    if (
        state.location !== "road_1" ||
        state.currentEvent ||
        state.ending ||
        state.speed > 2 ||
        state.fuel <= 0
    ) {
        return state;
    }

    return {
        ...state,
        engine:
            state.engine === "off"
                ? "normal"
                : "off"
    };
}

// , and . : tune the radio
export function tuneRadio(
    state,
    step
) {
    if (
        state.location !== "road_1" ||
        state.engine === "off"
    ) {
        return state;
    }

    const radioFreq = Math.min(
        108,
        Math.max(
            88,
            Math.round(
                (state.radioFreq +
                    step) *
                    10
            ) / 10
        )
    );

    return { ...state, radioFreq };
}

export function setHeadlights(
    state,
    value
) {
    if (state.location !== "road_1") {
        return state;
    }

    return {
        ...state,
        headlights: value
    };
}

// Testing helper (only used when the address ends with #debug): press ]
// to jump one story kilometre ahead and test the next events quickly.
export function debugJump(state) {
    if (state.location !== "road_1") {
        return state;
    }

    const distance = state.distance + 1;

    return {
        ...state,
        distance,
        teleport: {
            id: state.teleport.id + 1,
            toKm: distance
        }
    };
}
