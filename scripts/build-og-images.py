#!/usr/bin/env python3
"""Generate per-page 1200×630 Open Graph PNGs for every entry in the
TOP_CITIES, TOP_BEACHES, MX_STATES and MX_VOLCANOES lists.

Output:
  public/og/clima/<slug>.png
  public/og/playa/<slug>.png
  public/og/estado/<slug>.png
  public/og/volcan/<slug>.png

These are picked up by og:image / twitter:image meta tags in each
landing page, so social previews show the place name in big type
instead of the generic site fallback. Pure static — generated once
by the og-images.yml workflow (or manually); files committed to the
repo.

Each PNG is a flat gradient + the place name + a small subtitle.
Theme color varies per page type (city=blue, beach=cyan,
state=red, volcano=orange) so the previews are visually distinct.
"""
from __future__ import annotations

import os
import re
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:  # pragma: no cover
    print('Pillow not installed. pip install Pillow', file=sys.stderr)
    sys.exit(2)

WIDTH, HEIGHT = 1200, 630
MARGIN = 60

# DejaVu ships with Ubuntu and macOS; the workflow runs on
# ubuntu-latest so this path is reliable. Fall through to a few common
# alternates for local runs.
FONT_CANDIDATES = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/System/Library/Fonts/SFNS.ttf',
    '/Library/Fonts/Arial Bold.ttf',
]


def find_font(size):
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            return ImageFont.truetype(p, size=size)
    return ImageFont.load_default()


# ---- TS list mirrors -------------------------------------------------
# Kept in sync with src/lib/top-cities.ts, top-beaches.ts, mx-states.ts,
# mx-volcanoes.ts. Parity tests in src/lib/*.test.ts catch drift.

CITIES = [
    ('cdmx', 'Ciudad de México', 'CDMX'),
    ('guadalajara', 'Guadalajara', 'Jalisco'),
    ('monterrey', 'Monterrey', 'Nuevo León'),
    ('puebla', 'Puebla', 'Puebla'),
    ('tijuana', 'Tijuana', 'Baja California'),
    ('leon', 'León', 'Guanajuato'),
    ('toluca', 'Toluca', 'Estado de México'),
    ('merida', 'Mérida', 'Yucatán'),
    ('queretaro', 'Querétaro', 'Querétaro'),
    ('chihuahua', 'Chihuahua', 'Chihuahua'),
    ('hermosillo', 'Hermosillo', 'Sonora'),
    ('veracruz', 'Veracruz', 'Veracruz'),
    ('cancun', 'Cancún', 'Quintana Roo'),
    ('acapulco', 'Acapulco', 'Guerrero'),
    ('oaxaca', 'Oaxaca', 'Oaxaca'),
    ('morelia', 'Morelia', 'Michoacán'),
    ('aguascalientes', 'Aguascalientes', 'Aguascalientes'),
    ('saltillo', 'Saltillo', 'Coahuila'),
    ('durango', 'Durango', 'Durango'),
    ('zacatecas', 'Zacatecas', 'Zacatecas'),
    ('culiacan', 'Culiacán', 'Sinaloa'),
    ('mazatlan', 'Mazatlán', 'Sinaloa'),
    ('tampico', 'Tampico', 'Tamaulipas'),
    ('villahermosa', 'Villahermosa', 'Tabasco'),
    ('tuxtla-gutierrez', 'Tuxtla Gutiérrez', 'Chiapas'),
    ('pachuca', 'Pachuca', 'Hidalgo'),
    ('cuernavaca', 'Cuernavaca', 'Morelos'),
    ('la-paz', 'La Paz', 'Baja California Sur'),
    ('san-luis-potosi', 'San Luis Potosí', 'San Luis Potosí'),
    ('ciudad-juarez', 'Ciudad Juárez', 'Chihuahua'),
]

BEACHES = [
    ('cancun', 'Cancún', 'Quintana Roo'),
    ('playa-del-carmen', 'Playa del Carmen', 'Quintana Roo'),
    ('cozumel', 'Cozumel', 'Quintana Roo'),
    ('veracruz', 'Veracruz', 'Veracruz'),
    ('tampico', 'Tampico', 'Tamaulipas'),
    ('acapulco', 'Acapulco', 'Guerrero'),
    ('puerto-vallarta', 'Puerto Vallarta', 'Jalisco'),
    ('mazatlan', 'Mazatlán', 'Sinaloa'),
    ('los-cabos', 'Los Cabos', 'Baja California Sur'),
    ('la-paz', 'La Paz', 'Baja California Sur'),
    ('huatulco', 'Huatulco', 'Oaxaca'),
    ('puerto-escondido', 'Puerto Escondido', 'Oaxaca'),
    ('manzanillo', 'Manzanillo', 'Colima'),
    ('ensenada', 'Ensenada', 'Baja California'),
]

STATES = [
    'aguascalientes', 'baja-california', 'baja-california-sur', 'campeche',
    'chiapas', 'chihuahua', 'cdmx', 'coahuila', 'colima', 'durango',
    'estado-de-mexico', 'guanajuato', 'guerrero', 'hidalgo', 'jalisco',
    'michoacan', 'morelos', 'nayarit', 'nuevo-leon', 'oaxaca', 'puebla',
    'queretaro', 'quintana-roo', 'san-luis-potosi', 'sinaloa', 'sonora',
    'tabasco', 'tamaulipas', 'tlaxcala', 'veracruz', 'yucatan', 'zacatecas',
]

# State slug → display name. Built from MX_STATES.
STATE_NAMES = {
    'aguascalientes': 'Aguascalientes',
    'baja-california': 'Baja California',
    'baja-california-sur': 'Baja California Sur',
    'campeche': 'Campeche',
    'chiapas': 'Chiapas',
    'chihuahua': 'Chihuahua',
    'cdmx': 'Ciudad de México',
    'coahuila': 'Coahuila',
    'colima': 'Colima',
    'durango': 'Durango',
    'estado-de-mexico': 'Estado de México',
    'guanajuato': 'Guanajuato',
    'guerrero': 'Guerrero',
    'hidalgo': 'Hidalgo',
    'jalisco': 'Jalisco',
    'michoacan': 'Michoacán',
    'morelos': 'Morelos',
    'nayarit': 'Nayarit',
    'nuevo-leon': 'Nuevo León',
    'oaxaca': 'Oaxaca',
    'puebla': 'Puebla',
    'queretaro': 'Querétaro',
    'quintana-roo': 'Quintana Roo',
    'san-luis-potosi': 'San Luis Potosí',
    'sinaloa': 'Sinaloa',
    'sonora': 'Sonora',
    'tabasco': 'Tabasco',
    'tamaulipas': 'Tamaulipas',
    'tlaxcala': 'Tlaxcala',
    'veracruz': 'Veracruz',
    'yucatan': 'Yucatán',
    'zacatecas': 'Zacatecas',
}

VOLCANOES = [
    ('popocatepetl', 'Popocatépetl'),
    ('volcan-de-colima', 'Volcán de Colima'),
    ('el-chichon', 'El Chichón'),
    ('tacana', 'Tacaná'),
    ('pico-de-orizaba', 'Pico de Orizaba'),
    ('iztaccihuatl', 'Iztaccíhuatl'),
    ('nevado-de-toluca', 'Nevado de Toluca'),
]

# ---- Render ---------------------------------------------------------

THEMES = {
    'clima':  ((37, 99, 235),  (29, 78, 216),  'PRONÓSTICO DEL TIEMPO'),
    'playa':  ((14, 165, 233), (8, 145, 178),  'CLIMA Y OLEAJE'),
    'estado': ((220, 38, 38),  (153, 27, 27),  'PRONÓSTICO POR ESTADO'),
    'volcan': ((234, 88, 12),  (194, 65, 12),  'VOLCANES DE MÉXICO'),
}


def make_image(out_path, theme_key, title, subtitle=''):
    color_top, color_bot, kicker = THEMES[theme_key]

    img = Image.new('RGB', (WIDTH, HEIGHT), color_top)
    draw = ImageDraw.Draw(img)

    # Vertical gradient — cheap row-by-row fill.
    for y in range(HEIGHT):
        t = y / (HEIGHT - 1)
        r = int(color_top[0] + (color_bot[0] - color_top[0]) * t)
        g = int(color_top[1] + (color_bot[1] - color_top[1]) * t)
        b = int(color_top[2] + (color_bot[2] - color_top[2]) * t)
        draw.line([(0, y), (WIDTH, y)], fill=(r, g, b))

    # Subtle accent strip on the left edge for visual interest.
    draw.rectangle([(0, 0), (16, HEIGHT)], fill=(255, 255, 255, 255))

    kicker_font = find_font(28)
    title_font = find_font(96)
    subtitle_font = find_font(40)
    brand_font = find_font(26)

    # Kicker (top, slightly transparent white via solid light color).
    draw.text((MARGIN + 12, MARGIN + 10), kicker, fill=(220, 230, 245), font=kicker_font)

    # Title — wrap to two lines if it's long. We measure with the font.
    def text_width(s, font):
        bbox = draw.textbbox((0, 0), s, font=font)
        return bbox[2] - bbox[0]

    max_w = WIDTH - 2 * MARGIN - 24
    lines = [title]
    if text_width(title, title_font) > max_w and ' ' in title:
        # Try splitting at the last space that keeps the first line under width.
        words = title.split(' ')
        for i in range(len(words) - 1, 0, -1):
            first = ' '.join(words[:i])
            rest = ' '.join(words[i:])
            if text_width(first, title_font) <= max_w:
                lines = [first, rest]
                break

    # Vertically center the title block in the middle 2/3 of the canvas.
    line_h = 110
    block_h = line_h * len(lines)
    y_start = (HEIGHT - block_h) // 2 - 20
    for i, line in enumerate(lines):
        draw.text(
            (MARGIN + 12, y_start + i * line_h),
            line,
            fill=(255, 255, 255),
            font=title_font,
        )

    if subtitle:
        draw.text(
            (MARGIN + 12, y_start + block_h + 18),
            subtitle,
            fill=(220, 230, 245),
            font=subtitle_font,
        )

    # Brand footer.
    draw.text(
        (MARGIN + 12, HEIGHT - MARGIN - 18),
        'Clima México · artemiop.com/mexico-weather',
        fill=(255, 255, 255),
        font=brand_font,
    )

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    img.save(out_path, 'PNG', optimize=True)


def main():
    out_root = 'public/og'
    count = 0

    for slug, name, admin in CITIES:
        make_image(f'{out_root}/clima/{slug}.png', 'clima', name, admin)
        count += 1
    for slug, name, admin in BEACHES:
        make_image(f'{out_root}/playa/{slug}.png', 'playa', name, admin)
        count += 1
    for slug in STATES:
        name = STATE_NAMES[slug]
        make_image(f'{out_root}/estado/{slug}.png', 'estado', name, '')
        count += 1
    for slug, name in VOLCANOES:
        make_image(f'{out_root}/volcan/{slug}.png', 'volcan', name, '')
        count += 1

    print(f'wrote {count} OG images under {out_root}/', file=sys.stderr)


if __name__ == '__main__':
    main()
