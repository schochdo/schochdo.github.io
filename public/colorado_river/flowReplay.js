/**
 * flowReplay.js - 7-Day & 30-Day Empirical Flow Replay Engine for MapLibre GL JS
 * 
 * Provides 60 FPS temporal replay of USGS streamflow observations across the
 * Colorado River basin using compact pre-downsampled columnar matrices:
 * - 7-Day (1h resolution, ~82 KB)
 * - 30-Day (2h resolution, ~165 KB)
 * 
 * Architecture:
 * - Decoupled state store preventing canvas layout thrashing.
 * - Non-destructive: preserves original real-time GeoJSON baselines and restores them on exit.
 * - Dynamic SVG/WebGL styling: scales marker radius via sqrt(Q) and colors pulse surges (>1.8x median).
 * - Real hydrologic story: visualizes flood wave travel and Glen Canyon / Hoover dam interception.
 * - Multi-period switching (7D / 30D) with lazy-loading and in-memory caching.
 */

(function (window) {
  'use strict';

  const FlowReplayEngine = {
    map: null,
    metrics: null,
    activePeriod: '7D', // '7D' or '30D'
    datasets: {
      '7D': null,
      '30D': null
    },
    data: null,
    totalHours: 0,
    currentIndex: 0,
    isPlaying: false,
    speed: 1, // hours per second (1, 4, 12)
    lastTimestamp: 0,
    accumulatedTime: 0,
    rafId: null,
    isOpen: false,
    normals: null,
    wasFlowHealthActiveBeforeReplay: null,

    // Baseline caches for clean restoration
    originalGaugesGeoJSON: null,
    originalReachesGeoJSON: null,
    cachedGaugesFeatures: null,
    cachedReachesFeatures: null,

    // Sentinel Station IDs for pulse tracking
    SENTINELS: {
      SAN_JUAN: '09379500',   // San Juan River at Mexican Hat, UT (Inflow to Powell)
      CISCO: '09180500',      // Colorado River nr Cisco, UT (Upper Mainstem to Powell)
      LEES_FERRY: '09380000', // Colorado River at Lees Ferry, AZ (Powell Outflow)
      LITTLE_CO: '09402000',  // Little Colorado River at Cameron, AZ (Grand Canyon Inflow)
      GILA_DOME: '09520500'   // Gila River near Dome, AZ (Lower Basin / Border)
    },

    init(mapInstance, metricsData, normalsData) {
      this.map = mapInstance;
      this.metrics = metricsData;
      this.normals = normalsData || window.cachedNormals || null;
      this._bindUI();
    },

    async _ensureNormalsLoaded() {
      if (this.normals && this.normals.sites) return this.normals;
      if (window.cachedNormals && window.cachedNormals.sites) {
        this.normals = window.cachedNormals;
        return this.normals;
      }
      try {
        const resp = await fetch('./data/historical_normals.json');
        if (resp.ok) {
          this.normals = await resp.json();
          window.cachedNormals = this.normals;
        }
      } catch (err) {
        console.warn('[FlowReplayEngine] Could not load historical normals:', err);
      }
      return this.normals;
    },

    _getHistoricalNormal(siteId, dateKey) {
      if (!this.normals || !this.normals.sites) {
        if (window.cachedNormals && window.cachedNormals.sites) {
          this.normals = window.cachedNormals;
        }
      }
      const site = this.normals?.sites?.[siteId];
      if (!site) return null;
      return site[dateKey] ?? null;
    },

    _flowHealthColor(pctOfNormal) {
      if (typeof window.flowHealthColor === 'function') {
        return window.flowHealthColor(pctOfNormal);
      }
      if (pctOfNormal === null || pctOfNormal === undefined) return '#0284c7';
      if (pctOfNormal >= 150) return '#1d4ed8'; // abundant — deep water blue
      if (pctOfNormal >= 90)  return '#0284c7'; // normal — water blue
      if (pctOfNormal >= 50)  return '#d97706'; // below normal — warm ochre
      if (pctOfNormal >= 25)  return '#ea580c'; // low — terracotta
      return '#b2182b';                         // critically low — deep oxblood
    },

    _flowHealthLabel(pct) {
      if (typeof window.flowHealthLabel === 'function') {
        return window.flowHealthLabel(pct);
      }
      if (pct === null || pct === undefined) return 'Baseline';
      if (pct >= 150) return 'Abundant';
      if (pct >= 90)  return 'Normal';
      if (pct >= 50)  return 'Below Normal';
      if (pct >= 25)  return 'Low Flow';
      return 'Critically Low';
    },

    _getDateKey(rawIso) {
      if (!rawIso) return '01-01';
      const d = new Date(rawIso);
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      return `${mm}-${dd}`;
    },

    _bindUI() {
      const slider = document.getElementById('replay-scrubber-slider');
      if (slider) {
        slider.addEventListener('input', (e) => {
          this.pause();
          this.seek(parseInt(e.target.value, 10));
        });
      }
    },

    async open(targetPeriod) {
      const bar = document.getElementById('flow-replay-bar');
      const toggleBtn = document.getElementById('btn-flow-replay');
      if (!bar) return;

      bar.classList.remove('hidden');
      if (toggleBtn) toggleBtn.classList.add('active');
      this.isOpen = true;

      // Cache whether flow health was active prior to opening replay
      const flowHealthToggle = document.getElementById('toggle-flow-health');
      this.wasFlowHealthActiveBeforeReplay = flowHealthToggle ? flowHealthToggle.checked : true;

      // Ensure Flow Health layer and legend are active during replay
      if (typeof window.toggleFlowHealthLayer === 'function') {
        window.toggleFlowHealthLayer(true);
      }
      const flowHealthLegend = document.getElementById('flow-health-legend');
      if (flowHealthLegend) flowHealthLegend.style.display = 'block';

      await this._ensureNormalsLoaded();

      const period = targetPeriod || this.activePeriod || '7D';
      await this.switchPeriod(period);
    },

    async switchPeriod(period) {
      this.pause();
      this.activePeriod = period === '30D' ? '30D' : '7D';

      // Update period pill styles
      const pill7d = document.getElementById('period-pill-7d');
      const pill30d = document.getElementById('period-pill-30d');
      if (pill7d) pill7d.classList.toggle('active', this.activePeriod === '7D');
      if (pill30d) pill30d.classList.toggle('active', this.activePeriod === '30D');

      // Update slider tick labels
      const ticksWrap = document.getElementById('replay-slider-ticks');
      if (ticksWrap) {
        if (this.activePeriod === '7D') {
          ticksWrap.innerHTML = `
            <span>T - 7 Days</span>
            <span>T - 5 Days</span>
            <span>T - 3 Days</span>
            <span>T - 1 Day</span>
            <span>Live</span>
          `;
        } else {
          ticksWrap.innerHTML = `
            <span>T - 30 Days</span>
            <span>T - 20 Days</span>
            <span>T - 10 Days</span>
            <span>T - 3 Days</span>
            <span>Live</span>
          `;
        }
      }

      // Lazy load replay matrix if not cached in memory
      if (!this.datasets[this.activePeriod]) {
        this._showLoading(true);
        try {
          const file = this.activePeriod === '30D' ? './data/replay_30d.json' : './data/replay_7d.json';
          const resp = await fetch(file);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const data = await resp.json();
          this.datasets[this.activePeriod] = data;
        } catch (err) {
          console.error(`[FlowReplayEngine] Failed to load ${this.activePeriod} replay data:`, err);
          const timeDisplay = document.getElementById('replay-time-display');
          if (timeDisplay) timeDisplay.textContent = `Error loading ${this.activePeriod} matrix`;
          return;
        } finally {
          this._showLoading(false);
        }
      }

      this.data = this.datasets[this.activePeriod];
      this.totalHours = this.data.timestamps.length;

      const slider = document.getElementById('replay-scrubber-slider');
      if (slider) {
        slider.max = this.totalHours - 1;
        slider.value = 0;
      }
      this._cacheBaselines();
      this.seek(0);
    },

    close() {
      this.pause();
      const bar = document.getElementById('flow-replay-bar');
      const toggleBtn = document.getElementById('btn-flow-replay');
      if (bar) bar.classList.add('hidden');
      if (toggleBtn) toggleBtn.classList.remove('active');
      this.isOpen = false;
      this.restoreLive();

      // Revert flow health toggle state if it was off prior to replay
      if (this.wasFlowHealthActiveBeforeReplay === false) {
        if (typeof window.toggleFlowHealthLayer === 'function') {
          window.toggleFlowHealthLayer(false);
        }
        const flowHealthLegend = document.getElementById('flow-health-legend');
        if (flowHealthLegend) flowHealthLegend.style.display = 'none';
      }
    },

    toggle() {
      if (this.isOpen) {
        this.close();
      } else {
        this.open();
      }
    },

    _showLoading(isLoading) {
      const timeDisplay = document.getElementById('replay-time-display');
      if (timeDisplay && isLoading) {
        timeDisplay.textContent = `Loading ${this.activePeriod} telemetry matrix...`;
      }
    },

    _cacheBaselines() {
      if (!this.map) return;

      // Cache raw initial GeoJSON for gauges
      const gaugeSource = this.map.getSource('streamflow-gauges');
      if (gaugeSource && gaugeSource._data && !this.originalGaugesGeoJSON) {
        this.originalGaugesGeoJSON = JSON.parse(JSON.stringify(gaugeSource._data));
        this.cachedGaugesFeatures = JSON.parse(JSON.stringify(gaugeSource._data.features));
      }

      // Cache raw initial GeoJSON for reaches
      const riverSource = this.map.getSource('rivers');
      if (riverSource && riverSource._data && !this.originalReachesGeoJSON) {
        this.originalReachesGeoJSON = JSON.parse(JSON.stringify(riverSource._data));
        this.cachedReachesFeatures = JSON.parse(JSON.stringify(riverSource._data.features));
      }
    },

    restoreLive() {
      if (!this.map) return;
      if (this.originalGaugesGeoJSON) {
        const gaugeSource = this.map.getSource('streamflow-gauges');
        if (gaugeSource) gaugeSource.setData(this.originalGaugesGeoJSON);
      }
      if (this.originalReachesGeoJSON) {
        const riverSource = this.map.getSource('rivers');
        if (riverSource) riverSource.setData(this.originalReachesGeoJSON);
      }
      const slider = document.getElementById('replay-scrubber-slider');
      if (slider && this.totalHours > 0) slider.value = this.totalHours - 1;
    },

    jumpToLive() {
      this.pause();
      if (this.totalHours > 0) {
        this.seek(this.totalHours - 1);
      }
    },

    play() {
      if (this.isPlaying || !this.data) return;
      this.isPlaying = true;
      this.lastTimestamp = performance.now();
      this.accumulatedTime = 0;

      const playBtn = document.getElementById('replay-play-btn');
      if (playBtn) {
        playBtn.innerHTML = '⏸ Pause';
        playBtn.classList.add('playing');
      }

      const loop = (now) => {
        if (!this.isPlaying) return;
        const dt = (now - this.lastTimestamp) / 1000.0;
        this.lastTimestamp = now;

        this.accumulatedTime += dt;
        const secondsPerStep = 1.0 / this.speed;

        if (this.accumulatedTime >= secondsPerStep) {
          const stepsToAdvance = Math.floor(this.accumulatedTime / secondsPerStep);
          this.accumulatedTime -= stepsToAdvance * secondsPerStep;

          let nextIndex = this.currentIndex + stepsToAdvance;
          if (nextIndex >= this.totalHours) {
            // Loop back to start smoothly
            nextIndex = 0;
          }
          this.seek(nextIndex);
        }

        this.rafId = requestAnimationFrame(loop);
      };

      this.rafId = requestAnimationFrame(loop);
    },

    pause() {
      this.isPlaying = false;
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      const playBtn = document.getElementById('replay-play-btn');
      if (playBtn) {
        playBtn.innerHTML = '▶ Play';
        playBtn.classList.remove('playing');
      }
    },

    togglePlay() {
      if (this.isPlaying) {
        this.pause();
      } else {
        this.play();
      }
    },

    setSpeed(newSpeed) {
      this.speed = Number(newSpeed) || 1;
      ['1', '4', '12'].forEach(s => {
        const pill = document.getElementById(`speed-pill-${s}`);
        if (pill) {
          if (Number(s) === this.speed) {
            pill.classList.add('active');
          } else {
            pill.classList.remove('active');
          }
        }
      });
    },

    step(deltaSteps) {
      this.pause();
      if (!this.data || this.totalHours === 0) return;
      let nextIndex = this.currentIndex + deltaSteps;
      if (nextIndex < 0) nextIndex = 0;
      if (nextIndex >= this.totalHours) nextIndex = this.totalHours - 1;
      this.seek(nextIndex);
    },

    onSliderInput(valStr) {
      this.pause();
      this.seek(parseInt(valStr, 10));
    },

    seek(index) {
      if (!this.data || this.totalHours === 0) return;
      this.currentIndex = Math.max(0, Math.min(this.totalHours - 1, index));

      // 1. Update UI Elements
      this._updateUIHeader(this.currentIndex);

      // 2. Update Map Canvas Layers (60 FPS Vector Mutations)
      this._updateMapLayers(this.currentIndex);
    },

    _updateUIHeader(index) {
      const rawIso = this.data.timestamps[index];
      if (!rawIso) return;

      const dateObj = new Date(rawIso);
      const timeDisplay = document.getElementById('replay-time-display');
      const relTimeDisplay = document.getElementById('replay-rel-time');
      const slider = document.getElementById('replay-scrubber-slider');

      if (slider && parseInt(slider.value, 10) !== index) {
        slider.value = index;
      }

      // Format Mountain Time: 'Wed, Nov 11, 05:00 AM MST'
      if (timeDisplay) {
        const options = {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'America/Denver',
          timeZoneName: 'short'
        };
        timeDisplay.textContent = dateObj.toLocaleString('en-US', options);
      }

      // Format Relative Time: T - Xd Yh
      if (relTimeDisplay) {
        const stepsFromLatest = (this.totalHours - 1) - index;
        if (stepsFromLatest === 0) {
          relTimeDisplay.textContent = 'Current Snapshot (Live)';
          relTimeDisplay.style.color = '#0284c7';
        } else {
          const stepMultiplier = this.activePeriod === '30D' ? 2 : 1;
          const totalHours = stepsFromLatest * stepMultiplier;
          const days = Math.floor(totalHours / 24);
          const hours = totalHours % 24;
          const str = days > 0 ? `T - ${days}d ${hours}h` : `T - ${hours}h`;
          relTimeDisplay.textContent = str;
          relTimeDisplay.style.color = '#64748b';
        }
      }

      // Update Sentinel Flow Readouts in Scrubber Strip
      this._updateSentinelReadouts(index);
    },

    _updateSentinelReadouts(index) {
      const stations = this.data.stations;
      if (!stations) return;

      // San Juan River at Mexican Hat (Inflow to Powell)
      const sjEl = document.getElementById('replay-sanjuan-flow');
      if (sjEl && stations[this.SENTINELS.SAN_JUAN]) {
        const val = stations[this.SENTINELS.SAN_JUAN][index];
        sjEl.textContent = val != null ? Math.round(val).toLocaleString() : '--';
      }

      // Lees Ferry (Powell Outflow)
      const lfEl = document.getElementById('replay-lees-flow');
      if (lfEl && stations[this.SENTINELS.LEES_FERRY]) {
        const val = stations[this.SENTINELS.LEES_FERRY][index];
        lfEl.textContent = val != null ? Math.round(val).toLocaleString() : '--';
      }

      // Gila River at Dome (Lower Basin)
      const gilaEl = document.getElementById('replay-gila-flow');
      if (gilaEl && stations[this.SENTINELS.GILA_DOME]) {
        const val = stations[this.SENTINELS.GILA_DOME][index];
        gilaEl.textContent = val != null ? Math.round(val).toLocaleString() : '--';
      }
    },

    _updateMapLayers(index) {
      if (!this.map || !this.data) return;
      const stations = this.data.stations;
      const rawIso = this.data.timestamps[index];
      const dateKey = this._getDateKey(rawIso);

      // 1. Update Streamflow Gauges GeoJSON
      if (this.cachedGaugesFeatures) {
        const updatedFeatures = this.cachedGaugesFeatures.map(feat => {
          const sid = feat.properties.id;
          const flowSeries = stations[sid];
          if (flowSeries) {
            const flow = flowSeries[index];
            
            // Dynamic Radius via sqrt(Q) formula
            const radius = flow != null && flow > 0
              ? Math.max(3.5, Math.min(22.0, 3.5 + Math.sqrt(flow) * 0.088))
              : 3.5;

            // Historical normal and flow health percentage
            const norm = this._getHistoricalNormal(sid, dateKey);
            let pct = null;
            let healthColor = '#0284c7';
            let healthLabel = 'Normal';

            if (norm && norm > 0 && flow != null) {
              pct = Math.round((flow / norm) * 100);
              healthColor = this._flowHealthColor(pct);
              healthLabel = this._flowHealthLabel(pct);
            }

            return {
              ...feat,
              properties: {
                ...feat.properties,
                flow_cfs: flow,
                circle_radius: Math.round(radius * 10) / 10,
                casing_radius: Math.round((radius + 1.8) * 10) / 10,
                circle_color: feat.properties.station_type === 'streamflow' ? healthColor : (feat.properties.circle_color || undefined),
                health_pct: pct,
                health_color: healthColor,
                health_label: healthLabel,
                hist_normal_cfs: norm,
                is_replay_active: true
              }
            };
          }
          return feat;
        });

        const gaugeSource = this.map.getSource('streamflow-gauges');
        if (gaugeSource) {
          gaugeSource.setData({
            type: 'FeatureCollection',
            features: updatedFeatures
          });
        }
      }

      // 2. Update River Reaches GeoJSON
      if (this.cachedReachesFeatures) {
        const updatedReaches = this.cachedReachesFeatures.map(reach => {
          const gid = reach.properties.gauge_id;
          const flowSeries = gid ? stations[gid] : null;
          let flow = reach.properties.flow_cfs;
          if (flowSeries && flowSeries[index] !== undefined && flowSeries[index] !== null) {
            flow = flowSeries[index];
          }

          const cat = reach.properties.category || 'mainstem';
          const rType = reach.properties.reach_type;
          const rName = reach.properties.reach || '';

          // Recompute reach weight via sqrt(Q) hydrologic formula
          let weight = 2.4;
          if (flow && flow > 0) {
            if (cat === 'mainstem') {
              weight = Math.min(13.0, Math.max(4.4, 3.2 + Math.sqrt(flow) * 0.085));
            } else if (cat === 'major_tributary') {
              weight = Math.min(8.5, Math.max(3.2, 2.4 + Math.sqrt(flow) * 0.07));
            } else {
              weight = Math.min(5.0, Math.max(2.4, 1.8 + Math.sqrt(flow) * 0.055));
            }
          }

          // Recompute health color & percentage dynamically
          let norm = null;
          let pct = null;
          let healthColor = '#0284c7';
          let healthLabel = 'Baseline';

          if (rType === 'submerged_path' || rName.endsWith('_submerged_path')) {
            weight = 1.8;
            healthColor = '#0369a1';
            healthLabel = 'Submerged Reservoir Thalweg';
          } else if (rType === 'canal' || rName === 'div_canal_alimentador_central') {
            healthColor = '#0284c7';
            healthLabel = '1944 Treaty Delivery';
          } else if (flow === 0 && (rName.includes('delta') || rName.includes('dry'))) {
            weight = 2.0;
            healthColor = '#94a3b8';
            healthLabel = 'Dry Riverbed';
          } else {
            if (gid) {
              norm = this._getHistoricalNormal(gid, dateKey);
            }
            if (norm && norm > 0 && flow != null) {
              pct = Math.round((flow / norm) * 100);
              healthColor = this._flowHealthColor(pct);
              healthLabel = this._flowHealthLabel(pct);
            } else {
              healthColor = '#0284c7';
              healthLabel = 'Normal';
            }
          }

          return {
            ...reach,
            properties: {
              ...reach.properties,
              flow_cfs: flow,
              weight: Math.round(weight * 10) / 10,
              health_color: healthColor,
              health_pct: pct,
              health_label: healthLabel,
              hist_normal_cfs: norm,
              is_replay_active: true
            }
          };
        });

        const riverSource = this.map.getSource('rivers');
        if (riverSource) {
          riverSource.setData({
            type: 'FeatureCollection',
            features: updatedReaches
          });
        }
      }
    }
  };

  // Expose globally
  window.FlowReplayEngine = FlowReplayEngine;

})(window);
