---
title: "Bustang Real-Time Transit Map"
date: "2024-03-01"
tags: ["Web GIS", "Leaflet", "GTFS-Realtime", "Transit"]
featured: true
order: 5
summary: "Interactive web mapping application tracking Colorado's Bustang interregional transit system in real time using Leaflet and GTFS-RT protocol buffer feeds via a Cloudflare Worker proxy."
thumbnail: "/images/thumbs/transportation.jpg"
heroImage: "/images/fulls/transportation.jpg"
liveUrl: "/bustang_leaflet/"
githubUrl: "https://github.com/schochdo/schochdo.github.io"
---

An interactive real-time web mapping application tracking Colorado's statewide interregional transit system (Bustang, Outrider, Pegasus, and Snowstang).

### Technical Architecture
- **Interactive Mapping**: Built with Leaflet and custom vector layers.
- **Real-Time GTFS-RT Feeds**: Pulls vehicle position protocol buffers (`VehiclePosition.pb`) through a Cloudflare Worker CORS proxy.
- **Multi-Route Coverage**: Visualizes stops, corridors, and live GPS locations for intercity transit routes across Colorado.
