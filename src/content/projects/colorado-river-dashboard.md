---
title: "Colorado River Basin Hydrology Dashboard"
date: "2026-09-27"
tags: ["Hydrology", "MapLibre GL", "Python", "Data Pipeline", "Real-Time Telemetry", "USGS", "USBR"]
featured: true
order: 1
summary: "Real-time hydrology dashboard and automated data pipeline tracking Colorado River streamflow, trans-mountain diversions, and reservoir storage across the Continental Divide."
techStack: "MapLibre GL JS • Python • USGS & USBR APIs"
thumbnail: "/images/colorado_river_basin.png"
heroImage: "/images/colorado_river_basin.png"
category: "environmental"
githubUrl: "https://github.com/schochdo/CO_River"
---

A real-time geospatial data pipeline and interactive hydrology dashboard tracking water infrastructure, streamflow dynamics, and reservoir storage across the Colorado River Basin.

### Features & Architecture
- **Automated Data Ingestion**: Python pipeline polling real-time stream gauges, diversion records, and reservoir levels from federal and state APIs.
- **Trans-Mountain Diversions**: Real-time tracking of water diverted beneath the Continental Divide alongside mainstem runoff.
- **Interactive Mapping Canvas**: Custom MapLibre GL JS interface featuring flow-weighted river symbology and live telemetry readouts.
