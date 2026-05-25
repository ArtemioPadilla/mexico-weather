#!/usr/bin/env python3
"""Build a static dictionary of MX cities for the /pregunta NL router.

Before: ask-router.ts ships KNOWN_CITIES (30 cities) and falls back to
the live Open-Meteo geocoding API on miss. That's a per-query live
fetch for any non-trivial place name (a state capital, a tourist
destination, a smaller city).

After: the GitHub Action queries Open-Meteo's geocoder ONCE PER WEEK
for a curated ~250-city seed list, and ships the result as a static
JSON. /pregunta becomes a zero-network lookup for the vast majority
of MX place queries.

Output: public/data/mx-cities.json — shape:

  {
    "metadata": {...},
    "cities": [
      { "key": "cdmx", "name": "Ciudad de México", "admin1": "CDMX",
        "lat": 19.43, "lng": -99.13, "population": 9209944 },
      ...
    ]
  }
"""
from __future__ import annotations

import json
import os
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from typing import Optional

# Curated seed list — top ~250 MX cities + state capitals + notable
# tourist destinations. The geocoder lookup confirms each one's
# canonical name, coords, admin1, and population. Duplicates after
# normalization are deduped server-side via the key field.
SEED_CITIES: list[str] = [
    # 32 state capitals
    'Aguascalientes', 'Mexicali', 'La Paz', 'Campeche',
    'Chilpancingo', 'Saltillo', 'Colima', 'Tuxtla Gutiérrez',
    'Chihuahua', 'Ciudad de México', 'Durango', 'Guanajuato',
    'Pachuca', 'Guadalajara', 'Toluca', 'Morelia',
    'Cuernavaca', 'Tepic', 'Monterrey', 'Oaxaca',
    'Puebla', 'Querétaro', 'Chetumal', 'San Luis Potosí',
    'Culiacán', 'Hermosillo', 'Villahermosa', 'Ciudad Victoria',
    'Tlaxcala', 'Xalapa', 'Mérida', 'Zacatecas',
    # major metros + populous municipalities
    'Tijuana', 'León', 'Juárez', 'Zapopan', 'Ecatepec',
    'Naucalpan', 'Tlalnepantla', 'Acapulco', 'Cancún',
    'Mazatlán', 'Veracruz', 'Tampico', 'Reynosa', 'Matamoros',
    'Nuevo Laredo', 'Torreón', 'Gómez Palacio', 'Ciudad Obregón',
    'Coatzacoalcos', 'Minatitlán', 'Poza Rica', 'Orizaba',
    'Tehuacán', 'Tepic', 'Uruapan', 'Zamora', 'Salamanca',
    'Irapuato', 'Celaya', 'San Juan del Río', 'Tlaxcala',
    'Apizaco', 'Tlaxiaco', 'Salina Cruz', 'Tehuantepec',
    'Cárdenas', 'Comalcalco', 'Tenosique', 'Frontera',
    # Quintana Roo + Yucatán beach resorts
    'Playa del Carmen', 'Cozumel', 'Tulum', 'Bacalar',
    'Isla Mujeres', 'Holbox', 'Akumal', 'Puerto Morelos',
    'Valladolid', 'Progreso', 'Izamal',
    # Pacific resort + secondary cities
    'Puerto Vallarta', 'Puerto Escondido', 'Huatulco', 'Manzanillo',
    'Ixtapa', 'Zihuatanejo', 'Cabo San Lucas', 'San José del Cabo',
    'Loreto', 'Ensenada', 'Rosarito', 'Tecate', 'San Felipe',
    # Northern interior + border
    'Piedras Negras', 'Monclova', 'Acuña', 'Nogales',
    'Cananea', 'Caborca', 'San Luis Río Colorado', 'Navojoa',
    'Los Mochis', 'Guasave', 'Guamúchil', 'Ahome',
    'Parral', 'Delicias', 'Cuauhtémoc', 'Madera', 'Camargo',
    'Nueva Casas Grandes', 'Ojinaga',
    # Bajío + Centro
    'San Miguel de Allende', 'Dolores Hidalgo', 'Silao',
    'Acámbaro', 'Valle de Santiago', 'Pénjamo', 'Cortazar',
    'Apaseo el Grande', 'Apaseo el Alto',
    'San Juan del Río', 'Tequisquiapan', 'Cadereyta',
    'Jerez', 'Fresnillo', 'Sombrerete', 'Guadalupe',
    'Aguascalientes', 'Jesús María', 'San Francisco de los Romo',
    'Calvillo', 'Pabellón de Arteaga', 'Tepatitlán',
    'Ocotlán', 'La Barca', 'Sayula',
    'Ameca', 'Autlán', 'Cihuatlán', 'Tomatlán', 'Tequila',
    'Tala', 'Atotonilco el Alto', 'Lagos de Moreno',
    # Costa del Pacífico Sur + Chiapas
    'Tonalá', 'Tapachula', 'San Cristóbal de las Casas',
    'Comitán', 'Palenque', 'Ocosingo', 'Pichucalco',
    'Pijijiapan', 'Arriaga', 'Cintalapa', 'Berriozábal',
    'Chiapa de Corzo', 'Villaflores',
    # Oaxaca region
    'Salina Cruz', 'Juchitán', 'Tlacolula', 'Mitla',
    'Pochutla', 'Pinotepa Nacional', 'Huajuapan', 'Putla',
    'Tlaxiaco', 'Nochixtlán', 'Ixtepec',
    # Yucatán + Quintana Roo interior
    'Tizimín', 'Motul', 'Umán', 'Kanasín', 'Hunucmá',
    'Tekax', 'Maxcanú', 'Ticul', 'Oxkutzcab',
    'Felipe Carrillo Puerto', 'José María Morelos',
    # Tabasco + Campeche
    'Huimanguillo', 'Macuspana', 'Paraíso', 'Jalpa de Méndez',
    'Cunduacán', 'Nacajuca', 'Centro', 'Teapa',
    'Champotón', 'Ciudad del Carmen', 'Escárcega',
    'Hopelchén', 'Calkiní',
    # Hidalgo + México (state)
    'Tula de Allende', 'Tulancingo', 'Huejutla', 'Mineral de la Reforma',
    'Texcoco', 'Toluca', 'Metepec', 'Lerma', 'Ixtapan de la Sal',
    'Tenancingo', 'Atlacomulco', 'Ixtlahuaca', 'Tejupilco',
    'Valle de Bravo', 'Chalco', 'Chimalhuacán', 'Nezahualcóyotl',
    'Cuautitlán Izcalli', 'Atizapán', 'Ixtapaluca',
    'Tultitlán', 'Coacalco', 'La Paz', 'Tecámac',
    # Morelos + Tlaxcala + Puebla
    'Jiutepec', 'Temixco', 'Yautepec', 'Cuautla', 'Tepoztlán',
    'Apizaco', 'Huamantla', 'Calpulalpan', 'Zacatelco',
    'Chiautempan', 'Cholula', 'San Pedro Cholula', 'Atlixco',
    'Izúcar de Matamoros', 'Tehuacán', 'Huauchinango',
    'San Martín Texmelucan', 'Tepeaca', 'Cuetzalan',
    # Tamaulipas + San Luis Potosí
    'Altamira', 'Madero', 'Río Bravo', 'Valle Hermoso',
    'San Fernando', 'Soto la Marina', 'Mante',
    'Ciudad Valles', 'Matehuala', 'Río Verde', 'Ebano',
    'Tamazunchale',
    # Veracruz secondary
    'Cardel', 'Tuxpan', 'Pánuco', 'Cosoleacaque',
    'Acayucan', 'San Andrés Tuxtla', 'Catemaco', 'Alvarado',
    'Boca del Río', 'Banderilla', 'Coatepec',
    'Naranjos', 'Cerro Azul', 'Tantoyuca', 'Papantla',
    'Martínez de la Torre', 'Misantla',
    # Guerrero + Michoacán + Colima
    'Iguala', 'Taxco', 'Tlapa', 'Atoyac', 'Coyuca',
    'San Marcos', 'Marquelia',
    'Apatzingán', 'Lázaro Cárdenas', 'Pátzcuaro',
    'Tacámbaro', 'Sahuayo', 'Jiquilpan', 'Jacona',
    'Tecomán', 'Tecomán', 'Villa de Álvarez', 'Armería',
    # Sinaloa + Nayarit + Jalisco
    'Escuinapa', 'Rosario', 'El Fuerte', 'Costa Rica',
    'San Blas', 'Compostela', 'Bahía de Banderas',
    'Tepic', 'Ixtlán del Río', 'Jala',
    'El Salto', 'Tonalá', 'Tlajomulco', 'Tlaquepaque',
]

GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search'


def normalize_key(name: str) -> str:
    """Lowercase, strip diacritics, replace spaces with -."""
    n = (
        unicodedata.normalize('NFD', name)
        .encode('ascii', 'ignore')
        .decode('ascii')
    )
    return ''.join(
        c if c.isalnum() else '-' for c in n.lower()
    ).strip('-')


def geocode_one(name: str) -> Optional[dict]:
    params = urllib.parse.urlencode({
        'name': name,
        'count': '10',
        'language': 'es',
        'country': 'MX',
    })
    url = f'{GEOCODE_URL}?{params}'
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:  # noqa: S310
                data = json.loads(r.read().decode('utf-8'))
            results = data.get('results') or []
            # Pick the most populous match (the geocoder sometimes returns
            # tiny localities with the same name).
            results = [
                x for x in results if x.get('country_code') == 'MX'
            ]
            if not results:
                return None
            results.sort(key=lambda x: x.get('population') or 0, reverse=True)
            return results[0]
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                print(f'  ! {name}: {e}', file=sys.stderr)
                return None
            time.sleep(1 + attempt)
    return None


def main() -> None:
    seen: set[str] = set()
    cities: list[dict] = []
    for name in SEED_CITIES:
        key_pre = normalize_key(name)
        if key_pre in seen:
            continue
        seen.add(key_pre)
        hit = geocode_one(name)
        time.sleep(0.1)  # be nice to the API
        if not hit:
            continue
        c_name = hit.get('name') or name
        key = normalize_key(c_name)
        cities.append({
            'key': key,
            'name': c_name,
            'admin1': hit.get('admin1') or '',
            'admin1_short': hit.get('admin1_code') or '',
            'lat': round(float(hit.get('latitude') or 0), 4),
            'lng': round(float(hit.get('longitude') or 0), 4),
            'population': int(hit.get('population') or 0),
            'tz': hit.get('timezone') or 'America/Mexico_City',
        })

    # Sort by population (largest first) so the static dict's "first
    # hit wins" lookup ordering favors metros over hamlets.
    cities.sort(key=lambda c: c['population'], reverse=True)

    doc = {
        'metadata': {
            'source': 'Open-Meteo Geocoding API',
            'count': len(cities),
            'license': 'CC-BY 4.0 (Open-Meteo) / OSM contributors',
        },
        'cities': cities,
    }
    out_path = 'public/data/mx-cities.json'
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(doc, f, separators=(',', ':'), ensure_ascii=False)
    print(f'wrote {len(cities)} cities to {out_path}', file=sys.stderr)


if __name__ == '__main__':
    main()
