export interface LabelRequest {
  id: string;
  text: string;
  x: number;
  y: number;
  className: string;
  priority: number;
  visible?: boolean;
  anchor?: 'left' | 'center';
  collide?: boolean;
}

interface LabelElement {
  element: HTMLSpanElement;
  text: string;
  className: string;
}

interface LabelBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export class LabelOverlay {
  private readonly labels = new Map<string, LabelElement>();

  constructor(private readonly container: HTMLElement) {}

  update(requests: LabelRequest[]): void {
    const used = new Set<string>();
    const boxes: LabelBox[] = [];
    const ordered = [...requests].sort((a, b) => b.priority - a.priority);
    for (const request of ordered) {
      if (request.visible === false || !Number.isFinite(request.x) || !Number.isFinite(request.y))
        continue;
      const anchor =
        request.anchor ??
        (request.className.includes('constellation') || request.className.includes('cardinal')
          ? 'center'
          : 'left');
      const width = Math.max(16, [...request.text].length * 7.2);
      const left = anchor === 'center' ? request.x - width / 2 : request.x + 10;
      const box = {
        left: left - 3,
        right: left + width + 3,
        top: request.y - 9,
        bottom: request.y + 9,
      };
      if (
        request.collide !== false &&
        boxes.some(
          (other) =>
            box.left < other.right &&
            box.right > other.left &&
            box.top < other.bottom &&
            box.bottom > other.top,
        )
      ) {
        continue;
      }
      boxes.push(box);
      used.add(request.id);
      let label = this.labels.get(request.id);
      if (!label) {
        const span = document.createElement('span');
        span.dataset.labelId = request.id;
        this.container.append(span);
        label = { element: span, text: '', className: '' };
        this.labels.set(request.id, label);
      }
      if (label.text !== request.text) {
        label.element.textContent = request.text;
        label.text = request.text;
      }
      if (label.className !== request.className) {
        label.element.className = request.className;
        label.className = request.className;
      }
      label.element.style.left = `${request.x.toFixed(1)}px`;
      label.element.style.top = `${request.y.toFixed(1)}px`;
      label.element.hidden = false;
    }
    for (const [id, label] of this.labels) {
      if (!used.has(id)) label.element.hidden = true;
    }
  }

  clear(): void {
    for (const label of this.labels.values()) label.element.hidden = true;
  }

  dispose(): void {
    this.container.replaceChildren();
    this.labels.clear();
  }
}
