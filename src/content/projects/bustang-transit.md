---
title: "Colorado Bustang Live Transit Dashboard"
date: "2026-09-01"
tags: ["GTFS-Realtime", "Leaflet", "Transit Telemetry", "Python", "OpenStreetMap"]
featured: true
order: 2
summary: "Full real-time transit dashboard & tracking map for Colorado's statewide Bustang network, featuring live bus positions, route trends, stop departure boards, and OpenStreetMap integration."
thumbnail: "/images/bustang_live_dashboard.png"
heroImage: "/images/bustang_live_dashboard.png"
liveUrl: "https://transit-dashboard-ap50.onrender.com"
githubUrl: "https://github.com/schochdo/schochdo.github.io"
category: "real-time"
---

A complete real-time transit intelligence dashboard and live interactive map tracking Colorado's statewide intercity bus network (Bustang, Outrider, Pegasus, and Snowstang).

### Features & Architecture
- **Live Vehicle Positions**: Real-time GPS coordinates and directional bearings decoded from RTD / CDOT GTFS-Realtime protocol buffers.
- **Stop Search & Departure Boards**: Instant search for statewide stops with estimated arrival and departure times.
- **OpenStreetMap Basemap**: Clean, reliable vector and raster basemaps with full OpenStreetMap and RTD license attributions.
- **Bus Trends & Feed Health**: Analytical dashboards monitoring vehicle reliability, corridor speeds, and feed uptime.

*Also accessible as a standalone lightweight Leaflet map at [/bustang_leaflet/](/bustang_leaflet/).*
