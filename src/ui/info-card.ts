import { Body } from 'astronomy-engine';
import type { EquatorialCoordinates } from '../astro/coordinates.ts';
import { RAD2DEG } from '../astro/math.ts';
import type { ResolvedSkyTarget } from '../render/picking.ts';
import { requiredElement } from './dom.ts';

export function formatRightAscension(hours: number): string {
  const dayTenths = 24 * 3600 * 10;
  const totalTenths = ((Math.round(hours * 3600 * 10) % dayTenths) + dayTenths) % dayTenths;
  const hour = Math.floor(totalTenths / 36000);
  const minute = Math.floor((totalTenths % 36000) / 600);
  const second = ((totalTenths % 600) / 10).toFixed(1).padStart(4, '0');
  return `${String(hour).padStart(2, '0')}h ${String(minute).padStart(2, '0')}m ${second}s`;
}

export function formatDeclination(degrees: number): string {
  const sign = degrees < 0 ? '−' : '+';
  const totalSeconds = Math.round(Math.abs(degrees) * 3600);
  const degree = Math.floor(totalSeconds / 3600);
  const minute = Math.floor((totalSeconds % 3600) / 60);
  const second = String(totalSeconds % 60).padStart(2, '0');
  return `${sign}${String(degree).padStart(2, '0')}° ${String(minute).padStart(2, '0')}′ ${second}″`;
}

function equatorialDetails(prefix: string, coordinates: EquatorialCoordinates): [string, string][] {
  return [
    [`${prefix}赤经`, formatRightAscension(coordinates.ra)],
    [`${prefix}赤纬`, formatDeclination(coordinates.dec)],
  ];
}

export class InfoCard {
  private readonly root = requiredElement('info-card');
  private readonly type = requiredElement('info-type');
  private readonly name = requiredElement('info-name');
  private readonly catalog = requiredElement('info-catalog');
  private readonly details = requiredElement('info-details');
  private readonly closeButton = requiredElement<HTMLButtonElement>('info-close');

  constructor(onClose: () => void) {
    this.close = (): void => {
      this.hide();
      onClose();
    };
    this.closeButton.addEventListener('click', this.close);
  }

  private readonly close: () => void;

  show(target: ResolvedSkyTarget): void {
    const rows: [string, string][] = [];
    if (target.kind === 'star') {
      this.type.textContent = '恒星';
      this.name.textContent = target.name;
      this.catalog.textContent = [
        target.english,
        target.hip > 0 ? `HIP ${target.hip}` : '',
        target.tyc,
      ]
        .filter(Boolean)
        .join(' · ');
      rows.push(
        ['视星等', `${target.magnitude.toFixed(2)} mag`],
        ['B−V 色指数', target.colorIndex.toFixed(3)],
        ...equatorialDetails('J2000 ', target.j2000),
        ...equatorialDetails('观测时刻 ', target.apparent),
        ['方位角', `${target.horizontal.azimuth.toFixed(3)}°`],
        ['高度', `${target.horizontal.altitude.toFixed(3)}°`],
      );
    } else {
      const body = target.body;
      this.type.textContent =
        body.body === Body.Sun ? '太阳' : body.body === Body.Moon ? '月球' : '行星';
      this.name.textContent = body.name;
      this.catalog.textContent = `${body.english} · 站心星历`;
      rows.push(
        ['视星等', `${body.magnitude.toFixed(2)} mag`],
        ['站心距离', `${body.distanceAu.toFixed(body.distanceAu < 0.01 ? 6 : 4)} AU`],
        ['照亮比例', `${(body.phaseFraction * 100).toFixed(1)}%`],
        ['相位角', `${body.phaseAngle.toFixed(2)}°`],
        ['视直径', `${(2 * body.angularRadius * RAD2DEG * 60).toFixed(2)}′`],
        ...equatorialDetails('观测时刻 ', body.equatorial),
        ['方位角', `${body.horizontal.azimuth.toFixed(3)}°`],
        ['高度', `${body.horizontal.altitude.toFixed(3)}°`],
      );
    }
    this.details.replaceChildren();
    for (const [label, value] of rows) {
      const term = document.createElement('dt');
      const description = document.createElement('dd');
      term.textContent = label;
      description.textContent = value;
      this.details.append(term, description);
    }
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  dispose(): void {
    this.closeButton.removeEventListener('click', this.close);
  }
}
