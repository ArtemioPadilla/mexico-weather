import { describe, it, expect } from 'vitest';
import { presetPins, withUserPin } from './mappins';
import type { City } from '../data/cities';

const sample: City[] = [
  { name: 'Ciudad de México', emoji: '🌆', lat: 19.43, lng: -99.13, tz: 'America/Mexico_City' },
  { name: 'Monterrey', emoji: '🏙️', lat: 25.67, lng: -100.31, tz: 'America/Mexico_City' },
];

describe('presetPins', () => {
  it('maps cities to preset pins with stable ids', () => {
    const pins = presetPins(sample);
    expect(pins).toEqual([
      { id: 'preset-0', name: 'Ciudad de México', lat: 19.43, lng: -99.13, kind: 'preset', emoji: '🌆' },
      { id: 'preset-1', name: 'Monterrey', lat: 25.67, lng: -100.31, kind: 'preset', emoji: '🏙️' },
    ]);
  });
});

describe('withUserPin', () => {
  it('returns presets unchanged when user is null', () => {
    const presets = presetPins(sample);
    expect(withUserPin(presets, null)).toEqual(presets);
  });

  it('appends a single user pin', () => {
    const presets = presetPins(sample);
    const out = withUserPin(presets, { name: 'Oaxaca', lat: 17.07, lng: -96.72, kind: 'search' });
    expect(out).toHaveLength(3);
    expect(out[2]).toEqual({ id: 'user', name: 'Oaxaca', lat: 17.07, lng: -96.72, kind: 'search' });
  });

  it('replaces a previous user pin (only one at a time)', () => {
    const presets = presetPins(sample);
    const once = withUserPin(presets, { name: 'A', lat: 1, lng: 2, kind: 'search' });
    const twice = withUserPin(once, { name: 'B', lat: 3, lng: 4, kind: 'geo' });
    expect(twice).toHaveLength(3);
    expect(twice[2]).toEqual({ id: 'user', name: 'B', lat: 3, lng: 4, kind: 'geo' });
  });
});
