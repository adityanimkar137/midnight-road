import { useEffect, useState } from "react";

import { gameState } from "./game/gameState";
import { audio } from "./game/audio";
import { ENDING_ORDER } from "./game/endings";

import {
    startGame,
    restartGame,
    fillFuel,
    readNews,
    startDriving,
    setHeadlights,
    applyTelemetry,
    interact,
    talk,
    chooseDialogue,
    examineClue,
    leaveEvent,
    toggleEngine,
    tuneRadio,
    debugJump
} from "./game/gameEngine";

import GameScreen from "./components/GameScreen";

// The endings you have found are remembered in the browser (localStorage).
const STORAGE_KEY =
    "midnight_road_endings";

function loadEndings() {
    try {
        const saved = JSON.parse(
            localStorage.getItem(
                STORAGE_KEY
            ) || "[]"
        );

        return saved.filter((id) =>
            ENDING_ORDER.includes(id)
        );
    } catch {
        return [];
    }
}

// App owns the GAME STATE (fuel, money, clues, fear, trust...).
// Keyboard input and the 60 fps driving loop live inside
// components/DrivingCanvas.jsx; it reports back through
// handleTelemetry (about 10 times per second), and the horror events in
// game/events.js react to that.
function App() {
    const [state, setState] =
        useState(gameState);

    const [endingsFound, setEndingsFound] =
        useState(loadEndings);

    // remember every new ending
    useEffect(() => {
        if (
            state.gameStatus ===
                "ended" &&
            state.endingId &&
            !endingsFound.includes(
                state.endingId
            )
        ) {
            const updated = [
                ...endingsFound,
                state.endingId
            ];

            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify(updated)
            );

            // eslint-disable-next-line react-hooks/set-state-in-effect
            setEndingsFound(updated);
        }
    }, [
        state.gameStatus,
        state.endingId,
        endingsFound
    ]);

    function handleStart() {
        audio.start();
        setState(startGame(state));
    }

    function update(fn) {
        return (...args) =>
            setState((current) =>
                fn(current, ...args)
            );
    }

    let screen;

    if (
        state.gameStatus ===
        "menu"
    ) {
        screen = (
            <div className="menu">
                <div className="menu-atmosphere"></div>

                <div className="menu-content">
                    <div className="menu-small">
                        A ROAD-TRIP HORROR EXPERIENCE
                    </div>

                    <h1>
                        MIDNIGHT
                        <span>ROAD</span>
                    </h1>

                    <p>
                        The road home is
                        longer at night.
                    </p>

                    <button
                        onClick={
                            handleStart
                        }
                    >
                        START DRIVE
                    </button>

                    <div className="menu-help">
                        <p>
                            Somebody is waiting
                            for you on this road.
                            Find out who, and
                            why. Learn the truth
                            before you stop.
                        </p>

                        <p>
                            W S A D drive · F
                            lights · Q mirror ·
                            E examine · T talk ·
                            R engine · , .
                            radio · TAB journal
                        </p>

                        <p>
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
                </div>
            </div>
        );
    } else {
        screen = (
            <div className="game">
                <GameScreen
                    state={state}
                    endingsFound={
                        endingsFound
                    }
                    onFillFuel={() =>
                        setState(fillFuel)
                    }
                    onReadNews={() =>
                        setState(readNews)
                    }
                    onStartDriving={() =>
                        setState(
                            startDriving
                        )
                    }
                    onTelemetry={update(
                        applyTelemetry
                    )}
                    onHeadlightsChange={update(
                        setHeadlights
                    )}
                    onInteract={() =>
                        setState(interact)
                    }
                    onTalk={() =>
                        setState(talk)
                    }
                    onToggleEngine={() =>
                        setState(
                            toggleEngine
                        )
                    }
                    onTune={update(
                        tuneRadio
                    )}
                    onChooseDialogue={update(
                        chooseDialogue
                    )}
                    onExamine={update(
                        examineClue
                    )}
                    onLeaveEvent={() =>
                        setState(
                            leaveEvent
                        )
                    }
                    onDebugJump={() =>
                        setState(
                            debugJump
                        )
                    }
                    onRestart={() =>
                        setState(
                            restartGame()
                        )
                    }
                />
            </div>
        );
    }

    return (
        <>
            {screen}

            <div className="analog-overlay"></div>
        </>
    );
}

export default App;
