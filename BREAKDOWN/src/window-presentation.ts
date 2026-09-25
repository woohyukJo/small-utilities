export interface Bounds { x: number; y: number; width: number; height: number }
export interface WindowPort {
  getBounds(): Bounds;
  getNormalBounds(): Bounds;
  setBounds(bounds: Bounds): void;
  isFullScreen(): boolean;
  setFullScreen(value: boolean): void;
  setClosable(value: boolean): void;
  setMinimizable(value: boolean): void;
  setResizable(value: boolean): void;
  setAlwaysOnTop(value: boolean, level?: "screen-saver"): void;
  isVisible(): boolean;
  show(): void;
}
export function sameBounds(a: Bounds, b: Bounds): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

// Lock permission and fullscreen presentation are separate states.
// Unlocking must not resize, hide, recenter, reload, or focus the window.
export class WindowPresentation {
  private appliedLock: boolean | null = null;
  private covering = false;
  private restoreBounds: Bounds | null = null;
  constructor(private window: WindowPort) {}
  get coversDisplay(): boolean { return this.covering; }
  applyLock(locked: boolean, display: Bounds): void {
    if (this.appliedLock !== locked) {
      this.window.setClosable(!locked);
      this.window.setMinimizable(!locked);
      this.window.setResizable(!locked);
      this.window.setAlwaysOnTop(locked, "screen-saver");
      this.appliedLock = locked;
    }
    if (!locked) return;
    if (!this.covering) {
      this.restoreBounds = { ...this.window.getNormalBounds() };
      this.covering = true;
    }
    if (this.window.isFullScreen()) this.window.setFullScreen(false);
    if (!sameBounds(this.window.getBounds(), display)) this.window.setBounds(display);
    if (!this.window.isVisible()) this.window.show();
  }
  escape(): boolean {
    if (this.appliedLock || (!this.covering && !this.window.isFullScreen())) return false;
    if (this.window.isFullScreen()) this.window.setFullScreen(false);
    if (this.covering && this.restoreBounds) this.window.setBounds(this.restoreBounds);
    this.covering = false;
    return true;
  }
}
