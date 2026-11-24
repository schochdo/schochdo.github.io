#!/usr/bin/env python3
"""
fetch_replay_7d.py - Ingests and downsamples 7 days of USGS streamflow data.

Generates a compact, columnar time-aligned hourly matrix (web/data/replay_7d.json)
for 60 FPS temporal replay on the System Map without pulling heavy historical payloads.

Dimensionality:
- Instantaneous discharge rate: Q in cfs (cubic feet per second)
- Timestamps: ISO 8601 hourly UTC snapshots (168-170 hours per 7-day window)
"""

import gzip
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone

def fetch_chunk(sites, cache_dir, timeout=25, retries=2):
    sites_str = ','.join(sites)
    cache_key = f"chunk_{abs(hash(sites_str)) % 1000000}_{len(sites)}.json"
    cache_path = os.path.join(cache_dir, cache_key)

    # Check cache freshness (valid for 1 hour locally; bypassed in CI or with --no-cache)
    use_cache = (os.environ.get('CI') != 'true') and ('--no-cache' not in sys.argv)
    if use_cache and os.path.exists(cache_path):
        mtime = os.path.getmtime(cache_path)
        if (time.time() - mtime) < 3600:
            try:
                with open(cache_path, 'r') as f:
                    cached_data = json.load(f)
                if cached_data:
                    return cached_data
            except Exception:
                pass

    url = f"https://waterservices.usgs.gov/nwis/iv/?format=json&sites={sites_str}&period=P7D&parameterCd=00060"
    req = urllib.request.Request(url, headers={
        'User-Agent': 'ColoradoRiverHydrology/1.0',
        'Accept-Encoding': 'gzip'
    })
    
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read()
                if resp.info().get('Content-Encoding') == 'gzip':
                    raw = gzip.decompress(raw)
                data = json.loads(raw.decode('utf-8'))
                series = data.get('value', {}).get('timeSeries', [])
                if series:
                    try:
                        with open(cache_path, 'w') as f:
                            json.dump(series, f)
                    except Exception:
                        pass
                    return series
        except Exception as e:
            print(f"  [Attempt {attempt+1}/{retries}] Error fetching chunk: {e}", file=sys.stderr)
            time.sleep(2)
    return []

def main():
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_dir = os.path.join(root_dir, 'web', 'data')
    if not os.path.exists(os.path.join(data_dir, 'station_hierarchy.json')):
        alt_dir = os.path.join(root_dir, 'public', 'colorado_river', 'data')
        if os.path.exists(os.path.join(alt_dir, 'station_hierarchy.json')):
            data_dir = alt_dir
    hierarchy_path = os.path.join(data_dir, 'station_hierarchy.json')
    output_path = os.path.join(data_dir, 'replay_7d.json')
    cache_dir = os.path.join(data_dir, '.cache_usgs_7d')
    os.makedirs(cache_dir, exist_ok=True)

    if not os.path.exists(hierarchy_path):
        print(f"Error: {hierarchy_path} not found.", file=sys.stderr)
        sys.exit(1)

    with open(hierarchy_path, 'r') as f:
        hierarchy = json.load(f)

    # Extract all USGS streamflow stations
    stations_dict = hierarchy.get('stations', {})
    usgs_stations = {}
    for sid, info in stations_dict.items():
        if info.get('type') == 'streamflow' and sid.isdigit():
            usgs_stations[sid] = info.get('name', f"USGS {sid}")

    site_ids = sorted(list(usgs_stations.keys()))
    print(f"Found {len(site_ids)} USGS streamflow stations.")

    # Split into chunks of 35 to prevent URL length limits and HTTP 503s
    chunk_size = 35
    chunks = [site_ids[i:i + chunk_size] for i in range(0, len(site_ids), chunk_size)]
    
    all_series = []
    for idx, chunk in enumerate(chunks):
        print(f"Fetching chunk {idx + 1}/{len(chunks)} ({len(chunk)} stations)...")
        series = fetch_chunk(chunk, cache_dir)
        print(f"  Received {len(series)} time series.")
        all_series.extend(series)

    # Process and downsample to hourly snapshots
    hourly_records = {} # { station_id: { 'YYYY-MM-DDTHH:00Z': cfs } }
    station_stats = {}  # { station_id: { min, max, latest } }

    for s in all_series:
        try:
            site_code = s['sourceInfo']['siteCode'][0]['value']
            values = s['values'][0]['value']
            
            by_hour = {}
            valid_flows = []
            
            for v in values:
                val_str = v.get('value', '')
                if val_str and val_str != '-999999':
                    try:
                        flow = round(float(val_str), 1)
                        # Convert USGS local-offset ISO timestamp accurately to UTC hourly bucket
                        dt_raw = v.get('dateTime', '')
                        if dt_raw:
                            dt_parsed = datetime.fromisoformat(dt_raw.replace('Z', '+00:00'))
                            if dt_parsed.tzinfo is None:
                                dt_parsed = dt_parsed.replace(tzinfo=timezone.utc)
                            dt_utc = dt_parsed.astimezone(timezone.utc)
                            hour_key = dt_utc.strftime('%Y-%m-%dT%H:00Z')
                            if hour_key not in by_hour:
                                by_hour[hour_key] = flow
                                valid_flows.append(flow)
                    except ValueError:
                        continue
            
            if by_hour and valid_flows:
                hourly_records[site_code] = by_hour
                station_stats[site_code] = {
                    'min_cfs': min(valid_flows),
                    'max_cfs': max(valid_flows),
                    'range_cfs': round(max(valid_flows) - min(valid_flows), 1),
                    'latest_cfs': valid_flows[-1],
                    'name': s['sourceInfo'].get('siteName', usgs_stations.get(site_code, ''))
                }
        except Exception as e:
            continue

    if not hourly_records:
        print("Error: No valid time series data parsed.", file=sys.stderr)
        sys.exit(1)

    # Union all timestamps across all stations
    all_hours = sorted(list(set.union(*[set(d.keys()) for d in hourly_records.values()])))
    print(f"Parsed {len(hourly_records)} active stations across {len(all_hours)} hourly timestamps.")

    # Build columnar matrix with forward-fill and backfill
    matrix_stations = {}
    for sid, by_hour in hourly_records.items():
        row = []
        last_val = None
        for h in all_hours:
            val = by_hour.get(h)
            if val is not None:
                last_val = val
            row.append(last_val)
        # Backfill any leading Nones before the first observation
        first_valid = next((v for v in row if v is not None), None)
        if first_valid is not None:
            row = [first_valid if v is None else v for v in row]
        matrix_stations[sid] = row

    # Compile output schema
    payload = {
        'metadata': {
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'period': '7D',
            'interval': '1h',
            'units': 'cfs',
            'total_stations': len(matrix_stations),
            'total_hours': len(all_hours),
            'time_start': all_hours[0] if all_hours else None,
            'time_end': all_hours[-1] if all_hours else None
        },
        'timestamps': all_hours,
        'station_stats': station_stats,
        'stations': matrix_stations
    }

    # Write compact JSON
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w') as f:
        json.dump(payload, f, separators=(',', ':'))

    size_kb = os.path.getsize(output_path) / 1024.0
    print(f"Successfully generated {output_path} ({size_kb:.1f} KB).")

if __name__ == '__main__':
    main()
