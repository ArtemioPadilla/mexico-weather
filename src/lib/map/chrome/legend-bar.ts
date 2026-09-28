/**
 * Story 24.3 — paints a `LegendScale` (legend-scale.ts) into the legend
 * bar of InteractiveMap.astro: the gradient on `.im-legend-ramp`, one
 * `<li>` per tick in the ticks list (`#legend`, the same id as the old
 * swatch list, so `#legend li` still counts the stops) and the unit in
 * `#legend-unit`. Text goes in through `textContent` only (XSS-safe).
 *
 * Labels that would touch on a narrow bar are hidden, not removed: the
 * tick and its mark stay, `data-hidden` hides the text (global.css).
 * The bar and the labels are measured in the page, so call this once
 * the legend is displayed; with no layout (0 px) every label shows.
 */
import { cssPercent, fitTickLabels, type LegendScale } from './legend-scale';

export interface LegendBarEls {
  /** The ticks list (`#legend` / `#<mapId>-legend`). */
  list: HTMLElement;
  /** The colour bar (`.im-legend-ramp`). */
  ramp: HTMLElement | null;
  /** The unit label (`#legend-unit`). */
  unit: HTMLElement | null;
}

export function paintLegendScale(els: LegendBarEls, s: LegendScale): void {
  if (els.ramp) els.ramp.style.backgroundImage = s.gradient;
  if (els.unit) els.unit.textContent = s.unit;
  const doc = els.list.ownerDocument;
  const labels: HTMLElement[] = [];
  const items = s.ticks.map((t) => {
    const li = doc.createElement('li');
    li.dataset.kind = t.kind;
    li.style.left = cssPercent(t.pos);
    if (t.kind === 'edge' && t.pos <= 0) li.dataset.align = 'start';
    else if (t.kind === 'edge' && t.pos >= 1) li.dataset.align = 'end';
    const label = doc.createElement('span');
    label.className = 'im-legend-label';
    label.textContent = t.label;
    li.append(label);
    labels.push(label);
    return li;
  });
  els.list.replaceChildren(...items);
  // Measured once they are in the page (real font metrics); with no
  // layout (hidden bar, jsdom) nothing is hidden.
  const width = els.ramp?.getBoundingClientRect().width ?? 0;
  if (!(width > 0)) return;
  const show = fitTickLabels(s.ticks, width, {
    measure: (l, i) => labels[i].getBoundingClientRect().width,
  });
  show.forEach((on, i) => {
    if (!on) labels[i].dataset.hidden = '';
  });
}

/** Empties the bar (no legend for the active layer). */
export function clearLegendScale(els: LegendBarEls): void {
  els.list.replaceChildren();
  if (els.ramp) els.ramp.style.backgroundImage = '';
  if (els.unit) els.unit.textContent = '';
}
