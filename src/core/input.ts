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
}

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
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);

    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('wheel', this.onWheel, { passive: true });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const code = e.code;
    if (
      code === 'Space' ||
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight' ||
      code === 'F5'
    ) {
      e.preventDefault();
    }
    if (!this.keys.has(code)) {
      this.justPressed.add(code);
    }
    this.keys.add(code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.dragging = false;
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0 || e.button === 2) {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    }
  };

  private onMouseUp = (): void => {
    this.dragging = false;
  };

  private onMouseMove = (e: MouseEvent): void => {
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
    };

    this.justPressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheelDelta = 0;
    return snap;
  }

  public dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
  }
}
