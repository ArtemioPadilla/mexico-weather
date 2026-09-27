/**
 * Per-layer landing pages (Story 19.1, plan PRO_GRATIS E19):
 * /mapa/<slug>/ prerendered for every weather layer so "radar de lluvia
 * México" or "mapa de temperatura" have an indexable URL with unique
 * copy, opening the map on that layer. Pure data, shared by the page,
 * the sitemap and the rail's "página de esta capa" link.
 */
import { LAYERS, type LayerId } from './maplayers';

export interface LayerPage {
  id: LayerId;
  slug: string;
  titleEs: string;
  titleEn: string;
  descEs: string;
  descEn: string;
}

export const LAYER_PAGES: readonly LayerPage[] = [
  {
    id: 'radar',
    slug: 'radar',
    titleEs: 'Radar de lluvia en vivo',
    titleEn: 'Live rain radar',
    descEs:
      'Radar meteorológico de México en tiempo casi real: dónde llueve ahora, con animación de las últimas 2 horas y nowcast a 30 minutos. Datos de RainViewer, sin cuenta ni anuncios.',
    descEn:
      'Near-real-time weather radar for Mexico: where it is raining now, with the last 2 hours animated and a 30-minute nowcast. RainViewer data, no account, no ads.',
  },
  {
    id: 'satellite',
    slug: 'satelite',
    titleEs: 'Satélite GOES en vivo',
    titleEn: 'Live GOES satellite',
    descEs:
      'Imagen satelital GeoColor e infrarroja de GOES-East sobre México cada 10 minutos, con 24 horas de historia y hasta 10 días para ver cómo evolucionó una tormenta. NASA GIBS.',
    descEn:
      'GOES-East GeoColor and infrared imagery over Mexico every 10 minutes, with 24 hours of history and up to 10 days to replay a storm. NASA GIBS.',
  },
  {
    id: 'temperature',
    slug: 'temperatura',
    titleEs: 'Mapa de temperatura',
    titleEn: 'Temperature map',
    descEs:
      'Temperatura del aire, sensación térmica y bulbo húmedo en todo México hora por hora, desde ayer y hasta 10 días adelante, con tu ciudad al tocar el mapa. Open-Meteo.',
    descEn:
      'Air temperature, feels-like and wet-bulb across Mexico hour by hour, from yesterday to 10 days ahead, with your city one tap away. Open-Meteo.',
  },
  {
    id: 'humidity',
    slug: 'humedad',
    titleEs: 'Mapa de humedad',
    titleEn: 'Humidity map',
    descEs:
      'Humedad relativa y punto de rocío pronosticados para México hora por hora, para saber si el calor será pesado o seco. Open-Meteo.',
    descEn:
      'Forecast relative humidity and dew point for Mexico hour by hour, to tell muggy heat from dry heat. Open-Meteo.',
  },
  {
    id: 'pressure',
    slug: 'presion',
    titleEs: 'Mapa de presión e isobaras',
    titleEn: 'Pressure and isobars map',
    descEs:
      'Presión atmosférica a nivel del mar con isobaras etiquetadas cada 4 hPa: frentes, bajas y altas sobre México, hora por hora. Open-Meteo.',
    descEn:
      'Sea-level pressure with isobars labelled every 4 hPa: fronts, lows and highs over Mexico, hour by hour. Open-Meteo.',
  },
  {
    id: 'precipitation',
    slug: 'precipitacion',
    titleEs: 'Mapa de precipitación pronosticada',
    titleEn: 'Forecast precipitation map',
    descEs:
      'Lluvia y nieve pronosticadas en mm/h y probabilidad de precipitación para México, hora por hora hasta 10 días. Complementa al radar cuando quieres saber qué viene. Open-Meteo.',
    descEn:
      'Forecast rain and snow in mm/h and precipitation probability for Mexico, hourly up to 10 days — the radar tells you what is falling, this tells you what is coming. Open-Meteo.',
  },
  {
    id: 'wind',
    slug: 'viento',
    titleEs: 'Mapa de viento animado',
    titleEn: 'Animated wind map',
    descEs:
      'Partículas de viento a 10 m sobre México con velocidad y rachas, hora por hora hasta 10 días, más los sistemas tropicales activos con su cono. Open-Meteo y NHC.',
    descEn:
      '10 m wind particles over Mexico with speed and gusts, hourly up to 10 days, plus active tropical systems with their forecast cone. Open-Meteo and NHC.',
  },
  {
    id: 'sunlight',
    slug: 'sol',
    titleEs: 'Mapa del sol y la noche',
    titleEn: 'Sun and night map',
    descEs:
      'Terminador día/noche y posición del sol sobre México en cualquier momento del timeline, con luces nocturnas VIIRS como superposición.',
    descEn:
      'Day/night terminator and sun position over Mexico at any timeline instant, with VIIRS night lights as an overlay.',
  },
];

export function layerPageFor(id: string): LayerPage | undefined {
  return LAYER_PAGES.find((p) => p.id === id);
}

export function layerPageBySlug(slug: string): LayerPage | undefined {
  return LAYER_PAGES.find((p) => p.slug === slug);
}

/** Every weather layer (all but the base map) has a page. */
export function layerPagesCoverRegistry(): boolean {
  const ids = new Set(LAYER_PAGES.map((p) => p.id));
  return LAYERS.every((l) => l.id === 'base' || ids.has(l.id));
}
