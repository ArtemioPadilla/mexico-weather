import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTION_GIBS,
  GIBS_LAYERS,
  gibsRoundedTime,
  gibsTileUrl,
} from './nasa-gibs';

describe('gibsTileUrl', () => {
  it('builds a tile URL for GOES IR with default time', () => {
    const url = gibsTileUrl(GIBS_LAYERS.goesIR);
    expect(url).toBe(
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/' +
        'GOES-East_ABI_Band13_Clean_Infrared/default/default/' +
        'GoogleMapsCompatible_Level6/{z}/{y}/{x}.png',
    );
  });

  it('includes the requested time', () => {
    const url = gibsTileUrl(GIBS_LAYERS.viirsNightLights, '2026-05-24T00:00:00Z');
    expect(url).toContain('2026-05-24T00:00:00Z');
    expect(url).toContain('VIIRS_SNPP_DayNightBand_ENCC');
    expect(url).toContain('Level8');
    expect(url.endsWith('.png')).toBe(true);
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
      '2026-05-24T06:00:00Z',
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
    expect(GIBS_LAYERS.viirsNightLights.id).toBe('VIIRS_SNPP_DayNightBand_ENCC');
    expect(GIBS_LAYERS.modisTrueColor.id).toBe(
      'MODIS_Terra_CorrectedReflectance_TrueColor',
    );
  });
});

describe('ATTRIBUTION_GIBS', () => {
  it('credits NASA EOSDIS', () => {
    expect(ATTRIBUTION_GIBS).toContain('NASA');
  });
});
