---
title: "Colorado River Basin Water Infrastructure & Hydrology Dashboard"
date: "2026-09-27"
tags: ["GIS Analysis", "Hydrology", "Web GIS", "MapLibre GL", "Python", "Data Pipeline"]
featured: true
order: 1
summary: "Real-time telemetry pipeline and interactive geospatial dashboard tracking Colorado River streamflow, Front Range trans-mountain diversions (Adams, Moffat, Roberts tunnels), and Lake Powell/Mead storage."
thumbnail: "/images/colorado_river_basin.png"
heroImage: "/images/colorado_river_basin.png"
category: "environmental"
githubUrl: "https://github.com/schochdo/CO_River"
---

A real-time geospatial data pipeline and interactive hydrology dashboard tracking the water infrastructure, streamflow dynamics, and hydrologic balance of the Colorado River Basin, with special focus on the Upper Basin and trans-mountain diversions across the Continental Divide.

### Project Overview
The Colorado River supports over 40 million people and billions in agricultural production. This dashboard visualizes real-time flow telemetry across critical control points, measuring how water is diverted from the Western Slope to Front Range cities (Denver, Boulder, Northern Colorado) versus what remains for downstream compact allocations.

### Key Monitoring Nodes
- **Upper Basin Mainstem (USGS NWIS)**: Real-time gauges at Dotsero, CO (upper runoff), Cameo, CO (above Grand Valley canals), Cisco, UT (state line outflow), and Lees Ferry, AZ (the 1922 Compact dividing line).
- **Trans-Mountain Diversions (CDWR)**: Live diversion volumes siphoned backwards beneath the Continental Divide via Adams Tunnel (C-BT), Moffat Tunnel, and Roberts Tunnel.
- **Mega-Reservoir Storage (USBR)**: Elevation and structural storage capacity tracking for Lake Powell (Glen Canyon Dam) and Lake Mead (Hoover Dam).

### Technical Stack & Architecture
- **Data Engineering**: Python automated pipeline polling USGS, CDWR, and USBR hydrology APIs, computing compact deficits and volume allocations.
- **Frontend & Mapping**: Custom MapLibre GL JS geospatial dashboard with Esri National Geographic shaded relief, dynamic flow-weighted river widths, and live telemetry tables.
- **Hydrologic Analysis**: Contextualized against the 1922 Colorado River Compact, Shoshone senior water calls, and Front Range municipal demand.
