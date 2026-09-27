/**
 * Snapshot-compare tool (plan 3.3).
 *
 * Captures the current MapLibre WebGL canvas to a translucent <img>
 * overlay so the user can scrub the timeline / switch layers and see
 * the "before" state alongside the live map. No extra network fetches.
 *
 * Factory:
 *   createSnapshotCompare({ map, captureBtn, toggleBtn, clearBtn,
 *                          imgEl })
 *   → { refresh }
 *
 * Wires the three buttons' click handlers internally; consumer just
 * calls refresh() once to initialise visibility.
 */
import type maplibregl from 'maplibre-gl';

export interface SnapshotCompareEls {
  map: maplibregl.Map;
  captureBtn: HTMLElement | null;
  /** Story 13.5 — "Hace 24 h" button; optional. */
  compareBtn?: HTMLElement | null;
  toggleBtn: HTMLElement | null;
  clearBtn: HTMLElement | null;
  imgEl: HTMLImageElement | null;
}

export interface SnapshotCompare {
  /** Re-sync button + overlay visibility with internal state. */
  refresh: () => void;
}

export interface SnapshotCompareDeps {
  /** Story 13.5 — move the timeline by `bySec` (negative = past);
   *  false when there is no time axis to move. */
  shiftTime?: (bySec: number) => boolean;
}

export function createSnapshotCompare(
  els: SnapshotCompareEls,
  deps: SnapshotCompareDeps = {}
): SnapshotCompare {
  let visible = true;

  function capture(): boolean {
    try {
      // MapLibre needs preserveDrawingBuffer=true to read the canvas;
      // we trigger a synchronous render first so we grab the most
      // recent frame rather than an in-flight one.
      els.map.triggerRepaint();
      const url = els.map.getCanvas().toDataURL('image/png');
      if (els.imgEl) {
        els.imgEl.src = url;
        visible = true;
        refresh();
      }
      return true;
    } catch {
      /* WebGL context lost / canvas tainted — degrade silently */
      return false;
    }
  }

  function refresh(): void {
    if (!els.imgEl) return;
    const has = !!els.imgEl.src;
    // The [hidden] attribute (not the `hidden` class): the pills carry
    // an inline-flex display utility that would tie with the class.
    if (els.captureBtn) els.captureBtn.hidden = has;
    if (els.compareBtn) els.compareBtn.hidden = has;
    if (els.toggleBtn) els.toggleBtn.hidden = !has;
    if (els.clearBtn) els.clearBtn.hidden = !has;
    els.imgEl.classList.toggle('hidden', !has || !visible);
    if (els.toggleBtn) {
      // The markup ships an <svg> icon + a labelled span; only the
      // label text changes so the icon survives.
      const label =
        els.toggleBtn.querySelector('[data-mw-snapshot-label]') ??
        els.toggleBtn;
      label.textContent = visible
        ? 'Ocultar comparación'
        : 'Mostrar comparación';
      els.toggleBtn.setAttribute('aria-pressed', String(visible));
    }
  }

  els.captureBtn?.addEventListener('click', () => {
    capture();
  });
  // Story 13.5 — temporal before/after in one click: freeze the current
  // frame as the overlay, then move the timeline 24 h back so the
  // toggle flips between "hace 24 h" (live) and "ahora" (captured).
  els.compareBtn?.addEventListener('click', () => {
    if (!deps.shiftTime) return;
    if (!capture()) return;
    if (!deps.shiftTime(-86400)) {
      els.imgEl?.removeAttribute('src');
      refresh();
    }
  });
  els.toggleBtn?.addEventListener('click', () => {
    visible = !visible;
    refresh();
  });
  els.clearBtn?.addEventListener('click', () => {
    if (!els.imgEl) return;
    els.imgEl.removeAttribute('src');
    visible = true;
    refresh();
  });

  return { refresh };
}
