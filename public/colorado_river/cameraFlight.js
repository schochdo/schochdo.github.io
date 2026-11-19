/**
 * 60 FPS Game-Engine Style 3D Flight & Pan Camera Subsystem
 * for MapLibre GL JS / Mapbox GL JS (Production Engine)
 *
 * Implements:
 * 1. Camera Finite State Machine (FSM): 'idle', 'flight', 'flyto', 'inspect'
 *    with immediate manual preemption on keydown, pointer/touch, or zoom button click.
 * 2. Safe Navigation Wrappers: safeFlyTo & safeEaseTo with coordinate guards,
 *    ground-clamping enforcement, and progressive pitch ceiling enforcement.
 * 3. 60 FPS requestAnimationFrame Keyboard Cruising:
 *    - Arrows: Horizontal ground plane flight along bearing vector
 *    - WASD: Pitch tilt & Azimuth heading rotation
 *    - Q/E or PageUp/PageDown: True vertical helicopter altitude elevator (no lateral drift)
 *    - +/- or Z/X: Line-of-sight zoom
 *    - Shift: 2.5x Sprint Multiplier
 *    - 0.6s Predictive Lookahead obstacle clearance floor (MIN_CAMERA_CLEARANCE = 25m)
 *    - Smooth terrain settlement on key release without calling private elevation APIs.
 * 4. Trackpad & Mouse Wheel Controller:
 *    - Ctrl+wheel: Chromium pinch guard
 *    - Shift+wheel: Direct 3D pitch tilt
 *    - Alt+wheel: Direct azimuth rotation
 *    - Safari gesture double-zoom prevention watchdog
 * 5. Tablet & Mobile Two-Finger Touch Arbiter:
 *    - 12px deadzone separating pitch vs zoom-rotate
 *    - 120ms single-finger pan suppression on touch exit
 *    - Accurate MacBook trackpad vs iOS touchscreen disambiguation
 * 6. Continuous Progressive Pitch Ceiling: maxAllowedPitch = (zoom - 3.5) * 18
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    var exports = factory();
    root.CameraStateMachine = exports.CameraStateMachine;
    root.safeFlyTo = exports.safeFlyTo;
    root.safeEaseTo = exports.safeEaseTo;
    root.enforceTerrainClearance = exports.enforceTerrainClearance;
    root.initKeyboardFlight = exports.initKeyboardFlight;
    root.useKeyboardFlight = exports.useKeyboardFlight;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Disambiguate iOS touchscreen devices from MacBooks with trackpads (Pitfall 3)
  var isIosDevice = typeof navigator !== 'undefined' && (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1 && typeof document !== 'undefined' && 'ontouchend' in document)
  );

  var NAVIGATION_KEY_SET = new Set([
    'KeyW', 'KeyA', 'KeyS', 'KeyD',
    'KeyQ', 'KeyE', 'PageUp', 'PageDown',
    'KeyZ', 'KeyX', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'
  ]);

  function getNavigationCode(e) {
    if (NAVIGATION_KEY_SET.has(e.code)) return e.code;
    var k = e.key;
    if (k === 'w' || k === 'W') return 'KeyW';
    if (k === 's' || k === 'S') return 'KeyS';
    if (k === 'a' || k === 'A') return 'KeyA';
    if (k === 'd' || k === 'D') return 'KeyD';
    if (k === 'q' || k === 'Q') return 'KeyQ';
    if (k === 'e' || k === 'E') return 'KeyE';
    if (k === 'z' || k === 'Z') return 'KeyZ';
    if (k === 'x' || k === 'X') return 'KeyX';
    if (k === '+' || k === '=') return 'Equal';
    if (k === '-' || k === '_') return 'Minus';
    if (k === 'ArrowUp') return 'ArrowUp';
    if (k === 'ArrowDown') return 'ArrowDown';
    if (k === 'ArrowLeft') return 'ArrowLeft';
    if (k === 'ArrowRight') return 'ArrowRight';
    if (k === 'PageUp') return 'PageUp';
    if (k === 'PageDown') return 'PageDown';
    return null;
  }

  var CAMERA_CONSTANTS = {
    MIN_CAMERA_CLEARANCE_METERS: 35.0, // Ground collision floor (Pitfall 5)
    MIN_ZOOM_CLEARANCE_METERS: 35.0,
    LOOKAHEAD_SECONDS: 0.6, // 0.6-second predictive lookahead
    MIN_PITCH_DEG: 0,
    MAX_PITCH_DEG: 82,
    BASE_SPEED_MPS: 720, // Cruising speed at zoom 14
    PITCH_SPEED_DEG_PER_SEC: 36, // 72 deg/s with Shift
    BEARING_SPEED_DEG_PER_SEC: 42, // 84 deg/s with Shift
    ZOOM_SPEED_PER_SEC: 1.5,
    ALTITUDE_SPEED_PER_SEC: 0.75,
    METERS_PER_DEG_LAT: 111320
  };

  function normalizeBearing(bearing) {
    var mod = bearing % 360;
    return mod < 0 ? mod + 360 : mod;
  }

  // Section 6: Continuous Pitch Ceiling
  function getMaxAllowedPitch(zoom) {
    if (zoom === undefined || zoom === null || !isFinite(zoom)) return 82;
    // Allow full 3D terrain tilt (up to 82°) across all operational basin zoom levels
    // Clamps gracefully only at extreme global view (zoom < 2.0)
    return zoom < 2.0 ? 60 : 82;
  }

  function clampPitch(pitch, zoom) {
    var maxPitch = getMaxAllowedPitch(zoom);
    return Math.max(CAMERA_CONSTANTS.MIN_PITCH_DEG, Math.min(maxPitch, pitch));
  }

  function isInputElementFocused() {
    if (typeof document === 'undefined') return false;
    var el = document.activeElement;
    if (!el) return false;
    var tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  /**
   * SECTION 1: CAMERA FINITE STATE MACHINE (FSM)
   * Coordinates modes: 'idle', 'flight', 'flyto', 'inspect'
   */
  var CameraStateMachine = (function () {
    var currentMode = 'idle';
    var listeners = new Set();

    return {
      getMode: function () {
        return currentMode;
      },
      setMode: function (nextMode) {
        if (currentMode === nextMode) return;
        var prevMode = currentMode;
        currentMode = nextMode;
        listeners.forEach(function (fn) {
          try { fn(currentMode, prevMode); } catch (_) {}
        });
      },
      onModeChange: function (listener) {
        listeners.add(listener);
        return function () { listeners.delete(listener); };
      },
      cancelProgrammaticFlight: function (mapInstance) {
        if (currentMode === 'flyto') {
          if (mapInstance && typeof mapInstance.stop === 'function') {
            try { mapInstance.stop(); } catch (_) {}
          }
          var prev = currentMode;
          currentMode = 'idle';
          listeners.forEach(function (fn) {
            try { fn('idle', prev); } catch (_) {}
          });
        }
      }
    };
  })();

  function validateCenterCoords(center) {
    if (!center) return true;
    var lng, lat;
    if (Array.isArray(center)) {
      lng = center[0];
      lat = center[1];
    } else if (typeof center === 'object') {
      lng = center.lng !== undefined ? center.lng : center.lon;
      lat = center.lat;
    }
    if (lng === undefined || lat === undefined) return false;
    return isFinite(lng) && isFinite(lat) && !isNaN(lng) && !isNaN(lat);
  }

  /**
   * Enforces terrain collision safety floor without camera bobbing.
   * If the ground directly beneath the camera rises within
   * MIN_CAMERA_CLEARANCE_METERS of current camera altitude, ratchets
   * transform.elevation upward to safely clear the obstacle.
   * When terrain drops (valleys/canyons), elevation is held constant.
   */
  function enforceTerrainClearance(mapInstance) {
    if (!mapInstance || typeof mapInstance.getTerrain !== 'function' || !mapInstance.getTerrain() || mapInstance.getPitch() <= 5) return;
    var tr = (mapInstance._camera && mapInstance._camera.transform) || mapInstance.transform;
    if (!tr) return;

    var camPos = tr.getCameraPosition ? tr.getCameraPosition() : null;
    if (!camPos || !camPos.lngLat || !isFinite(camPos.altitude)) return;

    var groundUnderCam = mapInstance.queryTerrainElevation ? mapInstance.queryTerrainElevation(camPos.lngLat) : null;
    if (groundUnderCam === null || groundUnderCam === undefined || !isFinite(groundUnderCam)) return;

    var minClearance = CAMERA_CONSTANTS.MIN_CAMERA_CLEARANCE_METERS;
    var requiredAlt = groundUnderCam + minClearance;
    if (requiredAlt > camPos.altitude) {
      var deltaH = requiredAlt - camPos.altitude;
      tr.elevation = (tr.elevation || 0) + deltaH;
      if (typeof mapInstance.triggerRepaint === 'function') {
        mapInstance.triggerRepaint();
      }
    }
  }

  /**
   * SECTION 1.2: SAFE NAVIGATION WRAPPERS
   * safeFlyTo & safeEaseTo with coordinate validation, ground clamping,
   * FSM state tracking, and progressive pitch ceiling enforcement.
   */
  function safeFlyTo(mapInstance, options) {
    if (!mapInstance) return;
    options = options ? Object.assign({}, options) : {};

    if (options.center && !validateCenterCoords(options.center)) {
      console.warn('[safeFlyTo] Aborting: target coordinates are invalid or non-finite:', options.center);
      return mapInstance;
    }

    CameraStateMachine.cancelProgrammaticFlight(mapInstance);

    var targetZoom = options.zoom !== undefined ? options.zoom : mapInstance.getZoom();
    var maxPitch = getMaxAllowedPitch(targetZoom);
    if (options.pitch !== undefined && options.pitch > maxPitch) {
      options.pitch = maxPitch;
    }

    if (typeof mapInstance.setCenterClampedToGround === 'function') {
      try { mapInstance.setCenterClampedToGround(true); } catch (_) {}
    }

    CameraStateMachine.setMode('flyto');
    var onEnd = function () {
      if (CameraStateMachine.getMode() === 'flyto') {
        CameraStateMachine.setMode('idle');
      }
      if (mapInstance && typeof mapInstance.getPitch === 'function' && mapInstance.getPitch() > 5 && mapInstance.getTerrain && mapInstance.getTerrain()) {
        mapInstance._elevationFreeze = true;
        enforceTerrainClearance(mapInstance);
      }
    };
    mapInstance.once('moveend', onEnd);

    var rawFly = mapInstance._rawFlyTo || mapInstance.flyTo;
    return rawFly.call(mapInstance, options);
  }

  function safeEaseTo(mapInstance, options) {
    if (!mapInstance) return;
    options = options ? Object.assign({}, options) : {};

    // Do not interfere with MapLibre's internal inertial kinetic panning deceleration
    var isInternalInertia = options.noMoveStart || (mapInstance.isDragging && mapInstance.isDragging());

    if (options.center && !validateCenterCoords(options.center)) {
      console.warn('[safeEaseTo] Aborting: target coordinates are invalid or non-finite:', options.center);
      return mapInstance;
    }

    if (!isInternalInertia) {
      CameraStateMachine.cancelProgrammaticFlight(mapInstance);
    }

    var targetZoom = options.zoom !== undefined ? options.zoom : mapInstance.getZoom();
    var maxPitch = getMaxAllowedPitch(targetZoom);
    if (options.pitch !== undefined && options.pitch > maxPitch) {
      options.pitch = maxPitch;
    }

    if (typeof mapInstance.setCenterClampedToGround === 'function') {
      try { mapInstance.setCenterClampedToGround(true); } catch (_) {}
    }

    if (!isInternalInertia && CameraStateMachine.getMode() !== 'inspect') {
      CameraStateMachine.setMode('flyto');
      var onEnd = function () {
        if (CameraStateMachine.getMode() === 'flyto') {
          CameraStateMachine.setMode('idle');
        }
        if (mapInstance && typeof mapInstance.getPitch === 'function' && mapInstance.getPitch() > 5 && mapInstance.getTerrain && mapInstance.getTerrain()) {
          mapInstance._elevationFreeze = true;
          enforceTerrainClearance(mapInstance);
        }
      };
      mapInstance.once('moveend', onEnd);
    }

    var rawEase = mapInstance._rawEaseTo || mapInstance.easeTo;
    return rawEase.call(mapInstance, options);
  }

  /**
   * Universal camera state extractor compatible with MapLibre GL JS v2–v4 & Mapbox GL JS.
   */
  function getCameraInfo(map) {
    if (!map) return null;
    var tr = (map._camera && map._camera.transform) || map.transform;
    if (!tr) return null;

    var camLngLat = null;
    var altitude = null;

    if (tr.getCameraPosition) {
      try {
        var pos = tr.getCameraPosition();
        if (pos) {
          camLngLat = pos.lngLat;
          altitude = pos.altitude;
        }
      } catch (_) {}
    } else if (tr.getCameraLngLat && tr.getCameraAltitude) {
      try {
        camLngLat = tr.getCameraLngLat();
        altitude = tr.getCameraAltitude();
      } catch (_) {}
    }

    var pitch = map.getPitch();
    var bearing = map.getBearing();
    var zoom = map.getZoom();
    var center = map.getCenter();
    var groundElevation = 0;

    if (tr._elevation !== undefined && tr._elevation !== null && isFinite(tr._elevation)) {
      groundElevation = tr._elevation;
    } else if (map.queryTerrainElevation) {
      groundElevation = map.queryTerrainElevation(center) || 0;
    }

    if (altitude === null || altitude === undefined || !isFinite(altitude)) {
      var pitchRad = (pitch * Math.PI) / 180;
      var distPx = tr.cameraToCenterDistance ||
        (tr.height ? tr.height / (2 * Math.tan((tr._fov || 0.64) / 2)) : 600);
      var ppm = tr._pixelPerMeter ||
        (Math.pow(2, zoom) * 256 / (2 * Math.PI * 6378137 * Math.cos((center.lat * Math.PI) / 180)));
      altitude = groundElevation + (Math.cos(pitchRad) * distPx) / ppm;
    }

    if (!camLngLat) {
      var pitchRad2 = (pitch * Math.PI) / 180;
      var bearingRad2 = (bearing * Math.PI) / 180;
      var deltaZ = Math.max(10, altitude - groundElevation);
      var horizDistMeters = deltaZ * Math.tan(pitchRad2);
      var metersPerDegLat = CAMERA_CONSTANTS.METERS_PER_DEG_LAT;
      var metersPerDegLng = metersPerDegLat * Math.max(0.1, Math.cos((center.lat * Math.PI) / 180));
      camLngLat = {
        lng: center.lng - (horizDistMeters * Math.sin(bearingRad2)) / metersPerDegLng,
        lat: center.lat - (horizDistMeters * Math.cos(bearingRad2)) / metersPerDegLat
      };
    }

    return {
      tr: tr,
      camLngLat: camLngLat,
      altitude: altitude,
      groundElevation: groundElevation,
      pitch: pitch,
      bearing: bearing,
      zoom: zoom,
      center: center
    };
  }

  function adjustZoomForTargetAltitude(map, targetAltitude) {
    if (!map || targetAltitude === null || targetAltitude === undefined || !isFinite(targetAltitude)) return;
    var info = getCameraInfo(map);
    if (!info) return;

    var curAlt = info.altitude;
    var curGround = info.groundElevation;
    var minClearance = CAMERA_CONSTANTS.MIN_CAMERA_CLEARANCE_METERS;
    var deltaZ_cur = Math.max(minClearance, curAlt - curGround);
    var deltaZ_target = Math.max(minClearance, targetAltitude - curGround);

    if (Math.abs(deltaZ_cur - deltaZ_target) > 0.4) {
      var rawOffset = Math.log2(deltaZ_cur / deltaZ_target);
      var clampedOffset = Math.max(-0.6, Math.min(0.6, rawOffset));
      var nextZoom = Math.max(1.0, Math.min(22.0, map.getZoom() + clampedOffset));
      map.setZoom(nextZoom);
    }
  }

  function computeGeographicDisplacement(center, bearingDeg, moveForward, moveStrafe, speedMps, dt) {
    var len = Math.hypot(moveForward, moveStrafe);
    if (len === 0) {
      return { deltaLat: 0, deltaLng: 0, nextLat: center.lat, nextLng: center.lng };
    }
    var normForward = moveForward / len;
    var normStrafe = moveStrafe / len;
    var bearingRad = (bearingDeg * Math.PI) / 180;
    var distMeters = speedMps * dt;
    var sinB = Math.sin(bearingRad);
    var cosB = Math.cos(bearingRad);
    var deltaEastMeters = (sinB * normForward + cosB * normStrafe) * distMeters;
    var deltaNorthMeters = (cosB * normForward - sinB * normStrafe) * distMeters;
    var latRad = (center.lat * Math.PI) / 180;
    var metersPerDegLat = CAMERA_CONSTANTS.METERS_PER_DEG_LAT;
    var metersPerDegLng = metersPerDegLat * Math.max(0.1, Math.cos(latRad));
    var deltaLat = deltaNorthMeters / metersPerDegLat;
    var deltaLng = deltaEastMeters / metersPerDegLng;
    var nextLat = Math.max(-85, Math.min(85, center.lat + deltaLat));
    var nextLng = center.lng + deltaLng;
    return {
      deltaLat: deltaLat,
      deltaLng: deltaLng,
      nextLat: nextLat,
      nextLng: nextLng,
      normForward: normForward,
      normStrafe: normStrafe
    };
  }

  function sampleTerrainObstacle(map, camLng, camLat, lookaheadLng, lookaheadLat) {
    var groundCam = map.queryTerrainElevation ? map.queryTerrainElevation([camLng, camLat]) : 0;
    var groundAheadCam = map.queryTerrainElevation ? map.queryTerrainElevation([lookaheadLng, lookaheadLat]) : 0;
    var maxGround = -Infinity;
    if (groundCam !== null && groundCam !== undefined && isFinite(groundCam)) {
      maxGround = Math.max(maxGround, groundCam);
    }
    if (groundAheadCam !== null && groundAheadCam !== undefined && isFinite(groundAheadCam)) {
      maxGround = Math.max(maxGround, groundAheadCam);
    }
    return maxGround === -Infinity ? 0 : maxGround;
  }

  /**
   * SECTION 2: THE 60 FPS KEYBOARD FLIGHT ENGINE
   */
  function initKeyboardFlight(map, options) {
    if (!map) return function () {};
    options = options || {};

    // Safeguard native flyTo and easeTo methods with our safe wrappers
    if (!map._cameraFlightPatched) {
      map._rawFlyTo = map.flyTo;
      map._rawEaseTo = map.easeTo;
      map.flyTo = function (opts) {
        return safeFlyTo(map, opts);
      };
      map.easeTo = function (opts) {
        return safeEaseTo(map, opts);
      };
      map.safeFlyTo = function (opts) {
        return safeFlyTo(map, opts);
      };
      map.safeEaseTo = function (opts) {
        return safeEaseTo(map, opts);
      };
      map._cameraFlightPatched = true;
    }

    // Disable MapLibre default 2D stepping controls
    try {
      if (map.keyboard && map.keyboard.disable) {
        map.keyboard.disable();
      }
    } catch (_) {}

    // Disable built-in touchPitch to prevent accidental tilt during pinch-zoom
    try {
      if (map.touchPitch && map.touchPitch.disable) {
        map.touchPitch.disable();
      }
    } catch (_) {}

    var activeKeys = new Set();
    var animationFrameId = null;
    var lastTimestamp = null;
    var heldFlightAltitude = null;
    var mouseDragTargetAltitude = null;
    var isAdjustingZoom = false;

    // Pitfall 1: On flight stop, simply clear held altitude.
    // NEVER invoke private MapLibre methods like releaseElevation() or putCenterBackOnTerrain().
    function stopFlight(_immediate) {
      activeKeys.clear();
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      lastTimestamp = null;
      heldFlightAltitude = null;
      if (CameraStateMachine.getMode() === 'flight') {
        CameraStateMachine.setMode('idle');
      }
      if (options.onModeChange) options.onModeChange('idle');
    }

    function flightStep(timestamp) {
      if (!map) {
        stopFlight(true);
        return;
      }

      if (lastTimestamp === null) lastTimestamp = timestamp;
      var dt = Math.min((timestamp - lastTimestamp) / 1000, 0.08);
      lastTimestamp = timestamp;

      var hasNavKey = false;
      activeKeys.forEach(function (k) {
        if (NAVIGATION_KEY_SET.has(k)) hasNavKey = true;
      });

      if (!hasNavKey) {
        stopFlight(false);
        return;
      }

      var info = getCameraInfo(map);
      if (!info) {
        animationFrameId = requestAnimationFrame(flightStep);
        return;
      }

      if (heldFlightAltitude === null) {
        heldFlightAltitude = info.altitude;
      }

      var isShift = activeKeys.has('ShiftLeft') || activeKeys.has('ShiftRight');
      var pitchDelta = 0;
      var rotateBearing = 0;
      var zoomDelta = 0;
      var moveForward = 0;
      var moveStrafe = 0;
      var altitudeDelta = 0;

      // WASD: Pitch & Yaw Gaze Orientation
      if (activeKeys.has('KeyW')) pitchDelta += 1;
      if (activeKeys.has('KeyS')) pitchDelta -= 1;
      if (activeKeys.has('KeyA')) rotateBearing -= 1;
      if (activeKeys.has('KeyD')) rotateBearing += 1;

      // Q / E: Vertical Altitude Elevator
      if (activeKeys.has('KeyE') || activeKeys.has('PageUp')) altitudeDelta += 1;
      if (activeKeys.has('KeyQ') || activeKeys.has('PageDown')) altitudeDelta -= 1;

      // Arrow Keys: Ground Plane Vector Flight
      if (activeKeys.has('ArrowUp')) moveForward += 1;
      if (activeKeys.has('ArrowDown')) moveForward -= 1;
      if (activeKeys.has('ArrowRight')) moveStrafe += 1;
      if (activeKeys.has('ArrowLeft')) moveStrafe -= 1;

      // Zoom
      if (activeKeys.has('Equal') || activeKeys.has('NumpadAdd') || activeKeys.has('KeyZ')) zoomDelta += 1;
      if (activeKeys.has('Minus') || activeKeys.has('NumpadSubtract') || activeKeys.has('KeyX')) zoomDelta -= 1;

      // 1. Pitch Tilt (W / S): PITCH_SPEED = 36 deg/s (72 deg/s with Shift)
      if (pitchDelta !== 0) {
        var curPitch = map.getPitch();
        var curZoom = map.getZoom();
        var pitchSpeed = isShift ? 72 : CAMERA_CONSTANTS.PITCH_SPEED_DEG_PER_SEC;
        var nextPitch = clampPitch(curPitch + pitchDelta * pitchSpeed * dt, curZoom);
        map.setPitch(nextPitch);
        if (options.onPitchChange) options.onPitchChange(Math.round(nextPitch));
        var infoPitch = getCameraInfo(map);
        if (infoPitch && isFinite(infoPitch.altitude)) {
          heldFlightAltitude = infoPitch.altitude;
        }
      }

      // 2. Bearing Yaw (A / D): BEARING_SPEED = 42 deg/s (84 deg/s with Shift)
      if (rotateBearing !== 0) {
        var curBearing = map.getBearing();
        var bearingSpeed = isShift ? 84 : CAMERA_CONSTANTS.BEARING_SPEED_DEG_PER_SEC;
        var nextBearing = (curBearing + rotateBearing * bearingSpeed * dt + 360) % 360;
        map.setBearing(nextBearing);
        if (options.onBearingChange) options.onBearingChange(Math.round(nextBearing));
      }

      // 3. Line-of-sight Zoom (+ / - or Z / X)
      if (zoomDelta !== 0) {
        var curZ = map.getZoom();
        var zoomSpeed = (isShift ? 2.5 : 1.0) * CAMERA_CONSTANTS.ZOOM_SPEED_PER_SEC;
        var nextZ = Math.max(1.0, Math.min(20.5, curZ + zoomDelta * zoomSpeed * dt));

        if (zoomDelta > 0) {
          var camLngLatZ = info.camLngLat;
          var camAltZ = info.altitude;
          var groundUnderCamZ = map.queryTerrainElevation ? map.queryTerrainElevation(camLngLatZ) : null;
          if (camAltZ && groundUnderCamZ && camAltZ <= groundUnderCamZ + CAMERA_CONSTANTS.MIN_ZOOM_CLEARANCE_METERS) {
            nextZ = curZ;
          }
        }
        map.setZoom(nextZ);
        var updatedInfo = getCameraInfo(map);
        if (updatedInfo) heldFlightAltitude = updatedInfo.altitude;
      }

      var liveZoom = map.getZoom();
      var speedMps = CAMERA_CONSTANTS.BASE_SPEED_MPS * Math.pow(2, 14 - liveZoom) * (isShift ? 2.5 : 1.0);

      // 4. Vertical Altitude Elevator (Q / E or PageDown / PageUp)
      // True vertical elevator: changes altitude straight up/down without lateral drift
      if (altitudeDelta !== 0) {
        var curCamLngLat2 = info.camLngLat;
        var groundUnderCam2 = map.queryTerrainElevation ? (map.queryTerrainElevation(curCamLngLat2) || 0) : 0;
        var deltaAltMeters = altitudeDelta * (speedMps * 0.75) * dt;

        var targetCamAlt = heldFlightAltitude + deltaAltMeters;
        var minAllowedCamAlt = groundUnderCam2 + CAMERA_CONSTANTS.MIN_CAMERA_CLEARANCE_METERS;

        if (deltaAltMeters > 0 || targetCamAlt >= minAllowedCamAlt) {
          var trElev = (map._camera && map._camera.transform) || map.transform;
          if (trElev) {
            trElev.elevation = (trElev.elevation || 0) + deltaAltMeters;
            heldFlightAltitude = targetCamAlt;
            if (typeof map.triggerRepaint === 'function') map.triggerRepaint();
          }
        }
      }

      // 5. Horizontal Ground Flight (Arrow Keys) - Fixed Altitude Cruising with 0.6s Lookahead (Pitfall 5)
      var hasHorizontalMove = moveForward !== 0 || moveStrafe !== 0;
      if (hasHorizontalMove) {
        var curCenterH = map.getCenter();
        var curBearingH = map.getBearing();
        var disp = computeGeographicDisplacement(
          curCenterH,
          curBearingH,
          moveForward,
          moveStrafe,
          speedMps,
          dt
        );

        // 0.6-second predictive lookahead for terrain collision safety floor
        var lookaheadDistMeters = speedMps * CAMERA_CONSTANTS.LOOKAHEAD_SECONDS;
        var bearingRadH = (curBearingH * Math.PI) / 180;
        var sinBH = Math.sin(bearingRadH);
        var cosBH = Math.cos(bearingRadH);
        var lookEastMeters = (sinBH * disp.normForward + cosBH * disp.normStrafe) * lookaheadDistMeters;
        var lookNorthMeters = (cosBH * disp.normForward - sinBH * disp.normStrafe) * lookaheadDistMeters;
        var latRadH = (curCenterH.lat * Math.PI) / 180;
        var mPerDegLatH = CAMERA_CONSTANTS.METERS_PER_DEG_LAT;
        var mPerDegLngH = mPerDegLatH * Math.max(0.1, Math.cos(latRadH));

        var camLngLatH = info.camLngLat;
        var nextCamLat = Math.max(-85, Math.min(85, camLngLatH.lat + disp.deltaLat));
        var nextCamLng = camLngLatH.lng + disp.deltaLng;
        var lookCamLat = Math.max(-85, Math.min(85, camLngLatH.lat + lookNorthMeters / mPerDegLatH));
        var lookCamLng = camLngLatH.lng + lookEastMeters / mPerDegLngH;

        var maxGroundCam = sampleTerrainObstacle(map, nextCamLng, nextCamLat, lookCamLng, lookCamLat);
        var minAllowedAltH = maxGroundCam + CAMERA_CONSTANTS.MIN_CAMERA_CLEARANCE_METERS;

        // Ensure elevation freeze is active so MapLibre does not track terrain under center
        map._elevationFreeze = true;

        if (minAllowedAltH > heldFlightAltitude) {
          var deltaElev = minAllowedAltH - heldFlightAltitude;
          heldFlightAltitude = minAllowedAltH;
          var trH = (map._camera && map._camera.transform) || map.transform;
          if (trH) {
            trH.elevation = (trH.elevation || 0) + deltaElev;
          }
        }

        map.jumpTo({ center: [disp.nextLng, disp.nextLat] });
      }

      try {
        var currentCam = getCameraInfo(map);
        if (currentCam && isFinite(currentCam.altitude) && options.onAltitudeChange) {
          options.onAltitudeChange(currentCam.altitude);
        }
      } catch (_) {}

      animationFrameId = requestAnimationFrame(flightStep);
    }

    function handleKeyDown(e) {
      if (isInputElementFocused()) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      var navCode = getNavigationCode(e);
      if (navCode) {
        e.preventDefault();

        // Critical Rule 1: Manual Preemption aborts any running flyTo / easeTo
        CameraStateMachine.cancelProgrammaticFlight(map);

        activeKeys.add(navCode);
        if (e.shiftKey) activeKeys.add('ShiftLeft');

        CameraStateMachine.setMode('flight');
        if (options.onModeChange) options.onModeChange('flight');

        if (animationFrameId === null) {
          lastTimestamp = performance.now();
          var initialInfo = getCameraInfo(map);
          if (initialInfo) heldFlightAltitude = initialInfo.altitude;
          animationFrameId = requestAnimationFrame(flightStep);
        }
      }
    }

    function handleKeyUp(e) {
      var navCode = getNavigationCode(e);
      if (navCode) activeKeys.delete(navCode);
      activeKeys.delete(e.code);
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || !e.shiftKey) {
        activeKeys.delete('ShiftLeft');
        activeKeys.delete('ShiftRight');
      }

      var hasNavKey = false;
      activeKeys.forEach(function (k) {
        if (NAVIGATION_KEY_SET.has(k)) hasNavKey = true;
      });

      if (!hasNavKey && animationFrameId !== null) {
        stopFlight(false);
      }
    }

    function stopFlightOnBlur() {
      stopFlight(true);
    }

    function onPanStart() {
      if (map.getPitch() > 5 && map.getTerrain && map.getTerrain()) {
        map._elevationFreeze = true;
        enforceTerrainClearance(map);
      }
      if (CameraStateMachine.getMode() === 'flyto') {
        CameraStateMachine.cancelProgrammaticFlight(map);
      }
      if (animationFrameId !== null || activeKeys.size > 0) {
        stopFlight(true);
      }
    }

    function onPanMove() {
      if (map.getPitch() > 5 && map.getTerrain && map.getTerrain()) {
        map._elevationFreeze = true;
        enforceTerrainClearance(map);
      }
    }

    function onPanEnd() {
      if (map.getPitch() > 5 && map.getTerrain && map.getTerrain()) {
        map._elevationFreeze = true;
        enforceTerrainClearance(map);
      }
      enforceProgressivePitch();
    }

    // SECTION 6 & PITFALL 4: Guard synchronous pitch corrections inside moveend and zoom
    function enforceProgressivePitch() {
      if (CameraStateMachine.getMode() === 'flight') return;
      var curZoom = map.getZoom();
      var maxAllowedPitch = getMaxAllowedPitch(curZoom);
      if (map.getPitch() > maxAllowedPitch) {
        map.setPitch(maxAllowedPitch);
      }
    }

    // Enable standard gesture handlers
    try {
      if (map.touchZoomRotate && !map.touchZoomRotate.isEnabled()) map.touchZoomRotate.enable();
      if (map.dragRotate && !map.dragRotate.isEnabled()) map.dragRotate.enable();
      if (map.scrollZoom && !map.scrollZoom.isEnabled()) map.scrollZoom.enable();
      if (map.dragPan && !map.dragPan.isEnabled()) map.dragPan.enable();
    } catch (_) {}

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', stopFlightOnBlur);
    window.addEventListener('focus', stopFlightOnBlur);
    document.addEventListener('visibilitychange', stopFlightOnBlur);

    map.on('movestart', onPanStart);
    map.on('move', onPanMove);
    map.on('dragstart', onPanStart);
    map.on('drag', onPanMove);
    map.on('dragend', onPanEnd);
    map.on('moveend', onPanEnd);
    map.on('zoom', enforceProgressivePitch);

    var canvasContainer = map.getCanvasContainer ? map.getCanvasContainer() : map.getContainer();
    var mapContainer = map.getContainer ? map.getContainer() : null;

    /**
     * SECTION 4: TRACKPAD & MOUSE WHEEL CONTROLLER
     */
    function handleCanvasWheel(e) {
      CameraStateMachine.cancelProgrammaticFlight(map);

      // 1. Chromium & Safari Trackpad / Mouse Wheel Pinch (ctrlKey or metaKey)
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault(); // Prevents browser tab/page zoom, lets MapLibre scrollZoom handle smooth map zoom
        return;
      }

      // 2. Shift + Two-Finger Scroll: Direct 3D Pitch Tilt
      if (e.shiftKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        var curPitch = map.getPitch();
        var curZoom = map.getZoom();
        var rawPitch = Math.round(curPitch - e.deltaY * 0.15);
        var newPitch = clampPitch(rawPitch, curZoom);
        map.setPitch(newPitch);
        if (options.onPitchChange) options.onPitchChange(newPitch);
        return;
      }

      // 3. Option (⌥) / Alt + Two-Finger Scroll: Direct Azimuth Rotation
      if (e.altKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        var curBearing = map.getBearing();
        var rotDelta = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * 0.25;
        var newBearing = normalizeBearing(curBearing + rotDelta);
        map.setBearing(Math.round(newBearing));
        if (options.onBearingChange) options.onBearingChange(Math.round(newBearing));
        return;
      }

      if (animationFrameId !== null || activeKeys.size > 0) {
        stopFlight(true);
      }
    }

    function onPointerDownInteraction() {
      if (CameraStateMachine.getMode() === 'flyto') {
        CameraStateMachine.cancelProgrammaticFlight(map);
      }
      if (animationFrameId !== null || activeKeys.size > 0) {
        stopFlight(true);
      }
    }

    /**
     * PITFALL 2: SAFARI TRACKPAD DOUBLE-ZOOM PREVENTION
     */
    var gestureWatchdog = null;
    function restoreScrollZoom() {
      if (gestureWatchdog) {
        clearTimeout(gestureWatchdog);
        gestureWatchdog = null;
      }
      try {
        if (map.scrollZoom && !map.scrollZoom.isEnabled()) {
          map.scrollZoom.enable({ around: 'center' });
        }
      } catch (_) {}
    }

    function onGestureStart(e) {
      if (gestureWatchdog) {
        clearTimeout(gestureWatchdog);
        gestureWatchdog = null;
      }
      try {
        if (map.scrollZoom && map.scrollZoom.isEnabled()) {
          map.scrollZoom.disable();
        }
      } catch (_) {}
    }

    function onGestureChange(e) {
      if (gestureWatchdog) clearTimeout(gestureWatchdog);
      gestureWatchdog = setTimeout(restoreScrollZoom, 400);
    }

    function onGestureEnd(e) {
      restoreScrollZoom();
      gestureWatchdog = setTimeout(restoreScrollZoom, 400);
    }

    /**
     * SECTION 5: TABLET & MOBILE TWO-FINGER TOUCH ARBITER
     */
    var touchStartData = null;
    var gestureLock = null; // null | 'pitch' | 'zoom-rotate'
    var suppressPanUntil = 0;

    function handleTouchStart(e) {
      onPointerDownInteraction();

      if (e.touches.length === 2) {
        var p1 = e.touches[0];
        var p2 = e.touches[1];
        var t0_dist = Math.hypot(p2.clientX - p1.clientX, p2.clientY - p1.clientY);
        var t0_angle = (Math.atan2(p2.clientY - p1.clientY, p2.clientX - p1.clientX) * 180) / Math.PI;
        var t0_midX = (p1.clientX + p2.clientX) / 2;
        var t0_midY = (p1.clientY + p2.clientY) / 2;
        var t0_pitch = map.getPitch();
        var t0_zoom = map.getZoom();
        var t0_bearing = map.getBearing();

        gestureLock = null;
        touchStartData = {
          t0_dist: t0_dist,
          t0_angle: t0_angle,
          t0_midX: t0_midX,
          t0_midY: t0_midY,
          t0_pitch: t0_pitch,
          t0_zoom: t0_zoom,
          t0_bearing: t0_bearing
        };
      } else {
        touchStartData = null;
        gestureLock = null;
      }
    }

    function handleTouchMove(e) {
      if (e.touches.length === 1) {
        if (performance.now() < suppressPanUntil) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
        return;
      }

      if (e.touches.length !== 2 || !touchStartData) return;

      var p1 = e.touches[0];
      var p2 = e.touches[1];
      var curDist = Math.hypot(p2.clientX - p1.clientX, p2.clientY - p1.clientY);
      var curAngle = (Math.atan2(p2.clientY - p1.clientY, p2.clientX - p1.clientX) * 180) / Math.PI;
      var curMidX = (p1.clientX + p2.clientX) / 2;
      var curMidY = (p1.clientY + p2.clientY) / 2;

      var dd = curDist - touchStartData.t0_dist;
      var midDx = curMidX - touchStartData.t0_midX;
      var midDy = curMidY - touchStartData.t0_midY;
      var angleDiff = Math.abs(curAngle - touchStartData.t0_angle) % 360;
      if (angleDiff > 180) angleDiff = 360 - angleDiff;

      var totalMovement = Math.hypot(midDx, midDy) + Math.abs(dd);

      if (gestureLock === null && totalMovement > 12) {
        if (Math.abs(midDy) > 1.5 * Math.abs(dd) && angleDiff < 8) {
          gestureLock = 'pitch';
          try {
            if (map.touchZoomRotate) map.touchZoomRotate.disable();
          } catch (_) {}
        } else {
          gestureLock = 'zoom-rotate';
        }
      }

      if (gestureLock === 'pitch') {
        e.preventDefault();
        e.stopImmediatePropagation();
        var nextPitch = clampPitch(touchStartData.t0_pitch - midDy * 0.4, map.getZoom());
        map.setPitch(nextPitch);
        if (options.onPitchChange) options.onPitchChange(Math.round(nextPitch));
      } else if (gestureLock === 'zoom-rotate') {
        if (curDist > 0 && touchStartData.t0_dist > 0) {
          var nextZoom = Math.max(1.0, Math.min(20.5, touchStartData.t0_zoom + Math.log2(curDist / touchStartData.t0_dist)));
          map.setZoom(nextZoom);
        }
        if (angleDiff > 6) {
          var rotDelta = curAngle - touchStartData.t0_angle;
          var nextBearing = normalizeBearing(touchStartData.t0_bearing - rotDelta);
          map.setBearing(Math.round(nextBearing));
          if (options.onBearingChange) options.onBearingChange(Math.round(nextBearing));
        }
      }
    }

    function handleTouchEnd(e) {
      if (touchStartData && e.touches.length < 2) {
        suppressPanUntil = performance.now() + 120;
        try {
          if (map.dragPan) {
            map.dragPan.disable();
            setTimeout(function () {
              try {
                if (map.dragPan && !map.dragPan.isEnabled()) map.dragPan.enable();
              } catch (_) {}
            }, 120);
          }
        } catch (_) {}

        if (gestureLock === 'pitch') {
          try {
            if (map.touchZoomRotate) {
              map.touchZoomRotate.enable();
              if (map.touchZoomRotate.disableRotation) map.touchZoomRotate.disableRotation();
            }
          } catch (_) {}
        }
        gestureLock = null;
        touchStartData = null;
      }
    }

    /**
     * SECTION 1.3: UI ZOOM BUTTON INTERCEPTOR
     * Intercepts '+' and '-' buttons to cancel flight and use safeEaseTo
     */
    function handleZoomButtonDelegation(e) {
      var inBtn = e.target.closest && e.target.closest('.maplibregl-ctrl-zoom-in');
      var outBtn = e.target.closest && e.target.closest('.maplibregl-ctrl-zoom-out');
      if (inBtn) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        CameraStateMachine.cancelProgrammaticFlight(map);
        var curZ = map.getZoom();
        safeEaseTo(map, {
          zoom: curZ + 1,
          duration: 250,
          freezeElevation: true
        });
      } else if (outBtn) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        CameraStateMachine.cancelProgrammaticFlight(map);
        var curZ2 = map.getZoom();
        safeEaseTo(map, {
          zoom: curZ2 - 1,
          duration: 250,
          freezeElevation: true
        });
      }
    }

    if (canvasContainer) {
      canvasContainer.addEventListener('mousedown', onPointerDownInteraction, { passive: true });
      canvasContainer.addEventListener('pointerdown', onPointerDownInteraction, { passive: true });
      canvasContainer.addEventListener('touchstart', handleTouchStart, { capture: true, passive: false });
      canvasContainer.addEventListener('touchmove', handleTouchMove, { capture: true, passive: false });
      canvasContainer.addEventListener('touchend', handleTouchEnd, { capture: true, passive: true });
      canvasContainer.addEventListener('touchcancel', handleTouchEnd, { capture: true, passive: true });
      canvasContainer.addEventListener('wheel', handleCanvasWheel, { capture: true, passive: false });

      // Safari Trackpad gestures
      canvasContainer.addEventListener('gesturestart', onGestureStart, { capture: true, passive: false });
      canvasContainer.addEventListener('gesturechange', onGestureChange, { capture: true, passive: false });
      canvasContainer.addEventListener('gestureend', onGestureEnd, { capture: true, passive: false });
    }

    if (mapContainer) {
      mapContainer.addEventListener('click', handleZoomButtonDelegation, { capture: true });
      mapContainer.addEventListener('gesturestart', onGestureStart, { capture: true, passive: false });
      mapContainer.addEventListener('gesturechange', onGestureChange, { capture: true, passive: false });
      mapContainer.addEventListener('gestureend', onGestureEnd, { capture: true, passive: false });
    }

    var cleanup = function () {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', stopFlightOnBlur);
      window.removeEventListener('focus', stopFlightOnBlur);
      document.removeEventListener('visibilitychange', stopFlightOnBlur);

      map.off('movestart', onPanStart);
      map.off('move', onPanMove);
      map.off('dragstart', onPanStart);
      map.off('drag', onPanMove);
      map.off('dragend', onPanEnd);
      map.off('moveend', onPanEnd);
      map.off('zoom', enforceProgressivePitch);

      if (canvasContainer) {
        canvasContainer.removeEventListener('mousedown', onPointerDownInteraction);
        canvasContainer.removeEventListener('pointerdown', onPointerDownInteraction);
        canvasContainer.removeEventListener('touchstart', handleTouchStart, { capture: true });
        canvasContainer.removeEventListener('touchmove', handleTouchMove, { capture: true });
        canvasContainer.removeEventListener('touchend', handleTouchEnd, { capture: true });
        canvasContainer.removeEventListener('touchcancel', handleTouchEnd, { capture: true });
        canvasContainer.removeEventListener('wheel', handleCanvasWheel, { capture: true });
        canvasContainer.removeEventListener('gesturestart', onGestureStart, { capture: true });
        canvasContainer.removeEventListener('gesturechange', onGestureChange, { capture: true });
        canvasContainer.removeEventListener('gestureend', onGestureEnd, { capture: true });
      }

      if (mapContainer) {
        mapContainer.removeEventListener('click', handleZoomButtonDelegation, { capture: true });
        mapContainer.removeEventListener('gesturestart', onGestureStart, { capture: true });
        mapContainer.removeEventListener('gesturechange', onGestureChange, { capture: true });
        mapContainer.removeEventListener('gestureend', onGestureEnd, { capture: true });
      }

      if (gestureWatchdog) {
        clearTimeout(gestureWatchdog);
        gestureWatchdog = null;
      }

      stopFlight(true);
    };

    cleanup.CameraStateMachine = CameraStateMachine;
    cleanup.safeFlyTo = safeFlyTo;
    cleanup.safeEaseTo = safeEaseTo;
    return cleanup;
  }

  // Hook properties on function exports
  initKeyboardFlight.CameraStateMachine = CameraStateMachine;
  initKeyboardFlight.safeFlyTo = safeFlyTo;
  initKeyboardFlight.safeEaseTo = safeEaseTo;
  initKeyboardFlight.enforceTerrainClearance = enforceTerrainClearance;
  initKeyboardFlight.initKeyboardFlight = initKeyboardFlight;
  initKeyboardFlight.useKeyboardFlight = initKeyboardFlight;

  return initKeyboardFlight;
});
