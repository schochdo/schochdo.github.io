// Colorado River Basin Water Infrastructure & Hydrology Dashboard
// Powered by MapLibre GL JS with 3D DEM Terrain Option & Top-Down 2D Default

// ============================================================================
// Global Chart.js Visual Defaults (Edward Tufte / Editorial Standard)
// ============================================================================
if (typeof Chart !== 'undefined') {
  Chart.defaults.font.family = "'Inter', -apple-system, sans-serif";
  Chart.defaults.color = '#334155';
  Chart.defaults.borderColor = '#cbd5e1';
  Chart.defaults.animation = false;
  Chart.defaults.animations = false;
  Chart.defaults.transitions = false;

  if (Chart.defaults.scale && Chart.defaults.scale.grid) {
    Chart.defaults.scale.grid.color = '#e2e8f0';
  }
  if (Chart.defaults.scales) {
    if (Chart.defaults.scales.linear && Chart.defaults.scales.linear.grid) {
      Chart.defaults.scales.linear.grid.color = '#e2e8f0';
    }
    if (Chart.defaults.scales.category && Chart.defaults.scales.category.grid) {
      Chart.defaults.scales.category.grid.color = '#e2e8f0';
    }
  }

  if (Chart.defaults.plugins && Chart.defaults.plugins.tooltip) {
    const tt = Chart.defaults.plugins.tooltip;
    tt.backgroundColor = 'rgba(255, 255, 255, 0.98)';
    tt.titleColor = '#0f172a';
    tt.bodyColor = '#334155';
    tt.footerColor = '#64748b';
    tt.borderColor = '#cbd5e1';
    tt.borderWidth = 1;
    tt.cornerRadius = 3;
    tt.padding = 10;
    tt.usePointStyle = true;
    tt.boxWidth = 8;
    tt.boxHeight = 8;
    tt.boxPadding = 6;
  }
}

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
window.stationMarkers = stationMarkers;
let tooltipPopup;
let activeFeaturePopup = null;
let selectedReachId = null;
let selectedConduit = { type: null, id: null };
let selectedReservoirName = null;
let flashInterval = null;

function highlightSelectedReach(reachId) {
  selectedReachId = reachId || null;
  if (!map) return;
  const filter = selectedReachId ? ['==', ['get', 'reach'], selectedReachId] : ['==', ['get', 'reach'], ''];
  if (map.getLayer('rivers-selected-highlight-casing')) {
    map.setFilter('rivers-selected-highlight-casing', filter);
  }
  if (map.getLayer('rivers-selected-highlight-core')) {
    map.setFilter('rivers-selected-highlight-core', filter);
  }
}

function highlightSelectedConduit(type, id) {
  selectedConduit = { type: type || null, id: id || null };
  if (!map) return;
  const canalFilter = (type === 'canal' && id) ? ['==', ['get', 'id'], id] : ['==', ['get', 'id'], ''];
  const tunnelFilter = (type === 'tunnel' && id) ? ['==', ['get', 'id'], id] : ['==', ['get', 'id'], ''];
  
  if (map.getLayer('canals-selected-highlight-casing')) {
    map.setFilter('canals-selected-highlight-casing', canalFilter);
  }
  if (map.getLayer('canals-selected-highlight-core')) {
    map.setFilter('canals-selected-highlight-core', canalFilter);
  }
  if (map.getLayer('tunnels-selected-highlight-casing')) {
    map.setFilter('tunnels-selected-highlight-casing', tunnelFilter);
  }
  if (map.getLayer('tunnels-selected-highlight-core')) {
    map.setFilter('tunnels-selected-highlight-core', tunnelFilter);
  }
}

function highlightSelectedReservoir(gnisName) {
  selectedReservoirName = gnisName || null;
  if (!map) return;
  const filter = selectedReservoirName ? ['==', ['get', 'GNIS_NAME'], selectedReservoirName] : ['==', ['get', 'GNIS_NAME'], ''];
  if (map.getLayer('lakes-selected-highlight-fill')) {
    map.setFilter('lakes-selected-highlight-fill', filter);
  }
  if (map.getLayer('lakes-selected-highlight-stroke')) {
    map.setFilter('lakes-selected-highlight-stroke', filter);
  }
}

function flashFeatureHighlight(type) {
  if (flashInterval) {
    clearInterval(flashInterval);
    flashInterval = null;
  }
  let step = 0;
  flashInterval = setInterval(() => {
    step++;
    const opacity = (step % 2 === 1) ? 0.2 : 0.95;
    if (type === 'canal' && map.getLayer('canals-selected-highlight-casing')) {
      map.setPaintProperty('canals-selected-highlight-casing', 'line-opacity', opacity);
    } else if (type === 'tunnel' && map.getLayer('tunnels-selected-highlight-casing')) {
      map.setPaintProperty('tunnels-selected-highlight-casing', 'line-opacity', opacity);
    } else if (type === 'lake' && map.getLayer('lakes-selected-highlight-fill')) {
      map.setPaintProperty('lakes-selected-highlight-fill', 'fill-opacity', opacity * 0.9);
      if (map.getLayer('lakes-selected-highlight-stroke')) {
        map.setPaintProperty('lakes-selected-highlight-stroke', 'line-opacity', opacity);
      }
    }
    if (step >= 6) {
      clearInterval(flashInterval);
      flashInterval = null;
      if (type === 'canal' && map.getLayer('canals-selected-highlight-casing')) {
        map.setPaintProperty('canals-selected-highlight-casing', 'line-opacity', 0.95);
      } else if (type === 'tunnel' && map.getLayer('tunnels-selected-highlight-casing')) {
        map.setPaintProperty('tunnels-selected-highlight-casing', 'line-opacity', 0.95);
      } else if (type === 'lake') {
        if (map.getLayer('lakes-selected-highlight-fill')) map.setPaintProperty('lakes-selected-highlight-fill', 'fill-opacity', 0.85);
        if (map.getLayer('lakes-selected-highlight-stroke')) map.setPaintProperty('lakes-selected-highlight-stroke', 'line-opacity', 1.0);
      }
    }
  }, 220);
}

function clearReachHighlight() {
  if (flashInterval) {
    clearInterval(flashInterval);
    flashInterval = null;
  }
  highlightSelectedReach(null);
  highlightSelectedConduit(null, null);
  highlightSelectedReservoir(null);
}

function showFeaturePopup(popup, lngLat) {
  if (!map || !popup) return popup;
  if (tooltipPopup && tooltipPopup.isOpen()) {
    tooltipPopup.remove();
    currentTooltipHtml = null;
    activeHoverSource = null;
  }
  if (activeFeaturePopup && activeFeaturePopup.isOpen() && activeFeaturePopup !== popup) {
    const oldPopup = activeFeaturePopup;
    activeFeaturePopup = popup;
    oldPopup.remove();
  } else {
    activeFeaturePopup = popup;
  }
  popup.on('close', () => {
    if (activeFeaturePopup === popup) {
      activeFeaturePopup = null;
      clearReachHighlight();
    }
  });
  if (lngLat) {
    popup.setLngLat(lngLat);
  }
  popup.addTo(map);
  return popup;
}

let activeHoverSource = null;
let currentTooltipHtml = null;
let hoverDismissTimer = null;

const HOVER_PRIORITIES = {
  'dams': 100,
  'dams-layer': 100,
  'dams-hit-buffer': 100,
  'streamflow-gauges': 90,
  'streamflow-gauges-hit-buffer': 90,
  'gauge-badge': 90,
  'tunnels': 80,
  'tunnels-hit-buffer': 80,
  'tunnels-portals-layer': 80,
  'tunnel-badge': 80,
  'canals': 70,
  'canals-hit-buffer': 70,
  'canal-badge': 70,
  'rivers': 60,
  'rivers-mainstem-hit': 60,
  'rivers-major-hit': 60,
  'rivers-minor-hit': 60,
  'lakes': 50,
  'lakes-fill': 50,
  'divide-line-hit-buffer': 40,
  'basin-line-hit-buffer': 30
};

function showHoverTooltip(html, lngLat, sourceKey) {
  if (!tooltipPopup || !map) return;

  const key = sourceKey || 'default';
  const newPriority = HOVER_PRIORITIES[key] || 10;
  const currentPriority = activeHoverSource ? (HOVER_PRIORITIES[activeHoverSource] || 10) : 0;

  // If a higher-priority feature is already being hovered, do not let lower layers overwrite it
  if (activeHoverSource && newPriority < currentPriority) {
    return;
  }

  if (hoverDismissTimer) {
    clearTimeout(hoverDismissTimer);
    hoverDismissTimer = null;
  }

  activeHoverSource = key;

  if (map.getCanvas()) map.getCanvas().style.cursor = 'pointer';

  if (currentTooltipHtml !== html) {
    tooltipPopup.setHTML(html);
    currentTooltipHtml = html;
  }
  tooltipPopup.setLngLat(lngLat);
  if (!tooltipPopup.isOpen()) {
    tooltipPopup.addTo(map);
  }
}

function hideHoverTooltip(sourceKey) {
  // If a specific source is exiting, ignore dismissal if another feature is currently active
  if (sourceKey && activeHoverSource && sourceKey !== activeHoverSource) {
    return;
  }

  // Grace debounce allows seamless cursor motion between adjacent hit-boxes without strobe blinking
  if (hoverDismissTimer) clearTimeout(hoverDismissTimer);
  const delay = sourceKey ? 45 : 0;
  hoverDismissTimer = setTimeout(() => {
    activeHoverSource = null;
    currentTooltipHtml = null;
    if (map && map.getCanvas()) map.getCanvas().style.cursor = '';
    if (tooltipPopup && tooltipPopup.isOpen()) {
      tooltipPopup.remove();
    }
  }, delay);
}

function hasHigherPriorityFeature(point, layerIds) {
  if (!map) return false;
  const existingLayers = layerIds.filter(id => map.getLayer(id));
  if (!existingLayers.length) return false;
  try {
    const bbox = [[point.x - 7, point.y - 7], [point.x + 7, point.y + 7]];
    const hits = map.queryRenderedFeatures(bbox, { layers: existingLayers });
    return hits && hits.length > 0;
  } catch (err) {
    return false;
  }
}

function switchPopupTab(tabName, btn) {
  const container = btn?.closest('.custom-popup-body');
  if (!container) return;
  container.querySelectorAll('.popup-tab-btn').forEach(b => {
    b.classList.remove('active');
    b.style.fontWeight = '500';
    b.style.borderBottom = '2px solid transparent';
    b.style.color = '#5c5346';
  });
  btn.classList.add('active');
  btn.style.fontWeight = '700';
  btn.style.borderBottom = '2px solid #2b5c8f';
  btn.style.color = '#2b5c8f';
  const dataPane = container.querySelector('.popup-pane-data');
  const codePane = container.querySelector('.popup-pane-code');
  if (dataPane) dataPane.style.display = tabName === 'data' ? 'block' : 'none';
  if (codePane) codePane.style.display = tabName === 'code' ? 'block' : 'none';
}
window.switchPopupTab = switchPopupTab;

function copyPopupCode(btn, ev) {
  if (ev) ev.stopPropagation();
  const container = btn.closest('.popup-pane-code') || btn.closest('.popup-code-box') || btn.closest('.code-snippet-box');
  const codeEl = container?.querySelector('pre code');
  if (!codeEl) return;
  const text = codeEl.innerText;
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓ Copied!';
    btn.style.color = '#15803d';
    btn.style.background = '#f0fdf4';
    btn.style.borderColor = '#86efac';
    setTimeout(() => {
      btn.textContent = orig;
      btn.style.color = '';
      btn.style.background = '';
      btn.style.borderColor = '';
    }, 1800);
  });
}
const copySnippetCode = copyPopupCode;

function formatTabbedPopup({ dataHtml, codeTitle, endpointUrl, pythonCode, notes }) {
  if (!pythonCode) {
    return `
      <div class="custom-popup-body popup-single-card" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()" style="font-family:'Inter',sans-serif; min-width:240px; max-width:320px; border-radius:3px;">
        <div class="popup-pane-data">
          ${dataHtml}
        </div>
      </div>
    `;
  }
  const cleanCode = pythonCode.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `
    <div class="custom-popup-body" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()" style="font-family:'Inter',sans-serif; min-width:250px; max-width:320px; border-radius:2px;">
      <div style="display:flex; border-bottom:1px solid #cfc8ba; margin-bottom:8px;">
        <button class="popup-tab-btn active" onclick="switchPopupTab('data', this)" style="background:none; border:none; border-bottom:2px solid #2b5c8f; padding:4px 10px; font-size:11px; font-weight:700; color:#2b5c8f; cursor:pointer;">Data</button>
        <button class="popup-tab-btn" onclick="switchPopupTab('code', this)" style="background:none; border:none; border-bottom:2px solid transparent; padding:4px 10px; font-size:11px; font-weight:500; color:#5c5346; cursor:pointer;">API / Python</button>
      </div>
      <div class="popup-pane-data">
        ${dataHtml}
      </div>
      <div class="popup-pane-code" style="display:none;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:4px;">
          <div style="font-size:11px; font-weight:700; color:#0f172a;">${codeTitle || 'Python Query'}</div>
          <button class="popup-copy-btn" onclick="copyPopupCode(this, event)" style="background:#ffffff; border:1px solid #cfc8ba; color:#4f463a; font-size:9.5px; border-radius:2px; padding:2px 7px; cursor:pointer; font-weight:600; flex-shrink:0;">Copy</button>
        </div>
        ${notes ? `<div style="font-size:10.5px; color:#5c5346; margin-bottom:6px; line-height:1.35;">${notes}</div>` : ''}
        <div class="popup-code-box" style="background:#f2ede2; border:1px solid #cfc8ba; border-radius:2px; padding:8px; overflow:hidden;">
          <pre style="margin:0; font-family:ui-monospace,Menlo,monospace; font-size:10.5px; color:#0f172a; line-height:1.4; max-height:160px; overflow-y:auto; white-space:pre-wrap; padding-right:4px;"><code>${cleanCode}</code></pre>
        </div>
        ${endpointUrl ? `<div style="margin-top:6px; font-size:10px; color:#5c5346; word-break:break-all;"><strong style="color:#4f463a;">Endpoint:</strong> <a href="${endpointUrl}" target="_blank" rel="noopener" style="color:#2b5c8f; text-decoration:none; font-weight:600;">REST API URL ↗</a></div>` : ''}
      </div>
    </div>
  `;
}

let cachedGeography = null;
let cachedRiverNetwork = null;
let cachedLakes = null;
let cachedPowellContours = null;
let cachedNormals = null;
let cachedMetrics = null;
let activeMetrics = null;
window.cachedMetrics = null;
window.activeMetrics = null;

function getActivePowellElevation() {
  const p = (cachedMetrics?.reservoirs || activeMetrics?.reservoirs)?.find(r => r.id === 'lake_powell');
  return (p && p.elevation_ft) ? p.elevation_ft : 3574.0;
}

function getClosestPowellContourElevation(targetElev) {
  const slices = [3490, 3510, 3530, 3550, 3570, 3590, 3610, 3630, 3650, 3670, 3700];
  let closest = slices[0];
  let minDiff = Math.abs(targetElev - closest);
  for (const s of slices) {
    const diff = Math.abs(targetElev - s);
    if (diff < minDiff) {
      minDiff = diff;
      closest = s;
    }
  }
  return closest;
}

function updatePowellActiveLayers(metrics) {
  if (!map || !map.getLayer('lake-powell-active-pool')) return;
  const targetElev = metrics?.reservoirs?.find(r => r.id === 'lake_powell')?.elevation_ft || getActivePowellElevation();
  const closestSlice = getClosestPowellContourElevation(targetElev);
  try {
    map.setFilter('lake-powell-active-pool', ['==', ['get', 'pool_elev_ft'], closestSlice]);
    if (map.getLayer('lake-powell-active-stroke')) {
      map.setFilter('lake-powell-active-stroke', ['==', ['get', 'pool_elev_ft'], closestSlice]);
    }
  } catch (err) {
    console.warn('Error updating Powell active contour layers:', err);
  }
}

// Basemap configurations: default to Terrain with Labels (Esri World Terrain Base + Reference Overlay)
const basemapLayerKeys = [
  'esriTerrain', 'esriNatGeo', 'esriWorldTopo', 'esriPhysical',
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
    // Terrain with Labels active by default
    { id: 'layer-esriTerrain', type: 'raster', source: 'basemap-esriTerrain', layout: { visibility: 'visible' } },
    { id: 'layer-esriNatGeo', type: 'raster', source: 'basemap-esriNatGeo', layout: { visibility: 'none' } },
    { id: 'layer-esriWorldTopo', type: 'raster', source: 'basemap-esriWorldTopo', layout: { visibility: 'none' } },
    { id: 'layer-esriSatellite', type: 'raster', source: 'basemap-esriSatellite', layout: { visibility: 'none' } },
    { id: 'layer-openTopo', type: 'raster', source: 'basemap-openTopo', layout: { visibility: 'none' } },
    // Reference labels overlay (active for Terrain with Labels)
    { id: 'layer-labels', type: 'raster', source: 'basemap-labels', layout: { visibility: 'visible' }, paint: { 'raster-opacity': 0.85 } }
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
  try {
    // Default: clean 2D top-down orientation fit perfectly to the Upper and Lower Basin extents
    map = new maplibregl.Map({
      container: 'map',
      style: initialStyle,
      bounds: [[-116.65, 31.15], [-105.45, 43.65]],
      fitBoundsOptions: {
        padding: { top: 45, bottom: 45, left: 45, right: 45 },
        duration: 0,
        animate: false
      },
      pitch: 0,
      bearing: 0,
      minZoom: 4.5,
      maxZoom: 18.5,
      maxPitch: 80,
      attributionControl: false
    });
    window.map = map;
  } catch (mapErr) {
    console.warn("MapLibre WebGL canvas initialization warning:", mapErr);
    map = null;
    window.map = null;
  }

  // Pitch & orientation navigation controls
  if (map) {
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');

    // Shared hover tooltip popup (Non-blocking transparent to pointer events)
    tooltipPopup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'map-hover-tooltip',
      offset: 14
    });

    const canvas = map.getCanvas ? map.getCanvas() : null;
    if (canvas) {
      canvas.setAttribute('tabindex', '0');
      canvas.style.outline = 'none';
    }

    if (map.getContainer()) {
      map.getContainer().setAttribute('tabindex', '0');
      map.getContainer().addEventListener('mouseleave', () => {
        hideHoverTooltip();
      });
      map.getContainer().addEventListener('mouseenter', () => {
        window.focus();
        if (map && map.getCanvas) {
          const c = map.getCanvas();
          if (c && typeof c.focus === 'function') c.focus();
        }
      });
    }

    // 60 FPS 3D Game-Engine Keyboard Flight Controller - activated immediately on map creation
    if (typeof initKeyboardFlight === 'function') {
      window.keyboardFlightCleanup = initKeyboardFlight(map, {
        onPitchChange: (p) => {
          if (p > 5 && !map.getTerrain()) {
            map.setTerrain({ source: 'terrain-dem', exaggeration: 1.5 });
          } else if (p === 0 && map.getTerrain()) {
            map.setTerrain(null);
          }
          if (typeof window.updateTrackball === 'function') window.updateTrackball();
        },
        onBearingChange: () => {
          if (typeof window.updateTrackball === 'function') window.updateTrackball();
        }
      });
    }

    // Google Earth Style Trackball Navigation - initialized immediately
    if (typeof initTrackballNavigation === 'function') {
      initTrackballNavigation();
    }

    window.addEventListener('load', () => {
      window.focus();
      if (map && map.getCanvas) {
        const c = map.getCanvas();
        if (c && typeof c.focus === 'function') c.focus();
      }
    });

    map.on('click', (e) => {
      if (e.originalEvent && e.originalEvent._handled) return;
      clearReachHighlight();
      if (activeFeaturePopup && activeFeaturePopup.isOpen()) {
        activeFeaturePopup.remove();
        activeFeaturePopup = null;
      }
    });

    map.on('load', () => {
      if (isTilted) {
        map.setTerrain({
          source: 'terrain-dem',
          exaggeration: 1.5
        });
      }

      loadData();
      initTableResizer();
      initLayersHoverBehavior();
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
      zoomToPreset('basin', true);
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
    if (window.location.search.includes('zoom_to=confluence')) {
      map.jumpTo({ center: [-109.878, 38.19], zoom: 10.5 });
    }
    if (window.location.search.includes('zoom_to=lake_powell')) {
      map.jumpTo({ center: [-111.48, 36.94], zoom: 10 });
    }
    if (window.location.search.includes('flow_direction=1') || window.location.search.includes('flow_arrows=1')) {
      const toggle = document.getElementById("toggle-flow-arrows") || document.getElementById("toggle-gis-flow-arrows");
      if (toggle) {
        toggle.checked = true;
        toggleLayer("flowArrows");
      }
    }
    if (window.location.search.includes('topology_junctions=1') || window.location.search.includes('confluences=1')) {
      const toggle = document.getElementById("toggle-topology-junctions");
      if (toggle) {
        toggle.checked = true;
        toggleLayer("topologyJunctions");
      }
    }
    if (window.location.search.includes('topology_sections=1') || window.location.search.includes('gis_nodes=1')) {
      const toggle = document.getElementById("toggle-topology-sections");
      if (toggle) {
        toggle.checked = true;
        toggleLayer("topologySections");
      }
    }
    syncLegendToLayerToggles();
  });

  map.on('move', queueBadgePlacements);
  map.on('zoom', queueBadgePlacements);
  map.on('resize', queueBadgePlacements);
  map.on('pitch', syncPerspectiveState);
  map.on('movestart', () => hideHoverTooltip());
  map.on('zoomstart', () => hideHoverTooltip());
  }

  // Always kick off hydrology and geography ingestion immediately
  loadData();
  initLayersHoverBehavior();
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

  ensurePointLayersOnTop();

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
    const txt = baseAttributions[key] || baseAttributions.esriTerrain;
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
    safeEaseTo(map, {
      pitch: deg,
      bearing: map.getBearing() !== 0 ? map.getBearing() : -8,
      duration: 600
    });
  } else {
    // Return to flat 2D
    safeEaseTo(map, {
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
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  const dropdown = document.getElementById("map-menu-dropdown");
  const btn = document.getElementById("map-menu-btn");
  if (!dropdown) return;

  const isShowing = dropdown.classList.contains("show");
  if (!isShowing) {
    // Both drawers can cleanly coexist side-by-side; Basin Metrics stays open
    openMapMenuVisual();
  } else {
    closeMapMenu();
  }
}

function openMapMenuVisual() {
  const dropdown = document.getElementById("map-menu-dropdown");
  const btn = document.getElementById("map-menu-btn");
  if (dropdown) dropdown.classList.add("show");
  if (btn) btn.classList.add("active");
  document.body.classList.add("map-menu-active");
}

function closeMapMenu() {
  const dropdown = document.getElementById("map-menu-dropdown");
  const btn = document.getElementById("map-menu-btn");
  if (dropdown) dropdown.classList.remove("show");
  if (btn) btn.classList.remove("active");
  document.body.classList.remove("map-menu-active");
}

function initLayersHoverBehavior() {
  // Sticky click-only behavior: dismiss map controls when clicking outside
  document.addEventListener("click", (e) => {
    const dropdown = document.getElementById("map-menu-dropdown");
    const btn = document.getElementById("map-menu-btn");
    if (!dropdown || !dropdown.classList.contains("show")) return;
    if (btn && btn.contains(e.target)) return;
    if (dropdown.contains(e.target)) return;
    closeMapMenu();
  });
}

function switchMapMenuTab(tabName, e) {
  if (e) e.stopPropagation();
  const tabLayers = document.getElementById("tab-btn-layers");
  const tabBasemaps = document.getElementById("tab-btn-basemaps");
  const paneLayers = document.getElementById("pane-layers");
  const paneBasemaps = document.getElementById("pane-basemaps");

  if (tabName === "layers") {
    if (tabLayers) tabLayers.classList.add("active");
    if (tabBasemaps) tabBasemaps.classList.remove("active");
    if (paneLayers) paneLayers.style.display = "flex";
    if (paneBasemaps) paneBasemaps.style.display = "none";
  } else {
    if (tabLayers) tabLayers.classList.remove("active");
    if (tabBasemaps) tabBasemaps.classList.add("active");
    if (paneLayers) paneLayers.style.display = "none";
    if (paneBasemaps) paneBasemaps.style.display = "flex";
  }
}

// Close map menu on click outside or escape key
document.addEventListener("click", (e) => {
  const dropdown = document.getElementById("map-menu-dropdown");
  const btn = document.getElementById("map-menu-btn");
  if (dropdown && dropdown.classList.contains("show")) {
    if (!dropdown.contains(e.target) && (!btn || !btn.contains(e.target))) {
      closeMapMenu();
    }
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const container = document.getElementById("map-menu-container");
    const dropdown = document.getElementById("map-menu-dropdown");
    const btn = document.getElementById("map-menu-btn");
    if (container) container.classList.remove("open");
    if (dropdown) dropdown.classList.remove("show");
    if (btn) btn.classList.remove("active");
  }
});

async function fetchLiveUSGS() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    // Exclude discontinued / dead stations: 09423000 (Davis Dam), 09427520 (Parker Dam), 09421500 (Hoover Dam), 09400000 (Winslow), 09307000 (Ouray dup)
    const sites = "09034250,09058000,09070500,09085100,09095500,09163500,09180500,09380000,09402500,09404200,09429100,09429500,09211200,09217000,09234500,09261000,09315000,09260050,09306500,09302000,09128000,09152500,09180000,09355500,09364500,09365000,09368000,09379500,09085000,09070000,09057500,09382000,09402000,09415000,09426000,09474000,09520500,09498500,09511300,09527700,09379900,09422500,09427500,09010500,09046600,09050700,09080400,09114500,09166500,09169500,09188500,09209400,09251000,09272400,09502000,09506000,09510000,09342500,09037500,09041400,09033300,09149500,09260000,09304500,09314500,09328500,09333500,09337500,09384000,09403850,09404115,09406000,09419000,09471000";
    const url = `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${sites}&parameterCd=00060,62614,00054&siteStatus=all`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`USGS HTTP ${res.status}`);
    const data = await res.json();
    const siteNames = {
      // Mainstem USGS Gages
      "09010500": "Colorado River below Baker Gulch near Grand Lake, CO",
      "09034250": "Colorado River at Windy Gap near Granby, CO",
      "09058000": "Colorado River near Kremmling, CO",
      "09070500": "Colorado River near Dotsero, CO",
      "09085100": "Colorado River below Glenwood Springs, CO",
      "09095500": "Colorado River near Cameo, CO",
      "09163500": "Colorado River near CO-UT State Line",
      "09180500": "Colorado River near Cisco, UT",
      "09380000": "Colorado River at Lees Ferry, AZ",
      "09402500": "Colorado River near Grand Canyon, AZ (Phantom Ranch)",
      "09404200": "Colorado River above Diamond Creek near Peach Springs, AZ",
      "09429100": "Colorado River below Palo Verde Dam, AZ-CA",
      "09429500": "Colorado River below Imperial Dam, AZ-CA",
      // Major Upper Basin Tributaries
      "09188500": "Green River at Warren Bridge near Daniel, WY",
      "09209400": "Green River near La Barge, WY",
      "09211200": "Green River below Fontenelle Reservoir, WY",
      "09217000": "Green River near Green River, WY",
      "09234500": "Green River near Greendale, UT (Flaming Gorge Dam)",
      "09251000": "Yampa River near Maybell, CO",
      "09260050": "Yampa River at Deerlodge Park, CO",
      "09261000": "Green River near Jensen, UT (below Yampa)",
      "09272400": "Green River at Ouray, UT",
      "09304500": "White River near Meeker, CO",
      "09306500": "White River near Watson, UT",
      "09302000": "Duchesne River near Randlett, UT",
      "09314500": "Price River at Woodside, UT",
      "09315000": "Green River at Green River, UT",
      "09328500": "San Rafael River near Green River, UT",
      "09333500": "Dirty Devil River near Hanksville, UT",
      "09337500": "Escalante River near Escalante, UT",
      "09114500": "Gunnison River near Gunnison, CO",
      "09128000": "Gunnison River below Gunnison Tunnel, CO",
      "09149500": "Uncompahgre River at Delta, CO",
      "09152500": "Gunnison River near Grand Junction, CO",
      "09166500": "Dolores River at Dolores, CO",
      "09169500": "Dolores River at Bedrock, CO",
      "09180000": "Dolores River near Cisco, UT",
      "09342500": "San Juan River at Pagosa Springs, CO",
      "09355500": "San Juan River near Archuleta, NM",
      "09364500": "Animas River at Farmington, NM",
      "09365000": "San Juan River at Farmington, NM",
      "09368000": "San Juan River at Shiprock, NM",
      "09379500": "San Juan River near Bluff, UT",
      // Headwaters & West Slope Tributaries
      "09033300": "Fraser River below Crooked Creek at Tabernash, CO",
      "09046600": "Blue River near Dillon, CO",
      "09050700": "Blue River below Dillon, CO",
      "09080400": "Fryingpan River near Ruedi, CO",
      "09085000": "Roaring Fork River at Glenwood Springs, CO",
      "09070000": "Eagle River below Gypsum, CO",
      "09057500": "Blue River below Green Mtn Reservoir, CO",
      "09037500": "Williams Fork near Parshall, CO",
      "09041400": "Muddy Creek below Wolford Mountain Reservoir, CO",
      "09260000": "Little Snake River near Lily, CO",
      // Grand Canyon, Desert & Lower Basin Tributaries
      "09382000": "Paria River at Lees Ferry, AZ",
      "09384000": "Little Colorado River above Lyman Lake near St. Johns, AZ",
      "09402000": "Little Colorado River near Cameron, AZ",
      "09403850": "Kanab Creek above mouth near Supai, AZ",
      "09404115": "Havasu Creek above mouth near Supai, AZ",
      "09406000": "Virgin River at Virgin, UT",
      "09415000": "Virgin River at Littlefield, AZ",
      "09419000": "Muddy River near Glendale, NV",
      "09426000": "Bill Williams River below Alamo Dam, AZ",
      "09471000": "San Pedro River at Charleston, AZ",
      "09474000": "Gila River at Kelvin, AZ",
      "09520500": "Gila River near Dome, AZ",
      "09498500": "Salt River near Roosevelt, AZ",
      "09502000": "Salt River below Stewart Mountain Dam, AZ",
      "09506000": "Verde River near Camp Verde, AZ",
      "09510000": "Verde River below Bartlett Dam, AZ",
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
          const ageHours = (Date.now() - new Date(latest.dateTime).getTime()) / (1000 * 3600);
          const data_status = ageHours <= 6 ? 'live' : (ageHours <= 72 ? 'daily' : (ageHours <= 336 ? 'delayed' : 'offline'));
          const flow = data_status !== 'offline' ? val : null;

          if (code === "09527700" && param === "00060") {
            aac = { id: code, name, type: "diversion_canal", destination: "Imperial & Coachella Valleys", provider: "USGS", flow_cfs: flow, timestamp: latest.dateTime, age_hours: Math.round(ageHours * 10) / 10, data_status, lat, lon };
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
            streamflows.push({
              id: code,
              name,
              type: "streamflow",
              provider: "USGS",
              flow_cfs: flow,
              timestamp: latest.dateTime,
              age_hours: Math.round(ageHours * 10) / 10,
              data_status,
              lat,
              lon
            });
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
    return category === "mainstem" ? 4.4 : (category === "major_tributary" ? 3.2 : 2.4);
  }
  if (category === "mainstem") {
    return Math.round(Math.min(13.0, Math.max(4.4, 3.2 + Math.sqrt(flowCfs) * 0.085)) * 10) / 10;
  } else if (category === "major_tributary") {
    return Math.round(Math.min(8.0, Math.max(3.2, 2.4 + Math.sqrt(flowCfs) * 0.07)) * 10) / 10;
  } else {
    return Math.round(Math.min(4.8, Math.max(2.4, 1.8 + Math.sqrt(flowCfs) * 0.055)) * 10) / 10;
  }
}

function computeTunnelWeight(flowCfs) {
  // Proportional line width scaled with flow; minimum 2.5px so zero/low-flow tunnels are clearly visible and clickable
  if (!flowCfs || flowCfs <= 0) return 2.5;
  return Math.min(8.0, 2.5 + Math.sqrt(flowCfs) * 0.28);
}

function computeCanalWeight(flowCfs) {
  // Proportional square-root scaling matching our river & tunnel hydrology;
  // 2.2px minimum keeps shut-down/maintenance canals clearly visible and clickable
  if (!flowCfs || flowCfs <= 0) return 2.2;
  return Math.round(Math.min(7.5, Math.max(2.2, 1.8 + Math.sqrt(flowCfs) * 0.065)) * 10) / 10;
}

// 3-Tier Hydrologic Station Observation Resolver
function resolveStation(st) {
  if (!st) {
    return {
      flow_cfs: null,
      status: 'offline',
      timestamp: null,
      age_hours: 999999,
      source_label: 'Station Offline'
    };
  }
  const ts = st.timestamp || null;
  let age = st.age_hours;
  if (age == null && ts) {
    age = Math.max(0, (Date.now() - new Date(ts).getTime()) / (1000 * 3600));
  }
  age = age != null ? Math.round(age * 10) / 10 : 999999;
  
  let status = st.data_status;
  if (!status) {
    if (age <= 6) status = 'live';
    else if (age <= 72) status = 'daily';
    else if (age <= 336) status = 'delayed';
    else status = 'offline';
  }
  
  const rawFlow = st.flow_cfs;
  const isInvalidFlow = rawFlow == null || isNaN(rawFlow) || rawFlow < 0;
  
  if (status === 'offline' || isInvalidFlow || age > 336) {
    return {
      flow_cfs: null,
      status: 'offline',
      timestamp: ts,
      age_hours: age,
      source_label: 'Station Offline'
    };
  }
  
  let sourceLabel = 'USGS Gage';
  if (st.provider === 'USBR' || (st.id && String(st.id).startsWith('USBR'))) {
    sourceLabel = 'USBR Hourly Dam Release';
  } else if (st.provider === 'CDWR' || (st.id && String(st.id).endsWith('TUNCO'))) {
    sourceLabel = 'CDWR HydroBase';
  } else if (status === 'delayed') {
    sourceLabel = 'Delayed Feed';
  } else if (status === 'daily') {
    sourceLabel = 'USGS Daily Mean';
  }
  
  return {
    flow_cfs: rawFlow,
    status: status,
    timestamp: ts,
    age_hours: age,
    source_label: sourceLabel
  };
}

function applyLiveHydrology(riverNetwork, metrics) {
  if (!riverNetwork || !riverNetwork.features || !metrics) return;
  if (window.FlowReplayEngine && window.FlowReplayEngine.isOpen) return;
  
  const streamflows = metrics.streamflows || [];
  const byId = {};
  streamflows.forEach(s => { byId[s.id] = s; });

  const kremmling = byId["09058000"];
  const dotsero = byId["09070500"];
  const cameo = byId["09095500"];
  const stateLine = byId["09163500"];
  const cisco = byId["09180500"];
  const leesFerry = byId["09380000"];
  const paloVerde = byId["09429100"];

  const greenUpper = byId["09234500"];
  const greenJensen = byId["09261000"];
  const green = byId["09315000"];
  const yampa = byId["09260050"];
  const white = byId["09306500"];
  const duchesne = byId["09302000"];
  const gunnisonUpper = byId["09128000"];
  const gunnison = byId["09152500"];
  const dolores = byId["09180000"];
  const sanjuanUpper = byId["09355500"];
  const sanjuan = byId["09379500"];
  const animas = byId["09364500"];

  const roaringFork = byId["09085000"];
  const eagle = byId["09070000"];
  const blue = byId["09057500"];

  const littleColorado = byId["09402000"];
  const virgin = byId["09415000"];
  const billWilliams = byId["09426000"];
  const gilaKelvin = byId["09474000"];
  const gilaDome = byId["09520500"];
  const salt = byId["09498500"];
  const verde = byId["09511300"];

  // Key Monitoring Gauges
  const windyGap = byId["09034250"];
  const williamsForkGage = byId["09037500"];
  const muddyCreekGage = byId["09041400"];
  const glenwoodBelow = byId["09085100"];
  const fontenelle = byId["09211200"];
  const greenRiverWY = byId["09217000"];
  const greenOuray = byId["09307000"];
  const paria = byId["09382000"];
  const phantomRanch = byId["09402500"];
  const diamondCreek = byId["09404200"];
  const sanjuanFarmington = byId["09365000"];
  const sanjuanShiprock = byId["09368000"];
  const imperialTailrace = byId["09429500"];

  const headwatersBaker = byId["09010500"];
  const blueDillonIn = byId["09046600"];
  const blueDillonDam = byId["09050700"];
  const fryingpanRuedi = byId["09080400"];
  const gunnisonHead = byId["09114500"];
  const doloresDolores = byId["09166500"];
  const doloresBedrock = byId["09169500"];
  const greenDaniel = byId["09188500"];
  const greenLaBarge = byId["09209400"];
  const yampaMaybell = byId["09251000"];
  const greenOurayGage = byId["09272400"];
  const sanjuanPagosa = byId["09342500"];

  // USBR Lower Colorado Dam Hydroelectric Tailrace Releases
  const hooverDam = byId["USBR_HOOVER"] || byId["USBR-HOOVER"] || metrics.dam_releases?.hoover_dam;
  const davisDam = byId["USBR_DAVIS"] || byId["USBR-DAVIS"] || metrics.dam_releases?.davis_dam;
  const parkerDam = byId["USBR_PARKER"] || byId["USBR-PARKER"] || metrics.dam_releases?.parker_dam;

  const saltStewart = byId["09502000"];
  const verdeCamp = byId["09506000"];
  const verdeBartlett = byId["09510000"];
  const priceRiverGage = byId["09314500"];
  const sanRafaelGage = byId["09328500"];
  const dirtyDevilGage = byId["09333500"];
  const escalanteGage = byId["09337500"];
  const muddyRiverGage = byId["09419000"];
  const havasuCreekGage = byId["09404115"];
  const kanabCreekGage = byId["09403850"];
  const littleSnakeGage = byId["09260000"];
  const uncompahgreGage = byId["09149500"];
  const fraserGage = byId["09033300"];
  const sanPedroGage = byId["09471000"];

  riverNetwork.features.forEach(f => {
    const r = f.properties.reach;
    const cat = f.properties.category || "minor_tributary";
    let flow = null;
    let status = "offline";
    let sourceLabel = "Station Offline";
    let gaugeInfo = f.properties.notes || "";
    let timestamp = null;
    let gaugeId = f.properties.gauge_id || null;
    let confluenceInfo = null;

    if (f.properties.reach_type === "submerged_path" || r.endsWith("_submerged_path")) {
      flow = 0;
      status = "submerged";
      sourceLabel = "Submerged River Channel (Impounded Pool)";
      gaugeInfo = f.properties.notes || "Submerged river canyon bed impounded behind reservoir dam";
      timestamp = null;
      gaugeId = null;
    } else if (r === "headwaters") {
      const res = resolveStation(headwatersBaker);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09010500 below Baker Gulch near Grand Lake, CO";
      gaugeId = "09010500";
    } else if (r === "colorado_granby_windygap") {
      const res = resolveStation(windyGap);
      flow = res.flow_cfs != null ? Math.round(res.flow_cfs * 0.9) : null;
      status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "Colorado River below Granby Dam past Fraser River confluence to Windy Gap Dam";
      gaugeId = "09034250";
      if (flow != null && headwatersBaker && headwatersBaker.flow_cfs != null) {
        confluenceInfo = {
          confluence_name: "Fraser River Confluence above Windy Gap",
          mainstem_upstream: { name: "Granby Dam Release", cfs: headwatersBaker.flow_cfs },
          tributary: { name: "Fraser River", cfs: Math.max(0, Math.round(flow - headwatersBaker.flow_cfs)) },
          downstream_gage: "Windy Gap Dam"
        };
      }
    } else if (r === "colorado_windygap_kremmling") {
      const rK = resolveStation(kremmling);
      const rB = resolveStation(blue);
      const rW = resolveStation(windyGap);
      if (rK.flow_cfs != null && rB.flow_cfs != null) {
        flow = Math.max(0, Math.round(rK.flow_cfs - rB.flow_cfs));
        status = (rK.status === 'delayed' || rB.status === 'delayed') ? 'delayed' : 'live';
        timestamp = rK.timestamp; sourceLabel = "USGS Mass Balance";
      } else if (rW.flow_cfs != null) {
        flow = rW.flow_cfs; status = rW.status; timestamp = rW.timestamp; sourceLabel = rW.source_label;
      }
      gaugeInfo = "USGS #09034250 at Windy Gap near Granby, CO past Williams Fork to Kremmling";
      gaugeId = "09034250";
      if (flow != null && rW.flow_cfs != null && williamsForkGage && williamsForkGage.flow_cfs != null) {
        confluenceInfo = {
          confluence_name: "Windy Gap Tailwater & Williams Fork Accretion",
          mainstem_upstream: { name: "Windy Gap Dam Release", cfs: rW.flow_cfs },
          tributary: { name: "Williams Fork River", cfs: williamsForkGage.flow_cfs },
          downstream_gage: "Kremmling"
        };
      }
    } else if (r === "williams_fork") {
      const res = resolveStation(williamsForkGage);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09037500 Williams Fork near Parshall, CO (below reservoir)";
      gaugeId = "09037500";
    } else if (r === "muddy_creek_co") {
      const res = resolveStation(muddyCreekGage);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09041400 Muddy Creek below Wolford Mountain Reservoir, CO";
      gaugeId = "09041400";
    } else if (r === "gore_canyon") {
      const res = resolveStation(kremmling);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09058000 near Kremmling, CO through Gore Canyon (post-Blue River & Muddy Creek confluences)";
      gaugeId = "09058000";
      if (flow != null && windyGap && windyGap.flow_cfs != null && blue && blue.flow_cfs != null) {
        confluenceInfo = {
          confluence_name: "Blue River & Muddy Creek Confluences at Kremmling",
          mainstem_upstream: { name: "Granby to Kremmling", cfs: Math.round(windyGap.flow_cfs + (williamsForkGage?.flow_cfs || 0)) },
          tributary: { name: "Blue River + Muddy Creek", cfs: Math.round(blue.flow_cfs + (muddyCreekGage?.flow_cfs || 0)) },
          downstream_gage: "Gore Canyon"
        };
      }
    } else if (r === "colorado_glenwood_canyon") {
      const res = resolveStation(dotsero);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09070500 near Dotsero, CO (Glenwood Canyon below Eagle River)";
      gaugeId = "09070500";
      if (flow != null && kremmling && kremmling.flow_cfs != null && eagle && eagle.flow_cfs != null) {
        confluenceInfo = {
          confluence_name: "Eagle River Confluence at Dotsero",
          mainstem_upstream: { name: "Gore Canyon", cfs: kremmling.flow_cfs },
          tributary: { name: "Eagle River", cfs: eagle.flow_cfs },
          downstream_gage: "Dotsero"
        };
      }
    } else if (r === "glenwood_cameo" || r === "cameo_grand_junction" || r === "colorado_glenwood_springs") {
      const res = resolveStation(cameo);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09095500 near Cameo, CO (Grand Valley above Gunnison Confluence)";
      gaugeId = "09095500";
      if (flow != null && dotsero && dotsero.flow_cfs != null && roaringFork && roaringFork.flow_cfs != null) {
        confluenceInfo = {
          confluence_name: "Roaring Fork Confluence at Glenwood Springs",
          mainstem_upstream: { name: "Glenwood Canyon (Dotsero)", cfs: dotsero.flow_cfs },
          tributary: { name: "Roaring Fork River", cfs: roaringFork.flow_cfs },
          downstream_gage: "Cameo"
        };
      }
    } else if (r === "colorado_stateline_cisco") {
      const res = resolveStation(stateLine);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09163500 near CO-UT State Line (below Gunnison Confluence)";
      gaugeId = "09163500";
      if (flow != null && cameo && cameo.flow_cfs != null && gunnison && gunnison.flow_cfs != null) {
        confluenceInfo = {
          confluence_name: "Gunnison River Confluence at Grand Junction",
          mainstem_upstream: { name: "Colorado River (Cameo)", cfs: cameo.flow_cfs },
          tributary: { name: "Gunnison River", cfs: gunnison.flow_cfs },
          downstream_gage: "State Line"
        };
      }
    } else if (r === "grand_valley_cisco") {
      const res = resolveStation(cisco);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09180500 near Cisco, UT (below Dolores River Confluence)";
      gaugeId = "09180500";
      if (flow != null && stateLine && stateLine.flow_cfs != null && dolores && dolores.flow_cfs != null) {
        confluenceInfo = {
          confluence_name: "Dolores River Confluence near Dewey",
          mainstem_upstream: { name: "Colorado River at State Line", cfs: stateLine.flow_cfs },
          tributary: { name: "Dolores River", cfs: dolores.flow_cfs },
          downstream_gage: "Cisco, UT"
        };
      }
    } else if (r === "cataract_canyon") {
      const rC = resolveStation(cisco);
      const rG = resolveStation(green);
      if (rC.flow_cfs != null && rG.flow_cfs != null) {
        flow = Math.round(rC.flow_cfs + rG.flow_cfs);
        status = (rC.status === 'delayed' || rG.status === 'delayed') ? 'delayed' : 'live';
        timestamp = rC.timestamp || rG.timestamp;
        sourceLabel = "Confluence Mass Balance (Live)";
      } else {
        flow = null; status = "offline"; timestamp = null; sourceLabel = "Station Offline (Incomplete Gages)";
      }
      gaugeInfo = "Colorado River (Cisco, UT) + Green River (Green River, UT) into Lake Powell";
      gaugeId = "09180500";
      if (flow != null) {
        confluenceInfo = {
          confluence_name: "Green River Confluence (Canyonlands The Maze)",
          mainstem_upstream: { name: "Colorado River above Confluence", cfs: rC.flow_cfs },
          tributary: { name: "Green River", cfs: rG.flow_cfs },
          downstream_gage: "Cataract Canyon"
        };
      }
    } else if (r === "lees_ferry") {
      const res = resolveStation(leesFerry);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp;
      sourceLabel = res.status === 'offline' ? 'Station Offline' : 'USGS Gage (1922 Compact Divide)';
      gaugeInfo = "USGS #09380000 at Lees Ferry, AZ (Glen Canyon Release)";
      gaugeId = "09380000";
    } else if (r === "marble_canyon") {
      const rLf = resolveStation(leesFerry);
      const rP = resolveStation(paria);
      if (rLf.flow_cfs != null) {
        flow = Math.round(rLf.flow_cfs + (rP.flow_cfs || 0));
        status = rLf.status; timestamp = rLf.timestamp; sourceLabel = "Mass Balance (Lees Ferry + Paria)";
      } else {
        flow = null; status = "offline"; timestamp = null; sourceLabel = "Station Offline";
      }
      gaugeInfo = `USGS #09380000 at Lees Ferry + USGS #09382000 Paria River`;
      gaugeId = "09380000";
      if (flow != null && rLf.flow_cfs != null) {
        confluenceInfo = {
          confluence_name: "Paria River Confluence at Lees Ferry (Mile 0.7)",
          mainstem_upstream: { name: "Colorado River at Lees Ferry (Glen Canyon Release)", cfs: rLf.flow_cfs },
          tributary: { name: "Paria River", cfs: rP.flow_cfs || 0 },
          downstream_gage: "Marble Canyon"
        };
      }
    } else if (r === "grand_canyon_upper") {
      const res = resolveStation(phantomRanch);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09402500 near Grand Canyon, AZ (Phantom Ranch, Mile 88 below Little Colorado)";
      gaugeId = "09402500";
      if (flow != null && leesFerry && leesFerry.flow_cfs != null && littleColorado && littleColorado.flow_cfs != null) {
        confluenceInfo = {
          confluence_name: "Little Colorado River Confluence in Marble Canyon (Mile 61.5)",
          mainstem_upstream: { name: "Marble Canyon (Lees Ferry + Paria)", cfs: Math.round(leesFerry.flow_cfs + (paria?.flow_cfs || 0)) },
          tributary: { name: "Little Colorado River", cfs: littleColorado.flow_cfs },
          downstream_gage: "Phantom Ranch"
        };
      }
    } else if (r === "grand_canyon") {
      const res = resolveStation(phantomRanch);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp;
      sourceLabel = res.status === 'offline' ? 'Station Offline' : 'USGS Gage (Phantom Ranch Control)';
      gaugeInfo = "USGS #09402500 near Grand Canyon, AZ (Phantom Ranch, Mile 88; Granite Gorges to Diamond Creek)";
      gaugeId = "09402500";
    } else if (r === "grand_canyon_lower") {
      const res = resolveStation(diamondCreek);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp;
      sourceLabel = res.status === 'offline' ? 'Station Offline' : 'USGS Gage (Diamond Creek Compliance)';
      gaugeInfo = "USGS #09404200 above Diamond Creek near Peach Springs, AZ (Mile 225 Compliance into Lake Mead)";
      gaugeId = "09404200";
      if (flow != null && phantomRanch && phantomRanch.flow_cfs != null) {
        confluenceInfo = {
          confluence_name: "Diamond Creek Compliance & Canyon Wave Propagation",
          mainstem_upstream: { name: "Upstream Crest (Phantom Ranch, Mile 88)", cfs: Math.round(phantomRanch.flow_cfs) },
          tributary: { name: "Wave Transit Lag (137-Mile Canyon Travel Delay)", cfs: Math.round(flow - phantomRanch.flow_cfs) },
          downstream_gage: "Diamond Creek"
        };
      }
    } else if (r === "lower_basin_hoover_davis" || r === "lower_basin_upper") {
      const res = resolveStation(hooverDam);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp;
      sourceLabel = res.status === 'offline' ? 'Station Offline' : 'USBR Hourly Dam Release';
      gaugeInfo = "USBR Hoover Dam Hydroelectric Release (USBR Lower Colorado Hourly Operations)";
      gaugeId = "USBR-HOOVER";
    } else if (r === "lower_basin_davis_parker") {
      const res = resolveStation(davisDam);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp;
      sourceLabel = res.status === 'offline' ? 'Station Offline' : 'USBR Hourly Dam Release';
      gaugeInfo = "USBR Davis Dam Hydroelectric Release (USBR Lower Colorado Hourly Operations past Laughlin/Needles to Lake Havasu)";
      gaugeId = "USBR-DAVIS";
    } else if (r === "lower_basin_parker_paloverde" || r === "lower_basin_middle") {
      const res = resolveStation(parkerDam);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp;
      sourceLabel = res.status === 'offline' ? 'Station Offline' : 'USBR Hourly Dam Release (Post-Havasu Diversions)';
      gaugeInfo = "USBR Parker Dam Hydroelectric Release (Downstream of CAP & CRA Diversions)";
      gaugeId = "USBR-PARKER";
      if (flow != null && davisDam && davisDam.flow_cfs != null) {
        confluenceInfo = {
          confluence_name: "Lake Havasu Mass Balance & Parker Dam Release",
          mainstem_upstream: { name: "Davis Dam Inflow", cfs: Math.round(davisDam.flow_cfs) },
          tributary: { name: "CAP & CRA Diversions (Net Outflow)", cfs: Math.round((byId["09426650"]?.flow_cfs || 0) + (byId["09424150"]?.flow_cfs || 0)) },
          is_diversion: true,
          downstream_gage: "Parker Dam"
        };
      }
    } else if (r === "lower_basin_paloverde_imperial") {
      const res = resolveStation(paloVerde);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09429100 below Palo Verde Dam, AZ-CA";
      gaugeId = "09429100";
    } else if (r === "lower_basin_imperial_tailrace") {
      const res = resolveStation(imperialTailrace);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09429500 below Imperial Dam, AZ-CA (residual channel flow post-AAC diversion)";
      gaugeId = "09429500";
      if (flow != null && paloVerde && paloVerde.flow_cfs != null && byId["09527700"]?.flow_cfs != null) {
        confluenceInfo = {
          confluence_name: "Imperial Dam Diversion & Residual Channel Flow",
          mainstem_upstream: { name: "Palo Verde Tailwater", cfs: Math.round(paloVerde.flow_cfs) },
          tributary: { name: "All-American Canal Diversion", cfs: Math.round(byId["09527700"].flow_cfs) },
          is_diversion: true,
          downstream_gage: "Imperial Tailrace"
        };
      }
    } else if (r === "lower_basin_taper") {
      const res = resolveStation(imperialTailrace);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp;
      sourceLabel = res.status === 'offline' ? 'Station Offline' : "Residual Channel Flow Below Major Diversions";
      gaugeInfo = "Downstream of Imperial Dam / All-American Canal diversion to Morelos Dam (Mexico)";
      gaugeId = "09429500";
    } else if (r === "div_canal_alimentador_central" || r === "canal_alimentador_central") {
      const morelosStation = byId["09522000"] || metrics?.canals?.find(c => c.id === "09522000");
      const res = resolveStation(morelosStation);
      flow = res.flow_cfs != null ? res.flow_cfs : (morelosStation?.flow_cfs || 1530.0);
      status = res.status || "delayed";
      timestamp = res.timestamp || morelosStation?.timestamp;
      sourceLabel = "1944 Mexican Water Treaty Delivery (CONAGUA / CILA)";
      gaugeInfo = "USGS #09522000 at Northerly International Boundary above Morelos Dam";
      gaugeId = "09522000";
    } else if (r === "river-delta-dry" || r === "river_delta_dry") {
      flow = 0;
      status = "dry";
      timestamp = null;
      sourceLabel = "Dry River Channel Below Morelos Dam Diversion";
      gaugeInfo = "0 cfs post-Morelos Dam diversion into Canal Alimentador Central";
      gaugeId = null;
    } else if (r === "green_headwaters_daniel") {
      const res = resolveStation(greenDaniel);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09188500 at Warren Bridge near Daniel, WY";
      gaugeId = "09188500";
    } else if (r === "green_daniel_fontenelle" || r === "green_headwaters_fontenelle") {
      const res = resolveStation(greenLaBarge || fontenelle);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09209400 near La Barge, WY to Fontenelle Reservoir";
      gaugeId = "09209400";
    } else if (r === "green_fontenelle_greenriverwy") {
      const res = resolveStation(fontenelle);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09211200 below Fontenelle Reservoir, WY";
      gaugeId = "09211200";
    } else if (r === "green_greenriverwy_flaminggorge") {
      const res = resolveStation(greenRiverWY);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09217000 near Green River, WY (Upper Inflow to Flaming Gorge)";
      gaugeId = "09217000";
    } else if (r === "green_upper") {
      const res = resolveStation(greenUpper);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09234500 near Greendale, UT (Flaming Gorge Dam Release)";
      gaugeId = "09234500";
    } else if (r === "green_middle") {
      const res = resolveStation(greenJensen);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09261000 near Jensen, UT (below Yampa River Confluence at Echo Park)";
      gaugeId = "09261000";
      if (flow != null && greenUpper && greenUpper.flow_cfs != null && yampa && yampa.flow_cfs != null) {
        confluenceInfo = {
          confluence_name: "Yampa River Confluence at Echo Park",
          mainstem_upstream: { name: "Upper Green River (Flaming Gorge)", cfs: greenUpper.flow_cfs },
          tributary: { name: "Yampa River", cfs: yampa.flow_cfs },
          downstream_gage: "Jensen, UT"
        };
      }
    } else if (r === "green_ouray_desolation") {
      const res = resolveStation(greenOurayGage || greenOuray);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09272400 at Ouray, UT through Desolation Canyon to Price River Confluence";
      gaugeId = "09272400";
      if (flow != null && greenJensen && greenJensen.flow_cfs != null) {
        confluenceInfo = {
          confluence_name: "White & Duchesne Confluences at Ouray",
          mainstem_upstream: { name: "Middle Green River (Jensen)", cfs: greenJensen.flow_cfs },
          tributary: { name: "White & Duchesne Rivers", cfs: (white?.flow_cfs || 0) + (duchesne?.flow_cfs || 0) },
          downstream_gage: "Ouray, UT"
        };
      }
    } else if (r === "green_river") {
      const rGr = resolveStation(green);
      const rSr = resolveStation(sanRafaelGage);
      if (rGr.flow_cfs != null) {
        flow = Math.round(rGr.flow_cfs + (rSr.flow_cfs || 0));
        status = rGr.status; timestamp = rGr.timestamp;
        sourceLabel = "Mass Balance (Green River, UT + San Rafael)";
      } else {
        flow = null; status = "offline"; timestamp = null; sourceLabel = "Station Offline";
      }
      gaugeInfo = `USGS #09315000 at Green River, UT + USGS #09328500 San Rafael River`;
      gaugeId = "09315000";
      if (flow != null && greenOurayGage && greenOurayGage.flow_cfs != null) {
        confluenceInfo = {
          confluence_name: "Price River Confluence (Gray Canyon) & San Rafael Inflow",
          mainstem_upstream: { name: "Green River (Desolation Canyon)", cfs: greenOurayGage.flow_cfs },
          tributary: { name: "Price River & San Rafael + Valley Accretion", cfs: flow - greenOurayGage.flow_cfs },
          downstream_gage: "Green River, UT"
        };
      }
    } else if (r === "gunnison_headwaters") {
      const res = resolveStation(gunnisonHead);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09114500 near Gunnison, CO (Headwaters to Blue Mesa)";
      gaugeId = "09114500";
    } else if (r === "gunnison_aspinall_cascade" || r === "gunnison_upper") {
      const res = resolveStation(gunnisonUpper);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09128000 below Gunnison Tunnel, CO (Crystal Dam / Black Canyon)";
      gaugeId = "09128000";
    } else if (r === "gunnison_river") {
      const res = resolveStation(gunnison);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09152500 near Grand Junction, CO (below Uncompahgre Confluence)";
      gaugeId = "09152500";
      if (flow != null && gunnisonUpper && gunnisonUpper.flow_cfs != null && uncompahgreGage && uncompahgreGage.flow_cfs != null) {
        confluenceInfo = {
          confluence_name: "Uncompahgre River Confluence at Delta",
          mainstem_upstream: { name: "Upper Gunnison (Black Canyon)", cfs: gunnisonUpper.flow_cfs },
          tributary: { name: "Uncompahgre River", cfs: uncompahgreGage.flow_cfs },
          downstream_gage: "Grand Junction"
        };
      }
    } else if (r === "yampa_river") {
      const res = resolveStation(yampa);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09260050 Yampa River at Deerlodge Park, CO";
      gaugeId = "09260050";
    } else if (r === "white_river") {
      const res = resolveStation(white);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09306500 White River near Watson, UT";
      gaugeId = "09306500";
    } else if (r === "uncompahgre_river") {
      const res = resolveStation(uncompahgreGage);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09149500 Uncompahgre River at Delta, CO (Gunnison confluence)";
      gaugeId = "09149500";
    } else if (r === "little_snake_river") {
      const res = resolveStation(littleSnakeGage);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09260000 Little Snake River near Lily, CO (Yampa confluence)";
      gaugeId = "09260000";
    } else if (r === "fraser_river") {
      const res = resolveStation(fraserGage);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09033300 Fraser River below Crooked Creek at Tabernash, CO";
      gaugeId = "09033300";
    } else if (r === "duchesne_river") {
      const res = resolveStation(duchesne);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09302000 near Randlett, UT";
      gaugeId = "09302000";
    } else if (r === "dolores_headwaters") {
      const res = resolveStation(doloresDolores);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09166500 at Dolores, CO (McPhee Reservoir Inflow)";
      gaugeId = "09166500";
    } else if (r === "dolores_mcphee_bedrock") {
      const res = resolveStation(doloresBedrock);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09169500 at Bedrock, CO";
      gaugeId = "09169500";
    } else if (r === "dolores_bedrock_cisco" || r === "dolores_river") {
      const res = resolveStation(dolores);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09180000 near Cisco, UT";
      gaugeId = "09180000";
    } else if (r === "sanjuan_headwaters") {
      const res = resolveStation(sanjuanPagosa);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09342500 at Pagosa Springs, CO (Headwaters to Navajo Reservoir)";
      gaugeId = "09342500";
    } else if (r === "sanjuan_upper") {
      const res = resolveStation(sanjuanUpper);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09355500 near Archuleta, NM (Navajo Dam Release)";
      gaugeId = "09355500";
    } else if (r === "animas_river") {
      const res = resolveStation(animas);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09364500 at Farmington, NM (above San Juan Confluence)";
      gaugeId = "09364500";
    } else if (r === "sanjuan_farmington_shiprock") {
      const res = resolveStation(sanjuanFarmington);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09365000 at Farmington, NM (below Animas Confluence)";
      gaugeId = "09365000";
      if (flow != null && sanjuanUpper && sanjuanUpper.flow_cfs != null && animas && animas.flow_cfs != null) {
        confluenceInfo = {
          confluence_name: "Animas River Confluence at Farmington",
          mainstem_upstream: { name: "Upper San Juan (Navajo Dam)", cfs: sanjuanUpper.flow_cfs },
          tributary: { name: "Animas River", cfs: animas.flow_cfs },
          downstream_gage: "Farmington, NM"
        };
      }
    } else if (r === "sanjuan_shiprock_bluff") {
      const res = resolveStation(sanjuanShiprock);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09368000 at Shiprock, NM";
      gaugeId = "09368000";
    } else if (r === "sanjuan_bluff_powell" || r === "sanjuan_river") {
      const res = resolveStation(sanjuan);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09379500 near Bluff, UT (Lake Powell Inflow Terminal)";
      gaugeId = "09379500";
    } else if (r === "blue_river_headwaters") {
      const res = resolveStation(blueDillonIn);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09046600 near Dillon, CO (Breckenridge to Dillon Reservoir)";
      gaugeId = "09046600";
    } else if (r === "blue_river_middle") {
      const res = resolveStation(blueDillonDam);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09050700 below Dillon, CO (Dillon Dam Release)";
      gaugeId = "09050700";
    } else if (r === "blue_river") {
      const res = resolveStation(blue);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09057500 below Green Mtn Reservoir, CO";
      gaugeId = "09057500";
    } else if (r === "roaring_fork_river") {
      const res = resolveStation(roaringFork);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09085000 Roaring Fork River at Glenwood Springs, CO";
      gaugeId = "09085000";
    } else if (r === "fryingpan_river" || r === "fryingpan_headwaters") {
      const res = resolveStation(fryingpanRuedi);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09080400 near Ruedi, CO (Ruedi Reservoir Release)";
      gaugeId = "09080400";
    } else if (r === "price_river") {
      const res = resolveStation(priceRiverGage);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09314500 Price River at Woodside, UT (enters Green River in Gray Canyon)";
      gaugeId = "09314500";
    } else if (r === "san_rafael_river") {
      const res = resolveStation(sanRafaelGage);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09328500 San Rafael River near Green River, UT (enters Green River in Labyrinth Canyon)";
      gaugeId = "09328500";
    } else if (r === "dirty_devil_river") {
      const res = resolveStation(dirtyDevilGage);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09333500 Dirty Devil River ab Poison Spring Wash nr Hanksville, UT (Lake Powell inflow)";
      gaugeId = "09333500";
    } else if (r === "escalante_river") {
      const res = resolveStation(escalanteGage);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09337500 Escalante River near Escalante, UT (Lake Powell inflow)";
      gaugeId = "09337500";
    } else if (r === "eagle_river") {
      const res = resolveStation(eagle);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09070000 below Gypsum, CO";
      gaugeId = "09070000";
    } else if (r === "paria_river") {
      const res = resolveStation(paria);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09382000 at Lees Ferry, AZ";
      gaugeId = "09382000";
    } else if (r === "little_colorado_river" || r === "little_colorado_lower") {
      const res = resolveStation(littleColorado);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09402000 Little Colorado River near Cameron, AZ";
      gaugeId = "09402000";
    } else if (r === "virgin_river") {
      const res = resolveStation(virgin);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09415000 Virgin River at Littlefield, AZ";
      gaugeId = "09415000";
    } else if (r === "muddy_river") {
      const res = resolveStation(muddyRiverGage);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09419000 Muddy River near Glendale, NV (Lake Mead inflow)";
      gaugeId = "09419000";
    } else if (r === "kanab_creek") {
      const res = resolveStation(kanabCreekGage);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09403850 Kanab Creek above mouth near Supai, AZ";
      gaugeId = "09403850";
    } else if (r === "havasu_creek") {
      const res = resolveStation(havasuCreekGage);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09404115 Havasu Creek above mouth near Supai, AZ";
      gaugeId = "09404115";
    } else if (r === "san_pedro_river") {
      const res = resolveStation(sanPedroGage);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09471000 San Pedro River at Charleston, AZ";
      gaugeId = "09471000";
    } else if (r === "bill_williams_river") {
      const res = resolveStation(billWilliams);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09426000 below Alamo Dam, AZ";
      gaugeId = "09426000";
    } else if (r === "salt_headwaters") {
      const res = resolveStation(salt);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09498500 near Roosevelt, AZ (Roosevelt Lake Inflow)";
      gaugeId = "09498500";
    } else if (r === "salt_cascade" || r === "salt_river") {
      const res = resolveStation(saltStewart);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09502000 below Stewart Mountain Dam, AZ";
      gaugeId = "09502000";
    } else if (r === "verde_headwaters") {
      const res = resolveStation(verdeCamp);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09506000 near Camp Verde, AZ";
      gaugeId = "09506000";
    } else if (r === "verde_river") {
      const res = resolveStation(verdeBartlett);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09510000 below Bartlett Dam, AZ";
      gaugeId = "09510000";
    } else if (r === "gila_lower") {
      const res = resolveStation(gilaDome);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09520500 near Dome, AZ";
      gaugeId = "09520500";
    } else if (r === "gila_river" || r === "gila_upper") {
      const res = resolveStation(gilaKelvin);
      flow = res.flow_cfs; status = res.status; timestamp = res.timestamp; sourceLabel = res.source_label;
      gaugeInfo = "USGS #09474000 at Kelvin, AZ";
      gaugeId = "09474000";
    }

    f.properties.gauge_id = gaugeId;
    f.properties.flow_cfs = flow;
    f.properties.status = status;
    f.properties.source_label = sourceLabel;
    f.properties.gauge_info = gaugeInfo;
    f.properties.confluence_info = confluenceInfo;
    if (timestamp) f.properties.timestamp = timestamp;

    if (f.properties.reach_type === "submerged_path" || r.endsWith("_submerged_path")) {
      f.properties.weight = 1.8;
      f.properties.hist_normal_cfs = null;
      f.properties.health_pct = null;
      f.properties.health_color = '#0369a1';
      f.properties.health_label = 'Submerged River Channel';
    } else if (f.properties.reach_type === "canal" || r === "div_canal_alimentador_central") {
      f.properties.weight = computeCanalWeight(flow);
      f.properties.hist_normal_cfs = null;
      f.properties.health_pct = null;
      f.properties.health_color = '#0284c7';
      f.properties.health_label = '1944 Treaty Delivery';
    } else if (status === 'dry' || (flow === 0 && r.includes('delta'))) {
      f.properties.weight = 2.0;
      f.properties.hist_normal_cfs = null;
      f.properties.health_pct = null;
      f.properties.health_color = '#94a3b8';
      f.properties.health_label = 'Dry Riverbed';
    } else if (status === 'offline' || flow == null) {
      f.properties.weight = 2.0;
      f.properties.hist_normal_cfs = gaugeId ? getHistoricalNormal(gaugeId) : null;
      f.properties.health_pct = null;
      f.properties.health_color = '#94a3b8';
      f.properties.health_label = 'Station Offline';
    } else {
      f.properties.weight = computeRiverWeight(flow, cat);
      const norm = gaugeId ? getHistoricalNormal(gaugeId) : null;
      if (norm && norm > 0) {
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
    }
  });

  if (map && map.getSource('rivers')) {
    map.getSource('rivers').setData(riverNetwork);
  }

  // Update canals source with live observations & offline status
  if (map && map.getSource('canals') && cachedGeography?.tunnels) {
    const updatedCanals = cachedGeography.tunnels.filter(t => !t.id || !t.id.endsWith("TUNCO")).map(t => {
      const metric = metrics?.canals?.find(m => m.id === t.id) || (metrics?.streamflows?.find(s => s.id === t.id));
      const isDead = metric?.data_status === 'offline' || metric?.flow_cfs == null;
      const flow = isDead ? null : metric.flow_cfs;
      const status = metric?.data_status || (isDead ? 'offline' : 'live');
      const timestamp = metric?.timestamp || t.timestamp || null;
      const weight = computeCanalWeight(flow);
      return {
        type: 'Feature',
        properties: {
          ...t,
          flow_cfs: flow,
          weight: weight,
          data_status: status,
          status: status,
          timestamp: timestamp,
          age_hours: metric?.age_hours
        },
        geometry: { type: 'LineString', coordinates: t.coords }
      };
    });
    map.getSource('canals').setData({ type: 'FeatureCollection', features: updatedCanals });
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

  ensurePointLayersOnTop();
}

async function loadData(forceLive = false) {
  const syncElem = document.getElementById("sync-time");
  try {
    const t = Date.now();
    
    // 1. Fetch metrics snapshot immediately (17 KB - instant)
    const metricsRes = await fetch(`./data/latest_metrics.json?t=${t}`);
    const metrics = await metricsRes.json();
    if (metrics.reservoirs && Array.isArray(metrics.reservoirs)) {
      const getCap = r => Number(r.capacity_af) || (r.storage_af && r.capacity_pct ? (r.storage_af / (r.capacity_pct / 100)) : 0) || 0;
      metrics.reservoirs.sort((a, b) => {
        const catA = a.category === 'front_range' ? 1 : 0;
        const catB = b.category === 'front_range' ? 1 : 0;
        if (catA !== catB) return catA - catB;
        return getCap(b) - getCap(a);
      });
    }
    cachedMetrics = metrics;
    activeMetrics = metrics;
    window.cachedMetrics = metrics;
    window.activeMetrics = metrics;
    populateTelemetryTable(metrics);
    updateSidebar(metrics);
    const initialDateStr = formatTimestamp(metrics.fetched_at);
    if (syncElem) syncElem.textContent = `Observation Snapshot (${initialDateStr})`;

    // Check if there was a pending station request while waiting for metrics
    if (window._pendingFocusStation) {
      const pStation = window._pendingFocusStation;
      window._pendingFocusStation = null;
      setTimeout(() => window.focusMapStation(pStation), 100);
    }

    // 2. Fetch static base geometries on first load (larger GeoJSON files)
    if (!cachedGeography || !cachedRiverNetwork || !cachedLakes) {
      const [geoRes, riverRes, lakesRes, powellContoursRes, normalsRes] = await Promise.all([
        fetch(`./data/geography.json?t=${t}`),
        fetch(`./data/river_network.json?t=${t}`),
        fetch(`./data/lakes.geojson?t=${t}`),
        fetch(`./data/powell_contours.geojson?t=${t}`).catch(() => null),
        fetch(`./data/historical_normals.json?t=${t}`).catch(() => null)
      ]);
      cachedGeography = await geoRes.json();
      cachedRiverNetwork = await riverRes.json();
      window.cachedRiverNetwork = cachedRiverNetwork;
      cachedLakes = await lakesRes.json();
      if (powellContoursRes && powellContoursRes.ok) {
        cachedPowellContours = await powellContoursRes.json();
      }
      if (normalsRes && normalsRes.ok) {
        cachedNormals = await normalsRes.json();
        window.cachedNormals = cachedNormals;
      }
    }

    // 3. Render map layers as soon as MapLibre style is loaded
    const renderLayersIfMapReady = () => {
      if (!map) return;
      if (cachedGeography && cachedRiverNetwork && cachedLakes) {
        renderGeography(cachedGeography, cachedRiverNetwork, cachedLakes, cachedPowellContours);
      }
      applyLiveHydrology(cachedRiverNetwork, metrics);
      renderMetrics(metrics);
      updatePowellActiveLayers(metrics);
      renderFlowHealthLayer(cachedRiverNetwork, metrics);
      updateBadgePlacements();
      ensurePointLayersOnTop();
      if (window.FlowReplayEngine && typeof window.FlowReplayEngine.init === 'function') {
        window.FlowReplayEngine.init(map, metrics, cachedNormals);
      }
    };

    if (map && map.isStyleLoaded && map.isStyleLoaded()) {
      renderLayersIfMapReady();
    } else if (map && map.once) {
      map.once('load', renderLayersIfMapReady);
    }

    // 4. In background (or when user clicks Reload), query live USGS & CDWR directly from browser
    Promise.allSettled([fetchLiveUSGS(), fetchLiveCDWR()]).then(results => {
      let anyUpdated = false;
      const [usgsRes, cdwrRes] = results;

      if (usgsRes.status === "fulfilled" && usgsRes.value) {
        const live = usgsRes.value;
        if (live.streamflows && live.streamflows.length > 0) {
          // Merge live streamflows into metrics without overwriting USBR dam releases
          const liveMap = {};
          live.streamflows.forEach(s => { liveMap[s.id] = s; });
          metrics.streamflows = (metrics.streamflows || []).map(s => liveMap[s.id] ? { ...s, ...liveMap[s.id] } : s);
          live.streamflows.forEach(s => {
            if (!metrics.streamflows.some(existing => existing.id === s.id)) {
              metrics.streamflows.push(s);
            }
          });
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
        if (syncElem) syncElem.textContent = `Live Observations (Synced ${timeNow})`;
      }
    }).catch(liveErr => {
      console.warn("Live observation query fell back to snapshot:", liveErr);
    });

    // Check if URL or pending caller specified a station to fly to
    const urlParams = new URLSearchParams(window.location.search);
    const targetStation = urlParams.get('station') || window._pendingFocusStation;
    if (targetStation) {
      setTimeout(() => {
        if (typeof window.focusMapStation === 'function') {
          window.focusMapStation(targetStation);
        }
        window._pendingFocusStation = null;
      }, 700);
    }

  } catch (error) {
    console.error("Error loading water dashboard data:", error);
    if (syncElem) syncElem.textContent = "Observation Snapshot (Offline)";
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
    
    const now = new Date();
    const isDifferentYear = d.getFullYear() !== now.getFullYear();
    const ageHours = (now.getTime() - d.getTime()) / (1000 * 3600);

    const formatted = d.toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      ...(isDifferentYear ? { year: 'numeric' } : {}),
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
    });

    if (ageHours > 72) {
      return `${formatted} <span style="color:#b91c1c; font-weight:700;">(Inactive Station / Historical)</span>`;
    }
    return formatted;
  } catch (e) {
    return "Today";
  }
}

// ─── Authoritative Water Data Portal Link Helper ────────────────────────────
function getPortalInfo(item) {
  if (!item) return null;
  const id = String(item.id || item.gauge_id || item.station_id || '');
  const name = String(item.name || '').toLowerCase();

  // USBR Lower Colorado Dam Hydroelectric Releases (Davis, Hoover, Parker)
  if (id === 'USBR-DAVIS' || id === 'USBR_DAVIS' || id === '09423000' || name.includes('davis dam')) {
    return {
      name: 'USBR Lower Colorado Water Operations',
      url: 'https://www.usbr.gov/lc/region/g4000/hourly/hourly.html',
      label: 'USBR Hourly Dam Operations (Davis Dam)'
    };
  }
  if (id === 'USBR-HOOVER' || id === 'USBR_HOOVER' || id === '09421500' || name.includes('hoover dam')) {
    return {
      name: 'USBR Lower Colorado Water Operations',
      url: 'https://www.usbr.gov/lc/region/g4000/hourly/hourly.html',
      label: 'USBR Hourly Dam Operations (Hoover Dam)'
    };
  }
  if (id === 'USBR-PARKER' || id === 'USBR_PARKER' || id === '09427520' || name.includes('parker dam')) {
    return {
      name: 'USBR Lower Colorado Water Operations',
      url: 'https://www.usbr.gov/lc/region/g4000/hourly/hourly.html',
      label: 'USBR Hourly Dam Operations (Parker Dam)'
    };
  }

  // Specific Canal Names & Stations (Direct to Discharge cfs)
  if (id === '09527700' || name.includes('all-american')) {
    return {
      name: 'USGS National Water Information System',
      url: 'https://waterdata.usgs.gov/monitoring-location/09527700/#parameterCode=00060',
      label: 'USGS NWIS #09527700'
    };
  }
  if (id === '09424150' || name.includes('colorado river aqueduct')) {
    return {
      name: 'USGS National Water Information System',
      url: 'https://waterdata.usgs.gov/monitoring-location/09424150/#parameterCode=00060',
      label: 'USGS NWIS #09424150'
    };
  }
  if (id === '09426650' || name.includes('central arizona project') || name.includes('cap')) {
    return {
      name: 'USGS National Water Information System',
      url: 'https://waterdata.usgs.gov/monitoring-location/09426650/#parameterCode=00060',
      label: 'USGS NWIS #09426650'
    };
  }
  if (id === '09522000' || name.includes('alimentador') || name.includes('canal central') || name.includes('morelos')) {
    return {
      name: 'USGS / CILA Water Data',
      url: 'https://waterdata.usgs.gov/monitoring-location/09522000/#parameterCode=00060',
      label: 'USGS NWIS #09522000 at Northerly International Boundary'
    };
  }

  // 1. USGS Real-Time Streamflow & Canal Gauges (8-digit USGS station number)
  const cleanSiteId = id.replace(/^USGS-/, '');
  if (/^\d{8}$/.test(cleanSiteId)) {
    const isReservoir = item.type === 'reservoir' || 
                        (item.category && item.category.toLowerCase().includes('reservoir')) ||
                        ['09379900', '09421000'].includes(cleanSiteId) ||
                        name.includes('reservoir') || name.includes('lake ');
    const url = isReservoir
      ? `https://waterdata.usgs.gov/monitoring-location/${cleanSiteId}/`
      : `https://waterdata.usgs.gov/monitoring-location/${cleanSiteId}/#parameterCode=00060`;
    return {
      name: 'USGS National Water Information System',
      url: url,
      label: `USGS NWIS #${cleanSiteId}`
    };
  }

  // 2. Colorado DWR / CDSS Trans-Mountain Tunnels & Surface Stations
  if (id.endsWith('CO') || id.endsWith('TUNCO') || id.endsWith('DIVCO') || name.includes('front range tunnels') || name.includes('trans-mountain')) {
    const stationId = (id.endsWith('CO') || id.endsWith('TUNCO') || id.endsWith('DIVCO')) ? id : 'ROBTUNCO';
    return {
      name: 'Colorado DWR / CDSS Surface Water Portal',
      url: `https://dwr.state.co.us/Tools/Stations?station=${encodeURIComponent(stationId)}`,
      label: `CDSS #${stationId}`
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

function formatPortalHtml(portal, accentColor = '#2b5c8f') {
  if (!portal) return '';
  return `
    <div style="margin-top:8px; padding-top:6px; border-top:1px solid #cfc8ba; font-size:11px; line-height:1.4;">
      <span style="color:#5c5346; font-weight:600;">Data Portal:</span> 
      <a href="${portal.url}" target="_blank" rel="noopener" style="color:${accentColor}; text-decoration:none; font-weight:700; display:inline-flex; align-items:center; gap:2px;">
        ${portal.label} <span style="font-size:10px;">↗</span>
      </a>
    </div>
  `;
}

function renderGeography(geo, riverNetwork, lakes, powellContours) {
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
      if (hasHigherPriorityFeature(e.point, [
        'dams-hit-buffer', 'dams-layer',
        'streamflow-gauges-hit-buffer',
        'tunnels-portals-layer', 'tunnels-hit-buffer',
        'canals-hit-buffer',
        'rivers-mainstem-hit', 'rivers-major-hit', 'rivers-minor-hit',
        'lakes-fill'
      ])) return;
      showHoverTooltip(`<strong>${e.features[0].properties.name} Boundary</strong>`, e.lngLat, 'basin-line-hit-buffer');
    });
    map.on('mouseleave', 'basin-line-hit-buffer', () => {
      hideHoverTooltip('basin-line-hit-buffer');
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
      if (hasHigherPriorityFeature(e.point, [
        'dams-hit-buffer', 'dams-layer',
        'streamflow-gauges-hit-buffer',
        'tunnels-portals-layer', 'tunnels-hit-buffer',
        'canals-hit-buffer',
        'rivers-mainstem-hit', 'rivers-major-hit', 'rivers-minor-hit',
        'lakes-fill'
      ])) return;
      showHoverTooltip(`<strong>Continental Divide of the Americas</strong><br><span style="font-size:11px;color:#64748b;">Hydrologic Boundary between Pacific & Atlantic Slopes</span>`, e.lngLat, 'divide-line-hit-buffer');
    });
    map.on('mouseleave', 'divide-line-hit-buffer', () => {
      hideHoverTooltip('divide-line-hit-buffer');
    });
  }

  // 3. Lakes & Reservoirs (USGS NHD Shorelines)
  if (lakes && lakes.features && !map.getSource('lakes')) {
    map.addSource('lakes', { type: 'geojson', data: lakes });
    map.addLayer({
      id: 'lakes-fill',
      type: 'fill',
      source: 'lakes',
      filter: ['has', 'GNIS_NAME'],
      paint: {
        'fill-color': '#0284c7',
        'fill-opacity': 0.85
      }
    });
    map.addLayer({
      id: 'lakes-stroke',
      type: 'line',
      source: 'lakes',
      filter: ['has', 'GNIS_NAME'],
      paint: {
        'line-color': '#0369a1',
        'line-width': 1.5
      }
    });

    // Selected Lake / Reservoir Highlight (Editorial Cartographic Fill & Crisp Boundary)
    map.addLayer({
      id: 'lakes-selected-highlight-fill',
      type: 'fill',
      source: 'lakes',
      filter: ['==', ['get', 'GNIS_NAME'], ''],
      paint: {
        'fill-color': '#0072B2',
        'fill-opacity': 0.35
      }
    });
    map.addLayer({
      id: 'lakes-selected-highlight-stroke',
      type: 'line',
      source: 'lakes',
      filter: ['==', ['get', 'GNIS_NAME'], ''],
      paint: {
        'line-color': '#0f172a',
        'line-width': 3.0,
        'line-opacity': 1.0
      }
    });

    map.on('mousemove', 'lakes-fill', (e) => {
      if (!e.features.length) return;
      if (hasHigherPriorityFeature(e.point, [
        'dams-hit-buffer', 'dams-layer',
        'streamflow-gauges-hit-buffer',
        'tunnels-portals-layer', 'tunnels-hit-buffer',
        'canals-hit-buffer',
        'rivers-mainstem-hit', 'rivers-major-hit', 'rivers-minor-hit'
      ])) return;
      map.getCanvas().style.cursor = 'pointer';
      const p = e.features[0].properties;
      const name = p.GNIS_NAME || p.name || "Reservoir";
      const matchRes = activeMetrics?.reservoirs?.find(r => 
        r.name.toLowerCase().includes(name.toLowerCase()) || 
        name.toLowerCase().includes(r.name.split('(')[0].trim().toLowerCase())
      );
      const matchedDam = matchRes ? geo?.dams?.find(d => 
        (d.impounds && d.impounds.toLowerCase().includes(matchRes.name.split('(')[0].trim().toLowerCase())) ||
        (d.name && matchRes.name.toLowerCase().includes(d.name.toLowerCase().replace(' dam', ''))) ||
        (d.id && matchRes.id && matchRes.id.toLowerCase().includes(d.id.replace('_dam', '')))
      ) : null;

      if (matchRes) {
        showHoverTooltip(`
          <div style="font-family:'Inter',sans-serif; min-width:200px;">
            <span style="font-size:10px; font-weight:700; color:#2b5c8f; background:#ebe4d6; padding:2px 6px; border-radius:4px; display:inline-block; margin-bottom:4px;">Major Storage Reservoir</span>
            <strong style="font-size:13px; color:#0f172a; display:block;">${matchRes.name}</strong>
            ${matchedDam?.tier ? `<div style="font-size:10px;font-weight:700;color:#0e7490;margin-top:2px;">${matchedDam.tier}</div>` : ''}
            ${matchedDam?.era ? `<div style="font-size:9.5px;font-weight:600;color:#5c5346;margin-top:1px;">${matchedDam.era}</div>` : ''}
            <div style="margin: 6px 0; padding: 6px 8px; background:#f2ede2; border-radius:6px; border:1px solid #cfc8ba; display:flex; justify-content:space-between; align-items:baseline;">
              <span style="font-size:11px; color:#4f463a; font-weight:600;">Current Storage:</span>
              <span style="font-size:15px; font-weight:800; color:#2b5c8f;">${matchRes.capacity_pct}% <span style="font-size:11px; font-weight:600; color:#5c5346;">Full</span></span>
            </div>
            <div style="font-size:11px; color:#4f463a; line-height:1.4;">
              <strong>Storage:</strong> ${(matchRes.storage_af / 1e6).toFixed(2)}M Acre-Feet<br>
              <strong>Elevation:</strong> ${matchRes.elevation_ft ? matchRes.elevation_ft.toLocaleString() + ' ft' : 'USBR Records'}<br>
              <strong>Role:</strong> ${matchRes.role || 'Basin Storage'}<br>
              ${matchedDam?.legal_priority ? `<strong>Legal Priority:</strong> ${matchedDam.legal_priority}<br>` : ''}
            </div>
          </div>
        `, e.lngLat, 'lakes');
      } else {
        const area = p.AREASQKM ? `${Math.round(p.AREASQKM)} sq km` : "";
        showHoverTooltip(`<strong>${name}</strong><br><span style="font-size:11px;color:#5c5346;">USGS NHD Shoreline (${area})</span>`, e.lngLat, 'lakes');
      }
    });

    map.on('mouseleave', 'lakes-fill', () => {
      hideHoverTooltip('lakes');
    });

    map.on('click', 'lakes-fill', (e) => {
      if (e.originalEvent && e.originalEvent._handled) return;
      if (!e.features.length) return;
      if (hasHigherPriorityFeature(e.point, [
        'streamflow-gauges-hit-buffer', 'dams-layer', 'tunnels-portals-layer', 
        'tunnels-hit-buffer', 'canals-hit-buffer', 'rivers-mainstem-hit', 'rivers-major-hit', 'rivers-minor-hit'
      ])) return;
      if (e.originalEvent) e.originalEvent._handled = true;

      const p = e.features[0].properties;
      const name = p.GNIS_NAME || p.name || "Reservoir";
      const matchRes = activeMetrics?.reservoirs?.find(r => 
        r.name.toLowerCase().includes(name.toLowerCase()) || 
        name.toLowerCase().includes(r.name.split('(')[0].trim().toLowerCase())
      );
      const matchedDam = matchRes ? geo?.dams?.find(d => 
        (d.impounds && d.impounds.toLowerCase().includes(matchRes.name.split('(')[0].trim().toLowerCase())) ||
        (d.name && matchRes.name.toLowerCase().includes(d.name.toLowerCase().replace(' dam', ''))) ||
        (d.id && matchRes.id && matchRes.id.toLowerCase().includes(d.id.replace('_dam', '')))
      ) : null;

      if (p.GNIS_NAME) {
        highlightSelectedReservoir(p.GNIS_NAME);
      }

      const highlightBadge = `<div style="font-size:9.5px; font-weight:700; color:#0e7490; background:#cffafe; border:1px solid #a5f3fc; padding:2px 6px; border-radius:4px; display:inline-flex; align-items:center; gap:4px; margin-top:5px;">
        <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#06b6d4;"></span>
        Waterbody Isolated &amp; Highlighted
      </div>`;

      const portal = getPortalInfo(matchRes || { name: name });
      if (matchRes) {
        const dataHtml = `
          <div style="padding:2px;">
            <span style="font-size:10px; font-weight:700; color:#2b5c8f; background:#ebe4d6; padding:2px 6px; border-radius:4px; display:inline-block; margin-bottom:4px;">Major Storage Reservoir</span>
            <strong style="font-size:14px; color:#0f172a; display:block;">${matchRes.name}</strong>
            <span style="font-size:11px; color:#5c5346; font-weight:600;">${matchRes.river || ''}</span>
            ${matchedDam?.tier ? `<div style="font-size:10px;font-weight:700;color:#0e7490;margin-top:2px;">${matchedDam.tier}</div>` : ''}
            ${matchedDam?.era ? `<div style="font-size:9.5px;font-weight:600;color:#5c5346;margin-top:1px;">${matchedDam.era}</div>` : ''}
            <div style="margin: 8px 0; padding: 8px 10px; background:#f2ede2; border-radius:6px; border:1px solid #cfc8ba;">
              <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px;">
                <span style="font-size:11px; color:#4f463a; font-weight:600;">Current Storage:</span>
                <span style="font-size:16px; font-weight:800; color:#2b5c8f;">${matchRes.capacity_pct}% <span style="font-size:11px; font-weight:600; color:#5c5346;">Full</span></span>
              </div>
              <div style="height:6px; background:#cfc8ba; border-radius:3px; overflow:hidden;">
                <div style="width:${Math.min(100, matchRes.capacity_pct)}%; height:100%; background:${matchRes.capacity_pct < 25 ? '#ef4444' : (matchRes.capacity_pct < 50 ? '#f59e0b' : '#0891b2')};"></div>
              </div>
            </div>
            <div style="font-size:11.5px; color:#3e3226; line-height:1.5;">
              <strong>Elevation:</strong> ${matchRes.elevation_ft ? matchRes.elevation_ft.toLocaleString() + ' ft' : 'USBR'}<br>
              <strong>Volume Stored:</strong> ${Math.round(matchRes.storage_af).toLocaleString()} Acre-Feet<br>
              <strong>Active Capacity:</strong> ${Math.round(matchRes.capacity_af || 0).toLocaleString()} Acre-Feet<br>
              <strong>Operational Role:</strong> ${matchRes.role || 'Basin Storage'}<br>
              ${matchedDam?.legal_priority ? `<strong>Legal Priority:</strong> ${matchedDam.legal_priority}<br>` : ''}
              ${matchedDam?.historical_note ? `<div style="margin-top:6px;padding:6px 8px;background:#f2ede2;border-left:3px solid #2b5c8f;font-size:10.5px;color:#3e3226;line-height:1.4;">${matchedDam.historical_note}</div>` : ''}
            </div>
            ${highlightBadge}
            ${formatPortalHtml(portal, '#2b5c8f')}
          </div>
        `;

        const isFrontRange = matchRes.category === 'front_range';
        const cleanResName = matchRes.name.replace(/["\\]/g, '');
        let endpointUrl = '';
        let pyCode = '';
        let notes = '';

        if (isFrontRange) {
          const resAbbrev = (matchRes.id || 'DILRESCO').toUpperCase();
          endpointUrl = `https://dwr.state.co.us/Rest/GET/api/v2/telemetrystations/telemetrytimeseriesday/?abbrev=${resAbbrev}&format=json`;
          pyCode = `import requests

# Colorado DWR HydroBase Storage Records
url = "https://dwr.state.co.us/Rest/GET/api/v2/telemetrystations/telemetrytimeseriesday/"
params = {
    "abbrev": "${resAbbrev}",  # ${cleanResName}
    "format": "json"
}
res = requests.get(url, params=params, timeout=10).json()
reading = res["ResultList"][0]
print(f"${cleanResName}: {reading['measValue']} AF on {reading['measDate']}")`;
          notes = "Colorado DWR daily reservoir storage accounting & dam records.";
        } else {
          const usgsGauge = matchRes.id === 'lake_powell' ? '09379900' : (matchRes.id === 'lake_mead' ? '09421000' : '09379900');
          endpointUrl = `https://waterservices.usgs.gov/nwis/iv/?sites=${usgsGauge}&parameterCd=62614&format=json`;
          pyCode = `import requests

# USGS Lake Elevation & USBR HydroData Records
url = "https://waterservices.usgs.gov/nwis/iv/"
params = {
    "sites": "${usgsGauge}",       # ${cleanResName}
    "parameterCd": "62614",  # Elevation (ft NGVD 1929)
    "format": "json"
}
res = requests.get(url, params=params, timeout=10).json()
val = res["value"]["timeSeries"][0]["values"][0]["value"][-1]
elev = float(val["value"])
print(f"${cleanResName} Elevation: {elev:,.1f} ft")`;
          notes = "USGS parameter 62614 = Lake water surface elevation. Synced with USBR storage curves.";
        }

        const popupHtml = formatTabbedPopup({
          dataHtml,
          codeTitle: `${cleanResName}`,
          endpointUrl,
          pythonCode: pyCode,
          notes
        });
        const popup = new maplibregl.Popup({ offset: 8 }).setHTML(popupHtml);
        showFeaturePopup(popup, e.lngLat);
      } else {
        const area = p.AREASQKM ? `${Math.round(p.AREASQKM)} sq km` : "";
        const dataHtml = `
          <div style="padding:2px;">
            <strong style="font-size:13px; color:#0f172a; display:block;">${name}</strong>
            <span style="font-size:11px; color:#5c5346;">USGS NHD Shoreline ${area ? '(' + area + ')' : ''}</span>
            ${formatPortalHtml(portal, '#2b5c8f')}
          </div>
        `;
        const cleanName = name.replace(/["\\]/g, '');
        const pyCode = `import requests

# USGS National Hydrography Dataset (NHD) Feature Query
url = "https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6/query"
params = {
    "where": "GNIS_NAME = '${cleanName}'",
    "outFields": "GNIS_NAME,AREASQKM,ELEVATION",
    "f": "json"
}
res = requests.get(url, params=params, timeout=10).json()
print("NHD Features found:", len(res.get("features", [])))`;

        const popupHtml = formatTabbedPopup({
          dataHtml,
          codeTitle: `${cleanName} (NHD)`,
          endpointUrl: `https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6/query?where=GNIS_NAME='${encodeURIComponent(cleanName)}'&f=json`,
          pythonCode: pyCode,
          notes: "USGS National Hydrography Dataset polygon geometry."
        });
        const popup = new maplibregl.Popup({ offset: 8 }).setHTML(popupHtml);
        showFeaturePopup(popup, e.lngLat);
      }
    });
  }

  // 3b. Lake Powell Shoreline & Bathymetry: Rendered natively via lakes-fill and lakes-stroke (USGS NHD)

  // 4. CFS-Weighted River Network (Shapely-Welded Continuous Vectors)
  if (riverNetwork && !map.getSource('rivers')) {
    map.addSource('rivers', { type: 'geojson', data: riverNetwork });

    // 4a. Submerged Artificial Path Layer (Bathymetric thalwegs inside reservoirs)
    map.addLayer({
      id: 'rivers-submerged-path',
      type: 'line',
      source: 'rivers',
      filter: ['==', ['get', 'reach_type'], 'submerged_path'],
      paint: {
        'line-color': '#bae6fd',
        'line-width': 1.8,
        'line-dasharray': [3, 2],
        'line-opacity': 0.85
      }
    });

    // 4b. Mainstem - Outer Glow (Excludes submerged reservoir centerlines)
    map.addLayer({
      id: 'rivers-mainstem-glow',
      type: 'line',
      source: 'rivers',
      filter: ['all', ['==', ['get', 'category'], 'mainstem'], ['!=', ['get', 'reach_type'], 'submerged_path']],
      paint: {
        'line-color': [
          'case',
          ['==', ['get', 'reach_type'], 'submerged_path'], 'rgba(0,0,0,0)',
          ['coalesce', ['get', 'health_color'], '#38bdf8']
        ],
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          6, ['+', ['coalesce', ['get', 'weight'], 4.4], 2.0],
          10, ['+', ['*', ['coalesce', ['get', 'weight'], 4.4], 1.25], 2.5],
          13, ['+', ['*', ['coalesce', ['get', 'weight'], 4.4], 1.6], 3.0]
        ],
        'line-blur': 1.5,
        'line-opacity': 0.65
      }
    });
    // 4c. Mainstem - Core Flowline (Excludes submerged reservoir centerlines)
    map.addLayer({
      id: 'rivers-mainstem-core',
      type: 'line',
      source: 'rivers',
      filter: ['all', ['==', ['get', 'category'], 'mainstem'], ['!=', ['get', 'reach_type'], 'submerged_path']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'case',
          ['==', ['get', 'reach_type'], 'submerged_path'], '#0369a1',
          ['coalesce', ['get', 'health_color'], '#0284c7']
        ],
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          6, ['coalesce', ['get', 'weight'], 4.4],
          10, ['*', ['coalesce', ['get', 'weight'], 4.4], 1.25],
          13, ['*', ['coalesce', ['get', 'weight'], 4.4], 1.6]
        ],
        'line-opacity': 0.95
      }
    });
    // Mainstem Hit Buffer (Excludes submerged reservoir centerlines)
    map.addLayer({
      id: 'rivers-mainstem-hit',
      type: 'line',
      source: 'rivers',
      filter: ['all', ['==', ['get', 'category'], 'mainstem'], ['!=', ['get', 'reach_type'], 'submerged_path']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#000000', 'line-width': 26, 'line-opacity': 0.0001 }
    });

    // Major Tributaries
    map.addLayer({
      id: 'rivers-major-glow',
      type: 'line',
      source: 'rivers',
      filter: ['all', ['==', ['get', 'category'], 'major_tributary'], ['!=', ['get', 'reach_type'], 'submerged_path'], ['!=', ['get', 'reach_type'], 'canal']],
      paint: {
        'line-color': [
          'case',
          ['==', ['get', 'reach_type'], 'submerged_path'], 'rgba(0,0,0,0)',
          ['coalesce', ['get', 'health_color'], '#38bdf8']
        ],
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          6, ['+', ['coalesce', ['get', 'weight'], 3.2], 2.0],
          10, ['+', ['*', ['coalesce', ['get', 'weight'], 3.2], 1.25], 2.5],
          13, ['+', ['*', ['coalesce', ['get', 'weight'], 3.2], 1.6], 3.0]
        ],
        'line-blur': 1.5,
        'line-opacity': 0.65
      }
    });
    map.addLayer({
      id: 'rivers-major-core',
      type: 'line',
      source: 'rivers',
      filter: ['all', ['==', ['get', 'category'], 'major_tributary'], ['!=', ['get', 'reach_type'], 'submerged_path'], ['!=', ['get', 'reach_type'], 'canal']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'case',
          ['==', ['get', 'reach_type'], 'submerged_path'], '#0369a1',
          ['coalesce', ['get', 'health_color'], '#0284c7']
        ],
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          6, ['coalesce', ['get', 'weight'], 3.2],
          10, ['*', ['coalesce', ['get', 'weight'], 3.2], 1.25],
          13, ['*', ['coalesce', ['get', 'weight'], 3.2], 1.6]
        ],
        'line-opacity': 0.95
      }
    });

    // Conveyance Canals in River Network (Dashed canal line style scaled by flow_cfs)
    map.addLayer({
      id: 'rivers-canal-core',
      type: 'line',
      source: 'rivers',
      filter: ['==', ['get', 'reach_type'], 'canal'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#0284c7',
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          6, ['coalesce', ['get', 'weight'], 2.8],
          10, ['*', ['coalesce', ['get', 'weight'], 2.8], 1.25],
          13, ['*', ['coalesce', ['get', 'weight'], 2.8], 1.6]
        ],
        'line-dasharray': [3, 2.5],
        'line-opacity': 1.0
      }
    });
    map.addLayer({
      id: 'rivers-major-hit',
      type: 'line',
      source: 'rivers',
      filter: ['all', ['==', ['get', 'category'], 'major_tributary'], ['!=', ['get', 'reach_type'], 'submerged_path']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#000000', 'line-width': 26, 'line-opacity': 0.0001 }
    });

    // Secondary Minor Tributaries
    map.addLayer({
      id: 'rivers-minor-glow',
      type: 'line',
      source: 'rivers',
      filter: ['all', ['==', ['get', 'category'], 'minor_tributary'], ['!=', ['get', 'reach_type'], 'submerged_path']],
      paint: {
        'line-color': [
          'case',
          ['==', ['get', 'reach_type'], 'submerged_path'], 'rgba(0,0,0,0)',
          ['coalesce', ['get', 'health_color'], '#38bdf8']
        ],
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          6, ['+', ['coalesce', ['get', 'weight'], 2.4], 1.8],
          10, ['+', ['*', ['coalesce', ['get', 'weight'], 2.4], 1.25], 2.2],
          13, ['+', ['*', ['coalesce', ['get', 'weight'], 2.4], 1.6], 2.6]
        ],
        'line-blur': 1.2,
        'line-opacity': 0.55
      }
    });
    map.addLayer({
      id: 'rivers-minor-core',
      type: 'line',
      source: 'rivers',
      filter: ['all', ['==', ['get', 'category'], 'minor_tributary'], ['!=', ['get', 'reach_type'], 'submerged_path']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'case',
          ['==', ['get', 'reach_type'], 'submerged_path'], '#0369a1',
          ['coalesce', ['get', 'health_color'], '#0284c7']
        ],
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          6, ['coalesce', ['get', 'weight'], 2.4],
          10, ['*', ['coalesce', ['get', 'weight'], 2.4], 1.25],
          13, ['*', ['coalesce', ['get', 'weight'], 2.4], 1.6]
        ],
        'line-opacity': 0.95
      }
    });

    // 4d. Selected River Reach Highlight (Editorial Cartographic Casing & Core)
    map.addLayer({
      id: 'rivers-selected-highlight-casing',
      type: 'line',
      source: 'rivers',
      filter: ['==', ['get', 'reach'], ''],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#0f172a',
        'line-width': ['+', ['get', 'weight'], 5.0],
        'line-opacity': 0.90
      }
    });
    map.addLayer({
      id: 'rivers-selected-highlight-core',
      type: 'line',
      source: 'rivers',
      filter: ['==', ['get', 'reach'], ''],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#38bdf8',
        'line-width': ['+', ['get', 'weight'], 1.5],
        'line-opacity': 1.0
      }
    });

    map.addLayer({
      id: 'rivers-minor-hit',
      type: 'line',
      source: 'rivers',
      filter: ['all', ['==', ['get', 'category'], 'minor_tributary'], ['!=', ['get', 'reach_type'], 'submerged_path']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#000000', 'line-width': 24, 'line-opacity': 0.0001 }
    });

    // River hover tooltips & click handlers attached to the generous hit buffer
    ['rivers-mainstem-hit', 'rivers-major-hit', 'rivers-minor-hit'].forEach(layerId => {
      map.on('mousemove', layerId, (e) => {
        if (!e.features.length) return;
        if (hasHigherPriorityFeature(e.point, [
          'dams-hit-buffer', 'dams-layer',
          'streamflow-gauges-hit-buffer',
          'topology-junctions-hit-buffer',
          'topology-sections-hit-buffer',
          'tunnels-portals-layer', 'tunnels-hit-buffer',
          'canals-hit-buffer'
        ])) return;
        map.getCanvas().style.cursor = 'pointer';
        const p = e.features[0].properties;
        const isCanalAlimentador = p.reach === 'div_canal_alimentador_central' || p.reach === 'canal_alimentador_central' || p.id === '09522000';
        const kicker = isCanalAlimentador
          ? 'CONVEYANCE CANAL'
          : (p.category === 'mainstem' ? 'MAINSTEM REACH' : (p.category === 'major_tributary' ? 'MAJOR TRIBUTARY' : 'TRIBUTARY STREAM'));

        const gaugeId = p.gauge_id;
        const norm = p.hist_normal_cfs ? Number(p.hist_normal_cfs) : (gaugeId ? getHistoricalNormal(gaugeId) : null);
        let healthText = '';
        if (norm && norm > 0 && p.flow_cfs != null) {
          const pct = p.health_pct != null ? Number(p.health_pct) : Math.round((Number(p.flow_cfs) / norm) * 100);
          const color = p.health_color || flowHealthColor(pct);
          healthText = `<span style="font-size:11px; font-weight:700; color:${color}; margin-left:6px;">(${pct}% of Normal)</span>`;
        }

        const stationLabel = gaugeId ? `USGS #${gaugeId}` : (p.gauge_info ? p.gauge_info.split(' ')[0] : 'Mass-Balance Reach');

        let waveTransitHoverHtml = '';
        if (p.reach === 'grand_canyon' || p.reach === 'grand_canyon_lower') {
          const pr = activeMetrics?.streamflows?.find(s => s.id === '09402500')?.flow_cfs || 8300;
          const dc = activeMetrics?.streamflows?.find(s => s.id === '09404200')?.flow_cfs || 8300;
          if (Math.abs(pr - dc) >= 1500) {
            waveTransitHoverHtml = `
              <div style="margin-top:4px; padding:3px 6px; background:#fef3c7; border:1px solid #fde68a; border-radius:3px; font-size:10px; color:#78350f;">
                Active wave in transit (~32h lag between Phantom Ranch &amp; Diamond Creek)
              </div>
            `;
          }
        }

        showHoverTooltip(`
          <div style="font-family:'Inter',sans-serif; min-width: 190px; max-width: 270px; line-height:1.4;">
            <div style="font-size:9.5px; font-weight:700; color:#0369a1; text-transform:uppercase; letter-spacing:0.04em;">${kicker}</div>
            <strong style="font-size:13px; color:#0f172a; display:block; margin-top:1px;">${p.name}</strong>
            <div style="font-size:15px; font-weight:800; color:#0284c7; font-variant-numeric:tabular-nums; margin:3px 0;">
              ${Number(p.flow_cfs).toLocaleString()} <span style="font-size:10.5px; font-weight:600; color:#64748b;">cfs</span> ${healthText}
            </div>
            <div style="font-size:10.5px; color:#64748b;">${stationLabel}</div>
            ${waveTransitHoverHtml}
          </div>
        `, e.lngLat, 'rivers');
      });

      map.on('mouseleave', layerId, () => {
        hideHoverTooltip('rivers');
      });

      map.on('click', layerId, (e) => {
        if (e.originalEvent && e.originalEvent._handled) return;
        if (!e.features.length) return;
        if (hasHigherPriorityFeature(e.point, [
          'streamflow-gauges-hit-buffer', 'topology-junctions-hit-buffer', 'topology-sections-hit-buffer', 'dams-layer', 'tunnels-portals-layer', 
          'tunnels-hit-buffer', 'canals-hit-buffer'
        ])) return;
        if (e.originalEvent) e.originalEvent._handled = true;
        openReachPopup(e.features[0].properties, e.lngLat);
      });
    });
    initGisDebuggingLayers(riverNetwork);
  }

  function initGisDebuggingLayers(riverNetwork) {
    if (!map || !riverNetwork) return;

    // 1. Downstream Flow Direction Arrow Icon
    if (!map.hasImage('flow-arrow')) {
      const canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 16;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#0284c7';
      ctx.beginPath();
      ctx.moveTo(2, 3);
      ctx.lineTo(14, 8);
      ctx.lineTo(2, 13);
      ctx.lineTo(5, 8);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      map.addImage('flow-arrow', ctx.getImageData(0, 0, 16, 16));
    }

    // 2. Confluence Square Icon (■ Square symbol for River Junctions)
    if (!map.hasImage('confluence-square')) {
      const c = document.createElement('canvas');
      c.width = 16;
      c.height = 16;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#d97706'; // Amber / gold
      ctx.fillRect(2, 2, 12, 12);
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(2, 2, 12, 12);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.9;
      ctx.strokeRect(3.5, 3.5, 9, 9);
      map.addImage('confluence-square', ctx.getImageData(0, 0, 16, 16));
    }

    // 3. Downstream Flow Direction Symbol Layer
    if (!map.getLayer('flow-direction-arrows')) {
      const showArrows = (document.getElementById('toggle-flow-arrows') || document.getElementById('toggle-gis-flow-arrows'))?.checked ?? false;
      map.addLayer({
        id: 'flow-direction-arrows',
        type: 'symbol',
        source: 'rivers',
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 110,
          'icon-image': 'flow-arrow',
          'icon-size': 0.85,
          'icon-rotation-alignment': 'map',
          'icon-pitch-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'visibility': showArrows ? 'visible' : 'none'
        }
      });
    }

    // 4. Confluence Junctions (■ Squares where rivers meet)
    const confluenceJunctions = [
      { id: 'conf_green_colorado', name: 'Green River & Colorado River Confluence', trib: 'Green River', main: 'Colorado River', reach_id: 'cataract_canyon', location: 'Canyonlands National Park, UT', coord: [-109.88642, 38.19008] },
      { id: 'conf_gunnison_colorado', name: 'Gunnison River Confluence', trib: 'Gunnison River', main: 'Colorado River', reach_id: 'gunnison_river', location: 'Grand Junction, CO', coord: [-108.57797, 39.06208] },
      { id: 'conf_sanjuan_colorado', name: 'San Juan River Confluence', trib: 'San Juan River', main: 'Colorado River', reach_id: 'sanjuan_submerged_path', location: 'Lake Powell, UT', coord: [-110.9094, 37.1776] },
      { id: 'conf_littleco_colorado', name: 'Little Colorado River Confluence', trib: 'Little Colorado River', main: 'Colorado River', reach_id: 'little_colorado_river', location: 'Grand Canyon, AZ', coord: [-111.80046, 36.19363] },
      { id: 'conf_virgin_colorado', name: 'Virgin River Confluence', trib: 'Virgin River', main: 'Colorado River', reach_id: 'virgin_river', location: 'Lake Mead (Overton Arm), NV', coord: [-114.4055891, 36.1422271] },
      { id: 'conf_gila_colorado', name: 'Gila River & Colorado River Confluence', trib: 'Gila River', main: 'Colorado River', reach_id: 'gila_lower', location: 'Dome / Yuma, AZ', coord: [-114.55518, 32.7205588] },
      { id: 'conf_dolores_colorado', name: 'Dolores River Confluence', trib: 'Dolores River', main: 'Colorado River', reach_id: 'dolores_bedrock_cisco', location: 'Cisco / Dewey Bridge, UT', coord: [-109.28128, 38.82023] },
      { id: 'conf_roaringfork_colorado', name: 'Roaring Fork River Confluence', trib: 'Roaring Fork River', main: 'Colorado River', reach_id: 'roaring_fork_river', location: 'Glenwood Springs, CO', coord: [-107.3299, 39.54926] },
      { id: 'conf_eagle_colorado', name: 'Eagle River Confluence', trib: 'Eagle River', main: 'Colorado River', reach_id: 'eagle_river', location: 'Dotsero, CO', coord: [-107.05802, 39.64639] },
      { id: 'conf_blue_colorado', name: 'Blue River Confluence', trib: 'Blue River', main: 'Colorado River', reach_id: 'blue_river', location: 'Kremmling, CO', coord: [-106.41318, 40.04007] },
      { id: 'conf_fraser_colorado', name: 'Fraser River Confluence', trib: 'Fraser River', main: 'Colorado River', reach_id: 'fraser_river', location: 'Granby / Windy Gap, CO', coord: [-105.9814, 40.1050] },
      { id: 'conf_williams_colorado', name: 'Williams Fork Confluence', trib: 'Williams Fork', main: 'Colorado River', reach_id: 'williams_fork', location: 'Parshall, CO', coord: [-106.1805, 40.0562] },
      { id: 'conf_muddy_colorado', name: 'Muddy Creek Confluence', trib: 'Muddy Creek', main: 'Colorado River', reach_id: 'muddy_creek_co', location: 'Kremmling, CO', coord: [-106.41318, 40.04007] },
      { id: 'conf_dirtydevil_colorado', name: 'Dirty Devil River Confluence', trib: 'Dirty Devil River', main: 'Colorado River', reach_id: 'dirty_devil_river', location: 'Hite / Lake Powell, UT', coord: [-110.3964036, 37.8830717] },
      { id: 'conf_escalante_colorado', name: 'Escalante River Confluence', trib: 'Escalante River', main: 'Colorado River', reach_id: 'escalante_river', location: 'Lake Powell, UT', coord: [-110.86985, 37.28648] },
      { id: 'conf_paria_colorado', name: 'Paria River Confluence', trib: 'Paria River', main: 'Colorado River', reach_id: 'paria_river', location: 'Lees Ferry, AZ', coord: [-111.6008, 36.8584] },
      { id: 'conf_kanab_colorado', name: 'Kanab Creek Confluence', trib: 'Kanab Creek', main: 'Colorado River', reach_id: 'kanab_creek', location: 'Grand Canyon, AZ', coord: [-112.6294, 36.3914] },
      { id: 'conf_havasu_colorado', name: 'Havasu Creek Confluence', trib: 'Havasu Creek', main: 'Colorado River', reach_id: 'havasu_creek', location: 'Grand Canyon, AZ', coord: [-112.7636888, 36.3081288] },
      { id: 'conf_billwilliams_colorado', name: 'Bill Williams River Confluence', trib: 'Bill Williams River', main: 'Colorado River', reach_id: 'bill_williams_river', location: 'Lake Havasu, AZ', coord: [-114.1366, 34.3047] },
      { id: 'conf_yampa_green', name: 'Yampa River & Green River Confluence', trib: 'Yampa River', main: 'Green River', reach_id: 'yampa_river', location: 'Echo Park, Dinosaur NM, CO', coord: [-108.98454, 40.52638] },
      { id: 'conf_white_green', name: 'White River & Green River Confluence', trib: 'White River', main: 'Green River', reach_id: 'white_river', location: 'Ouray, UT', coord: [-109.68023, 40.06197] },
      { id: 'conf_duchesne_green', name: 'Duchesne River & Green River Confluence', trib: 'Duchesne River', main: 'Green River', reach_id: 'duchesne_river', location: 'Ouray, UT', coord: [-109.67989, 40.06228] },
      { id: 'conf_price_green', name: 'Price River & Green River Confluence', trib: 'Price River', main: 'Green River', reach_id: 'price_river', location: 'Desolation Canyon, UT', coord: [-110.1057, 39.1794] },
      { id: 'conf_sanrafael_green', name: 'San Rafael River & Green River Confluence', trib: 'San Rafael River', main: 'Green River', reach_id: 'san_rafael_river', location: 'Green River, UT', coord: [-110.10388, 38.7758] },
      { id: 'conf_animas_sanjuan', name: 'Animas River & San Juan Confluence', trib: 'Animas River', main: 'San Juan River', reach_id: 'animas_river', location: 'Farmington, NM', coord: [-108.22275, 36.71454] },
      { id: 'conf_uncompahgre_gunnison', name: 'Uncompahgre & Gunnison River Confluence', trib: 'Uncompahgre River', main: 'Gunnison River', reach_id: 'uncompahgre_river', location: 'Delta, CO', coord: [-108.09108, 38.75654] },
      { id: 'conf_fryingpan_roaringfork', name: 'Fryingpan & Roaring Fork Confluence', trib: 'Fryingpan River', main: 'Roaring Fork River', reach_id: 'fryingpan_river', location: 'Basalt, CO', coord: [-107.03448, 39.36652] },
      { id: 'conf_salt_gila', name: 'Salt River & Gila River Confluence', trib: 'Salt River', main: 'Gila River', reach_id: 'salt_river', location: 'Avondale / Phoenix, AZ', coord: [-112.30708, 33.38181] },
      { id: 'conf_verde_salt', name: 'Verde River & Salt River Confluence', trib: 'Verde River', main: 'Salt River', reach_id: 'verde_river', location: 'Fountain Hills, AZ', coord: [-111.66143, 33.54635] },
      { id: 'conf_sanpedro_gila', name: 'San Pedro & Gila River Confluence', trib: 'San Pedro River', main: 'Gila River', reach_id: 'san_pedro_river', location: 'Winkelman, AZ', coord: [-110.782763, 32.9841771] },
      { id: 'conf_muddy_virgin', name: 'Muddy River Confluence', trib: 'Muddy River', main: 'Virgin River / Lake Mead', reach_id: 'muddy_river', location: 'Moapa Valley / Overton, NV', coord: [-114.34913, 36.45232] }
    ];

    const junctionsGeoJSON = {
      type: 'FeatureCollection',
      features: confluenceJunctions.map(c => ({
        type: 'Feature',
        properties: {
          id: c.id,
          name: c.name,
          tributary: c.trib,
          mainstem: c.main,
          reach_id: c.reach_id,
          location: c.location,
          coord_str: `[${c.coord[0].toFixed(5)}, ${c.coord[1].toFixed(5)}]`
        },
        geometry: { type: 'Point', coordinates: c.coord }
      }))
    };

    if (!map.getSource('topology-junctions')) {
      map.addSource('topology-junctions', { type: 'geojson', data: junctionsGeoJSON });
      const showJunctions = document.getElementById('toggle-topology-junctions')?.checked ?? false;

      map.addLayer({
        id: 'topology-junctions',
        type: 'symbol',
        source: 'topology-junctions',
        layout: {
          'icon-image': 'confluence-square',
          'icon-size': 1.0,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'visibility': showJunctions ? 'visible' : 'none'
        }
      });

      map.addLayer({
        id: 'topology-junctions-hit-buffer',
        type: 'circle',
        source: 'topology-junctions',
        layout: { 'visibility': showJunctions ? 'visible' : 'none' },
        paint: {
          'circle-radius': 18,
          'circle-opacity': 0.0001
        }
      });

      map.on('mousemove', 'topology-junctions-hit-buffer', (e) => {
        if (!e.features.length) return;
        map.getCanvas().style.cursor = 'pointer';
        const p = e.features[0].properties;
        showHoverTooltip(`
          <div style="font-family:'Inter',sans-serif; min-width: 220px; line-height:1.4;">
            <div style="font-size:9.5px; font-weight:700; color:#d97706; text-transform:uppercase; letter-spacing:0.04em;">CONFLUENCE JUNCTION</div>
            <strong style="font-size:13px; color:#0f172a; display:block; margin-top:1px;">${p.name}</strong>
            <div style="font-size:11.5px; color:#334155; margin:3px 0;">
              Tributary <strong>${p.tributary}</strong> joins <strong>${p.mainstem}</strong>
            </div>
            <div style="font-size:10.5px; color:#64748b; margin-top:2px;">
              ${p.location}
            </div>
            <div style="font-size:10px; color:#94a3b8; font-family:monospace; margin-top:3px;">
              WGS84: ${p.coord_str}
            </div>
          </div>
        `, e.lngLat, 'topology-junctions');
      });

      map.on('mouseleave', 'topology-junctions-hit-buffer', () => {
        hideHoverTooltip('topology-junctions');
      });

      map.on('click', 'topology-junctions-hit-buffer', (e) => {
        if (!e.features.length) return;
        if (e.originalEvent) e.originalEvent._handled = true;
        const p = e.features[0].properties;
        if (p.reach_id) highlightSelectedReach(p.reach_id);
      });
    } else {
      map.getSource('topology-junctions').setData(junctionsGeoJSON);
    }

    // 5. Reach Section Nodes (Start & End Vertices of Reaches)
    // Distinguishes: Headwaters Origin (● Green), Reach Section Boundary (● Blue), Basin Terminus (● Red)
    function isNearConfluence(coord) {
      return confluenceJunctions.some(c => Math.hypot(coord[0] - c.coord[0], coord[1] - c.coord[1]) < 0.007);
    }

    const sectionNodeFeatures = [];
    (riverNetwork.features || []).forEach((feat, idx) => {
      const geom = feat.geometry;
      if (!geom) return;
      const p = feat.properties || {};
      let startCoord, endCoord;

      if (geom.type === 'LineString') {
        const coords = geom.coordinates;
        if (coords && coords.length >= 2) {
          startCoord = coords[0];
          endCoord = coords[coords.length - 1];
        }
      } else if (geom.type === 'MultiLineString') {
        const lines = geom.coordinates;
        if (lines && lines.length > 0) {
          const firstLine = lines[0];
          const lastLine = lines[lines.length - 1];
          if (firstLine && firstLine.length > 0) startCoord = firstLine[0];
          if (lastLine && lastLine.length > 0) endCoord = lastLine[lastLine.length - 1];
        }
      }

      if (startCoord) {
        // Is this coordinate close to an upstream reach's end?
        const isInternalStart = (riverNetwork.features || []).some(f2 => {
          if (f2 === feat) return false;
          const g2 = f2.geometry;
          if (!g2) return false;
          let e2;
          if (g2.type === 'LineString' && g2.coordinates?.length >= 2) e2 = g2.coordinates[g2.coordinates.length - 1];
          else if (g2.type === 'MultiLineString' && g2.coordinates?.length > 0) {
            const ll = g2.coordinates[g2.coordinates.length - 1];
            if (ll?.length > 0) e2 = ll[ll.length - 1];
          }
          return e2 && Math.hypot(startCoord[0] - e2[0], startCoord[1] - e2[1]) < 0.008;
        });

        const isConf = isNearConfluence(startCoord);
        const role = (!isInternalStart && !isConf) ? 'headwater_start' : 'section_boundary';
        const roleLabel = role === 'headwater_start' ? 'Reach Start (Headwaters Origin)' : 'Reach Section Boundary';
        const roleColor = role === 'headwater_start' ? '#10b981' : '#0284c7';

        sectionNodeFeatures.push({
          type: 'Feature',
          properties: {
            node_id: `${p.reach || idx}_start`,
            reach_id: p.reach || p.reach_id || `reach_${idx}`,
            reach_name: p.name || 'Unnamed Reach',
            reach_type: p.reach_type || 'free_flowing',
            node_role: role,
            role_label: roleLabel,
            color: roleColor,
            coord_str: `[${startCoord[0].toFixed(5)}, ${startCoord[1].toFixed(5)}]`
          },
          geometry: { type: 'Point', coordinates: [startCoord[0], startCoord[1]] }
        });
      }

      if (endCoord) {
        const isTerminus = Math.hypot(endCoord[0] - (-114.81364), endCoord[1] - 32.49429) < 0.015;
        const isConf = isNearConfluence(endCoord);

        if (!isConf || isTerminus) {
          const role = isTerminus ? 'basin_terminus' : 'section_boundary';
          const roleLabel = isTerminus ? 'Basin Terminus (Mexico Boundary)' : 'Reach Section Boundary';
          const roleColor = isTerminus ? '#ef4444' : '#0284c7';

          sectionNodeFeatures.push({
            type: 'Feature',
            properties: {
              node_id: `${p.reach || idx}_end`,
              reach_id: p.reach || p.reach_id || `reach_${idx}`,
              reach_name: p.name || 'Unnamed Reach',
              reach_type: p.reach_type || 'free_flowing',
              node_role: role,
              role_label: roleLabel,
              color: roleColor,
              coord_str: `[${endCoord[0].toFixed(5)}, ${endCoord[1].toFixed(5)}]`
            },
            geometry: { type: 'Point', coordinates: [endCoord[0], endCoord[1]] }
          });
        }
      }
    });

    const sectionNodesGeoJSON = {
      type: 'FeatureCollection',
      features: sectionNodeFeatures
    };

    if (!map.getSource('topology-sections')) {
      map.addSource('topology-sections', { type: 'geojson', data: sectionNodesGeoJSON });
      const showSections = document.getElementById('toggle-topology-sections')?.checked ?? false;

      // Outer casing
      map.addLayer({
        id: 'topology-sections-casing',
        type: 'circle',
        source: 'topology-sections',
        layout: { 'visibility': showSections ? 'visible' : 'none' },
        paint: {
          'circle-color': '#ffffff',
          'circle-radius': 5.5,
          'circle-stroke-color': '#0f172a',
          'circle-stroke-width': 1.2
        }
      });

      // Core colored by role
      map.addLayer({
        id: 'topology-sections-core',
        type: 'circle',
        source: 'topology-sections',
        layout: { 'visibility': showSections ? 'visible' : 'none' },
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': 4.0
        }
      });

      // Hit buffer for hover and clicks
      map.addLayer({
        id: 'topology-sections-hit-buffer',
        type: 'circle',
        source: 'topology-sections',
        layout: { 'visibility': showSections ? 'visible' : 'none' },
        paint: {
          'circle-radius': 18,
          'circle-opacity': 0.0001
        }
      });

      map.on('mousemove', 'topology-sections-hit-buffer', (e) => {
        if (!e.features.length) return;
        map.getCanvas().style.cursor = 'pointer';
        const props = e.features[0].properties;
        showHoverTooltip(`
          <div style="font-family:'Inter',sans-serif; min-width: 220px; line-height:1.4;">
            <div style="font-size:9.5px; font-weight:700; color:${props.color}; text-transform:uppercase; letter-spacing:0.04em;">${props.role_label}</div>
            <strong style="font-size:13px; color:#0f172a; display:block; margin-top:1px;">${props.reach_name}</strong>
            <div style="font-size:10.5px; color:#64748b; font-family:monospace; margin-top:3px;">
              WGS84: ${props.coord_str}
            </div>
            <div style="font-size:10px; color:#475569; margin-top:3px;">
              Reach ID: <code>${props.reach_id}</code> (${props.reach_type})
            </div>
          </div>
        `, e.lngLat, 'topology-sections');
      });

      map.on('mouseleave', 'topology-sections-hit-buffer', () => {
        hideHoverTooltip('topology-sections');
      });

      map.on('click', 'topology-sections-hit-buffer', (e) => {
        if (!e.features.length) return;
        if (e.originalEvent) e.originalEvent._handled = true;
        const props = e.features[0].properties;
        highlightSelectedReach(props.reach_id);
      });
    } else {
      map.getSource('topology-sections').setData(sectionNodesGeoJSON);
    }
  }

  function openReachPopup(p, lngLat) {
    window.openReachPopup = openReachPopup;
    const isCanalAlimentador = p.reach === 'div_canal_alimentador_central' || p.reach === 'canal_alimentador_central' || p.id === '09522000';
    const gaugeId = p.gauge_id;
    const portal = getPortalInfo({ id: gaugeId, name: p.name });
    const catBadge = isCanalAlimentador
      ? '<span style="font-size:9.5px;font-weight:700;color:#2b5c8f;background:#ebe4d6;border:1px solid #cfc8ba;padding:1px 5px;border-radius:2px;">Conveyance Canal (1944 Treaty)</span>'
      : (p.category === 'mainstem'
          ? '<span style="font-size:9.5px;font-weight:700;color:#2b5c8f;background:#ebe4d6;padding:1px 5px;border-radius:2px;">Mainstem Reach</span>'
          : (p.category === 'major_tributary'
              ? '<span style="font-size:9.5px;font-weight:700;color:#2b5c8f;background:#ebe4d6;padding:1px 5px;border-radius:2px;">Major Tributary</span>'
              : '<span style="font-size:9.5px;font-weight:600;color:#2b5c8f;background:#f2ede2;padding:1px 5px;border-radius:2px;">Tributary Stream</span>'));

    const timeHtml = p.timestamp ? `<div style="font-size:10px;color:#5c5346;margin-top:3px;">Measured: ${formatTimestamp(p.timestamp)}</div>` : '';
    
    // Concise descriptive note (at most 1 sentence)
    let singleSentenceNote = '';
    if (p.notes && p.notes !== p.gauge_info) {
      singleSentenceNote = p.notes.split('. ')[0];
      if (!singleSentenceNote.endsWith('.')) singleSentenceNote += '.';
    }
    const notesHtml = singleSentenceNote ? `<div style="font-size:10.5px;color:#5c5346;margin-top:4px;line-height:1.35;">${singleSentenceNote}</div>` : '';

    const norm = p.hist_normal_cfs ? Number(p.hist_normal_cfs) : (gaugeId ? getHistoricalNormal(gaugeId) : null);
    let healthHtml = '';
    if (norm && norm > 0 && p.flow_cfs != null) {
      const pct = p.health_pct != null ? Number(p.health_pct) : Math.round((Number(p.flow_cfs) / norm) * 100);
      const color = p.health_color || flowHealthColor(pct);
      const label = p.health_label || flowHealthLabel(pct);
      healthHtml = `
        <div style="margin-top:5px; padding:4px 8px; background:#f2ede2; border:1px solid #cfc8ba; border-radius:3px; display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:10px; color:#5c5346; font-weight:600;">vs. Hist. Daily Avg</span>
          <span style="font-size:12px; font-weight:800; color:${color}; font-variant-numeric:tabular-nums;">${pct}% <span style="font-size:10px; font-weight:600;">(${label})</span></span>
        </div>
        <div style="margin-top:2px; font-size:9.5px; color:#786e60;">Avg today: ${Math.round(norm).toLocaleString()} cfs</div>
      `;
    }

    highlightSelectedReach(p.reach);

    let conf = p.confluence_info;
    if (typeof conf === 'string') {
      try { conf = JSON.parse(conf); } catch (e) { conf = null; }
    }
    let confluenceHtml = '';
    if (conf && conf.confluence_name) {
      const qUp = Math.round(Number(conf.mainstem_upstream?.cfs) || 0);
      const isDiversion = Boolean(
        conf.is_diversion ||
        conf.tributary?.is_diversion ||
        (conf.tributary?.name && conf.tributary.name.toLowerCase().includes('diversion'))
      );
      const rawTrib = Math.round(Number(conf.tributary?.cfs) || 0);
      const qTrib = isDiversion ? -Math.abs(rawTrib) : rawTrib;
      const qReach = Math.round(Number(p.flow_cfs) || 0);

      // Confluence combined inflow right at the confluence junction
      const qConfluenceCombined = qUp + qTrib;
      // Net additional water picked up (or lost) between the confluence and downstream reach gage
      const delta = qReach - qConfluenceCombined;

      let deltaRow = '';
      if (delta > 0) {
        deltaRow = `
          <div style="display:flex; justify-content:space-between; font-size:10px; color:#4f463a; margin-bottom:2px;" title="Additional water picked up via unmeasured lateral tributaries, springs, groundwater accretion, or diurnal wave travel lag between the confluence and downstream gage">
            <span>+ Additional Inflow to Downstream Gage:</span>
            <strong style="color:#059669; font-variant-numeric:tabular-nums;">+${delta.toLocaleString()} cfs</strong>
          </div>
        `;
      } else if (delta < 0) {
        deltaRow = `
          <div style="display:flex; justify-content:space-between; font-size:10px; color:#4f463a; margin-bottom:2px;" title="Channel seepage, irrigation/canal diversions, evaporation, or diurnal wave travel lag between the confluence and downstream gage">
            <span>- Diversions & Losses to Downstream Gage:</span>
            <strong style="color:#d97706; font-variant-numeric:tabular-nums;">-${Math.abs(delta).toLocaleString()} cfs</strong>
          </div>
        `;
      }

      const downstreamLabel = conf.downstream_gage ? ` (${conf.downstream_gage})` : '';

      confluenceHtml = `
        <div style="margin-top:6px; padding:6px 8px; background:#ebe4d6; border:1px solid #cfc8ba; border-radius:3px;">
          <div style="font-size:9px; font-weight:800; color:#2b5c8f; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:2px;">
            Confluence Mass Balance
          </div>
          <div style="font-size:10.5px; font-weight:700; color:#0f172a; margin-bottom:3px;">
            ${conf.confluence_name}
          </div>
          <div style="display:flex; justify-content:space-between; font-size:10px; color:#4f463a; margin-bottom:2px;">
            <span>↑ Upstream Mainstem:</span>
            <strong style="color:#2b5c8f; font-variant-numeric:tabular-nums;">${qUp.toLocaleString()} cfs</strong>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:10px; color:#4f463a; margin-bottom:3px;">
            <span>${isDiversion ? '- Diversion' : '+ Inflow'} (${conf.tributary.name}):</span>
            <strong style="color:${isDiversion ? '#d97706' : '#2b5c8f'}; font-variant-numeric:tabular-nums;">${isDiversion ? '-' : ''}${Math.abs(rawTrib).toLocaleString()} cfs</strong>
          </div>
          ${deltaRow}
          <div style="border-top:1px dashed #b8ae9c; padding-top:2px; margin-top:2px; display:flex; justify-content:space-between; font-size:10.5px; font-weight:800; color:#0f172a;">
            <span>= Reach Discharge${downstreamLabel}:</span>
            <span style="color:#2b5c8f; font-variant-numeric:tabular-nums;">${qReach.toLocaleString()} cfs</span>
          </div>
        </div>
      `;
    }

    let waveTransitClickHtml = '';
    if (p.reach === 'grand_canyon' || p.reach === 'grand_canyon_lower') {
      const pr = activeMetrics?.streamflows?.find(s => s.id === '09402500')?.flow_cfs || 8300;
      const dc = activeMetrics?.streamflows?.find(s => s.id === '09404200')?.flow_cfs || 8300;
      if (Math.abs(pr - dc) >= 1500) {
        waveTransitClickHtml = `
          <div style="margin-top:6px; padding:6px 8px; background:#fef3c7; border:1px solid #fde68a; border-radius:3px;">
            <div style="font-size:9.5px; font-weight:800; color:#b45309; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:2px;">
              Active Flood Wave in Transit (~32-Hr Travel Lag)
            </div>
            <div style="font-size:10px; color:#78350f; line-height:1.35;">
              Phantom Ranch (<strong>${Math.round(pr).toLocaleString()} cfs</strong>) to Diamond Creek (<strong>${Math.round(dc).toLocaleString()} cfs</strong>) over 137 canyon miles.
            </div>
          </div>
        `;
      }
    }

    const dataHtml = `
      <div style="padding:2px;">
        <div style="margin-bottom:3px;">${catBadge}</div>
        <strong style="font-size:13px; color:#0f172a; line-height:1.3; display:block;">${p.name}</strong>
        <div style="margin:5px 0; padding:5px 8px; background:#f2ede2; border-radius:3px; border:1px solid #cfc8ba; display:flex; justify-content:space-between; align-items:baseline;">
          <span style="font-size:11px; color:#5c5346; font-weight:600;">Discharge:</span>
          <span style="font-size:15px; font-weight:800; color:#2b5c8f; font-variant-numeric:tabular-nums;">${Number(p.flow_cfs).toLocaleString()} <span style="font-size:10px; font-weight:600; color:#5c5346;">cfs</span></span>
        </div>
        ${healthHtml}
        ${confluenceHtml}
        ${waveTransitClickHtml}
        ${timeHtml}
        ${notesHtml}
        ${isCanalAlimentador ? `
        <div style="font-size:10.5px; color:#3e3226; margin-top:5px; line-height:1.35; border-top:1px solid #cfc8ba; padding-top:4px;">
          <strong>Legal Allocation:</strong> 1.50 MAF/yr (~2,072 cfs) under the 1944 Treaty (Morelos Dam). Verified at border via USGS #09522000.
        </div>` : ''}
        ${formatPortalHtml(portal, '#2b5c8f')}
      </div>
    `;

    const cleanReachName = (p.name || 'River Reach').replace(/["\\]/g, '');
    let pyCode = '';
    let endpointUrl = '';
    let notes = '';

    if (isCanalAlimentador || gaugeId === "09522000") {
      endpointUrl = `https://waterservices.usgs.gov/nwis/dv/?sites=09522000&parameterCd=00060&format=json`;
      pyCode = `import requests

# USGS / CILA Border Station #09522000 (Morelos Dam Delivery)
url = "https://waterservices.usgs.gov/nwis/dv/"
params = {
    "sites": "09522000",       # Colorado River at NIB above Morelos Dam
    "parameterCd": "00060",  # Canal Diversion / Treaty Flow (cfs)
    "format": "json"
}
res = requests.get(url, params=params, timeout=10).json()
val = res["value"]["timeSeries"][0]["values"][0]["value"][-1]
flow_cfs = float(val["value"])
print(f"Canal Diversion: {flow_cfs:,.0f} cfs at {val['dateTime']}")`;
      notes = "Verified at border via USGS #09522000 above Morelos Dam.";
    } else if (gaugeId) {
      const isUsbrReach = gaugeId.startsWith('USBR') || (p.name && p.name.includes('USBR'));
      const isCdssReach = gaugeId.endsWith('CO') || gaugeId.endsWith('TUNCO') || gaugeId.endsWith('DIVCO');
      if (isUsbrReach) {
        endpointUrl = "https://www.usbr.gov/lc/region/g4000/hourly/hourly.html";
        pyCode = `import requests

# USBR Lower Colorado River Operations Teletype
url = "https://www.usbr.gov/lc/region/g4000/hourly/hourly.html"
res = requests.get(url, timeout=10)
# Managed hydroelectric release parsed from USBR RiverOps teletype
print(f"${cleanReachName}: Hydroelectric release from USBR Lower Colorado Operations")`;
        notes = "Managed dam release parsed from USBR Lower Colorado River Operations hourly teletype.";
      } else if (isCdssReach) {
        endpointUrl = `https://dwr.state.co.us/Tools/Stations?station=${encodeURIComponent(gaugeId)}`;
        pyCode = `import requests

# Colorado DWR / CDSS Surface Water REST API
url = "https://dwr.state.co.us/Rest/GET/api/v2/surfacewater/surfacewatertsday/"
params = {
    "format": "json",
    "stationNum": "${gaugeId}"
}
res = requests.get(url, params=params, timeout=10).json()`;
        notes = "Colorado Division of Water Resources instantaneous surface water telemetry.";
      } else {
        endpointUrl = `https://waterservices.usgs.gov/nwis/iv/?sites=${gaugeId}&parameterCd=00060&format=json`;
        pyCode = `import requests

# USGS NWIS Instantaneous Values (IV) API
url = "https://waterservices.usgs.gov/nwis/iv/"
params = {
    "sites": "${gaugeId}",       # ${cleanReachName}
    "parameterCd": "00060",  # Streamflow discharge (cfs)
    "format": "json"
}
res = requests.get(url, params=params, timeout=10).json()
val = res["value"]["timeSeries"][0]["values"][0]["value"][-1]
flow_cfs = float(val["value"])
print(f"${cleanReachName}: {flow_cfs:,.0f} cfs at {val['dateTime']}")`;
        notes = `Discharge indexed from USGS gage #${gaugeId}.`;
      }
    } else {
      pyCode = `# Reach Hydrology: Mass-Balance Network Routing
reach_flow_cfs = ${Number(p.flow_cfs || 0)}
print(f"${cleanReachName} Calculated Flow: {reach_flow_cfs:,.0f} cfs")`;
      notes = "Calculated via conservation-of-mass river routing across confluences.";
    }

    const popupHtml = formatTabbedPopup({
      dataHtml,
      codeTitle: gaugeId ? (gaugeId.startsWith('USBR') ? `USBR Reach #${gaugeId}` : (gaugeId.endsWith('CO') ? `CDSS Reach #${gaugeId}` : `USGS Reach #${gaugeId}`)) : cleanReachName,
      endpointUrl,
      pythonCode: pyCode,
      notes
    });
    const popup = new maplibregl.Popup({ offset: 10 }).setHTML(popupHtml);
    showFeaturePopup(popup, lngLat);
    return popup;
  }
  window.openReachPopup = openReachPopup;

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

      // 2b. Selected Tunnel Highlight (Editorial Cartographic Casing & Core)
      map.addLayer({
        id: 'tunnels-selected-highlight-casing',
        type: 'line',
        source: 'tunnels',
        filter: ['==', ['get', 'id'], ''],
        layout: {
          'visibility': showTunnels ? 'visible' : 'none',
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': '#0f172a',
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            5, ['+', ['*', ['get', 'flow_cfs'], 0.005], 6],
            8, ['+', ['*', ['get', 'flow_cfs'], 0.008], 8],
            12, ['+', ['*', ['get', 'flow_cfs'], 0.012], 10]
          ],
          'line-opacity': 0.90
        }
      });
      map.addLayer({
        id: 'tunnels-selected-highlight-core',
        type: 'line',
        source: 'tunnels',
        filter: ['==', ['get', 'id'], ''],
        layout: {
          'visibility': showTunnels ? 'visible' : 'none',
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': '#cbd5e1',
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            5, ['+', ['*', ['get', 'flow_cfs'], 0.005], 3],
            8, ['+', ['*', ['get', 'flow_cfs'], 0.008], 4],
            12, ['+', ['*', ['get', 'flow_cfs'], 0.012], 5]
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
        if (hasHigherPriorityFeature(e.point, ['dams-hit-buffer', 'dams-layer', 'streamflow-gauges-hit-buffer'])) return;
        map.getCanvas().style.cursor = 'pointer';
        const t = e.features[0].properties;
        const flowVal = Number(t.flow_cfs || 0);
        const flowDisplay = flowVal > 0 
          ? `<span style="font-size:15px; font-weight:800; color:#0284c7; font-variant-numeric:tabular-nums;">${flowVal.toLocaleString()} <span style="font-size:10.5px; font-weight:600; color:#64748b;">cfs</span></span>`
          : `<span style="font-size:13px; font-weight:700; color:#64748b;">0.0 cfs <span style="font-size:10px;">(Closed)</span></span>`;

        showHoverTooltip(`
          <div style="font-family:'Inter',sans-serif; min-width: 200px; max-width: 280px; line-height:1.4;">
            <div style="font-size:9.5px; font-weight:700; color:#0369a1; text-transform:uppercase; letter-spacing:0.04em;">TRANS-MOUNTAIN TUNNEL</div>
            <strong style="font-size:13px; color:#0f172a; display:block; margin-top:1px;">${t.name}</strong>
            <div style="margin:3px 0;">${flowDisplay}</div>
            <div style="font-size:10.5px; color:#64748b;">${t.operator ? t.operator + ' • ' : ''}CDSS #${t.id}</div>
          </div>
        `, e.lngLat, 'tunnels');
      };

      map.on('mousemove', 'tunnels-hit-buffer', handleTunnelHover);
      map.on('mousemove', 'tunnels-portals-layer', handleTunnelHover);

      const handleTunnelLeave = () => {
        hideHoverTooltip('tunnels');
      };
      map.on('mouseleave', 'tunnels-hit-buffer', handleTunnelLeave);
      map.on('mouseleave', 'tunnels-portals-layer', handleTunnelLeave);

      const handleTunnelClick = (e) => {
        if (e.originalEvent && e.originalEvent._handled) return;
        if (!e.features.length) return;
        if (hasHigherPriorityFeature(e.point, ['streamflow-gauges-hit-buffer', 'dams-layer'])) return;
        if (e.originalEvent) e.originalEvent._handled = true;
        const t = e.features[0].properties;
        const flowVal = Number(t.flow_cfs || 0);
        const capDisplay = t.capacity_cfs ? `${Number(t.capacity_cfs).toLocaleString()} cfs` : '1,020 cfs';
        const portal = getPortalInfo(t);

        highlightSelectedConduit('tunnel', t.id);

        let singleSentenceNote = '';
        if (t.historical_note) {
          singleSentenceNote = t.historical_note.split('. ')[0];
          if (!singleSentenceNote.endsWith('.')) singleSentenceNote += '.';
        }

        const dataHtml = `
          <div style="padding: 2px;">
            <div style="font-size:9.5px; font-weight:700; color:#2b5c8f; background:#ebe4d6; border:1px solid #cfc8ba; padding:1px 5px; border-radius:2px; display:inline-block; margin-bottom:3px;">Trans-Mountain Diversion Tunnel</div>
            <strong style="font-size:13.5px; color:#0f172a; display:block;">${t.name}</strong>
            <span style="font-size:11px; color:#2b5c8f; font-weight:600;">${t.operator || ''}</span>
            <div style="margin: 5px 0; padding: 5px 8px; background:#f2ede2; border-radius:3px; border:1px solid #cfc8ba; display:flex; justify-content:space-between; align-items:baseline;">
              <span style="font-size:11px; color:#5c5346; font-weight:600;">Current Diversion:</span>
              <span style="font-size:15px; font-weight:800; color:#2b5c8f; font-variant-numeric:tabular-nums;">${flowVal.toLocaleString()} cfs</span>
            </div>
            <div style="font-size:11px; line-height:1.4; color:#3e3226;">
              <strong>Destination:</strong> ${t.destination || t.to}<br>
              <strong>Length:</strong> ${t.length_miles ? t.length_miles + ' miles under Divide' : 'Trans-Continental Divide'}<br>
              <strong>Capacity:</strong> ${capDisplay}
              ${singleSentenceNote ? `<div style="margin-top:4px; font-size:10.5px; color:#5c5346;">${singleSentenceNote}</div>` : ''}
            </div>
            ${formatPortalHtml(portal, '#2b5c8f')}
          </div>
        `;
        const cleanTName = (t.name || '').replace(/["\\]/g, '');
        const endpoint = `https://dwr.state.co.us/Rest/GET/api/v2/telemetrystations/telemetrytimeserieshour/?abbrev=${t.id}&format=json`;
        const pyCode = `import requests

# Colorado DWR HydroBase REST API v2
url = "https://dwr.state.co.us/Rest/GET/api/v2/telemetrystations/telemetrytimeserieshour/"
params = {
    "abbrev": "${t.id}",  # ${cleanTName}
    "format": "json"
}
res = requests.get(url, params=params, timeout=10).json()
reading = res["ResultList"][0]
flow_cfs = float(reading["measValue"])
print(f"${cleanTName}: {flow_cfs:,.1f} cfs")`;

        const popupHtml = formatTabbedPopup({
          dataHtml,
          codeTitle: `Colorado DWR: ${t.id}`,
          endpointUrl: endpoint,
          pythonCode: pyCode,
          notes: "Trans-mountain diversion monitoring under Continental Divide."
        });
        const popup = new maplibregl.Popup({ offset: 8 }).setHTML(popupHtml);
        showFeaturePopup(popup, e.lngLat);
      };

      map.on('click', 'tunnels-hit-buffer', handleTunnelClick);
      map.on('click', 'tunnels-portals-layer', handleTunnelClick);
    }

    // 5b. Major Conveyance Canals (All-American Canal, CRA, CAP & Canal Alimentador Central)
    if (!map.getSource('canals')) {
      const canalsGeoJSON = {
        type: 'FeatureCollection',
        features: canalFeats.map(t => {
          const flow = t.flow_cfs || 0;
          return {
            type: 'Feature',
            properties: { 
              ...t,
              weight: computeCanalWeight(flow)
            },
            geometry: { type: 'LineString', coordinates: t.coords }
          };
        })
      };

      map.addSource('canals', { type: 'geojson', data: canalsGeoJSON });
      const showCanals = document.getElementById('toggle-canals')?.checked ?? true;
      // Crisp, pure blue dotted line for canals (dynamic line-width scaled with flow)
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
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            6, ['coalesce', ['get', 'weight'], 2.8],
            10, ['*', ['coalesce', ['get', 'weight'], 2.8], 1.25],
            13, ['*', ['coalesce', ['get', 'weight'], 2.8], 1.6]
          ],
          'line-dasharray': [3, 2.5],
          'line-opacity': 1.0
        }
      });

      // Selected Canal Highlight (Editorial Cartographic Casing & Core)
      map.addLayer({
        id: 'canals-selected-highlight-casing',
        type: 'line',
        source: 'canals',
        filter: ['==', ['get', 'id'], ''],
        layout: {
          'visibility': showCanals ? 'visible' : 'none',
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': '#0f172a',
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            6, ['*', ['coalesce', ['get', 'weight'], 2.8], 2.2],
            10, ['*', ['coalesce', ['get', 'weight'], 2.8], 2.6],
            13, ['*', ['coalesce', ['get', 'weight'], 2.8], 3.0]
          ],
          'line-opacity': 0.90
        }
      });
      map.addLayer({
        id: 'canals-selected-highlight-core',
        type: 'line',
        source: 'canals',
        filter: ['==', ['get', 'id'], ''],
        layout: {
          'visibility': showCanals ? 'visible' : 'none',
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': '#f8fafc',
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            6, ['coalesce', ['get', 'weight'], 2.8],
            10, ['*', ['coalesce', ['get', 'weight'], 2.8], 1.2],
            13, ['*', ['coalesce', ['get', 'weight'], 2.8], 1.4]
          ],
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
        if (hasHigherPriorityFeature(e.point, ['dams-hit-buffer', 'dams-layer', 'streamflow-gauges-hit-buffer'])) return;
        map.getCanvas().style.cursor = 'pointer';
        const t = e.features[0].properties;
        const isOffline = t.data_status === 'offline' || t.status === 'offline' || t.flow_cfs == null;
        const flowVal = Number(t.flow_cfs || 0);

        let flowDisplay = '';
        if (isOffline) {
          flowDisplay = `<span style="font-size:13px; font-weight:700; color:#dc2626;">Offline <span style="font-size:10px; color:#94a3b8;">(Discontinued)</span></span>`;
        } else if (t.data_status === 'delayed' || t.status === 'delayed') {
          flowDisplay = `<span style="font-size:15px; font-weight:800; color:#0284c7; font-variant-numeric:tabular-nums;">${flowVal.toLocaleString()} <span style="font-size:10.5px; font-weight:600; color:#64748b;">cfs</span></span> <span style="font-size:9.5px; font-weight:600; color:#b45309;">(Delayed)</span>`;
        } else {
          flowDisplay = `<span style="font-size:15px; font-weight:800; color:#0284c7; font-variant-numeric:tabular-nums;">${flowVal.toLocaleString()} <span style="font-size:10.5px; font-weight:600; color:#64748b;">cfs</span></span>`;
        }

        showHoverTooltip(`
          <div style="font-family:'Inter',sans-serif; min-width: 200px; max-width: 280px; line-height:1.4;">
            <div style="font-size:9.5px; font-weight:700; color:#0369a1; text-transform:uppercase; letter-spacing:0.04em;">CONVEYANCE CANAL</div>
            <strong style="font-size:13px; color:#0f172a; display:block; margin-top:1px;">${t.name}</strong>
            <div style="margin:3px 0;">${flowDisplay}</div>
            <div style="font-size:10.5px; color:#64748b;">${t.operator ? t.operator + ' • ' : ''}USGS #${t.id}</div>
          </div>
        `, e.lngLat, 'canals');
      });

      map.on('mouseleave', 'canals-hit-buffer', () => {
        hideHoverTooltip('canals');
      });

      map.on('click', 'canals-hit-buffer', (e) => {
        if (e.originalEvent && e.originalEvent._handled) return;
        if (!e.features.length) return;
        if (hasHigherPriorityFeature(e.point, ['streamflow-gauges-hit-buffer', 'dams-layer'])) return;
        if (e.originalEvent) e.originalEvent._handled = true;
        const t = e.features[0].properties;
        const isOffline = t.data_status === 'offline' || t.status === 'offline' || t.flow_cfs == null;
        const flowVal = Number(t.flow_cfs || 0);
        const portal = getPortalInfo(t);

        highlightSelectedConduit('canal', t.id);

        let singleSentenceNote = '';
        if (t.historical_note) {
          singleSentenceNote = t.historical_note.split('. ')[0];
          if (!singleSentenceNote.endsWith('.')) singleSentenceNote += '.';
        }

        const statusFlowBox = isOffline
          ? `<div style="margin: 5px 0; padding: 5px 8px; background:#fef2f2; border-radius:3px; border:1px solid #fecaca; display:flex; justify-content:space-between; align-items:baseline;">
               <span style="font-size:11px; color:#991b1b; font-weight:700;">Status:</span>
               <span style="font-size:12px; font-weight:700; color:#dc2626;">Offline (Discontinued USGS Station)</span>
             </div>`
          : `<div style="margin: 5px 0; padding: 5px 8px; background:#f2ede2; border-radius:3px; border:1px solid #cfc8ba; display:flex; justify-content:space-between; align-items:baseline;">
               <span style="font-size:11px; color:#5c5346; font-weight:600;">Current Diversion:</span>
               <span style="font-size:15px; font-weight:800; color:#2b5c8f; font-variant-numeric:tabular-nums;">${flowVal.toLocaleString()} cfs ${(t.data_status === 'delayed' || t.status === 'delayed') ? '<span style="font-size:9.5px; color:#b45309;">(Delayed)</span>' : ''}</span>
             </div>`;

        const dataHtml = `
          <div style="padding: 2px;">
            <div style="font-size:9.5px; font-weight:700; color:#2b5c8f; background:#ebe4d6; border:1px solid #cfc8ba; padding:1px 5px; border-radius:2px; display:inline-block; margin-bottom:3px;">Major Conveyance Canal</div>
            <strong style="font-size:13.5px; color:#0f172a; display:block;">${t.name}</strong>
            <span style="font-size:11px; color:#2b5c8f; font-weight:600;">${t.operator || ''}</span>
            ${statusFlowBox}
            <div style="font-size:11px; line-height:1.4; color:#3e3226; margin-top:4px;">
              <strong>Destination:</strong> ${t.destination || t.to}<br>
              <strong>Length:</strong> ${t.length_miles} miles<br>
              ${t.timestamp ? `<strong>Measured:</strong> ${formatTimestamp(t.timestamp)}<br>` : ''}
              ${singleSentenceNote ? `<div style="margin-top:4px; font-size:10.5px; color:#5c5346;">${singleSentenceNote}</div>` : ''}
            </div>
            ${formatPortalHtml(portal, '#2b5c8f')}
          </div>
        `;
        const cleanCName = (t.name || '').replace(/["\\]/g, '');
        const isDvStation = t.id === "09522000" || t.id === "09426650" || t.id === "09424150";
        const endpoint = isDvStation 
          ? `https://waterservices.usgs.gov/nwis/dv/?sites=${t.id}&parameterCd=00060&format=json`
          : `https://waterservices.usgs.gov/nwis/iv/?sites=${t.id}&parameterCd=00060&format=json`;
        const pyCode = `import requests

# ${t.id === "09522000" ? "USGS / CILA Border Station" : "USGS Canal Monitoring Station"} #${t.id}
url = "${isDvStation ? "https://waterservices.usgs.gov/nwis/dv/" : "https://waterservices.usgs.gov/nwis/iv/"}"
params = {
    "sites": "${t.id}",       # ${cleanCName}
    "parameterCd": "00060",  # Canal Flow (cfs)
    "format": "json"
}
res = requests.get(url, params=params, timeout=10).json()
try:
    val = res["value"]["timeSeries"][0]["values"][0]["value"][-1]
    flow_cfs = float(val["value"])
    print(f"${cleanCName}: {flow_cfs:,.0f} cfs at {val['dateTime']}")
except Exception as e:
    print(f"${cleanCName}: Station offline or inactive ({e})")`;

        const popupHtml = formatTabbedPopup({
          dataHtml,
          codeTitle: t.id === "09522000" ? `USGS / CILA Border Station #${t.id}` : `USGS Canal #${t.id}`,
          endpointUrl: endpoint,
          pythonCode: pyCode,
          notes: t.id === "09522000" ? "1944 Treaty international diversion monitoring at Morelos Dam." : (isOffline ? "Gage discontinued by USGS NWIS in Oct 2022." : "Major conveyance canal monitoring.")
        });
        const popup = new maplibregl.Popup({ offset: 8 }).setHTML(popupHtml);
        showFeaturePopup(popup, e.lngLat);
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
      if (!map.getLayer('dams-hit-buffer')) {
        map.addLayer({
          id: 'dams-hit-buffer',
          type: 'circle',
          source: 'dams',
          paint: {
            'circle-radius': 20,
            'circle-opacity': 0.0001
          }
        });
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
      ensurePointLayersOnTop();
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(damSvg);

    const handleDamClick = (e) => {
      if (e.originalEvent && e.originalEvent._handled) return;
      if (!e.features.length) return;
      if (hasHigherPriorityFeature(e.point, ['streamflow-gauges-hit-buffer'])) return;
      if (e.originalEvent) e.originalEvent._handled = true;
      const d = e.features[0].properties;
      if (d.id) highlightActiveStationRow(d.id);
      const portal = getPortalInfo(d);
      let singleSentenceNote = '';
      if (d.historical_note) {
        singleSentenceNote = d.historical_note.split('. ')[0];
        if (!singleSentenceNote.endsWith('.')) singleSentenceNote += '.';
      }

      const dataHtml = `
        <div style="padding:2px;">
          <div style="font-size:9.5px; font-weight:700; color:#2b5c8f; background:#ebe4d6; padding:1px 5px; border-radius:2px; display:inline-block; margin-bottom:3px;">Federal Dam</div>
          <strong style="font-size:13.5px; color:#0f172a; display:block;">${d.name}</strong>
          <span style="font-size:11px; color:#5c5346; font-weight:600;">${d.operator}</span>
          <div style="margin:5px 0; padding:5px 8px; background:#f2ede2; border-radius:3px; border:1px solid #cfc8ba; font-size:11px; line-height:1.4; color:#3e3226;">
            <strong>Impounds:</strong> ${d.impounds}<br>
            <strong>Height:</strong> ${d.height_ft} ft | <strong>Built:</strong> ${d.year}<br>
            <strong>Purpose:</strong> ${d.purpose}
            ${singleSentenceNote ? `<div style="margin-top:3px; color:#5c5346; font-size:10.5px;">${singleSentenceNote}</div>` : ''}
          </div>
          ${formatPortalHtml(portal, '#2b5c8f')}
        </div>
      `;
      const cleanDamName = (d.name || 'Dam').replace(/["\\]/g, '');
      const cleanImpounds = (d.impounds || '').replace(/["\\]/g, '');
      const pyCode = `import requests

# USBR National Dam Inventory & River Operations
# Facility: ${cleanDamName} (Impounds ${cleanImpounds})
# Operator: ${d.operator}
url = "https://waterservices.usgs.gov/nwis/iv/"
params = {
    "siteStatus": "all",
    "parameterCd": "00060",  # Tailwater release discharge (cfs)
    "format": "json"
}
# Operations synchronize daily release schedules with reservoir storage curves`;

      const popupHtml = formatTabbedPopup({
        dataHtml,
        codeTitle: `${cleanDamName}`,
        endpointUrl: portal?.url || 'https://www.usbr.gov/lc/region/g4000/hourly/hourly.html',
        pythonCode: pyCode,
        notes: `Federal dam operations & tailwater release monitoring. Built ${d.year}.`
      });
      const popup = new maplibregl.Popup({ offset: 14 }).setHTML(popupHtml);
      showFeaturePopup(popup, e.lngLat);
    };

    const handleDamHover = (e) => {
      if (!e.features.length) return;
      const d = e.features[0].properties;
      showHoverTooltip(`
        <div style="font-family:'Inter',sans-serif; min-width: 190px; line-height:1.4;">
          <div style="font-size:9.5px; font-weight:700; color:#0369a1; text-transform:uppercase; letter-spacing:0.04em;">FEDERAL DAM</div>
          <strong style="font-size:13px; color:#0f172a; display:block; margin-top:1px;">${d.name}</strong>
          <div style="font-size:11px; color:#334155; margin:2px 0;">Impounds <strong>${d.impounds}</strong> • Height: ${d.height_ft} ft</div>
          <div style="font-size:10.5px; color:#64748b;">${d.operator} • Built ${d.year}</div>
        </div>
      `, e.lngLat, 'dams');
    };

    const handleDamLeave = () => {
      hideHoverTooltip('dams');
    };

    map.on('click', 'dams-layer', handleDamClick);
    map.on('click', 'dams-hit-buffer', handleDamClick);
    map.on('mousemove', 'dams-layer', handleDamHover);
    map.on('mousemove', 'dams-hit-buffer', handleDamHover);
    map.on('mouseleave', 'dams-layer', handleDamLeave);
    map.on('mouseleave', 'dams-hit-buffer', handleDamLeave);
  }

  ensurePointLayersOnTop();
}

function ensurePointLayersOnTop() {
  if (!map) return;
  const topPointLayers = [
    'flow-direction-arrows',
    'gis-flow-arrows',
    'topology-sections-casing',
    'topology-sections-core',
    'topology-junctions',
    'tunnels-portals-layer',
    'streamflow-gauges-casing',
    'streamflow-gauges-circle',
    'dams-layer',
    'streamflow-gauges-hit-buffer',
    'topology-sections-hit-buffer',
    'topology-junctions-hit-buffer',
    'dams-hit-buffer'
  ];
  topPointLayers.forEach(id => {
    if (map.getLayer(id)) {
      map.moveLayer(id);
    }
  });
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

// Color scale: critically low → low → below-normal → normal → abundant (ColorBrewer RdYlBu standard)
function flowHealthColor(pctOfNormal) {
  if (pctOfNormal === null || pctOfNormal === undefined) return '#0284c7';  // fallback / unmonitored baseline
  if (pctOfNormal >= 150) return '#1d4ed8';  // abundant — deep water blue
  if (pctOfNormal >= 90)  return '#0284c7';  // normal — water blue
  if (pctOfNormal >= 50)  return '#d97706';  // below normal — warm ochre
  if (pctOfNormal >= 25)  return '#ea580c';  // low — terracotta
  return '#b2182b';                           // critically low — deep oxblood
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

  const coreColor = show ? [
    'case',
    ['==', ['get', 'reach_type'], 'submerged_path'], '#0369a1',
    ['coalesce', ['get', 'health_color'], '#0284c7']
  ] : '#0284c7';

  const glowColor = show ? [
    'case',
    ['==', ['get', 'reach_type'], 'submerged_path'], 'rgba(0,0,0,0)',
    ['coalesce', ['get', 'health_color'], '#38bdf8']
  ] : '#38bdf8';

  // Apply colors directly to the existing river layers without dimming anything
  ['rivers-mainstem-core', 'rivers-major-core', 'rivers-minor-core'].forEach(id => {
    if (map.getLayer(id)) {
      map.setPaintProperty(id, 'line-color', coreColor);
      map.setPaintProperty(id, 'line-opacity', 0.95);
    }
  });

  ['rivers-mainstem-glow', 'rivers-major-glow'].forEach(id => {
    if (map.getLayer(id)) {
      map.setPaintProperty(id, 'line-color', glowColor);
      map.setPaintProperty(id, 'line-opacity', 0.65);
      map.setPaintProperty(id, 'line-blur', 1.5);
    }
  });

  if (map.getLayer('rivers-minor-glow')) {
    map.setPaintProperty('rivers-minor-glow', 'line-color', glowColor);
    map.setPaintProperty('rivers-minor-glow', 'line-opacity', 0.55);
    map.setPaintProperty('rivers-minor-glow', 'line-blur', 1.2);
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

  syncLegendToLayerToggles();
  ensurePointLayersOnTop();
}

// ─── End Flow Health Overlay ─────────────────────────────────────────────────

function formatGaugePopup(s) {
  const isLeesFerry = s.id === "09380000";
  const norm = getHistoricalNormal(s.id);
  let healthBadgeHtml = '';
  if (norm && norm > 0) {
    const pct = Math.round((s.flow_cfs / norm) * 100);
    const color = flowHealthColor(pct);
    const label = flowHealthLabel(pct);
    healthBadgeHtml = `
      <div style="margin: 5px 0; padding: 4px 8px; background:#f2ede2; border:1px solid #cfc8ba; border-radius:3px; display:flex; justify-content:space-between; align-items:center;">
        <span style="font-size:10px; color:#5c5346; font-weight:600;">vs. Hist. Daily Avg:</span>
        <span style="font-size:12px; font-weight:800; color:${color}; font-variant-numeric:tabular-nums;">${pct}% <span style="font-size:10px; font-weight:600;">(${label})</span></span>
      </div>
      <div style="font-size:9.5px; color:#786e60; margin-bottom:5px;">Avg today: ${Math.round(norm).toLocaleString()} cfs</div>
    `;
  }

  const portal = getPortalInfo(s);
  const isUsbr = s.id.startsWith('USBR') || s.provider === 'USBR' || (s.name && s.name.includes('USBR'));
  const isCdss = s.id.endsWith('CO') || s.id.endsWith('TUNCO') || s.id.endsWith('DIVCO') || s.provider === 'CDWR';
  
  let portalUrl = portal ? portal.url : null;
  if (!portalUrl) {
    if (/^\d{8}$/.test(s.id)) {
      portalUrl = `https://waterdata.usgs.gov/monitoring-location/${s.id}/#parameterCode=00060`;
    } else if (isUsbr) {
      portalUrl = 'https://www.usbr.gov/lc/region/g4000/hourly/hourly.html';
    } else if (isCdss) {
      portalUrl = `https://dwr.state.co.us/Tools/Stations?station=${encodeURIComponent(s.id)}`;
    } else {
      portalUrl = 'https://waterdata.usgs.gov/nwis';
    }
  }

  const typeBadge = isUsbr
    ? '<span style="font-size:9.5px; font-weight:700; color:#065f46; background:#d1fae5; border:1px solid #a7f3d0; padding:1px 5px; border-radius:2px;">USBR Dam Release</span>'
    : (isCdss
        ? '<span style="font-size:9.5px; font-weight:700; color:#9a3412; background:#ffedd5; border:1px solid #fed7aa; padding:1px 5px; border-radius:2px;">CDSS Diversion Tunnel</span>'
        : '<span style="font-size:9.5px; font-weight:700; color:#2b5c8f; background:#ebe4d6; padding:1px 5px; border-radius:2px;">USGS Gage</span>');

  const dataHtml = `
    <div style="padding: 2px;">
      <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
        ${typeBadge}
        ${isLeesFerry ? '<span style="font-size:9.5px; font-weight:700; color:#2b5c8f; background:#ebe4d6; border: 1px solid #cfc8ba; padding:1px 5px; border-radius:2px;">1922 Compact Divide</span>' : ''}
      </div>
      <strong style="font-size:13px; color:#0f172a; line-height:1.3; display:block;">${s.name}</strong>
      <div style="margin: 5px 0; padding: 5px 8px; background:#f2ede2; border-radius:3px; border:1px solid #cfc8ba; display:flex; justify-content:space-between; align-items:baseline;">
        <span style="font-size:11px; color:#5c5346; font-weight:600;">Discharge:</span>
        <span style="font-size:15px; font-weight:800; color:#2b5c8f; font-variant-numeric:tabular-nums;">${(s.flow_cfs || 0).toLocaleString()} <span style="font-size:10.5px; font-weight:600; color:#5c5346;">cfs</span></span>
      </div>
      ${healthBadgeHtml}
      <div style="font-size:11px; color:#4f463a; line-height:1.45;">
        <strong>Station ID:</strong> <a href="${portalUrl}" target="_blank" rel="noopener" style="color:#2b5c8f; text-decoration:none; font-weight:600;">#${s.id} ↗</a><br>
        <strong>Measured:</strong> ${formatTimestamp(s.timestamp)}
      </div>
      ${portal ? `
      <div style="margin-top:6px; padding-top:4px; border-top:1px solid #cfc8ba; font-size:10.5px;">
        <span style="color:#5c5346;">Authoritative Source:</span> 
        <a href="${portalUrl}" target="_blank" rel="noopener" style="color:#2b5c8f; text-decoration:none; font-weight:600;">${portal.name} ↗</a>
      </div>` : ''}
    </div>
  `;

  const cleanName = (s.name || '').replace(/["\\]/g, '');
  let pyCode = '';
  let codeTitle = '';
  let endpointUrl = '';
  let notes = '';

  if (isUsbr) {
    codeTitle = `USBR Operations #${s.id}`;
    endpointUrl = "https://www.usbr.gov/lc/region/g4000/hourly/hourly.html";
    pyCode = `import requests

# USBR Lower Colorado River Operations Teletype
url = "https://www.usbr.gov/lc/region/g4000/hourly/hourly.html"
res = requests.get(url, timeout=10)
# Managed hydroelectric release parsed hourly from the USBR RiverOps teletype table.
print(f"Station: ${cleanName}")
print(f"Authoritative Portal: {url}")`;
    notes = "Hourly hydroelectric releases parsed from USBR Lower Colorado River Operations teletype table.";
  } else if (isCdss) {
    codeTitle = `CDSS Station #${s.id}`;
    endpointUrl = `https://dwr.state.co.us/Tools/Stations?station=${encodeURIComponent(s.id)}`;
    pyCode = `import requests

# Colorado DWR / CDSS Surface Water REST API
url = "https://dwr.state.co.us/Rest/GET/api/v2/surfacewater/surfacewatertsday/"
params = {
    "format": "json",
    "stationNum": "${s.id}"
}
res = requests.get(url, params=params, timeout=10).json()`;
    notes = "Colorado Division of Water Resources instantaneous surface water telemetry.";
  } else {
    codeTitle = `USGS Gauge #${s.id}`;
    endpointUrl = `https://waterservices.usgs.gov/nwis/iv/?sites=${s.id}&parameterCd=00060&format=json`;
    pyCode = `import requests

# USGS Instantaneous Values (IV) REST API
url = "https://waterservices.usgs.gov/nwis/iv/"
params = {
    "sites": "${s.id}",       # ${cleanName}
    "parameterCd": "00060",  # Streamflow (cfs)
    "siteStatus": "all",
    "format": "json"
}
res = requests.get(url, params=params, timeout=10).json()
val = res["value"]["timeSeries"][0]["values"][0]["value"][-1]
flow_cfs = float(val["value"])
print(f"Discharge: {flow_cfs:,.0f} cfs at {val['dateTime']}")`;
    notes = "Parameter 00060 = Discharge (cfs). Data refreshed every 15–60 minutes.";
  }

  return formatTabbedPopup({
    dataHtml,
    codeTitle,
    endpointUrl,
    pythonCode: pyCode,
    notes
  });
}

function formatReservoirStationPopup(r) {
  const cleanResName = (r.name || 'Reservoir').replace(/["\\]/g, '');
  const portal = getPortalInfo(r);
  const portalLink = portal ? `<a href="${portal.url}" target="_blank" rel="noopener" style="color:#2b5c8f; text-decoration:none; font-weight:700; margin-left:4px;">↗</a>` : '';
  const isFrontRange = r.category === 'front_range' || (r.id && ['lake_granby', 'dillon_reservoir', 'green_mountain', 'homestake_reservoir'].includes(r.id));
  const capacityPct = (r.capacity_pct !== undefined && r.capacity_pct !== null) ? r.capacity_pct : Math.round(((r.storage_af || 0) / (r.capacity_af || 1)) * 100);
  const elevText = r.elevation_ft ? `${Number(r.elevation_ft).toLocaleString()} ft` : 'USBR Records';
  const storageAfText = r.storage_af ? `${Math.round(r.storage_af).toLocaleString()} AF` : (r.storage_maf ? `${r.storage_maf.toFixed(2)}M AF` : 'Teletype Reported');
  const capAfText = r.capacity_af ? `${Math.round(r.capacity_af).toLocaleString()} AF` : 'Authoritative Capacity';

  const dataHtml = `
    <div style="padding: 2px;">
      <span style="font-size:10px; font-weight:700; color:#dc2626; background:#fee2e2; border:1px solid #fecaca; padding:2px 6px; border-radius:4px; display:inline-block; margin-bottom:4px;">
        Major Storage Reservoir Station
      </span>
      <strong style="font-size:13.5px; color:#0f172a; display:block;">${cleanResName} ${portalLink}</strong>
      <div style="font-size:11px; color:#5c5346; font-weight:600; margin-bottom:6px;">${r.river || 'Colorado River Basin'} &bull; ${r.operator || (isFrontRange ? 'Denver Water / Northern' : 'USBR')}</div>
      <div style="margin: 6px 0; padding: 6px 8px; background:#f2ede2; border-radius:6px; border:1px solid #cfc8ba;">
        <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px;">
          <span style="font-size:11px; color:#4f463a; font-weight:600;">Current Storage:</span>
          <span style="font-size:15px; font-weight:800; color:#2b5c8f;">${capacityPct}% <span style="font-size:11px; font-weight:600; color:#5c5346;">Full</span></span>
        </div>
        <div style="height:6px; background:#cfc8ba; border-radius:3px; overflow:hidden;">
          <div style="width:${Math.min(100, capacityPct)}%; height:100%; background:${capacityPct < 25 ? '#ef4444' : (capacityPct < 50 ? '#f59e0b' : '#0891b2')};"></div>
        </div>
      </div>
      <div style="font-size:11px; color:#4f463a; line-height:1.5;">
        <strong>Surface Elevation:</strong> ${elevText}<br>
        <strong>Volume Stored:</strong> ${storageAfText}<br>
        <strong>Active Capacity:</strong> ${capAfText}<br>
        <strong>Operational Role:</strong> ${r.role || 'System Storage &amp; Regulation'}<br>
        <strong>Last Synced:</strong> ${formatTimestamp(r.timestamp)}
      </div>
      ${formatPortalHtml(portal, '#dc2626')}
    </div>
  `;

  const endpointUrl = isFrontRange
    ? `https://dwr.state.co.us/Rest/GET/api/v2/telemetrystations/telemetrytimeseriesday/?abbrev=${r.id.toUpperCase()}&format=json`
    : `https://www.usbr.gov/lc/region/g4000/hourly/hourly.html`;

  const pyCode = isFrontRange ? `import requests

# Colorado DWR HydroBase Daily Reservoir Records
url = "https://dwr.state.co.us/Rest/GET/api/v2/telemetrystations/telemetrytimeseriesday/"
params = {"abbrev": "${r.id.toUpperCase()}", "format": "json"}
res = requests.get(url, params=params, timeout=10).json()
reading = res["ResultList"][0]
print(f"${cleanResName} Elevation: {reading['measValue']} ft")` : `import requests

# USBR Lower/Upper Colorado River Operations
# Station: ${cleanResName} (#${r.id})
# Elevation: ${elevText}
print(f"${cleanResName} Storage: ${storageAfText} (${capacityPct}% Full)")`;

  return formatTabbedPopup({
    dataHtml,
    codeTitle: `${cleanResName} Records`,
    endpointUrl,
    pythonCode: pyCode,
    notes: "Official storage reservoir records. Water surface elevation converted to volume via USBR/CDSS elevation-area-capacity curves."
  });
}

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
    el.innerHTML = `<div class="cfs-badge gauge ${highlightClass}"><span class="cfs-val">${(s.flow_cfs || 0).toLocaleString()}</span> <span class="cfs-unit">cfs</span></div>`;

    const popupHtml = formatGaugePopup(s);
    const popup = new maplibregl.Popup({ offset: 12 }).setHTML(popupHtml);

    popup.on('open', () => {
      if (tooltipPopup && tooltipPopup.isOpen()) tooltipPopup.remove();
      if (activeFeaturePopup && activeFeaturePopup !== popup && activeFeaturePopup.isOpen()) {
        activeFeaturePopup.remove();
      }
      activeFeaturePopup = popup;
    });
    popup.on('close', () => {
      if (activeFeaturePopup === popup) activeFeaturePopup = null;
    });

    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
    });

    el.addEventListener('mouseenter', () => {
      const norm = getHistoricalNormal(s.id);
      let healthText = '';
      if (norm && norm > 0 && s.flow_cfs != null) {
        const pct = Math.round((Number(s.flow_cfs) / norm) * 100);
        const color = flowHealthColor(pct);
        healthText = `<span style="font-size:11px; font-weight:700; color:${color}; margin-left:6px;">(${pct}% of Normal)</span>`;
      }
      showHoverTooltip(`
        <div style="font-family:'Inter',sans-serif; min-width: 190px; line-height:1.4;">
          <div style="font-size:9.5px; font-weight:700; color:#2b5c8f; text-transform:uppercase; letter-spacing:0.04em;">USGS GAGE</div>
          <strong style="font-size:13px; color:#0f172a; display:block; margin-top:1px;">${s.name}</strong>
          <div style="font-size:15px; font-weight:800; color:#2b5c8f; font-variant-numeric:tabular-nums; margin:3px 0;">
            ${(s.flow_cfs || 0).toLocaleString()} <span style="font-size:10.5px; font-weight:600; color:#5c5346;">cfs</span> ${healthText}
          </div>
          <div style="font-size:10.5px; color:#5c5346;">Station ID: #${s.id}</div>
        </div>
      `, [s.lon, s.lat], 'gauge-badge');
    });

    el.addEventListener('mouseleave', () => {
      hideHoverTooltip('gauge-badge');
    });

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
        s.id === "09163500" ? 590 : // Colorado R near State Line
        s.id === "09261000" ? 580 : // Green River near Jensen UT
        s.id === "09234500" ? 570 : // Green River near Greendale UT
        s.id === "09521100" ? 550 : // Colorado R at Yuma
        s.id === "09128000" ? 540 : // Gunnison River below Gunnison Tunnel
        s.id === "09355500" ? 530 : // San Juan River near Archuleta NM
        s.id === "09427520" ? 520 : // Colorado R below Parker Dam
        s.id === "09058000" ? 510 : // Colorado River near Kremmling CO
        s.id === "09423000" ? 500 : // Colorado R below Davis Dam
        (s.flow_cfs >= 1000 ? 400 : 200)
      )
    };

    if (!showBadges) {
      marker.getElement().style.display = 'none';
    }

    markers.gauges.push(marker);
    stationMarkers[s.id] = { marker, popup, lat: s.lat, lon: s.lon, type: 'streamflow' };
  });

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

    const flowVal = Number(t.flow_cfs || 0);
    const flowText = (t.flow_cfs != null && !isNaN(t.flow_cfs)) ? Number(t.flow_cfs).toLocaleString() : 'Offline';
    const flowDisplayHtml = (t.flow_cfs != null && !isNaN(t.flow_cfs))
      ? `${Number(t.flow_cfs).toLocaleString()} <span style="font-size:11px; font-weight:600; color:#5c5346;">cfs</span>`
      : `<span style="font-size:13px; font-weight:700; color:#5c5346;">Offline (Maintenance)</span>`;

    const el = document.createElement('div');
    el.className = 'cfs-marker-wrap';
    el.innerHTML = `<div class="cfs-badge ${badgeClass}"><span class="cfs-val">${flowText}</span> <span class="cfs-unit">${t.flow_cfs != null ? 'cfs' : ''}</span></div>`;

    const portal = getPortalInfo(t);
    const dataHtml = `
      <div style="padding: 2px;">
        <div style="display:flex; align-items:center; gap:6px; margin-bottom:6px;">
          <span style="font-size:10px; font-weight:700; color:#2b5c8f; background:#ebe4d6; border:1px solid #cfc8ba; padding:2px 6px; border-radius:4px;">${diversionBadge}</span>
        </div>
        <strong style="font-size:13px; color:#0f172a; line-height:1.35; display:block;">${t.name}</strong>
        <div style="font-size:11px; color:#5c5346; font-weight:600; margin-bottom:6px;">${t.operator || ''}</div>
        <div style="margin: 6px 0; padding: 8px 10px; background:#f2ede2; border-radius:6px; border:1px solid #cfc8ba; display:flex; justify-content:space-between; align-items:baseline;">
          <span style="font-size:11px; color:#4f463a; font-weight:600;">Diverted Flow:</span>
          <span style="font-size:16px; font-weight:800; color:#2b5c8f;">${flowDisplayHtml}</span>
        </div>
        <div style="font-size:11px; color:#4f463a; line-height:1.5;">
          <strong>Destination:</strong> ${t.destination}<br>
          <strong>Length:</strong> ${lengthText}<br>
          ${fromText}<br>
          ${toText}<br>
          <strong>Last Measured:</strong> ${formatTimestamp(t.timestamp)}
        </div>
        ${formatPortalHtml(portal, '#2b5c8f')}
      </div>
    `;

    const endpoint = isFrontRange 
      ? `https://dwr.state.co.us/Rest/GET/api/v2/telemetrystations/telemetrytimeserieshour/?abbrev=${t.id}&format=json`
      : `https://waterservices.usgs.gov/nwis/iv/?sites=${t.id}&parameterCd=00060&format=json`;

    const cleanTName = t.name.replace(/["\\]/g, '');
    const pyCode = isFrontRange ? `import requests

# Colorado DWR HydroBase REST API v2
url = "https://dwr.state.co.us/Rest/GET/api/v2/telemetrystations/telemetrytimeserieshour/"
params = {
    "abbrev": "${t.id}",  # ${cleanTName}
    "format": "json"
}
res = requests.get(url, params=params, timeout=10).json()
reading = res["ResultList"][0]
flow_cfs = float(reading["measValue"])
print(f"${cleanTName}: {flow_cfs:,.1f} cfs")` : `import requests

# USGS Canal Monitoring Station #${t.id}
url = "https://waterservices.usgs.gov/nwis/iv/"
params = {
    "sites": "${t.id}",       # ${cleanTName}
    "parameterCd": "00060",  # Canal Flow (cfs)
    "format": "json"
}
res = requests.get(url, params=params, timeout=10).json()
val = res["value"]["timeSeries"][0]["values"][0]["value"][-1]
flow_cfs = float(val["value"])
print(f"${cleanTName}: {flow_cfs:,.0f} cfs")`;

    const popupHtml = formatTabbedPopup({
      dataHtml,
      codeTitle: isFrontRange ? `Colorado DWR: ${t.id}` : `USGS Canal #${t.id}`,
      endpointUrl: endpoint,
      pythonCode: pyCode,
      notes: isFrontRange ? "Trans-mountain diversion monitoring under Continental Divide." : "Major conveyance canal monitoring."
    });

    const popup = new maplibregl.Popup({ offset: 12 }).setHTML(popupHtml);

    popup.on('open', () => {
      if (tooltipPopup && tooltipPopup.isOpen()) tooltipPopup.remove();
      if (activeFeaturePopup && activeFeaturePopup !== popup && activeFeaturePopup.isOpen()) {
        activeFeaturePopup.remove();
      }
      activeFeaturePopup = popup;
    });
    popup.on('close', () => {
      if (activeFeaturePopup === popup) activeFeaturePopup = null;
    });

    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
    });

    el.addEventListener('mouseenter', () => {
      const flowVal = Number(t.flow_cfs || 0);
      showHoverTooltip(`
        <div style="font-family:'Inter',sans-serif; min-width: 220px; max-width: 290px;">
          <span style="font-size:10px;font-weight:700;color:#2b5c8f;background:#ebe4d6;padding:2px 6px;border-radius:4px;display:inline-block;margin-bottom:4px;">${diversionBadge}</span>
          <strong style="font-size:13.5px;color:#0f172a;display:block;">${t.name}</strong>
          <div style="margin: 6px 0; padding: 6px 10px; background:#f2ede2; border-radius:6px; border:1px solid #cfc8ba; display:flex; justify-content:space-between; align-items:baseline;">
            <span style="font-size:11px; color:#5c5346; font-weight:600;">Discharge:</span>
            <span style="font-size:16px; font-weight:800; color:#2b5c8f;">${flowVal.toLocaleString()} cfs</span>
          </div>
          <div style="font-size:11px;color:#4f463a;">${isFrontRange ? 'Front Range Trans-Divide' : (t.operator || '')}</div>
        </div>
      `, [t.lon, t.lat], badgeClass);
    });

    el.addEventListener('mouseleave', () => {
      hideHoverTooltip(badgeClass);
    });

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

    stationMarkers[t.id] = { marker, popup, lat: t.lat, lon: t.lon, type: isFrontRange ? 'diversion_tunnel' : 'diversion_canal' };
  });

  // 3. Storage Reservoirs: Register station markers and popups for 1:1 map & station registry parity
  (metrics.reservoirs || []).forEach(r => {
    const popupHtml = formatReservoirStationPopup(r);
    const popup = new maplibregl.Popup({ offset: 12 }).setHTML(popupHtml);
    popup.on('open', () => {
      if (tooltipPopup && tooltipPopup.isOpen()) tooltipPopup.remove();
      if (activeFeaturePopup && activeFeaturePopup !== popup && activeFeaturePopup.isOpen()) {
        activeFeaturePopup.remove();
      }
      activeFeaturePopup = popup;
    });
    popup.on('close', () => {
      if (activeFeaturePopup === popup) activeFeaturePopup = null;
    });
    stationMarkers[r.id] = { popup, lat: r.lat, lon: r.lon, type: 'reservoir', data: r };
  });

  // 4. Native WebGL Point Layer for All Monitoring Stations (98 Stations: 79 Streamflows, 4 Tunnels, 4 Canals, 11 Reservoirs)
  const allStationFeatures = [];

  (metrics.streamflows || []).forEach(s => {
    allStationFeatures.push({
      type: 'Feature',
      properties: {
        id: s.id,
        name: s.name,
        station_type: 'streamflow',
        type_label: 'USGS Streamflow Gage',
        flow_cfs: s.flow_cfs,
        timestamp: s.timestamp
      },
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] }
    });
  });

  (metrics.tunnels || []).forEach(t => {
    allStationFeatures.push({
      type: 'Feature',
      properties: {
        id: t.id,
        name: t.name,
        station_type: 'diversion_tunnel',
        type_label: 'Trans-Mountain Diversion Tunnel',
        flow_cfs: t.flow_cfs,
        timestamp: t.timestamp
      },
      geometry: { type: 'Point', coordinates: [t.lon, t.lat] }
    });
  });

  (metrics.canals || []).forEach(c => {
    allStationFeatures.push({
      type: 'Feature',
      properties: {
        id: c.id,
        name: c.name,
        station_type: 'diversion_canal',
        type_label: 'Major Conveyance Canal',
        flow_cfs: c.flow_cfs,
        timestamp: c.timestamp
      },
      geometry: { type: 'Point', coordinates: [c.lon, c.lat] }
    });
  });

  (metrics.reservoirs || []).forEach(r => {
    allStationFeatures.push({
      type: 'Feature',
      properties: {
        id: r.id,
        name: r.name,
        station_type: 'reservoir',
        type_label: 'Storage Reservoir Station',
        storage_af: r.storage_af,
        capacity_pct: r.capacity_pct,
        elevation_ft: r.elevation_ft,
        timestamp: r.timestamp
      },
      geometry: { type: 'Point', coordinates: [r.lon, r.lat] }
    });
  });

  const gaugesGeoJSON = {
    type: 'FeatureCollection',
    features: allStationFeatures
  };

  if (!map.getSource('streamflow-gauges')) {
    map.addSource('streamflow-gauges', { type: 'geojson', data: gaugesGeoJSON });

    const showGauges = document.getElementById('toggle-streamflow-gauges')?.checked ?? true;

    // 1. Casing / border circle (high-contrast white halo with subtle outline)
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
          4, ['coalesce', ['get', 'casing_radius'], 5.0],
          7, ['+', ['coalesce', ['get', 'casing_radius'], 5.0], 1.5],
          10, ['+', ['coalesce', ['get', 'casing_radius'], 5.0], 3.5],
          13, ['+', ['coalesce', ['get', 'casing_radius'], 5.0], 6.0]
        ],
        'circle-stroke-color': '#0f172a',
        'circle-stroke-width': 1.0,
        'circle-opacity': 0.95
      }
    });

    // 2. Core colored dot matching the legend (blue streamflows, cyan tunnels, emerald canals, crimson reservoirs)
    map.addLayer({
      id: 'streamflow-gauges-circle',
      type: 'circle',
      source: 'streamflow-gauges',
      layout: {
        'visibility': showGauges ? 'visible' : 'none'
      },
      paint: {
        'circle-color': [
          'coalesce',
          ['get', 'circle_color'],
          [
            'match', ['get', 'station_type'],
            'streamflow', '#0284c7',
            'diversion_tunnel', '#0891b2',
            'diversion_canal', '#059669',
            'reservoir', '#dc2626',
            '#0284c7'
          ]
        ],
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          4, ['coalesce', ['get', 'circle_radius'], 3.5],
          7, ['+', ['coalesce', ['get', 'circle_radius'], 3.5], 1.5],
          10, ['+', ['coalesce', ['get', 'circle_radius'], 3.5], 3.5],
          13, ['+', ['coalesce', ['get', 'circle_radius'], 3.5], 5.5]
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
      let headerKicker = 'USGS GAGE';
      let kickerBg = '#0369a1';
      let metricRow = '';

      if (g.station_type === 'reservoir') {
        headerKicker = 'STORAGE RESERVOIR STATION';
        kickerBg = '#dc2626';
        metricRow = `
          <div style="font-size:15px; font-weight:800; color:#dc2626; font-variant-numeric:tabular-nums; margin:3px 0;">
            ${g.capacity_pct != null ? g.capacity_pct + '% Full' : ''} 
            <span style="font-size:10.5px; font-weight:600; color:#64748b;">(${g.storage_af ? Math.round(Number(g.storage_af)).toLocaleString() + ' AF' : ''})</span>
          </div>
        `;
      } else if (g.station_type === 'diversion_tunnel') {
        headerKicker = 'TRANS-MOUNTAIN DIVERSION TUNNEL';
        kickerBg = '#0891b2';
        metricRow = `
          <div style="font-size:15px; font-weight:800; color:#0891b2; font-variant-numeric:tabular-nums; margin:3px 0;">
            ${Number(g.flow_cfs || 0).toLocaleString()} <span style="font-size:10.5px; font-weight:600; color:#64748b;">cfs</span>
          </div>
        `;
      } else if (g.station_type === 'diversion_canal') {
        headerKicker = 'MAJOR CONVEYANCE CANAL';
        kickerBg = '#059669';
        metricRow = `
          <div style="font-size:15px; font-weight:800; color:#059669; font-variant-numeric:tabular-nums; margin:3px 0;">
            ${Number(g.flow_cfs || 0).toLocaleString()} <span style="font-size:10.5px; font-weight:600; color:#64748b;">cfs</span>
          </div>
        `;
      } else {
        headerKicker = 'USGS STREAMFLOW GAGE';
        kickerBg = '#0369a1';
        const norm = getHistoricalNormal(g.id);
        let healthText = '';
        if (norm && norm > 0 && g.flow_cfs != null) {
          const pct = Math.round((Number(g.flow_cfs) / norm) * 100);
          const color = flowHealthColor(pct);
          healthText = `<span style="font-size:11px; font-weight:700; color:${color}; margin-left:6px;">(${pct}% of Normal)</span>`;
        }
        metricRow = `
          <div style="font-size:15px; font-weight:800; color:#0284c7; font-variant-numeric:tabular-nums; margin:3px 0;">
            ${Number(g.flow_cfs).toLocaleString()} <span style="font-size:10.5px; font-weight:600; color:#64748b;">cfs</span> ${healthText}
          </div>
        `;
      }

      showHoverTooltip(`
        <div style="font-family:'Inter',sans-serif; min-width: 190px; line-height:1.4;">
          <div style="font-size:9.5px; font-weight:700; color:${kickerBg}; text-transform:uppercase; letter-spacing:0.04em;">${headerKicker}</div>
          <strong style="font-size:13px; color:#0f172a; display:block; margin-top:1px;">${g.name}</strong>
          ${metricRow}
          <div style="font-size:10.5px; color:#64748b;">Station ID: #${g.id}</div>
        </div>
      `, e.lngLat, 'streamflow-gauges');
    });

    map.on('mouseleave', 'streamflow-gauges-hit-buffer', () => {
      hideHoverTooltip('streamflow-gauges');
    });

    map.on('click', 'streamflow-gauges-hit-buffer', (e) => {
      if (e.originalEvent && e.originalEvent._handled) return;
      if (!e.features.length) return;
      if (e.originalEvent) e.originalEvent._handled = true;
      const g = e.features[0].properties;
      highlightActiveStationRow(g.id);
      const entry = stationMarkers[g.id];
      if (entry && entry.popup) {
        showFeaturePopup(entry.popup, [entry.lon, entry.lat]);
        if (g.station_type === 'reservoir') {
          const cleanName = (g.name || '').split('(')[0].trim();
          const lakeGNIS = findMatchingLakeGNIS(cleanName);
          if (lakeGNIS) {
            highlightSelectedReservoir(lakeGNIS);
            flashFeatureHighlight('lake');
          }
        }
      }
    });
  } else {
    map.getSource('streamflow-gauges').setData(gaugesGeoJSON);
  }

  ensurePointLayersOnTop();
}

function updateSidebar(metrics) {
  // 1. Where Is the Water Going? (Major Basin Outflows & Diversions) - Bar Chart
  const tunnelsExport = (metrics.tunnels || [])
    .filter(t => t.id && t.id.endsWith("TUNCO"))
    .reduce((sum, t) => sum + (t.flow_cfs || 0), 0);
  
  const aacObj = (metrics.canals || []).find(c => c.id === "09527700") || (metrics.streamflows || []).find(s => s.id === "09527700");
  const aacFlow = (aacObj && aacObj.flow_cfs != null && aacObj.data_status !== 'offline') ? aacObj.flow_cfs : null;

  const craObj = (metrics.canals || []).find(c => c.id === "09424150");
  const craFlow = (craObj && craObj.flow_cfs != null && craObj.data_status !== 'offline') ? craObj.flow_cfs : null;

  const capObj = (metrics.canals || []).find(c => c.id === "09426650") || (metrics.streamflows || []).find(s => s.id === "09426650");
  const capFlow = (capObj && capObj.flow_cfs != null && capObj.data_status !== 'offline') ? capObj.flow_cfs : null;

  const cacObj = (metrics.canals || []).find(c => c.id === "09522000") || (metrics.streamflows || []).find(s => s.id === "09522000");
  const cacFlow = (cacObj && cacObj.flow_cfs != null && cacObj.data_status !== 'offline') ? cacObj.flow_cfs : null;

  const leesObj = (metrics.streamflows || []).find(s => s.id === "09380000");
  const leesFlow = (leesObj && leesObj.flow_cfs != null && leesObj.data_status !== 'offline') ? leesObj.flow_cfs : null;

  const flowChartElem = document.getElementById("flow-dest-chart");
  if (flowChartElem) {
    const validFlows = [tunnelsExport, aacFlow, craFlow, capFlow, cacFlow, leesFlow].filter(v => v != null && v > 0);
    const maxFlow = Math.max(...validFlows, 1000);
    const makeBar = (name, flow, color, label1, label2, center, zoomLevel, meta, conduitType, conduitId, statusLabel = null) => {
      const isOffline = flow == null;
      const pct = isOffline ? 0 : Math.max(2, (flow / maxFlow) * 100);
      const portal = getPortalInfo(meta || { name: name });
      const portalLink = portal ? `<a href="${portal.url}" target="_blank" rel="noopener" title="Open official ${portal.name}" onclick="event.stopPropagation();" style="margin-left:6px; color:${color}; text-decoration:none; font-size:12px; font-weight:800;">↗</a>` : '';
      const valDisplay = isOffline 
        ? `<span class="flow-bar-val" style="color: #94a3b8; font-size: 11px; font-weight: 700;">Offline (Discontinued)</span>`
        : `<span class="flow-bar-val" style="color: ${color}">${Math.round(flow).toLocaleString()} cfs ${statusLabel ? `<span style="font-size:10px; font-weight:600; color:#b45309;">(${statusLabel})</span>` : ''}</span>`;
      return `
        <div class="flow-bar-row interactive" onclick="handleConduitCardClick('${conduitType}', '${conduitId}', [${center[0]}, ${center[1]}], ${zoomLevel || 9})" title="Click to view and highlight ${name}">
          <div class="flow-bar-labels">
            <span class="flow-bar-name">${name}${portalLink} <span class="flow-bar-sub">(${label1})</span></span>
            ${valDisplay}
          </div>
          <div class="flow-bar-track">
            <div class="flow-bar-fill" style="width: ${pct}%; background-color: ${isOffline ? '#94a3b8' : color};"></div>
          </div>
        </div>
      `;
    };

    flowChartElem.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 8px;">
        ${makeBar("Lees Ferry", leesFlow, "var(--color-primary)", "Upper \u2192 Lower Basin", "", [-111.587, 36.865], 9.5, { id: "09380000", name: "Lees Ferry" }, 'reach', 'lees_ferry')}
        ${makeBar("All-American Canal", aacFlow, "var(--color-emerald)", "Imperial Valley Ag", "", [-114.467, 32.883], 9, { id: "09527700", name: "All-American Canal" }, 'canal', '09527700')}
        ${makeBar("Canal Alimentador Central", cacFlow, "var(--color-emerald)", "1944 Treaty (Mexico)", "", [-114.729, 32.705], 9, { id: "09522000", name: "Canal Alimentador Central" }, 'canal', '09522000', cacObj?.data_status === 'delayed' ? 'Delayed' : null)}
        ${makeBar("Central AZ Project", capFlow, "var(--color-emerald)", "AZ Municipal/Ag", "", [-114.111, 34.289], 9, { id: "09426650", name: "Central Arizona Project" }, 'canal', '09426650', capObj?.data_status === 'delayed' ? 'Delayed' : null)}
        ${makeBar("CO River Aqueduct", craFlow, "var(--color-emerald)", "Urban Export", "", [-114.162, 34.314], 9, { id: "09424150", name: "Colorado River Aqueduct" }, 'canal', '09424150')}
        ${makeBar("Front Range Tunnels", tunnelsExport, "var(--color-primary)", "Divide Export", "", [-105.7, 39.8], 8.5, { id: "ROBTUNCO", name: "Front Range Tunnels" }, 'tunnel', 'ROBTUNCO')}
      </div>
    `;
  }

  // 2. Major Storage Reservoirs Panel (Separated into Basin-Wide vs. Front Range & Denver)
  // Sorted descending by reservoir size in AF (capacity) within each category
  const getResCapacity = r => Number(r.capacity_af) || (r.storage_af && r.capacity_pct ? (r.storage_af / (r.capacity_pct / 100)) : 0) || 0;
  const allRes = metrics.reservoirs || [];
  const systemRes = allRes.filter(r => r.category !== 'front_range').sort((a, b) => getResCapacity(b) - getResCapacity(a));
  const frontRangeRes = allRes.filter(r => r.category === 'front_range').sort((a, b) => getResCapacity(b) - getResCapacity(a));

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
  const frTotalCap = frontRangeRes.reduce((sum, r) => sum + (Number(r.capacity_af) || (r.storage_af && r.capacity_pct ? (r.storage_af / (r.capacity_pct / 100)) : 0) || 0), 0);
  const frTotalStorage = frontRangeRes.reduce((sum, r) => sum + (Number(r.storage_af) || 0), 0);
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
    if (frTotalCap > 0) {
      frSummaryElem.innerHTML = `Total West Slope Storage: <strong>${Math.round(frTotalStorage / 1e3).toLocaleString()}k AF</strong> of ${Math.round(frTotalCap / 1e3).toLocaleString()}k AF Capacity`;
    } else {
      frSummaryElem.innerHTML = `Headwater Storage &bull; West Slope Trans-Mountain Sources`;
    }
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
        handleReservoirCardClick(r);
      };
      container.appendChild(row);
    });
  };

  renderResCardList("reservoir-list", systemRes);
  renderResCardList("front-range-res-list", frontRangeRes);
}

// Map Gage Tray State & Logic
let trayGageNodes = [];
let activeTrayCategory = 'all';
let trayFilterQuery = '';

window.toggleMapGageTray = function(forceOpen) {
  const tray = document.getElementById("map-gage-tray");
  const arrow = document.getElementById("tray-handle-arrow");
  const strip = document.getElementById("tray-handle-strip");
  if (!tray) return;
  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : tray.classList.contains("collapsed");
  if (shouldOpen) {
    tray.classList.remove("collapsed");
    tray.classList.add("expanded");
    document.body.classList.add("map-gage-tray-expanded");
    const mc = document.getElementById("map-container");
    if (mc) mc.classList.add("tray-expanded");
    if (arrow) arrow.textContent = "▼";
    if (strip) strip.setAttribute("aria-expanded", "true");
    if (window.innerHeight < 720) {
      const legend = document.getElementById("map-legend");
      if (legend && !legend.classList.contains("collapsed")) {
        window.toggleLegend();
      }
    }
  } else {
    tray.classList.remove("expanded");
    tray.classList.add("collapsed");
    document.body.classList.remove("map-gage-tray-expanded");
    const mc = document.getElementById("map-container");
    if (mc) mc.classList.remove("tray-expanded");
    if (arrow) arrow.textContent = "▲";
    if (strip) strip.setAttribute("aria-expanded", "false");
  }
};

window.onTraySearchFocus = function() {
  const tray = document.getElementById("map-gage-tray");
  if (tray && tray.classList.contains("collapsed")) {
    window.toggleMapGageTray(true);
  }
};

window.clearTraySearch = function() {
  const input = document.getElementById("tray-search-input");
  if (input) {
    input.value = "";
    input.focus();
  }
  const clearBtn = document.getElementById("tray-search-clear");
  if (clearBtn) clearBtn.style.display = "none";
  window.handleTraySearch("");
};

window.handleTraySearch = function(query) {
  trayFilterQuery = (query || '').toLowerCase().trim();
  const clearBtn = document.getElementById("tray-search-clear");
  if (clearBtn) {
    clearBtn.style.display = (query && query.length > 0) ? "flex" : "none";
  }
  if (trayFilterQuery.length > 0) {
    const tray = document.getElementById("map-gage-tray");
    if (tray && tray.classList.contains("collapsed")) {
      window.toggleMapGageTray(true);
    }
  }
  renderTrayRows();
};

window.filterTrayCategory = function(category) {
  activeTrayCategory = category;
  ['all', 'sentinel', 'streamflow', 'diversion', 'reservoir'].forEach(cat => {
    const btn = document.getElementById(`tpill-${cat}`);
    if (btn) {
      if (cat === category) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }
  });
  renderTrayRows();
};

window.openDedicatedLedger = function() {
  if (window.parent && window.parent !== window && typeof window.parent.setTab === 'function') {
    window.parent.setTab('telemetry');
  } else {
    window.open('./telemetry.html', '_blank');
  }
};

function getTraySentinelTier(node) {
  if (node.id === "09380000") {
    return { label: "1922 Compact Point", isSentinel: true, badge: "background:#e0e7ff; color:#3730a3; border:1px solid #c7d2fe; font-weight:800;" };
  }
  const basinSentinels = ['09095500', '09070500', '09163500', '09180500', '09234500', '09260050', '09261000', '09315000', '09152500', '09180000', '09379500', '09421500', 'USBR_HOOVER', 'USBR-HOOVER', '09423000', 'USBR_DAVIS', 'USBR-DAVIS', '09427520', 'USBR_PARKER', 'USBR-PARKER', '09429100', '09429500'];
  if (basinSentinels.includes(node.id)) {
    return { label: "Key Reference Gage", isSentinel: true, badge: "background:#ebe4d6; color:#2b5c8f; border:1px solid #cfc8ba; font-weight:700;" };
  }
  if (node.type === 'diversion_tunnel') {
    return { label: "Export Tunnel", isSentinel: false, badge: "background:#ecfdf5; color:#065f46; border:1px solid #a7f3d0; font-weight:700;" };
  }
  if (node.type === 'diversion_canal') {
    return { label: "Delivery Canal", isSentinel: false, badge: "background:#f0fdfa; color:#115e59; border:1px solid #99f6e4; font-weight:700;" };
  }
  if (node.type === 'reservoir') {
    return { label: "Storage Reservoir", isSentinel: false, badge: "background:#faf5ff; color:#6b21a8; border:1px solid #e9d5ff; font-weight:700;" };
  }
  return { label: "Tributary Gage", isSentinel: false, badge: "background:#f2ede2; color:#4f463a; border:1px solid #cfc8ba; font-weight:500;" };
}

function renderTrayRows() {
  const tbody = document.getElementById("tray-table-rows");
  if (!tbody) return;

  const filtered = trayGageNodes.filter(node => {
    if (activeTrayCategory === 'sentinel' && !node.isSentinel) return false;
    if (activeTrayCategory === 'streamflow' && node.type !== 'streamflow') return false;
    if (activeTrayCategory === 'diversion' && !node.type.startsWith('diversion')) return false;
    if (activeTrayCategory === 'reservoir' && node.type !== 'reservoir') return false;

    if (trayFilterQuery) {
      const match = node.name.toLowerCase().includes(trayFilterQuery) ||
                    node.id.toLowerCase().includes(trayFilterQuery) ||
                    node.tier.label.toLowerCase().includes(trayFilterQuery) ||
                    node.type.toLowerCase().includes(trayFilterQuery);
      if (!match) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:18px; color:#94a3b8;">No facilities match "${trayFilterQuery}"</td></tr>`;
    return;
  }

  // Event delegation: Bind single click handler on tbody once (no inline onclicks)
  if (!tbody._hasDelegatedClick) {
    tbody.addEventListener('click', (e) => {
      if (e.target.closest('a')) return; // Allow portal links to open without map pan
      const row = e.target.closest('tr[data-station-id]');
      if (!row) return;
      const id = row.dataset.stationId;
      const lat = parseFloat(row.dataset.lat);
      const lon = parseFloat(row.dataset.lon);
      flyToNode(id, lat, lon);
    });
    tbody._hasDelegatedClick = true;
  }

  tbody.innerHTML = filtered.map(node => {
    const portal = getPortalInfo(node);
    const portalLink = portal 
      ? `<a href="${portal.url}" target="_blank" rel="noopener" title="Open official ${portal.name}" onclick="event.stopPropagation();" style="margin-left:5px; color:#0284c7; text-decoration:none; font-weight:700;">↗</a>`
      : '';

    return `
      <tr data-station-id="${node.id}" data-lat="${node.lat}" data-lon="${node.lon}" style="cursor:pointer;" title="Click row to fly to ${node.name.replace(/"/g, '&quot;')} on map">
        <td style="font-weight:600; color:#0f172a;">${node.name}${portalLink}</td>
        <td style="font-family:monospace; color:#64748b; font-size:11px; white-space:nowrap;">${node.id}</td>
        <td><span style="display:inline-block; padding:1px 6px; border-radius:3px; font-size:10px; ${node.tier.badge}">${node.tier.label}</span></td>
        <td><span class="type-pill ${node.type}">${node.type.replace('_', ' ')}</span></td>
        <td style="text-align:right; font-weight:700; font-variant-numeric:tabular-nums; white-space:nowrap;">${node.reading}</td>
      </tr>
    `;
  }).join('');
}

function populateTelemetryTable(metrics) {
  const allNodes = [
    ...metrics.streamflows.map(s => {
      let b = "Upper Basin";
      if (s.id === "09380000") b = "Upper/Lower Divide";
      else if (["09402000", "09415000", "09426000", "09429100", "09474000", "09520500", "09498500", "09511300"].includes(s.id)) b = "Lower Basin";
      const readingStr = s.flow_cfs != null ? `${s.flow_cfs.toLocaleString()} cfs` : 'Offline (Discontinued)';
      return {
        id: s.id,
        name: s.name,
        type: "streamflow",
        basin: b,
        reading: readingStr,
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
      reading: t.flow_cfs != null ? (t.flow_cfs === 0 ? "0.0 cfs (Winter Shutdown)" : `${t.flow_cfs.toLocaleString()} cfs`) : "Offline",
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
      reading: c.flow_cfs != null ? `${c.flow_cfs.toLocaleString()} cfs` : "Offline (Discontinued)",
      notes: c.destination,
      timestamp: c.timestamp,
      lat: c.lat,
      lon: c.lon
    })),
    ...[...(metrics.reservoirs || [])].sort((a, b) => {
      const catA = a.category === 'front_range' ? 1 : 0;
      const catB = b.category === 'front_range' ? 1 : 0;
      if (catA !== catB) return catA - catB;
      const capA = Number(a.capacity_af) || 0;
      const capB = Number(b.capacity_af) || 0;
      return capB - capA;
    }).map(r => ({
      id: r.id,
      name: r.name,
      type: "reservoir",
      basin: r.category === "front_range" ? "Front Range Storage" : (["lake_powell", "flaming_gorge", "navajo", "blue_mesa"].includes(r.id) ? "Upper Basin Storage" : "Lower Basin Storage"),
      reading: `${(r.capacity_pct !== undefined && r.capacity_pct !== null) ? r.capacity_pct : ((r.storage_af / r.capacity_af) * 100).toFixed(1)}% (${Math.round((r.storage_af || 0) / 1000).toLocaleString()}k AF)`,
      notes: r.feet_below_full ? `${r.feet_below_full} ft down (Elev: ${r.elevation_ft ? r.elevation_ft.toLocaleString() : 'N/A'} ft)` : `Elevation: ${r.elevation_ft ? r.elevation_ft.toLocaleString() : 'N/A'} ft`,
      timestamp: r.timestamp,
      lat: r.lat,
      lon: r.lon
    }))
  ];

  // Update counts on map
  const countElem = document.getElementById("node-count");
  if (countElem) countElem.textContent = allNodes.length;
  const trayCountElem = document.getElementById("tray-node-count");
  if (trayCountElem) trayCountElem.textContent = allNodes.length;

  // Enrich nodes with sentinel tier
  trayGageNodes = allNodes.map(node => {
    const tier = getTraySentinelTier(node);
    return {
      ...node,
      tier: tier,
      isSentinel: tier.isSentinel
    };
  });

  // Render tray rows
  renderTrayRows();

  // Populate legacy table if present using DocumentFragment batching and event delegation
  const tbody = document.getElementById("telemetry-rows");
  if (!tbody) return;

  const fragment = document.createDocumentFragment();
  allNodes.forEach(node => {
    const portal = getPortalInfo(node);
    const portalLink = portal 
      ? `<a href="${portal.url}" target="_blank" rel="noopener" title="Open official ${portal.name}" onclick="event.stopPropagation();" style="margin-left:6px; color:#0284c7; text-decoration:none; font-size:12px; font-weight:700;">↗</a>`
      : '';

    const tr = document.createElement("tr");
    tr.dataset.stationId = node.id;
    tr.dataset.lat = node.lat;
    tr.dataset.lon = node.lon;
    tr.style.cursor = "pointer";
    tr.innerHTML = `
      <td><strong>${node.name}</strong>${portalLink}</td>
      <td><span class="type-pill ${node.type}">${node.type.replace('_', ' ')}</span></td>
      <td>${node.basin}</td>
      <td><strong>${node.reading}</strong></td>
      <td style="color:#64748b;font-size:11px;">${node.notes}</td>
      <td style="color:#64748b;font-size:11px;white-space:nowrap;">${formatTimestamp(node.timestamp)}</td>
    `;
    fragment.appendChild(tr);
  });
  tbody.replaceChildren(fragment);

  if (!tbody._hasDelegatedClick) {
    tbody.addEventListener("click", (e) => {
      if (e.target.closest("a")) return;
      const row = e.target.closest("tr[data-station-id]");
      if (row) {
        flyToNode(row.dataset.stationId, parseFloat(row.dataset.lat), parseFloat(row.dataset.lon));
      }
    });
    tbody._hasDelegatedClick = true;
  }
}

function flyToNode(id, lat, lon) {
  if (typeof window.focusMapStation === 'function') {
    window.focusMapStation(id);
    return;
  }
  safeFlyTo(map, {
    center: [lon, lat],
    zoom: 10.5,
    pitch: isTilted ? 48 : 0,
    bearing: isTilted ? -10 : 0,
    duration: 1500,
    essential: true
  });
  if (stationMarkers[id]) {
    setTimeout(() => {
      showFeaturePopup(stationMarkers[id].popup, [lon, lat]);
    }, 1500);
  }
}

let lastFocusedStationId = null;

function highlightActiveStationRow(stationId) {
  const trayTbody = document.getElementById("tray-table-rows");
  if (trayTbody) {
    const prev = trayTbody.querySelector('tr.active-station-row');
    if (prev && prev.dataset.stationId === stationId) return;
    if (prev) prev.classList.remove('active-station-row');
    const target = trayTbody.querySelector(`tr[data-station-id="${stationId}"]`);
    if (target) {
      target.classList.add('active-station-row');
      target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
}

window.focusMapStation = function(stationId) {
  if (!stationId) return;
  if (!map) {
    window._pendingFocusStation = stationId;
    return;
  }

  // Idempotent guard: avoid redundant re-flying if already focused and open
  if (lastFocusedStationId === stationId && activeFeaturePopup && activeFeaturePopup.isOpen()) {
    return;
  }
  lastFocusedStationId = stationId;
  highlightActiveStationRow(stationId);

  // 1. Close secondary popovers if open
  if (typeof closeMapMenu === 'function') closeMapMenu();
  if (activeFeaturePopup && activeFeaturePopup.isOpen()) {
    activeFeaturePopup.remove();
    activeFeaturePopup = null;
  }

  const metrics = activeMetrics || cachedMetrics;

  // 2. Reservoir Match
  if (metrics?.reservoirs) {
    const res = metrics.reservoirs.find(r => r.id === stationId);
    if (res) {
      handleReservoirCardClick(res);
      return;
    }
  }

  // 3. Diversion Canal Match
  if (metrics?.canals) {
    const can = metrics.canals.find(c => c.id === stationId);
    if (can) {
      handleConduitCardClick('canal', can.id, [can.lon, can.lat], 10.5);
      return;
    }
  }

  // 4. Diversion Tunnel Match
  if (metrics?.tunnels) {
    const tun = metrics.tunnels.find(t => t.id === stationId);
    if (tun) {
      handleConduitCardClick('tunnel', tun.id, [tun.lon, tun.lat], 10.5);
      return;
    }
  }

  // 5. In stationMarkers registry (active USGS streamflow gauges or tunnels)
  if (stationMarkers && stationMarkers[stationId]) {
    const entry = stationMarkers[stationId];
    if (map) {
      safeFlyTo(map, {
        center: [entry.lon, entry.lat],
        zoom: 11,
        pitch: isTilted ? 45 : 0,
        duration: 700,
        essential: true
      });
    }
    setTimeout(() => {
      if (map) showFeaturePopup(entry.popup, [entry.lon, entry.lat]);
    }, 350);
    return;
  }

  // 6. In metrics streamflows (if marker not indexed in stationMarkers yet)
  if (metrics?.streamflows) {
    const stm = metrics.streamflows.find(s => s.id === stationId);
    if (stm) {
      if (map) {
        safeFlyTo(map, {
          center: [stm.lon, stm.lat],
          zoom: 11,
          pitch: isTilted ? 45 : 0,
          duration: 700,
          essential: true
        });
      }
      setTimeout(() => {
        const popup = stationMarkers?.[stm.id]?.popup || new maplibregl.Popup({ offset: 12 }).setHTML(formatGaugePopup(stm));
        if (map) showFeaturePopup(popup, [stm.lon, stm.lat]);
      }, 350);
      return;
    }
  }

  // 7. In cachedGeography dams
  if (cachedGeography?.dams) {
    const dam = cachedGeography.dams.find(d => d.id === stationId || d.name === stationId);
    if (dam) {
      if (map) {
        safeFlyTo(map, {
          center: [dam.lon, dam.lat],
          zoom: 12,
          pitch: isTilted ? 45 : 0,
          duration: 700,
          essential: true
        });
      }
      return;
    }
  }
};

window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'focusStation') {
    window.focusMapStation(e.data.stationId);
  }
});

function handleConduitCardClick(type, id, center, zoomLevel) {
  if (!map) return;
  highlightActiveStationRow(id);
  // Keep Basin Metrics open while flying and highlighting target
  if (typeof closeMapMenu === 'function') {
    closeMapMenu();
  }

  // 2. Fly to target conduit/gauge
  safeFlyTo(map, {
    center: center,
    zoom: zoomLevel || 9.5,
    pitch: isTilted ? 45 : 0,
    duration: 700,
    essential: true
  });

  // 3. Highlight and flash the conduit/reach
  if (type === 'reach') {
    highlightSelectedReach(id);
  } else if (type === 'canal' || type === 'tunnel') {
    highlightSelectedConduit(type, id);
    flashFeatureHighlight(type);
  }

  // 4. Open feature detail popup
  setTimeout(() => {
    if (stationMarkers[id]) {
      showFeaturePopup(stationMarkers[id].popup, center);
    } else if (type === 'canal' && cachedGeography?.tunnels) {
      const canalFeat = cachedGeography.tunnels.find(t => t.id === id);
      if (canalFeat) {
        showFeaturePopup(new maplibregl.Popup({ offset: 8 }).setHTML(formatCanalPopupHtml(canalFeat)), center);
      }
    }
  }, 450);
}

function handleReservoirCardClick(r) {
  if (!map) return;
  if (r.id) highlightActiveStationRow(r.id);
  // Keep Basin Metrics open while flying and highlighting target
  if (typeof closeMapMenu === 'function') {
    closeMapMenu();
  }

  // 2. Fly to reservoir location
  if (r.lat && r.lon) {
    safeFlyTo(map, {
      center: [r.lon, r.lat],
      zoom: 10.2,
      pitch: isTilted ? 42 : 0,
      duration: 700,
      essential: true
    });
  }

  // 3. Match reservoir to NHD lake GNIS name and trigger flashing highlight
  const cleanName = r.name.split('(')[0].trim();
  const lakeGNIS = findMatchingLakeGNIS(cleanName);
  if (lakeGNIS) {
    highlightSelectedReservoir(lakeGNIS);
    flashFeatureHighlight('lake');
  }

  // 4. Open reservoir detail popup
  setTimeout(() => {
    const popupHtml = formatReservoirDetailPopup(r, cleanName);
    const popup = new maplibregl.Popup({ offset: 8 }).setHTML(popupHtml);
    showFeaturePopup(popup, [r.lon, r.lat]);
  }, 450);
}

function findMatchingLakeGNIS(cleanName) {
  if (!cachedLakes?.features) return cleanName;
  const match = cachedLakes.features.find(f => {
    const gnis = f.properties?.GNIS_NAME || f.properties?.name || '';
    return gnis.toLowerCase().includes(cleanName.toLowerCase()) || 
           cleanName.toLowerCase().includes(gnis.toLowerCase());
  });
  return match?.properties?.GNIS_NAME || match?.properties?.name || cleanName;
}

function formatCanalPopupHtml(t) {
  const isOffline = t.data_status === 'offline' || t.status === 'offline' || t.flow_cfs == null;
  const flowVal = Number(t.flow_cfs || 0);
  const portal = getPortalInfo(t);
  const isDelayed = t.data_status === 'delayed' || t.status === 'delayed';

  let singleSentenceNote = '';
  if (t.historical_note) {
    singleSentenceNote = t.historical_note.split('. ')[0];
    if (!singleSentenceNote.endsWith('.')) singleSentenceNote += '.';
  }

  const dataHtml = `
    <div style="padding: 2px;">
      <div style="font-size:9.5px; font-weight:700; color:#2b5c8f; background:#ebe4d6; border:1px solid #cfc8ba; padding:1px 5px; border-radius:2px; display:inline-block; margin-bottom:3px;">Major Conveyance Canal</div>
      <strong style="font-size:13.5px; color:#0f172a; display:block;">${t.name}</strong>
      <span style="font-size:11px; color:#2b5c8f; font-weight:600;">${t.operator || ''}</span>
      ${isOffline 
        ? `<div style="margin: 5px 0; padding: 5px 8px; background:#fef2f2; border-radius:3px; border:1px solid #fecaca; display:flex; justify-content:space-between; align-items:baseline;">
             <span style="font-size:11px; color:#991b1b; font-weight:600;">Status:</span>
             <span style="font-size:12px; font-weight:700; color:#dc2626;">Offline (Gage Discontinued)</span>
           </div>`
        : `<div style="margin: 5px 0; padding: 5px 8px; background:#f2ede2; border-radius:3px; border:1px solid #cfc8ba; display:flex; justify-content:space-between; align-items:baseline;">
             <span style="font-size:11px; color:#5c5346; font-weight:600;">Current Diversion:</span>
             <span style="font-size:15px; font-weight:800; color:#2b5c8f; font-variant-numeric:tabular-nums;">${flowVal.toLocaleString()} cfs ${isDelayed ? '<span style="font-size:9.5px; color:#b45309;">(Delayed)</span>' : ''}</span>
           </div>`
      }
      <div style="font-size:11px; line-height:1.4; color:#3e3226; margin-top:4px;">
        <strong>Destination:</strong> ${t.destination || t.to}<br>
        <strong>Length:</strong> ${t.length_miles} miles<br>
        ${t.timestamp ? `<strong>Measured:</strong> ${formatTimestamp(t.timestamp)}<br>` : ''}
        ${singleSentenceNote ? `<div style="margin-top:4px; font-size:10.5px; color:#5c5346;">${singleSentenceNote}</div>` : ''}
      </div>
      ${formatPortalHtml(portal, '#2b5c8f')}
    </div>
  `;
  const cleanCName = (t.name || '').replace(/["\\]/g, '');
  const isDvStation = t.id === "09522000" || t.id === "09426650" || t.id === "09424150";
  const endpoint = isDvStation 
    ? `https://waterservices.usgs.gov/nwis/dv/?sites=${t.id}&parameterCd=00060&format=json`
    : `https://waterservices.usgs.gov/nwis/iv/?sites=${t.id}&parameterCd=00060&format=json`;
  const pyCode = `import requests

# ${t.id === "09522000" ? "USGS / CILA Border Station" : "USGS Canal Monitoring Station"} #${t.id}
url = "${isDvStation ? "https://waterservices.usgs.gov/nwis/dv/" : "https://waterservices.usgs.gov/nwis/iv/"}"
params = {
    "sites": "${t.id}",       # ${cleanCName}
    "parameterCd": "00060",  # Canal Flow (cfs)
    "format": "json"
}
res = requests.get(url, params=params, timeout=10).json()
try:
    val = res["value"]["timeSeries"][0]["values"][0]["value"][-1]
    flow_cfs = float(val["value"])
    print(f"${cleanCName}: {flow_cfs:,.0f} cfs at {val['dateTime']}")
except Exception as e:
    print(f"${cleanCName}: Station offline or inactive ({e})")`;

  return formatTabbedPopup({
    dataHtml,
    codeTitle: t.id === "09522000" ? `USGS / CILA Border Station #${t.id}` : `USGS Canal #${t.id}`,
    endpointUrl: endpoint,
    pythonCode: pyCode,
    notes: t.id === "09522000" ? "1944 Treaty international diversion monitoring at Morelos Dam." : (isOffline ? "Gage discontinued by USGS NWIS in Oct 2022." : "Major conveyance canal monitoring.")
  });
}

function formatReservoirDetailPopup(matchRes, cleanName) {
  const portal = getPortalInfo(matchRes || { name: cleanName });
  const dataHtml = `
    <div style="padding:2px;">
      <div style="font-size:9.5px; font-weight:700; color:#2b5c8f; background:#ebe4d6; padding:1px 5px; border-radius:2px; display:inline-block; margin-bottom:3px;">Major Storage Reservoir</div>
      <strong style="font-size:13.5px; color:#0f172a; display:block;">${matchRes.name}</strong>
      <span style="font-size:11px; color:#5c5346; font-weight:600;">${matchRes.river || ''}</span>
      <div style="margin: 5px 0; padding: 6px 8px; background:#f2ede2; border-radius:3px; border:1px solid #cfc8ba;">
        <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:3px;">
          <span style="font-size:11px; color:#5c5346; font-weight:600;">Current Storage:</span>
          <span style="font-size:15px; font-weight:800; color:#2b5c8f; font-variant-numeric:tabular-nums;">${matchRes.capacity_pct}% <span style="font-size:10.5px; font-weight:600; color:#5c5346;">Full</span></span>
        </div>
        <div style="height:5px; background:#cfc8ba; border-radius:2px; overflow:hidden;">
          <div style="width:${Math.min(100, matchRes.capacity_pct)}%; height:100%; background:${matchRes.capacity_pct < 25 ? '#ef4444' : (matchRes.capacity_pct < 50 ? '#f59e0b' : '#0891b2')};"></div>
        </div>
      </div>
      <div style="font-size:11px; color:#3e3226; line-height:1.45;">
        <strong>Elevation:</strong> ${matchRes.elevation_ft ? matchRes.elevation_ft.toLocaleString() + ' ft' : 'USBR'}<br>
        <strong>Volume Stored:</strong> ${Math.round(matchRes.storage_af).toLocaleString()} Acre-Feet<br>
        <strong>Active Capacity:</strong> ${Math.round(matchRes.capacity_af || 0).toLocaleString()} Acre-Feet<br>
        <strong>Operational Role:</strong> ${matchRes.role || 'Basin Storage'}
      </div>
      ${formatPortalHtml(portal, '#2b5c8f')}
    </div>
  `;
  const isFrontRange = matchRes.category === 'front_range';
  const cleanResName = matchRes.name.replace(/["\\]/g, '');
  let endpointUrl = '';
  let pyCode = '';
  let notes = '';

  if (isFrontRange) {
    const resAbbrev = (matchRes.id || 'DILRESCO').toUpperCase();
    endpointUrl = `https://dwr.state.co.us/Rest/GET/api/v2/telemetrystations/telemetrytimeseriesday/?abbrev=${resAbbrev}&format=json`;
    pyCode = `import requests

# Colorado DWR HydroBase Storage Records
url = "https://dwr.state.co.us/Rest/GET/api/v2/telemetrystations/telemetrytimeseriesday/"
params = {
    "abbrev": "${resAbbrev}",  # ${cleanResName}
    "format": "json"
}
res = requests.get(url, params=params, timeout=10).json()
reading = res["ResultList"][0]
print(f"${cleanResName}: {reading['measValue']} AF on {reading['measDate']}")`;
    notes = "Colorado DWR daily reservoir storage accounting & dam records.";
  } else {
    const usgsGauge = matchRes.id === 'lake_powell' ? '09379900' : (matchRes.id === 'lake_mead' ? '09421000' : '09379900');
    endpointUrl = `https://waterservices.usgs.gov/nwis/iv/?sites=${usgsGauge}&parameterCd=62614&format=json`;
    pyCode = `import requests

# USGS Lake Elevation & USBR HydroData Records
url = "https://waterservices.usgs.gov/nwis/iv/"
params = {
    "sites": "${usgsGauge}",       # ${cleanResName}
    "parameterCd": "62614",  # Elevation (ft NGVD 1929)
    "format": "json"
}
res = requests.get(url, params=params, timeout=10).json()
val = res["value"]["timeSeries"][0]["values"][0]["value"][-1]
elev = float(val["value"])
print(f"${cleanResName} Elevation: {elev:,.1f} ft")`;
    notes = "USGS parameter 62614 = Lake water surface elevation. Synced with USBR storage curves.";
  }

  return formatTabbedPopup({
    dataHtml,
    codeTitle: `${cleanResName}`,
    endpointUrl,
    pythonCode: pyCode,
    notes
  });
}

// Authoritative full basin bounding box (encompassing all Upper & Lower Basin boundaries)
const BASIN_BOUNDS = [
  [-116.65, 31.15], // Southwest: Gulf of California / Salton Sea / Imperial Valley / Sonoran border
  [-105.45, 43.65]  // Northeast: Wind River Range / Green River headwaters WY / Continental Divide
];

// Preset Zoom Navigation with mode-sensitive pitch
// Per user directive: No parabolic zoom-bounce flight curves anywhere.
// instant=true performs jumpTo with zero duration. instant=false uses direct linear easeTo.
function zoomToPreset(preset, instant = false) {
  document.querySelectorAll(".map-preset-btn, .preset-item-btn, .nav-btn").forEach(btn => {
    if (btn.dataset?.preset === preset || btn.getAttribute("onclick")?.includes(`'${preset}'`)) {
      btn.classList.add("active");
    } else if (!btn.classList.contains("law-btn") && !btn.getAttribute("onclick")?.includes("sankey")) {
      btn.classList.remove("active");
    }
  });

  const navMethod = instant ? (opts) => map.jumpTo(opts) : (opts) => safeEaseTo(map, opts);
  const dur = instant ? 0 : 750;

  if (isTilted) {
    // 3D Oblique Perspectives
    switch(preset) {
      case "basin": {
        const cam = map.cameraForBounds(BASIN_BOUNDS, {
          padding: { top: 135, bottom: 45, left: 45, right: 45 },
          bearing: -8
        });
        navMethod({
          center: [cam.center.lng, cam.center.lat + 0.35],
          zoom: cam.zoom,
          pitch: map.getPitch() > 10 ? map.getPitch() : 38,
          bearing: -8,
          duration: dur
        });
        break;
      }
      case "divide":
        navMethod({ center: [-105.9, 39.85], zoom: 9.8, pitch: 56, bearing: -30, duration: dur });
        break;
      case "lees_ferry":
        navMethod({ center: [-111.59, 36.86], zoom: 11.2, pitch: 54, bearing: 40, duration: dur });
        break;
      case "reservoirs":
        navMethod({ center: [-113.2, 36.6], zoom: 7.5, pitch: 50, bearing: -15, duration: dur });
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
        navMethod({
          center: cam.center,
          zoom: cam.zoom,
          pitch: 0,
          bearing: 0,
          duration: dur
        });
        break;
      }
      case "divide":
        navMethod({ center: [-105.95, 39.85], zoom: 9.8, pitch: 0, bearing: 0, duration: dur });
        break;
      case "lees_ferry":
        navMethod({ center: [-111.59, 36.86], zoom: 11.2, pitch: 0, bearing: 0, duration: dur });
        break;
      case "reservoirs":
        navMethod({ center: [-113.2, 36.6], zoom: 7.5, pitch: 0, bearing: 0, duration: dur });
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

  // Sort descending by priority so primary sentinel stations (Lees Ferry, Hoover, Cameo) are placed first
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

// API & Code Documentation Modal Handlers (Option C)
function openApiModal() {
  const modal = document.getElementById("api-modal");
  if (modal) {
    modal.classList.add("active");
  }
}

function closeApiModal(e) {
  if (e && e.target && e.target.classList.contains("modal-card")) return;
  const modal = document.getElementById("api-modal");
  if (modal) {
    modal.classList.remove("active");
  }
}

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeLegalModal();
    closeApiModal();
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
  if (icon) {
    icon.style.transform = "none";
    const svg = icon.querySelector("svg");
    if (svg) {
      // isHidden: true means it was collapsed and is now OPEN -> Up arrow to close
      // isHidden: false means it was open and is now CLOSED -> Down arrow to expand
      svg.style.transform = isHidden ? "rotate(180deg)" : "rotate(0deg)";
    }
  }
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
    case "flowArrows":
    case "flow-arrows":
    case "flowDirection":
    case "flow-direction":
    case "gisFlowArrows":
    case "gis-flow-arrows":
      setLayerVisibility('flow-direction-arrows', isChecked);
      setLayerVisibility('gis-flow-arrows', isChecked);
      break;
    case "topologyJunctions":
    case "topology-junctions":
      setLayerVisibility('topology-junctions', isChecked);
      setLayerVisibility('topology-junctions-hit-buffer', isChecked);
      break;
    case "topologySections":
    case "topology-sections":
    case "topologyNodes":
    case "topology-nodes":
    case "gisNodes":
    case "gis-nodes":
      setLayerVisibility('topology-sections-casing', isChecked);
      setLayerVisibility('topology-sections-core', isChecked);
      setLayerVisibility('topology-sections-hit-buffer', isChecked);
      break;
  }
  syncLegendToLayerToggles();
}

function syncLegendToLayerToggles() {
  const isMainstem = document.getElementById('toggle-river-mainstem')?.checked ?? true;
  const isMajor = document.getElementById('toggle-river-major')?.checked ?? true;
  const isMinor = document.getElementById('toggle-river-minor')?.checked ?? true;
  const isReservoirs = document.getElementById('toggle-reservoirs')?.checked ?? true;
  const isDams = document.getElementById('toggle-dams')?.checked ?? true;
  const isDivide = document.getElementById('toggle-divide')?.checked ?? true;
  const isBasin = document.getElementById('toggle-basin')?.checked ?? true;
  const isFlowHealth = document.getElementById('toggle-flow-health')?.checked ?? false;
  const isStations = document.getElementById('toggle-streamflow-gauges')?.checked ?? true;
  const isBadges = document.getElementById('toggle-all-badges')?.checked ?? false;
  const isTunnels = document.getElementById('toggle-tunnels')?.checked ?? true;
  const isCanals = document.getElementById('toggle-canals')?.checked ?? true;
  const isArrows = document.getElementById('toggle-flow-arrows')?.checked ?? false;
  const isJunctions = document.getElementById('toggle-topology-junctions')?.checked ?? false;
  const isSections = document.getElementById('toggle-topology-sections')?.checked ?? false;

  const setDisp = (id, show, displayType = 'flex') => {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? displayType : 'none';
  };

  // 1. Streamflow Volume
  setDisp('legend-item-river-mainstem', isMainstem, 'flex');
  setDisp('legend-item-river-major', isMajor, 'flex');
  setDisp('legend-item-river-minor', isMinor, 'flex');
  const showStreamflowSec = isMainstem || isMajor || isMinor;
  setDisp('legend-sec-streamflow', showStreamflowSec, 'block');

  // 2. Water Infrastructure
  setDisp('legend-item-reservoirs', isReservoirs, 'flex');
  setDisp('legend-item-dams', isDams, 'flex');
  setDisp('legend-item-divide', isDivide, 'flex');
  setDisp('legend-item-basin', isBasin, 'flex');
  setDisp('legend-item-tunnels', isTunnels, 'flex');
  setDisp('legend-item-canals', isCanals, 'flex');
  const showInfraSec = isReservoirs || isDams || isDivide || isBasin || isTunnels || isCanals;
  setDisp('legend-sec-infrastructure', showInfraSec, 'block');

  // 3. Monitoring Stations & Badges
  setDisp('legend-stations-grid', isStations, 'grid');
  setDisp('legend-item-station-streamflow', isStations && (isMainstem || isMajor || isMinor), 'flex');
  setDisp('legend-item-station-reservoirs', isStations && isReservoirs, 'flex');
  setDisp('legend-item-station-tunnels', isStations && isTunnels, 'flex');
  setDisp('legend-item-station-canals', isStations && isCanals, 'flex');
  setDisp('legend-item-flow-badge', isBadges, 'flex');

  // 4. Topology Diagnostics (Each individual item matches its toggle)
  setDisp('legend-item-diag-arrows', isArrows, 'flex');
  setDisp('legend-item-diag-junctions', isJunctions, 'flex');
  setDisp('legend-item-diag-sections-start', isSections, 'flex');
  setDisp('legend-item-diag-sections-boundary', isSections, 'flex');
  const showTopologySec = isArrows || isJunctions || isSections;
  setDisp('topology-diagnostics-legend', showTopologySec, 'block');

  // 5. Flow Health
  setDisp('flow-health-legend', isFlowHealth, 'block');

  // 6. Empty Notice (Shown if all functional layers are turned off)
  const hasAnyVisible = showStreamflowSec || showInfraSec || isStations || isBadges || showTopologySec || isFlowHealth;
  setDisp('legend-empty-notice', !hasAnyVisible, 'block');
}

function syncLegendDiagnosticsVisibility() {
  syncLegendToLayerToggles();
}

// ─── Diagnostics Sync & Toggles (Compatibility Stubs) ──────────────
function toggleQuickGis(type) {
  // Legacy stub - toolbar removed per anti-clutter design rules
}

function syncQuickGisButtons() {
  // Legacy stub - toolbar removed per anti-clutter design rules
}

window.toggleQuickGis = toggleQuickGis;
window.syncQuickGisButtons = syncQuickGisButtons;

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
      const ry = Math.max(2.2, 10.5 * Math.cos(pitch * Math.PI / 180));
      ellipse.setAttribute('ry', ry);
    }

    // Shift center pivot dot slightly up when tilted
    const pivot = document.getElementById('trackball-center-pivot');
    if (pivot) {
      const dy = (pitch / 65) * 3.5;
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
      const newBearing = (startBearing - deltaX * 0.55) % 360;
      map.setBearing(newBearing);

      window.updateTrackball();
    } else if (isDraggingRing) {
      const currentAngle = Math.atan2(e.clientX - cx, -(e.clientY - cy)) * (180 / Math.PI);
      const delta = currentAngle - startRingAngle;

      if (Math.abs(delta) > 1.5) {
        hasMoved = true;
      }

      map.setBearing((startBearing - delta) % 360);
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
    safeEaseTo(map, { bearing: 0, pitch: 0, duration: 600 });
  });

  // Initial sync
  window.updateTrackball();
}

window.resetNorth = function() {
  if (!map) return;
  safeEaseTo(map, { bearing: 0, duration: 550 });
};

window.toggle3DMode = function() {
  if (!map) return;
  const currentPitch = map.getPitch();
  if (currentPitch >= 8) {
    // Already in 3D -> smoothly reset to flat 2D perspective
    safeEaseTo(map, { pitch: 0, duration: 600 });
  } else {
    // Flat 2D -> engage 3D terrain and pitch camera to 50 degrees
    if (!map.getTerrain()) {
      map.setTerrain({ source: 'terrain-dem', exaggeration: 1.5 });
    }
    safeEaseTo(map, { pitch: 50, duration: 800 });
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
  safeEaseTo(map, { pitch: targetPitch, duration: 400 });
};

// ==========================================================================
// Mobile & Desktop Collapsible Sidebar & Responsive UI Handlers
// ==========================================================================
window.toggleSidebar = function() {
  const panel = document.getElementById('sidebar-panel');
  const backdrop = document.getElementById('sidebar-backdrop');
  const btn = document.getElementById('sidebar-toggle-btn') || document.getElementById('sidebar-expand-tab');
  const arrow = document.getElementById('sidebar-tab-arrow');
  if (!panel) return;

  const isSlideDrawer = panel.classList.contains('drawer-open') || 
                        window.getComputedStyle(panel).position === 'fixed' || 
                        document.getElementById('sidebar-expand-tab') !== null;

  if (isSlideDrawer) {
    const isOpen = panel.classList.contains('drawer-open') || panel.classList.contains('mobile-open');
    if (!isOpen) {
      if (typeof closeMapMenu === 'function') closeMapMenu();
      panel.classList.add('drawer-open');
      panel.classList.add('mobile-open');
      panel.classList.remove('desktop-collapsed');
      if (backdrop) backdrop.classList.add('show');
      if (btn) btn.classList.add('active');
      if (arrow) arrow.textContent = '▶';
      document.body.classList.add('sidebar-drawer-active');
    } else {
      panel.classList.remove('drawer-open');
      panel.classList.remove('mobile-open');
      if (backdrop) backdrop.classList.remove('show');
      if (btn) btn.classList.remove('active');
      if (arrow) arrow.textContent = '◀';
      document.body.classList.remove('sidebar-drawer-active');
    }
  } else {
    // Desktop flex layout toggling (map.html standalone view)
    const isCollapsed = panel.classList.contains('desktop-collapsed');
    if (isCollapsed) {
      panel.classList.remove('desktop-collapsed');
      if (btn) btn.classList.add('active');
      if (arrow) arrow.textContent = '▶';
    } else {
      panel.classList.add('desktop-collapsed');
      if (btn) btn.classList.remove('active');
      if (arrow) arrow.textContent = '◀';
    }
  }

  // Trigger MapLibre resize smoothly after transition
  setTimeout(() => {
    if (map) map.resize();
  }, 300);
};

window.closeSidebar = function() {
  const panel = document.getElementById('sidebar-panel');
  const backdrop = document.getElementById('sidebar-backdrop');
  const btn = document.getElementById('sidebar-toggle-btn') || document.getElementById('sidebar-expand-tab');
  const arrow = document.getElementById('sidebar-tab-arrow');
  if (panel) {
    panel.classList.remove('drawer-open');
    panel.classList.remove('mobile-open');
    if (!document.getElementById('sidebar-expand-tab')) {
      panel.classList.add('desktop-collapsed');
    }
  }
  if (backdrop) {
    backdrop.classList.remove('show');
  }
  if (btn) {
    btn.classList.remove('active');
  }
  if (arrow) {
    arrow.textContent = '◀';
  }
  document.body.classList.remove('sidebar-drawer-active');

  setTimeout(() => {
    if (map) map.resize();
  }, 300);
};

window.toggleLegend = function() {
  const legend = document.getElementById('map-legend');
  if (!legend) return;
  const isCollapsed = legend.classList.toggle('collapsed');
  // Sync mobile-expanded for backwards compatibility
  legend.classList.toggle('mobile-expanded', !isCollapsed);

  const toggleBtn = legend.querySelector('.legend-header-toggle');
  if (toggleBtn) {
    toggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
  }
  try {
    localStorage.setItem('co_river_legend_collapsed', isCollapsed ? '1' : '0');
  } catch (e) {}
};

window.toggleLegendMobile = window.toggleLegend;

// Initialize legend collapsed/expanded state
function initLegendState() {
  const legend = document.getElementById('map-legend');
  if (!legend) return;
  let shouldCollapse = false;
  if (window.innerWidth <= 900 || window.innerHeight <= 700) {
    shouldCollapse = true;
  } else {
    try {
      shouldCollapse = localStorage.getItem('co_river_legend_collapsed') === '1';
    } catch (e) {}
  }
  if (shouldCollapse) {
    legend.classList.add('collapsed');
    legend.classList.remove('mobile-expanded');
  } else {
    legend.classList.remove('collapsed');
    legend.classList.add('mobile-expanded');
  }
  const toggleBtn = legend.querySelector('.legend-header-toggle');
  if (toggleBtn) {
    toggleBtn.setAttribute('aria-expanded', String(!shouldCollapse));
  }
  syncLegendToLayerToggles();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLegendState);
} else {
  initLegendState();
}

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


