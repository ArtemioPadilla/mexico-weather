/**
 * favorites.ts — Lógica pura para la lista de "Tus lugares" favoritos.
 *
 * El módulo es libre de DOM y de efectos secundarios globales: todas las
 * operaciones reciben un almacenamiento inyectable
 * (`Pick<Storage,'getItem'|'setItem'|'removeItem'>`) para poder probarse en
 * memoria. Los favoritos viven únicamente en el navegador (localStorage) y
 * nunca se envían a ningún servidor.
 */

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Clave usada en localStorage para persistir los favoritos. */
export const FAVORITES_KEY = 'secid-mwx-favorites';

/** Número máximo de lugares favoritos que se permiten guardar. */
export const MAX_FAVORITES = 12;

export interface Favorite {
  lat: number;
  lng: number;
  name: string;
  admin?: string;
  tz?: string;
  addedAt: number;
}

/** Redondea un número a 3 decimales (granularidad de deduplicación). */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Clave de identidad de un lugar: lat/lng redondeados a 3 decimales unidos
 * por una coma. p.ej. keyOf(19.432109,-99.133987) === '19.432,-99.134'.
 */
export function keyOf(lat: number, lng: number): string {
  return `${round3(lat)},${round3(lng)}`;
}

/** Type guard: una entrada válida tiene lat/lng numéricos, name string y addedAt number. */
function isFavorite(v: unknown): v is Favorite {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.lat === 'number' &&
    Number.isFinite(o.lat) &&
    typeof o.lng === 'number' &&
    Number.isFinite(o.lng) &&
    typeof o.name === 'string' &&
    typeof o.addedAt === 'number'
  );
}

/** Lee y valida la lista de favoritos. Cualquier fallo o dato inválido → []. */
export function load(storage: StorageLike): Favorite[] {
  let raw: string | null;
  try {
    raw = storage.getItem(FAVORITES_KEY);
  } catch {
    return [];
  }
  if (raw == null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isFavorite);
}

/** Persiste la lista (best-effort: los errores de setItem se ignoran). */
export function save(storage: StorageLike, favs: Favorite[]): void {
  try {
    storage.setItem(FAVORITES_KEY, JSON.stringify(favs));
  } catch {
    // Almacenamiento bloqueado o lleno: degradar silenciosamente.
  }
}

/** Alias de `load`. */
export function list(storage: StorageLike): Favorite[] {
  return load(storage);
}

/** ¿Existe ya un favorito en esa coordenada (a 3 decimales)? */
export function has(storage: StorageLike, lat: number, lng: number): boolean {
  const k = keyOf(lat, lng);
  return load(storage).some((f) => keyOf(f.lat, f.lng) === k);
}

/**
 * Agrega un favorito. Devuelve `false` (no-op) si ya existe uno con la misma
 * clave o si se alcanzó el máximo; `true` y persiste en caso de éxito.
 */
export function add(storage: StorageLike, fav: Favorite): boolean {
  const favs = load(storage);
  if (favs.length >= MAX_FAVORITES) return false;
  const k = keyOf(fav.lat, fav.lng);
  if (favs.some((f) => keyOf(f.lat, f.lng) === k)) return false;
  favs.push(fav);
  save(storage, favs);
  return true;
}

/** Elimina un favorito por coordenada. Devuelve `true` si se eliminó algo. */
export function remove(
  storage: StorageLike,
  lat: number,
  lng: number,
): boolean {
  const favs = load(storage);
  const k = keyOf(lat, lng);
  const next = favs.filter((f) => keyOf(f.lat, f.lng) !== k);
  if (next.length === favs.length) return false;
  save(storage, next);
  return true;
}

/**
 * Alterna un favorito y devuelve el NUEVO estado: si estaba presente lo
 * elimina y devuelve `false`; si estaba ausente lo agrega y devuelve el
 * resultado de `add` (es decir `false` si se alcanzó el tope).
 */
export function toggle(storage: StorageLike, fav: Favorite): boolean {
  if (has(storage, fav.lat, fav.lng)) {
    remove(storage, fav.lat, fav.lng);
    return false;
  }
  return add(storage, fav);
}
