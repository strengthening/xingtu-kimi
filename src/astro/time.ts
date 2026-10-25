export class SimulationClock {
  private milliseconds: number;
  private lastRealTime: number | undefined;
  playing = true;
  rate = 1;

  constructor(date = new Date()) {
    this.milliseconds = date.getTime();
  }

  get date(): Date {
    return new Date(this.milliseconds);
  }

  tick(realTime: number): Date {
    if (this.lastRealTime !== undefined && this.playing) {
      const elapsed = Math.max(0, (realTime - this.lastRealTime) / 1000);
      this.milliseconds += elapsed * this.rate * 1000;
    }
    this.lastRealTime = realTime;
    return this.date;
  }

  setDate(date: Date): void {
    if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid observation date');
    this.milliseconds = date.getTime();
  }

  setNow(): void {
    this.setDate(new Date());
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
  }

  setRate(rate: number): void {
    if (!Number.isFinite(rate) || rate === 0) throw new RangeError('Invalid time rate');
    this.rate = rate;
  }

  resetRealTime(): void {
    this.lastRealTime = undefined;
  }
}
