import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTION_GIBS,
  GIBS_HISTORY_DAYS,
  GIBS_LAG_MS,
  GIBS_LAYERS,
  gibsLatestTime,
  gibsRoundedTime,
  gibsTileUrl,
  gibsTimeParam,
} from './nasa-gibs';

describe('gibsTileUrl', () => {
  it('builds a tile URL for GOES IR with default time', () => {
    const url = gibsTileUrl(GIBS_LAYERS.goesIR);
    expect(url).toBe(
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/' +
        'GOES-East_ABI_Band13_Clean_Infrared/default/default/' +
        'GoogleMapsCompatible_Level6/{z}/{y}/{x}.png'
    );
  });

  it('includes the requested time', () => {
    const url = gibsTileUrl(GIBS_LAYERS.viirsNightLights, '2026-05-24');
    expect(url).toContain('/2026-05-24/');
    expect(url).toContain('VIIRS_NOAA20_DayNightBand_AtSensor_M15');
    expect(url).toContain('Level8');
    expect(url.endsWith('.png')).toBe(true);
  });

  it('GeoColor uses the Level7 matrix set GIBS publishes for it (Story 16.1)', () => {
    // Level6 returns 400 "TILEMATRIXSET is invalid for LAYER" since GIBS
    // re-published GeoColor at Level7 — this is what blanked the
    // satellite layer in production.
    expect(gibsTileUrl(GIBS_LAYERS.goesGeocolor, '2026-09-24T06:40:00Z')).toBe(
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/' +
        'GOES-East_ABI_GeoColor/default/2026-09-24T06:40:00Z/' +
        'GoogleMapsCompatible_Level7/{z}/{y}/{x}.png'
    );
  });

  it('uses jpg extension for MODIS true color', () => {
    const url = gibsTileUrl(GIBS_LAYERS.modisTrueColor);
    expect(url).toContain('.jpg');
  });
});

describe('gibsRoundedTime', () => {
  it('rounds down to the nearest 10-minute boundary', () => {
    const d = new Date('2026-05-24T06:17:42Z');
    expect(gibsRoundedTime(d)).toBe('2026-05-24T06:10:00Z');
  });

  it('handles the top of the hour', () => {
    expect(gibsRoundedTime(new Date('2026-05-24T06:00:00Z'))).toBe(
      '2026-05-24T06:00:00Z'
    );
  });

  it('handles a fresh Date by default', () => {
    const result = gibsRoundedTime();
    // Should always end in :00Z (rounded to 10-minute boundary).
    expect(/T\d{2}:[0-5]0:00Z$/.test(result)).toBe(true);
  });
});

describe('GIBS_LAYERS', () => {
  it('exposes goesIR, goesGeocolor, viirsNightLights, modisTrueColor', () => {
    expect(GIBS_LAYERS.goesIR.id).toBe('GOES-East_ABI_Band13_Clean_Infrared');
    expect(GIBS_LAYERS.goesGeocolor.id).toBe('GOES-East_ABI_GeoColor');
    expect(GIBS_LAYERS.viirsNightLights.id).toBe(
      'VIIRS_NOAA20_DayNightBand_AtSensor_M15'
    );
    expect(GIBS_LAYERS.modisTrueColor.id).toBe(
      'MODIS_Terra_CorrectedReflectance_TrueColor'
    );
  });
});

describe('gibsTimeParam / gibsLatestTime (Story 16.1)', () => {
  it('10-minute ISO for GOES, bare date for daily products', () => {
    const t = Date.parse('2026-09-24T06:47:00Z');
    expect(gibsTimeParam(GIBS_LAYERS.goesGeocolor, t)).toBe(
      '2026-09-24T06:40:00Z'
    );
    expect(gibsTimeParam(GIBS_LAYERS.modisTrueColor, t)).toBe('2026-09-24');
    expect(gibsTimeParam(GIBS_LAYERS.viirsNightLights, t)).toBe('2026-09-24');
  });
  it('latest time backs off by the publishing lag', () => {
    expect(gibsLatestTime(new Date('2026-09-27T06:17:00Z'))).toBe(
      '2026-09-27T05:40:00Z'
    );
  });
  it('history + lag constants are the measured values', () => {
    expect(GIBS_HISTORY_DAYS).toBe(45);
    expect(GIBS_LAG_MS).toBe(30 * 60 * 1000);
  });
});

describe('ATTRIBUTION_GIBS', () => {
  it('credits NASA EOSDIS', () => {
    expect(ATTRIBUTION_GIBS).toContain('NASA');
  });
});
