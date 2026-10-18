// ============================================================
// src/game/endings.js
// The seven endings. `hint` is shown after a BAD ending to point you at
// what you missed.
// ============================================================
export const ENDINGS = {
  home: {
    title: "HOME",
    lines: [
      "YOU STOPPED. HE SITS BESIDE YOU.",
      "1:12 AM. MILE 28. MILE 29.",
      "THE ROAD HAS A SHAPE AGAIN.",
      "AT HOME THE PASSENGER SEAT IS EMPTY AND WARM.",
      "THE HEADLIGHTS BEHIND YOU WERE YOUR OWN. THEY ARE GONE.",
    ],
    hint: "",
    good: true,
  },
  rest: {
    title: "AT REST",
    lines: [
      "YOU PROMISED TO TELL THEM WHERE HE FELL.",
      "AT DAWN THEY FIND A SHRINE, A CANDLE, A WHITE SEDAN.",
      "THE ROAD IS JUST A ROAD.",
      "YOU NEVER DRIVE IT AT NIGHT AGAIN.",
    ],
    hint: "TAKING HIM HOME YOURSELF MAY END DIFFERENTLY.",
    good: true,
  },
  driver: {
    title: "THE DRIVER",
    lines: [
      "THE SEDAN WAS YOURS. THE RECEIPT. THE KEYS. THE PLATE.",
      "YOU WERE NEVER THE ONE WHO DROVE PAST.",
      "YOU WERE THE ONE WHO DID NOT MAKE IT HOME.",
      "HE WAS ONLY KEEPING YOU COMPANY.",
    ],
    hint: "",
    good: true,
  },
  hostile: {
    title: "HE GETS HOME",
    lines: [
      "HE SLIDES INTO THE DRIVER'S SEAT.",
      "\"THANK YOU FOR THE RIDE.\"",
      "THE CAR PULLS AWAY WITHOUT YOU.",
      "YOU STAND BESIDE MILE 27 AND WAIT FOR HEADLIGHTS.",
    ],
    hint: "LEARN HIS TRUE NAME BEFORE YOU STOP. EVIDENCE BEATS GUESSING.",
    good: false,
  },
  replaced: {
    title: "REPLACED",
    lines: [
      "THE HEADLIGHTS FILL THE CAR. THE DOOR OPENS BY ITSELF.",
      "A DRIVER APPROACHES. \"NEED A RIDE?\"",
      "YOU ARE STANDING BESIDE MILE 27.",
      "12:47 AM.",
    ],
    hint: "KEEP MOVING FASTER THAN THE LIGHTS BEHIND YOU. STOPS COST DISTANCE.",
    good: false,
  },
  road: {
    title: "THE ROAD KEEPS YOU",
    lines: [
      "THE ROAD DOES NOT END.",
      "12:47 AM.",
      "12:47 AM.",
      "12:47 AM.",
    ],
    hint: "STOP FOR HIM EARLIER. FEAR AND REPEATS WILL EAT YOU.",
    good: false,
  },
  oldroad: {
    title: "THE OLD ROAD",
    lines: [
      "YOU TURN OFF THE LIGHTS AND TAKE THE OLD ROAD.",
      "THE FOREST CLOSES BEHIND YOU.",
      "A PETROL PUMP. A LIT WINDOW. THE NEWSPAPER IN THE RACK:",
      "\"MAN MISSING AFTER NIGHT ACCIDENT.\"",
      "THE PHOTOGRAPH ON THE FRONT PAGE IS YOURS.",
    ],
    hint: "",
    good: true,
  },
};

export const ENDING_ORDER = ["home", "rest", "driver", "oldroad", "hostile", "replaced", "road"];
