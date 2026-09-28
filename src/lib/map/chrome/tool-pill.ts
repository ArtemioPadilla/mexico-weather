/**
 * Active-tool context pill — Story 22.3 (plan PARIDAD_VISUAL E22).
 *
 * The tools moved behind the "⋯" menu, so their "on" state can no longer
 * be read off a pressed pill on the map edge. While any tool is on —
 * measuring a distance or an area, the crosshair, or a snapshot overlay —
 * ONE pill at the top of the map names it and offers "Salir", which turns
 * every active tool off. Nothing is shown when no tool is on.
 *
 *   activeToolNames()  pure: tool state → the names to show, in a fixed order
 *   createToolPill()   DOM: fills the label, shows/hides the pill, wires Salir
 */

export type MeasureTool = 'distance' | 'area' | null;

export interface ToolState {
  measure: MeasureTool;
  crosshair: boolean;
  compare: boolean;
}

export interface ToolNames {
  distance: string;
  area: string;
  crosshair: string;
  compare: string;
}

export const NO_TOOLS: ToolState = {
  measure: null,
  crosshair: false,
  compare: false,
};

/** Names of the tools that are on, measure first, then the crosshair, then
 *  the snapshot comparison. Empty when none is on. */
export function activeToolNames(state: ToolState, names: ToolNames): string[] {
  const out: string[] = [];
  if (state.measure === 'distance') out.push(names.distance);
  else if (state.measure === 'area') out.push(names.area);
  if (state.crosshair) out.push(names.crosshair);
  if (state.compare) out.push(names.compare);
  return out;
}

export interface ToolPillEls {
  pill: HTMLElement | null;
  label: HTMLElement | null;
  exit: HTMLElement | null;
}

export interface ToolPill {
  /** Re-render from the current tool state. */
  update: (state: ToolState) => void;
  dispose: () => void;
}

export function createToolPill(
  els: ToolPillEls,
  names: ToolNames,
  onExit: () => void
): ToolPill {
  const exit = (): void => onExit();
  els.exit?.addEventListener('click', exit);

  function update(state: ToolState): void {
    const list = activeToolNames(state, names);
    if (els.label) els.label.textContent = list.join(' · ');
    if (els.pill) els.pill.hidden = list.length === 0;
  }

  update(NO_TOOLS);
  return {
    update,
    dispose: (): void => {
      els.exit?.removeEventListener('click', exit);
    },
  };
}
