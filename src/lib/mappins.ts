// Pure, DOM-free assembly of the /mapa pin list:
// preset cities + at most one user (search/geo) pin.
import type { City } from '../data/cities';

export type PinKind = 'preset' | 'search' | 'geo';

export interface MapPin {
  id: string;
  name: string;
  lat: number;
  lng: number;
  kind: PinKind;
  emoji?: string;
}

export function presetPins(cities: City[]): MapPin[] {
  return cities.map((c, i) => ({
    id: `preset-${i}`,
    name: c.name,
    lat: c.lat,
    lng: c.lng,
    kind: 'preset' as const,
    emoji: c.emoji,
  }));
}

export function withUserPin(
  pins: MapPin[],
  user: { name: string; lat: number; lng: number; kind: 'search' | 'geo' } | null,
): MapPin[] {
  const presets = pins.filter((p) => p.kind === 'preset');
  if (!user) return presets;
  return [...presets, { id: 'user', name: user.name, lat: user.lat, lng: user.lng, kind: user.kind }];
}
