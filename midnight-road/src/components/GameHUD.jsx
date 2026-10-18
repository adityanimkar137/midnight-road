function GameHUD({ state }) {
    return (
        <div className="game-hud">
            <div>{state.time}</div>
            <div>FUEL: {state.fuel}%</div>
            <div>MONEY: ₹{state.money}</div>
        </div>
    );
}

export default GameHUD;