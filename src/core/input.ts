export interface InputSnapshot {
  forward: number; // -1..+1
  right: number; // -1..+1
  handbrakeOrJump: boolean;
  sprint: boolean;
  horn: boolean;
  mouseDX: number;
  mouseDY: number;
  wheelDelta: number;
  // Single-frame edge triggers
  interactPressed: boolean;
  cameraCyclePressed: boolean;
  timeCyclePressed: boolean;
  paintCyclePressed: boolean;
  headlightsPressed: boolean;
  trackMissionPressed: boolean;
  cancelMissionPressed: boolean;
  quickSavePressed: boolean;
  audioTogglePressed: boolean;
  pausePressed: boolean;
  floorDigitPressed: 0 | 1 | 2 | 3;
}

const GAME_CONTROL_CODES = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyE',
  'KeyF',
  'KeyC',
  'KeyT',
  'KeyP',
  'KeyL',
  'KeyH',
  'KeyM',
  'KeyX',
  'KeyU',
  'Digit1',
  'Digit2',
  'Digit3',
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'F5',
]);

export class InputManager {
  private keys = new Set<string>();
  private justPressed = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private wheelDelta = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  public pointerLocked = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('blur', this.onClearAll);
    window.addEventListener('focus', this.onClearAll);
    window.addEventListener('pagehide', this.onClearAll);
    window.addEventListener('compositionstart', this.onClearAll);
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('wheel', this.onWheel, { passive: true });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
  }

  /** Immediately releases all held keys & mouse drag state (prevents stuck movement on pause/focus changes). */
  public clearAll(): void {
    this.keys.clear();
    this.justPressed.clear();
    this.dragging = false;
  }

  private syncModifierKeys(e: KeyboardEvent | MouseEvent): void {
    // Reconcile Shift state in case a Shift keyup was dropped by the OS
    if (!e.shiftKey) {
      this.keys.delete('ShiftLeft');
      this.keys.delete('ShiftRight');
    }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const code = e.code;

    // On macOS, holding Command/Meta (or Ctrl/Alt OS shortcuts) swallows subsequent keyup events for
    // already-held movement keys (e.g. W/A/S/D), causing stuck movement! Clear held keys immediately.
    if (
      code === 'MetaLeft' ||
      code === 'MetaRight' ||
      e.metaKey ||
      e.ctrlKey ||
      e.altKey
    ) {
      this.keys.clear();
      return;
    }

    // Prevent macOS press-and-hold character accent popups on A/E/S/W and browser scrolling on Space/Arrows!
    if (GAME_CONTROL_CODES.has(code)) {
      e.preventDefault();
    }

    this.syncModifierKeys(e);

    if (!this.keys.has(code) && !e.repeat) {
      this.justPressed.add(code);
    }
    this.keys.add(code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const code = e.code;
    // Releasing macOS Command key: any key released while Command was down never sent keyup, so clear all!
    if (code === 'MetaLeft' || code === 'MetaRight') {
      this.keys.clear();
      return;
    }
    this.keys.delete(code);
    this.syncModifierKeys(e);
  };

  private onClearAll = (): void => {
    this.clearAll();
  };

  private onVisibilityChange = (): void => {
    if (document.hidden) {
      this.clearAll();
    }
  };

  private onMouseDown = (e: MouseEvent): void => {
    this.syncModifierKeys(e);
    if (document.activeElement instanceof HTMLElement && document.activeElement !== this.canvas) {
      document.activeElement.blur();
    }
    if (e.button === 0 || e.button === 2) {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    }
  };

  private onMouseUp = (e: MouseEvent): void => {
    this.syncModifierKeys(e);
    this.dragging = false;
  };

  private onMouseMove = (e: MouseEvent): void => {
    this.syncModifierKeys(e);
    if (this.pointerLocked) {
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    } else if (this.dragging) {
      this.mouseDX += e.clientX - this.lastX;
      this.mouseDY += e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    }
  };

  private onWheel = (e: WheelEvent): void => {
    this.wheelDelta += Math.sign(e.deltaY);
  };

  private onPointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.canvas;
    if (!this.pointerLocked) {
      this.dragging = false;
    }
  };

  public requestPointerLock(): void {
    if (this.canvas.requestPointerLock) {
      try {
        this.canvas.requestPointerLock();
      } catch {
        // Fallback to drag-orbit if blocked by browser policy
      }
    }
  }

  public releasePointerLock(): void {
    if (document.pointerLockElement && document.exitPointerLock) {
      document.exitPointerLock();
    }
  }

  public poll(): InputSnapshot {
    const fwd =
      (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) -
      (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
    const right =
      (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) -
      (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);

    const snap: InputSnapshot = {
      forward: fwd,
      right,
      handbrakeOrJump: this.keys.has('Space'),
      sprint: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      horn: this.keys.has('KeyH'),
      mouseDX: this.mouseDX,
      mouseDY: this.mouseDY,
      wheelDelta: this.wheelDelta,
      interactPressed: this.justPressed.has('KeyE') || this.justPressed.has('KeyF'),
      cameraCyclePressed: this.justPressed.has('KeyC'),
      timeCyclePressed: this.justPressed.has('KeyT'),
      paintCyclePressed: this.justPressed.has('KeyP'),
      headlightsPressed: this.justPressed.has('KeyL'),
      trackMissionPressed: this.justPressed.has('KeyM'),
      cancelMissionPressed: this.justPressed.has('KeyX'),
      quickSavePressed: this.justPressed.has('F5'),
      audioTogglePressed: this.justPressed.has('KeyU'),
      pausePressed: this.justPressed.has('Escape'),
      floorDigitPressed: this.justPressed.has('Digit1')
        ? 1
        : this.justPressed.has('Digit2')
          ? 2
          : this.justPressed.has('Digit3')
            ? 3
            : 0,
    };

    this.justPressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheelDelta = 0;
    return snap;
  }

  public dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('blur', this.onClearAll);
    window.removeEventListener('focus', this.onClearAll);
    window.removeEventListener('pagehide', this.onClearAll);
    window.removeEventListener('compositionstart', this.onClearAll);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
  }
}
