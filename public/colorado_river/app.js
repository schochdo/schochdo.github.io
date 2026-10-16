// Colorado River Basin Water Infrastructure & Hydrology Dashboard
// Powered by MapLibre GL JS with 3D DEM Terrain Option & Top-Down 2D Default

let map;
let isTilted = false; // Default to clean, readable 2D top-down mode

// Marker and station registry
const markers = {
  gauges: [],
  tunnels: [],
  canals: [],
  reservoirs: []
};
let stationMarkers = {};
let tooltipPopup;
let cachedGeography = null;
let cachedRiverNetwork = null;
let cachedLakes = null;
let cachedNormals = null;
let cachedMetrics = null;

// Basemap configurations: default to National Geographic (Warm Physical Style)
const basemapLayerKeys = [
  'esriNatGeo', 'esriWorldTopo', 'esriTerrain', 'esriPhysical',
  'esriSatellite', 'esriRelief', 'openTopo'
];

const initialStyle = {
  version: 8,
  sources: {
    'terrain-dem': {
      type: 'raster-dem',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      tileSize: 256,
      encoding: 'terrarium',
      maxzoom: 15
    },
    'basemap-esriNatGeo': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 16,
      attribution: 'Tiles &copy; Esri &mdash; National Geographic, USGS, NOAA'
    },
    'basemap-esriWorldTopo': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Tiles &copy; Esri &mdash; HERE, Garmin, USGS, EPA'
    },
    'basemap-esriTerrain': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 13,
      attribution: 'Tiles &copy; Esri &mdash; USGS, Esri, NPS'
    },
    'basemap-esriPhysical': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 8,
      attribution: 'Tiles &copy; Esri &mdash; US NPS, USGS'
    },
    'basemap-esriSatellite': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Tiles &copy; Esri'
    },
    'basemap-esriRelief': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 23,
      attribution: 'Tiles &copy; Esri &mdash; USGS, METI, NASA'
    },
    'basemap-openTopo': {
      type: 'raster',
      tiles: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 17,
      attribution: 'Tiles &copy; OpenTopoMap'
    },
    'basemap-labels': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Reference_Overlay/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256
    }
  },
  layers: [
    // National Geographic (Warm Physical Style) active by default
    { id: 'layer-esriNatGeo', type: 'raster', source: 'basemap-esriNatGeo', layout: { visibility: 'visible' } },
    { id: 'layer-esriWorldTopo', type: 'raster', source: 'basemap-esriWorldTopo', layout: { visibility: 'none' } },
    { id: 'layer-esriTerrain', type: 'raster', source: 'basemap-esriTerrain', layout: { visibility: 'none' } },
    { id: 'layer-esriSatellite', type: 'raster', source: 'basemap-esriSatellite', layout: { visibility: 'none' } },
    { id: 'layer-openTopo', type: 'raster', source: 'basemap-openTopo', layout: { visibility: 'none' } },
    // Reference labels overlay (hidden by default since NatGeo has built-in labels)
    { id: 'layer-labels', type: 'raster', source: 'basemap-labels', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.85 } }
  ]
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initMap();
  });
} else {
  initMap();
}

function initMap() {
  // Default: clean 2D top-down orientation fit perfectly to the Upper and Lower Basin extents
  map = new maplibregl.Map({
    container: 'map',
    style: initialStyle,
    bounds: [[-116.65, 31.15], [-105.45, 43.65]],
    fitBoundsOptions: { padding: { top: 45, bottom: 45, left: 45, right: 45 } },
    pitch: 0,
    bearing: 0,
    maxPitch: 65,
    attributionControl: false
  });
  window.map = map;

  // Pitch & orientation navigation controls
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');

  // Shared hover tooltip popup
  tooltipPopup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    offset: 12
  });

  map.on('load', () => {
    // Note: Do NOT enable 3D terrain in 2D flat mode. 3D perspective LOD causes edge tiles
    // on wide monitors to drop to lower zoom levels, resulting in blurry screen borders.
    // 2D orthogonal Mercator projection guarantees 100% uniform tile resolution edge-to-edge.
    if (isTilted) {
      map.setTerrain({
        source: 'terrain-dem',
        exaggeration: 1.5
      });
    }

    loadData();
    initTrackballNavigation();
    initTableResizer();
    if (window.location.search.includes('expand_table=1')) {
      toggleTableCollapse();
    }
    if (window.location.search.includes('expand_sidebar=1')) {
      ['outflows', 'reservoirs', 'front-range'].forEach(prefix => {
        const body = document.getElementById(`${prefix}-body`);
        if (body && window.getComputedStyle(body).display === 'none') {
          toggleCardCollapse(`${prefix}-card`, `${prefix}-body`, `${prefix}-collapse-icon`);
        }
      });
    }
    if (window.location.search.includes('show_tunnels=1')) {
      const toggle = document.getElementById("toggle-tunnels");
      if (toggle) {
        toggle.checked = true;
        toggleLayer("tunnels");
      }
      map.jumpTo({ center: [-105.9, 39.9], zoom: 9.6 });
    }
    if (window.location.search.includes('3d=1')) {
      isTilted = true;
      if (!map.getTerrain()) {
        map.setTerrain({ source: 'terrain-dem', exaggeration: 1.5 });
      }
      map.jumpTo({ pitch: 42, bearing: -8 });
      updatePerspectiveUI();
      zoomToPreset('basin');
    }
    if (window.location.search.includes('open_menu=1')) {
      toggleMapMenu();
    }
    if (window.location.search.includes('zoom_to=socal')) {
      map.jumpTo({ center: [-115.0, 33.1], zoom: 7.2 });
    }
    if (window.location.search.includes('show_canals=1')) {
      const toggle = document.getElementById("toggle-canals");
      if (toggle) {
        toggle.checked = true;
        toggleLayer("canals");
      }
      map.jumpTo({ center: [-115.0, 32.78], zoom: 10 });
    }
    if (window.location.search.includes('zoom_to=lees_ferry')) {
      map.jumpTo({ center: [-111.588, 36.864], zoom: 7.8 });
    }
  });

  map.on('move', queueBadgePlacements);
  map.on('zoom', queueBadgePlacements);
  map.on('resize', queueBadgePlacements);
  map.on('pitch', syncPerspectiveState);
}

function changeBasemap(key) {
  basemapLayerKeys.forEach(k => {
    const layerId = `layer-${k}`;
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, 'visibility', k === key ? 'visible' : 'none');
    }
  });

  // Reference labels overlay ONLY for basemaps that lack built-in editorial labels
  const needsLabels = ['esriTerrain', 'esriPhysical', 'esriRelief', 'esriSatellite'].includes(key);
  if (map.getLayer('layer-labels')) {
    map.setLayoutProperty('layer-labels', 'visibility', needsLabels ? 'visible' : 'none');
  }

  // Sync floating hamburger menu items
  document.querySelectorAll('.basemap-item-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === key);
  });

  // Update integrated attribution in map legend footer
  const baseAttributions = {
    esriNatGeo: 'Tiles &copy; Esri &mdash; National Geographic, USGS, NOAA',
    esriWorldTopo: 'Tiles &copy; Esri &mdash; HERE, Garmin, USGS, EPA',
    esriTerrain: 'Tiles &copy; Esri &mdash; USGS, Esri, NPS',
    esriPhysical: 'Tiles &copy; Esri &mdash; US NPS, USGS',
    esriSatellite: 'Tiles &copy; Esri',
    esriRelief: 'Tiles &copy; Esri &mdash; USGS, METI, NASA',
    openTopo: 'Tiles &copy; OpenTopoMap &mdash; &copy; OpenStreetMap'
  };
  const attribEl = document.getElementById('legend-attribution');
  if (attribEl) {
    const txt = baseAttributions[key] || baseAttributions.esriNatGeo;
    attribEl.innerHTML = `${txt} | <a href="https://maplibre.org" target="_blank" rel="noopener">MapLibre</a>`;
  }
}

function selectBasemap(key) {
  changeBasemap(key);
}

function syncPerspectiveState() {
  if (!map) return;
  const currentPitch = map.getPitch();
  const shouldBeTilted = currentPitch > 5;

  if (shouldBeTilted !== isTilted) {
    isTilted = shouldBeTilted;
    if (isTilted) {
      if (!map.getTerrain()) {
        map.setTerrain({ source: 'terrain-dem', exaggeration: 1.5 });
      }
    } else {
      if (currentPitch === 0 && map.getTerrain()) {
        map.setTerrain(null);
      }
    }
  }

  updatePerspectiveUI();
}

function updatePerspectiveUI() {
  if (!map) return;
  const currentPitch = Math.round(map.getPitch());
  const tilted = currentPitch > 5;

  // Perspective toggle buttons
  const btn2d = document.getElementById("btn-perspective-2d");
  const btn3d = document.getElementById("btn-perspective-3d");
  if (btn2d) btn2d.classList.toggle("active", !tilted);
  if (btn3d) btn3d.classList.toggle("active", tilted);

  // On-map 3D toggle button in tilt control group
  const map3dBtn = document.getElementById("btn-tilt-mode");
  if (map3dBtn) map3dBtn.classList.toggle("active", tilted);

  // Slider in hamburger menu
  const slider = document.getElementById("tilt-range-slider");
  if (slider && document.activeElement !== slider) {
    slider.value = currentPitch;
  }

  // Tilt status badge
  const badge = document.getElementById("tilt-status-badge");
  if (badge) {
    badge.textContent = tilted ? "3D Active" : "Flat 2D";
  }

  // Preset chips
  const chipFlat = document.getElementById("chip-flat");
  const chipLow = document.getElementById("chip-low");
  const chipSteep = document.getElementById("chip-steep");
  if (chipFlat) chipFlat.classList.toggle("active", currentPitch <= 5);
  if (chipLow) chipLow.classList.toggle("active", currentPitch > 5 && currentPitch <= 45);
  if (chipSteep) chipSteep.classList.toggle("active", currentPitch > 45);
}

function setPitchDegrees(deg) {
  if (!map) return;
  deg = Math.max(0, Math.min(65, deg));
  if (deg > 0) {
    if (!map.getTerrain()) {
      map.setTerrain({ source: 'terrain-dem', exaggeration: 1.5 });
    }
    isTilted = true;
    map.easeTo({
      pitch: deg,
      bearing: map.getBearing() !== 0 ? map.getBearing() : -8,
      duration: 600
    });
  } else {
    // Return to flat 2D
    map.easeTo({
      pitch: 0,
      bearing: 0,
      duration: 600
    });
    setTimeout(() => {
      if (map && map.getPitch() === 0) {
        map.setTerrain(null);
        isTilted = false;
        updatePerspectiveUI();
      }
    }, 650);
  }
}

function setPitchFromSlider(val) {
  const deg = parseInt(val, 10) || 0;
  setPitchDegrees(deg);
}

function tiltStep(delta) {
  if (!map) return;
  const currentPitch = map.getPitch();
  let targetPitch;
  if (delta > 0) {
    // Stepping up
    if (currentPitch < 5) {
      targetPitch = 38;
    } else {
      targetPitch = Math.min(65, Math.round((currentPitch + 15) / 5) * 5);
    }
  } else {
    // Stepping down
    if (currentPitch <= 25) {
      targetPitch = 0;
    } else {
      targetPitch = Math.max(0, Math.round((currentPitch - 15) / 5) * 5);
    }
  }
  setPitchDegrees(targetPitch);
}

function setPerspective(mode) {
  if (mode === '3d') {
    setPitchDegrees(map.getPitch() > 10 ? map.getPitch() : 38);
  } else {
    setPitchDegrees(0);
  }
}

function toggleTilt() {
  if (isTilted) {
    setPitchDegrees(0);
  } else {
    setPitchDegrees(38);
  }
}

function toggleMapMenu(e) {
  if (e) e.stopPropagation();
  const dropdown = document.getElementById("map-menu-dropdown");
  const btn = document.getElementById("map-menu-btn");
  if (dropdown) {
    const isShowing = dropdown.classList.contains("show");
    dropdown.classList.toggle("show", !isShowing);
    if (btn) btn.classList.toggle("active", !isShowing);
  }
}

// Close map menu on click outside or escape key
document.addEventListener("click", (e) => {
  const container = document.getElementById("map-menu-container");
  if (container && !container.contains(e.target)) {
    const dropdown = document.getElementById("map-menu-dropdown");
    const btn = document.getElementById("map-menu-btn");
    if (dropdown) dropdown.classList.remove("show");
    if (btn) btn.classList.remove("active");
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const dropdown = document.getElementById("map-menu-dropdown");
    const btn = document.getElementById("map-menu-btn");
    if (dropdown) dropdown.classList.remove("show");
    if (btn) btn.classList.remove("active");
  }
});

async function fetchLiveUSGS() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const sites = "09070500,09095500,09180500,09380000,09429100,09315000,09260050,09306500,09302000,09152500,09180000,09379500,09364500,09085000,09070000,09057500,09402000,09415000,09426000,09474000,09520500,09498500,09511300,09527700,09379900,09422500,09427500";
    const url = `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${sites}&parameterCd=00060,62614,00054&siteStatus=all`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`USGS HTTP ${res.status}`);
    const data = await res.json();
    const siteNames = {
      // Mainstem Sentinel Gauges
      "09070500": "Colorado River near Dotsero, CO",
      "09095500": "Colorado River near Cameo, CO",
      "09180500": "Colorado River near Cisco, UT",
      "09380000": "Colorado River at Lees Ferry, AZ",
      "09429100": "Colorado River below Palo Verde Dam, AZ-CA",
      // Major Upper Basin Tributaries
      "09315000": "Green River at Green River, UT",
      "09260050": "Yampa River at Deerlodge Park, CO",
      "09306500": "White River near Watson, UT",
      "09302000": "Duchesne River near Randlett, UT",
      "09152500": "Gunnison River near Grand Junction, CO",
      "09180000": "Dolores River near Cisco, UT",
      "09379500": "San Juan River near Bluff, UT",
      "09364500": "Animas River at Farmington, NM",
      // Headwaters & West Slope Tributaries
      "09085000": "Roaring Fork River at Glenwood Springs, CO",
      "09070000": "Eagle River below Gypsum, CO",
      "09057500": "Blue River below Green Mtn Reservoir, CO",
      // Grand Canyon, Desert & Lower Basin Tributaries
      "09402000": "Little Colorado River near Cameron, AZ",
      "09415000": "Virgin River at Littlefield, AZ",
      "09426000": "Bill Williams River below Alamo Dam, AZ",
      "09474000": "Gila River at Kelvin, AZ",
      "09520500": "Gila River near Dome, AZ",
      "09498500": "Salt River near Roosevelt, AZ",
      "09511300": "Verde River near Scottsdale, AZ",
      // Major Conveyance Canal
      "09527700": "All-American Canal near Imperial Dam"
    };
    const streamflows = [];
    let aac = null;
    const reservoirs = {};
    const series = data?.value?.timeSeries || [];
    for (const ts of series) {
      const code = ts.sourceInfo.siteCode[0].value;
      const param = ts.variable.variableCode[0].value;
      const name = siteNames[code] || ts.sourceInfo.siteName;
      const lat = ts.sourceInfo.geoLocation.geogLocation.latitude;
      const lon = ts.sourceInfo.geoLocation.geogLocation.longitude;
      const vals = ts.values[0]?.value;
      if (vals && vals.length > 0) {
        const latest = vals[vals.length - 1];
        const val = parseFloat(latest.value);
        if (val >= 0) {
          if (code === "09527700" && param === "00060") {
            aac = { id: code, name, type: "diversion_canal", destination: "Imperial & Coachella Valleys", flow_cfs: val, timestamp: latest.dateTime, lat, lon };
          } else if (code === "09379900") {
            // Lake Powell live elevation
            if (param === "62614") {
              reservoirs["lake_powell"] = { elevation_ft: Math.round(val * 10) / 10, timestamp: latest.dateTime };
            }
          } else if (code === "09422500") {
            // Lake Mohave
            if (!reservoirs["lake_mohave"]) reservoirs["lake_mohave"] = {};
            if (param === "00054") {
              reservoirs["lake_mohave"].storage_af = val;
              reservoirs["lake_mohave"].timestamp = latest.dateTime;
            } else if (param === "62614") {
              reservoirs["lake_mohave"].elevation_ft = Math.round(val * 10) / 10;
            }
          } else if (code === "09427500") {
            // Lake Havasu
            if (!reservoirs["lake_havasu"]) reservoirs["lake_havasu"] = {};
            if (param === "00054") {
              reservoirs["lake_havasu"].storage_af = val;
              reservoirs["lake_havasu"].timestamp = latest.dateTime;
            } else if (param === "62614") {
              reservoirs["lake_havasu"].elevation_ft = Math.round(val * 10) / 10;
            }
          } else if (siteNames[code] && param === "00060") {
            streamflows.push({ id: code, name, type: "streamflow", flow_cfs: val, timestamp: latest.dateTime, lat, lon });
          }
        }
      }
    }
    return { streamflows, aac, reservoirs };
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

async function fetchLiveCDWR() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const abbrevs = "DILRESCO,GRARESCO,GRERESCO,HOMRESCO,ADATUNCO,MOFTUNCO,ROBTUNCO,BOUTUNCO";
    const url = `https://dwr.state.co.us/Rest/GET/api/v2/telemetrystations/telemetrytimeserieshour/?format=json&abbrev=${abbrevs}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`CDWR HTTP ${res.status}`);
    const data = await res.json();
    const items = data?.ResultList || [];

    const tunnels = {};
    const reservoirs = {
      "dillon_reservoir": {},
      "lake_granby": {},
      "green_mountain": {},
      "homestake_reservoir": {}
    };

    const abbMap = {
      "DILRESCO": "dillon_reservoir",
      "GRARESCO": "lake_granby",
      "GRERESCO": "green_mountain",
      "HOMRESCO": "homestake_reservoir"
    };

    for (const item of items) {
      const abb = item.abbrev;
      const param = item.parameter;
      const dt = item.measDateTime || item.measDate;
      const val = parseFloat(item.measValue);
      if (isNaN(val)) continue;

      if (param === "DISCHRG" && ["ADATUNCO", "MOFTUNCO", "ROBTUNCO", "BOUTUNCO"].includes(abb)) {
        tunnels[abb] = { flow_cfs: Math.max(0, Math.round(val * 10) / 10), timestamp: dt };
      } else if (abbMap[abb]) {
        const resId = abbMap[abb];
        if (param === "STORAGE") {
          reservoirs[resId].storage_af = Math.round(val);
          reservoirs[resId].timestamp = dt;
        } else if (param === "ELEV") {
          reservoirs[resId].elev_val = val;
        }
      }
    }
    return { tunnels, reservoirs };
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

function computeRiverWeight(flowCfs, category) {
  if (!flowCfs || flowCfs <= 0) {
    return category === "mainstem" ? 2.8 : (category === "major_tributary" ? 1.8 : 1.2);
  }
  if (category === "mainstem") {
    return Math.round(Math.min(12.5, Math.max(2.8, 2.0 + Math.sqrt(flowCfs) * 0.08)) * 10) / 10;
  } else if (category === "major_tributary") {
    return Math.round(Math.min(7.5, Math.max(1.8, 1.4 + Math.sqrt(flowCfs) * 0.065)) * 10) / 10;
  } else {
    return Math.round(Math.min(4.0, Math.max(1.2, 0.8 + Math.sqrt(flowCfs) * 0.05)) * 10) / 10;
  }
}

function computeTunnelWeight(flowCfs) {
  // Proportional line width scaled with flow; minimum 2.5px so zero/low-flow tunnels are clearly visible and clickable
  if (!flowCfs || flowCfs <= 0) return 2.5;
  return Math.min(8.0, 2.5 + Math.sqrt(flowCfs) * 0.28);
}

function applyLiveHydrology(riverNetwork, metrics) {
  if (!riverNetwork || !riverNetwork.features || !metrics) return;
  
  const streamflows = metrics.streamflows || [];
  const byId = {};
  streamflows.forEach(s => { byId[s.id] = s; });

  const dotsero = byId["09070500"];
  const cameo = byId["09095500"];
  const cisco = byId["09180500"];
  const leesFerry = byId["09380000"];
  const paloVerde = byId["09429100"];

  const green = byId["09315000"];
  const yampa = byId["09260050"];
  const white = byId["09306500"];
  const duchesne = byId["09302000"];
  const gunnison = byId["09152500"];
  const dolores = byId["09180000"];
  const sanjuan = byId["09379500"];
  const animas = byId["09364500"];

  const roaringFork = byId["09085000"];
  const eagle = byId["09070000"];
  const blue = byId["09057500"];

  const littleColorado = byId["09402000"];
  const virgin = byId["09415000"];
  const billWilliams = byId["09426000"];
  const gilaKelvin = byId["09474000"];
  const salt = byId["09498500"];
  const verde = byId["09511300"];

  // Secondary tributary fallback mapping to basin sentinel gauge
  const reachGauges = {
    cameo_grand_junction: "09095500",
    lower_basin_middle: "09429100",
    price_river: "09302000",
    little_snake_river: "09260050",
    uncompahgre_river: "09152500",
    fryingpan_river: "09085000",
    san_rafael_river: "09315000",
    dirty_devil_river: "09180500",
    escalante_river: "09380000",
    paria_river: "09380000",
    muddy_river: "09415000",
    kanab_creek: "09380000",
    havasu_creek: "09380000",
    san_pedro_river: "09474000",
    fraser_river: "09070500"
  };

  riverNetwork.features.forEach(f => {
    const r = f.properties.reach;
    const cat = f.properties.category || "minor_tributary";
    let flow = f.properties.flow_cfs;
    let sourceLabel = "Hydrologic Baseflow Estimate";
    let gaugeInfo = f.properties.notes || "";
    let timestamp = null;
    let gaugeId = f.properties.gauge_id || null;

    if (r === "headwaters") {
      flow = 350;
      sourceLabel = "Snowpack Headwaters Inflow";
      gaugeInfo = "Rocky Mountain NP snowmelt; upstream of Adams Tunnel";
      gaugeId = "09070500";
    } else if (r === "gore_canyon") {
      flow = dotsero ? dotsero.flow_cfs : 632;
      sourceLabel = "Live USGS Sentinel Gauge";
      gaugeInfo = "USGS #09070500 near Dotsero, CO (Kremmling & Glenwood Canyon)";
      timestamp = dotsero ? dotsero.timestamp : null;
      gaugeId = "09070500";
    } else if (r === "glenwood_cameo" || r === "cameo_grand_junction") {
      flow = cameo ? cameo.flow_cfs : 1700;
      sourceLabel = "Live USGS Sentinel Gauge";
      gaugeInfo = r === "glenwood_cameo"
        ? "USGS #09095500 near Cameo, CO (Glenwood Springs to Cameo)"
        : "USGS #09095500 near Cameo, CO (Grand Valley above Gunnison Confluence)";
      timestamp = cameo ? cameo.timestamp : null;
      gaugeId = "09095500";
    } else if (r === "grand_valley_cisco") {
      flow = cisco ? cisco.flow_cfs : 6020;
      sourceLabel = "Live USGS Sentinel Gauge (Combined Flow)";
      gaugeInfo = "USGS #09180500 near Cisco, UT (Below Gunnison Confluence to Green River Confluence)";
      timestamp = cisco ? cisco.timestamp : null;
      gaugeId = "09180500";
    } else if (r === "cataract_canyon") {
      const cFlow = cisco ? cisco.flow_cfs : 6020;
      const gFlow = green ? green.flow_cfs : 4900;
      flow = Math.round(cFlow + gFlow);
      sourceLabel = "Confluence Mass Balance (Live)";
      gaugeInfo = "Colorado (Cisco, UT) + Green River (Green River, UT) into Lake Powell";
      timestamp = cisco ? cisco.timestamp : null;
      gaugeId = "09180500";
    } else if (r === "lees_ferry") {
      flow = leesFerry ? leesFerry.flow_cfs : 7940;
      sourceLabel = "Live USGS Sentinel Gauge (1922 Compact Divide)";
      gaugeInfo = "USGS #09380000 at Lees Ferry, AZ (Glen Canyon Release)";
      timestamp = leesFerry ? leesFerry.timestamp : null;
      gaugeId = "09380000";
    } else if (r === "grand_canyon") {
      const lfFlow = leesFerry ? leesFerry.flow_cfs : 7940;
      flow = Math.round(lfFlow + (littleColorado ? littleColorado.flow_cfs : 26));
      sourceLabel = "Controlled Dam Release & Little Colorado Confluence";
      gaugeInfo = "Glen Canyon Dam release through Grand Canyon to Lake Mead";
      timestamp = leesFerry ? leesFerry.timestamp : null;
      gaugeId = "09380000";
    } else if (r === "lower_basin_upper") {
      flow = paloVerde ? Math.round(paloVerde.flow_cfs + 2850 + 2120) : 7200;
      sourceLabel = "Regulated Lower Basin Mainstem";
      gaugeInfo = "Hoover & Davis Dam releases for CRA / CAP water orders";
      timestamp = paloVerde ? paloVerde.timestamp : null;
      gaugeId = "09429100";
    } else if (r === "lower_basin_middle") {
      flow = paloVerde ? paloVerde.flow_cfs : 2230;
      sourceLabel = "Live USGS Sentinel Gauge (Post-Havasu Diversions)";
      gaugeInfo = "USGS #09429100 below Palo Verde Dam, AZ-CA (Downstream of CAP & CRA)";
      timestamp = paloVerde ? paloVerde.timestamp : null;
      gaugeId = "09429100";
    } else if (r === "lower_basin_taper") {
      flow = paloVerde ? Math.round(paloVerde.flow_cfs * 0.25) : 550;
      sourceLabel = "Residual Channel Flow Below Major Diversions";
      gaugeInfo = "Downstream of Imperial Dam / All-American Canal diversion to Morelos Dam (Mexico)";
      timestamp = paloVerde ? paloVerde.timestamp : null;
      gaugeId = "09429100";
    } else if (r === "green_river") {
      flow = green ? green.flow_cfs : 3350;
      sourceLabel = "Live USGS Sentinel Gauge";
      gaugeInfo = "USGS #09315000 at Green River, UT";
      timestamp = green ? green.timestamp : null;
      gaugeId = "09315000";
    } else if (r === "gunnison_river") {
      flow = gunnison ? gunnison.flow_cfs : 1230;
      sourceLabel = "Live USGS Sentinel Gauge";
      gaugeInfo = "USGS #09152500 near Grand Junction, CO";
      timestamp = gunnison ? gunnison.timestamp : null;
      gaugeId = "09152500";
    } else if (r === "yampa_river") {
      flow = yampa ? yampa.flow_cfs : 146;
      sourceLabel = "Live USGS Sentinel Gauge";
      gaugeInfo = "USGS #09260050 at Deerlodge Park, CO";
      timestamp = yampa ? yampa.timestamp : null;
      gaugeId = "09260050";
    } else if (r === "white_river") {
      flow = white ? white.flow_cfs : 293;
      sourceLabel = "Live USGS Sentinel Gauge";
      gaugeInfo = "USGS #09306500 near Watson, UT";
      timestamp = white ? white.timestamp : null;
      gaugeId = "09306500";
    } else if (r === "duchesne_river") {
      flow = duchesne ? duchesne.flow_cfs : 247;
      sourceLabel = "Live USGS Sentinel Gauge";
      gaugeInfo = "USGS #09302000 near Randlett, UT";
      timestamp = duchesne ? duchesne.timestamp : null;
      gaugeId = "09302000";
    } else if (r === "dolores_river") {
      flow = dolores ? dolores.flow_cfs : 187;
      sourceLabel = "Live USGS Sentinel Gauge";
      gaugeInfo = "USGS #09180000 near Cisco, UT";
      timestamp = dolores ? dolores.timestamp : null;
      gaugeId = "09180000";
    } else if (r === "sanjuan_river") {
      flow = sanjuan ? sanjuan.flow_cfs : 2460;
      sourceLabel = "Live USGS Sentinel Gauge";
      gaugeInfo = "USGS #09379500 near Bluff, UT";
      timestamp = sanjuan ? sanjuan.timestamp : null;
      gaugeId = "09379500";
    } else if (r === "animas_river") {
      flow = animas ? animas.flow_cfs : 2120;
      sourceLabel = "Live USGS Sentinel Gauge";
      gaugeInfo = "USGS #09364500 at Farmington, NM";
      timestamp = animas ? animas.timestamp : null;
      gaugeId = "09364500";
    } else if (r === "roaring_fork_river") {
      flow = roaringFork ? roaringFork.flow_cfs : 449;
      sourceLabel = "Live USGS Sentinel Gauge";
      gaugeInfo = "USGS #09085000 at Glenwood Springs, CO";
      timestamp = roaringFork ? roaringFork.timestamp : null;
      gaugeId = "09085000";
    } else if (r === "eagle_river") {
      flow = eagle ? eagle.flow_cfs : 133;
      sourceLabel = "Live USGS Sentinel Gauge";
      gaugeInfo = "USGS #09070000 below Gypsum, CO";
      timestamp = eagle ? eagle.timestamp : null;
      gaugeId = "09070000";
    } else if (r === "blue_river") {
      flow = blue ? blue.flow_cfs : 133;
      sourceLabel = "Live USGS Sentinel Gauge";
      gaugeInfo = "USGS #09057500 below Green Mtn Reservoir, CO";
      timestamp = blue ? blue.timestamp : null;
      gaugeId = "09057500";
    } else if (r === "little_colorado_river") {
      flow = littleColorado ? littleColorado.flow_cfs : 274;
      sourceLabel = "Live USGS Sentinel Gauge";
      gaugeInfo = "USGS #09402000 near Cameron, AZ";
      timestamp = littleColorado ? littleColorado.timestamp : null;
      gaugeId = "09402000";
    } else if (r === "virgin_river") {
      flow = virgin ? virgin.flow_cfs : 757;
      sourceLabel = "Live USGS Sentinel Gauge";
      gaugeInfo = "USGS #09415000 at Littlefield, AZ";
      timestamp = virgin ? virgin.timestamp : null;
      gaugeId = "09415000";
    } else if (r === "bill_williams_river") {
      flow = billWilliams ? billWilliams.flow_cfs : 7.9;
      sourceLabel = "Live USGS Sentinel Gauge";
      gaugeInfo = "USGS #09426000 below Alamo Dam, AZ";
      timestamp = billWilliams ? billWilliams.timestamp : null;
      gaugeId = "09426000";
    } else if (r === "salt_river") {
      flow = salt ? salt.flow_cfs : 1020;
      sourceLabel = "Live USGS Sentinel Gauge";
      gaugeInfo = "USGS #09498500 near Roosevelt, AZ";
      timestamp = salt ? salt.timestamp : null;
      gaugeId = "09498500";
    } else if (r === "verde_river") {
      flow = verde ? verde.flow_cfs : 131;
      sourceLabel = "Live USGS Sentinel Gauge";
      gaugeInfo = "USGS #09511300 near Scottsdale, AZ";
      timestamp = verde ? verde.timestamp : null;
      gaugeId = "09511300";
    } else if (r === "gila_river") {
      flow = gilaKelvin ? gilaKelvin.flow_cfs : 883;
      sourceLabel = "Live USGS Sentinel Gauge";
      gaugeInfo = "USGS #09474000 at Kelvin, AZ";
      timestamp = gilaKelvin ? gilaKelvin.timestamp : null;
      gaugeId = "09474000";
    }

    if (!gaugeId && reachGauges[r]) {
      gaugeId = reachGauges[r];
    }

    f.properties.gauge_id = gaugeId;
    f.properties.flow_cfs = flow;
    f.properties.weight = computeRiverWeight(flow, cat);
    f.properties.source_label = sourceLabel;
    f.properties.gauge_info = gaugeInfo;
    if (timestamp) f.properties.timestamp = timestamp;

    // Calculate flow health vs historical daily mean
    let customNorm = null;
    if (r === "cataract_canyon") {
      const normCisco = getHistoricalNormal("09180500") || 4240;
      const normGreen = getHistoricalNormal("09315000") || 2970;
      customNorm = normCisco + normGreen;
    } else if (r === "grand_canyon") {
      const normLF = getHistoricalNormal("09380000") || 10300;
      const normLCR = getHistoricalNormal("09402000") || 222;
      customNorm = normLF + normLCR;
    } else if (r === "headwaters") {
      customNorm = 350;
    } else if (r === "lower_basin_taper") {
      const normPV = getHistoricalNormal("09429100") || 6610;
      customNorm = Math.round(normPV * 0.25);
    }

    const norm = customNorm || (gaugeId ? getHistoricalNormal(gaugeId) : null);
    if (norm && norm > 0 && flow != null) {
      const pct = Math.round((flow / norm) * 100);
      f.properties.hist_normal_cfs = norm;
      f.properties.health_pct = pct;
      f.properties.health_color = flowHealthColor(pct);
      f.properties.health_label = flowHealthLabel(pct);
    } else {
      f.properties.hist_normal_cfs = null;
      f.properties.health_pct = null;
      f.properties.health_color = '#0284c7';
      f.properties.health_label = 'Baseline';
    }
  });

  if (map && map.getSource('rivers')) {
    map.getSource('rivers').setData(riverNetwork);
  }

  // If flow health layer is currently enabled, re-apply styling
  const isFlowHealthActive = document.getElementById('toggle-flow-health')?.checked ?? false;
  if (isFlowHealthActive) {
    toggleFlowHealthLayer(true);
  }

  if (map && map.getSource('tunnels') && cachedGeography?.tunnels) {
    const updatedTunnelFeats = cachedGeography.tunnels.filter(t => t.id && t.id.endsWith("TUNCO")).map(t => {
      const metric = metrics?.tunnels?.find(m => m.id === t.id);
      const flow = metric ? metric.flow_cfs : (t.flow_cfs || 0);
      return {
        type: 'Feature',
        properties: {
          ...t,
          flow_cfs: flow,
          capacity_cfs: t.capacity_cfs || 1020,
          timestamp: metric ? metric.timestamp : null
        },
        geometry: { type: 'LineString', coordinates: t.coords }
      };
    });
    map.getSource('tunnels').setData({ type: 'FeatureCollection', features: updatedTunnelFeats });
  }

  if (map && map.getSource('tunnel-portals') && cachedGeography?.tunnels) {
    const updatedPortals = [];
    cachedGeography.tunnels.filter(t => t.id && t.id.endsWith("TUNCO")).forEach(t => {
      const metric = metrics?.tunnels?.find(m => m.id === t.id);
      const flow = metric ? metric.flow_cfs : (t.flow_cfs || 0);
      if (t.coords && t.coords.length >= 2) {
        updatedPortals.push({
          type: 'Feature',
          properties: {
            ...t,
            flow_cfs: flow,
            capacity_cfs: t.capacity_cfs || 1020,
            portal_name: `West Slope Intake (${t.from})`,
            portal_type: 'intake'
          },
          geometry: { type: 'Point', coordinates: t.coords[0] }
        });
        updatedPortals.push({
          type: 'Feature',
          properties: {
            ...t,
            flow_cfs: flow,
            capacity_cfs: t.capacity_cfs || 1020,
            portal_name: `Front Range Outlet (${t.to})`,
            portal_type: 'outlet'
          },
          geometry: { type: 'Point', coordinates: t.coords[t.coords.length - 1] }
        });
      }
    });
    map.getSource('tunnel-portals').setData({ type: 'FeatureCollection', features: updatedPortals });
  }
}

async function loadData(forceLive = false) {
  const syncElem = document.getElementById("sync-time");
  try {
    const t = Date.now();
    
    // 1. Fetch metrics snapshot immediately in parallel with heavy geometries
    const metricsPromise = fetch(`./data/latest_metrics.json?t=${t}`)
      .then(r => r.json())
      .then(metrics => {
        cachedMetrics = metrics;
        populateTelemetryTable(metrics);
        updateSidebar(metrics);
        const initialDateStr = formatTimestamp(metrics.fetched_at);
        if (syncElem) syncElem.textContent = `Telemetry Snapshot (${initialDateStr})`;
        return metrics;
      });

    // 2. Fetch static base geometries on first load
    if (!cachedGeography || !cachedRiverNetwork || !cachedLakes) {
      const [geoRes, riverRes, lakesRes, normalsRes] = await Promise.all([
        fetch(`./data/geography.json?t=${t}`),
        fetch(`./data/river_network.json?t=${t}`),
        fetch(`./data/lakes.geojson?t=${t}`),
        fetch(`./data/historical_normals.json?t=${t}`).catch(() => null)
      ]);
      cachedGeography = await geoRes.json();
      cachedRiverNetwork = await riverRes.json();
      cachedLakes = await lakesRes.json();
      if (normalsRes) cachedNormals = await normalsRes.json();
      renderGeography(cachedGeography, cachedRiverNetwork, cachedLakes);
    }

    const metrics = await metricsPromise;

    // 3. Immediately render cached metrics on map layers
    applyLiveHydrology(cachedRiverNetwork, metrics);
    renderMetrics(metrics);
    renderFlowHealthLayer(cachedRiverNetwork, metrics);
    updateBadgePlacements();

    const initialDateStr = formatTimestamp(metrics.fetched_at);
    if (syncElem) syncElem.textContent = `Telemetry Snapshot (${initialDateStr})`;

    // 4. In background (or when user clicks Reload), query live USGS & CDWR directly from browser
    Promise.allSettled([fetchLiveUSGS(), fetchLiveCDWR()]).then(results => {
      let anyUpdated = false;
      const [usgsRes, cdwrRes] = results;

      if (usgsRes.status === "fulfilled" && usgsRes.value) {
        const live = usgsRes.value;
        if (live.streamflows && live.streamflows.length > 0) {
          metrics.streamflows = live.streamflows;
          anyUpdated = true;
        }
        if (live.aac) {
          const cIdx = (metrics.canals || []).findIndex(c => c.id === "09527700");
          if (cIdx !== -1) {
            metrics.canals[cIdx].flow_cfs = live.aac.flow_cfs;
            metrics.canals[cIdx].timestamp = live.aac.timestamp;
            anyUpdated = true;
          }
        }
        if (live.reservoirs) {
          for (const [rId, rData] of Object.entries(live.reservoirs)) {
            const rObj = (metrics.reservoirs || []).find(r => r.id === rId);
            if (rObj) {
              if (rData.storage_af !== undefined) {
                rObj.storage_af = rData.storage_af;
                if (rObj.capacity_af) {
                  rObj.capacity_pct = Number(((rObj.storage_af / rObj.capacity_af) * 100).toFixed(1));
                }
              }
              if (rData.elevation_ft !== undefined) {
                rObj.elevation_ft = rData.elevation_ft;
              }
              if (rData.timestamp) {
                rObj.timestamp = rData.timestamp;
              }
              anyUpdated = true;
            }
          }
        }
      }

      if (cdwrRes.status === "fulfilled" && cdwrRes.value) {
        const cdwr = cdwrRes.value;
        if (cdwr.tunnels) {
          for (const [tunId, tunData] of Object.entries(cdwr.tunnels)) {
            const tObj = (metrics.tunnels || []).find(t => t.id === tunId);
            if (tObj) {
              tObj.flow_cfs = tunData.flow_cfs;
              tObj.timestamp = tunData.timestamp;
              anyUpdated = true;
            }
          }
        }
        if (cdwr.reservoirs) {
          for (const [rId, rData] of Object.entries(cdwr.reservoirs)) {
            const rObj = (metrics.reservoirs || []).find(r => r.id === rId);
            if (rObj) {
              if (rData.storage_af !== undefined && rData.storage_af > 0) {
                rObj.storage_af = rData.storage_af;
                if (rObj.capacity_af) {
                  rObj.capacity_pct = Number(((rObj.storage_af / rObj.capacity_af) * 100).toFixed(1));
                }
              }
              if (rData.elev_val !== undefined) {
                const elev = rData.elev_val;
                const isStage = elev > 0 && elev < 500;
                if (isStage) {
                  rObj.stage_ft = Math.round(elev * 10) / 10;
                  if (rObj.full_pool_elev) {
                    rObj.elevation_ft = Math.round((rObj.full_pool_elev - (126.0 - elev)) * 10) / 10;
                    rObj.feet_below_full = Math.round((rObj.full_pool_elev - rObj.elevation_ft) * 10) / 10;
                  }
                } else if (elev > 500) {
                  rObj.elevation_ft = Math.round(elev * 10) / 10;
                  if (rObj.full_pool_elev) {
                    rObj.feet_below_full = Math.round((rObj.full_pool_elev - rObj.elevation_ft) * 10) / 10;
                  }
                }
              }
              if (rData.timestamp) {
                rObj.timestamp = rData.timestamp;
              }
              anyUpdated = true;
            }
          }
        }
      }

      if (anyUpdated) {
        metrics.fetched_at = new Date().toISOString();
        applyLiveHydrology(cachedRiverNetwork, metrics);
        renderMetrics(metrics);
        updateBadgePlacements();
        populateTelemetryTable(metrics);
        updateSidebar(metrics);
        const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (syncElem) syncElem.textContent = `Live Telemetry (Synced ${timeNow})`;
      }
    }).catch(liveErr => {
      console.warn("Live telemetry query fell back to snapshot:", liveErr);
    });

  } catch (error) {
    console.error("Error loading water dashboard data:", error);
    if (syncElem) syncElem.textContent = "Telemetry Snapshot (Offline)";
  }
}

function formatTimestamp(isoString) {
  if (!isoString) return "Today";
  try {
    // If it's a date-only string like "2026-09-30", parse with local midday to prevent UTC day-rollback
    if (/^\d{4}-\d{2}-\d{2}$/.test(isoString)) {
      const [y, m, d] = isoString.split('-').map(Number);
      const dateObj = new Date(y, m - 1, d, 12, 0, 0);
      return dateObj.toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      }) + " (Daily Close)";
    }
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "Today";
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
    });
  } catch (e) {
    return "Today";
  }
}

// ─── Authoritative Water Data Portal Link Helper ────────────────────────────
function getPortalInfo(item) {
  if (!item) return null;
  const id = String(item.id || item.gauge_id || item.station_id || '');
  const name = String(item.name || '').toLowerCase();

  // Specific Canal Names & Stations
  if (id === '09527700' || name.includes('all-american')) {
    return {
      name: 'USGS National Water Information System',
      url: 'https://waterdata.usgs.gov/monitoring-location/09527700/',
      label: 'USGS All-American Canal Station #09527700'
    };
  }
  if (id === '09424150' || name.includes('colorado river aqueduct')) {
    return {
      name: 'USGS National Water Information System',
      url: 'https://waterdata.usgs.gov/monitoring-location/09424150/',
      label: 'USGS Colorado River Aqueduct Station #09424150'
    };
  }
  if (id === '09426650' || name.includes('central arizona project') || name.includes('cap')) {
    return {
      name: 'USGS National Water Information System',
      url: 'https://waterdata.usgs.gov/monitoring-location/09426650/',
      label: 'USGS Central Arizona Project Station #09426650'
    };
  }

  // 1. USGS Real-Time Streamflow & Canal Gauges (8-digit USGS station number)
  if (/^\d{8}$/.test(id)) {
    return {
      name: 'USGS National Water Information System',
      url: `https://waterdata.usgs.gov/monitoring-location/${id}/`,
      label: `USGS Station #${id}`
    };
  }

  // 2. Colorado DWR / CDSS Trans-Mountain Tunnels & Surface Stations
  if (id.endsWith('CO') || id.endsWith('TUNCO') || id.endsWith('DIVCO') || name.includes('front range tunnels') || name.includes('trans-mountain')) {
    const stationId = (id.endsWith('CO') || id.endsWith('TUNCO') || id.endsWith('DIVCO')) ? id : 'ROBTUNCO';
    return {
      name: 'Colorado DWR / CDSS Surface Water Portal',
      url: `https://dwr.state.co.us/Tools/Stations?station=${encodeURIComponent(stationId)}`,
      label: `CDSS Telemetry #${stationId}`
    };
  }

  // 3. Major Storage Reservoirs
  const resUrls = {
    lake_powell: {
      name: 'USBR Upper Colorado Water Operations',
      url: 'https://www.usbr.gov/uc/water/crsp/cs/gcd.html',
      label: 'USBR Glen Canyon / Lake Powell Portal'
    },
    lake_mead: {
      name: 'USBR Lower Colorado River Operations',
      url: 'https://www.usbr.gov/lc/region/g4000/hourly/mead-elv.html',
      label: 'USBR Hoover Dam / Lake Mead Portal'
    },
    flaming_gorge: {
      name: 'USBR Water Operations',
      url: 'https://www.usbr.gov/uc/water/hydrodata/reservoir_data/917/dashboard.html',
      label: 'USBR Flaming Gorge Reservoir Dashboard'
    },
    navajo_reservoir: {
      name: 'USBR Water Operations',
      url: 'https://www.usbr.gov/uc/water/hydrodata/reservoir_data/924/dashboard.html',
      label: 'USBR Navajo Reservoir Dashboard'
    },
    lake_mohave: {
      name: 'USBR Lower Colorado River Operations',
      url: 'https://www.usbr.gov/lc/region/g4000/hourly/mohave-elv.html',
      label: 'USBR Lake Mohave / Davis Dam Portal'
    },
    blue_mesa: {
      name: 'USBR Water Operations',
      url: 'https://www.usbr.gov/uc/water/hydrodata/reservoir_data/913/dashboard.html',
      label: 'USBR Blue Mesa Reservoir Dashboard'
    },
    lake_havasu: {
      name: 'USBR Lower Colorado River Operations',
      url: 'https://www.usbr.gov/lc/region/g4000/hourly/havasu-elv.html',
      label: 'USBR Lake Havasu / Parker Dam Portal'
    },
    dillon_reservoir: {
      name: 'Denver Water Operations',
      url: 'https://www.denverwater.org/recreation/dillon-reservoir',
      label: 'Denver Water Dillon Reservoir'
    },
    lake_granby: {
      name: 'Northern Water / USBR C-BT Project',
      url: 'https://www.northernwater.org/what-we-do/deliver-water/c-bt-project',
      label: 'Northern Water C-BT Granby Portal'
    },
    green_mountain: {
      name: 'USBR Water Operations',
      url: 'https://www.usbr.gov/uc/water/hydrodata/reservoir_data/923/dashboard.html',
      label: 'USBR Green Mountain Reservoir Dashboard'
    },
    homestake_reservoir: {
      name: 'Colorado DWR / CDSS Stations',
      url: 'https://dwr.state.co.us/Tools/Stations?station=HOMRESCO',
      label: 'CDSS Homestake Reservoir Portal'
    }
  };
  if (resUrls[id]) return resUrls[id];

  // 4. Major Storage Dams
  const damUrls = {
    hoover_dam: {
      name: 'USBR Hoover Dam Operations',
      url: 'https://www.usbr.gov/lc/hooverdam/',
      label: 'USBR Hoover Dam Official Portal'
    },
    glen_canyon_dam: {
      name: 'USBR Glen Canyon Dam Operations',
      url: 'https://www.usbr.gov/uc/rm/crsp/gc/',
      label: 'USBR Glen Canyon Dam Official Portal'
    },
    parker_dam: {
      name: 'USBR Parker-Davis Project',
      url: 'https://www.usbr.gov/lc/region/g4000/hourly/havasu-elv.html',
      label: 'USBR Parker Dam / Lake Havasu'
    },
    imperial_dam: {
      name: 'USBR Yuma Area Office',
      url: 'https://www.usbr.gov/lc/yuma/',
      label: 'USBR Imperial Dam & Desilting Works'
    },
    green_mountain_dam: {
      name: 'USBR Colorado-Big Thompson Project',
      url: 'https://www.usbr.gov/projects/index.php?id=391',
      label: 'USBR Green Mountain Dam'
    },
    dillon_dam: {
      name: 'Denver Water Operations',
      url: 'https://www.denverwater.org/recreation/dillon-reservoir',
      label: 'Denver Water Dillon Dam'
    },
    granby_dam: {
      name: 'Northern Water C-BT Project',
      url: 'https://www.northernwater.org/what-we-do/deliver-water/c-bt-project',
      label: 'Northern Water Granby Dam'
    },
    ruedi_dam: {
      name: 'USBR Fryingpan-Arkansas Project',
      url: 'https://www.usbr.gov/projects/index.php?id=336',
      label: 'USBR Ruedi Dam'
    },
    homestake_dam: {
      name: 'Aurora Water / Colorado Springs Utilities',
      url: 'https://dwr.state.co.us/Tools/Stations?station=HOMRESCO',
      label: 'CDSS Homestake Dam Portal'
    },
    flaming_gorge_dam: {
      name: 'USBR CRSP Flaming Gorge Unit',
      url: 'https://www.usbr.gov/uc/water/crsp/cs/fgd.html',
      label: 'USBR Flaming Gorge Dam'
    },
    navajo_dam: {
      name: 'USBR CRSP Navajo Unit',
      url: 'https://www.usbr.gov/uc/water/crsp/cs/nvd.html',
      label: 'USBR Navajo Dam'
    },
    davis_dam: {
      name: 'USBR Parker-Davis Project',
      url: 'https://www.usbr.gov/lc/region/g4000/hourly/mohave-elv.html',
      label: 'USBR Davis Dam / Lake Mohave'
    },
    morelos_dam: {
      name: 'International Boundary & Water Commission (IBWC)',
      url: 'https://www.ibwc.gov/',
      label: 'IBWC / CILA Morelos Dam Deliveries'
    },
    blue_mesa_dam: {
      name: 'USBR Aspinall Unit',
      url: 'https://www.usbr.gov/uc/rm/crsp/gunnison/',
      label: 'USBR Blue Mesa Dam'
    },
    mcphee_dam: {
      name: 'USBR Dolores Project',
      url: 'https://www.usbr.gov/projects/index.php?id=381',
      label: 'USBR McPhee Dam'
    },
    theodore_roosevelt_dam: {
      name: 'Salt River Project (SRP) Water Operations',
      url: 'https://www.srpnet.com/water-irrigation/water-operations',
      label: 'SRP Roosevelt Dam Operations'
    }
  };
  if (damUrls[id]) return damUrls[id];

  // Fuzzy match reservoir/dam names
  if (name.includes('powell')) return resUrls.lake_powell;
  if (name.includes('mead')) return resUrls.lake_mead;
  if (name.includes('flaming gorge')) return resUrls.flaming_gorge;
  if (name.includes('navajo')) return resUrls.navajo_reservoir;
  if (name.includes('mohave')) return resUrls.lake_mohave;
  if (name.includes('blue mesa')) return resUrls.blue_mesa;
  if (name.includes('havasu')) return resUrls.lake_havasu;
  if (name.includes('dillon')) return resUrls.dillon_reservoir;
  if (name.includes('granby')) return resUrls.lake_granby;
  if (name.includes('green mountain')) return resUrls.green_mountain;
  if (name.includes('homestake')) return resUrls.homestake_reservoir;

  return null;
}

function formatPortalHtml(portal, accentColor = '#0284c7') {
  if (!portal) return '';
  return `
    <div style="margin-top:8px; padding-top:6px; border-top:1px solid #e2e8f0; font-size:11px; line-height:1.4;">
      <span style="color:#64748b; font-weight:600;">Data Portal:</span> 
      <a href="${portal.url}" target="_blank" rel="noopener" style="color:${accentColor}; text-decoration:none; font-weight:700; display:inline-flex; align-items:center; gap:2px;">
        ${portal.label} <span style="font-size:10px;">↗</span>
      </a>
    </div>
  `;
}

function renderGeography(geo, riverNetwork, lakes) {
  // 1. Basin Boundaries (Upper vs Lower)
  const basinsGeoJSON = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: 'Upper Colorado River Basin (WY, CO, UT, NM)', fill: '#f59e0b', color: '#0284c7' },
        geometry: { type: 'Polygon', coordinates: [geo.upper_basin_outline] }
      },
      {
        type: 'Feature',
        properties: { name: 'Lower Colorado River Basin (NV, AZ, CA)', fill: '#ea580c', color: '#b45309' },
        geometry: { type: 'Polygon', coordinates: [geo.lower_basin_outline] }
      }
    ]
  };

  if (!map.getSource('basins')) {
    map.addSource('basins', { type: 'geojson', data: basinsGeoJSON });
    map.addLayer({
      id: 'basin-line',
      type: 'line',
      source: 'basins',
      paint: {
        'line-color': '#ffffff',
        'line-width': 2.5,
        'line-dasharray': [3, 4],
        'line-opacity': 0.95
      }
    });

    map.addLayer({
      id: 'basin-line-hit-buffer',
      type: 'line',
      source: 'basins',
      paint: {
        'line-color': '#000000',
        'line-width': 24,
        'line-opacity': 0.0001
      }
    });

    // Only the perimeter boundary line itself is interactive, NOT the vast interior fill polygon
    map.on('mousemove', 'basin-line-hit-buffer', (e) => {
      if (!e.features.length) return;
      map.getCanvas().style.cursor = 'pointer';
      tooltipPopup.setLngLat(e.lngLat).setHTML(`<strong>${e.features[0].properties.name} Boundary</strong>`).addTo(map);
    });
    map.on('mouseleave', 'basin-line-hit-buffer', () => {
      map.getCanvas().style.cursor = '';
      tooltipPopup.remove();
    });
  }

  // 2. Continental Divide Line
  const divideGeoJSON = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: 'Continental Divide of the Americas' },
        geometry: { type: 'LineString', coordinates: geo.continental_divide }
      }
    ]
  };

  if (!map.getSource('divide')) {
    map.addSource('divide', { type: 'geojson', data: divideGeoJSON });
    map.addLayer({
      id: 'divide-line',
      type: 'line',
      source: 'divide',
      layout: {
        'line-cap': 'round',
        'line-join': 'round'
      },
      paint: {
        'line-color': '#b45309',
        'line-width': 2.2,
        'line-dasharray': [1.5, 3],
        'line-opacity': 0.9
      }
    });

    map.addLayer({
      id: 'divide-line-hit-buffer',
      type: 'line',
      source: 'divide',
      paint: {
        'line-color': '#000000',
        'line-width': 24,
        'line-opacity': 0.0001
      }
    });

    map.on('mousemove', 'divide-line-hit-buffer', (e) => {
      map.getCanvas().style.cursor = 'pointer';
      tooltipPopup.setLngLat(e.lngLat).setHTML(`<strong>Continental Divide of the Americas</strong><br><span style="font-size:11px;color:#64748b;">Hydrologic Boundary between Pacific & Atlantic Slopes</span>`).addTo(map);
    });
    map.on('mouseleave', 'divide-line-hit-buffer', () => {
      map.getCanvas().style.cursor = '';
      tooltipPopup.remove();
    });
  }

  // 3. Lakes & Reservoirs (USGS NHD Shorelines)
  if (lakes && lakes.features && !map.getSource('lakes')) {
    map.addSource('lakes', { type: 'geojson', data: lakes });
    map.addLayer({
      id: 'lakes-fill',
      type: 'fill',
      source: 'lakes',
      paint: {
        'fill-color': '#0284c7',
        'fill-opacity': 0.85
      }
    });
    map.addLayer({
      id: 'lakes-stroke',
      type: 'line',
      source: 'lakes',
      paint: {
        'line-color': '#0369a1',
        'line-width': 1.5
      }
    });

    map.on('mousemove', 'lakes-fill', (e) => {
      if (!e.features.length) return;
      map.getCanvas().style.cursor = 'pointer';
      const p = e.features[0].properties;
      const name = p.GNIS_NAME || p.name || "Reservoir";
      const matchRes = activeMetrics?.reservoirs?.find(r => 
        r.name.toLowerCase().includes(name.toLowerCase()) || 
        name.toLowerCase().includes(r.name.split('(')[0].trim().toLowerCase())
      );
      if (matchRes) {
        tooltipPopup.setLngLat(e.lngLat).setHTML(`
          <div style="font-family:'Inter',sans-serif; min-width:200px;">
            <span style="font-size:10px; font-weight:700; color:#0369a1; background:#e0f2fe; padding:2px 6px; border-radius:4px; display:inline-block; margin-bottom:4px;">Major Storage Reservoir</span>
            <strong style="font-size:13px; color:#0f172a; display:block;">${matchRes.name}</strong>
            <div style="margin: 6px 0; padding: 6px 8px; background:#f8fafc; border-radius:6px; border:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:baseline;">
              <span style="font-size:11px; color:#475569; font-weight:600;">Current Storage:</span>
              <span style="font-size:15px; font-weight:800; color:#0284c7;">${matchRes.capacity_pct}% <span style="font-size:11px; font-weight:600; color:#64748b;">Full</span></span>
            </div>
            <div style="font-size:11px; color:#475569; line-height:1.4;">
              <strong>Storage:</strong> ${(matchRes.storage_af / 1e6).toFixed(2)}M Acre-Feet<br>
              <strong>Elevation:</strong> ${matchRes.elevation_ft ? matchRes.elevation_ft.toLocaleString() + ' ft' : 'USBR Telemetry'}<br>
              <strong>Role:</strong> ${matchRes.role || 'Basin Storage'}
            </div>
          </div>
        `).addTo(map);
      } else {
        const area = p.AREASQKM ? `${Math.round(p.AREASQKM)} sq km` : "";
        tooltipPopup.setLngLat(e.lngLat).setHTML(`<strong>${name}</strong><br><span style="font-size:11px;color:#64748b;">USGS NHD Shoreline (${area})</span>`).addTo(map);
      }
    });

    map.on('mouseleave', 'lakes-fill', () => {
      map.getCanvas().style.cursor = '';
      tooltipPopup.remove();
    });

    map.on('click', 'lakes-fill', (e) => {
      if (!e.features.length) return;
      const p = e.features[0].properties;
      const name = p.GNIS_NAME || p.name || "Reservoir";
      const matchRes = activeMetrics?.reservoirs?.find(r => 
        r.name.toLowerCase().includes(name.toLowerCase()) || 
        name.toLowerCase().includes(r.name.split('(')[0].trim().toLowerCase())
      );
      const portal = getPortalInfo(matchRes || { name: name });
      if (matchRes) {
        new maplibregl.Popup({ offset: 8 })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="font-family:'Inter',sans-serif; min-width:220px; padding:2px;">
              <span style="font-size:10px; font-weight:700; color:#0369a1; background:#e0f2fe; padding:2px 6px; border-radius:4px; display:inline-block; margin-bottom:4px;">Major Storage Reservoir</span>
              <strong style="font-size:14px; color:#0f172a; display:block;">${matchRes.name}</strong>
              <span style="font-size:11px; color:#64748b; font-weight:600;">${matchRes.river || ''}</span>
              <div style="margin: 8px 0; padding: 8px 10px; background:#f8fafc; border-radius:6px; border:1px solid #e2e8f0;">
                <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px;">
                  <span style="font-size:11px; color:#475569; font-weight:600;">Current Storage:</span>
                  <span style="font-size:16px; font-weight:800; color:#0284c7;">${matchRes.capacity_pct}% <span style="font-size:11px; font-weight:600; color:#64748b;">Full</span></span>
                </div>
                <div style="height:6px; background:#e2e8f0; border-radius:3px; overflow:hidden;">
                  <div style="width:${Math.min(100, matchRes.capacity_pct)}%; height:100%; background:${matchRes.capacity_pct < 25 ? '#ef4444' : (matchRes.capacity_pct < 50 ? '#f59e0b' : '#0891b2')};"></div>
                </div>
              </div>
              <div style="font-size:11.5px; color:#334155; line-height:1.5;">
                <strong>Elevation:</strong> ${matchRes.elevation_ft ? matchRes.elevation_ft.toLocaleString() + ' ft' : 'USBR'}<br>
                <strong>Volume Stored:</strong> ${Math.round(matchRes.storage_af).toLocaleString()} Acre-Feet<br>
                <strong>Active Capacity:</strong> ${Math.round(matchRes.capacity_af || 0).toLocaleString()} Acre-Feet<br>
                <strong>Operational Role:</strong> ${matchRes.role || 'Basin Storage'}
              </div>
              ${formatPortalHtml(portal, '#0284c7')}
            </div>
          `)
          .addTo(map);
      } else {
        const area = p.AREASQKM ? `${Math.round(p.AREASQKM)} sq km` : "";
        new maplibregl.Popup({ offset: 8 })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="font-family:'Inter',sans-serif; min-width:190px; padding:2px;">
              <strong style="font-size:13px; color:#0f172a; display:block;">${name}</strong>
              <span style="font-size:11px; color:#64748b;">USGS NHD Shoreline ${area ? '(' + area + ')' : ''}</span>
              ${formatPortalHtml(portal, '#0284c7')}
            </div>
          `)
          .addTo(map);
      }
    });
  }

  // 4. CFS-Weighted River Network (Shapely-Welded Continuous Vectors)
  if (riverNetwork && !map.getSource('rivers')) {
    map.addSource('rivers', { type: 'geojson', data: riverNetwork });

    // 4a. Mainstem - Outer Glow
    map.addLayer({
      id: 'rivers-mainstem-glow',
      type: 'line',
      source: 'rivers',
      filter: ['==', ['get', 'category'], 'mainstem'],
      paint: {
        'line-color': '#38bdf8',
        'line-width': ['+', ['get', 'weight'], 2.0],
        'line-blur': 1.5,
        'line-opacity': 0.65
      }
    });
    // 4b. Mainstem - Core Flowline
    map.addLayer({
      id: 'rivers-mainstem-core',
      type: 'line',
      source: 'rivers',
      filter: ['==', ['get', 'category'], 'mainstem'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#0284c7',
        'line-width': ['get', 'weight'],
        'line-opacity': 0.95
      }
    });
    // Mainstem Hit Buffer
    map.addLayer({
      id: 'rivers-mainstem-hit',
      type: 'line',
      source: 'rivers',
      filter: ['==', ['get', 'category'], 'mainstem'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#000000', 'line-width': 24, 'line-opacity': 0.0001 }
    });

    // Major Tributaries
    map.addLayer({
      id: 'rivers-major-glow',
      type: 'line',
      source: 'rivers',
      filter: ['==', ['get', 'category'], 'major_tributary'],
      paint: {
        'line-color': '#38bdf8',
        'line-width': ['+', ['get', 'weight'], 2.0],
        'line-blur': 1.5,
        'line-opacity': 0.65
      }
    });
    map.addLayer({
      id: 'rivers-major-core',
      type: 'line',
      source: 'rivers',
      filter: ['==', ['get', 'category'], 'major_tributary'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#0284c7',
        'line-width': ['get', 'weight'],
        'line-opacity': 0.95
      }
    });
    map.addLayer({
      id: 'rivers-major-hit',
      type: 'line',
      source: 'rivers',
      filter: ['==', ['get', 'category'], 'major_tributary'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#000000', 'line-width': 24, 'line-opacity': 0.0001 }
    });

    // Secondary Minor Tributaries
    map.addLayer({
      id: 'rivers-minor-glow',
      type: 'line',
      source: 'rivers',
      filter: ['==', ['get', 'category'], 'minor_tributary'],
      paint: {
        'line-color': '#38bdf8',
        'line-width': ['+', ['get', 'weight'], 0.8],
        'line-blur': 0.8,
        'line-opacity': 0.35
      }
    });
    map.addLayer({
      id: 'rivers-minor-core',
      type: 'line',
      source: 'rivers',
      filter: ['==', ['get', 'category'], 'minor_tributary'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#0284c7',
        'line-width': ['get', 'weight'],
        'line-opacity': 0.65
      }
    });
    map.addLayer({
      id: 'rivers-minor-hit',
      type: 'line',
      source: 'rivers',
      filter: ['==', ['get', 'category'], 'minor_tributary'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#000000', 'line-width': 24, 'line-opacity': 0.0001 }
    });

    // River hover tooltips & click handlers attached to the generous hit buffer
    ['rivers-mainstem-hit', 'rivers-major-hit', 'rivers-minor-hit'].forEach(layerId => {
      map.on('mousemove', layerId, (e) => {
        if (!e.features.length) return;
        map.getCanvas().style.cursor = 'pointer';
        const p = e.features[0].properties;
        const catBadge = p.category === 'mainstem'
          ? '<span style="font-size:10px;font-weight:700;color:#0284c7;background:#e0f2fe;padding:2px 6px;border-radius:4px;">Mainstem Reach</span>'
          : (p.category === 'major_tributary'
              ? '<span style="font-size:10px;font-weight:700;color:#0284c7;background:#f0f9ff;padding:2px 6px;border-radius:4px;">Major Tributary</span>'
              : '<span style="font-size:10px;font-weight:600;color:#0284c7;background:#f1f5f9;padding:2px 6px;border-radius:4px;">Secondary Stream</span>');

        const sourceBadge = p.source_label ? `<div style="font-size:10px;font-weight:700;color:#0369a1;background:#f0f9ff;border:1px solid #bae6fd;padding:2px 6px;border-radius:4px;display:inline-block;margin-top:4px;">${p.source_label}</div>` : '';
        const stationHtml = p.gauge_info ? `<div style="font-size:11px;color:#475569;margin-top:4px;line-height:1.35;"><strong>Control / Station:</strong> ${p.gauge_info}</div>` : '';
        const timeHtml = p.timestamp ? `<div style="font-size:10px;color:#64748b;margin-top:2px;"><strong>Measured:</strong> ${formatTimestamp(p.timestamp)}</div>` : '';
        const notesHtml = p.notes && p.notes !== p.gauge_info ? `<div style="font-size:11px;color:#64748b;margin-top:4px;line-height:1.35;">${p.notes}</div>` : '';

        // Flow health vs historical normal
        const gaugeId = p.gauge_id;
        const norm = p.hist_normal_cfs ? Number(p.hist_normal_cfs) : (gaugeId ? getHistoricalNormal(gaugeId) : null);
        let healthHtml = '';
        if (norm && norm > 0 && p.flow_cfs != null) {
          const pct = p.health_pct != null ? Number(p.health_pct) : Math.round((Number(p.flow_cfs) / norm) * 100);
          const color = p.health_color || flowHealthColor(pct);
          const label = p.health_label || flowHealthLabel(pct);
          healthHtml = `<div style="margin-top:6px;padding:5px 8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:10px;color:#64748b;font-weight:600;">vs. Hist. Daily Avg</span>
            <span style="font-size:13px;font-weight:800;color:${color};">${pct}% <span style="font-size:10px;font-weight:600;">(${label})</span></span>
          </div>
          <div style="margin-top:3px;font-size:10px;color:#94a3b8;">Avg today: ${Math.round(norm).toLocaleString()} cfs (${new Date().getFullYear()-50}–${new Date().getFullYear()-1} mean)</div>`;
        }

        tooltipPopup.setLngLat(e.lngLat).setHTML(`
          <div style="font-family:'Inter',sans-serif; min-width: 190px; max-width: 270px;">
            <div style="margin-bottom:4px;">${catBadge}</div>
            <strong style="font-size:13px;color:#0f172a;line-height:1.35;display:block;">${p.name}</strong>
            <div style="margin: 6px 0; padding: 6px 10px; background:#f8fafc; border-radius:6px; border:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:baseline;">
              <span style="font-size:11px; color:#64748b; font-weight:600;">Streamflow:</span>
              <span style="font-size:16px; font-weight:800; color:#0284c7;">${Number(p.flow_cfs).toLocaleString()} <span style="font-size:10px; font-weight:600; color:#64748b;">cfs</span></span>
            </div>
            ${sourceBadge}
            ${stationHtml}
            ${healthHtml}
            <div style="font-size:10.5px;color:#64748b;margin-top:6px;border-top:1px solid #e2e8f0;padding-top:5px;">
              <strong>Classification:</strong> ${Number(p.flow_cfs) >= 5000 ? 'High Flow Mainstem (> 5,000 cfs)' : (Number(p.flow_cfs) >= 1000 ? 'Major River / Tributary (1,000 – 5,000 cfs)' : 'Secondary Stream / Headwaters (< 1,000 cfs)')}
            </div>
            ${notesHtml}
          </div>
        `).addTo(map);
      });

      map.on('mouseleave', layerId, () => {
        map.getCanvas().style.cursor = '';
        tooltipPopup.remove();
      });

      map.on('click', layerId, (e) => {
        if (!e.features.length) return;
        const p = e.features[0].properties;
        const gaugeId = p.gauge_id;
        const portal = getPortalInfo({ id: gaugeId, name: p.name });
        const catBadge = p.category === 'mainstem'
          ? '<span style="font-size:10px;font-weight:700;color:#0284c7;background:#e0f2fe;padding:2px 6px;border-radius:4px;">Mainstem Reach</span>'
          : (p.category === 'major_tributary'
              ? '<span style="font-size:10px;font-weight:700;color:#0284c7;background:#f0f9ff;padding:2px 6px;border-radius:4px;">Major Tributary</span>'
              : '<span style="font-size:10px;font-weight:600;color:#0284c7;background:#f1f5f9;padding:2px 6px;border-radius:4px;">Secondary Stream</span>');

        const sourceBadge = p.source_label ? `<div style="font-size:10px;font-weight:700;color:#0369a1;background:#f0f9ff;border:1px solid #bae6fd;padding:2px 6px;border-radius:4px;display:inline-block;margin-top:4px;">${p.source_label}</div>` : '';
        const stationHtml = p.gauge_info ? `<div style="font-size:11px;color:#475569;margin-top:4px;line-height:1.35;"><strong>Control / Station:</strong> ${p.gauge_info}</div>` : '';
        const timeHtml = p.timestamp ? `<div style="font-size:10px;color:#64748b;margin-top:2px;"><strong>Measured:</strong> ${formatTimestamp(p.timestamp)}</div>` : '';
        const notesHtml = p.notes && p.notes !== p.gauge_info ? `<div style="font-size:11px;color:#64748b;margin-top:4px;line-height:1.35;">${p.notes}</div>` : '';

        const norm = p.hist_normal_cfs ? Number(p.hist_normal_cfs) : (gaugeId ? getHistoricalNormal(gaugeId) : null);
        let healthHtml = '';
        if (norm && norm > 0 && p.flow_cfs != null) {
          const pct = p.health_pct != null ? Number(p.health_pct) : Math.round((Number(p.flow_cfs) / norm) * 100);
          const color = p.health_color || flowHealthColor(pct);
          const label = p.health_label || flowHealthLabel(pct);
          healthHtml = `<div style="margin-top:6px;padding:5px 8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:10px;color:#64748b;font-weight:600;">vs. Hist. Daily Avg</span>
            <span style="font-size:13px;font-weight:800;color:${color};">${pct}% <span style="font-size:10px;font-weight:600;">(${label})</span></span>
          </div>
          <div style="margin-top:3px;font-size:10px;color:#94a3b8;">Avg today: ${Math.round(norm).toLocaleString()} cfs (${new Date().getFullYear()-50}–${new Date().getFullYear()-1} mean)</div>`;
        }

        new maplibregl.Popup({ offset: 10 })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="font-family:'Inter',sans-serif; min-width: 220px; max-width: 280px; padding:2px;">
              <div style="margin-bottom:4px;">${catBadge}</div>
              <strong style="font-size:13.5px;color:#0f172a;line-height:1.35;display:block;">${p.name}</strong>
              <div style="margin: 6px 0; padding: 6px 10px; background:#f8fafc; border-radius:6px; border:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:baseline;">
                <span style="font-size:11px; color:#64748b; font-weight:600;">Streamflow:</span>
                <span style="font-size:16px; font-weight:800; color:#0284c7;">${Number(p.flow_cfs).toLocaleString()} <span style="font-size:10px; font-weight:600; color:#64748b;">cfs</span></span>
              </div>
              ${sourceBadge}
              ${stationHtml}
              ${healthHtml}
              ${timeHtml}
              ${notesHtml}
              ${formatPortalHtml(portal, '#0284c7')}
            </div>
          `)
          .addTo(map);
      });
    });
  }

  // 5. Trans-Mountain Tunnels & Conveyance Canals (Separate Layers)
  if (geo.tunnels) {
    const tunnelFeats = geo.tunnels.filter(t => t.id && t.id.endsWith("TUNCO"));
    const canalFeats = geo.tunnels.filter(t => !t.id || !t.id.endsWith("TUNCO"));

    // 5a. Trans-Mountain Tunnels under Divide
    if (!map.getSource('tunnels')) {
      const tunnelLineFeats = [];
      const tunnelPortalFeats = [];

      tunnelFeats.forEach(t => {
        const metric = cachedMetrics?.tunnels?.find(m => m.id === t.id);
        const flow = metric ? metric.flow_cfs : (t.flow_cfs || 0);
        const cap = t.capacity_cfs || (t.id === 'MOFTUNCO' ? 1280 : (t.id === 'BOUTUNCO' ? 945 : 1020));

        tunnelLineFeats.push({
          type: 'Feature',
          properties: {
            ...t,
            flow_cfs: flow,
            capacity_cfs: cap,
            timestamp: metric ? metric.timestamp : null
          },
          geometry: { type: 'LineString', coordinates: t.coords }
        });

        if (t.coords && t.coords.length >= 2) {
          tunnelPortalFeats.push({
            type: 'Feature',
            properties: {
              ...t,
              flow_cfs: flow,
              capacity_cfs: cap,
              portal_name: `West Slope Intake (${t.from})`,
              portal_type: 'intake'
            },
            geometry: { type: 'Point', coordinates: t.coords[0] }
          });
          tunnelPortalFeats.push({
            type: 'Feature',
            properties: {
              ...t,
              flow_cfs: flow,
              capacity_cfs: cap,
              portal_name: `Front Range Outlet (${t.to})`,
              portal_type: 'outlet'
            },
            geometry: { type: 'Point', coordinates: t.coords[t.coords.length - 1] }
          });
        }
      });

      map.addSource('tunnels', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: tunnelLineFeats }
      });

      map.addSource('tunnel-portals', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: tunnelPortalFeats }
      });

      const showTunnels = document.getElementById('toggle-tunnels')?.checked ?? true;

      // 1. Dark contrast casing under-stroke: guarantees tunnel lines stand out over any terrain/basemap
      map.addLayer({
        id: 'tunnels-casing',
        type: 'line',
        source: 'tunnels',
        layout: {
          'visibility': showTunnels ? 'visible' : 'none',
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': '#0f172a', /* Dark slate casing */
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            5, ['+', ['*', ['get', 'flow_cfs'], 0.005], 3],
            8, ['+', ['*', ['get', 'flow_cfs'], 0.008], 4],
            12, ['+', ['*', ['get', 'flow_cfs'], 0.012], 6]
          ],
          'line-opacity': 0.8
        }
      });

      // 2. Core solid line in hydrologic blue
      map.addLayer({
        id: 'tunnels-line',
        type: 'line',
        source: 'tunnels',
        layout: {
          'visibility': showTunnels ? 'visible' : 'none',
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': '#0284c7',
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            5, ['+', ['*', ['get', 'flow_cfs'], 0.005], 1.5],
            8, ['+', ['*', ['get', 'flow_cfs'], 0.008], 2.5],
            12, ['+', ['*', ['get', 'flow_cfs'], 0.012], 4]
          ],
          'line-opacity': 1.0
        }
      });

      // 3. Intake and Outlet Portal Markers (Barbell-Type Pipeline Terminals)
      map.addLayer({
        id: 'tunnels-portals-layer',
        type: 'circle',
        source: 'tunnel-portals',
        layout: {
          'visibility': showTunnels ? 'visible' : 'none'
        },
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            5, 4.5,
            8, 6.5,
            12, 8.5
          ],
          'circle-color': '#0284c7',
          'circle-stroke-color': '#0f172a',
          'circle-stroke-width': 2.5,
          'circle-opacity': 1.0
        }
      });

      // 4. Generous 24px hit buffer for tunnels and portals
      map.addLayer({
        id: 'tunnels-hit-buffer',
        type: 'line',
        source: 'tunnels',
        layout: {
          'visibility': showTunnels ? 'visible' : 'none'
        },
        paint: {
          'line-color': '#000000',
          'line-width': 24,
          'line-opacity': 0.0001
        }
      });

      const handleTunnelHover = (e) => {
        if (!e.features.length) return;
        map.getCanvas().style.cursor = 'pointer';
        const t = e.features[0].properties;
        const flowVal = Number(t.flow_cfs || 0);
        const flowDisplay = flowVal > 0 
          ? `<span style="font-size:16px; font-weight:800; color:#0284c7;">${flowVal.toLocaleString()} <span style="font-size:11px; font-weight:600; color:#64748b;">cfs</span></span>`
          : `<span style="font-size:14px; font-weight:700; color:#64748b;">0.0 cfs <span style="font-size:11px; font-weight:500;">(Inactive / Closed)</span></span>`;

        const capDisplay = t.capacity_cfs ? `${Number(t.capacity_cfs).toLocaleString()} cfs` : '1,020 cfs';
        const statusText = flowVal > 0 
          ? (flowVal >= (Number(t.capacity_cfs) || 1000) * 0.8 ? 'Near Peak Trans-Divide Conveyance' : 'Active Trans-Divide Conveyance')
          : 'Gates Closed / Seasonal Low Flow';

        tooltipPopup.setLngLat(e.lngLat).setHTML(`
          <div style="font-family:'Inter',sans-serif; min-width: 220px; max-width: 290px;">
            <div style="display:flex; align-items:center; gap:6px; margin-bottom:5px;">
              <span style="font-size:10px;font-weight:700;color:#0369a1;background:#e0f2fe;border:1px solid #bae6fd;padding:2px 6px;border-radius:4px;">Trans-Mountain Diversion Tunnel</span>
            </div>
            <strong style="font-size:13.5px;color:#0f172a;display:block;">${t.name}</strong>
            <span style="font-size:11px;color:#0284c7;font-weight:600;">${t.operator || ''}</span>
            <div style="margin: 6px 0; padding: 6px 10px; background:#f8fafc; border-radius:6px; border:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:baseline;">
              <span style="font-size:11px; color:#475569; font-weight:600;">Current Diversion:</span>
              ${flowDisplay}
            </div>
            <div style="font-size:11px;line-height:1.45;color:#334155;">
              <strong>Destination:</strong> ${t.destination || t.to}<br>
              <strong>Length:</strong> ${t.length_miles ? t.length_miles + ' miles under Divide' : 'Trans-Continental Divide Tunnel'}<br>
              <strong>West Portal:</strong> ${t.from || 'West Slope Intake'}<br>
              <strong>East Portal:</strong> ${t.to || 'Front Range Outlet'}
            </div>
            <div style="font-size:10.5px;color:#64748b;margin-top:6px;border-top:1px solid #e2e8f0;padding-top:5px;line-height:1.4;">
              <strong>Design Capacity:</strong> ${capDisplay}<br>
              <strong>Operational Status:</strong> ${statusText}
            </div>
          </div>
        `).addTo(map);
      };

      map.on('mousemove', 'tunnels-hit-buffer', handleTunnelHover);
      map.on('mousemove', 'tunnels-portals-layer', handleTunnelHover);

      const handleTunnelLeave = () => {
        map.getCanvas().style.cursor = '';
        tooltipPopup.remove();
      };
      map.on('mouseleave', 'tunnels-hit-buffer', handleTunnelLeave);
      map.on('mouseleave', 'tunnels-portals-layer', handleTunnelLeave);

      const handleTunnelClick = (e) => {
        if (!e.features.length) return;
        const t = e.features[0].properties;
        const flowVal = Number(t.flow_cfs || 0);
        const capDisplay = t.capacity_cfs ? `${Number(t.capacity_cfs).toLocaleString()} cfs` : '1,020 cfs';
        const statusText = flowVal > 0 
          ? (flowVal >= (Number(t.capacity_cfs) || 1000) * 0.8 ? 'Near Peak Trans-Divide Conveyance' : 'Active Trans-Divide Conveyance')
          : 'Gates Closed / Seasonal Low Flow';
        const portal = getPortalInfo(t);

        new maplibregl.Popup({ offset: 8 })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="font-family:'Inter',sans-serif; min-width: 230px;">
              <span style="font-size:10px;font-weight:700;color:#0369a1;background:#e0f2fe;border:1px solid #bae6fd;padding:2px 6px;border-radius:4px;display:inline-block;margin-bottom:4px;">Trans-Mountain Diversion Tunnel</span>
              <strong style="font-size:14px;color:#0f172a;display:block;">${t.name}</strong>
              <span style="font-size:11px;color:#0284c7;font-weight:600;">${t.operator || ''}</span>
              <div style="margin: 8px 0; padding: 6px 10px; background:#f8fafc; border-radius:6px; border:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:baseline;">
                <span style="font-size:11px; color:#475569; font-weight:600;">Current Diversion:</span>
                <span style="font-size:16px; font-weight:800; color:#0284c7;">${flowVal.toLocaleString()} cfs</span>
              </div>
              <div style="font-size:11px;line-height:1.45;color:#334155;">
                <strong>Destination:</strong> ${t.destination || t.to}<br>
                <strong>Length:</strong> ${t.length_miles ? t.length_miles + ' miles under Divide' : 'Trans-Continental Divide'}<br>
                <strong>West Portal:</strong> ${t.from || 'West Slope Intake'}<br>
                <strong>East Portal:</strong> ${t.to || 'Front Range Outlet'}
              </div>
              <div style="font-size:10.5px;color:#64748b;margin-top:6px;border-top:1px solid #e2e8f0;padding-top:5px;line-height:1.4;">
                <strong>Design Capacity:</strong> ${capDisplay}<br>
                <strong>Operational Status:</strong> ${statusText}
              </div>
              ${formatPortalHtml(portal, '#0284c7')}
            </div>
          `)
          .addTo(map);
      };

      map.on('click', 'tunnels-hit-buffer', handleTunnelClick);
      map.on('click', 'tunnels-portals-layer', handleTunnelClick);
    }

    // 5b. Major Conveyance Canals (All-American Canal & Colorado River Aqueduct)
    if (!map.getSource('canals')) {
      const canalsGeoJSON = {
        type: 'FeatureCollection',
        features: canalFeats.map(t => ({
          type: 'Feature',
          properties: { ...t },
          geometry: { type: 'LineString', coordinates: t.coords }
        }))
      };

      map.addSource('canals', { type: 'geojson', data: canalsGeoJSON });
      const showCanals = document.getElementById('toggle-canals')?.checked ?? true;
      // Crisp, pure blue dotted line for canals (no underlying casing or shadows)
      map.addLayer({
        id: 'canals-line',
        type: 'line',
        source: 'canals',
        layout: {
          'visibility': showCanals ? 'visible' : 'none',
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': '#0284c7',
          'line-width': 3.5,
          'line-dasharray': [3, 2.5],
          'line-opacity': 1.0
        }
      });

      // Generous 22px hit buffer for canals
      map.addLayer({
        id: 'canals-hit-buffer',
        type: 'line',
        source: 'canals',
        layout: {
          'visibility': showCanals ? 'visible' : 'none'
        },
        paint: {
          'line-color': '#000000',
          'line-width': 22,
          'line-opacity': 0.0001
        }
      });

      map.on('mousemove', 'canals-hit-buffer', (e) => {
        if (!e.features.length) return;
        map.getCanvas().style.cursor = 'pointer';
        const t = e.features[0].properties;
        const flowVal = Number(t.flow_cfs || 0);
        const flowDisplay = flowVal > 0 
          ? `<span style="font-size:16px; font-weight:800; color:#0284c7;">${flowVal.toLocaleString()} <span style="font-size:11px; font-weight:600; color:#64748b;">cfs</span></span>`
          : `<span style="font-size:14px; font-weight:700; color:#64748b;">Active Conveyance</span>`;

        tooltipPopup.setLngLat(e.lngLat).setHTML(`
          <div style="font-family:'Inter',sans-serif; min-width: 220px; max-width: 290px;">
            <span style="font-size:10px;font-weight:700;color:#0369a1;background:#e0f2fe;border:1px solid #bae6fd;padding:2px 6px;border-radius:4px;display:inline-block;margin-bottom:4px;">Major Conveyance Canal</span>
            <strong style="font-size:13px;color:#0f172a;display:block;">${t.name}</strong>
            <span style="font-size:11px;color:#0284c7;font-weight:600;">${t.operator || ''}</span>
            <div style="margin: 6px 0; padding: 6px 10px; background:#f8fafc; border-radius:6px; border:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:baseline;">
              <span style="font-size:11px; color:#475569; font-weight:600;">Estimated Flow:</span>
              ${flowDisplay}
            </div>
            <div style="font-size:11px;line-height:1.45;color:#334155;">
              <strong>Destination:</strong> ${t.destination || t.to}<br>
              <strong>Length:</strong> ${t.length_miles} miles<br>
              <strong>Intake:</strong> ${t.from}<br>
              <strong>Terminus:</strong> ${t.to}
            </div>
            <div style="font-size:10.5px;color:#64748b;margin-top:6px;border-top:1px solid #e2e8f0;padding-top:5px;line-height:1.4;">
              <strong>Design Capacity:</strong> ${t.id === "09527700" ? '26,155 cfs (Imperial Dam Headworks)' : (t.id === "09426650" ? '3,000 cfs (Mark Wilmer Pumping Plant)' : '1,600 cfs (Whitsett Pumping Plant)')}<br>
              <strong>Infrastructure:</strong> Major Inter-Basin Conveyance Aqueduct
            </div>
          </div>
        `).addTo(map);
      });

      map.on('mouseleave', 'canals-hit-buffer', () => {
        map.getCanvas().style.cursor = '';
        tooltipPopup.remove();
      });

      map.on('click', 'canals-hit-buffer', (e) => {
        if (!e.features.length) return;
        const t = e.features[0].properties;
        const flowVal = Number(t.flow_cfs || 0);
        const portal = getPortalInfo(t);
        new maplibregl.Popup({ offset: 8 })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="font-family:'Inter',sans-serif; min-width: 220px;">
              <span style="font-size:10px;font-weight:700;color:#0369a1;background:#e0f2fe;border:1px solid #bae6fd;padding:2px 6px;border-radius:4px;display:inline-block;margin-bottom:4px;">Major Conveyance Canal</span>
              <strong style="font-size:14px;color:#0f172a;display:block;">${t.name}</strong>
              <span style="font-size:11px;color:#0284c7;font-weight:600;">${t.operator || ''}</span>
              ${flowVal > 0 ? `
              <div style="margin: 8px 0; padding: 6px 10px; background:#f8fafc; border-radius:6px; border:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:baseline;">
                <span style="font-size:11px; color:#475569; font-weight:600;">Estimated Flow:</span>
                <span style="font-size:16px; font-weight:800; color:#0284c7;">${flowVal.toLocaleString()} cfs</span>
              </div>` : ''}
              <div style="font-size:11px;line-height:1.45;color:#334155;margin-top:6px;">
                <strong>Destination:</strong> ${t.destination || t.to}<br>
                <strong>Length:</strong> ${t.length_miles} miles<br>
                <strong>Intake:</strong> ${t.from}<br>
                <strong>Terminus:</strong> ${t.to}
              </div>
              <div style="font-size:10.5px;color:#64748b;margin-top:6px;border-top:1px solid #e2e8f0;padding-top:5px;line-height:1.4;">
                <strong>Design Capacity:</strong> ${t.id === "09527700" ? '26,155 cfs (Imperial Dam Headworks)' : (t.id === "09426650" ? '3,000 cfs (Mark Wilmer Pumping Plant)' : '1,600 cfs (Whitsett Pumping Plant)')}<br>
                <strong>Infrastructure:</strong> Major Inter-Basin Conveyance Aqueduct
              </div>
              ${formatPortalHtml(portal, '#0284c7')}
            </div>
          `)
          .addTo(map);
      });
    }
  }

  // 6. Major Dams (Native WebGL Symbol Layer - Locks 1:1 with Map Canvas, Zero Drag Latency)
  if (geo.dams && !map.getSource('dams')) {
    const damsGeoJSON = {
      type: 'FeatureCollection',
      features: geo.dams.map(d => ({
        type: 'Feature',
        properties: { ...d },
        geometry: { type: 'Point', coordinates: [d.lon, d.lat] }
      }))
    };

    map.addSource('dams', { type: 'geojson', data: damsGeoJSON });

    // Custom SVG dam icon loaded into MapLibre GPU texture
    const damSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
      <rect x="3" y="3" width="30" height="30" rx="6" fill="#1e293b" stroke="#ffffff" stroke-width="2.5"/>
      <path d="M8 9h20l-3.2 18H11.2L8 9zm3.8 2.8l2.2 12.4h8l2.2-12.4H11.8z" fill="#38bdf8"/>
    </svg>`;

    const img = new Image(36, 36);
    img.onload = () => {
      if (!map.hasImage('dam-icon')) {
        map.addImage('dam-icon', img);
      }
      if (!map.getLayer('dams-layer')) {
        map.addLayer({
          id: 'dams-layer',
          type: 'symbol',
          source: 'dams',
          layout: {
            'icon-image': 'dam-icon',
            'icon-size': 0.65,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true
          }
        });
      }
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(damSvg);

    map.on('click', 'dams-layer', (e) => {
      if (!e.features.length) return;
      const d = e.features[0].properties;
      const portal = getPortalInfo(d);
      new maplibregl.Popup({ offset: 14 })
        .setLngLat(e.lngLat)
        .setHTML(`
          <div style="font-family:'Inter',sans-serif; min-width: 180px;">
            <strong style="font-size:13px;color:#0f172a;">${d.name}</strong><br>
            <span style="font-size:11px;color:#64748b;font-weight:600;">${d.operator}</span>
            <hr style="margin:6px 0;border:none;border-top:1px solid #e2e8f0;">
            <div style="font-size:11px;line-height:1.45;color:#334155;">
              <strong>Impounds:</strong> ${d.impounds}<br>
              <strong>Height:</strong> ${d.height_ft} ft | <strong>Built:</strong> ${d.year}<br>
              <strong>Purpose:</strong> ${d.purpose}
            </div>
            ${formatPortalHtml(portal, '#0284c7')}
          </div>
        `)
        .addTo(map);
    });

    map.on('mousemove', 'dams-layer', (e) => {
      if (!e.features.length) return;
      map.getCanvas().style.cursor = 'pointer';
      const d = e.features[0].properties;
      tooltipPopup.setLngLat(e.lngLat).setHTML(`
        <strong>${d.name}</strong><br>
        <span style="font-size:11px;color:#64748b;">${d.operator} • Impounds ${d.impounds}</span>
      `).addTo(map);
    });

    map.on('mouseleave', 'dams-layer', () => {
      map.getCanvas().style.cursor = '';
      tooltipPopup.remove();
    });
  }
}

// ─── Flow Health Overlay ──────────────────────────────────────────────────────
// Returns today's "MM-DD" key for looking up historical normals
function todayKey() {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// Returns the historical daily-mean for a USGS site ID on today's date
function getHistoricalNormal(siteId) {
  if (!cachedNormals?.sites) return null;
  const site = cachedNormals.sites[siteId];
  if (!site) return null;
  return site[todayKey()] ?? null;
}

// Color scale: critically low → low → below-normal → normal → abundant
function flowHealthColor(pctOfNormal) {
  if (pctOfNormal === null || pctOfNormal === undefined) return '#0284c7';  // fallback / unmonitored baseline
  if (pctOfNormal >= 150) return '#1d4ed8';  // abundant — deep blue
  if (pctOfNormal >= 90)  return '#0ea5e9';  // normal — sky blue
  if (pctOfNormal >= 50)  return '#f59e0b';  // below normal — amber
  if (pctOfNormal >= 25)  return '#ef4444';  // low — red
  return '#991b1b';                           // critically low — dark red
}

// Label for the health status
function flowHealthLabel(pct) {
  if (pct === null || pct === undefined) return 'Baseline';
  if (pct >= 150) return 'Abundant';
  if (pct >= 90)  return 'Normal';
  if (pct >= 50)  return 'Below Normal';
  if (pct >= 25)  return 'Low Flow';
  return 'Critically Low';
}

// Build / update the flow-health layer colors directly on continuous river network
function renderFlowHealthLayer(riverNetwork, metrics) {
  const isChecked = document.getElementById('toggle-flow-health')?.checked ?? false;
  toggleFlowHealthLayer(isChecked);
}

function toggleFlowHealthLayer(show) {
  if (!map) return;

  const coreColor = show ? ['coalesce', ['get', 'health_color'], '#0284c7'] : '#0284c7';
  const glowColor = show ? ['coalesce', ['get', 'health_color'], '#38bdf8'] : '#38bdf8';

  // Apply colors directly to the existing river layers without dimming anything
  ['rivers-mainstem-core', 'rivers-major-core'].forEach(id => {
    if (map.getLayer(id)) {
      map.setPaintProperty(id, 'line-color', coreColor);
      map.setPaintProperty(id, 'line-opacity', 0.95);
    }
  });

  if (map.getLayer('rivers-minor-core')) {
    map.setPaintProperty('rivers-minor-core', 'line-color', coreColor);
    map.setPaintProperty('rivers-minor-core', 'line-opacity', 0.75);
  }

  ['rivers-mainstem-glow', 'rivers-major-glow'].forEach(id => {
    if (map.getLayer(id)) {
      map.setPaintProperty(id, 'line-color', glowColor);
      map.setPaintProperty(id, 'line-opacity', 0.65);
      map.setPaintProperty(id, 'line-blur', 1.5);
    }
  });

  if (map.getLayer('rivers-minor-glow')) {
    map.setPaintProperty('rivers-minor-glow', 'line-color', glowColor);
    map.setPaintProperty('rivers-minor-glow', 'line-opacity', 0.35);
    map.setPaintProperty('rivers-minor-glow', 'line-blur', 0.8);
  }

  // Remove or hide legacy separate rivers-health layers if present
  if (map.getLayer('rivers-health-glow')) {
    map.setLayoutProperty('rivers-health-glow', 'visibility', 'none');
  }
  if (map.getLayer('rivers-health-core')) {
    map.setLayoutProperty('rivers-health-core', 'visibility', 'none');
  }

  // Show/hide health legend in map
  const leg = document.getElementById('flow-health-legend');
  if (leg) leg.style.display = show ? 'block' : 'none';
}

// ─── End Flow Health Overlay ─────────────────────────────────────────────────

function renderMetrics(metrics) {
  // Clear previous CFS markers
  Object.values(markers).forEach(arr => {
    arr.forEach(m => m.remove());
    arr.length = 0;
  });
  stationMarkers = {};

  const showBadges = document.getElementById('toggle-all-badges')?.checked ?? false;
  const showTunnels = document.getElementById('toggle-tunnels')?.checked ?? false;
  const showCanals = document.getElementById('toggle-canals')?.checked ?? false;
  const showReservoirs = document.getElementById('toggle-reservoirs')?.checked ?? true;

  // 1. Streamflow Gauges (Compact CFS Badges) - Hidden by default for minimal clarity
  metrics.streamflows.forEach(s => {
    const isLeesFerry = s.id === "09380000";
    const highlightClass = isLeesFerry ? "lees-badge" : "";

    const el = document.createElement('div');
    el.className = 'cfs-marker-wrap';
    el.innerHTML = `<div class="cfs-badge gauge ${highlightClass}"><span class="cfs-val">${s.flow_cfs.toLocaleString()}</span> <span class="cfs-unit">cfs</span></div>`;

    const norm = getHistoricalNormal(s.id);
    let healthBadgeHtml = '';
    if (norm && norm > 0) {
      const pct = Math.round((s.flow_cfs / norm) * 100);
      const color = flowHealthColor(pct);
      const label = flowHealthLabel(pct);
      healthBadgeHtml = `
        <div style="margin: 6px 0; padding: 5px 8px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:10.5px; color:#64748b; font-weight:600;">vs. Hist. Daily Avg:</span>
          <span style="font-size:12.5px; font-weight:800; color:${color};">${pct}% <span style="font-size:10px; font-weight:600;">(${label})</span></span>
        </div>
        <div style="font-size:10px; color:#94a3b8; margin-bottom:6px;">Avg today: ${Math.round(norm).toLocaleString()} cfs</div>
      `;
    }

    const popup = new maplibregl.Popup({ offset: 12 }).setHTML(`
      <div style="font-family:'Inter',sans-serif; min-width: 215px; padding: 2px;">
        <div style="display:flex; align-items:center; gap:6px; margin-bottom:6px;">
          <span style="font-size:10px; font-weight:700; color:#0369a1; background:#e0f2fe; padding:2px 6px; border-radius:4px;">USGS Real-Time Gauge</span>
          ${isLeesFerry ? '<span style="font-size:10px; font-weight:700; color:#0369a1; background:#e0f2fe; border: 1px solid #bae6fd; padding:2px 6px; border-radius:4px;">1922 Compact Divide</span>' : ''}
        </div>
        <strong style="font-size:13px; color:#0f172a; line-height:1.35; display:block;">${s.name}</strong>
        <div style="margin: 8px 0; padding: 8px 10px; background:#f8fafc; border-radius:6px; border:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:baseline;">
          <span style="font-size:11px; color:#64748b; font-weight:600;">Current Discharge:</span>
          <span style="font-size:16px; font-weight:800; color:#0284c7;">${s.flow_cfs.toLocaleString()} <span style="font-size:11px; font-weight:600; color:#64748b;">cfs</span></span>
        </div>
        ${healthBadgeHtml}
        <div style="font-size:11px; color:#475569; line-height:1.5;">
          <strong>USGS Station ID:</strong> <a href="https://waterdata.usgs.gov/monitoring-location/${s.id}" target="_blank" style="color:#0284c7; text-decoration:none; font-weight:600;">${s.id} ↗</a><br>
          <strong>Last Measured:</strong> ${formatTimestamp(s.timestamp)}
        </div>
      </div>
    `);

    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([s.lon, s.lat])
      .setPopup(popup)
      .addTo(map);

    marker._meta = {
      id: s.id,
      name: s.name,
      flow_cfs: s.flow_cfs,
      priority: isLeesFerry ? 1000 : (
        s.id === "09421500" ? 850 : // Colorado R below Hoover Dam
        s.id === "09315000" ? 800 : // Green River at Green River UT
        s.id === "09379500" ? 750 : // San Juan River at Bluff UT
        s.id === "09095500" ? 720 : // Colorado R near Cameo CO
        s.id === "09522000" ? 700 : // Colorado R at Imperial Dam
        s.id === "09180500" ? 680 : // Colorado R near Cisco UT
        s.id === "09402500" ? 650 : // Colorado R above Diamond Creek / Grand Canyon
        s.id === "09070500" ? 600 : // Colorado R near Dotsero CO
        s.id === "09521100" ? 550 : // Colorado R at Yuma
        s.id === "09427520" ? 520 : // Colorado R below Parker Dam
        s.id === "09423000" ? 500 : // Colorado R below Davis Dam
        (s.flow_cfs >= 1000 ? 400 : 200)
      )
    };

    if (!showBadges) {
      marker.getElement().style.display = 'none';
    }

    markers.gauges.push(marker);
    stationMarkers[s.id] = { marker, popup, lat: s.lat, lon: s.lon };
  });

  // 1b. Native WebGL Point Layer for USGS Streamflow Gauges (Station Dots matching the Legend)
  if (metrics.streamflows && metrics.streamflows.length > 0) {
    const gaugesGeoJSON = {
      type: 'FeatureCollection',
      features: metrics.streamflows.map(s => ({
        type: 'Feature',
        properties: {
          id: s.id,
          name: s.name,
          flow_cfs: s.flow_cfs,
          timestamp: s.timestamp
        },
        geometry: { type: 'Point', coordinates: [s.lon, s.lat] }
      }))
    };

    if (!map.getSource('streamflow-gauges')) {
      map.addSource('streamflow-gauges', { type: 'geojson', data: gaugesGeoJSON });

      const showGauges = document.getElementById('toggle-streamflow-gauges')?.checked ?? true;

      // 1. Casing / border circle
      map.addLayer({
        id: 'streamflow-gauges-casing',
        type: 'circle',
        source: 'streamflow-gauges',
        layout: {
          'visibility': showGauges ? 'visible' : 'none'
        },
        paint: {
          'circle-color': '#ffffff',
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            4, 4.5,
            7, 6.0,
            10, 7.5,
            13, 9.5
          ],
          'circle-stroke-color': '#0f172a',
          'circle-stroke-width': 1.0,
          'circle-opacity': 0.95
        }
      });

      // 2. Core blue dot matching the legend
      map.addLayer({
        id: 'streamflow-gauges-circle',
        type: 'circle',
        source: 'streamflow-gauges',
        layout: {
          'visibility': showGauges ? 'visible' : 'none'
        },
        paint: {
          'circle-color': '#0284c7',
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            4, 3.0,
            7, 4.2,
            10, 5.5,
            13, 7.5
          ],
          'circle-opacity': 1.0
        }
      });

      // 3. Generous hit buffer for interactive hover & click
      map.addLayer({
        id: 'streamflow-gauges-hit-buffer',
        type: 'circle',
        source: 'streamflow-gauges',
        layout: {
          'visibility': showGauges ? 'visible' : 'none'
        },
        paint: {
          'circle-radius': 18,
          'circle-opacity': 0.0001
        }
      });

      map.on('mousemove', 'streamflow-gauges-hit-buffer', (e) => {
        if (!e.features.length) return;
        map.getCanvas().style.cursor = 'pointer';
        const g = e.features[0].properties;
        tooltipPopup.setLngLat(e.lngLat).setHTML(`
          <div style="font-family:'Inter',sans-serif; min-width: 190px;">
            <span style="font-size:10px; font-weight:700; color:#0369a1; background:#e0f2fe; padding:2px 6px; border-radius:4px; display:inline-block; margin-bottom:4px;">USGS Real-Time Gauge</span>
            <strong style="font-size:13px; color:#0f172a; display:block;">${g.name}</strong>
            <div style="margin: 6px 0; padding: 6px 10px; background:#f8fafc; border-radius:6px; border:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:baseline;">
              <span style="font-size:11px; color:#64748b; font-weight:600;">Discharge:</span>
              <span style="font-size:15px; font-weight:800; color:#0284c7;">${Number(g.flow_cfs).toLocaleString()} cfs</span>
            </div>
            <div style="font-size:10.5px; color:#64748b;">USGS Station ID: #${g.id}</div>
          </div>
        `).addTo(map);
      });

      map.on('mouseleave', 'streamflow-gauges-hit-buffer', () => {
        map.getCanvas().style.cursor = '';
        tooltipPopup.remove();
      });

      map.on('click', 'streamflow-gauges-hit-buffer', (e) => {
        if (!e.features.length) return;
        const g = e.features[0].properties;
        const entry = stationMarkers[g.id];
        if (entry && entry.popup) {
          entry.popup.setLngLat([e.lngLat.lng, e.lngLat.lat]).addTo(map);
        }
      });
    } else {
      map.getSource('streamflow-gauges').setData(gaugesGeoJSON);
    }
  }

  // 2. Trans-Mountain Tunnels & Conveyance Canals Badges
  const allDiversions = [...(metrics.tunnels || []), ...(metrics.canals || [])];
  allDiversions.forEach(t => {
    const isFrontRange = t.id && t.id.endsWith("TUNCO");
    const diversionBadge = isFrontRange ? "Trans-Mountain Diversion Tunnel" : "Major Conveyance Canal";
    const geoMatch = (cachedGeography?.tunnels || []).find(gt => gt.id === t.id);
    const lengthVal = t.length_miles || geoMatch?.length_miles || (t.id === "09426650" ? 336.0 : (t.id === "09424150" ? 242.0 : 82.0));
    const lengthText = isFrontRange ? `${lengthVal} miles under Divide` : `${lengthVal} miles`;
    const fromVal = t.from || geoMatch?.from || "Lake Havasu / Parker Dam";
    const toVal = t.to || geoMatch?.to || t.destination;
    const fromText = isFrontRange ? `<strong>West Portal:</strong> ${fromVal}` : `<strong>Intake:</strong> ${fromVal}`;
    const toText = isFrontRange ? `<strong>East Portal:</strong> ${toVal}` : `<strong>Terminus:</strong> ${toVal}`;
    const badgeClass = isFrontRange ? "tunnel-badge" : "canal-badge";

    const el = document.createElement('div');
    el.className = 'cfs-marker-wrap';
    el.innerHTML = `<div class="cfs-badge ${badgeClass}"><span class="cfs-val">${t.flow_cfs.toLocaleString()}</span> <span class="cfs-unit">cfs</span></div>`;

    const portal = getPortalInfo(t);
    const popup = new maplibregl.Popup({ offset: 12 }).setHTML(`
      <div style="font-family:'Inter',sans-serif; min-width: 220px; padding: 2px;">
        <div style="display:flex; align-items:center; gap:6px; margin-bottom:6px;">
          <span style="font-size:10px; font-weight:700; color:#0369a1; background:#e0f2fe; border:1px solid #bae6fd; padding:2px 6px; border-radius:4px;">${diversionBadge}</span>
        </div>
        <strong style="font-size:13px; color:#0f172a; line-height:1.35; display:block;">${t.name}</strong>
        <div style="font-size:11px; color:#64748b; font-weight:600; margin-bottom:6px;">${t.operator || ''}</div>
        <div style="margin: 6px 0; padding: 8px 10px; background:#f8fafc; border-radius:6px; border:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:baseline;">
          <span style="font-size:11px; color:#475569; font-weight:600;">Diverted Flow:</span>
          <span style="font-size:16px; font-weight:800; color:#0284c7;">${t.flow_cfs.toLocaleString()} <span style="font-size:11px; font-weight:600; color:#64748b;">cfs</span></span>
        </div>
        <div style="font-size:11px; color:#475569; line-height:1.5;">
          <strong>Destination:</strong> ${t.destination}<br>
          <strong>Length:</strong> ${lengthText}<br>
          ${fromText}<br>
          ${toText}<br>
          <strong>Last Measured:</strong> ${formatTimestamp(t.timestamp)}
        </div>
        ${formatPortalHtml(portal, '#0284c7')}
      </div>
    `);

    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([t.lon, t.lat])
      .setPopup(popup)
      .addTo(map);

    marker._meta = {
      id: t.id,
      name: t.name,
      flow_cfs: t.flow_cfs,
      priority: isFrontRange ? 600 : 620
    };

    if (isFrontRange) {
      const showTunnels = document.getElementById('toggle-tunnels')?.checked ?? true;
      const showTunnelBadges = (document.getElementById('toggle-tunnel-badges') || document.getElementById('toggle-tunnelBadges'))?.checked ?? false;
      if (!showTunnels || !showTunnelBadges) marker.getElement().style.display = 'none';
      markers.tunnels.push(marker);
    } else {
      const showCanals = document.getElementById('toggle-canals')?.checked ?? true;
      const showCanalBadges = (document.getElementById('toggle-canal-badges') || document.getElementById('toggle-canalBadges'))?.checked ?? false;
      if (!showCanals || !showCanalBadges) marker.getElement().style.display = 'none';
      markers.canals.push(marker);
    }

    stationMarkers[t.id] = { marker, popup, lat: t.lat, lon: t.lon };
  });

  // 3. Reservoirs: Floating labels on the map are eliminated to keep the waterbodies clean;
  // all detailed telemetry is showcased in the dedicated sidebar panel and via polygon hover/click.
}

function updateSidebar(metrics) {
  // 1. Where Is the Water Going? (Major Basin Outflows & Diversions) - Bar Chart
  const tunnelsExport = (metrics.tunnels || [])
    .filter(t => t.id && t.id.endsWith("TUNCO"))
    .reduce((sum, t) => sum + (t.flow_cfs || 0), 0);
  
  const aacFlow = (metrics.canals || []).find(c => c.id === "09527700")?.flow_cfs 
    || (metrics.streamflows || []).find(s => s.id === "09527700")?.flow_cfs 
    || 4800;
  
  const craFlow = (metrics.canals || []).find(c => c.id === "09424150")?.flow_cfs 
    || 1350;

  const capFlow = (metrics.canals || []).find(c => c.id === "09426650")?.flow_cfs
    || (metrics.streamflows || []).find(s => s.id === "09426650")?.flow_cfs
    || 1500;

  const leesFlow = (metrics.streamflows || []).find(s => s.id === "09380000")?.flow_cfs || 9770;

  const flowChartElem = document.getElementById("flow-dest-chart");
  if (flowChartElem) {
    const maxFlow = Math.max(tunnelsExport, aacFlow, craFlow, capFlow, leesFlow) || 1;
    const makeBar = (name, flow, color, label1, label2, center, zoomLevel, meta) => {
      const pct = Math.max(2, (flow / maxFlow) * 100);
      const onClick = center ? `onclick="if(window.map) window.map.flyTo({center: [${center[0]}, ${center[1]}], zoom: ${zoomLevel || 9}, duration: 1400})"` : '';
      const portal = getPortalInfo(meta || { name: name });
      const portalLink = portal ? `<a href="${portal.url}" target="_blank" rel="noopener" title="Open official ${portal.name}" onclick="event.stopPropagation();" style="margin-left:6px; color:${color}; text-decoration:none; font-size:12px; font-weight:800;">↗</a>` : '';
      return `
        <div class="flow-bar-row interactive" ${onClick} title="Click to fly to ${name}">
          <div class="flow-bar-labels">
            <span class="flow-bar-name">${name}${portalLink} <span class="flow-bar-sub">(${label1})</span></span>
            <span class="flow-bar-val" style="color: ${color}">${Math.round(flow).toLocaleString()} cfs</span>
          </div>
          <div class="flow-bar-track">
            <div class="flow-bar-fill" style="width: ${pct}%; background-color: ${color};"></div>
          </div>
        </div>
      `;
    };

    flowChartElem.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 8px;">
        ${makeBar("Lees Ferry", leesFlow, "var(--color-primary)", "Upper \u2192 Lower Basin", "", [-111.587, 36.865], 9.5, { id: "09380000", name: "Lees Ferry" })}
        ${makeBar("All-American Canal", aacFlow, "var(--color-emerald)", "Ag Export", "", [-114.467, 32.883], 9, { id: "09527700", name: "All-American Canal" })}
        ${makeBar("Central AZ Project", capFlow, "var(--color-emerald)", "AZ Municipal/Ag", "", [-114.111, 34.289], 9, { id: "09426650", name: "Central Arizona Project" })}
        ${makeBar("CO River Aqueduct", craFlow, "var(--color-emerald)", "Urban Export", "", [-114.162, 34.314], 9, { id: "09424150", name: "Colorado River Aqueduct" })}
        ${makeBar("Front Range Tunnels", tunnelsExport, "var(--color-primary)", "Divide Export", "", [-105.7, 39.8], 8, { id: "ROBTUNCO", name: "Front Range Tunnels" })}
      </div>
    `;
  }

  // 2. Major Storage Reservoirs Panel (Separated into Basin-Wide vs. Front Range & Denver)
  const allRes = metrics.reservoirs || [];
  const systemRes = allRes.filter(r => r.category !== 'front_range');
  const frontRangeRes = allRes.filter(r => r.category === 'front_range');

  // Basin System Summary
  const sysTotalCap = systemRes.reduce((sum, r) => sum + (r.capacity_af || (r.storage_af / (r.capacity_pct / 100))), 0);
  const sysTotalStorage = systemRes.reduce((sum, r) => sum + (r.storage_af || 0), 0);
  const sysPct = sysTotalCap > 0 ? ((sysTotalStorage / sysTotalCap) * 100).toFixed(1) : "28.9";

  const badgeElem = document.getElementById("basin-storage-badge");
  if (badgeElem) {
    badgeElem.textContent = `${sysPct}% Full`;
    badgeElem.style.border = "none";
    if (sysPct < 25) {
      badgeElem.style.background = "#fef2f2";
      badgeElem.style.color = "#dc2626";
    } else if (sysPct < 50) {
      badgeElem.style.background = "#fef3c7";
      badgeElem.style.color = "#b45309";
    } else {
      badgeElem.style.background = "#ecfeff";
      badgeElem.style.color = "#0891b2";
    }
  }

  const summaryElem = document.getElementById("basin-storage-summary");
  if (summaryElem) {
    summaryElem.innerHTML = `System Total: <strong>${(sysTotalStorage / 1e6).toFixed(2)}M AF</strong> of ${(sysTotalCap / 1e6).toFixed(2)}M AF Total Capacity`;
  }

  // Front Range Summary
  const frTotalCap = frontRangeRes.reduce((sum, r) => sum + (r.capacity_af || 0), 0);
  const frTotalStorage = frontRangeRes.reduce((sum, r) => sum + (r.storage_af || 0), 0);
  const frPct = frTotalCap > 0 ? ((frTotalStorage / frTotalCap) * 100).toFixed(1) : "45.0";

  const frBadgeElem = document.getElementById("fr-storage-badge");
  if (frBadgeElem) {
    frBadgeElem.textContent = `${frPct}% Full`;
    frBadgeElem.style.border = "none";
    frBadgeElem.style.background = frPct < 25 ? "#fef2f2" : (frPct < 50 ? "#fef3c7" : "#ecfeff");
    frBadgeElem.style.color = frPct < 25 ? "#dc2626" : (frPct < 50 ? "#b45309" : "#0891b2");
  }

  const frSummaryElem = document.getElementById("fr-storage-summary");
  if (frSummaryElem) {
    frSummaryElem.innerHTML = `Total West Slope Storage: <strong>${Math.round(frTotalStorage / 1e3).toLocaleString()}k AF</strong> of ${Math.round(frTotalCap / 1e3).toLocaleString()}k AF Capacity`;
  }

  const renderResCardList = (containerId, list) => {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";
    list.forEach(r => {
      const pct = Number(r.capacity_pct) || 0;
      const statusClass = pct < 25 ? 'crit' : (pct < 50 ? 'warn' : 'good');
      const row = document.createElement("div");
      row.className = "res-row";
      row.title = `Click to fly to ${r.name}`;
      
      const cleanName = r.name.split('(')[0].trim();
      const subLabel = r.operator ? `${r.operator} &bull; ${r.river}` : (r.river || (r.name.match(/\(([^)]+)\)/)?.[1] || 'Major Storage'));

      const capAf = r.capacity_af || (r.storage_af / (pct / 100));
      const storageStr = r.storage_af >= 1e6 ? `${(r.storage_af / 1e6).toFixed(2)}M AF` : `${Math.round(r.storage_af / 1e3).toLocaleString()}k AF`;
      const capStr = capAf >= 1e6 ? `${(capAf / 1e6).toFixed(2)}M AF` : `${Math.round(capAf / 1e3).toLocaleString()}k AF`;

      const elevText = r.elevation_ft ? `Elev: ${Math.round(r.elevation_ft).toLocaleString()} ft` : (r.stage_ft ? `Stage: ${r.stage_ft} ft` : '');
      const downText = r.feet_below_full != null ? `<span style="color:#b45309;font-weight:600;"> &bull; ${r.feet_below_full} ft down</span>` : '';

      const portal = getPortalInfo(r);
      const portalLink = portal 
        ? `<a href="${portal.url}" target="_blank" rel="noopener" title="Open official ${portal.name}" onclick="event.stopPropagation();" style="margin-left:6px; color:#0284c7; text-decoration:none; font-size:11px; font-weight:800;">↗</a>`
        : '';

      row.innerHTML = `
        <div class="res-row-head">
          <span class="res-row-name">${cleanName}${portalLink}</span>
          <span class="res-row-val ${statusClass}">${pct}%</span>
        </div>
        <div class="res-row-sub">
          <span>${subLabel}</span>
          <span><strong>${storageStr}</strong> of ${capStr}</span>
        </div>
        <div class="res-row-sub" style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">
          <span>${elevText}${downText}</span>
          <span>${formatTimestamp(r.timestamp)}</span>
        </div>
        <div class="progress-track" style="height: 5px; margin-top: 5px;">
          <div class="progress-fill ${statusClass}" style="width: ${Math.min(100, Math.max(2, pct))}%;"></div>
        </div>
      `;
      row.onclick = () => {
        if (r.lat && r.lon) {
          map.flyTo({ center: [r.lon, r.lat], zoom: 10.2, duration: 1400 });
        }
      };
      container.appendChild(row);
    });
  };

  renderResCardList("reservoir-list", systemRes);
  renderResCardList("front-range-res-list", frontRangeRes);
}

function populateTelemetryTable(metrics) {
  const tbody = document.getElementById("telemetry-rows");
  tbody.innerHTML = "";

  const allNodes = [
    ...metrics.streamflows.map(s => {
      let b = "Upper Basin";
      if (s.id === "09380000") b = "Upper/Lower Divide";
      else if (["09402000", "09415000", "09426000", "09429100", "09474000", "09520500", "09498500", "09511300"].includes(s.id)) b = "Lower Basin";
      return {
        id: s.id,
        name: s.name,
        type: "streamflow",
        basin: b,
        reading: `${s.flow_cfs.toLocaleString()} cfs`,
        notes: "USGS NWIS Real-Time Gauge",
        timestamp: s.timestamp,
        lat: s.lat,
        lon: s.lon
      };
    }),
    ...metrics.tunnels.map(t => ({
      id: t.id,
      name: t.name,
      type: "diversion_tunnel",
      basin: "Continental Divide",
      reading: `${t.flow_cfs.toLocaleString()} cfs`,
      notes: t.destination,
      timestamp: t.timestamp,
      lat: t.lat,
      lon: t.lon
    })),
    ...(metrics.canals || []).map(c => ({
      id: c.id,
      name: c.name,
      type: "diversion_canal",
      basin: "Lower Basin Conveyance",
      reading: `${c.flow_cfs.toLocaleString()} cfs`,
      notes: c.destination,
      timestamp: c.timestamp,
      lat: c.lat,
      lon: c.lon
    })),
    ...metrics.reservoirs.map(r => ({
      id: r.id,
      name: r.name,
      type: "reservoir",
      basin: r.category === "front_range" ? "Front Range Storage" : (["lake_powell", "flaming_gorge", "navajo", "blue_mesa"].includes(r.id) ? "Upper Basin Storage" : "Lower Basin Storage"),
      reading: `${(r.capacity_pct !== undefined && r.capacity_pct !== null) ? r.capacity_pct : ((r.storage_af / r.capacity_af) * 100).toFixed(1)}% (${Math.round(r.storage_af / 1000).toLocaleString()}k AF)`,
      notes: r.feet_below_full ? `${r.feet_below_full} ft down (Elev: ${r.elevation_ft ? r.elevation_ft.toLocaleString() : 'N/A'} ft)` : `Elevation: ${r.elevation_ft ? r.elevation_ft.toLocaleString() : 'N/A'} ft`,
      timestamp: r.timestamp,
      lat: r.lat,
      lon: r.lon
    }))
  ];

  document.getElementById("node-count").textContent = allNodes.length;

  allNodes.forEach(node => {
    const portal = getPortalInfo(node);
    const portalLink = portal 
      ? `<a href="${portal.url}" target="_blank" rel="noopener" title="Open official ${portal.name}" onclick="event.stopPropagation();" style="margin-left:6px; color:#0284c7; text-decoration:none; font-size:12px; font-weight:700;">↗</a>`
      : '';

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${node.name}</strong>${portalLink}</td>
      <td><span class="type-pill ${node.type}">${node.type.replace('_', ' ')}</span></td>
      <td>${node.basin}</td>
      <td><strong>${node.reading}</strong></td>
      <td style="color:#64748b;font-size:11px;">${node.notes}</td>
      <td style="color:#64748b;font-size:11px;white-space:nowrap;">${formatTimestamp(node.timestamp)}</td>
    `;
    tr.addEventListener("click", () => {
      flyToNode(node.id, node.lat, node.lon);
    });
    tbody.appendChild(tr);
  });
}

function flyToNode(id, lat, lon) {
  map.flyTo({
    center: [lon, lat],
    zoom: 10.5,
    pitch: isTilted ? 48 : 0,
    bearing: isTilted ? -10 : 0,
    duration: 1500,
    essential: true
  });
  if (stationMarkers[id]) {
    setTimeout(() => {
      stationMarkers[id].popup.addTo(map);
    }, 1500);
  }
}

// Authoritative full basin bounding box (encompassing all Upper & Lower Basin boundaries)
const BASIN_BOUNDS = [
  [-116.65, 31.15], // Southwest: Gulf of California / Salton Sea / Imperial Valley / Sonoran border
  [-105.45, 43.65]  // Northeast: Wind River Range / Green River headwaters WY / Continental Divide
];

// Preset Zoom Navigation with mode-sensitive pitch
function zoomToPreset(preset) {
  document.querySelectorAll(".nav-btn").forEach(btn => {
    if (btn.getAttribute("onclick")?.includes(preset)) {
      btn.classList.add("active");
    } else if (!btn.classList.contains("law-btn") && !btn.getAttribute("onclick")?.includes("sankey")) {
      btn.classList.remove("active");
    }
  });

  if (isTilted) {
    // 3D Oblique Perspectives
    switch(preset) {
      case "basin": {
        const cam = map.cameraForBounds(BASIN_BOUNDS, {
          padding: { top: 135, bottom: 45, left: 45, right: 45 },
          bearing: -8
        });
        map.flyTo({
          center: [cam.center.lng, cam.center.lat + 0.35],
          zoom: cam.zoom,
          pitch: map.getPitch() > 10 ? map.getPitch() : 38,
          bearing: -8,
          duration: 1200
        });
        break;
      }
      case "divide":
        map.flyTo({ center: [-105.9, 39.85], zoom: 9.8, pitch: 56, bearing: -30, duration: 1500 });
        break;
      case "lees_ferry":
        map.flyTo({ center: [-111.59, 36.86], zoom: 11.2, pitch: 54, bearing: 40, duration: 1500 });
        break;
      case "reservoirs":
        map.flyTo({ center: [-113.2, 36.6], zoom: 7.5, pitch: 50, bearing: -15, duration: 1500 });
        break;
    }
  } else {
    // Clean, readable top-down 2D mode
    switch(preset) {
      case "basin": {
        const cam = map.cameraForBounds(BASIN_BOUNDS, {
          padding: { top: 45, bottom: 45, left: 45, right: 45 },
          bearing: 0
        });
        map.flyTo({
          center: cam.center,
          zoom: cam.zoom,
          pitch: 0,
          bearing: 0,
          duration: 1200
        });
        break;
      }
      case "divide":
        map.flyTo({ center: [-105.95, 39.85], zoom: 9.8, pitch: 0, bearing: 0, duration: 1500 });
        break;
      case "lees_ferry":
        map.flyTo({ center: [-111.59, 36.86], zoom: 11.2, pitch: 0, bearing: 0, duration: 1500 });
        break;
      case "reservoirs":
        map.flyTo({ center: [-113.2, 36.6], zoom: 7.5, pitch: 0, bearing: 0, duration: 1500 });
        break;
    }
  }
}

// Layer Toggle Handlers
function setLayerVisibility(layerId, isVisible) {
  if (map && map.getLayer(layerId)) {
    map.setLayoutProperty(layerId, 'visibility', isVisible ? 'visible' : 'none');
  }
}

let badgePlacementPending = false;
function queueBadgePlacements() {
  if (badgePlacementPending) return;
  badgePlacementPending = true;
  requestAnimationFrame(() => {
    updateBadgePlacements();
    badgePlacementPending = false;
  });
}

function updateBadgePlacements() {
  if (!map) return;

  const showGauges = document.getElementById('toggle-gauges')?.checked ?? false;
  const showTunnels = document.getElementById('toggle-tunnels')?.checked ?? true;
  const showTunnelBadges = (document.getElementById('toggle-tunnel-badges') || document.getElementById('toggle-tunnelBadges'))?.checked ?? false;
  const showCanals = document.getElementById('toggle-canals')?.checked ?? true;
  const showCanalBadges = (document.getElementById('toggle-canal-badges') || document.getElementById('toggle-canalBadges'))?.checked ?? false;

  const activeMarkers = [];
  if (showGauges && markers.gauges) {
    markers.gauges.forEach(m => activeMarkers.push(m));
  }
  if (showTunnels && showTunnelBadges && markers.tunnels) {
    markers.tunnels.forEach(m => activeMarkers.push(m));
  }
  if (showCanals && showCanalBadges && markers.canals) {
    markers.canals.forEach(m => activeMarkers.push(m));
  }

  // Sort descending by priority so vital sentinel stations (Lees Ferry, Hoover, Cameo) are placed first
  activeMarkers.sort((a, b) => (b._meta?.priority || 0) - (a._meta?.priority || 0));

  const placedBoxes = [];
  const BADGE_WIDTH = 76;
  const BADGE_HEIGHT = 24;
  const PAD_X = 6;
  const PAD_Y = 5;
  const BOX_W = BADGE_WIDTH + PAD_X * 2;
  const BOX_H = BADGE_HEIGHT + PAD_Y * 2;

  // Candidate offsets to test in priority order:
  // 1. Center (0, 0)
  // 2. Direct vertical nudges: Up (-26px), Down (+26px)
  // 3. Direct horizontal nudges: Right (+48px), Left (-48px)
  // 4. Diagonal nudges: Top-Right, Top-Left, Bottom-Right, Bottom-Left
  const candidateOffsets = [
    [0, 0],
    [0, -26],
    [0, 26],
    [48, 0],
    [-48, 0],
    [42, -24],
    [-42, -24],
    [42, 24],
    [-42, 24]
  ];

  const mapBounds = map.getContainer().getBoundingClientRect();
  const screenWidth = mapBounds.width;
  const screenHeight = mapBounds.height;

  for (const marker of activeMarkers) {
    const el = marker.getElement();
    if (!el) continue;

    const lngLat = marker.getLngLat();
    const screenPt = map.project(lngLat);

    // Skip if marker is far outside viewport
    if (screenPt.x < -100 || screenPt.x > screenWidth + 100 || screenPt.y < -100 || screenPt.y > screenHeight + 100) {
      el.style.display = 'none';
      continue;
    }

    let placed = false;
    for (const [dx, dy] of candidateOffsets) {
      const box = {
        x1: screenPt.x + dx - BOX_W / 2,
        x2: screenPt.x + dx + BOX_W / 2,
        y1: screenPt.y + dy - BOX_H / 2,
        y2: screenPt.y + dy + BOX_H / 2
      };

      // Check collision with already placed boxes
      let collision = false;
      for (const p of placedBoxes) {
        if (!(box.x2 <= p.x1 || box.x1 >= p.x2 || box.y2 <= p.y1 || box.y1 >= p.y2)) {
          collision = true;
          break;
        }
      }

      if (!collision) {
        placedBoxes.push(box);
        placed = true;
        el.style.display = '';
        el.style.marginLeft = `${dx}px`;
        el.style.marginTop = `${dy}px`;
        el.style.opacity = '1';
        el.style.pointerEvents = 'auto';
        break;
      }
    }

    // If no candidate offset fits without overlapping a higher-priority badge:
    // hide the lower-priority badge to prevent any stacking or clutter.
    if (!placed) {
      el.style.display = 'none';
    }
  }
}


let tablePanelHeight = 360;

function toggleTableCollapse() {
  const container = document.getElementById("table-wrap");
  const icon = document.getElementById("collapse-icon");
  const hint = document.getElementById("table-hint");
  if (!container || !icon) return;

  container.classList.toggle("collapsed");
  const isCollapsed = container.classList.contains("collapsed");
  icon.textContent = isCollapsed ? "▲" : "▼";

  if (hint) {
    hint.textContent = isCollapsed
      ? "Hidden by default • Click to expand table & click any row to fly to gauge"
      : "Click any row to fly to its position on the map • Drag top edge to resize";
  }

  if (!isCollapsed) {
    container.style.height = `${tablePanelHeight}px`;
  }
}

function initTableResizer() {
  const resizer = document.getElementById("table-resizer");
  const header = document.getElementById("table-header");
  const container = document.getElementById("table-wrap");
  const collapseBtn = document.getElementById("collapse-btn");
  if (!container) return;

  let isDragging = false;
  let startY = 0;
  let startHeight = 0;
  let hasMoved = false;

  const startDrag = (clientY) => {
    isDragging = true;
    hasMoved = false;
    startY = clientY;
    
    if (container.classList.contains("collapsed")) {
      container.classList.remove("collapsed");
      const icon = document.getElementById("collapse-icon");
      if (icon) icon.textContent = "▼";
      const hint = document.getElementById("table-hint");
      if (hint) hint.textContent = "Click any row to fly to its position on the map • Drag top edge to resize";
    }
    
    startHeight = container.getBoundingClientRect().height || tablePanelHeight || 360;
    container.classList.add("is-resizing");
    if (resizer) resizer.classList.add("dragging");
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  };

  const doDrag = (clientY) => {
    if (!isDragging) return;
    const dy = startY - clientY;
    if (Math.abs(dy) > 4) {
      hasMoved = true;
    }
    const maxH = Math.round(window.innerHeight * 0.85);
    const newHeight = Math.max(120, Math.min(maxH, startHeight + dy));
    tablePanelHeight = newHeight;
    container.style.height = `${newHeight}px`;
  };

  const endDrag = () => {
    if (!isDragging) return;
    isDragging = false;
    container.classList.remove("is-resizing");
    if (resizer) resizer.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  // Mouse Listeners
  if (resizer) {
    resizer.addEventListener("mousedown", (e) => {
      startDrag(e.clientY);
      e.preventDefault();
      e.stopPropagation();
    });
  }

  if (header) {
    header.addEventListener("mousedown", (e) => {
      if (e.target.closest("#collapse-btn")) return;
      startDrag(e.clientY);
    });

    header.addEventListener("click", (e) => {
      if (hasMoved) {
        e.preventDefault();
        e.stopPropagation();
        hasMoved = false;
      } else {
        toggleTableCollapse();
      }
    });
  }

  if (collapseBtn) {
    collapseBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleTableCollapse();
    });
  }

  window.addEventListener("mousemove", (e) => {
    if (isDragging) {
      doDrag(e.clientY);
      e.preventDefault();
    }
  });

  window.addEventListener("mouseup", () => {
    endDrag();
  });

  // Touch Event Support (iPad / Mobile / Surface)
  if (resizer) {
    resizer.addEventListener("touchstart", (e) => {
      if (e.touches.length === 1) {
        startDrag(e.touches[0].clientY);
      }
    }, { passive: false });
  }

  window.addEventListener("touchmove", (e) => {
    if (isDragging && e.touches.length === 1) {
      doDrag(e.touches[0].clientY);
      e.preventDefault();
    }
  }, { passive: false });

  window.addEventListener("touchend", () => {
    endDrag();
  });
}

// Law of the River Modal Handlers
function openLegalModal() {
  const modal = document.getElementById("legal-modal");
  if (modal) {
    modal.classList.add("active");
  }
}

function closeLegalModal(e) {
  if (e && e.target && e.target.classList.contains("modal-card")) return;
  const modal = document.getElementById("legal-modal");
  if (modal) {
    modal.classList.remove("active");
  }
}

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeLegalModal();
  }
});

function refreshData() {
  const syncElem = document.getElementById("sync-time");
  if (syncElem) syncElem.textContent = "Querying live USGS gauges...";
  loadData(true);
}
function toggleCardCollapse(cardId, bodyId, iconId) {
  const card = document.getElementById(cardId);
  const body = document.getElementById(bodyId);
  const icon = document.getElementById(iconId);
  if (!body) return;
  const isHidden = window.getComputedStyle(body).display === "none";
  body.style.display = isHidden ? "block" : "none";
  if (body.classList.contains("toggle-group")) {
    body.style.display = isHidden ? "flex" : "none";
  }
  if (card) card.classList.toggle("collapsed", !isHidden);
  if (icon) icon.style.transform = isHidden ? "rotate(0deg)" : "rotate(-90deg)";
}

function toggleLayerPanelCollapse() {
  toggleCardCollapse("layer-card", "layer-toggle-group", "layer-collapse-icon");
}

function toggleLayer(layerName) {
  const kebab = layerName.replace(/([A-Z])/g, '-$1').toLowerCase();
  const camel = layerName.replace(/-([a-z])/g, g => g[1].toUpperCase());
  
  const checkbox = document.getElementById(`toggle-${kebab}`) || document.getElementById(`toggle-${camel}`);
  if (!checkbox) return;
  const isChecked = checkbox.checked;

  const showAllBadges = document.getElementById('toggle-all-badges')?.checked ?? false;

  switch(camel) {
    case "riverNetwork":
      ['river-mainstem', 'river-major', 'river-minor', 'reservoirs'].forEach(id => {
        const cb = document.getElementById(`toggle-${id}`);
        if (cb) { cb.checked = isChecked; toggleLayer(id); }
      });
      break;
    case "riverMainstem":
      setLayerVisibility('rivers-mainstem-glow', isChecked);
      setLayerVisibility('rivers-mainstem-core', isChecked);
      setLayerVisibility('rivers-mainstem-hit', isChecked);
      break;
    case "riverMajor":
      setLayerVisibility('rivers-major-glow', isChecked);
      setLayerVisibility('rivers-major-core', isChecked);
      setLayerVisibility('rivers-major-hit', isChecked);
      break;
    case "riverMinor":
      setLayerVisibility('rivers-minor-glow', isChecked);
      setLayerVisibility('rivers-minor-core', isChecked);
      setLayerVisibility('rivers-minor-hit', isChecked);
      break;
    case "flowHealth":
      toggleFlowHealthLayer(isChecked);
      if (isChecked && cachedNormals && cachedRiverNetwork && cachedMetrics) {
        renderFlowHealthLayer(cachedRiverNetwork, cachedMetrics);
      }
      break;
    case "allBadges":
      markers.gauges.forEach(m => m.getElement().style.display = isChecked ? '' : 'none');
      const tunnelsOn = document.getElementById('toggle-tunnels')?.checked ?? true;
      markers.tunnels.forEach(m => m.getElement().style.display = (tunnelsOn && isChecked) ? '' : 'none');
      const canalsOn = document.getElementById('toggle-canals')?.checked ?? true;
      markers.canals.forEach(m => m.getElement().style.display = (canalsOn && isChecked) ? '' : 'none');
      queueBadgePlacements();
      break;
    case "tunnels":
      setLayerVisibility('tunnels-casing', isChecked);
      setLayerVisibility('tunnels-line', isChecked);
      setLayerVisibility('tunnels-portals-layer', isChecked);
      setLayerVisibility('tunnels-hit-buffer', isChecked);
      markers.tunnels.forEach(m => m.getElement().style.display = (isChecked && showAllBadges) ? '' : 'none');
      queueBadgePlacements();
      break;
    case "canals":
      setLayerVisibility('canals-line', isChecked);
      setLayerVisibility('canals-hit-buffer', isChecked);
      markers.canals.forEach(m => m.getElement().style.display = (isChecked && showAllBadges) ? '' : 'none');
      queueBadgePlacements();
      break;
    case "streamflowGauges":
    case "streamflow-gauges":
      setLayerVisibility('streamflow-gauges-casing', isChecked);
      setLayerVisibility('streamflow-gauges-circle', isChecked);
      setLayerVisibility('streamflow-gauges-hit-buffer', isChecked);
      break;
    case "reservoirs":
      setLayerVisibility('lakes-fill', isChecked);
      setLayerVisibility('lakes-stroke', isChecked);
      markers.reservoirs.forEach(m => m.getElement().style.display = isChecked ? '' : 'none');
      break;
    case "dams":
      setLayerVisibility('dams-layer', isChecked);
      break;
    case "divide":
      setLayerVisibility('divide-line', isChecked);
      setLayerVisibility('divide-line-hit-buffer', isChecked);
      break;
    case "basin":
      setLayerVisibility('basin-line', isChecked);
      setLayerVisibility('basin-line-hit-buffer', isChecked);
      break;
  }
}

// ─── Google Earth Style Trackball Navigation Control ─────────────────────────
function initTrackballNavigation() {
  const wrapper = document.getElementById('trackball-wrapper');
  if (!wrapper || !map) return;

  let isDraggingOrb = false;
  let isDraggingRing = false;
  let startX = 0;
  let startY = 0;
  let startPitch = 0;
  let startBearing = 0;
  let startRingAngle = 0;
  let hasMoved = false;

  // 1. Sync visual trackball & compass orientation to map state
  window.updateTrackball = function() {
    if (!map) return;
    const bearing = map.getBearing();
    const pitch = map.getPitch();

    // Rotate compass ring strictly around (0, 0)
    const ring = document.getElementById('trackball-compass-ring');
    if (ring) {
      ring.setAttribute('transform', `rotate(${-bearing})`);
    }

    // Squash gimbal ellipse with 3D tilt perspective (Google Earth style)
    const ellipse = document.getElementById('trackball-pitch-ellipse');
    if (ellipse) {
      const ry = Math.max(2.8, 12 * Math.cos(pitch * Math.PI / 180));
      ellipse.setAttribute('ry', ry);
    }

    // Shift center pivot dot slightly up when tilted
    const pivot = document.getElementById('trackball-center-pivot');
    if (pivot) {
      const dy = (pitch / 65) * 5.0;
      pivot.setAttribute('cy', -dy);
    }
  };

  map.on('rotate', window.updateTrackball);
  map.on('pitch', window.updateTrackball);
  map.on('move', window.updateTrackball);

  // 2. Interactive Trackball Drag (Orbit, Tilt, and Bearing Spin)
  wrapper.addEventListener('pointerdown', (e) => {
    const rect = wrapper.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const distFromCenter = Math.hypot(e.clientX - cx, e.clientY - cy);

    hasMoved = false;
    startX = e.clientX;
    startY = e.clientY;
    startPitch = map.getPitch();
    startBearing = map.getBearing();

    if (distFromCenter < 18) {
      // User grabbed the inner trackball orb -> full 3D trackball orbit & tilt
      isDraggingOrb = true;
    } else {
      // User grabbed the outer compass ring -> bearing rotation
      isDraggingRing = true;
      startRingAngle = Math.atan2(e.clientX - cx, -(e.clientY - cy)) * (180 / Math.PI);
    }

    wrapper.classList.add('grabbing');
    wrapper.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  });

  wrapper.addEventListener('pointermove', (e) => {
    const rect = wrapper.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    if (isDraggingOrb) {
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      if (Math.hypot(deltaX, deltaY) > 2) {
        hasMoved = true;
      }

      // Vertical drag controls pitch (push up to tilt down into 3D horizon, pull down to level 2D)
      const newPitch = Math.max(0, Math.min(65, startPitch - deltaY * 0.55));
      if (newPitch > 0 && !map.getTerrain()) {
        map.setTerrain({ source: 'terrain-dem', exaggeration: 1.5 });
      } else if (newPitch === 0 && map.getTerrain()) {
        map.setTerrain(null);
      }
      map.setPitch(newPitch);

      // Horizontal drag orbits camera bearing
      const newBearing = (startBearing + deltaX * 0.55) % 360;
      map.setBearing(newBearing);

      window.updateTrackball();
    } else if (isDraggingRing) {
      const currentAngle = Math.atan2(e.clientX - cx, -(e.clientY - cy)) * (180 / Math.PI);
      const delta = currentAngle - startRingAngle;

      if (Math.abs(delta) > 1.5) {
        hasMoved = true;
      }

      map.setBearing((startBearing + delta) % 360);
      window.updateTrackball();
    }
  });

  const stopDrag = (e) => {
    if (isDraggingOrb || isDraggingRing) {
      isDraggingOrb = false;
      isDraggingRing = false;
      wrapper.classList.remove('grabbing');
      try { wrapper.releasePointerCapture(e.pointerId); } catch (_) {}

      // If clicked without dragging, click near North resets North
      if (!hasMoved) {
        window.resetNorth();
      }
    }
  };

  wrapper.addEventListener('pointerup', stopDrag);
  wrapper.addEventListener('pointercancel', stopDrag);

  // Double-click to reset everything (North-up and flat 2D)
  wrapper.addEventListener('dblclick', () => {
    map.easeTo({ bearing: 0, pitch: 0, duration: 600 });
  });

  // Initial sync
  window.updateTrackball();
}

window.resetNorth = function() {
  if (!map) return;
  map.easeTo({ bearing: 0, duration: 550 });
};

window.toggle3DMode = function() {
  if (!map) return;
  const currentPitch = map.getPitch();
  if (currentPitch >= 8) {
    // Already in 3D -> smoothly reset to flat 2D perspective
    map.easeTo({ pitch: 0, duration: 600 });
  } else {
    // Flat 2D -> engage 3D terrain and pitch camera to 50 degrees
    if (!map.getTerrain()) {
      map.setTerrain({ source: 'terrain-dem', exaggeration: 1.5 });
    }
    map.easeTo({ pitch: 50, duration: 800 });
  }
};

window.stepTilt = function(delta) {
  if (!map) return;
  const curPitch = map.getPitch();
  const targetPitch = Math.max(0, Math.min(65, curPitch + delta));
  if (targetPitch > 0 && !map.getTerrain()) {
    map.setTerrain({ source: 'terrain-dem', exaggeration: 1.5 });
  } else if (targetPitch === 0 && map.getTerrain()) {
    map.setTerrain(null);
  }
  map.easeTo({ pitch: targetPitch, duration: 400 });
};

// ==========================================================================
// Mobile & Desktop Collapsible Sidebar & Responsive UI Handlers
// ==========================================================================
window.toggleSidebar = function() {
  const panel = document.getElementById('sidebar-panel');
  const backdrop = document.getElementById('sidebar-backdrop');
  const btn = document.getElementById('sidebar-toggle-btn');
  if (!panel) return;

  const isMobile = window.innerWidth <= 900;
  if (isMobile) {
    const willOpen = !panel.classList.contains('mobile-open');
    panel.classList.toggle('mobile-open', willOpen);
    if (backdrop) backdrop.classList.toggle('show', willOpen);
    if (btn) btn.classList.toggle('active', willOpen);
    document.body.classList.toggle('sidebar-drawer-active', willOpen);
  } else {
    // Desktop collapse mode
    const willCollapse = !panel.classList.contains('desktop-collapsed');
    panel.classList.toggle('desktop-collapsed', willCollapse);
    if (btn) btn.classList.toggle('active', !willCollapse);
  }

  // Trigger MapLibre resize smoothly after transition
  setTimeout(() => {
    if (map) map.resize();
  }, 300);
};

window.closeSidebar = function() {
  const panel = document.getElementById('sidebar-panel');
  const backdrop = document.getElementById('sidebar-backdrop');
  const btn = document.getElementById('sidebar-toggle-btn');
  if (panel) {
    panel.classList.remove('mobile-open');
  }
  if (backdrop) {
    backdrop.classList.remove('show');
  }
  if (btn) {
    btn.classList.remove('active');
  }
  document.body.classList.remove('sidebar-drawer-active');

  setTimeout(() => {
    if (map) map.resize();
  }, 300);
};

window.toggleLegendMobile = function() {
  const legend = document.getElementById('map-legend');
  if (legend) {
    legend.classList.toggle('mobile-expanded');
  }
};

// Window resize listener to keep MapLibre updated & handle transitions
window.addEventListener('resize', () => {
  if (map) {
    map.resize();
  }
  if (window.innerWidth > 900) {
    const backdrop = document.getElementById('sidebar-backdrop');
    const panel = document.getElementById('sidebar-panel');
    if (panel) panel.classList.remove('mobile-open');
    if (backdrop) backdrop.classList.remove('show');
    document.body.classList.remove('sidebar-drawer-active');
  }
});


