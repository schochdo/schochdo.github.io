---
title: "Colorado Bustang Live Transit Dashboard"
date: "2026-09-01"
tags: ["Web GIS", "Leaflet", "GTFS-Realtime", "Transit", "Python"]
featured: true
order: 5
summary: "Full real-time transit dashboard & tracking map for Colorado's statewide Bustang network, featuring live bus positions, route trends, stop departure boards, and OpenStreetMap integration."
thumbnail: "/images/bustang_dashboard.jpg"
heroImage: "/images/bustang_dashboard.jpg"
liveUrl: "https://transit-dashboard-ap50.onrender.com"
githubUrl: "https://github.com/schochdo/schochdo.github.io"
---

A complete real-time transit intelligence dashboard and live interactive map tracking Colorado's statewide intercity bus network (Bustang, Outrider, Pegasus, and Snowstang).

### Features & Architecture
- **Live Vehicle Positions**: Real-time GPS coordinates and directional bearings decoded from RTD / CDOT GTFS-Realtime protocol buffers.
- **Stop Search & Departure Boards**: Instant search for statewide stops with estimated arrival and departure times.
- **OpenStreetMap Basemap**: Clean, reliable vector and raster basemaps with full OpenStreetMap and RTD license attributions.
- **Bus Trends & Feed Health**: Analytical dashboards monitoring vehicle reliability, corridor speeds, and feed uptime.

*Also accessible as a standalone lightweight Leaflet map at [/bustang_leaflet/](/bustang_leaflet/).*
