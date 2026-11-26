#!/usr/bin/env python3
"""
fetch_replay_30d.py - Ingests and downsamples 30 days of USGS streamflow data.

Generates a compact, columnar time-aligned 2-hour matrix (web/data/replay_30d.json)
for 60 FPS temporal replay on the System Map.

Dimensionality:
- Instantaneous discharge rate: Q in cfs (cubic feet per second)
- Timestamps: ISO 8601 2-hourly UTC snapshots (360 steps per 30-day window)
- Caching: Persists downloaded chunks to a local cache directory to prevent redundant API queries.
"""

import gzip
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone

def fetch_chunk(sites, cache_dir, timeout=30, retries=3):
    sites_str = ','.join(sites)
    cache_key = f"chunk_{abs(hash(sites_str)) % 1000000}_{len(sites)}.json"
    cache_path = os.path.join(cache_dir, cache_key)

    # Check cache freshness (valid for 3 hours locally; bypassed in CI or with --no-cache)
    use_cache = (os.environ.get('CI') != 'true') and ('--no-cache' not in sys.argv)
    if use_cache and os.path.exists(cache_path):
        mtime = os.path.getmtime(cache_path)
        if (time.time() - mtime) < 10800:
            try:
                with open(cache_path, 'r') as f:
                    cached_data = json.load(f)
                if cached_data:
                    return cached_data
            except Exception:
                pass

    url = f"https://waterservices.usgs.gov/nwis/iv/?format=json&sites={sites_str}&period=P30D&parameterCd=00060"
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
                    # Cache successful response
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
    output_path = os.path.join(data_dir, 'replay_30d.json')
    cache_dir = os.path.join(data_dir, '.cache_usgs_30d')
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

    # Split into chunks of 6 with gzip compression for fast, resilient transfers
    chunk_size = 6
    chunks = [site_ids[i:i + chunk_size] for i in range(0, len(site_ids), chunk_size)]
    
    all_series = []
    for idx, chunk in enumerate(chunks):
        print(f"Fetching chunk {idx + 1}/{len(chunks)} ({len(chunk)} stations)...")
        series = fetch_chunk(chunk, cache_dir)
        print(f"  Received {len(series)} time series.")
        all_series.extend(series)
        time.sleep(0.2)

    # Process and downsample to 2-hourly snapshots (00:00, 02:00, 04:00, ..., 22:00 UTC)
    two_hourly_records = {} # { station_id: { 'YYYY-MM-DDTHH:00Z': cfs } }
    station_stats = {}      # { station_id: { min, max, latest, range } }

    for s in all_series:
        try:
            site_code = s['sourceInfo']['siteCode'][0]['value']
            values = s['values'][0]['value']
            
            by_step = {}
            valid_flows = []
            
            for v in values:
                val_str = v.get('value', '')
                if val_str and val_str != '-999999':
                    try:
                        flow = round(float(val_str), 1)
                        # Convert USGS local-offset ISO timestamp accurately to UTC 2-hour bucket
                        dt_raw = v.get('dateTime', '')
                        if dt_raw:
                            dt_parsed = datetime.fromisoformat(dt_raw.replace('Z', '+00:00'))
                            if dt_parsed.tzinfo is None:
                                dt_parsed = dt_parsed.replace(tzinfo=timezone.utc)
                            dt_utc = dt_parsed.astimezone(timezone.utc)
                            even_hour = (dt_utc.hour // 2) * 2
                            step_key = f"{dt_utc.strftime('%Y-%m-%d')}T{even_hour:02d}:00Z"
                            if step_key not in by_step:
                                by_step[step_key] = flow
                                valid_flows.append(flow)
                    except ValueError:
                        continue
            
            if by_step and valid_flows:
                two_hourly_records[site_code] = by_step
                station_stats[site_code] = {
                    'min_cfs': min(valid_flows),
                    'max_cfs': max(valid_flows),
                    'range_cfs': round(max(valid_flows) - min(valid_flows), 1),
                    'latest_cfs': valid_flows[-1],
                    'name': s['sourceInfo'].get('siteName', usgs_stations.get(site_code, ''))
                }
        except Exception:
            continue

    if not two_hourly_records:
        print("Error: No valid time series data parsed.", file=sys.stderr)
        sys.exit(1)

    # Union all timestamps across all stations
    all_steps = sorted(list(set.union(*[set(d.keys()) for d in two_hourly_records.values()])))
    print(f"Parsed {len(two_hourly_records)} active stations across {len(all_steps)} 2-hourly timestamps.")

    # Build columnar matrix with forward-fill and backfill (zero null holes)
    matrix_stations = {}
    for sid, by_step in two_hourly_records.items():
        row = []
        last_val = None
        for step in all_steps:
            val = by_step.get(step)
            if val is not None:
                last_val = val
            row.append(last_val)
        # Backfill any leading Nones before the first observation
        first_valid = next((v for v in row if v is not None), 0.0)
        row = [first_valid if v is None else v for v in row]
        matrix_stations[sid] = row

    payload = {
        'metadata': {
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'period': '30D',
            'interval': '2h',
            'units': 'cfs',
            'total_stations': len(matrix_stations),
            'total_steps': len(all_steps),
            'time_start': all_steps[0] if all_steps else None,
            'time_end': all_steps[-1] if all_steps else None
        },
        'timestamps': all_steps,
        'station_stats': station_stats,
        'stations': matrix_stations
    }

    # Persist matrix in SQLite SSOT and export via export_sqlite_to_json.py
    import sqlite3
    sys.path.insert(0, os.path.join(root_dir, 'scripts'))
    from export_sqlite_to_json import export_replay, get_conn

    db_path = os.path.join(root_dir, 'data', 'colorado_river_basin.db')
    conn = get_conn(db_path)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS replay_matrices (
            window_key TEXT PRIMARY KEY,
            generated_at TEXT NOT NULL,
            payload_json TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        INSERT INTO replay_matrices (window_key, generated_at, payload_json)
        VALUES ('30d', ?, ?)
        ON CONFLICT(window_key) DO UPDATE SET generated_at=excluded.generated_at, payload_json=excluded.payload_json
        """,
        (payload['metadata']['generated_at'], json.dumps(payload, separators=(',', ':'))),
    )
    conn.commit()
    export_replay(conn, '30d')
    conn.close()

if __name__ == '__main__':
    main()
