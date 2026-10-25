import {
  BaryState,
  Body,
  MakeTime,
  Observer as EngineObserver,
  Rotation_EQD_HOR,
  Rotation_EQJ_EQD,
  type AstroTime,
  type RotationMatrix,
} from 'astronomy-engine';
import {
  DEG2RAD,
  RAD2DEG,
  multiply,
  normalize,
  normalizeDegrees,
  transform,
  transpose,
  type Mat3,
  type Vec3,
} from './math.ts';

const SPEED_OF_LIGHT_AU_PER_DAY = 173.14463267424;

export interface ObserverLocation {
  latitude: number;
  longitude: number;
  elevation?: number;
}

export interface HorizontalCoordinates {
  azimuth: number;
  altitude: number;
}

export interface EquatorialCoordinates {
  ra: number;
  dec: number;
}

export interface ObservationFrame {
  time: AstroTime;
  location: ObserverLocation;
  observer: EngineObserver;
  yearsSinceJ2000: number;
  earthVelocity: Vec3;
  eqjToEqd: Mat3;
  eqdToWorld: Mat3;
  eqjToWorld: Mat3;
  worldToEqj: Mat3;
}

function rotationElement(rotation: RotationMatrix, row: number, column: number): number {
  const value = rotation.rot[column]?.[row];
  if (value === undefined) throw new Error('Invalid astronomy-engine rotation matrix');
  return value;
}

function conventionalMatrix(rotation: RotationMatrix): Mat3 {
  return [
    rotationElement(rotation, 0, 0),
    rotationElement(rotation, 0, 1),
    rotationElement(rotation, 0, 2),
    rotationElement(rotation, 1, 0),
    rotationElement(rotation, 1, 1),
    rotationElement(rotation, 1, 2),
    rotationElement(rotation, 2, 0),
    rotationElement(rotation, 2, 1),
    rotationElement(rotation, 2, 2),
  ];
}

export function createObservationFrame(date: Date, location: ObserverLocation): ObservationFrame {
  const time = MakeTime(date);
  const observer = new EngineObserver(
    location.latitude,
    location.longitude,
    location.elevation ?? 0,
  );
  const eqjToEqd = conventionalMatrix(Rotation_EQJ_EQD(time));
  const eqdToHorizontal = conventionalMatrix(Rotation_EQD_HOR(time, observer));
  const horizontalToWorld: Mat3 = [0, -1, 0, 0, 0, 1, -1, 0, 0];
  const eqdToWorld = multiply(horizontalToWorld, eqdToHorizontal);
  const eqjToWorld = multiply(eqdToWorld, eqjToEqd);
  const earth = BaryState(Body.Earth, time);
  return {
    time,
    location: { ...location },
    observer,
    yearsSinceJ2000: time.tt / 365.25,
    earthVelocity: [
      earth.vx / SPEED_OF_LIGHT_AU_PER_DAY,
      earth.vy / SPEED_OF_LIGHT_AU_PER_DAY,
      earth.vz / SPEED_OF_LIGHT_AU_PER_DAY,
    ],
    eqjToEqd,
    eqdToWorld,
    eqjToWorld,
    worldToEqj: transpose(eqjToWorld),
  };
}

export function equatorialToDirection(raHours: number, decDegrees: number): Vec3 {
  const ra = raHours * 15 * DEG2RAD;
  const dec = decDegrees * DEG2RAD;
  const cosDec = Math.cos(dec);
  return [cosDec * Math.cos(ra), cosDec * Math.sin(ra), Math.sin(dec)];
}

export function directionToEquatorial(direction: Vec3): EquatorialCoordinates {
  const normalized = normalize(direction);
  return {
    ra: normalizeDegrees(Math.atan2(normalized[1], normalized[0]) * RAD2DEG) / 15,
    dec: Math.asin(Math.max(-1, Math.min(1, normalized[2]))) * RAD2DEG,
  };
}

export function horizontalToWorld(azimuthDegrees: number, altitudeDegrees: number): Vec3 {
  const azimuth = azimuthDegrees * DEG2RAD;
  const altitude = altitudeDegrees * DEG2RAD;
  const cosAltitude = Math.cos(altitude);
  return [cosAltitude * Math.sin(azimuth), Math.sin(altitude), -cosAltitude * Math.cos(azimuth)];
}

export function worldToHorizontal(direction: Vec3): HorizontalCoordinates {
  const normalized = normalize(direction);
  return {
    azimuth: normalizeDegrees(Math.atan2(normalized[0], -normalized[2]) * RAD2DEG),
    altitude: Math.asin(Math.max(-1, Math.min(1, normalized[1]))) * RAD2DEG,
  };
}

export function eqjToWorld(direction: Vec3, frame: ObservationFrame): Vec3 {
  return transform(frame.eqjToWorld, direction);
}

export function worldToEqj(direction: Vec3, frame: ObservationFrame): Vec3 {
  return transform(frame.worldToEqj, direction);
}

export function eqjToHorizontal(direction: Vec3, frame: ObservationFrame): HorizontalCoordinates {
  return worldToHorizontal(eqjToWorld(direction, frame));
}

export function horizontalToEqj(
  azimuthDegrees: number,
  altitudeDegrees: number,
  frame: ObservationFrame,
): Vec3 {
  return worldToEqj(horizontalToWorld(azimuthDegrees, altitudeDegrees), frame);
}

export function apparentEquatorial(
  direction: Vec3,
  frame: ObservationFrame,
): EquatorialCoordinates {
  return directionToEquatorial(transform(frame.eqjToEqd, direction));
}
