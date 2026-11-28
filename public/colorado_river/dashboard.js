if (typeof Chart !== 'undefined') {
  Chart.defaults.font.family = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  Chart.defaults.color = '#334155';
  Chart.defaults.borderColor = '#e2e8f0';
  Chart.defaults.animation = false;
  Chart.defaults.animations = false;
  Chart.defaults.transitions = false;

  // Editorial light card tooltip styling across all charts
  if (Chart.defaults.plugins && Chart.defaults.plugins.tooltip) {
    const tt = Chart.defaults.plugins.tooltip;
    tt.backgroundColor = 'rgba(255, 255, 255, 0.98)';
    tt.borderColor = '#cbd5e1';
    tt.borderWidth = 1;
    tt.cornerRadius = 3;
    tt.titleColor = '#0f172a';
    tt.titleFont = { family: 'Inter, sans-serif', size: 13, weight: '700' };
    tt.bodyColor = '#334155';
    tt.bodyFont = { family: 'Inter, sans-serif', size: 12, weight: '500' };
    tt.footerColor = '#64748b';
    tt.footerFont = { family: 'Inter, sans-serif', size: 11, weight: '400' };
    tt.padding = { top: 10, right: 12, bottom: 10, left: 12 };
    tt.boxWidth = 8;
    tt.boxHeight = 8;
    tt.boxPadding = 6;
    tt.usePointStyle = true;
  }
}
// Tab switching logic for the unified Colorado River Basin platform
let currentTab = 'overview';
const urlParams = new URLSearchParams(window.location.search);
const initialStation = urlParams.get('station');
const initialTab = urlParams.get('tab') || (initialStation ? 'map' : 'overview');
const initialModal = urlParams.get('modal');
if (initialModal === 'law') {
  setTimeout(openLawModal, 100);
} else if (initialModal === 'api') {
  setTimeout(openApiModal, 100);
}

function toggleMobileMenu(forceOpen) {
  const aside = document.querySelector('.sidebar-academic');
  const btn = document.getElementById('mobile-menu-toggle');
  const icon = document.getElementById('mobile-menu-toggle-icon');
  const text = document.getElementById('mobile-menu-toggle-text');
  if (!aside) return;

  const isOpen = typeof forceOpen === 'boolean'
    ? forceOpen
    : !aside.classList.contains('mobile-menu-open');

  aside.classList.toggle('mobile-menu-open', isOpen);
  if (btn) btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  if (icon) icon.innerHTML = isOpen ? '&#10005;' : '&#9776;';
  if (text) text.textContent = isOpen ? 'Close' : 'Menu';
}

function filterAcronyms(query) {
  const q = (query || '').trim().toLowerCase();
  document.querySelectorAll('#acronyms-grid .acronym-row').forEach((row) => {
    row.style.display = !q || row.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

function setTab(tabId) {
  currentTab = tabId;
  toggleMobileMenu(false);
  document.querySelectorAll('.nav-top-link, .sidebar-link').forEach(el => el.classList.remove('active'));
  const activeBtn = document.getElementById('tab-btn-' + tabId);
  if (activeBtn) activeBtn.classList.add('active');

  const mobileLabel = document.getElementById('mobile-active-section-label');
  if (mobileLabel) {
    const spanEl = activeBtn ? activeBtn.querySelector('span') : null;
    mobileLabel.textContent = spanEl ? spanEl.textContent.trim() : 'Overview';
  }

  const topHeader = document.getElementById('academic-top-header');

  // Hide all content containers
  document.getElementById('section-overview').classList.add('hidden');
  document.getElementById('section-map').classList.add('hidden');
  document.getElementById('section-sankey').classList.add('hidden');
  document.getElementById('section-pipeline').classList.add('hidden');
  document.getElementById('section-reservoirs').classList.add('hidden');
  document.getElementById('section-telemetry').classList.add('hidden');
  document.getElementById('section-ml').classList.add('hidden');
  document.getElementById('section-methodology').classList.add('hidden');
  document.getElementById('section-law').classList.add('hidden');
  document.getElementById('section-sources').classList.add('hidden');
  const secAcronyms = document.getElementById('section-acronyms');
  if (secAcronyms) secAcronyms.classList.add('hidden');

  if (tabId === 'overview') {
    topHeader.classList.remove('hidden');
    document.getElementById('section-overview').classList.remove('hidden');
  } else if (tabId === 'map') {
    topHeader.classList.add('hidden'); // Allow full-bleed map
    document.getElementById('section-map').classList.remove('hidden');
    const iframe = document.getElementById('iframe-map');
    if (iframe) {
      iframe.focus({ preventScroll: true });
      try { if (iframe.contentWindow) iframe.contentWindow.focus(); } catch (_) {}

      const syncMap = () => {
        try {
          if (iframe.contentWindow && iframe.contentWindow.map && typeof iframe.contentWindow.map.resize === 'function') {
            iframe.contentWindow.map.resize();
            // If map was initialized with 0x0 hidden container dimensions or zoomed out to world view, restore authoritative basin bounds INSTANTLY with jumpTo (NO bounce)
            const currentZ = iframe.contentWindow.map.getZoom();
            if ((currentZ < 4.2 || currentZ === undefined) && typeof iframe.contentWindow.zoomToPreset === 'function') {
              iframe.contentWindow.zoomToPreset('basin', true);
            }
          }
        } catch (_) {}
      };
      syncMap();
      setTimeout(syncMap, 60);
      setTimeout(syncMap, 200);
    }
  } else if (tabId === 'sankey') {
    topHeader.classList.add('hidden'); // Allow full-bleed Sankey budget diagram
    document.getElementById('section-sankey').classList.remove('hidden');
  } else if (tabId === 'pipeline') {
    topHeader.classList.add('hidden'); // Allow full-bleed geographic transit schematic
    document.getElementById('section-pipeline').classList.remove('hidden');
  } else if (tabId === 'reservoirs') {
    topHeader.classList.add('hidden'); // Dedicated full-bleed historical charts
    document.getElementById('section-reservoirs').classList.remove('hidden');
    setTimeout(() => {
      renderMacroStorageTimeline();
      if (currentReservoirRecord === 'mead') {
        renderMeadHistoricalCharts();
      } else {
        renderPowellHistoricalCharts();
      }
    }, 10);
  } else if (tabId === 'telemetry') {
    topHeader.classList.add('hidden'); // Telemetry has its own header table
    document.getElementById('section-telemetry').classList.remove('hidden');
  } else if (tabId === 'ml') {
    topHeader.classList.add('hidden'); // Flow regimes and ML analysis dashboard
    document.getElementById('section-ml').classList.remove('hidden');
  } else if (tabId === 'methodology') {
    topHeader.classList.add('hidden'); // Architecture & Methodology guide
    document.getElementById('section-methodology').classList.remove('hidden');
  } else if (tabId === 'law') {
    topHeader.classList.add('hidden');
    document.getElementById('section-law').classList.remove('hidden');
  } else if (tabId === 'sources') {
    topHeader.classList.add('hidden');
    document.getElementById('section-sources').classList.remove('hidden');
  } else if (tabId === 'acronyms') {
    topHeader.classList.add('hidden');
    const secAcronyms = document.getElementById('section-acronyms');
    if (secAcronyms) secAcronyms.classList.remove('hidden');
  }

  // Synchronize browser URL query state without page reload
  try {
    const newUrl = new URL(window.location);
    newUrl.searchParams.set('tab', tabId);
    if (tabId !== 'map') {
      newUrl.searchParams.delete('station');
    }
    window.history.replaceState({}, '', newUrl);
  } catch (_) {}

  setTimeout(() => {
    window.dispatchEvent(new Event('resize'));
  }, 30);
}

// Direct deep-link station focus on the interactive 3D map
function focusMapStation(stationId) {
  setTab('map');
  const iframe = document.getElementById('iframe-map');
  if (iframe && iframe.contentWindow) {
    const tryFocus = () => {
      try {
        if (typeof iframe.contentWindow.focusMapStation === 'function') {
          iframe.contentWindow.focusMapStation(stationId);
        } else {
          iframe.contentWindow.postMessage({ type: 'focusStation', stationId: stationId }, '*');
        }
      } catch (err) {
        iframe.contentWindow.postMessage({ type: 'focusStation', stationId: stationId }, '*');
      }
    };
    tryFocus();
    setTimeout(tryFocus, 250);
    setTimeout(tryFocus, 650);
  }
}
window.focusMapStation = focusMapStation;

// Cross-iframe communication for tab switching and station navigation
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'focusStation') {
    focusMapStation(event.data.stationId);
  } else if (event.data && event.data.type === 'setTab') {
    setTab(event.data.tabId);
  }
});

// Seamless focus & keyboard forwarding for embedded map:
// User does NOT have to click the map first for controls to work.
const sectionMap = document.getElementById('section-map');
if (sectionMap) {
  sectionMap.addEventListener('mouseenter', () => {
    const iframe = document.getElementById('iframe-map');
    if (iframe) {
      iframe.focus({ preventScroll: true });
      try { if (iframe.contentWindow) iframe.contentWindow.focus(); } catch (_) {}
    }
  });
  sectionMap.addEventListener('mousemove', () => {
    const iframe = document.getElementById('iframe-map');
    if (iframe && document.activeElement !== iframe) {
      iframe.focus({ preventScroll: true });
      try { if (iframe.contentWindow) iframe.contentWindow.focus(); } catch (_) {}
    }
  }, { passive: true });
}

// Forward navigation keys directly to map iframe when on System Map tab
window.addEventListener('keydown', (e) => {
  if (currentTab !== 'map') return;
  const tag = document.activeElement ? (document.activeElement.tagName || '').toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const iframe = document.getElementById('iframe-map');
  if (iframe && iframe.contentWindow) {
    if (document.activeElement !== iframe) {
      iframe.focus({ preventScroll: true });
      try { iframe.contentWindow.focus(); } catch (_) {}
    }
    try {
      iframe.contentWindow.dispatchEvent(new KeyboardEvent(e.type, {
        key: e.key,
        code: e.code,
        keyCode: e.keyCode,
        which: e.which,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        bubbles: true,
        cancelable: true
      }));
    } catch (_) {}
  }
});
window.addEventListener('keyup', (e) => {
  if (currentTab !== 'map') return;
  const iframe = document.getElementById('iframe-map');
  if (iframe && iframe.contentWindow) {
    try {
      iframe.contentWindow.dispatchEvent(new KeyboardEvent(e.type, {
        key: e.key,
        code: e.code,
        keyCode: e.keyCode,
        which: e.which,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        bubbles: true,
        cancelable: true
      }));
    } catch (_) {}
  }
});

// Close modals on Escape key
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModals();
});

// Copy Python Code snippet helper with visual feedback
function copyApiSnippet() {
  const codeEl = document.getElementById('api-code-snippet');
  const btn = document.getElementById('btn-copy-code');
  if (!codeEl) return;
  navigator.clipboard.writeText(codeEl.innerText).then(() => {
    if (btn) {
      const orig = btn.innerText;
      btn.innerText = 'Copied';
      btn.style.color = '#2f5744';
      setTimeout(() => {
        btn.innerText = orig;
        btn.style.color = '';
      }, 2000);
    }
  });
}

// Backwards-compatible panel helpers (converted from modals to in-panel tabs)
function openLawModal() {
  setTab('law');
}
function openApiModal() {
  setTab('sources');
}
function closeModals() {
  const lm = document.getElementById('law-modal');
  const am = document.getElementById('api-modal');
  if (lm) lm.classList.add('hidden');
  if (am) am.classList.add('hidden');
}

// Native Fullscreen Mode (keeps left navigation sidebar visible at all times)
let isWorkspaceFullscreen = false;

function triggerViewportResize() {
  window.dispatchEvent(new Event('resize'));
  setTimeout(() => {
    const mapIframe = document.getElementById('iframe-map');
    try {
      if (mapIframe && mapIframe.contentWindow && mapIframe.contentWindow.map) {
        mapIframe.contentWindow.map.resize();
      }
    } catch (_) {}
  }, 60);
}

function syncFullscreenUI() {
  const nativeFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  const isFs = isWorkspaceFullscreen || nativeFs;
  const enterIcon = document.getElementById('icon-enter-fullscreen');
  const exitIcon = document.getElementById('icon-exit-fullscreen');
  const labelEl = document.getElementById('fullscreen-label');
  if (enterIcon) enterIcon.classList.toggle('hidden', isFs);
  if (exitIcon) exitIcon.classList.toggle('hidden', !isFs);
  if (labelEl) labelEl.innerText = isFs ? 'Exit Fullscreen' : 'Fullscreen';
  triggerViewportResize();
}

function toggleFullScreen() {
  const nativeFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  const active = isWorkspaceFullscreen || nativeFs;

  if (!active) {
    isWorkspaceFullscreen = true;
    syncFullscreenUI();
    let root = document.documentElement;
    try {
      if (window.top && window.top.document && window.top.document.documentElement) {
        root = window.top.document.documentElement;
      }
    } catch (_) {}
    try {
      const req = root.requestFullscreen ? root.requestFullscreen()
        : root.webkitRequestFullscreen ? root.webkitRequestFullscreen()
        : null;
      if (req && typeof req.then === 'function') {
        req.then(syncFullscreenUI).catch(() => syncFullscreenUI());
      }
    } catch (_) {}
  } else {
    isWorkspaceFullscreen = false;
    syncFullscreenUI();
    try {
      const exitFn = document.exitFullscreen ? document.exitFullscreen()
        : document.webkitExitFullscreen ? document.webkitExitFullscreen()
        : null;
      if (exitFn && typeof exitFn.then === 'function') {
        exitFn.then(syncFullscreenUI).catch(() => syncFullscreenUI());
      }
    } catch (_) {}
  }
}
window.toggleFullScreen = toggleFullScreen;
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) isWorkspaceFullscreen = false;
  syncFullscreenUI();
});
document.addEventListener('webkitfullscreenchange', () => {
  if (!document.webkitFullscreenElement) isWorkspaceFullscreen = false;
  syncFullscreenUI();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isWorkspaceFullscreen && !document.fullscreenElement && !document.webkitFullscreenElement) {
    toggleFullScreen();
  }
});

// Active Reservoir Record ('mead' or 'powell') and view mode ('envelope' or 'heatmap')
let currentReservoirRecord = 'mead';
let currentReservoirView = 'envelope';

let currentReservoirSubtab = 'timeline';
window.switchReservoirsSubtab = function(mode) {
  currentReservoirSubtab = mode;
  const timelineSec = document.getElementById('view-res-timeline');
  const elevSec = document.getElementById('view-res-elevations');
  const btnTimeline = document.getElementById('subtab-btn-res-timeline');
  const btnElev = document.getElementById('subtab-btn-res-elevations');
  if (!timelineSec || !elevSec || !btnTimeline || !btnElev) return;

  const activeCls = 'px-3.5 py-1.5 rounded-[2px] text-xs font-bold transition shadow-xs bg-white text-sky-900 border border-stone-200 cursor-pointer';
  const inactiveCls = 'px-3.5 py-1.5 rounded-[2px] text-xs font-semibold transition text-stone-600 hover:text-stone-900 cursor-pointer';

  if (mode === 'timeline') {
    timelineSec.classList.remove('hidden');
    elevSec.classList.add('hidden');
    btnTimeline.className = activeCls;
    btnElev.className = inactiveCls;
    setTimeout(() => renderMacroStorageTimeline(), 10);
  } else {
    timelineSec.classList.add('hidden');
    elevSec.classList.remove('hidden');
    btnTimeline.className = inactiveCls;
    btnElev.className = activeCls;
    setTimeout(() => switchReservoirRecord(currentReservoirRecord || 'mead'), 10);
  }
};

function makeDecadeXAxis(fontSize = 10) {
  return {
    grid: { display: false },
    ticks: {
      font: { size: fontSize },
      autoSkip: false,
      maxRotation: 0,
      callback: function(val) {
        const yr = Number(this.getLabelForValue(val));
        return yr % 10 === 0 ? String(yr) : '';
      }
    }
  };
}

function switchReservoirRecord(reservoir) {
  currentReservoirRecord = reservoir;
  const tabMead = document.getElementById('tab-res-mead');
  const tabPowell = document.getElementById('tab-res-powell');
  const panelMead = document.getElementById('panel-res-mead');
  const panelPowell = document.getElementById('panel-res-powell');

  if (reservoir === 'mead') {
    tabMead.classList.add('is-active');
    tabPowell.classList.remove('is-active');
    panelMead.classList.remove('hidden');
    panelPowell.classList.add('hidden');
    setTimeout(() => {
      renderMeadHistoricalCharts();
      if (currentReservoirView === 'heatmap') {
        renderHeatmap();
      }
    }, 10);
  } else {
    tabPowell.classList.add('is-active');
    tabMead.classList.remove('is-active');
    panelMead.classList.add('hidden');
    panelPowell.classList.remove('hidden');
    setTimeout(() => {
      renderPowellHistoricalCharts();
      if (currentReservoirView === 'heatmap') {
        renderPowellHeatmap();
      }
    }, 10);
  }
}

// Toggle between Clean Seasonal Envelope and Full 12-Month Heatmap
function setReservoirView(mode) {
  currentReservoirView = mode;
  const btnEnv = document.getElementById('btn-view-envelope');
  const btnHeat = document.getElementById('btn-view-heatmap');
  
  const meadEnv = document.getElementById('container-mead-envelope');
  const meadHeat = document.getElementById('container-mead-heatmap');
  const powellEnv = document.getElementById('container-powell-envelope');
  const powellHeat = document.getElementById('container-powell-heatmap');

  if (mode === 'envelope') {
    btnEnv.classList.add('is-active');
    btnHeat.classList.remove('is-active');
    meadEnv.classList.remove('hidden');
    meadHeat.classList.add('hidden');
    powellEnv.classList.remove('hidden');
    powellHeat.classList.add('hidden');
  } else {
    btnHeat.classList.add('is-active');
    btnEnv.classList.remove('is-active');
    meadEnv.classList.add('hidden');
    meadHeat.classList.remove('hidden');
    powellEnv.classList.add('hidden');
    powellHeat.classList.remove('hidden');
    if (currentReservoirRecord === 'mead') {
      renderHeatmap();
    } else {
      renderPowellHeatmap();
    }
  }
}


let portalData = null;

async function loadPortalData() {
  try {
    const res = await fetch('./data/portal_historical.json');
    portalData = await res.json();
    
    // Render charts once data is loaded
    initOverviewCharts();
    if (currentTab === 'reservoirs') {
      renderMacroStorageTimeline();
      if (currentReservoirRecord === 'mead') {
        renderMeadHistoricalCharts();
      } else {
        renderPowellHistoricalCharts();
      }
    }
  } catch (err) {
    console.error('Failed loading portal data:', err);
  }
}

// ==============================================================
// OVERVIEW CHAPTER CONTROLLERS
// ==============================================================

let seasonalData = null;
let seasonalChartInstance = null;
let currentSeasonalView = 'mismatch';
let macroOverviewChartInstance = null;
let stateUseChartInstance = null;

// Scroll to section smoothly
function scrollToAct(actId) {
  const container = document.getElementById('section-overview');
  const el = document.getElementById(actId);
  if (!el || !container) return;
  
  const targetTop = Math.max(0, el.offsetTop - 12);
  container.scrollTo({ top: targetTop, behavior: 'smooth' });

  updateActiveActButton(actId);
}

function updateActiveActButton(actId) {
  document.querySelectorAll('.act-btn').forEach(btn => {
    btn.classList.remove('active', 'bg-[#0f172a]', 'text-white', 'border-[#0f172a]');
    btn.classList.add('bg-white', 'text-stone-600', 'border-stone-300');
  });
  const activeBtn = document.getElementById(`btn-${actId}`);
  if (activeBtn) {
    activeBtn.classList.remove('bg-white', 'text-stone-600', 'border-stone-300');
    activeBtn.classList.add('active', 'bg-[#0f172a]', 'text-white', 'border-[#0f172a]');
  }
}

function initActScrollSpy() {
  const container = document.getElementById('section-overview');
  if (!container) return;
  const acts = ['act-1', 'act-2', 'act-3', 'act-4'];

  container.addEventListener('scroll', () => {
    const scrollPos = container.scrollTop + 40;

    for (let i = acts.length - 1; i >= 0; i--) {
      const el = document.getElementById(acts[i]);
      if (el && el.offsetTop <= scrollPos) {
        updateActiveActButton(acts[i]);
        break;
      }
    }
  }, { passive: true });
}

function setSeasonalView() {
  renderSeasonalEngineChart();
}
window.setSeasonalView = setSeasonalView;

async function loadSeasonalData() {
  try {
    const res = await fetch('./data/seasonal_regimes.json');
    seasonalData = await res.json();
    window.seasonalData = seasonalData;
    renderSeasonalEngineChart();
    renderCompact100yrChart();
  } catch (err) {
    console.error('Failed loading seasonal regimes:', err);
  }
}

let compact100yrChartInstance = null;

function toggleCompactDataset(datasetIndex) {
  if (!compact100yrChartInstance) return;
  const visible = compact100yrChartInstance.isDatasetVisible(datasetIndex);
  compact100yrChartInstance.setDatasetVisibility(datasetIndex, !visible);
  compact100yrChartInstance.update();
}
window.toggleCompactDataset = toggleCompactDataset;

const glenCanyonDamMarkerPlugin = {
  id: 'glenCanyonDamMarkerPlugin',
  afterDatasetsDraw(chart) {
    if (!chart || !chart.chartArea || !chart.scales || !chart.scales.x) return;
    const { ctx, chartArea } = chart;
    const xScale = chart.scales.x;
    const labels = chart.data.labels || [];
    const idx1963 = labels.findIndex(y => String(y) === '1963');
    if (idx1963 === -1) return;
    const xPos = xScale.getPixelForValue(idx1963);
    if (xPos < chartArea.left || xPos > chartArea.right) return;

    ctx.save();
    const labelText = '1963: Glen Canyon Dam Closes';
    ctx.font = '600 10px "Inter", -apple-system, sans-serif';
    const textWidth = ctx.measureText(labelText).width;
    const pillW = textWidth + 14;
    const pillH = 18;
    const pillY = chartArea.top + 2;
    const pillX = Math.max(chartArea.left + 2, Math.min(chartArea.right - pillW - 2, xPos - (pillW / 2)));

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(pillX, pillY, pillW, pillH, 3);
    } else {
      ctx.rect(pillX, pillY, pillW, pillH);
    }
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#334155';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labelText, xPos, pillY + (pillH / 2));

    ctx.beginPath();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1.2;
    ctx.moveTo(xPos, pillY + pillH);
    ctx.lineTo(xPos, chartArea.bottom);
    ctx.stroke();
    ctx.restore();
  }
};

function renderCompact100yrChart() {
  if (!seasonalData || !seasonalData.compact_accounting_100yr) return;
  const canvas = document.getElementById('chart-compact-100yr');
  if (!canvas) return;
  if (compact100yrChartInstance) {
    compact100yrChartInstance.destroy();
    compact100yrChartInstance = null;
  }

  const ts = seasonalData.compact_accounting_100yr.annual_time_series || [];
  const labels = ts.map(d => d.wy);
  const supplyVals = ts.map(d => d.supply_maf);
  const releaseVals = ts.map(d => d.lees_ferry_release_maf);
  const bgColors = ts.map(d => d.meets_compact ? '#0284c7' : '#b2182b');

  compact100yrChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    plugins: [glenCanyonDamMarkerPlugin],
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'USBR Natural Flow at Lees Ferry (MAF)',
          data: supplyVals,
          backgroundColor: bgColors,
          borderRadius: 1.5,
          barPercentage: 0.85,
          order: 2
        },
        {
          type: 'line',
          label: 'Lees Ferry Releases (MAF)',
          data: releaseVals,
          borderColor: '#334155',
          borderWidth: 1.75,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: '#334155',
          pointHoverBorderColor: '#ffffff',
          pointHoverBorderWidth: 1.5,
          tension: 0.1,
          order: 1
        },
        {
          type: 'line',
          label: '16.5 MAF Core Statutory Line (7.5 Upper + 7.5 Lower + 1.5 MX)',
          data: labels.map(() => 16.5),
          borderColor: '#1e293b',
          borderWidth: 2,
          borderDash: [5, 4],
          pointRadius: 0,
          pointHoverRadius: 0,
          fill: false,
          order: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { left: 8, right: 10, top: 16, bottom: 4 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item) => item.datasetIndex !== 2,
          callbacks: {
            title: (items) => items.length ? `Water Year ${items[0].label}` : '',
            label: (ctx) => {
              const item = ts[ctx.dataIndex];
              if (ctx.dataset.type === 'bar') {
                return ` USBR Natural Flow: ${item.supply_maf.toFixed(2)} MAF`;
              }
              return ` Lees Ferry Release: ${ctx.parsed.y.toFixed(2)} MAF`;
            },
            footer: (items) => {
              if (!items.length) return '';
              const item = ts[items[0].dataIndex];
              if (!item) return '';
              const gapPromise = item.supply_maf - 16.5;
              const signP = gapPromise >= 0 ? '+' : '';
              const netDiff = item.supply_maf - item.lees_ferry_release_maf;
              const signD = netDiff >= 0 ? '+' : '';
              return [
                `vs. 16.50 MAF Core Promise: ${signP}${gapPromise.toFixed(2)} MAF`,
                `Natural − Release (Upper Use ± ΔStor): ${signD}${netDiff.toFixed(2)} MAF`
              ];
            }
          }
        }
      },
      scales: {
        x: makeDecadeXAxis(10),
        y: {
          min: 0,
          max: 30,
          title: { display: true, text: 'Annual Volume (MAF)', font: { size: 11, weight: '600' }, color: '#475569' },
          ticks: { stepSize: 5, callback: (v) => `${v} MAF`, font: { size: 10 }, color: '#64748b' },
          grid: { color: '#e2e8f0', lineWidth: 1 }
        }
      }
    }
  });
}

function renderSeasonalEngineChart() {
  if (!seasonalData) return;
  const canvas = document.getElementById('chart-seasonal-engine');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');

  // Generate calendar date labels for DOY 1..365
  const doy = seasonalData.seasonal_heartbeats.doy;
  const dateLabels = doy.map(d => {
    const dt = new Date(2024, 0, d);
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });

  // Real WY 2000-2024 USGS Powell Inflow vs. Lees Ferry Dam Release
  const mismatch = seasonalData.supply_demand_mismatch;
  if (mismatch.spring_peak_cfs != null) {
    const elPeak = document.getElementById('act2-peak');
    const elBase = document.getElementById('act2-base');
    const elRel = document.getElementById('act2-release');
    const elBal = document.getElementById('act2-balance');
    if (elPeak) elPeak.textContent = `${Math.round(mismatch.spring_peak_cfs).toLocaleString()} cfs`;
    if (elBase) elBase.textContent = `${Math.round(mismatch.winter_base_cfs).toLocaleString()} cfs`;
    if (elRel) elRel.textContent = `${Math.round(mismatch.mean_release_cfs).toLocaleString()} cfs`;
    if (elBal) elBal.textContent = `${mismatch.surplus_days}d Refill / ${mismatch.deficit_days}d Drain`;
  }
  const maxFlow = Math.max(...mismatch.supply_cfs, ...mismatch.demand_cfs, 35000);
  const yMax = Math.ceil(maxFlow / 10000) * 10000;

  const targetDatasets = [
    {
      label: 'Gaged Powell Inflow (Cisco + Green + San Juan)',
      data: mismatch.supply_cfs,
      borderColor: '#2b5c8f',
      backgroundColor: 'rgba(43, 92, 143, 0.12)',
      borderWidth: 2.2,
      fill: true,
      tension: 0.2,
      pointRadius: 0,
      pointHoverRadius: 4
    },
    {
      label: 'Glen Canyon Release (Lees Ferry #09380000)',
      data: mismatch.demand_cfs,
      borderColor: '#c26d2d',
      borderDash: [5, 4],
      borderWidth: 2.0,
      fill: false,
      tension: 0.1,
      pointRadius: 0,
      pointHoverRadius: 4
    }
  ];
  const targetOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: true,
        position: 'top',
        labels: {
          boxWidth: 14,
          boxHeight: 3,
          font: { size: 10, weight: 'bold' },
          color: '#475569',
          padding: 8
        }
      },
      tooltip: {
        callbacks: {
          title: items => `Calendar Date: ${items[0].label}`,
          label: ctx => ` ${ctx.dataset.label.split(' (')[0]}: ${parseInt(ctx.parsed.y).toLocaleString()} cfs`,
          afterBody: items => {
            const supply = items[0].parsed.y;
            const demand = items[1] ? items[1].parsed.y : 0;
            const diff = supply - demand;
            return `Net Balance: ${diff >= 0 ? '+' : ''}${parseInt(diff).toLocaleString()} cfs (${diff >= 0 ? 'Refilling' : 'Draining'})`;
          }
        }
      }
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          font: { size: 9 },
          maxTicksLimit: 12,
          maxRotation: 0,
          autoSkip: true
        }
      },
      y: {
        min: 0,
        max: yMax,
        ticks: {
          font: { size: 9 },
          stepSize: 10000,
          callback: v => (v / 1000).toFixed(0) + 'k cfs'
        },
        grid: { color: '#e6e0d5' }
      }
    }
  };

  // Fast In-Place Chart.js Mutation: Reuse existing instance to prevent canvas context thrashing
  if (seasonalChartInstance) {
    seasonalChartInstance.data.labels = dateLabels;
    seasonalChartInstance.data.datasets = targetDatasets;
    seasonalChartInstance.options = targetOptions;
    seasonalChartInstance.update('none'); // Suppress expensive animations on instant view toggle
    window.seasonalChartInstance = seasonalChartInstance;
    return;
  }

  seasonalChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dateLabels,
      datasets: targetDatasets
    },
    options: targetOptions
  });
  window.seasonalChartInstance = seasonalChartInstance;
}

function initOverviewCharts() {
  if (!portalData) return;

  // 1. Render Act 3 Combined Macro Basin Storage Trajectory (1937 - 2026)
  const timeline = portalData.basin_storage_timeline || [];
  const macroYears = timeline.map(d => d.year);
  const totalMaf = timeline.map(d => d.total_major_storage_maf);

  const macroCanvas = document.getElementById('chart-macro-overview-timeline');
  if (macroCanvas) {
    const macroCtx = macroCanvas.getContext('2d');
    if (macroOverviewChartInstance) {
      macroOverviewChartInstance.destroy();
      macroOverviewChartInstance = null;
    }

    macroOverviewChartInstance = new Chart(macroCtx, {
      type: 'line',
      plugins: [horizontalThresholdPlugin],
      data: {
        labels: macroYears,
        datasets: [
          {
            label: 'Total Basin Major Storage',
            data: totalMaf,
            borderColor: '#2b5c8f',
            borderWidth: 2.25,
            fill: false,
            tension: 0.15,
            pointRadius: 0,
            pointHoverRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          horizontalThresholdPlugin: {
            lines: [
              { value: 60.0, customLabel: 'Full System Capacity (~60.0 MAF)', color: '#475569', textColor: '#334155', dash: [6, 4], noBox: true, yAdjust: 12 }
            ]
          },
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              title: items => `Calendar Year ${items[0].label}`,
              label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)} MAF`
            }
          }
        },
        scales: {
          x: makeDecadeXAxis(9),
          y: {
            min: 0,
            max: 60,
            ticks: { font: { size: 9 }, stepSize: 15, callback: v => v + ' MAF' },
            grid: { color: '#e6e0d5', lineWidth: 1 }
          }
        }
      }
    });
  }

  // 2. Render Act 4 State Consumptive Use Bar Chart
  const stateCanvas = document.getElementById('chart-state-use');
  if (stateCanvas) {
    const stateCtx = stateCanvas.getContext('2d');
    if (stateUseChartInstance) {
      stateUseChartInstance.destroy();
      stateUseChartInstance = null;
    }

    stateUseChartInstance = new Chart(stateCtx, {
      type: 'bar',
      data: {
        labels: ['CA', 'CO', 'AZ', 'UT', 'WY', 'NM', 'NV'],
        datasets: [
          {
            label: 'Paper Allocation',
            data: [4.40, 3.86, 2.85, 1.71, 1.04, 0.84, 0.30],
            backgroundColor: '#e2ddd1',
            borderColor: '#8c8476',
            borderWidth: 1,
            borderRadius: 1
          },
          {
            label: 'Actual Use (2000–2024)',
            data: [4.41, 1.96, 2.62, 0.93, 0.61, 0.37, 0.25],
            backgroundColor: [
              '#c26d2d', // CA (Lower Basin)
              '#2b5c8f', // CO (Upper Basin)
              '#c26d2d', // AZ (2.59 Lower + 0.03 Upper)
              '#2b5c8f', // UT (Upper Basin)
              '#2b5c8f', // WY (Upper Basin)
              '#2b5c8f', // NM (Upper Basin)
              '#c26d2d'  // NV (Lower Basin)
            ],
            borderRadius: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: items => {
                const desc = {
                  CA: 'California (Lower Basin • 1928 Boulder Canyon Act)',
                  CO: 'Colorado (Upper Basin • 51.75% of 7.45 MAF)',
                  AZ: 'Arizona (2.80 Lower + 0.05 Upper)',
                  UT: 'Utah (Upper Basin • 23.00% of 7.45 MAF)',
                  WY: 'Wyoming (Upper Basin • 14.00% of 7.45 MAF)',
                  NM: 'New Mexico (Upper Basin • 11.25% of 7.45 MAF)',
                  NV: 'Nevada (Lower Basin • 1928 Boulder Canyon Act)'
                };
                return desc[items[0].label] || items[0].label;
              },
              label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)} MAF/yr`,
              afterBody: items => {
                if (items.length < 2) return '';
                const paper = items[0].parsed.y;
                const actual = items[1].parsed.y;
                const pct = Math.round((actual / paper) * 100);
                return `Share Used: ${pct}% (${(actual - paper >= 0 ? '+' : '') + (actual - paper).toFixed(2)} MAF/yr)`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 9.5, weight: 'bold' } }
          },
          y: {
            min: 0,
            max: 5,
            ticks: { font: { size: 9 }, stepSize: 1, callback: v => v + ' MAF' },
            grid: { color: '#e6e0d5' }
          }
        }
      }
    });
  }
}

// Macro Basin Multi-Reservoir Storage Timeline (1937 - Present)
let macroChartInstance = null;
function renderMacroStorageTimeline() {
  if (!portalData) return;
  const timeline = portalData.basin_storage_timeline || [];
  if (!timeline.length) return;

  const years = timeline.map(d => d.year);
  const meadMaf = timeline.map(d => d.mead_maf);
  const powellMaf = timeline.map(d => d.powell_maf);
  const crspMaf = timeline.map(d => (d.flaming_gorge_maf || 0) + (d.navajo_maf || 0) + (d.blue_mesa_maf || 0));
  const totalMaf = timeline.map(d => d.total_major_storage_maf);

  // Update current total stat card if available
  const latestPoint = timeline[timeline.length - 1];
  const metricEl = document.getElementById('metric-current-total-maf');
  if (metricEl && latestPoint) {
    metricEl.innerText = `${latestPoint.total_major_storage_maf.toFixed(1)} MAF`;
  }

  const canvas = document.getElementById('chart-macro-timeline');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  if (macroChartInstance) {
    macroChartInstance.destroy();
    macroChartInstance = null;
  }

  // 4 Datasets (Clean multi-line trajectories in the muted river-corridor palette, zero solid fills):
  // 0: Combined Total - Primary total storage curve (#0f172a)
  // 1: Lake Mead - Muted river blue (#2b5c8f)
  // 2: Lake Powell - Muted canyon ochre (#c26d2d)
  // 3: Upper CRSP - Muted riparian sage dashed (#3f6f58)
  const datasets = [
    {
      label: 'Combined Total',
      data: totalMaf,
      borderColor: '#0f172a',
      backgroundColor: 'transparent',
      borderWidth: 2.5,
      fill: false,
      order: 0,
      tension: 0.15,
      pointRadius: 0
    },
    {
      label: 'Lake Mead',
      data: meadMaf,
      borderColor: '#2b5c8f',
      backgroundColor: 'transparent',
      borderWidth: 2,
      fill: false,
      order: 1,
      tension: 0.15,
      pointRadius: 0
    },
    {
      label: 'Lake Powell',
      data: powellMaf,
      borderColor: '#c26d2d',
      backgroundColor: 'transparent',
      borderWidth: 2,
      fill: false,
      order: 2,
      tension: 0.15,
      pointRadius: 0
    },
    {
      label: 'Upper CRSP',
      data: crspMaf,
      borderColor: '#3f6f58',
      backgroundColor: 'transparent',
      borderWidth: 1.75,
      borderDash: [4, 3],
      fill: false,
      order: 3,
      tension: 0.15,
      pointRadius: 0
    }
  ];

  const thresholdLines = [
    { 
      value: 60.0, 
      customLabel: 'Full System Capacity (~60.0 MAF)', 
      color: '#64748b', 
      textColor: '#0f172a', 
      width: 1.0, 
      dash: [6, 4],
      noBox: true,
      font: { size: 11, weight: '600' },
      position: 'end',
      xAdjust: -6,
      yAdjust: 14
    }
  ];

  macroChartInstance = new Chart(ctx, {
    type: 'line',
    plugins: [horizontalThresholdPlugin],
    data: {
      labels: years,
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        horizontalThresholdPlugin: {
          drawTime: 'afterDatasetsDraw',
          lines: thresholdLines
        },
        legend: {
          position: 'top',
          labels: { font: { size: 10, weight: '600' }, boxWidth: 12, usePointStyle: true }
        },
        tooltip: {
          backgroundColor: 'rgba(255, 255, 255, 0.98)',
          borderColor: '#cbd5e1',
          borderWidth: 1,
          cornerRadius: 3,
          titleColor: '#0f172a',
          titleFont: { family: 'Inter, sans-serif', size: 13, weight: '700' },
          bodyColor: '#334155',
          bodyFont: { family: 'Inter, sans-serif', size: 12, weight: '500' },
          footerColor: '#64748b',
          footerFont: { family: 'Inter, sans-serif', size: 11, weight: '400' },
          padding: { top: 10, right: 12, bottom: 10, left: 12 },
          boxWidth: 8,
          boxHeight: 8,
          boxPadding: 6,
          usePointStyle: true,
          itemSort: (a, b) => {
            const orderMap = {
              'Combined Total': 0,
              'Lake Mead': 1,
              'Lake Powell': 2,
              'Upper CRSP': 3
            };
            const getRank = (item) => {
              const lbl = (item && item.dataset && item.dataset.label) || '';
              for (const [k, v] of Object.entries(orderMap)) {
                if (lbl.includes(k)) return v;
              }
              return 99;
            };
            return getRank(a) - getRank(b);
          },
          callbacks: {
            label: (ctx) => {
              const val = ctx.parsed.y !== null && ctx.parsed.y !== undefined ? ctx.parsed.y.toFixed(2) : '0.00';
              let name = ctx.dataset.label || '';
              name = name.replace(/\s*\([^)]*\)/g, '').replace(' Reservoirs', '').replace(' Storage', '').trim();
              if (name === 'Combined Total') return ` Combined Total: ${val} MAF`;
              if (name === 'Lake Mead') return ` Lake Mead: ${val} MAF`;
              if (name === 'Lake Powell') return ` Lake Powell: ${val} MAF`;
              if (name.includes('CRSP')) return ` Upper CRSP: ${val} MAF`;
              return ` ${name}: ${val} MAF`;
            },
            footer: (tooltipItems) => {
              if (!tooltipItems || !tooltipItems.length) return '';
              const idx = tooltipItems[0].dataIndex;
              const point = timeline[idx];
              if (!point) return '';
              const fg = point.flaming_gorge_maf !== undefined ? point.flaming_gorge_maf.toFixed(2) : '0.00';
              const nav = point.navajo_maf !== undefined ? point.navajo_maf.toFixed(2) : '0.00';
              const bm = point.blue_mesa_maf !== undefined ? point.blue_mesa_maf.toFixed(2) : '0.00';
              return `CRSP Breakdown: Flaming Gorge ${fg} · Navajo ${nav} · Blue Mesa ${bm} MAF`;
            }
          }
        }
      },
      scales: {
        x: makeDecadeXAxis(10),
        y: {
          stacked: false,
          min: 0,
          max: 60,
          ticks: {
            font: { size: 10 },
            stepSize: 10,
            callback: (val) => val + ' MAF'
          },
          grid: { color: '#e2e8f0', lineWidth: 1 }
        }
      }
    }
  });
  window.macroChartInstance = macroChartInstance;
}

// Historical Lake Mead Charts (Envelope & Heatmap)
let meadChartInstance = null;

// Custom plugin to draw horizontal reference lines with crisp, high-contrast editorial badges or unboxed labels
const horizontalThresholdPlugin = {
  id: 'horizontalThresholdPlugin',
  afterDatasetsDraw(chart, args, options) {
    if (options && options.drawTime === 'afterDraw') return;
    this.drawLines(chart, args, options);
  },
  afterDraw(chart, args, options) {
    if (options && options.drawTime === 'afterDraw') {
      this.drawLines(chart, args, options);
    }
  },
  drawLines(chart, args, options) {
    if (!chart || !chart.chartArea || !chart.scales || !chart.scales.y) return;
    const { ctx, chartArea } = chart;
    const left = chartArea.left;
    const right = chartArea.right;
    const top = chartArea.top;
    const bottom = chartArea.bottom;
    const y = chart.scales.y;
    const lines = (options && options.lines) || [];
    
    ctx.save();
    lines.forEach(line => {
      if (line.value === undefined || line.value === null) return;
      const yPos = y.getPixelForValue(line.value);
      if (yPos === undefined || isNaN(yPos) || yPos < top || yPos > bottom) return;

      // Draw dashed threshold line
      ctx.beginPath();
      ctx.setLineDash(line.dash || [5, 4]);
      ctx.strokeStyle = line.color || '#94a3b8';
      ctx.lineWidth = line.width || 1.2;
      ctx.moveTo(left, yPos);
      ctx.lineTo(right, yPos);
      ctx.stroke();

      // Draw label badge or unboxed text
      if (line.label || line.customLabel) {
        ctx.setLineDash([]);
        const fontSize = (line.font && line.font.size) || line.fontSize || 11;
        const fontWeight = (line.font && line.font.weight) || line.fontWeight || '600';
        const fontFamily = (line.font && line.font.family) || line.fontFamily || "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";
        ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
        
        const unit = line.unit !== undefined ? line.unit : ' ft';
        const valStr = typeof line.value === 'number' ? line.value.toLocaleString() : line.value;
        const labelText = line.customLabel || `${line.label} (${valStr}${unit})`;

        if (line.noBox) {
          // Clean unboxed text sitting above the dashed line with protective white halo
          const xAdjust = line.xAdjust !== undefined ? line.xAdjust : -8;
          let yAdjust = line.yAdjust !== undefined ? line.yAdjust : -8;
          let textY = yPos + yAdjust;
          // Guard against top frame collision: ensure at least 6px buffer from top edge
          if (textY - (fontSize / 2) < top + 6) {
            textY = yPos + fontSize + 4;
          }
          const textX = (line.position === 'start') ? (left - xAdjust) : (right + xAdjust);

          ctx.textAlign = (line.position === 'start') ? 'left' : ((line.position === 'center') ? 'center' : 'right');
          ctx.textBaseline = 'middle';

          // White halo to prevent intersecting dataset lines from slicing through text
          ctx.save();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 4;
          ctx.lineJoin = 'round';
          ctx.strokeText(labelText, textX, textY);
          ctx.restore();

          ctx.fillStyle = line.textColor || line.color || '#0f172a';
          ctx.fillText(labelText, textX, textY);
        } else {
          const textWidth = ctx.measureText(labelText).width;
          const padX = line.padX !== undefined ? line.padX : 8;
          const padY = line.padY !== undefined ? line.padY : 3.5;
          const pillW = textWidth + padX * 2;
          const pillH = fontSize + padY * 2;
          const pillX = (line.position === 'start') ? (left + 10) : (line.position === 'center') ? (left + (right - left - pillW) / 2) : (right - pillW - 10);
          
          let pillY = yPos - pillH - 4;
          if (line.yOffset !== undefined) {
            pillY = yPos + line.yOffset;
          } else if (pillY < top + 6) {
            // Guard: at least 6px buffer from top
            pillY = yPos + 6;
          } else if (pillY + pillH > bottom - 6) {
            pillY = yPos - pillH - 4;
          }

          ctx.beginPath();
          const r = line.radius !== undefined ? line.radius : 3.5;
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(pillX, pillY, pillW, pillH, r);
          } else {
            ctx.moveTo(pillX + r, pillY);
            ctx.lineTo(pillX + pillW - r, pillY);
            ctx.arcTo(pillX + pillW, pillY, pillX + pillW, pillY + r, r);
            ctx.arcTo(pillX + pillW, pillY + pillH, pillX + pillW - r, pillY + pillH, r);
            ctx.arcTo(pillX, pillY + pillH, pillX, pillY + pillH - r, r);
            ctx.arcTo(pillX, pillY, pillX + r, pillY, r);
            ctx.closePath();
          }
          ctx.fillStyle = line.bgColor || '#ffffff';
          ctx.fill();
          ctx.strokeStyle = line.borderColor || '#cbd5e1';
          ctx.lineWidth = line.borderWidth || 1;
          ctx.stroke();

          ctx.fillStyle = line.textColor || line.color || '#0f172a';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(labelText, pillX + pillW / 2, pillY + pillH / 2);
        }
      }
    });
    ctx.restore();
  }
};

function renderMeadHistoricalCharts() {
  if (!portalData) return;

  const records = portalData.lake_mead_historical || [];
  if (!records.length) return;

  const years = records.map(r => r.year);
  const minElv = records.map(r => r.min);
  const maxElv = records.map(r => r.max);
  const meanElv = records.map(r => r.mean);

  const canvas = document.getElementById('chart-mead-history');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  if (meadChartInstance) {
    meadChartInstance.destroy();
    meadChartInstance = null;
  }

  meadChartInstance = new Chart(ctx, {
    type: 'line',
    plugins: [horizontalThresholdPlugin],
    data: {
      labels: years,
      datasets: [
        {
          label: 'Annual Mean Elevation',
          data: meanElv,
          borderColor: '#0072B2',
          backgroundColor: 'rgba(0, 114, 178, 0.16)',
          borderWidth: 2.2,
          pointRadius: 0,
          tension: 0.15
        },
        {
          label: 'Annual Max Elevation',
          data: maxElv,
          borderColor: 'rgba(0, 114, 178, 0.5)',
          borderWidth: 1,
          borderDash: [2, 2],
          pointRadius: 0,
          fill: '+1',
          backgroundColor: 'rgba(0, 114, 178, 0.10)'
        },
        {
          label: 'Annual Min Elevation',
          data: minElv,
          borderColor: 'rgba(0, 114, 178, 0.5)',
          borderWidth: 1,
          borderDash: [2, 2],
          pointRadius: 0,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        horizontalThresholdPlugin: {
          lines: [
            { value: 1221.4, label: 'Spillway Crest', color: '#1e293b', dash: [6, 4] },
            { value: 1075.0, label: 'Tier 1 Shortage', color: '#0072B2', dash: [5, 3], position: 'center' },
            { value: 950.0, label: 'Min Power Pool', color: '#D55E00', dash: [5, 3] },
            { value: 895.0, label: 'Dead Pool', color: '#dc2626', dash: [6, 3] },
            { value: 860, label: 'SNWA Intake No. 3 ("Third Straw")', color: '#6d28d9', dash: [3, 3], yOffset: 4 }
          ]
        },
        legend: {
          position: 'top',
          labels: { font: { size: 10, weight: '600' }, boxWidth: 12 }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y ? ctx.parsed.y.toFixed(1) + ' ft' : 'N/A'}`
          }
        }
      },
      scales: {
        x: makeDecadeXAxis(10),
        y: {
          min: 800,
          max: 1250,
          ticks: {
            font: { size: 10 },
            stepSize: 50,
            callback: (val) => val + ' ft'
          },
          grid: { color: '#e2e8f0', lineWidth: 1 }
        }
      }
    }
  });
}

// Render the 1937–2026 by 12-month heatmap matrix
function renderHeatmap() {
  const container = document.getElementById('heatmap-grid');
  if (container.children.length > 0 || !portalData) return;

  const records = portalData.lake_mead_historical || [];
  const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

  // Header row
  const headerRow = document.createElement('div');
  headerRow.className = 'grid grid-cols-13 gap-1 text-[9px] font-bold text-stone-500 mb-1';
  headerRow.style.gridTemplateColumns = '48px repeat(12, minmax(0, 1fr))';
  
  const emptyCell = document.createElement('div');
  emptyCell.innerText = 'Year';
  headerRow.appendChild(emptyCell);

  monthNames.forEach(m => {
    const mCell = document.createElement('div');
    mCell.className = 'text-center uppercase';
    mCell.innerText = m;
    headerRow.appendChild(mCell);
  });
  container.appendChild(headerRow);

  // Standardized ColorBrewer Diverging Water Scale (Blue-to-Red)
  function getColor(elv) {
    if (!elv) return '#f1f5f9';
    if (elv > 1200) return '#1e3a8a'; // Near Full Pool / Historic Spillway Crest (1,221.4 ft)
    if (elv > 1170) return '#0284c7'; // Upper Operating Range (>70% capacity)
    if (elv > 1140) return '#38bdf8'; // Active Storage Mid-Pool
    if (elv > 1110) return '#cbd5e1'; // Lower Operating Buffer Range
    if (elv > 1075) return '#f59e0b'; // Tier 1 Shortage Trigger Zone (1,075 ft)
    if (elv > 1050) return '#ea580c'; // Tier 2 Shortage Cutbacks (1,050 ft)
    return '#991b1b';                 // Critical Shortage (Tier 3 at 1,025 ft & approaching Min Power 950 ft)
  }

  // Rows for each year
  records.forEach(r => {
    const row = document.createElement('div');
    row.className = 'grid gap-1 items-center';
    row.style.gridTemplateColumns = '48px repeat(12, minmax(0, 1fr))';

    const yearLabel = document.createElement('div');
    yearLabel.className = 'text-[9.5px] tabular-nums font-bold text-stone-600';
    yearLabel.innerText = r.year;
    row.appendChild(yearLabel);

    monthNames.forEach(mKey => {
      const val = r.elevations ? r.elevations[mKey] : null;
      const cell = document.createElement('div');
      cell.className = 'h-3 rounded-xs heatmap-cell cursor-pointer relative';
      cell.style.backgroundColor = getColor(val);
      if (val) {
        cell.title = `${r.year} ${mKey}: ${val.toFixed(1)} ft NGVD29`;
      }
      row.appendChild(cell);
    });

    container.appendChild(row);
  });
}

// Historical Lake Powell Charts (Envelope & Heatmap)
let powellChartInstance = null;
function renderPowellHistoricalCharts() {
  if (!portalData) return;

  const records = portalData.lake_powell_elevation_historical || [];
  if (!records.length) return;

  const years = records.map(r => r.year);
  const minElv = records.map(r => r.min);
  const maxElv = records.map(r => r.max);
  const meanElv = records.map(r => r.mean);

  const canvas = document.getElementById('chart-powell-elevation-history');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  if (powellChartInstance) {
    powellChartInstance.destroy();
    powellChartInstance = null;
  }

  powellChartInstance = new Chart(ctx, {
    type: 'line',
    plugins: [horizontalThresholdPlugin],
    data: {
      labels: years,
      datasets: [
        {
          label: 'Annual Mean Elevation',
          data: meanElv,
          borderColor: '#0072B2',
          backgroundColor: 'rgba(0, 114, 178, 0.16)',
          borderWidth: 2.2,
          pointRadius: 0,
          tension: 0.15
        },
        {
          label: 'Annual Max Elevation',
          data: maxElv,
          borderColor: 'rgba(0, 114, 178, 0.5)',
          borderWidth: 1,
          borderDash: [2, 2],
          pointRadius: 0,
          fill: '+1',
          backgroundColor: 'rgba(0, 114, 178, 0.10)'
        },
        {
          label: 'Annual Min Elevation',
          data: minElv,
          borderColor: 'rgba(0, 114, 178, 0.5)',
          borderWidth: 1,
          borderDash: [2, 2],
          pointRadius: 0,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        horizontalThresholdPlugin: {
          lines: [
            { value: 3700, label: 'Spillway / Full Pool', color: '#1e293b', dash: [6, 4] },
            { value: 3525, label: 'Drought Protection Target', color: '#0072B2', dash: [5, 3] },
            { value: 3490.0, label: 'Min Power Pool', color: '#D55E00', dash: [5, 3] },
            { value: 3370.0, label: 'Dead Pool', color: '#dc2626', dash: [6, 3] }
          ]
        },
        legend: {
          position: 'top',
          labels: { font: { size: 10, weight: '600' }, boxWidth: 12 }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y ? ctx.parsed.y.toFixed(1) + ' ft' : 'N/A'}`
          }
        }
      },
      scales: {
        x: makeDecadeXAxis(10),
        y: {
          min: 3350,
          max: 3750,
          ticks: {
            font: { size: 10 },
            stepSize: 50,
            callback: (val) => val + ' ft'
          },
          grid: { color: '#e2e8f0', lineWidth: 1 }
        }
      }
    }
  });
}

// Render the 64-year by 12-month heatmap matrix for Lake Powell
function renderPowellHeatmap() {
  const container = document.getElementById('powell-heatmap-grid');
  if (container.children.length > 0 || !portalData) return;

  const records = portalData.lake_powell_elevation_historical || [];
  const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

  // Header row
  const headerRow = document.createElement('div');
  headerRow.className = 'grid grid-cols-13 gap-1 text-[9px] font-bold text-stone-500 mb-1';
  headerRow.style.gridTemplateColumns = '48px repeat(12, minmax(0, 1fr))';
  
  const emptyCell = document.createElement('div');
  emptyCell.innerText = 'Year';
  headerRow.appendChild(emptyCell);

  monthNames.forEach(m => {
    const mCell = document.createElement('div');
    mCell.className = 'text-center uppercase';
    mCell.innerText = m;
    headerRow.appendChild(mCell);
  });
  container.appendChild(headerRow);

  // Standardized ColorBrewer Diverging Water Scale (Blue-to-Red)
  function getPowellColor(elv) {
    if (!elv) return '#f1f5f9';
    if (elv > 3670) return '#1e3a8a'; // Near Full Pool / Historic Spillway Crest (3,700 ft)
    if (elv > 3620) return '#0284c7'; // Upper Operating Range
    if (elv > 3575) return '#38bdf8'; // Active Conservation Mid-Pool (Buffer Target 3,575 ft)
    if (elv > 3525) return '#cbd5e1'; // DCP Conservation Buffer Range
    if (elv > 3490) return '#f59e0b'; // Critical Warning Buffer above Min Power Pool (3,490 ft)
    if (elv > 3450) return '#ea580c'; // Below Minimum Power Pool (turbines cease generation)
    return '#991b1b';                 // Critical Emergency Drawdown toward Dead Pool (3,370 ft)
  }

  // Rows for each year
  records.forEach(r => {
    const row = document.createElement('div');
    row.className = 'grid gap-1 items-center';
    row.style.gridTemplateColumns = '48px repeat(12, minmax(0, 1fr))';

    const yearLabel = document.createElement('div');
    yearLabel.className = 'text-[9.5px] tabular-nums font-bold text-stone-600';
    yearLabel.innerText = r.year;
    row.appendChild(yearLabel);

    monthNames.forEach(mKey => {
      const val = r.elevations ? r.elevations[mKey] : null;
      const cell = document.createElement('div');
      cell.className = 'h-3 rounded-xs heatmap-cell cursor-pointer relative';
      cell.style.backgroundColor = getPowellColor(val);
      if (val) {
        cell.title = `${r.year} ${mKey}: ${val.toFixed(1)} ft`;
      }
      row.appendChild(cell);
    });

    container.appendChild(row);
  });
}

// Prevent WebKit / iPad Safari page-level pinch zoom when scrolling with mouse wheel or trackpad
window.addEventListener('wheel', (e) => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
  }
}, { passive: false });
window.addEventListener('gesturestart', (e) => e.preventDefault());
window.addEventListener('gesturechange', (e) => e.preventDefault());

// Initialize portal on DOM content loaded
document.addEventListener('DOMContentLoaded', () => {
  loadPortalData();
  loadSeasonalData();
  initActScrollSpy();
  if (initialTab) {
    setTab(initialTab);
  }
  if (initialStation) {
    setTimeout(() => {
      focusMapStation(initialStation);
    }, 900);
  }
});
