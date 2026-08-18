// input.ts — keyboard + touch input, normalized into a small intent object the
// rest of the game reads each frame. No game-state imports here.

export interface InputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  pulse: boolean;
}

export const input: InputState = {
  up: false,
  down: false,
  left: false,
  right: false,
  pulse: false,
};

// Map physical key codes to intents. Codes (not keys) so layout/locale is stable.
const KEY_MAP: Record<string, keyof InputState> = {
  ArrowUp: "up",
  KeyW: "up",
  ArrowDown: "down",
  KeyS: "down",
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  Space: "pulse",
};

export function initInput(): void {
  window.addEventListener("keydown", (e) => {
    const intent = KEY_MAP[e.code];
    if (intent) {
      input[intent] = true;
      e.preventDefault();
    }
  });

  window.addEventListener("keyup", (e) => {
    const intent = KEY_MAP[e.code];
    if (intent) {
      input[intent] = false;
      e.preventDefault();
    }
  });

  // Touch: tap anywhere to pulse, drag to steer toward the touch point.
  const canvas = document.getElementById("game")!;
  canvas.addEventListener(
    "touchstart",
    (e) => {
      input.pulse = true;
      e.preventDefault();
    },
    { passive: false },
  );
  canvas.addEventListener(
    "touchend",
    (e) => {
      input.pulse = false;
      input.up = input.down = input.left = input.right = false;
      e.preventDefault();
    },
    { passive: false },
  );
}
