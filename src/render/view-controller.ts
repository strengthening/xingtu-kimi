import { horizontalToWorld } from '../astro/coordinates.ts';
import {
  clamp,
  cross,
  normalize,
  normalizeDegrees,
  scale,
  transform,
  type Mat3,
  type Vec3,
} from '../astro/math.ts';
import { ndcToScreen, projectStereographic } from '../astro/projection.ts';

export interface ViewState {
  azimuth: number;
  altitude: number;
  fov: number;
}

interface PointerPosition {
  x: number;
  y: number;
}

export class ViewController {
  onChange: (() => void) | undefined;
  onClick: ((x: number, y: number) => void) | undefined;
  azimuth = 180;
  altitude = 32;
  fov = 75;

  private readonly pointers = new Map<number, PointerPosition>();
  private pointerStart: PointerPosition | undefined;
  private previousPinchDistance = 0;
  private dragged = false;
  private pinched = false;
  private lastMoveTime = 0;
  private lastFrameTime: number | undefined;
  private velocityAzimuth = 0;
  private velocityAltitude = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', this.pointerDown);
    canvas.addEventListener('pointermove', this.pointerMove);
    canvas.addEventListener('pointerup', this.pointerUp);
    canvas.addEventListener('pointercancel', this.pointerUp);
    canvas.addEventListener('wheel', this.wheel, { passive: false });
    canvas.addEventListener('keydown', this.keyDown);
  }

  get forward(): Vec3 {
    return horizontalToWorld(this.azimuth, this.altitude);
  }

  get worldToView(): Mat3 {
    const forward = this.forward;
    const right = normalize(cross(forward, [0, 1, 0]));
    const up = normalize(cross(right, forward));
    const backward = scale(forward, -1);
    return [
      right[0],
      right[1],
      right[2],
      up[0],
      up[1],
      up[2],
      backward[0],
      backward[1],
      backward[2],
    ];
  }

  get state(): ViewState {
    return { azimuth: this.azimuth, altitude: this.altitude, fov: this.fov };
  }

  setState(state: ViewState): void {
    this.azimuth = normalizeDegrees(state.azimuth);
    this.altitude = clamp(state.altitude, -89.9, 89.9);
    this.fov = clamp(state.fov, 0.25, 160);
    this.velocityAzimuth = 0;
    this.velocityAltitude = 0;
    this.onChange?.();
  }

  reset(): void {
    this.setState({ azimuth: 180, altitude: 32, fov: 75 });
  }

  update(realTime: number): void {
    const elapsed =
      this.lastFrameTime === undefined ? 0 : Math.min(50, realTime - this.lastFrameTime);
    this.lastFrameTime = realTime;
    if (this.pointers.size > 0 || elapsed <= 0) return;
    if (Math.hypot(this.velocityAzimuth, this.velocityAltitude) < 0.00002) return;
    this.azimuth = normalizeDegrees(this.azimuth + this.velocityAzimuth * elapsed);
    this.altitude = clamp(this.altitude + this.velocityAltitude * elapsed, -89.9, 89.9);
    const damping = Math.exp(-elapsed / 180);
    this.velocityAzimuth *= damping;
    this.velocityAltitude *= damping;
    this.onChange?.();
  }

  project(
    worldDirection: Vec3,
    width: number,
    height: number,
  ): { x: number; y: number; visible: boolean } {
    const viewDirection = transform(this.worldToView, worldDirection);
    return ndcToScreen(
      projectStereographic(viewDirection, this.fov, width / height),
      width,
      height,
    );
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.pointerDown);
    this.canvas.removeEventListener('pointermove', this.pointerMove);
    this.canvas.removeEventListener('pointerup', this.pointerUp);
    this.canvas.removeEventListener('pointercancel', this.pointerUp);
    this.canvas.removeEventListener('wheel', this.wheel);
    this.canvas.removeEventListener('keydown', this.keyDown);
  }

  private applyDrag(dx: number, dy: number, elapsed: number): void {
    const degreesPerPixel = this.fov / Math.max(300, this.canvas.clientHeight);
    const deltaAzimuth = -dx * degreesPerPixel;
    const deltaAltitude = dy * degreesPerPixel;
    this.azimuth = normalizeDegrees(this.azimuth + deltaAzimuth);
    this.altitude = clamp(this.altitude + deltaAltitude, -89.9, 89.9);
    if (elapsed > 0) {
      const blend = 0.35;
      this.velocityAzimuth = this.velocityAzimuth * (1 - blend) + (deltaAzimuth / elapsed) * blend;
      this.velocityAltitude =
        this.velocityAltitude * (1 - blend) + (deltaAltitude / elapsed) * blend;
    }
    this.onChange?.();
  }

  private readonly pointerDown = (event: PointerEvent): void => {
    this.canvas.focus({ preventScroll: true });
    this.canvas.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.velocityAzimuth = 0;
    this.velocityAltitude = 0;
    this.dragged = false;
    this.pointerStart = { x: event.clientX, y: event.clientY };
    this.lastMoveTime = event.timeStamp;
    if (this.pointers.size === 2) {
      this.pinched = true;
      this.previousPinchDistance = this.pinchDistance();
    }
    this.canvas.classList.add('dragging');
  };

  private readonly pointerMove = (event: PointerEvent): void => {
    const previous = this.pointers.get(event.pointerId);
    if (!previous) return;
    const current = { x: event.clientX, y: event.clientY };
    this.pointers.set(event.pointerId, current);
    if (this.pointers.size === 2) {
      const distance = this.pinchDistance();
      if (distance > 2 && this.previousPinchDistance > 2) {
        this.fov = clamp(this.fov * (this.previousPinchDistance / distance), 0.25, 160);
        this.onChange?.();
      }
      this.previousPinchDistance = distance;
      return;
    }
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    if (
      this.pointerStart &&
      Math.hypot(current.x - this.pointerStart.x, current.y - this.pointerStart.y) > 4
    ) {
      this.dragged = true;
    }
    this.applyDrag(dx, dy, event.timeStamp - this.lastMoveTime);
    this.lastMoveTime = event.timeStamp;
  };

  private readonly pointerUp = (event: PointerEvent): void => {
    const wasSinglePointer = this.pointers.size === 1;
    this.pointers.delete(event.pointerId);
    if (this.canvas.hasPointerCapture(event.pointerId))
      this.canvas.releasePointerCapture(event.pointerId);
    if (wasSinglePointer && !this.dragged && !this.pinched)
      this.onClick?.(event.clientX, event.clientY);
    if (this.pointers.size === 0) {
      this.canvas.classList.remove('dragging');
      this.pointerStart = undefined;
      this.pinched = false;
      if (this.dragged) {
        this.velocityAzimuth *= 0.55;
        this.velocityAltitude *= 0.55;
      }
    } else {
      this.previousPinchDistance = this.pointers.size === 2 ? this.pinchDistance() : 0;
    }
  };

  private readonly wheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.velocityAzimuth = 0;
    this.velocityAltitude = 0;
    this.fov = clamp(this.fov * Math.exp(event.deltaY * 0.0012), 0.25, 160);
    this.onChange?.();
  };

  private readonly keyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Enter') {
      const bounds = this.canvas.getBoundingClientRect();
      this.onClick?.(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      event.preventDefault();
      return;
    }
    const step = Math.max(0.3, this.fov / 20);
    if (event.key === 'ArrowLeft') this.azimuth -= step;
    else if (event.key === 'ArrowRight') this.azimuth += step;
    else if (event.key === 'ArrowUp') this.altitude += step;
    else if (event.key === 'ArrowDown') this.altitude -= step;
    else if (event.key === '+' || event.key === '=') this.fov *= 0.9;
    else if (event.key === '-') this.fov *= 1.1;
    else return;
    event.preventDefault();
    this.setState(this.state);
  };

  private pinchDistance(): number {
    const [first, second] = [...this.pointers.values()];
    if (!first || !second) return 0;
    return Math.hypot(first.x - second.x, first.y - second.y);
  }
}
