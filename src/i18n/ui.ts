export interface UiStrings {
  search_placeholder: string;
  use_my_location: string;
  searching: string;
  no_results: string;
  geo_outside_mx: string;
  geo_denied: string;
  geo_timeout: string;
  quick_peek: string;
  full_forecast: string;
  back_home: string;
  current: string;
  today: string;
  feels_like: string;
  hourly_48h: string;
  ten_days: string;
  sixteen_days: string;
  more_days: string;
  fewer_days: string;
  days_caveat: string;
  models_diverge: string;
  detail: string;
  wind: string;
  uv_index: string;
  sky_air: string;
  humidity: string;
  pressure: string;
  visibility: string;
  sunrise: string;
  sunset: string;
  cloud_cover: string;
  gusts: string;
  pick_location: string;
  loading: string;
  load_error: string;
  map_title: string;
  map_nav: string;
  map_teaser_heading: string;
  map_teaser_cta: string;
  map_layer_base: string;
  map_search_placeholder: string;
  /** Badge on a search suggestion with population ≥ 50 000 (Story 25.3). */
  map_search_city_badge: string;
  map_locate: string;
  map_popup_full_forecast: string;
  place_card_title: string;
  place_card_daily: string;
  place_card_hourly: string;
  place_card_close: string;
  place_card_today: string;
  place_card_tomorrow: string;
  place_card_error: string;
  map_layer_unavailable: string;
  map_layers: string;
  map_layer_radar: string;
  map_layer_satellite: string;
  timeline_label: string;
  timeline_play: string;
  timeline_pause: string;
  timeline_prev: string;
  timeline_next: string;
  timeline_now: string;
  timeline_extend: string;
  timeline_extending: string;
  timeline_extend_failed: string;
  timeline_jump: string;
  map_layer_temperature: string;
  map_layer_humidity: string;
  map_layer_pressure: string;
  map_layer_precipitation: string;
  map_layer_wind: string;
  legend_wind_calm: string;
  legend_wind_breeze: string;
  legend_wind_strong: string;
  legend_wind_gale: string;
  map_layer_sunlight: string;
  welcome_title: string;
  welcome_body: string;
  welcome_locate: string;
  welcome_dismiss: string;
  layer_page_link: string;
  confidence_loading: string;
  confidence_failed: string;
  confidence_between_models: string;
  layer_explainer_radar: string;
  layer_explainer_satellite: string;
  layer_explainer_temperature: string;
  layer_explainer_humidity: string;
  layer_explainer_pressure: string;
  layer_explainer_precipitation: string;
  layer_explainer_wind: string;
  layer_explainer_sunlight: string;
  map_opacity: string;
  /** Story 22.2 — short rail labels (icon + short label tiles). */
  map_layer_short_base: string;
  map_layer_short_radar: string;
  map_layer_short_satellite: string;
  map_layer_short_temperature: string;
  map_layer_short_humidity: string;
  map_layer_short_pressure: string;
  map_layer_short_precipitation: string;
  map_layer_short_wind: string;
  map_layer_short_sunlight: string;
  /** Story 22.2 — overlays tab of the layers panel. */
  map_overlays: string;
  map_overlays_filter: string;
  map_overlays_pinned: string;
  map_overlays_all: string;
  map_overlays_empty: string;
  /** Story 22.3 — the one "⋯ Herramientas" menu and its context pill. */
  map_tools: string;
  map_tools_tab_tools: string;
  map_tools_tab_settings: string;
  map_tools_tab_info: string;
  map_tools_measure: string;
  map_tools_compare: string;
  map_tool_active: string;
  map_tool_exit: string;
  map_tool_distance: string;
  map_tool_area: string;
  map_tool_crosshair: string;
  map_tool_compare: string;
  /** Story 22.5 — Controles trigger on /mapa and the `?` cheat-sheet. */
  map_controls_compact: string;
  /** Story 25.1 — the bottom sheet's drag handle and its three heights. */
  map_sheet_resize: string;
  map_sheet_peek: string;
  map_sheet_half: string;
  map_sheet_full: string;
  map_shortcuts: string;
  map_shortcuts_close: string;
  map_shortcuts_general: string;
  map_shortcuts_help: string;
  map_shortcuts_escape: string;
  map_shortcuts_zoom: string;
  map_shortcuts_pan: string;
  map_shortcuts_jump_date: string;
  map_shortcuts_enter: string;
  map_shortcuts_hint: string;
  /** Story 22.5 — overlay names (`map_overlay_<overlayDefs id>`), the
   *  single source for the overlay rows and the `?` cheat-sheet. */
  map_overlay_tropical: string;
  map_overlay_outlook: string;
  map_overlay_graticule: string;
  map_overlay_nightLights: string;
  map_overlay_nightLine: string;
  map_overlay_borders: string;
  map_overlay_fires: string;
  map_overlay_radarCoverage: string;
  map_overlay_precipMode: string;
  map_overlay_confidence: string;
  map_overlay_clouds: string;
  map_overlay_quakes: string;
  map_overlay_volcanoes: string;
  map_overlay_cityValues: string;
  map_overlay_windOverlay: string;
  map_overlay_aqi: string;
  map_overlay_smnStateTint: string;
  map_overlay_marine: string;
  map_overlay_webcams: string;
  map_overlay_lakes: string;
  map_overlay_histStorms: string;
  map_overlay_colorBlind: string;
  /** Story 25.3 — the rest of the map chrome: MapLibre controls, timeline
   *  steps, tools, snapshot, measure, toasts, sub-options, ⋯ → Ajustes and
   *  ⋯ → Info. `{n}`, `{z}`, `{name}`, `{coords}` are placeholders. */
  map_controls: string;
  map_zoom_in: string;
  map_zoom_out: string;
  map_reset_bearing: string;
  map_model: string;
  timeline_day_prev: string;
  timeline_day_next: string;
  timeline_hour_prev: string;
  timeline_hour_next: string;
  timeline_now_aria: string;
  map_tool_distance_aria: string;
  map_tool_area_aria: string;
  map_tool_crosshair_aria: string;
  map_tool_crosshair_title: string;
  map_snapshot_capture: string;
  map_snapshot_capture_aria: string;
  map_snapshot_24h: string;
  map_snapshot_24h_aria: string;
  map_snapshot_24h_title: string;
  map_snapshot_clear: string;
  map_snapshot_hide: string;
  map_snapshot_show: string;
  map_snapshot_hide_aria: string;
  map_snapshot_show_aria: string;
  map_measure_tap_next: string;
  map_measure_segment: string;
  map_measure_segments: string;
  map_measure_add_points: string;
  map_satellite_zoom_limit: string;
  map_marker: string;
  map_marker_named: string;
  map_place_location: string;
  map_tooltip_day: string;
  /** Letter for west longitudes in the coordinates (oeste / west). */
  map_west: string;
  map_tooltip_night: string;
  map_sub_temp_actual: string;
  map_sub_temp_aparente: string;
  map_sub_temp_bulbo: string;
  map_sub_humidity_relativa: string;
  map_sub_humidity_rocio: string;
  map_sub_precip_lluvia: string;
  map_sub_precip_nieve: string;
  map_sub_precip_probabilidad: string;
  map_sub_pressure_msl: string;
  map_sub_pressure_surface: string;
  map_sub_wind_velocidad: string;
  map_sub_wind_rachas: string;
  map_sub_satellite_geocolor: string;
  map_sub_satellite_ir: string;
  map_sub_satellite_truecolor: string;
  settings_tz: string;
  settings_tz_local: string;
  settings_hour: string;
  settings_loop: string;
  settings_loop_hint: string;
  settings_speed: string;
  settings_speed_slow: string;
  settings_speed_medium: string;
  settings_speed_fast: string;
  settings_style: string;
  settings_style_hint: string;
  settings_style_fast: string;
  settings_style_smooth: string;
  settings_label: string;
  settings_label_both: string;
  settings_label_clock: string;
  settings_label_relative: string;
  settings_temp: string;
  settings_wind: string;
  settings_pressure: string;
  settings_distance: string;
  settings_note: string;
  info_tagline: string;
  info_src_forecast: string;
  info_src_radar: string;
  info_src_satellite: string;
  info_src_cyclones: string;
  info_src_basemap: string;
  info_src_alerts: string;
  info_disclaimer: string;
  legend_light: string;
  legend_moderate: string;
  legend_heavy: string;
  legend_snow: string;
  last_updated: string;
  update_failed: string;
  load_retrying: string;
  rain_suffix: string;
  /** Stale-data banner — `{n}` is replaced with the age in hours. */
  stale_data: string;
  refresh: string;
  redirecting_to: string;
  in_one_s: string;
  thinking: string;
  ask_error: string;
  share: string;
  url_copied: string;
  fav_add: string;
  fav_remove: string;
  fav_cap: string;
  fav_most_visited: string;
}

export const ui: Record<'es' | 'en', UiStrings> = {
  es: {
    search_placeholder: 'Buscar cualquier ciudad o lugar…',
    use_my_location: 'Usar mi ubicación',
    searching: 'Buscando…',
    no_results: 'Sin resultados para',
    geo_outside_mx: 'Parece que estás fuera de México. Usa la búsqueda para otra ubicación.',
    geo_denied: 'Necesitamos tu permiso para mostrar el clima local. Usa la búsqueda.',
    geo_timeout: 'Tiempo agotado al buscar tu ubicación. Intenta de nuevo.',
    quick_peek: 'Ver vista rápida',
    full_forecast: 'Ver pronóstico completo',
    back_home: 'Volver al inicio',
    current: 'Ahora',
    today: 'Hoy',
    feels_like: 'sensación',
    hourly_48h: 'Por hora — hoy y mañana (48 h)',
    ten_days: '10 días',
    sixteen_days: '16 días',
    more_days: 'Ver 16 días',
    fewer_days: 'Ver 10 días',
    days_caveat: 'Los días 11 a 16 tienen menor confianza: úsalos como tendencia, no como pronóstico.',
    models_diverge: 'Los modelos difieren',
    detail: 'Detalle',
    wind: 'Viento',
    uv_index: 'Índice UV',
    sky_air: 'Cielo y aire',
    humidity: 'humedad',
    pressure: 'presión',
    visibility: 'visibilidad',
    sunrise: 'amanecer',
    sunset: 'atardecer',
    cloud_cover: 'nubes',
    gusts: 'ráfagas',
    pick_location: 'Busca una ubicación para ver su pronóstico.',
    loading: 'Cargando pronóstico…',
    load_error: 'Error al cargar. Se reintentará automáticamente.',
    map_title: 'Mapa del tiempo',
    map_nav: 'Mapa',
    map_teaser_heading: 'Mapa interactivo del tiempo',
    map_teaser_cta: 'Ver mapa interactivo',
    map_layer_base: 'Mapa base',
    map_search_placeholder: 'Buscar un lugar en el mapa…',
    map_search_city_badge: 'ciudad',
    map_locate: 'Mi ubicación',
    map_popup_full_forecast: 'Ver pronóstico completo',
    place_card_title: 'Punto seleccionado',
    place_card_daily: 'Diario',
    place_card_hourly: 'Horario',
    place_card_close: 'Cerrar',
    place_card_today: 'Hoy',
    place_card_tomorrow: 'Mañana',
    place_card_error: 'No se pudo cargar el pronóstico de este punto.',
    map_layer_unavailable: 'Capa no disponible',
    map_layers: 'Capas',
    map_layer_radar: 'Radar',
    map_layer_satellite: 'Satélite',
    timeline_label: 'Línea de tiempo',
    timeline_play: 'Reproducir',
    timeline_pause: 'Pausar',
    timeline_prev: 'Cuadro anterior',
    timeline_next: 'Cuadro siguiente',
    timeline_now: 'Ahora',
    timeline_extend: 'Ver 10 días',
    timeline_extending: 'Cargando 10 días…',
    timeline_extend_failed: 'No se pudo ampliar el pronóstico. Intenta de nuevo.',
    timeline_jump: 'Saltar a fecha',
    map_layer_temperature: 'Temperatura',
    map_layer_humidity: 'Humedad',
    map_layer_pressure: 'Presión',
    map_layer_precipitation: 'Precipitación',
    map_layer_wind: 'Viento',
    legend_wind_calm: 'Calmo',
    legend_wind_breeze: 'Brisa',
    legend_wind_strong: 'Fuerte',
    legend_wind_gale: 'Tormenta',
    map_layer_sunlight: 'Sol',
    welcome_title: 'Bienvenido a Clima México',
    welcome_body: '¿Centramos el mapa en tu ubicación? Solo se usa en tu navegador: sin cuenta, sin cookies, sin rastreo.',
    welcome_locate: 'Ubicarme',
    welcome_dismiss: 'Ahora no',
    layer_page_link: 'Página de esta capa',
    confidence_loading: 'Comparando modelos (ICON, GFS, ECMWF)…',
    confidence_failed: 'No se pudo comparar modelos para esta capa.',
    confidence_between_models: 'entre modelos',
    layer_explainer_radar: 'Radar muestra precipitación detectada (lluvia, nieve) en tiempo casi real desde RainViewer. Pulsa ▶ para animar las últimas 2 h y el nowcast.',
    layer_explainer_satellite: 'Satélite GOES-East (NASA GIBS) cada 10 min: GeoColor de día, infrarrojo de noche. El timeline recorre 24 h; "Ver 10 días" amplía. Activa N para luces nocturnas.',
    layer_explainer_temperature: 'Temperatura del aire a 2 m, gradiente continuo desde ayer hasta +10 días. Sub-opción Aparente incluye humedad y viento (sensación térmica); toca el mapa para ver tu pronóstico.',
    layer_explainer_humidity: 'Humedad relativa o punto de rocío a 2 m, según sub-opción. Mayor humedad = sensación más pesada al mismo calor.',
    layer_explainer_pressure: 'Presión atmosférica con isobaras etiquetadas cada 4 hPa. Nivel del mar (msl) es la reducción estándar en meteorología; Superficie respeta la altitud real.',
    layer_explainer_precipitation: 'Precipitación pronosticada en mm/h (lluvia + nieve), o Nieve en cm/h y Probabilidad en %. El radar dice qué cae ahora; esta capa, qué viene.',
    layer_explainer_wind: 'Velocidad y dirección del viento a 10 m. Activa Rachas para ver las máximas instantáneas en lugar del promedio.',
    layer_explainer_sunlight: 'Posición del Sol y zonas en sombra (terminador día/noche). Activa Límite nocturno (O) para ver sólo la línea sobre cualquier capa.',
    map_opacity: 'Opacidad',
    map_layer_short_base: 'Mapa',
    map_layer_short_radar: 'Radar',
    map_layer_short_satellite: 'Satélite',
    map_layer_short_temperature: 'Temp.',
    map_layer_short_humidity: 'Humedad',
    map_layer_short_pressure: 'Presión',
    map_layer_short_precipitation: 'Precip.',
    map_layer_short_wind: 'Viento',
    map_layer_short_sunlight: 'Sol',
    map_overlays: 'Superposiciones',
    map_overlays_filter: 'Filtrar superposiciones',
    map_overlays_pinned: 'Más usadas',
    map_overlays_all: 'Todas',
    map_overlays_empty: 'Sin coincidencias',
    map_tools: 'Herramientas',
    map_tools_tab_tools: 'Herramientas',
    map_tools_tab_settings: 'Ajustes',
    map_tools_tab_info: 'Info',
    map_tools_measure: 'Medir',
    map_tools_compare: 'Comparar',
    map_tool_active: 'Herramienta activa',
    map_tool_exit: 'Salir',
    map_tool_distance: 'Distancia',
    map_tool_area: 'Área',
    map_tool_crosshair: 'Mira',
    map_tool_compare: 'Comparación',
    map_controls_compact: 'Capas y controles',
    map_sheet_resize: 'Tamaño del panel',
    map_sheet_peek: 'reducido',
    map_sheet_half: 'medio',
    map_sheet_full: 'completo',
    map_shortcuts: 'Atajos de teclado',
    map_shortcuts_close: 'Cerrar',
    map_shortcuts_general: 'General',
    map_shortcuts_help: 'Mostrar u ocultar esta ayuda',
    map_shortcuts_escape: 'Cerrar un panel o salir de una herramienta',
    map_shortcuts_zoom: 'Acercar / alejar (mapa enfocado)',
    map_shortcuts_pan: 'Mover el mapa (mapa enfocado)',
    map_shortcuts_jump_date: 'Saltar a fecha (línea de tiempo enfocada)',
    map_shortcuts_enter: 'Intro',
    map_shortcuts_hint: 'Las letras funcionan cuando no estás escribiendo en un campo: la de una capa la activa, la de una superposición la enciende o apaga.',
    map_overlay_tropical: 'Sistemas tropicales',
    map_overlay_outlook: 'Posible desarrollo (2 / 7 d)',
    map_overlay_graticule: 'Retícula',
    map_overlay_nightLights: 'Luces nocturnas',
    map_overlay_nightLine: 'Límite nocturno',
    map_overlay_borders: 'Líneas fronteras',
    map_overlay_fires: 'Incendios activos',
    map_overlay_radarCoverage: 'Cobertura de radar',
    map_overlay_precipMode: 'Modo precipitación (satélite + nubes + radar)',
    map_overlay_confidence: 'Incertidumbre (desacuerdo entre modelos)',
    map_overlay_clouds: 'Nubes',
    map_overlay_quakes: 'Sismos (USGS)',
    map_overlay_volcanoes: 'Volcanes activos',
    map_overlay_cityValues: 'Valores de etiquetas',
    map_overlay_windOverlay: 'Animación de viento',
    map_overlay_aqi: 'Calidad del aire (PM2.5)',
    map_overlay_smnStateTint: 'Alertas SMN por estado',
    map_overlay_marine: 'Playas (oleaje + SST)',
    map_overlay_webcams: 'Cámaras en vivo',
    map_overlay_lakes: 'Lagos y presas',
    map_overlay_histStorms: 'Huracanes notables MX',
    map_overlay_colorBlind: 'Paleta accesible',
    map_controls: 'Controles del mapa',
    map_zoom_in: 'Acercar',
    map_zoom_out: 'Alejar',
    map_reset_bearing: 'Restablecer orientación al norte',
    map_model: 'Modelo de pronóstico Open-Meteo',
    timeline_day_prev: 'Día anterior',
    timeline_day_next: 'Día siguiente',
    timeline_hour_prev: 'Hora anterior',
    timeline_hour_next: 'Hora siguiente',
    timeline_now_aria: 'Volver al frame actual',
    map_tool_distance_aria: 'Medir distancia',
    map_tool_area_aria: 'Medir área',
    map_tool_crosshair_aria: 'Modo mira: valor en el centro del mapa',
    map_tool_crosshair_title: 'Modo mira: valor de la capa en el centro del mapa',
    map_snapshot_capture: 'Capturar',
    map_snapshot_capture_aria: 'Capturar vista actual',
    map_snapshot_24h: 'Hace 24 h',
    map_snapshot_24h_aria: 'Comparar con hace 24 horas',
    map_snapshot_24h_title: 'Congela la vista actual y mueve el timeline 24 h atrás; alterna con Mostrar/Ocultar',
    map_snapshot_clear: 'Limpiar',
    map_snapshot_hide: 'Ocultar',
    map_snapshot_show: 'Mostrar',
    map_snapshot_hide_aria: 'Ocultar comparación',
    map_snapshot_show_aria: 'Mostrar comparación',
    map_measure_tap_next: 'Toca otro punto para medir',
    map_measure_segment: 'segmento',
    map_measure_segments: 'segmentos',
    map_measure_add_points: 'Añade {n} punto(s) más',
    map_satellite_zoom_limit: 'Satélite limitado a zoom z{z} (NASA GIBS). Acercando más solo aparece la mancha del basemap.',
    map_marker: 'Marcador en el mapa',
    map_marker_named: 'Marcador: {name}',
    map_place_location: 'Ubicación {coords}',
    map_tooltip_day: 'Día',
    map_west: 'O',
    map_tooltip_night: 'Noche',
    map_sub_temp_actual: 'Actual',
    map_sub_temp_aparente: 'Aparente',
    map_sub_temp_bulbo: 'Bulbo húmedo',
    map_sub_humidity_relativa: 'Relativa',
    map_sub_humidity_rocio: 'Punto de rocío',
    map_sub_precip_lluvia: 'Lluvia',
    map_sub_precip_nieve: 'Nieve',
    map_sub_precip_probabilidad: 'Probabilidad',
    map_sub_pressure_msl: 'Nivel del mar',
    map_sub_pressure_surface: 'Superficie',
    map_sub_wind_velocidad: 'Velocidad',
    map_sub_wind_rachas: 'Rachas',
    map_sub_satellite_geocolor: 'GeoColor',
    map_sub_satellite_ir: 'Infrarrojo',
    map_sub_satellite_truecolor: 'Color real',
    settings_tz: 'Zona horaria',
    settings_tz_local: 'Local',
    settings_hour: 'Formato de hora',
    settings_loop: 'Loop de animación',
    settings_loop_hint: 'Frames dentro de ±N h de ahora',
    settings_speed: 'Velocidad',
    settings_speed_slow: 'Lenta',
    settings_speed_medium: 'Media',
    settings_speed_fast: 'Rápida',
    settings_style: 'Estilo',
    settings_style_hint: 'Suave funde los frames de radar y satélite',
    settings_style_fast: 'Rápido',
    settings_style_smooth: 'Suave',
    settings_label: 'Etiqueta del tiempo',
    settings_label_both: 'Ambas',
    settings_label_clock: 'Reloj',
    settings_label_relative: 'Relativa',
    settings_temp: 'Temperatura',
    settings_wind: 'Viento',
    settings_pressure: 'Presión',
    settings_distance: 'Distancia',
    settings_note: 'Aplica al timeline, leyenda, tooltip, tarjeta y /forecast en vivo. Persistido localmente, sin cuenta.',
    info_tagline: '— mapa interactivo del tiempo. Sin cuenta, sin cookies.',
    info_src_forecast: 'Pronóstico:',
    info_src_radar: 'Radar:',
    info_src_satellite: 'Satélite:',
    info_src_cyclones: 'Ciclones:',
    info_src_basemap: 'Mapa base:',
    info_src_alerts: 'Avisos:',
    info_disclaimer: 'Sin garantía. Para uso informativo. Consulta avisos oficiales.',
    legend_light: 'Ligera',
    legend_moderate: 'Moderada',
    legend_heavy: 'Intensa',
    legend_snow: 'Nieve',
    last_updated: 'Última actualización:',
    update_failed: 'No se pudo actualizar. Reintentando automáticamente.',
    load_retrying: 'Error al cargar. Reintentando...',
    rain_suffix: '% lluvia',
    stale_data: 'Datos de hace {n} h · ',
    refresh: 'Actualizar',
    redirecting_to: 'Redirigiendo a',
    in_one_s: 'en 1 s…',
    thinking: 'Pensando…',
    ask_error: 'No pude resolver tu pregunta. Prueba con algo más simple, o abre el mapa.',
    share: 'Compartir',
    url_copied: 'URL copiada',
    fav_add: 'Agregar a favoritos',
    fav_remove: 'Quitar de favoritos',
    fav_cap: 'Máximo 12 lugares — quita uno',
    fav_most_visited: '★ Más visitado',
  },
  en: {
    search_placeholder: 'Search any city or place…',
    use_my_location: 'Use my location',
    searching: 'Searching…',
    no_results: 'No results for',
    geo_outside_mx: 'Looks like you are outside Mexico. Use the search for another location.',
    geo_denied: 'We need your permission to show local weather. Use the search.',
    geo_timeout: 'Timed out looking for your location. Try again.',
    quick_peek: 'Quick peek',
    full_forecast: 'See full forecast',
    back_home: 'Back to home',
    current: 'Now',
    today: 'Today',
    feels_like: 'feels like',
    hourly_48h: 'Hourly — today & tomorrow (48 h)',
    ten_days: '10 days',
    sixteen_days: '16 days',
    more_days: 'See 16 days',
    fewer_days: 'See 10 days',
    days_caveat: 'Days 11 to 16 carry lower confidence: read them as a trend, not a forecast.',
    models_diverge: 'Models disagree',
    detail: 'Detail',
    wind: 'Wind',
    uv_index: 'UV index',
    sky_air: 'Sky & air',
    humidity: 'humidity',
    pressure: 'pressure',
    visibility: 'visibility',
    sunrise: 'sunrise',
    sunset: 'sunset',
    cloud_cover: 'clouds',
    gusts: 'gusts',
    pick_location: 'Search for a location to see its forecast.',
    loading: 'Loading forecast…',
    load_error: 'Failed to load. It will retry automatically.',
    map_title: 'Weather map',
    map_nav: 'Map',
    map_teaser_heading: 'Interactive weather map',
    map_teaser_cta: 'Open interactive map',
    map_layer_base: 'Base map',
    map_search_placeholder: 'Search a place on the map…',
    map_search_city_badge: 'city',
    map_locate: 'My location',
    map_popup_full_forecast: 'See full forecast',
    place_card_title: 'Selected point',
    place_card_daily: 'Daily',
    place_card_hourly: 'Hourly',
    place_card_close: 'Close',
    place_card_today: 'Today',
    place_card_tomorrow: 'Tomorrow',
    place_card_error: 'Could not load the forecast for this point.',
    map_layer_unavailable: 'Layer unavailable',
    map_layers: 'Layers',
    map_layer_radar: 'Radar',
    map_layer_satellite: 'Satellite',
    timeline_label: 'Timeline',
    timeline_play: 'Play',
    timeline_pause: 'Pause',
    timeline_prev: 'Previous frame',
    timeline_next: 'Next frame',
    timeline_now: 'Now',
    timeline_extend: 'See 10 days',
    timeline_extending: 'Loading 10 days…',
    timeline_extend_failed: 'Could not extend the forecast. Try again.',
    timeline_jump: 'Jump to date',
    map_layer_temperature: 'Temperature',
    map_layer_humidity: 'Humidity',
    map_layer_pressure: 'Pressure',
    map_layer_precipitation: 'Precipitation',
    map_layer_wind: 'Wind',
    legend_wind_calm: 'Calm',
    legend_wind_breeze: 'Breeze',
    legend_wind_strong: 'Strong',
    legend_wind_gale: 'Gale',
    map_layer_sunlight: 'Sun',
    welcome_title: 'Welcome to Clima México',
    welcome_body: 'Centre the map on your location? It stays in your browser: no account, no cookies, no tracking.',
    welcome_locate: 'Locate me',
    welcome_dismiss: 'Not now',
    layer_page_link: 'Page for this layer',
    confidence_loading: 'Comparing models (ICON, GFS, ECMWF)…',
    confidence_failed: 'Could not compare models for this layer.',
    confidence_between_models: 'between models',
    layer_explainer_radar: 'Radar shows detected precipitation (rain, snow) in near real time from RainViewer. Press ▶ to animate the last 2 h and the nowcast.',
    layer_explainer_satellite: 'GOES-East satellite (NASA GIBS) every 10 min: GeoColor by day, infrared by night. The timeline spans 24 h; "10 days" extends it. Press N for night lights.',
    layer_explainer_temperature: 'Air temperature at 2 m, a continuous gradient from yesterday to +10 days. Feels-like adds humidity and wind; tap the map for your forecast.',
    layer_explainer_humidity: 'Relative humidity or dew point at 2 m, per sub-option. Higher humidity = the same heat feels heavier.',
    layer_explainer_pressure: 'Atmospheric pressure with isobars labelled every 4 hPa. Sea level (msl) is the standard meteorological reduction; Surface follows real altitude.',
    layer_explainer_precipitation: 'Forecast precipitation in mm/h (rain + snow), or Snow in cm/h and Probability in %. The radar tells what is falling; this layer what is coming.',
    layer_explainer_wind: 'Wind speed and direction at 10 m. Turn on Gusts to see instantaneous peaks instead of the average.',
    layer_explainer_sunlight: 'Sun position and shaded areas (day/night terminator). Turn on Night line (O) to keep just the line over any layer.',
    map_opacity: 'Opacity',
    map_layer_short_base: 'Map',
    map_layer_short_radar: 'Radar',
    map_layer_short_satellite: 'Satellite',
    map_layer_short_temperature: 'Temp.',
    map_layer_short_humidity: 'Humidity',
    map_layer_short_pressure: 'Pressure',
    map_layer_short_precipitation: 'Precip.',
    map_layer_short_wind: 'Wind',
    map_layer_short_sunlight: 'Sun',
    map_overlays: 'Overlays',
    map_overlays_filter: 'Filter overlays',
    map_overlays_pinned: 'Most used',
    map_overlays_all: 'All',
    map_overlays_empty: 'No matches',
    map_tools: 'Tools',
    map_tools_tab_tools: 'Tools',
    map_tools_tab_settings: 'Settings',
    map_tools_tab_info: 'Info',
    map_tools_measure: 'Measure',
    map_tools_compare: 'Compare',
    map_tool_active: 'Active tool',
    map_tool_exit: 'Exit',
    map_tool_distance: 'Distance',
    map_tool_area: 'Area',
    map_tool_crosshair: 'Crosshair',
    map_tool_compare: 'Comparison',
    map_controls_compact: 'Layers and controls',
    map_sheet_resize: 'Panel size',
    map_sheet_peek: 'collapsed',
    map_sheet_half: 'half',
    map_sheet_full: 'full',
    map_shortcuts: 'Keyboard shortcuts',
    map_shortcuts_close: 'Close',
    map_shortcuts_general: 'General',
    map_shortcuts_help: 'Show or hide this help',
    map_shortcuts_escape: 'Close a panel or leave a tool',
    map_shortcuts_zoom: 'Zoom in / out (map focused)',
    map_shortcuts_pan: 'Pan the map (map focused)',
    map_shortcuts_jump_date: 'Jump to a date (timeline focused)',
    map_shortcuts_enter: 'Enter',
    map_shortcuts_hint: 'Letters work whenever you are not typing in a field: a layer letter switches to that layer, an overlay letter turns it on or off.',
    map_overlay_tropical: 'Tropical systems',
    map_overlay_outlook: 'Development outlook (2 / 7 d)',
    map_overlay_graticule: 'Graticule',
    map_overlay_nightLights: 'Night lights',
    map_overlay_nightLine: 'Day/night line',
    map_overlay_borders: 'Borders',
    map_overlay_fires: 'Active fires',
    map_overlay_radarCoverage: 'Radar coverage',
    map_overlay_precipMode: 'Precipitation mode (satellite + clouds + radar)',
    map_overlay_confidence: 'Uncertainty (model disagreement)',
    map_overlay_clouds: 'Clouds',
    map_overlay_quakes: 'Earthquakes (USGS)',
    map_overlay_volcanoes: 'Active volcanoes',
    map_overlay_cityValues: 'Label values',
    map_overlay_windOverlay: 'Wind animation',
    map_overlay_aqi: 'Air quality (PM2.5)',
    map_overlay_smnStateTint: 'SMN alerts by state',
    map_overlay_marine: 'Beaches (waves + SST)',
    map_overlay_webcams: 'Live webcams',
    map_overlay_lakes: 'Lakes and dams',
    map_overlay_histStorms: 'Notable MX hurricanes',
    map_overlay_colorBlind: 'Accessible palette',
    map_controls: 'Map controls',
    map_zoom_in: 'Zoom in',
    map_zoom_out: 'Zoom out',
    map_reset_bearing: 'Reset bearing to north',
    map_model: 'Open-Meteo forecast model',
    timeline_day_prev: 'Previous day',
    timeline_day_next: 'Next day',
    timeline_hour_prev: 'Previous hour',
    timeline_hour_next: 'Next hour',
    timeline_now_aria: 'Back to the current frame',
    map_tool_distance_aria: 'Measure distance',
    map_tool_area_aria: 'Measure area',
    map_tool_crosshair_aria: 'Crosshair mode: value at the centre of the map',
    map_tool_crosshair_title: 'Crosshair mode: the layer value at the centre of the map',
    map_snapshot_capture: 'Capture',
    map_snapshot_capture_aria: 'Capture the current view',
    map_snapshot_24h: '24 h ago',
    map_snapshot_24h_aria: 'Compare with 24 hours ago',
    map_snapshot_24h_title: 'Freezes the current view and moves the timeline 24 h back; switch with Show/Hide',
    map_snapshot_clear: 'Clear',
    map_snapshot_hide: 'Hide',
    map_snapshot_show: 'Show',
    map_snapshot_hide_aria: 'Hide comparison',
    map_snapshot_show_aria: 'Show comparison',
    map_measure_tap_next: 'Tap another point to measure',
    map_measure_segment: 'segment',
    map_measure_segments: 'segments',
    map_measure_add_points: 'Add {n} more point(s)',
    map_satellite_zoom_limit: 'Satellite is limited to zoom z{z} (NASA GIBS). Closer in, only a blur over the basemap shows.',
    map_marker: 'Map marker',
    map_marker_named: 'Marker: {name}',
    map_place_location: 'Location {coords}',
    map_tooltip_day: 'Day',
    map_west: 'W',
    map_tooltip_night: 'Night',
    map_sub_temp_actual: 'Air',
    map_sub_temp_aparente: 'Feels like',
    map_sub_temp_bulbo: 'Wet bulb',
    map_sub_humidity_relativa: 'Relative',
    map_sub_humidity_rocio: 'Dew point',
    map_sub_precip_lluvia: 'Rain',
    map_sub_precip_nieve: 'Snow',
    map_sub_precip_probabilidad: 'Probability',
    map_sub_pressure_msl: 'Sea level',
    map_sub_pressure_surface: 'Surface',
    map_sub_wind_velocidad: 'Speed',
    map_sub_wind_rachas: 'Gusts',
    map_sub_satellite_geocolor: 'GeoColor',
    map_sub_satellite_ir: 'Infrared',
    map_sub_satellite_truecolor: 'True color',
    settings_tz: 'Time zone',
    settings_tz_local: 'Local',
    settings_hour: 'Hour format',
    settings_loop: 'Animation loop',
    settings_loop_hint: 'Frames within ±N h of now',
    settings_speed: 'Speed',
    settings_speed_slow: 'Slow',
    settings_speed_medium: 'Medium',
    settings_speed_fast: 'Fast',
    settings_style: 'Style',
    settings_style_hint: 'Smooth cross-fades the radar and satellite frames',
    settings_style_fast: 'Instant',
    settings_style_smooth: 'Smooth',
    settings_label: 'Time label',
    settings_label_both: 'Both',
    settings_label_clock: 'Clock',
    settings_label_relative: 'Relative',
    settings_temp: 'Temperature',
    settings_wind: 'Wind',
    settings_pressure: 'Pressure',
    settings_distance: 'Distance',
    settings_note: 'Applies live to the timeline, legend, tooltip, place card and /forecast. Saved on this device, no account.',
    info_tagline: '— interactive weather map. No account, no cookies.',
    info_src_forecast: 'Forecast:',
    info_src_radar: 'Radar:',
    info_src_satellite: 'Satellite:',
    info_src_cyclones: 'Cyclones:',
    info_src_basemap: 'Base map:',
    info_src_alerts: 'Alerts:',
    info_disclaimer: 'No warranty. For information only. Check the official alerts.',
    legend_light: 'Light',
    legend_moderate: 'Moderate',
    legend_heavy: 'Heavy',
    legend_snow: 'Snow',
    last_updated: 'Last updated:',
    update_failed: 'Could not update. Retrying automatically.',
    load_retrying: 'Failed to load. Retrying...',
    rain_suffix: '% rain',
    stale_data: 'Data from {n} h ago · ',
    refresh: 'Refresh',
    redirecting_to: 'Redirecting to',
    in_one_s: 'in 1 s…',
    thinking: 'Thinking…',
    ask_error: 'I could not resolve your question. Try something simpler, or open the map.',
    share: 'Share',
    url_copied: 'URL copied',
    fav_add: 'Add to favourites',
    fav_remove: 'Remove from favourites',
    fav_cap: 'Maximum 12 places — remove one',
    fav_most_visited: '★ Most visited',
  },
};

export type UiLang = keyof typeof ui;

/**
 * Story 25.3 — fill the `{name}` placeholders of a `ui` string
 * ("Añade {n} punto(s) más"). An unknown placeholder stays as written,
 * so a typo shows up on screen instead of vanishing.
 */
export function fillUi(
  template: string,
  vars: Record<string, string | number>
): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m
  );
}

/**
 * Story 25.3 — the language the page is shown in. The pages are built in
 * Spanish (`lang` props default to 'es'); BaseLayout's pre-paint script
 * stamps `<html data-lang>` from `?lang=`, the session toggle or the
 * browser, and swaps the `data-i18n-en*` markup. Script-built chrome
 * follows the same attribute; `fallback` covers a document without it
 * (tests, a page outside BaseLayout).
 */
export function documentUiLang(fallback: UiLang = 'es'): UiLang {
  if (typeof document === 'undefined') return fallback;
  const l = document.documentElement.getAttribute('data-lang');
  return l === 'en' || l === 'es' ? l : fallback;
}
