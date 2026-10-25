import type { ObserverLocation } from '../astro/coordinates.ts';
import type { SimulationClock } from '../astro/time.ts';
import { DEFAULT_LOCATION, LOCATION_PRESETS } from '../data/locations.ts';
import { requiredElement } from './dom.ts';

function inputDate(date: Date): string {
  return date.toISOString().slice(0, 19);
}

function displayDate(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

export class ObservationControls {
  location: ObserverLocation = {
    latitude: DEFAULT_LOCATION.latitude,
    longitude: DEFAULT_LOCATION.longitude,
  };
  locationName = DEFAULT_LOCATION.name;

  private readonly select = requiredElement<HTMLSelectElement>('location-select');
  private readonly latitudeInput = requiredElement<HTMLInputElement>('latitude-input');
  private readonly longitudeInput = requiredElement<HTMLInputElement>('longitude-input');
  private readonly timeInput = requiredElement<HTMLInputElement>('time-input');
  private readonly playToggle = requiredElement<HTMLButtonElement>('play-toggle');
  private readonly playLabel = requiredElement('play-label');
  private readonly playIcon = requiredElement<SVGElement>('play-icon');
  private readonly rateSelect = requiredElement<HTMLSelectElement>('rate-select');
  private readonly nowButton = requiredElement<HTMLButtonElement>('now-button');
  private readonly localTime = requiredElement('local-time');
  private timeZone: string | undefined = DEFAULT_LOCATION.timeZone;
  private formatter: Intl.DateTimeFormat | undefined;

  constructor(
    private readonly clock: SimulationClock,
    private readonly onChange: () => void,
  ) {
    this.populateLocations();
    this.createFormatter();
    this.select.addEventListener('change', this.locationSelected);
    this.latitudeInput.addEventListener('change', this.customLocationChanged);
    this.longitudeInput.addEventListener('change', this.customLocationChanged);
    this.timeInput.addEventListener('change', this.timeChanged);
    this.playToggle.addEventListener('click', this.playChanged);
    this.rateSelect.addEventListener('change', this.rateChanged);
    this.nowButton.addEventListener('click', this.nowChanged);
    this.update();
  }

  setLocation(location: ObserverLocation, name = '自定义经纬度', timeZone?: string): void {
    this.location = { ...location };
    this.locationName = name;
    this.timeZone = timeZone;
    this.latitudeInput.value = location.latitude.toFixed(2);
    this.longitudeInput.value = location.longitude.toFixed(2);
    this.select.value = 'custom';
    this.createFormatter();
    this.onChange();
  }

  update(): void {
    const date = this.clock.date;
    const value = inputDate(date);
    if (document.activeElement !== this.timeInput && this.timeInput.value !== value)
      this.timeInput.value = value;
    const local = this.formatter
      ? this.formatter.format(date)
      : displayDate(new Date(date.getTime() + this.location.longitude * 4 * 60 * 1000));
    this.localTime.textContent = `UTC ${displayDate(date)}\n${this.timeZone ? this.locationName : '观测地地方时'} ${local}`;
  }

  dispose(): void {
    this.select.removeEventListener('change', this.locationSelected);
    this.latitudeInput.removeEventListener('change', this.customLocationChanged);
    this.longitudeInput.removeEventListener('change', this.customLocationChanged);
    this.timeInput.removeEventListener('change', this.timeChanged);
    this.playToggle.removeEventListener('click', this.playChanged);
    this.rateSelect.removeEventListener('change', this.rateChanged);
    this.nowButton.removeEventListener('click', this.nowChanged);
  }

  private populateLocations(): void {
    for (const hemisphere of ['north', 'south'] as const) {
      const group = document.createElement('optgroup');
      group.label = hemisphere === 'north' ? '北半球' : '南半球';
      for (const preset of LOCATION_PRESETS.filter(
        (candidate) => candidate.hemisphere === hemisphere,
      )) {
        const option = document.createElement('option');
        option.value = preset.id;
        option.textContent = preset.name;
        group.append(option);
      }
      this.select.append(group);
    }
    const custom = document.createElement('option');
    custom.value = 'custom';
    custom.textContent = '自定义经纬度';
    this.select.append(custom);
    this.select.value = DEFAULT_LOCATION.id;
  }

  private createFormatter(): void {
    this.formatter = this.timeZone
      ? new Intl.DateTimeFormat('zh-CN', {
          timeZone: this.timeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hourCycle: 'h23',
        })
      : undefined;
  }

  private syncPlayState(): void {
    this.playLabel.textContent = this.clock.playing ? '暂停' : '继续';
    this.playToggle.setAttribute('aria-pressed', String(!this.clock.playing));
    this.playIcon
      .querySelector('path')
      ?.setAttribute('d', this.clock.playing ? 'M7 5v10M13 5v10' : 'm7 5 8 5-8 5Z');
  }

  private readonly locationSelected = (): void => {
    const preset = LOCATION_PRESETS.find((candidate) => candidate.id === this.select.value);
    if (!preset) return;
    this.setLocation(
      { latitude: preset.latitude, longitude: preset.longitude },
      preset.name,
      preset.timeZone,
    );
    this.select.value = preset.id;
  };

  private readonly customLocationChanged = (): void => {
    const latitude = this.latitudeInput.valueAsNumber;
    const longitude = this.longitudeInput.valueAsNumber;
    const valid =
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      Math.abs(latitude) <= 90 &&
      Math.abs(longitude) <= 180;
    this.latitudeInput.setCustomValidity(
      Number.isFinite(latitude) && Math.abs(latitude) <= 90 ? '' : '纬度必须在 -90 到 90 之间',
    );
    this.longitudeInput.setCustomValidity(
      Number.isFinite(longitude) && Math.abs(longitude) <= 180 ? '' : '经度必须在 -180 到 180 之间',
    );
    if (!valid) {
      this.latitudeInput.reportValidity();
      return;
    }
    this.setLocation({ latitude, longitude });
  };

  private readonly timeChanged = (): void => {
    const value = this.timeInput.value;
    const normalized = value.length === 16 ? `${value}:00` : value;
    const date = new Date(`${normalized}Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value) ||
      !Number.isFinite(date.getTime()) ||
      inputDate(date) !== normalized
    ) {
      this.timeInput.setCustomValidity('请输入有效的 UTC 日期和时间');
      this.timeInput.reportValidity();
      return;
    }
    this.timeInput.setCustomValidity('');
    this.clock.setDate(date);
    this.onChange();
    this.update();
  };

  private readonly playChanged = (): void => {
    this.clock.setPlaying(!this.clock.playing);
    this.syncPlayState();
    this.onChange();
  };

  private readonly rateChanged = (): void => {
    this.clock.setRate(Number(this.rateSelect.value));
    this.onChange();
  };

  private readonly nowChanged = (): void => {
    this.clock.setNow();
    this.onChange();
    this.update();
  };
}
