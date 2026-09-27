import { describe, expect, it } from 'vitest';
import type { Forecast } from '../../forecast';
import {
  conditionGlyph,
  dayLabel,
  renderDailyRows,
  renderHourlyRows,
  renderPlaceCard,
  renderPlaceCardStatus,
  type PlaceCardOpts,
} from './place-card';

const strings = {
  title: 'Punto seleccionado',
  daily: 'Diario',
  hourly: 'Horario',
  close: 'Cerrar',
  favAdd: 'Agregar a favoritos',
  favRemove: 'Quitar de favoritos',
  fullForecast: 'Ver pronóstico completo',
  loading: 'Cargando pronóstico…',
  today: 'Hoy',
  tomorrow: 'Mañana',
  error: 'No se pudo cargar.',
};

function fc(days = 12, hours = 60): Forecast {
  const t0 = Date.UTC(2026, 8, 27);
  const daily = Array.from({ length: days }, (_, i) => ({
    date: new Date(t0 + i * 86_400_000).toISOString().slice(0, 10),
    weatherCode: 61,
    condition: 'Lluvia 🌧️',
    tmax: 26 + i,
    tmin: 12 + i,
    precipProbabilityMax: 40,
    uvMax: 7,
    windMax: 12,
    sunrise: null,
    sunset: null,
  }));
  const hourly = Array.from({ length: hours }, (_, i) => ({
    time: new Date(t0 + i * 3_600_000).toISOString().slice(0, 16),
    temperature: 15 + (i % 24) / 2,
    weatherCode: 2,
    condition: 'Parcialmente nublado ⛅',
    precipProbability: 10,
    windSpeed: 8,
  }));
  return {
    current: {
      temperature: 21,
      feelsLike: 21,
      weatherCode: 2,
      condition: 'Parcialmente nublado ⛅',
      precipProbability: 10,
      windSpeed: 8,
      windGusts: 12,
      windDir: 90,
      uvIndex: 5,
      cloudCover: 30,
      humidity: 50,
      pressure: 1015,
      visibilityKm: 20,
    },
    hourly,
    daily,
  };
}

const opts = (over: Partial<PlaceCardOpts> = {}): PlaceCardOpts => ({
  mode: 'daily',
  coordsLabel: '19°26′N 99°08′O',
  forecastHref: '/mexico-weather/forecast?lat=19.43&lng=-99.13',
  isFavorite: false,
  strings,
  lang: 'es',
  todayIso: '2026-09-27',
  ...over,
});

describe('place card renderer', () => {
  it('daily mode shows at most 10 rows, first two labelled Hoy / Mañana', () => {
    const html = renderDailyRows(fc(), opts());
    expect(html.match(/data-pc-day=/g)).toHaveLength(10);
    expect(html).toContain('>Hoy<');
    expect(html).toContain('>Mañana<');
    expect(html).toContain('12° / 26°');
  });

  it('hourly mode caps at 48 rows and inserts a day separator when the date changes', () => {
    const html = renderHourlyRows(fc(), opts({ mode: 'hourly' }));
    expect(html.match(/data-pc-hour=/g)).toHaveLength(48);
    // 48 hours from midnight span exactly two dates → two separators.
    expect(html.match(/uppercase tracking-wide/g)).toHaveLength(2);
  });

  it('full card carries tabs, the favourite + close buttons and the full-forecast link', () => {
    const html = renderPlaceCard(
      fc(),
      opts({ isFavorite: true, nowLine: '🌡 24°' })
    );
    expect(html).toContain('data-pc-mode="daily" aria-selected="true"');
    expect(html).toContain('data-pc-mode="hourly" aria-selected="false"');
    expect(html).toContain('data-pc-fav');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('data-pc-close');
    expect(html).toContain(
      'href="/mexico-weather/forecast?lat=19.43&amp;lng=-99.13"'
    );
    expect(html).toContain('🌡 24°');
  });

  it('escapes user-visible strings', () => {
    const html = renderPlaceCardStatus(
      opts({ coordsLabel: '<img src=x onerror=alert(1)>' }),
      'loading'
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain('Cargando pronóstico…');
  });

  it('renders temperatures in °F when asked (Story 19.3)', () => {
    const html = renderDailyRows(fc(), opts({ tempUnit: 'F' }));
    expect(html).toContain('54° / 79°');
    expect(html).not.toContain('12° / 26°');
  });

  it('helpers: glyph extraction and weekday labels', () => {
    expect(conditionGlyph('Lluvia 🌧️')).toBe('🌧️');
    expect(conditionGlyph('sin emoji')).toBe('·');
    expect(dayLabel('2026-09-27', opts())).toBe('Hoy');
    expect(dayLabel('2026-09-28', opts())).toBe('Mañana');
    expect(dayLabel('2026-09-30', opts({ lang: 'en' }))).toMatch(/^Wed/);
  });
});
