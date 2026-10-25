import type { ObserverLocation } from '../astro/coordinates.ts';
import type { ViewState } from '../render/view-controller.ts';

export interface SceneDisplaySettings {
  chinese: boolean;
  modern: boolean;
  horizontal: boolean;
  equatorial: boolean;
  hips: boolean;
  labels: boolean;
  atmosphere: number;
}

export interface SharedSceneState {
  location: ObserverLocation;
  date: Date;
  view: ViewState;
  playing: boolean;
  rate: number;
  display: SceneDisplaySettings;
}

const TIME_RATES = [-86400, -3600, -60, -1, 1, 60, 3600, 86400, 604800];
const SCENE_KEYS = [
  'lat',
  'lon',
  'time',
  'az',
  'alt',
  'fov',
  'paused',
  'rate',
  'cn',
  'west',
  'hor',
  'eq',
  'hips',
  'labels',
  'air',
];

function required(parameters: URLSearchParams, key: string): string {
  const value = parameters.get(key);
  if (value === null) throw new Error(`Missing shared scene parameter: ${key}`);
  return value;
}

function numberParameter(
  parameters: URLSearchParams,
  key: string,
  minimum: number,
  maximum: number,
): number {
  const text = required(parameters, key);
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) {
    throw new Error(`Invalid shared scene parameter: ${key}`);
  }
  const value = Number(text);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`Invalid shared scene parameter: ${key}`);
  }
  return value;
}

function booleanParameter(parameters: URLSearchParams, key: string): boolean {
  const value = required(parameters, key);
  if (value !== '0' && value !== '1') {
    throw new Error(`Invalid shared scene parameter: ${key}`);
  }
  return value === '1';
}

function formatted(value: number, precision = 5): string {
  return String(Number(value.toFixed(precision)));
}

export function parseSceneUrl(input: string): SharedSceneState | undefined {
  const parameters = new URL(input).searchParams;
  if (!parameters.has('v')) return undefined;
  if (parameters.get('v') !== '1') throw new Error('Unsupported shared scene version');
  for (const key of SCENE_KEYS) required(parameters, key);

  const iso = required(parameters, 'time');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(iso)) {
    throw new Error('Invalid shared scene time');
  }
  const date = new Date(iso);
  const normalizedIso = iso.length === 20 ? `${iso.slice(0, 19)}.000Z` : iso;
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== normalizedIso) {
    throw new Error('Invalid shared scene time');
  }

  const rate = numberParameter(parameters, 'rate', -604800, 604800);
  if (!TIME_RATES.includes(rate)) throw new Error('Invalid shared scene time rate');
  const atmosphere = numberParameter(parameters, 'air', 0, 100);
  if (!Number.isInteger(atmosphere)) throw new Error('Invalid shared scene atmosphere');

  return {
    location: {
      latitude: numberParameter(parameters, 'lat', -90, 90),
      longitude: numberParameter(parameters, 'lon', -180, 180),
    },
    date,
    view: {
      azimuth: numberParameter(parameters, 'az', 0, 359.999999),
      altitude: numberParameter(parameters, 'alt', -89.9, 89.9),
      fov: numberParameter(parameters, 'fov', 0.25, 160),
    },
    playing: !booleanParameter(parameters, 'paused'),
    rate,
    display: {
      chinese: booleanParameter(parameters, 'cn'),
      modern: booleanParameter(parameters, 'west'),
      horizontal: booleanParameter(parameters, 'hor'),
      equatorial: booleanParameter(parameters, 'eq'),
      hips: booleanParameter(parameters, 'hips'),
      labels: booleanParameter(parameters, 'labels'),
      atmosphere,
    },
  };
}

export function createSceneUrl(input: string, state: SharedSceneState): string {
  const url = new URL(input);
  url.search = '';
  const parameters = url.searchParams;
  parameters.set('v', '1');
  parameters.set('lat', formatted(state.location.latitude));
  parameters.set('lon', formatted(state.location.longitude));
  parameters.set('time', state.date.toISOString());
  parameters.set('az', formatted(state.view.azimuth, 3));
  parameters.set('alt', formatted(state.view.altitude, 3));
  parameters.set('fov', formatted(state.view.fov, 3));
  parameters.set('paused', state.playing ? '0' : '1');
  parameters.set('rate', String(state.rate));
  parameters.set('cn', state.display.chinese ? '1' : '0');
  parameters.set('west', state.display.modern ? '1' : '0');
  parameters.set('hor', state.display.horizontal ? '1' : '0');
  parameters.set('eq', state.display.equatorial ? '1' : '0');
  parameters.set('hips', state.display.hips ? '1' : '0');
  parameters.set('labels', state.display.labels ? '1' : '0');
  parameters.set('air', String(state.display.atmosphere));
  return url.toString();
}
