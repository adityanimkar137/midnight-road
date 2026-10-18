import { useEffect, useMemo, useRef, useState } from "react";

import DrivingCanvas from "./DrivingCanvas";
import PumpCanvas from "./PumpCanvas";
import { CONFIG } from "../game/driving";
import { buildWorld } from "../game/world";
import { audio } from "../game/audio";
import { visibleOptions } from "../game/dialogue";
import { clueText, JOURNAL_ORDER, LOCKED_FIRST_LOOP } from "../game/journal";
import { ENDINGS, ENDING_ORDER } from "../game/endings";
import {
    findInteractables,
    CLUE_BUTTONS
} from "../game/gameEngine";

// Types the ghost's words one letter at a time.
function useTypewriter(text) {
    const [typed, setTyped] = useState({
        text: "",
        n: 0
    });

    useEffect(() => {
        const id = setInterval(() => {
            setTyped((prev) =>
                prev.text === text
                    ? {
                          text,
                          n: prev.n + 2
                      }
                    : { text, n: 2 }
            );
        }, 28);

        return () => clearInterval(id);
    }, [text]);

    return typed.text === text
        ? text.slice(0, typed.n)
        : "";
}

// How far away the headlights behind you are (shown while you talk).
function ChaseBar({ chaser }) {
    if (!chaser.active) return null;

    const pct = Math.max(
        0,
        Math.min(100, (chaser.gap / 230) * 100)
    );

    return (
        <div className="chase-bar">
            <span>
                HEADLIGHTS BEHIND YOU
            </span>
            <div className="chase-track">
                <div
                    className="chase-fill"
                    style={{
                        width: `${pct}%`
                    }}
                />
            </div>
        </div>
    );
}

function DialogueBox({
    state,
    onChoose
}) {
    const event = state.currentEvent;
    const options = visibleOptions(
        state,
        event
    );
    const shown = useTypewriter(
        event.said || ""
    );

    // keys 1-9 pick an answer
    useEffect(() => {
        function onKey(e) {
            const n = Number(e.key);
            if (n >= 1 && n <= options.length) {
                onChoose(n - 1);
            }
        }

        window.addEventListener(
            "keydown",
            onKey
        );

        return () =>
            window.removeEventListener(
                "keydown",
                onKey
            );
    }, [options.length, onChoose]);

    return (
        <div className="stranger-interaction dialogue">
            <ChaseBar
                chaser={state.chaser}
            />

            <div className="stranger-message">
                <strong className="ghost-line">
                    {shown}
                </strong>
            </div>

            <div className="dialogue-options">
                {options.map(
                    ({ opt, key }, i) => (
                        <button
                            key={key}
                            onClick={() =>
                                onChoose(i)
                            }
                        >
                            {i + 1}.{" "}
                            {opt.text}
                        </button>
                    )
                )}
            </div>
        </div>
    );
}

function Journal({
    state,
    endingsFound
}) {
    const has = (id) =>
        state.clues.includes(id);

    const known = [
        [
            "HIS NAME",
            has("photograph") ||
                has("keychain") ||
                has("shrine_read")
        ],
        [
            "WHAT HAPPENED",
            has("phone") &&
                has("receipt")
        ],
        [
            "WHERE HE FELL",
            has("map") &&
                has("shrine_read")
        ]
    ];

    const mood =
        state.hostility >= 4
            ? "FURIOUS"
            : state.hostility >= 2
              ? "ANGRY"
              : state.trust >= 4
                ? "TRUSTING"
                : state.trust >= 2
                  ? "CALMER"
                  : "WARY";

    return (
        <div className="journal">
            <h3>JOURNAL</h3>

            <div className="journal-progress">
                {known.map(([label, ok]) => (
                    <span key={label}>
                        {ok ? "■" : "□"}{" "}
                        {label}
                    </span>
                ))}
            </div>

            <div className="journal-meters">
                <span>
                    NERVES{" "}
                    {state.dread > 66
                        ? "■■■"
                        : state.dread > 33
                          ? "■■□"
                          : "■□□"}
                </span>
                <span>HIS MOOD: {mood}</span>
                <span>
                    LOOP {state.loopNumber + 1}
                </span>
            </div>

            <ul>
                {JOURNAL_ORDER.filter(
                    (id) => has(id)
                ).map((id) => (
                    <li key={id}>
                        {clueText(id, state)}
                    </li>
                ))}
            </ul>

            <div className="journal-foot">
                ENDINGS FOUND:{" "}
                {endingsFound.length} /{" "}
                {ENDING_ORDER.length} ·
                [TAB] CLOSE
            </div>
        </div>
    );
}

// GameScreen shows either the PETROL PUMP (pixel scene + HTML buttons)
// or the DRIVING scene (canvas, handled by DrivingCanvas.jsx) with the
// story overlays: subtitles, conversations, the journal, the endings.
function GameScreen({
    state,
    endingsFound,
    onFillFuel,
    onReadNews,
    onStartDriving,
    onTelemetry,
    onHeadlightsChange,
    onInteract,
    onTalk,
    onToggleEngine,
    onTune,
    onChooseDialogue,
    onExamine,
    onLeaveEvent,
    onDebugJump,
    onRestart
}) {
    const [journalOpen, setJournalOpen] =
        useState(false);

    // Tab opens the journal
    useEffect(() => {
        function onKey(e) {
            if (e.code === "Tab") {
                e.preventDefault();
                setJournalOpen((o) => !o);
            }
        }

        window.addEventListener(
            "keydown",
            onKey
        );

        return () =>
            window.removeEventListener(
                "keydown",
                onKey
            );
    }, []);

    // scary sounds follow the story
    const prev = useRef({
        glitch: 0,
        mirror: "normal",
        catches: 0,
        talking: false
    });

    useEffect(() => {
        const p = prev.current;

        if (state.glitch >= 8 && p.glitch < 8)
            audio.sting(
                state.glitch >= 12 ? 3 : 2
            );

        if (
            state.mirrorState ===
                "ghost_face" &&
            p.mirror !== "ghost_face"
        )
            audio.sting(3);

        if (state.catches > p.catches)
            audio.sting(3);

        const talking =
            state.currentEvent?.type ===
            "dialogue";

        if (talking && !p.talking)
            audio.sting(1);

        prev.current = {
            glitch: state.glitch,
            mirror: state.mirrorState,
            catches: state.catches,
            talking
        };
    }, [
        state.glitch,
        state.mirrorState,
        state.catches,
        state.currentEvent
    ]);

    // The objects on the road depend on the loop number, your choices and your clues.
    const world = useMemo(
        () =>
            buildWorld({
                loopNumber:
                    state.loopNumber,
                strangerChoice:
                    state.strangerChoice,
                clues: state.clues,
                ending: state.ending,
                homeBase: state.homeBase,
                flags: state.flags,
                hostility:
                    state.hostility,
                engine: state.engine
            }),
        [
            state.loopNumber,
            state.strangerChoice,
            state.clues,
            state.ending,
            state.homeBase,
            state.flags,
            state.hostility,
            state.engine
        ]
    );

    if (state.location === "petrol_pump") {
        return (
            <div className="game-screen">
                <div className="pump-world">
                    <PumpCanvas
                        fuel={Math.round(
                            state.fuel
                        )}
                    />

                    <div className="pump-actions">
                        <button
                            onClick={
                                onFillFuel
                            }
                        >
                            FILL TANK
                        </button>

                        <button
                            onClick={
                                onReadNews
                            }
                        >
                            READ NEWS
                        </button>

                        <button
                            onClick={() => {
                                audio.start();
                                onStartDriving();
                            }}
                            disabled={
                                !state.fuelFilled
                            }
                        >
                            START CAR
                        </button>
                    </div>

                    {state.newsRead && (
                        <div className="newspaper">
                            <div className="newspaper-title">
                                LOCAL NEWS
                            </div>

                            <h2>
                                MAN MISSING
                                AFTER NIGHT
                                ACCIDENT
                            </h2>

                            <p>
                                Police are
                                searching for a
                                man last seen
                                travelling along
                                the forest road.
                            </p>

                            <p>
                                His vehicle has
                                not been found.
                            </p>

                            <small>
                                If taking the
                                forest road
                                tonight, avoid
                                stopping near
                                Mile 27.
                            </small>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    const event = state.currentEvent;
    const near = findInteractables(state);
    const ended =
        state.gameStatus === "ended";
    const ending =
        ENDINGS[state.endingId];

    return (
        <div className="driving-game">
            <DrivingCanvas
                initialDistanceKm={
                    state.distance /
                    CONFIG.storyKmPerRealKm
                }
                headlights={
                    state.headlights
                }
                fuel={state.fuel}
                radio={state.radio}
                radioFreq={
                    state.radioFreq
                }
                radioTicks={
                    state.radioTicks
                }
                mirrorState={
                    state.mirrorState
                }
                clock={state.time}
                passenger={
                    state.passenger
                }
                world={world}
                glitch={state.glitch}
                anomaly={
                    state.anomalyLevel
                }
                carTrouble={
                    state.carTrouble
                }
                dread={state.dread}
                hostility={
                    state.hostility
                }
                chaser={state.chaser}
                lightsOut={
                    state.lightsOut
                }
                engineOn={
                    state.engine !==
                        "off" &&
                    state.fuel > 0 &&
                    state.ending !==
                        "silence"
                }
                controlsLocked={
                    Boolean(event) ||
                    state.ending ===
                        "silence" ||
                    state.gameStatus !==
                        "playing"
                }
                teleport={
                    state.teleport
                }
                onTelemetry={
                    onTelemetry
                }
                onHeadlightsChange={
                    onHeadlightsChange
                }
                onInteract={
                    onInteract
                }
                onTalk={onTalk}
                onToggleEngine={
                    onToggleEngine
                }
                onTune={onTune}
                onDebugJump={
                    onDebugJump
                }
            />

            <div className="driving-hint">
                W S A D DRIVE
                <span>•</span>F LIGHTS
                <span>•</span>Q MIRROR
                <span>•</span>E EXAMINE
                <span>•</span>T TALK
                <span>•</span>R ENGINE
                <span>•</span>, . RADIO
                <span>•</span>TAB JOURNAL
                <span>•</span>M MUTE
            </div>

            {state.caption && !ended && (
                <div className="caption">
                    {state.caption.text}
                </div>
            )}

            {!event && !ended && (
                <div className="interact-hint">
                    {near.talk && (
                        <div>
                            {near.tooFast
                                ? "SLOW DOWN"
                                : `[ T ] ${near.talk.label}`}
                        </div>
                    )}

                    {near.examine && (
                        <div>
                            {near.tooFast
                                ? "SLOW DOWN"
                                : `[ E ] ${near.examine.label}`}
                        </div>
                    )}

                    {near.seat && (
                        <div>
                            [ T ] TALK TO THE
                            PASSENGER
                        </div>
                    )}
                </div>
            )}

            {event?.type ===
                "dialogue" && (
                <DialogueBox
                    key={event.tree}
                    state={state}
                    onChoose={
                        onChooseDialogue
                    }
                />
            )}

            {event?.type ===
                "investigate" && (
                <div className="stranger-interaction">
                    <ChaseBar
                        chaser={
                            state.chaser
                        }
                    />

                    <div className="stranger-message">
                        <strong>
                            {event.text}
                        </strong>
                    </div>

                    <div className="stranger-buttons">
                        {CLUE_BUTTONS.map(
                            ([id, label]) => (
                                <button
                                    key={id}
                                    className={
                                        state.clues.includes(
                                            id
                                        )
                                            ? "found"
                                            : ""
                                    }
                                    onClick={() =>
                                        onExamine(
                                            id
                                        )
                                    }
                                >
                                    {state.loopNumber ===
                                        0 &&
                                    LOCKED_FIRST_LOOP.includes(
                                        id
                                    )
                                        ? "???"
                                        : label}
                                </button>
                            )
                        )}

                        <button
                            onClick={
                                onLeaveEvent
                            }
                        >
                            LEAVE
                        </button>
                    </div>
                </div>
            )}

            {journalOpen && !ended && (
                <Journal
                    state={state}
                    endingsFound={
                        endingsFound
                    }
                />
            )}

            {ended && ending && (
                <div
                    className={`ending-screen ${
                        ending.good
                            ? ""
                            : "lost"
                    }`}
                >
                    <div className="ending-text">
                        <h2>
                            {ending.title}
                        </h2>

                        {ending.lines.map(
                            (line, i) => (
                                <p
                                    key={i}
                                    style={{
                                        animationDelay: `${
                                            i *
                                            1.1
                                        }s`
                                    }}
                                >
                                    {line}
                                </p>
                            )
                        )}

                        {ending.hint && (
                            <p className="small">
                                HINT:{" "}
                                {ending.hint}
                            </p>
                        )}

                        <p className="small">
                            ENDINGS FOUND:{" "}
                            {
                                endingsFound.length
                            }{" "}
                            /{" "}
                            {
                                ENDING_ORDER.length
                            }
                        </p>
                    </div>

                    <button
                        onClick={onRestart}
                    >
                        PLAY AGAIN
                    </button>
                </div>
            )}
        </div>
    );
}

export default GameScreen;
