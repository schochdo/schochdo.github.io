---
title: "Colorado Bustang Live Transit Dashboard"
date: "2026-09-01"
tags: ["GTFS-Realtime", "Leaflet", "Transit Telemetry", "Python", "OpenStreetMap", "Web GIS"]
featured: true
order: 2
summary: "Real-time transit dashboard and vehicle tracking map for Colorado's statewide bus network, decoding live vehicle coordinates, route performance, and stop departure times."
techStack: "Leaflet • GTFS-Realtime • Python • OpenStreetMap"
thumbnail: "/images/bustang_live_dashboard.png"
heroImage: "/images/bustang_live_dashboard.png"
liveUrl: "https://transit-dashboard-ap50.onrender.com"
githubUrl: "https://github.com/schochdo/schochdo.github.io"
category: "real-time"
---

A real-time transit intelligence dashboard and live interactive map tracking Colorado's statewide intercity bus network.

### Features & Architecture
- **Live Vehicle Positions**: Real-time coordinates and bearings decoded directly from GTFS-Realtime protocol buffer streams.
- **Stop Search & Departures**: Statewide search with live arrival/departure predictions and headway monitoring.
- **Open Mapping Stack**: Lightweight Leaflet and OpenStreetMap rendering with zero vendor lock-in.
