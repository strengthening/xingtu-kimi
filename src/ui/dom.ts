export function requiredElement<T extends Element = HTMLElement>(id: string): T {
  const found = document.querySelector<T>(`#${id}`);
  if (!found) throw new Error(`Missing interface element #${id}`);
  return found;
}
