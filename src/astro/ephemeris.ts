import { Body, Equator, Illumination } from 'astronomy-engine';
import {
  apparentEquatorial,
  eqjToHorizontal,
  eqjToWorld,
  type EquatorialCoordinates,
  type HorizontalCoordinates,
  type ObservationFrame,
} from './coordinates.ts';
import { normalize, type Vec3 } from './math.ts';

const KM_PER_AU = 149597870.7;

export interface SolarBodyDefinition {
  body: Body;
  name: string;
  english: string;
  color: Vec3;
  radiusKm: number;
}

export const SOLAR_BODY_DEFINITIONS: readonly SolarBodyDefinition[] = [
  { body: Body.Sun, name: '太阳', english: 'Sun', color: [1, 0.83, 0.52], radiusKm: 695700 },
  { body: Body.Moon, name: '月球', english: 'Moon', color: [0.86, 0.89, 0.94], radiusKm: 1737.4 },
  {
    body: Body.Mercury,
    name: '水星',
    english: 'Mercury',
    color: [0.72, 0.68, 0.62],
    radiusKm: 2439.7,
  },
  { body: Body.Venus, name: '金星', english: 'Venus', color: [0.96, 0.88, 0.69], radiusKm: 6051.8 },
  { body: Body.Mars, name: '火星', english: 'Mars', color: [0.95, 0.51, 0.31], radiusKm: 3389.5 },
  {
    body: Body.Jupiter,
    name: '木星',
    english: 'Jupiter',
    color: [0.9, 0.77, 0.61],
    radiusKm: 69911,
  },
  { body: Body.Saturn, name: '土星', english: 'Saturn', color: [0.9, 0.82, 0.58], radiusKm: 58232 },
  {
    body: Body.Uranus,
    name: '天王星',
    english: 'Uranus',
    color: [0.57, 0.82, 0.86],
    radiusKm: 25362,
  },
  {
    body: Body.Neptune,
    name: '海王星',
    english: 'Neptune',
    color: [0.35, 0.52, 0.94],
    radiusKm: 24622,
  },
];

export interface SolarBodyPosition extends SolarBodyDefinition {
  eqjDirection: Vec3;
  worldDirection: Vec3;
  horizontal: HorizontalCoordinates;
  equatorial: EquatorialCoordinates;
  distanceAu: number;
  magnitude: number;
  phaseFraction: number;
  phaseAngle: number;
  angularRadius: number;
}

export function computeSolarBodies(frame: ObservationFrame): SolarBodyPosition[] {
  return SOLAR_BODY_DEFINITIONS.map((definition) => {
    const equator = Equator(definition.body, frame.time, frame.observer, false, true);
    const illumination = Illumination(definition.body, frame.time);
    const eqjDirection = normalize([equator.vec.x, equator.vec.y, equator.vec.z]);
    return {
      ...definition,
      eqjDirection,
      worldDirection: normalize(eqjToWorld(eqjDirection, frame)),
      horizontal: eqjToHorizontal(eqjDirection, frame),
      equatorial: apparentEquatorial(eqjDirection, frame),
      distanceAu: equator.dist,
      magnitude: illumination.mag,
      phaseFraction: illumination.phase_fraction,
      phaseAngle: illumination.phase_angle,
      angularRadius: Math.atan(definition.radiusKm / (equator.dist * KM_PER_AU)),
    };
  });
}
