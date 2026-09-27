// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type maplibregl from 'maplibre-gl';
import { createSnapshotCompare } from './snapshot-compare';

function els() {
  const mk = (id: string) => {
    const b = document.createElement('button');
    b.id = id;
    return b;
  };
  const img = document.createElement('img');
  const map = {
    triggerRepaint: () => undefined,
    getCanvas: () => ({ toDataURL: () => 'data:image/png;base64,AAAA' }),
  } as unknown as maplibregl.Map;
  return {
    map,
    captureBtn: mk('c'),
    compareBtn: mk('c24'),
    toggleBtn: mk('t'),
    clearBtn: mk('x'),
    imgEl: img,
  };
}

describe('snapshot compare — "hace 24 h" (Story 13.5)', () => {
  it('captures the current frame and shifts the timeline 24 h back', () => {
    const e = els();
    const shiftTime = vi.fn(() => true);
    createSnapshotCompare(e, { shiftTime }).refresh();
    expect(e.compareBtn.hidden).toBe(false);
    e.compareBtn.click();
    expect(shiftTime).toHaveBeenCalledWith(-86400);
    expect(e.imgEl.src).toContain('data:image/png');
    expect(e.compareBtn.hidden).toBe(true);
    expect(e.toggleBtn.hidden).toBe(false);
    e.toggleBtn.click();
    expect(e.imgEl.classList.contains('hidden')).toBe(true);
    e.clearBtn.click();
    expect(e.imgEl.getAttribute('src')).toBeNull();
    expect(e.compareBtn.hidden).toBe(false);
  });

  it('drops the capture when there is no timeline to move', () => {
    const e = els();
    createSnapshotCompare(e, { shiftTime: () => false }).refresh();
    e.compareBtn.click();
    expect(e.imgEl.getAttribute('src')).toBeNull();
    expect(e.compareBtn.hidden).toBe(false);
  });
});
