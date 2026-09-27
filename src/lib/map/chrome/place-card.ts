/**
 * Place card — the "tap anywhere on the map" forecast panel
 * (Story 15.4, plan PRO_GRATIS E15). zoom.earth shows 5 daily rows
 * free and 10 on Pro; we show 10 daily + 48 hourly for any point.
 *
 * Pure renderer: takes a Forecast (src/lib/forecast.ts) and returns
 * HTML. interactive-map.ts owns the fetch, the marker, the toggles and
 * the favourite button; this module owns the markup so it can be
 * unit-tested without a map.
 *
 * Every interactive element carries a `data-pc-*` attribute the caller
 * delegates on: `data-pc-close`, `data-pc-fav`, `data-pc-mode="daily|hourly"`.
 */
import type { Forecast } from '../../forecast';
import { formatTemp, type TempUnit } from '../../units';

export type PlaceCardMode = 'daily' | 'hourly';

export interface PlaceCardStrings {
  title: string;
  daily: string;
  hourly: string;
  close: string;
  favAdd: string;
  favRemove: string;
  fullForecast: string;
  loading: string;
  today: string;
  tomorrow: string;
  error: string;
}

export interface PlaceCardOpts {
  mode: PlaceCardMode;
  /** "19°26′N 99°08′O" — shown as the card's name. */
  coordsLabel: string;
  /** Link to /forecast?lat=&lng=… */
  forecastHref: string;
  isFavorite: boolean;
  /** Optional one-line reading at the point from the active layer
   *  (tooltipValueAt), e.g. "🌡 24° · 💧 60%". */
  nowLine?: string | null;
  strings: PlaceCardStrings;
  lang: 'es' | 'en';
  /** Local "today" as YYYY-MM-DD, so the first row can read "Hoy". */
  todayIso: string;
  /** Story 19.3 — temperature display unit (data is °C). Default °C. */
  tempUnit?: TempUnit;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

/** Trailing emoji of a WMO condition string ("Lluvia 🌧️" → "🌧️"). */
export function conditionGlyph(condition: string): string {
  const parts = condition.trim().split(/\s+/);
  const last = parts[parts.length - 1] ?? '';
  return /\p{Extended_Pictographic}/u.test(last) ? last : '·';
}

function fmt(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n)
    ? '—'
    : String(Math.round(n));
}

/** Temperature in the card's unit, degree sign included ("24°"). */
function fmtTemp(c: number | null | undefined, o: PlaceCardOpts): string {
  return c === null || c === undefined || !Number.isFinite(c)
    ? '—°'
    : formatTemp(c, o.tempUnit ?? 'C');
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dayLabel(
  date: string,
  o: Pick<PlaceCardOpts, 'lang' | 'todayIso' | 'strings'>
): string {
  if (date === o.todayIso) return o.strings.today;
  if (date === addDays(o.todayIso, 1)) return o.strings.tomorrow;
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(o.lang === 'en' ? 'en-US' : 'es-MX', {
    weekday: 'short',
  });
}

const BTN =
  'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-300 dark:hover:bg-gray-800';
const TAB =
  'inline-flex min-h-[44px] flex-1 items-center justify-center rounded-full px-3 text-xs font-semibold aria-selected:bg-blue-600 aria-selected:text-white text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-200 dark:hover:bg-gray-800';

function barFill(
  lo: number | null,
  hi: number | null,
  min: number,
  span: number
): string {
  if (lo === null || hi === null) return '';
  const l = Math.min(100, Math.max(0, ((lo - min) / span) * 100));
  const h = Math.min(100, Math.max(0, ((hi - min) / span) * 100));
  const left = Math.min(l, h);
  const width = Math.max(2, Math.abs(h - l));
  return `<i style="position:absolute;left:${left.toFixed(1)}%;width:${width.toFixed(1)}%;height:100%;border-radius:9999px;background:linear-gradient(90deg,#60a5fa,#fbbf24,#f97316)"></i>`;
}

export function renderDailyRows(fc: Forecast, o: PlaceCardOpts): string {
  const days = fc.daily.slice(0, 10);
  const mins = days.map((d) => d.tmin).filter((v): v is number => v !== null);
  const maxs = days.map((d) => d.tmax).filter((v): v is number => v !== null);
  const min = mins.length ? Math.min(...mins) : 0;
  const max = maxs.length ? Math.max(...maxs) : 1;
  const span = max - min || 1;
  return days
    .map(
      (d) =>
        `<div data-pc-day="${esc(d.date)}" class="grid grid-cols-[3.4rem_1.25rem_1fr_2.4rem_4.4rem] items-center gap-1.5 py-1 text-sm">` +
        `<span class="capitalize text-gray-700 dark:text-gray-300">${esc(dayLabel(d.date, o))}</span>` +
        `<span class="text-center" aria-hidden="true">${esc(conditionGlyph(d.condition))}</span>` +
        `<span class="relative h-1.5 rounded-full bg-gray-200 dark:bg-gray-800">${barFill(d.tmin, d.tmax, min, span)}</span>` +
        `<span class="text-right text-xs text-blue-600 dark:text-blue-400">${fmt(d.precipProbabilityMax)}%</span>` +
        `<span class="text-right tabular-nums text-gray-800 dark:text-gray-100">${fmtTemp(d.tmin, o)} / ${fmtTemp(d.tmax, o)}</span>` +
        `</div>`
    )
    .join('');
}

export function renderHourlyRows(fc: Forecast, o: PlaceCardOpts): string {
  const hours = fc.hourly.slice(0, 48);
  let lastDate = '';
  return hours
    .map((h) => {
      const date = h.time.slice(0, 10);
      const hh = h.time.slice(11, 16);
      let sep = '';
      if (date !== lastDate) {
        lastDate = date;
        sep = `<div class="pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">${esc(dayLabel(date, o))}</div>`;
      }
      return (
        sep +
        `<div data-pc-hour="${esc(h.time)}" class="grid grid-cols-[3rem_1.25rem_1fr_2.4rem] items-center gap-1.5 py-0.5 text-sm">` +
        `<span class="tabular-nums text-gray-700 dark:text-gray-300">${esc(hh)}</span>` +
        `<span class="text-center" aria-hidden="true">${esc(conditionGlyph(h.condition))}</span>` +
        `<span class="tabular-nums text-gray-800 dark:text-gray-100">${fmtTemp(h.temperature, o)}</span>` +
        `<span class="text-right text-xs text-blue-600 dark:text-blue-400">${fmt(h.precipProbability)}%</span>` +
        `</div>`
      );
    })
    .join('');
}

function header(o: PlaceCardOpts): string {
  const s = o.strings;
  return (
    `<div class="flex items-start justify-between gap-2 px-3 pt-2">` +
    `<div class="min-w-0">` +
    `<p class="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">${esc(s.title)}</p>` +
    `<p class="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">${esc(o.coordsLabel)}</p>` +
    (o.nowLine
      ? `<p class="text-xs text-gray-600 dark:text-gray-300">${esc(o.nowLine)}</p>`
      : '') +
    `</div>` +
    `<div class="flex shrink-0 gap-0.5">` +
    `<button type="button" data-pc-fav class="${BTN} ${o.isFavorite ? 'text-amber-500 dark:text-amber-400' : ''}" aria-pressed="${o.isFavorite ? 'true' : 'false'}" aria-label="${esc(o.isFavorite ? s.favRemove : s.favAdd)}" title="${esc(o.isFavorite ? s.favRemove : s.favAdd)}"><svg class="h-5 w-5" aria-hidden="true"><use href="#i-star"></use></svg></button>` +
    `<button type="button" data-pc-close class="${BTN}" aria-label="${esc(s.close)}" title="${esc(s.close)}"><svg class="h-5 w-5" aria-hidden="true"><use href="#i-x"></use></svg></button>` +
    `</div></div>`
  );
}

/** Card shell shown while the forecast is loading (or failed). */
export function renderPlaceCardStatus(
  o: PlaceCardOpts,
  status: 'loading' | 'error'
): string {
  const s = o.strings;
  return (
    header(o) +
    `<p class="px-3 pb-3 pt-2 text-sm ${status === 'error' ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}" aria-live="polite">${esc(status === 'error' ? s.error : s.loading)}</p>`
  );
}

export function renderPlaceCard(fc: Forecast, o: PlaceCardOpts): string {
  const s = o.strings;
  const daily = o.mode === 'daily';
  return (
    header(o) +
    `<div role="tablist" class="flex gap-1 px-3 pt-1">` +
    `<button type="button" role="tab" data-pc-mode="daily" aria-selected="${daily}" class="${TAB}">${esc(s.daily)}</button>` +
    `<button type="button" role="tab" data-pc-mode="hourly" aria-selected="${!daily}" class="${TAB}">${esc(s.hourly)}</button>` +
    `</div>` +
    `<div data-pc-rows class="max-h-[42vh] overflow-y-auto px-3 pb-1 sm:max-h-80">` +
    (daily ? renderDailyRows(fc, o) : renderHourlyRows(fc, o)) +
    `</div>` +
    `<div class="px-3 pb-3 pt-1">` +
    `<a href="${esc(o.forecastHref)}" class="inline-flex min-h-[44px] items-center text-sm font-medium text-blue-700 hover:underline dark:text-blue-300">${esc(s.fullForecast)} →</a>` +
    `</div>`
  );
}
