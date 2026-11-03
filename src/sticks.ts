// 2つの丸（バーチャルスティック）。左右同時タッチ対応。
// 値は x: 右が+、y: 上が+（画面座標から反転済み）、長さ 0〜1。

export type StickMode = 'fixed' | 'floating';

export interface StickState {
  active: boolean;
  x: number; // -1..1
  y: number; // -1..1
  mag: number; // 0..1（不感帯を除いた後）
}

const DEADZONE = 0.1;

export class Stick {
  readonly state: StickState = { active: false, x: 0, y: 0, mag: 0 };
  private pointerId: number | null = null;
  private cx = 0;
  private cy = 0;
  private readonly el: HTMLElement;
  private readonly knob: HTMLElement;
  onStart?: () => void;
  onEnd?: (last: StickState) => void;

  constructor(el: HTMLElement, private side: 'left' | 'right', public mode: StickMode = 'fixed') {
    this.el = el;
    this.knob = el.querySelector('.knob') as HTMLElement;
    this.resetPosition();
  }

  get radius() {
    return this.el.offsetWidth / 2;
  }

  /** 固定位置（下の角）に戻す */
  resetPosition() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const margin = Math.max(84, Math.min(w, h) * 0.22);
    this.cx = this.side === 'left' ? margin + 6 : w - margin - 6;
    this.cy = h - margin;
    this.place();
  }

  private place() {
    this.el.style.left = `${this.cx}px`;
    this.el.style.top = `${this.cy}px`;
  }

  /** このタッチを受け持つか */
  tryStart(e: PointerEvent): boolean {
    if (this.pointerId !== null) return false;
    const half = window.innerWidth / 2;
    const inHalf = this.side === 'left' ? e.clientX < half : e.clientX >= half;
    if (!inHalf) return false;
    if (this.mode === 'fixed') {
      const d = Math.hypot(e.clientX - this.cx, e.clientY - this.cy);
      if (d > this.radius * 1.8) return false;
    } else {
      this.cx = e.clientX;
      this.cy = e.clientY;
      this.place();
    }
    this.pointerId = e.pointerId;
    this.state.active = true;
    this.el.classList.add('active');
    this.update(e);
    this.onStart?.();
    return true;
  }

  move(e: PointerEvent) {
    if (e.pointerId !== this.pointerId) return;
    this.update(e);
  }

  end(e: PointerEvent) {
    if (e.pointerId !== this.pointerId) return;
    const last = { ...this.state };
    this.pointerId = null;
    this.state.active = false;
    this.state.x = this.state.y = this.state.mag = 0;
    this.el.classList.remove('active');
    this.knob.style.transform = '';
    if (this.mode === 'floating') this.resetPosition();
    this.onEnd?.(last);
  }

  private update(e: PointerEvent) {
    const r = this.radius;
    let dx = (e.clientX - this.cx) / r;
    let dy = (e.clientY - this.cy) / r;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    const clamped = Math.min(len, 1);
    this.knob.style.transform = `translate(${dx * r}px, ${dy * r}px)`;
    const mag = clamped < DEADZONE ? 0 : (clamped - DEADZONE) / (1 - DEADZONE);
    const k = clamped > 0 ? mag / clamped : 0;
    this.state.x = dx * k;
    this.state.y = -dy * k;
    this.state.mag = mag;
  }
}

/** 画面全体のタッチを左右の丸に振り分ける */
export function bindSticks(target: HTMLElement, sticks: Stick[]) {
  target.addEventListener('pointerdown', (e) => {
    for (const s of sticks) if (s.tryStart(e)) break;
  });
  const move = (e: PointerEvent) => sticks.forEach((s) => s.move(e));
  const end = (e: PointerEvent) => sticks.forEach((s) => s.end(e));
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  window.addEventListener('resize', () => sticks.forEach((s) => s.resetPosition()));
}
