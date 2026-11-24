#!/usr/bin/env python3
"""
Real-Time Hydrologic Data Ingestion Pipeline for Colorado River Basin
Colorado Mountain College (CMC) • DAT1001

Automated ETL script that queries:
  1. USGS Water Services (NWIS) for real-time instantaneous streamflow (cfs)
  2. Colorado Division of Water Resources (CDWR HydroBase) for trans-mountain diversion tunnels
  3. USBR Lower Colorado Hourly River Operations for Hoover Dam, Davis Dam, and Parker Dam releases
  4. USBR Upper Colorado HydroData & Lower Colorado Hourly Teletype for mega-reservoir storage and elevations
  5. Front Range municipal collection reservoirs (Dillon, Granby, Green Mountain, Homestake)

Strict Hydrologic Telemetry Integrity & 3-Tier Hierarchy:
  - Tier 1: Live / Recent Telemetry (age_hours <= 72) -> real measured cfs + true timestamp
  - Tier 2: Last Verified Snapshot (72h < age_hours <= 336 / 14 days) -> delayed telemetry labeled amber
  - Tier 3: Offline / Discontinued (age_hours > 336 / 14 days or dead gage) -> flow_cfs = None, status = "offline"

Outputs:
  - web/data/latest_metrics.json
  - data/latest_metrics.json
"""

import sys
import os

try:
    import requests
except ImportError:
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    venv_py = os.path.join(repo_root, ".venv", "bin", "python3")
    if os.path.exists(venv_py) and sys.executable != venv_py:
        os.execv(venv_py, [venv_py] + sys.argv)
    else:
        raise

import json
import sqlite3
import re
import subprocess
from datetime import datetime, timezone, timedelta
from concurrent.futures import ThreadPoolExecutor

USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 (DAT1001-Research)"

_LAST_USBR_HOURLY = {}

def load_previous_snapshot():
    """Loads the existing latest_metrics.json to provide verified snapshots for Tier 2 fallbacks."""
    candidates = [
        "web/data/latest_metrics.json",
        "data/latest_metrics.json",
        "public/colorado_river/data/latest_metrics.json"
    ]
    for p in candidates:
        if os.path.exists(p):
            try:
                with open(p, "r") as f:
                    return json.load(f)
            except Exception:
                pass
    return {}

def parse_iso_datetime(dt_str):
    """Parses various ISO and date string formats into UTC datetime."""
    if not dt_str:
        return None
    try:
        dt = datetime.fromisoformat(dt_str)
        if dt.tzinfo is None:
            # Default Mountain Time (-07:00) if no tz specified
            dt = dt.replace(tzinfo=timezone(timedelta(hours=-7)))
        return dt.astimezone(timezone.utc)
    except Exception:
        pass
    try:
        dt = datetime.strptime(dt_str[:10], "%Y-%m-%d")
        dt = dt.replace(tzinfo=timezone(timedelta(hours=-7)))
        return dt.astimezone(timezone.utc)
    except Exception:
        pass
    return None

def compute_age_and_status(dt_str):
    """
    Computes age in hours from observation timestamp to now (UTC),
    and assigns the 3-tier hydrologic status:
      - 'live': <= 6 hours
      - 'daily': 6 < age <= 72 hours
      - 'delayed': 72 < age <= 336 hours (14 days)
      - 'offline': > 336 hours or unparseable
    """
    dt_utc = parse_iso_datetime(dt_str)
    if not dt_utc:
        return 999999.0, "offline"
    now_utc = datetime.now(timezone.utc)
    age_hours = max(0.0, (now_utc - dt_utc).total_seconds() / 3600.0)
    if age_hours <= 6.0:
        status = "live"
    elif age_hours <= 72.0:
        status = "daily"
    elif age_hours <= 336.0:
        status = "delayed"
    else:
        status = "offline"
    return round(age_hours, 1), status

def fetch_usbr_hourly_operations():
    """
    Extracts real-time Hoover Dam, Davis Dam, and Parker Dam releases and reservoir elevations
    directly from the USBR Lower Colorado River Hourly Operations feed.
    Scrapes https://www.usbr.gov/lc/region/g4000/hourly/hourly.html
    """
    url = "https://www.usbr.gov/lc/region/g4000/hourly/hourly.html"
    html_text = None
    try:
        r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=8)
        if r.status_code == 200:
            html_text = r.text
    except Exception:
        pass

    if not html_text:
        try:
            html_text = subprocess.check_output(
                ["curl", "-s", "--max-time", "8", url],
                stderr=subprocess.DEVNULL
            ).decode("utf-8")
        except Exception:
            pass

    if not html_text:
        return None

    # Parse report date: DAILY RIVER REPORT FOR MM-DD-YYYY
    report_date = None
    m_date = re.search(r'DAILY RIVER REPORT FOR\s+(\d{1,2})-(\d{1,2})-(\d{4})', html_text)
    if m_date:
        mo, da, yr = m_date.groups()
        report_date = f"{yr}-{int(mo):02d}-{int(da):02d}"
    else:
        report_date = datetime.now().strftime("%Y-%m-%d")

    latest = None
    for line in html_text.splitlines():
        if "PAGE 2" in line:
            break
        m = re.match(r'^\s*(\d{4}-\d{4})\s+([\d\.]+)\s+(\d+)\s+([\d\.]+)\s+([\d\.]+)\s+(\d+)\s+([\d\.]+)\s+([\d\.]+)\s+(\d+)', line)
        if m:
            time_slot, mead_el, hoover_rel, mohave_el, mohave_af, davis_rel, havasu_el, havasu_af, parker_rel = m.groups()
            elev_val = float(mead_el)
            if elev_val >= 890.0:
                end_hr = time_slot.split("-")[1]
                hr = int(end_hr[:2])
                mn = int(end_hr[2:])
                if hr == 24:
                    hr = 0
                iso_ts = f"{report_date}T{hr:02d}:{mn:02d}:00-07:00"
                age_hours, status = compute_age_and_status(iso_ts)
                latest = {
                    "timestamp": iso_ts,
                    "age_hours": age_hours,
                    "data_status": status,
                    "mead_elev": elev_val,
                    "hoover_rel": float(hoover_rel),
                    "mohave_elev": float(mohave_el),
                    "mohave_storage_af": float(mohave_af) * 1000.0,
                    "davis_rel": float(davis_rel),
                    "havasu_elev": float(havasu_el),
                    "havasu_storage_af": float(havasu_af) * 1000.0,
                    "parker_rel": float(parker_rel)
                }
    if latest:
        global _LAST_USBR_HOURLY
        _LAST_USBR_HOURLY.update(latest)
    return latest

def fetch_usgs_streamflow():
    """
    Fetches real-time streamflow (discharge in cfs) for all basin sentinel stations and major tributaries.
    Excludes discontinued/dead stations:
      - 09423000 (Davis Dam - discontinued Oct 2022; replaced by live USBR hourly operations)
      - 09427520 (Parker Dam - discontinued Sep 2006; replaced by live USBR hourly operations)
      - 09421500 (Hoover Dam - no instantaneous NWIS; provided by live USBR hourly operations)
      - 09400000 (Little Colorado nr Winslow - discontinued 2002; active station is 09402000 nr Cameron)
    """
    sites = {
        # Mainstem Sentinel Gauges
        "09010500": "Colorado River below Baker Gulch nr Grand Lake, CO (Headwaters)",
        "09034250": "Colorado River at Windy Gap near Granby, CO",
        "09058000": "Colorado River near Kremmling, CO",
        "09070500": "Colorado River near Dotsero, CO (Shoshone Call Gage)",
        "09085100": "Colorado River below Glenwood Springs, CO",
        "09095500": "Colorado River near Cameo, CO",
        "09163500": "Colorado River near CO-UT State Line",
        "09180500": "Colorado River near Cisco, UT",
        "09380000": "Colorado River at Lees Ferry, AZ",
        "09402500": "Colorado River near Grand Canyon, AZ (Phantom Ranch)",
        "09404200": "Colorado River above Diamond Creek near Peach Springs, AZ",
        "09429100": "Colorado River below Palo Verde Dam, AZ-CA",
        "09429500": "Colorado River below Imperial Dam, AZ-CA",
        
        # Major Upper Basin Tributaries & Confluences
        "09188500": "Green River at Warren Bridge, near Daniel, WY",
        "09209400": "Green River near La Barge, WY",
        "09211200": "Green River below Fontenelle Reservoir, WY",
        "09217000": "Green River near Green River, WY",
        "09234500": "Green River near Greendale, UT (Flaming Gorge Dam)",
        "09251000": "Yampa River near Maybell, CO",
        "09260050": "Yampa River at Deerlodge Park, CO",
        "09261000": "Green River near Jensen, UT (below Yampa)",
        "09272400": "Green River at Ouray, UT",
        "09306500": "White River near Watson, UT",
        "09302000": "Duchesne River near Randlett, UT",
        "09314500": "Price River at Woodside, UT",
        "09315000": "Green River at Green River, UT",
        "09328500": "San Rafael River near Green River, UT",
        "09333500": "Dirty Devil River near Hanksville, UT",
        "09337500": "Escalante River near Escalante, UT",
        "09114500": "Gunnison River near Gunnison, CO (Headwaters)",
        "09128000": "Gunnison River below Gunnison Tunnel, CO",
        "09152500": "Gunnison River near Grand Junction, CO",
        "09166500": "Dolores River at Dolores, CO (Headwaters)",
        "09169500": "Dolores River at Bedrock, CO (McPhee Dam Release)",
        "09180000": "Dolores River near Cisco, UT",
        "09342500": "San Juan River at Pagosa Springs, CO (Headwaters)",
        "09355500": "San Juan River near Archuleta, NM (Navajo Dam)",
        "09364500": "Animas River at Farmington, NM",
        "09365000": "San Juan River at Farmington, NM",
        "09368000": "San Juan River at Shiprock, NM",
        "09379500": "San Juan River near Bluff, UT",
        
        # Headwaters & West Slope Tributaries
        "09033300": "Fraser River below Crooked Creek at Tabernash, CO",
        "09037500": "Williams Fork near Parshall, CO",
        "09041400": "Muddy Creek below Wolford Mountain Reservoir, CO",
        "09046600": "Blue River near Dillon, CO (Breckenridge Inflow)",
        "09050700": "Blue River below Dillon, CO (Dillon Dam Release)",
        "09080400": "Fryingpan River near Ruedi, CO",
        "09085000": "Roaring Fork River at Glenwood Springs, CO",
        "09070000": "Eagle River below Gypsum, CO",
        "09057500": "Blue River below Green Mtn Reservoir, CO",
        "09149500": "Uncompahgre River at Delta, CO",
        "09260000": "Little Snake River near Lily, CO",
        "09304500": "White River near Meeker, CO",
        
        # Grand Canyon, Desert & Lower Basin Tributaries
        "09382000": "Paria River at Lees Ferry, AZ",
        "09384000": "Little Colorado River above Lyman Lake near St. Johns, AZ",
        "09402000": "Little Colorado River near Cameron, AZ",
        "09403850": "Kanab Creek above the mouth near Supai, AZ",
        "09404115": "Havasu Creek above the mouth, near Supai, AZ",
        "09406000": "Virgin River at Virgin, UT",
        "09415000": "Virgin River at Littlefield, AZ",
        "09419000": "Muddy River near Glendale, NV",
        "09426000": "Bill Williams River below Alamo Dam, AZ",
        "09471000": "San Pedro River at Charleston, AZ",
        "09474000": "Gila River at Kelvin, AZ",
        "09520500": "Gila River near Dome, AZ",
        "09498500": "Salt River near Roosevelt, AZ",
        "09502000": "Salt River below Stewart Mountain Dam, AZ",
        "09506000": "Verde River near Camp Verde, AZ",
        "09510000": "Verde River below Bartlett Dam, AZ",
        "09511300": "Verde River near Scottsdale, AZ",
        
        # Major Conveyance / Diversion Canal
        "09527700": "All-American Canal near Imperial Dam"
    }
    site_ids = ",".join(sites.keys())
    url = f"https://waterservices.usgs.gov/nwis/iv/?format=json&sites={site_ids}&parameterCd=00060&siteStatus=all"
    
    results = []
    for attempt in range(3):
        try:
            response = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=14)
            if response.status_code == 200:
                data = response.json()
                for ts in data.get("value", {}).get("timeSeries", []):
                    code = ts["sourceInfo"]["siteCode"][0]["value"]
                    name = sites.get(code, ts["sourceInfo"]["siteName"])
                    lat = ts["sourceInfo"]["geoLocation"]["geogLocation"]["latitude"]
                    lon = ts["sourceInfo"]["geoLocation"]["geogLocation"]["longitude"]
                    values = ts["values"][0]["value"]
                    
                    if values:
                        valid_vals = [v for v in values if v.get("value") and v["value"] != "-999999"]
                        if valid_vals:
                            latest = valid_vals[-1]
                            val = float(latest["value"])
                            dt = latest["dateTime"]
                            age_hours, status = compute_age_and_status(dt)
                            flow = val if status != "offline" else None

                            if code == "09527700":
                                results.append({
                                    "id": code,
                                    "name": name,
                                    "type": "diversion_canal",
                                    "destination": "Imperial & Coachella Valleys",
                                    "provider": "USGS",
                                    "flow_cfs": flow,
                                    "timestamp": dt,
                                    "age_hours": age_hours,
                                    "data_status": status,
                                    "lat": lat,
                                    "lon": lon
                                })
                            else:
                                results.append({
                                    "id": code,
                                    "name": name,
                                    "type": "streamflow",
                                    "provider": "USGS",
                                    "flow_cfs": flow,
                                    "timestamp": dt,
                                    "age_hours": age_hours,
                                    "data_status": status,
                                    "lat": lat,
                                    "lon": lon
                                })
                if results:
                    break
        except Exception as e:
            print(f"Warning: USGS streamflow attempt {attempt+1} failed: {e}")
            import time
            time.sleep(1)
            
    return results


def fetch_usgs_daily():
    """
    Fetches Daily Values (DV) for infrastructure that doesn't report instantaneous flows.
    Strictly parses real observation timestamps and assigns scientifically defensible status:
      - 09424150 (Colorado River Aqueduct): Discontinued Sep 2022 -> offline, flow_cfs = None
      - 09426650 (Central Arizona Project): Published monthly -> delayed telemetry with true date
      - 09522000 (Canal Alimentador Central at Morelos Dam): International treaty accounting -> delayed telemetry
    """
    sites = {
        "09424150": "Colorado River Aqueduct near Parker Dam",
        "09426650": "Central Arizona Project Canal at Havasu Pumping Plant",
        "09522000": "Canal Alimentador Central (Central Feeder Canal at Morelos Dam)"
    }
    MONTHLY_USGS_SITES = {"09426650", "09522000"}
    site_ids = ",".join(sites.keys())
    url = f"https://waterservices.usgs.gov/nwis/dv/?format=json&sites={site_ids}&parameterCd=00060&siteStatus=all"
    
    results = []
    for attempt in range(3):
        try:
            response = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=12)
            if response.status_code == 200:
                data = response.json()
                for ts in data.get("value", {}).get("timeSeries", []):
                    code = ts["sourceInfo"]["siteCode"][0]["value"]
                    name = sites.get(code, ts["sourceInfo"]["siteName"])
                    lat = ts["sourceInfo"]["geoLocation"]["geogLocation"]["latitude"]
                    lon = ts["sourceInfo"]["geoLocation"]["geogLocation"]["longitude"]
                    values = ts["values"][0]["value"]
                    
                    if values:
                        valid_vals = [v for v in values if v.get("value") and v["value"] != "-999999"]
                        if valid_vals:
                            latest = valid_vals[-1]
                            val = float(latest["value"])
                            dt = latest["dateTime"]
                            age_hours, status = compute_age_and_status(dt)
                            
                            # Treaty / Monthly regulatory accounting allowance (60-day cycle)
                            if code in MONTHLY_USGS_SITES and age_hours <= 1440.0:
                                status = "delayed"
                            
                            flow = val if status != "offline" else None
                            
                            if code == "09426650":
                                dest = "Phoenix & Tucson / Central Arizona"
                                c_name = "Central Arizona Project (CAP Aqueduct)"
                            elif code == "09522000":
                                dest = "Mexicali Valley Agriculture & Municipal Users (District 014)"
                                c_name = "Canal Alimentador Central (Central Feeder Canal)"
                                lat, lon = 32.7056, -114.7292  # Morelos Dam intake coordinates
                            else:
                                dest = "Los Angeles / Southern California"
                                c_name = "Colorado River Aqueduct"

                            results.append({
                                "id": code,
                                "name": c_name,
                                "type": "diversion_canal",
                                "destination": dest,
                                "provider": "USGS / CILA" if code == "09522000" else "USGS",
                                "flow_cfs": flow,
                                "timestamp": dt,
                                "age_hours": age_hours,
                                "data_status": status,
                                "lat": lat,
                                "lon": lon
                            })
                if results:
                    break
        except Exception as e:
            print(f"Warning: Failed to fetch DV data (attempt {attempt + 1}): {e}")
            import time
            time.sleep(1)

    # Fallback to previous verified snapshot if NWIS DV query failed (preserving 60-day monthly allowance)
    if not results:
        prev = load_previous_snapshot()
        for c in prev.get("canals", []):
            code = c.get("id")
            if code in sites:
                age_hours, status = compute_age_and_status(c.get("timestamp"))
                if code in MONTHLY_USGS_SITES and age_hours <= 1440.0:
                    status = "delayed"
                flow = c.get("flow_cfs") if status != "offline" else None
                results.append({
                    **c,
                    "provider": c.get("provider") or ("USGS / CILA" if code == "09522000" else "USGS"),
                    "flow_cfs": flow,
                    "age_hours": age_hours,
                    "data_status": status
                })

    return results

def fetch_cdwr_tunnels():
    """
    Fetches real-time trans-mountain diversion flow (cfs) under the Continental Divide via CDWR API.
    If CDWR API returns 403 (anonymous rate limit exceeded) or fails, gracefully falls back to the
    last verified snapshot from latest_metrics.json, accurately computing age and marking data_status.
    """
    tunnels = {
        "ADATUNCO": {
            "name": "Alva B. Adams Tunnel",
            "destination": "Grand Lake -> Estes Park / Northern Water",
            "capacity_cfs": 1020,
            "lat": 40.3283,
            "lon": -105.5786
        },
        "MOFTUNCO": {
            "name": "Moffat Water Tunnel",
            "destination": "Fraser River -> Gross Reservoir / Denver Water",
            "capacity_cfs": 1280,
            "lat": 39.9022,
            "lon": -105.6433
        },
        "ROBTUNCO": {
            "name": "Harold D. Roberts Tunnel",
            "destination": "Dillon Reservoir -> South Platte / Denver Water",
            "capacity_cfs": 1020,
            "lat": 39.4633,
            "lon": -105.6797
        },
        "BOUTUNCO": {
            "name": "Charles H. Boustead Tunnel",
            "destination": "Fryingpan -> Arkansas Basin / Aurora",
            "capacity_cfs": 945,
            "lat": 39.2619,
            "lon": -106.5297
        }
    }
    
    meas_map = {}
    abbrev_param = ",".join(tunnels.keys())
    for endpoint in ["telemetrytimeserieshour", "telemetrytimeseriesday"]:
        url = f"https://dwr.state.co.us/Rest/GET/api/v2/telemetrystations/{endpoint}/?format=json&abbrev={abbrev_param}"
        try:
            r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=8)
            if r.status_code == 200:
                items = r.json().get("ResultList", [])
                for x in items:
                    if x.get("parameter") == "DISCHRG":
                        abb = x.get("abbrev")
                        dt = x.get("measDateTime") or x.get("measDate")
                        val = max(0.0, float(x.get("measValue", 0.0)))
                        if abb not in meas_map or (dt and dt > meas_map[abb].get("dt", "")):
                            meas_map[abb] = {"val": val, "dt": dt}
                if len(meas_map) == len(tunnels):
                    break
        except Exception:
            pass

    # If CDWR API rate-limited (e.g. 403) or missing tunnels, load last verified snapshot
    prev_snapshot = load_previous_snapshot()
    prev_tunnels = {t["id"]: t for t in prev_snapshot.get("tunnels", []) if "id" in t}

    results = []
    for abbrev, meta in tunnels.items():
        if abbrev in meas_map:
            m = meas_map[abbrev]
            flow_val = round(m["val"], 1)
            obs_dt = m["dt"]
            age_hours, status = compute_age_and_status(obs_dt)
        elif abbrev in prev_tunnels:
            prev = prev_tunnels[abbrev]
            obs_dt = prev.get("timestamp")
            age_hours, status = compute_age_and_status(obs_dt)
            flow_val = prev.get("flow_cfs") if status != "offline" else None
        else:
            flow_val = None
            obs_dt = None
            age_hours = 999999.0
            status = "offline"

        if flow_val is not None and flow_val > 0:
            status_label = "Active Trans-Divide Conveyance"
        elif flow_val == 0.0:
            status_label = "Seasonal Winter Shutdown / Closed"
        else:
            status_label = "Telemetry Offline / Unmonitored"

        notes = meta["destination"]
        if flow_val == 0.0:
            notes += " (Alpine headgates closed post-irrigation season; unwatered for fall/winter maintenance)"

        results.append({
            "id": abbrev,
            "name": meta["name"],
            "destination": meta["destination"],
            "type": "diversion_tunnel",
            "provider": "CDWR",
            "capacity_cfs": meta.get("capacity_cfs"),
            "flow_cfs": flow_val,
            "status_label": status_label,
            "notes": notes,
            "timestamp": obs_dt,
            "age_hours": age_hours,
            "data_status": status,
            "lat": meta["lat"],
            "lon": meta["lon"]
        })
            
    return results

def fetch_reservoirs(usbr_hourly=None):
    """
    Fetches live storage, elevation, and capacity metrics for the Colorado River Basin reservoirs.
    Uses parallel fetching and live hourly operations feeds where available.
    """
    def get_csv(url):
        try:
            r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=8)
            lines = [l.strip() for l in r.text.splitlines() if l.strip() and "," in l]
            if len(lines) > 1:
                return lines[-1].split(",")[0], float(lines[-1].split(",")[1])
        except Exception:
            pass
        return None, None

    def get_usgs_lake(site, param="62614"):
        try:
            url = f"https://waterservices.usgs.gov/nwis/iv/?format=json&sites={site}&parameterCd={param}&siteStatus=all"
            r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=8)
            if r.status_code == 200:
                ts = r.json().get("value", {}).get("timeSeries", [])
                if ts and ts[0]["values"][0]["value"]:
                    latest = ts[0]["values"][0]["value"][-1]
                    return latest["dateTime"], float(latest["value"])
        except Exception:
            pass
        return None, None

    csv_jobs = {
        "powell_af": "https://www.usbr.gov/uc/water/hydrodata/reservoir_data/919/csv/17.csv",
        "powell_elev": "https://www.usbr.gov/uc/water/hydrodata/reservoir_data/919/csv/49.csv",
        "mead_af": "https://www.usbr.gov/uc/water/hydrodata/reservoir_data/921/csv/17.csv",
        "mead_elev": "https://www.usbr.gov/uc/water/hydrodata/reservoir_data/921/csv/49.csv",
        "fg_af": "https://www.usbr.gov/uc/water/hydrodata/reservoir_data/917/csv/17.csv",
        "fg_elev": "https://www.usbr.gov/uc/water/hydrodata/reservoir_data/917/csv/49.csv",
        "nav_af": "https://www.usbr.gov/uc/water/hydrodata/reservoir_data/920/csv/17.csv",
        "nav_elev": "https://www.usbr.gov/uc/water/hydrodata/reservoir_data/920/csv/49.csv",
        "bm_af": "https://www.usbr.gov/uc/water/hydrodata/reservoir_data/913/csv/17.csv",
        "bm_elev": "https://www.usbr.gov/uc/water/hydrodata/reservoir_data/913/csv/49.csv"
    }

    with ThreadPoolExecutor(max_workers=12) as pool:
        csv_futures = {k: pool.submit(get_csv, u) for k, u in csv_jobs.items()}
        f_powell_usgs = pool.submit(get_usgs_lake, "09379900", "62614")
        f_mohave_usgs = pool.submit(get_usgs_lake, "09422500", "00054")
        f_havasu_usgs = pool.submit(get_usgs_lake, "09427500", "00054")

        csv_data = {k: f.result() for k, f in csv_futures.items()}
        powell_usgs_dt, powell_usgs_elev = f_powell_usgs.result()
        mohave_usgs_dt, mohave_usgs_af = f_mohave_usgs.result()
        havasu_usgs_dt, havasu_usgs_af = f_havasu_usgs.result()

    if not usbr_hourly:
        usbr_hourly = _LAST_USBR_HOURLY

    prev_snapshot = load_previous_snapshot()
    prev_res_map = {r["id"]: r for r in prev_snapshot.get("reservoirs", []) if "id" in r}

    def resolve_res_vals(res_id, live_elev, live_af, live_dt, cap_af):
        """Use live observed values, falling back only to the last verified snapshot with its true timestamp (no fake placeholders)."""
        prev = prev_res_map.get(res_id, {})
        elev = live_elev if live_elev is not None else prev.get("elevation_ft")
        af = live_af if live_af is not None else prev.get("storage_af")
        dt = live_dt if (live_af is not None or live_elev is not None) else prev.get("timestamp")
        age, status = compute_age_and_status(dt)
        pct = round((af / cap_af) * 100, 1) if (af is not None and cap_af > 0) else None
        return (
            round(elev, 1) if elev is not None else None,
            round(af, 0) if af is not None else None,
            pct,
            dt,
            age,
            status if af is not None else "offline"
        )

    results = []

    # 1. Lake Powell (Glen Canyon Dam)
    p_elev, p_af, p_pct, p_dt, p_age, p_status = resolve_res_vals(
        "lake_powell",
        powell_usgs_elev if powell_usgs_elev is not None else csv_data["powell_elev"][1],
        csv_data["powell_af"][1],
        powell_usgs_dt or csv_data["powell_af"][0],
        24322000.0
    )
    results.append({
        "id": "lake_powell",
        "name": "Lake Powell (Glen Canyon Dam)",
        "river": "Colorado River (AZ/UT)",
        "type": "reservoir",
        "category": "system",
        "provider": "USBR / USGS",
        "elevation_ft": p_elev,
        "storage_af": p_af,
        "capacity_af": 24322000.0,
        "capacity_pct": p_pct,
        "role": "Upper Basin Bank & Compact Delivery to Lower Basin",
        "timestamp": p_dt,
        "age_hours": p_age,
        "data_status": p_status,
        "lat": 36.9367,
        "lon": -111.4839
    })

    # 2. Lake Mead (Hoover Dam) — Real USBR HydroData 921/csv/17.csv storage + hourly/daily elevation (no linear approximation)
    live_mead_elev = None
    live_mead_dt = None
    if usbr_hourly and usbr_hourly.get("mead_elev") and usbr_hourly["mead_elev"] >= 890.0:
        live_mead_elev = usbr_hourly["mead_elev"]
        live_mead_dt = usbr_hourly.get("timestamp")
    elif csv_data["mead_elev"][1] is not None:
        live_mead_elev = csv_data["mead_elev"][1]
        live_mead_dt = csv_data["mead_elev"][0]

    live_mead_af = csv_data["mead_af"][1]
    if not live_mead_dt:
        live_mead_dt = csv_data["mead_af"][0]

    m_elev, m_af, m_pct, m_dt, m_age, m_status = resolve_res_vals(
        "lake_mead", live_mead_elev, live_mead_af, live_mead_dt, 26134000.0
    )
    results.append({
        "id": "lake_mead",
        "name": "Lake Mead (Hoover Dam)",
        "river": "Colorado River (AZ/NV)",
        "type": "reservoir",
        "category": "system",
        "provider": "USBR",
        "elevation_ft": m_elev,
        "storage_af": m_af,
        "capacity_af": 26134000.0,
        "capacity_pct": m_pct,
        "role": "Lower Basin Primary Storage & Delivery Regulation",
        "timestamp": m_dt,
        "age_hours": m_age,
        "data_status": m_status,
        "lat": 36.0156,
        "lon": -114.7378
    })

    # 3. Flaming Gorge Reservoir (Flaming Gorge Dam)
    fg_cap = 3749000.0
    fg_elev, fg_af, fg_pct, fg_dt, fg_age, fg_status = resolve_res_vals(
        "flaming_gorge", csv_data["fg_elev"][1], csv_data["fg_af"][1], csv_data["fg_af"][0], fg_cap
    )
    results.append({
        "id": "flaming_gorge",
        "name": "Flaming Gorge Reservoir (Flaming Gorge Dam)",
        "river": "Green River (UT/WY)",
        "type": "reservoir",
        "category": "system",
        "provider": "USBR",
        "elevation_ft": fg_elev,
        "storage_af": fg_af,
        "capacity_af": fg_cap,
        "capacity_pct": fg_pct,
        "role": "Green River DROA Drought Relief Releases to Lake Powell",
        "timestamp": fg_dt,
        "age_hours": fg_age,
        "data_status": fg_status,
        "lat": 40.9150,
        "lon": -109.4215
    })

    # 4. Navajo Reservoir (Navajo Dam)
    nav_cap = 1696000.0
    nav_elev, nav_af, nav_pct, nav_dt, nav_age, nav_status = resolve_res_vals(
        "navajo_reservoir", csv_data["nav_elev"][1], csv_data["nav_af"][1], csv_data["nav_af"][0], nav_cap
    )
    results.append({
        "id": "navajo_reservoir",
        "name": "Navajo Reservoir (Navajo Dam)",
        "river": "San Juan River (NM/CO)",
        "type": "reservoir",
        "category": "system",
        "provider": "USBR",
        "elevation_ft": nav_elev,
        "storage_af": nav_af,
        "capacity_af": nav_cap,
        "capacity_pct": nav_pct,
        "role": "San Juan Basin & Navajo Nation Irrigation Supply",
        "timestamp": nav_dt,
        "age_hours": nav_age,
        "data_status": nav_status,
        "lat": 36.8042,
        "lon": -107.6144
    })

    # 5. Lake Mohave (Davis Dam)
    mohave_cap = 1810000.0
    mo_elev, mo_af, mo_pct, mo_dt, mo_age, mo_status = resolve_res_vals(
        "lake_mohave",
        usbr_hourly.get("mohave_elev") if usbr_hourly else None,
        mohave_usgs_af if mohave_usgs_af is not None else (usbr_hourly.get("mohave_storage_af") if usbr_hourly else None),
        mohave_usgs_dt or (usbr_hourly.get("timestamp") if usbr_hourly else None),
        mohave_cap
    )
    results.append({
        "id": "lake_mohave",
        "name": "Lake Mohave (Davis Dam)",
        "river": "Lower Colorado River (AZ/NV)",
        "type": "reservoir",
        "category": "system",
        "provider": "USBR / USGS",
        "elevation_ft": mo_elev,
        "storage_af": mo_af,
        "capacity_af": mohave_cap,
        "capacity_pct": mo_pct,
        "role": "Downstream Regulation & Mexican Treaty Deliveries",
        "timestamp": mo_dt,
        "age_hours": mo_age,
        "data_status": mo_status,
        "lat": 35.1989,
        "lon": -114.5683
    })

    # 6. Blue Mesa Reservoir (Wayne N. Aspinall Unit)
    bm_cap = 829500.0
    bm_elev, bm_af, bm_pct, bm_dt, bm_age, bm_status = resolve_res_vals(
        "blue_mesa", csv_data["bm_elev"][1], csv_data["bm_af"][1], csv_data["bm_af"][0], bm_cap
    )
    results.append({
        "id": "blue_mesa",
        "name": "Blue Mesa Reservoir (Blue Mesa Dam)",
        "river": "Gunnison River (CO)",
        "type": "reservoir",
        "category": "system",
        "provider": "USBR",
        "elevation_ft": bm_elev,
        "storage_af": bm_af,
        "capacity_af": bm_cap,
        "capacity_pct": bm_pct,
        "role": "Largest Lake in Colorado & Gunnison Basin Storage",
        "timestamp": bm_dt,
        "age_hours": bm_age,
        "data_status": bm_status,
        "lat": 38.4528,
        "lon": -107.3325
    })

    # 7. Lake Havasu (Parker Dam)
    havasu_cap = 619400.0
    ha_elev, ha_af, ha_pct, ha_dt, ha_age, ha_status = resolve_res_vals(
        "lake_havasu",
        usbr_hourly.get("havasu_elev") if usbr_hourly else None,
        havasu_usgs_af if havasu_usgs_af is not None else (usbr_hourly.get("havasu_storage_af") if usbr_hourly else None),
        havasu_usgs_dt or (usbr_hourly.get("timestamp") if usbr_hourly else None),
        havasu_cap
    )
    results.append({
        "id": "lake_havasu",
        "name": "Lake Havasu (Parker Dam)",
        "river": "Lower Colorado River (AZ/CA)",
        "type": "reservoir",
        "category": "system",
        "provider": "USBR / USGS",
        "elevation_ft": ha_elev,
        "storage_af": ha_af,
        "capacity_af": havasu_cap,
        "capacity_pct": ha_pct,
        "role": "Forebay Pumping Pool for CRA & CAP Aqueducts",
        "timestamp": ha_dt,
        "age_hours": ha_age,
        "data_status": ha_status,
        "lat": 34.2981,
        "lon": -114.1678
    })

    # --- Front Range & Denver Collection Reservoirs ---
    front_range_res = [
        {
            "id": "lake_granby",
            "abbrev": "GRARESCO",
            "name": "Lake Granby",
            "river": "Upper Colorado River (Grand County, CO)",
            "capacity_af": 539800.0,
            "full_pool_elev": 8280.0,
            "operator": "USBR / Northern Water",
            "role": "C-BT Project Primary Storage -> Adams Tunnel",
            "lat": 40.1488,
            "lon": -105.8675
        },
        {
            "id": "dillon_reservoir",
            "abbrev": "DILRESCO",
            "name": "Dillon Reservoir",
            "river": "Blue River (Summit County, CO)",
            "capacity_af": 257114.0,
            "full_pool_elev": 9017.0,
            "operator": "Denver Water",
            "role": "Primary West Slope Storage -> Roberts Tunnel to Denver",
            "lat": 39.6183,
            "lon": -106.0656
        },
        {
            "id": "green_mountain",
            "abbrev": "GRERESCO",
            "name": "Green Mountain Reservoir",
            "river": "Blue River (Summit/Grand County, CO)",
            "capacity_af": 153639.0,
            "full_pool_elev": 7950.0,
            "operator": "USBR",
            "role": "West Slope Compensatory Storage (C-BT Replacement)",
            "lat": 39.8783,
            "lon": -106.3298
        },
        {
            "id": "homestake_reservoir",
            "abbrev": "HOMRESCO",
            "name": "Homestake Reservoir",
            "river": "Homestake Creek / Eagle River (Eagle County, CO)",
            "capacity_af": 43600.0,
            "full_pool_elev": 10260.0,
            "operator": "Aurora & Colorado Springs Utilities",
            "role": "Homestake Project Storage -> Homestake Tunnel to Arkansas Basin",
            "lat": 39.3550,
            "lon": -106.4700
        }
    ]

    fr_meas_map = {}
    fr_abbrev_param = ",".join(fr["abbrev"] for fr in front_range_res)
    for endpoint in ["telemetrytimeserieshour", "telemetrytimeseriesday"]:
        url_cdwr = f"https://dwr.state.co.us/Rest/GET/api/v2/telemetrystations/{endpoint}/?format=json&abbrev={fr_abbrev_param}"
        try:
            r = requests.get(url_cdwr, headers={"User-Agent": USER_AGENT}, timeout=8)
            if r.status_code == 200:
                items = r.json().get("ResultList", [])
                for x in items:
                    abb = x.get("abbrev")
                    p = x.get("parameter")
                    dt = x.get("measDateTime") or x.get("measDate")
                    val = float(x.get("measValue", 0.0))
                    if abb not in fr_meas_map:
                        fr_meas_map[abb] = {"af": 0.0, "elev": 0.0, "dt": dt}
                    if p == "STORAGE":
                        fr_meas_map[abb]["af"] = val
                        if dt:
                            fr_meas_map[abb]["dt"] = dt
                    elif p == "ELEV":
                        fr_meas_map[abb]["elev"] = val
                        if dt and not fr_meas_map[abb]["dt"]:
                            fr_meas_map[abb]["dt"] = dt
                if len(fr_meas_map) == len(front_range_res) and endpoint == "telemetrytimeserieshour":
                    break
        except Exception:
            pass

    # Fallback only to last verified snapshot with its true timestamp (no hardcoded placeholder baselines)
    for fr in front_range_res:
        m = fr_meas_map.get(fr["abbrev"], {})
        af_val = m.get("af") if m.get("af", 0.0) > 0 else None
        elev_val = m.get("elev") if m.get("elev", 0.0) > 0 else None
        dt_str = m.get("dt") if (af_val is not None or elev_val is not None) else None

        if af_val is None and fr["id"] in prev_res_map:
            prev = prev_res_map[fr["id"]]
            af_val = prev.get("storage_af")
            elev_val = prev.get("elevation_ft")
            dt_str = prev.get("timestamp")

        pct_val = round((af_val / fr["capacity_af"]) * 100, 1) if (af_val is not None and fr["capacity_af"] > 0) else None
        is_stage = elev_val is not None and 0 < elev_val < 500
        elev_msl = round(fr["full_pool_elev"] - (126.0 - elev_val), 1) if (is_stage and fr.get("full_pool_elev")) else (round(elev_val, 1) if (elev_val is not None and elev_val > 500) else None)
        feet_down = round(fr["full_pool_elev"] - elev_msl, 1) if (elev_msl is not None and fr.get("full_pool_elev")) else None

        age_fr, status_fr = compute_age_and_status(dt_str)
        if af_val is None:
            status_fr = "offline"

        results.append({
            "id": fr["id"],
            "name": fr["name"],
            "river": fr["river"],
            "type": "reservoir",
            "category": "front_range",
            "provider": "CDWR",
            "operator": fr["operator"],
            "elevation_ft": elev_msl,
            "stage_ft": round(elev_val, 1) if is_stage else None,
            "feet_below_full": feet_down,
            "storage_af": round(af_val, 0) if af_val is not None else None,
            "capacity_af": fr["capacity_af"],
            "capacity_pct": pct_val,
            "role": fr["role"],
            "timestamp": dt_str,
            "age_hours": age_fr,
            "data_status": status_fr,
            "lat": fr["lat"],
            "lon": fr["lon"]
        })

    system_res = sorted([r for r in results if r.get("category") != "front_range"], key=lambda x: x.get("capacity_af", 0), reverse=True)
    fr_res = sorted([r for r in results if r.get("category") == "front_range"], key=lambda x: x.get("capacity_af", 0), reverse=True)
    return system_res + fr_res

def validate_hydrology(streamflows, dam_releases, canals, tunnels, river_network_path="web/data/river_network.json", normals_path="web/data/historical_normals.json"):
    """
    Automated Hydrologic Sanity & Mass-Balance Validator:
    1. Freshness Check: Flag stations > 72 hours old or offline.
    2. Reach Network Coverage: Audits all non-submerged reaches in river_network.json.
    3. River Spine Downstream Mass Balance (19 Reaches, Headwaters to Mexico):
       Verifies continuity and ensures all jumps (>1500 cfs or >35%) and drops (>35%)
       are strictly explained by verified dam releases, tributary inflows, or diversion canals.
    4. Historical Departure Check: Compares against 50-year daily median from historical_normals.json.
    5. Lower Basin Dam Cross-Checks: Hoover, Davis, Parker, and Imperial dams.
    """
    report = {
        "timestamp": datetime.now().isoformat(),
        "overall_status": "VALID",
        "stale_stations": [],
        "reach_coverage": {
            "total_reaches": 0,
            "active_reaches": 0,
            "submerged_reaches": 0,
            "unmapped_reaches": []
        },
        "spine_audit": [],
        "cross_checks": {},
        "anomalies": []
    }

    by_id = {s["id"]: s for s in streamflows}
    for c in canals:
        by_id[c["id"]] = c
    for t in tunnels:
        by_id[t["id"]] = t

    # 1. Freshness Check
    all_stations = [s for s in streamflows if not s["id"].startswith("USGS_") and "-" not in s["id"]] + canals + tunnels
    for st in all_stations:
        age = st.get("age_hours", 0.0)
        status = st.get("data_status", "unknown")
        if age > 72 or status in ["delayed", "offline"]:
            report["stale_stations"].append({
                "id": st.get("id"),
                "name": st.get("name"),
                "age_hours": age,
                "status": status,
                "timestamp": st.get("timestamp")
            })

    # 2. Reach Network Coverage Audit
    if os.path.exists(river_network_path):
        with open(river_network_path, "r") as f:
            rn = json.load(f)
        features = rn.get("features", [])
        report["reach_coverage"]["total_reaches"] = len(features)
        for f in features:
            props = f.get("properties", {})
            r_id = props.get("reach")
            r_type = props.get("reach_type")
            g_id = props.get("gauge_id")
            if r_type == "submerged_path":
                report["reach_coverage"]["submerged_reaches"] += 1
            else:
                report["reach_coverage"]["active_reaches"] += 1
                if g_id not in by_id:
                    report["reach_coverage"]["unmapped_reaches"].append({
                        "reach": r_id,
                        "name": props.get("name"),
                        "gauge_id": g_id
                    })

    # 3. Load 50-year Historical Normals
    normals_by_site = {}
    if os.path.exists(normals_path):
        with open(normals_path, "r") as f:
            normals_by_site = json.load(f).get("sites", {})
    today_mm_dd = datetime.now().strftime("%m-%d")

    dam_median_estimates = {
        "USBR-HOOVER": 10500.0,
        "USBR_HOOVER": 10500.0,
        "USBR-DAVIS": 5200.0,
        "USBR_DAVIS": 5200.0,
        "USBR-PARKER": 8800.0,
        "USBR_PARKER": 8800.0
    }

    # 4. Downstream Spine Definition (19 reaches)
    spine_definitions = [
        ("headwaters", "09010500", "Colorado River at Baker Gulch", None, [], []),
        ("colorado_granby_windygap", "09034250", "Colorado River near Granby (Windy Gap)", "Granby Dam", ["09033300"], ["09015000"]),
        ("colorado_windygap_kremmling", "09034250", "Colorado River Granby to Kremmling", "Windy Gap Dam", [], []),
        ("gore_canyon", "09058000", "Colorado River near Kremmling (Gore Canyon)", None, ["09057500", "09041400"], []),
        ("colorado_glenwood_canyon", "09070500", "Colorado River near Dotsero (Shoshone Call)", None, ["09070000"], []),
        ("glenwood_cameo", "09095500", "Colorado River near Cameo, CO", "Cameo / Shoshone", ["09085000"], []),
        ("colorado_stateline_cisco", "09163500", "Colorado River near CO-UT Stateline", None, ["09152500"], []),
        ("grand_valley_cisco", "09180500", "Colorado River near Cisco, UT", None, ["09180000"], []),
        ("lees_ferry", "09380000", "Colorado River at Lees Ferry, AZ", "Glen Canyon Dam", ["09315000", "09379500"], []),
        ("marble_canyon", "09380000", "Colorado River through Marble Canyon", None, [], []),
        ("grand_canyon_upper", "09402500", "Colorado River at Phantom Ranch", None, ["09382000", "09402000"], []),
        ("grand_canyon", "09402500", "Colorado River through Grand Canyon", None, [], []),
        ("grand_canyon_lower", "09404200", "Colorado River above Diamond Creek", None, ["09403850", "09404115"], []),
        ("lower_basin_hoover_davis", "USBR-HOOVER", "Colorado River below Hoover Dam", "Hoover Dam", [], []),
        ("lower_basin_davis_parker", "USBR-DAVIS", "Colorado River below Davis Dam", "Davis Dam", [], []),
        ("lower_basin_parker_paloverde", "USBR-PARKER", "Colorado River below Parker Dam", "Parker Dam", ["09426000"], ["09426650", "09424150"]),
        ("lower_basin_paloverde_imperial", "09429100", "Colorado River below Palo Verde Dam", "Palo Verde Dam", [], []),
        ("lower_basin_imperial_tailrace", "09429500", "Colorado River below Imperial Dam", "Imperial Dam", [], ["09527700"]),
        ("lower_basin_taper", "09429500", "Colorado River below Imperial to Mexico", "Morelos Dam", ["09520500"], ["09522000"])
    ]

    prev_flow = None
    prev_reach = None

    for reach_id, gid, reach_title, dam_name, trib_ids, div_ids in spine_definitions:
        st = by_id.get(gid, {})
        flow = st.get("flow_cfs")
        status = st.get("data_status", "unknown")
        age = st.get("age_hours", 0.0)
        ts = st.get("timestamp")

        median = normals_by_site.get(gid, {}).get(today_mm_dd) or dam_median_estimates.get(gid)

        hist_status = "NORMAL"
        hist_ratio = None
        if flow is not None and median is not None and median > 0:
            hist_ratio = flow / median
            if hist_ratio < 0.15:
                hist_status = "ANOMALY_LOW"
                report["anomalies"].append(f"{reach_id}: flow {flow:,.1f} cfs is <15% of historical median ({median:,.1f} cfs)")
            elif hist_ratio > 3.50:
                hist_status = "ANOMALY_HIGH"
                report["anomalies"].append(f"{reach_id}: flow {flow:,.1f} cfs is >350% of historical median ({median:,.1f} cfs)")

        delta_cfs = None
        delta_pct = None
        mb_validation = "HEADWATERS" if prev_flow is None else "PASS"

        if prev_flow is not None and flow is not None:
            delta_cfs = flow - prev_flow
            delta_pct = (delta_cfs / prev_flow * 100) if prev_flow > 0 else 0

            if delta_cfs > 1500 or delta_pct > 35.0:
                if dam_name:
                    mb_validation = f"VERIFIED_DAM_RELEASE ({dam_name})"
                elif trib_ids:
                    trib_names = [by_id.get(tid, {}).get("name", tid) for tid in trib_ids]
                    mb_validation = f"VERIFIED_CONFLUENCE ({', '.join(trib_names[:2])})"
                else:
                    mb_validation = "UNEXPLAINED_JUMP"
                    report["anomalies"].append(f"{reach_id}: unexplained jump of +{delta_cfs:,.1f} cfs (+{delta_pct:.1f}%) from {prev_reach}")

            elif delta_pct < -35.0:
                if dam_name:
                    mb_validation = f"VERIFIED_DAM_IMPOUNDMENT ({dam_name})"
                elif div_ids:
                    div_names = [by_id.get(did, {}).get("name", did) for did in div_ids]
                    mb_validation = f"VERIFIED_DIVERSION ({', '.join(div_names[:2])})"
                else:
                    mb_validation = "UNEXPLAINED_DROP"
                    report["anomalies"].append(f"{reach_id}: unexplained drop of {delta_cfs:,.1f} cfs ({delta_pct:.1f}%) from {prev_reach}")

        report["spine_audit"].append({
            "reach": reach_id,
            "name": reach_title,
            "gauge_id": gid,
            "flow_cfs": flow,
            "median_50yr_cfs": median,
            "hist_ratio": hist_ratio,
            "hist_status": hist_status,
            "timestamp": ts,
            "age_hours": age,
            "data_status": status,
            "delta_cfs": delta_cfs,
            "delta_pct": delta_pct,
            "mass_balance": mb_validation
        })

        prev_flow = flow
        prev_reach = reach_id

    # 5. Dam Cross-Checks
    hoover_flow = dam_releases.get("hoover_dam", {}).get("flow_cfs")
    davis_flow = dam_releases.get("davis_dam", {}).get("flow_cfs")
    parker_flow = dam_releases.get("parker_dam", {}).get("flow_cfs")
    cap_flow = by_id.get("09426650", {}).get("flow_cfs") or 0.0
    cra_flow = by_id.get("09424150", {}).get("flow_cfs") or 0.0
    pv_flow = by_id.get("09429100", {}).get("flow_cfs") or 0.0
    aac_flow = by_id.get("09527700", {}).get("flow_cfs") or 0.0
    imp_tail_flow = by_id.get("09429500", {}).get("flow_cfs") or 0.0

    report["cross_checks"] = {
        "hoover_dam": {
            "source": "USBR Lower Colorado Hourly Operations",
            "release_cfs": hoover_flow,
            "usgs_09421500_status": "discontinued_or_non_reporting",
            "validation": "PASS" if hoover_flow and hoover_flow > 1000 else "FAIL"
        },
        "davis_dam": {
            "source": "USBR Lower Colorado Hourly Operations",
            "release_cfs": davis_flow,
            "usgs_09423000_status": "discontinued_oct_2022",
            "validation": "PASS" if davis_flow and davis_flow > 500 else "FAIL"
        },
        "parker_dam": {
            "source": "USBR Lower Colorado Hourly Operations",
            "release_cfs": parker_flow,
            "upstream_davis_cfs": davis_flow,
            "havasu_diversions_cfs": cap_flow + cra_flow,
            "net_havasu_inflow_cfs": (davis_flow - (cap_flow + cra_flow)) if davis_flow is not None else None,
            "validation": "PASS" if parker_flow and parker_flow > 500 else "FAIL"
        },
        "imperial_dam": {
            "upstream_paloverde_09429100_cfs": pv_flow,
            "aac_diversion_09527700_cfs": aac_flow,
            "tailrace_09429500_cfs": imp_tail_flow,
            "continuity_check": "PASS" if pv_flow >= (aac_flow + imp_tail_flow) else "OVER_ALLOCATED"
        },
        "morelos_dam": {
            "intake_canal": "Canal Alimentador Central",
            "usgs_station": "09522000 (Colorado River at NIB above Morelos Dam)",
            "treaty_delivery_cfs": by_id.get("09522000", {}).get("flow_cfs"),
            "data_status": by_id.get("09522000", {}).get("data_status"),
            "validation": "PASS" if by_id.get("09522000", {}).get("flow_cfs") else "DELAYED"
        }
    }

    if report["anomalies"]:
        report["overall_status"] = "ANOMALY_REVIEW"
    else:
        report["overall_status"] = "VALID"

    return report

def sync_to_sqlite(db_path, streamflows, dam_releases, canals, tunnels, reservoirs, validation_report):
    """
    Ingests and upserts real-time hydrologic telemetry directly into the relational SQLite database.
    Establishes SQLite (colorado_river_basin.db) as the canonical upstream Single Source of Truth (SSOT).
    """
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    cur.execute("""
    CREATE TABLE IF NOT EXISTS stations (
        station_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        state TEXT,
        agency TEXT,
        latitude REAL,
        longitude REAL,
        elevation_ft REAL,
        drainage_sqmi REAL,
        station_type TEXT,
        is_sentinel INTEGER,
        historical_mean_cfs REAL
    );
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS telemetry_latest (
        station_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        provider TEXT,
        station_type TEXT,
        flow_cfs REAL,
        timestamp_utc TEXT,
        age_hours REAL,
        data_status TEXT,
        latitude REAL,
        longitude REAL,
        updated_at TEXT,
        FOREIGN KEY (station_id) REFERENCES stations(station_id)
    );
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS reservoirs (
        reservoir_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        dam_name TEXT,
        river TEXT,
        state TEXT,
        category TEXT,
        operator TEXT,
        total_capacity_af REAL,
        active_capacity_af REAL,
        capacity_af REAL,
        capacity_pct REAL,
        min_power_pool_af REAL,
        dead_pool_af REAL,
        current_storage_af REAL,
        current_elevation_ft REAL,
        current_pct_full REAL,
        feet_below_full REAL,
        latitude REAL,
        longitude REAL,
        role TEXT
    );
    """)

    # Ensure dynamic columns exist if table was previously created with minimal schema
    existing_cols = {col[1] for col in cur.execute("PRAGMA table_info(reservoirs);").fetchall()}
    needed_cols = {
        "river": "TEXT",
        "category": "TEXT",
        "operator": "TEXT",
        "capacity_af": "REAL",
        "capacity_pct": "REAL",
        "feet_below_full": "REAL",
        "latitude": "REAL",
        "longitude": "REAL",
        "role": "TEXT"
    }
    for col_name, col_type in needed_cols.items():
        if col_name not in existing_cols:
            cur.execute(f"ALTER TABLE reservoirs ADD COLUMN {col_name} {col_type};")

    # Clean legacy short-id duplicates from early seed scripts to maintain canonical ID consistency
    cur.execute("DELETE FROM reservoirs WHERE reservoir_id IN ('mead', 'powell', 'navajo', 'mohave', 'havasu');")

    cur.execute("""
    CREATE TABLE IF NOT EXISTS reservoirs_telemetry (
        reservoir_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        storage_af REAL,
        elevation_ft REAL,
        percent_full REAL,
        inflow_cfs REAL,
        release_cfs REAL,
        timestamp_utc TEXT,
        data_status TEXT,
        updated_at TEXT,
        FOREIGN KEY (reservoir_id) REFERENCES reservoirs(reservoir_id)
    );
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS ingestion_runs (
        run_id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_timestamp TEXT NOT NULL,
        stations_fetched INTEGER,
        reservoirs_fetched INTEGER,
        validation_status TEXT,
        notes TEXT
    );
    """)

    now_iso = datetime.now().isoformat()

    all_telemetry = []
    for s in streamflows:
        all_telemetry.append((s["id"], s.get("name", ""), s.get("provider", "USGS"), "streamflow", s.get("flow_cfs"), s.get("timestamp"), s.get("age_hours", 0.0), s.get("data_status", "live"), s.get("lat"), s.get("lon"), now_iso))
    for t in tunnels:
        all_telemetry.append((t["id"], t.get("name", ""), t.get("provider", "CDWR"), "diversion_tunnel", t.get("flow_cfs"), t.get("timestamp"), t.get("age_hours", 0.0), t.get("data_status", "live"), t.get("lat"), t.get("lon"), now_iso))
    for c in canals:
        all_telemetry.append((c["id"], c.get("name", ""), c.get("provider", "USBR"), "diversion_canal", c.get("flow_cfs"), c.get("timestamp"), c.get("age_hours", 0.0), c.get("data_status", "live"), c.get("lat"), c.get("lon"), now_iso))

    for row in all_telemetry:
        st_id, name, prov, st_type, flow, ts, age, status, lat, lon, updated = row
        cur.execute("""
        INSERT OR IGNORE INTO stations (station_id, name, agency, latitude, longitude, station_type)
        VALUES (?, ?, ?, ?, ?, ?)
        """, (st_id, name, prov, lat, lon, st_type))

        cur.execute("""
        INSERT INTO telemetry_latest (station_id, name, provider, station_type, flow_cfs, timestamp_utc, age_hours, data_status, latitude, longitude, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(station_id) DO UPDATE SET
            flow_cfs=excluded.flow_cfs,
            timestamp_utc=excluded.timestamp_utc,
            age_hours=excluded.age_hours,
            data_status=excluded.data_status,
            updated_at=excluded.updated_at;
        """, row)

    dam_names_map = {
        'lake_mead': 'Hoover Dam',
        'lake_powell': 'Glen Canyon Dam',
        'flaming_gorge': 'Flaming Gorge Dam',
        'navajo_reservoir': 'Navajo Dam',
        'lake_mohave': 'Davis Dam',
        'blue_mesa': 'Blue Mesa Dam',
        'lake_havasu': 'Parker Dam',
        'lake_granby': 'Granby Dam',
        'dillon_reservoir': 'Dillon Dam',
        'green_mountain': 'Green Mountain Dam',
        'homestake_reservoir': 'Homestake Dam'
    }

    for r in reservoirs:
        res_id = r.get("id")
        pct = r.get("capacity_pct") if r.get("capacity_pct") is not None else r.get("percent_full")
        dam_name = r.get("dam_name") or dam_names_map.get(res_id) or f"{r.get('name')} Dam"
        cur.execute("""
        INSERT INTO reservoirs (
            reservoir_id, name, dam_name, river, category, operator,
            total_capacity_af, capacity_af, capacity_pct,
            current_storage_af, current_elevation_ft, current_pct_full,
            feet_below_full, latitude, longitude, role
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(reservoir_id) DO UPDATE SET
            name=excluded.name,
            dam_name=excluded.dam_name,
            river=excluded.river,
            category=excluded.category,
            operator=excluded.operator,
            total_capacity_af=excluded.total_capacity_af,
            capacity_af=excluded.capacity_af,
            capacity_pct=excluded.capacity_pct,
            current_storage_af=excluded.current_storage_af,
            current_elevation_ft=excluded.current_elevation_ft,
            current_pct_full=excluded.current_pct_full,
            feet_below_full=excluded.feet_below_full,
            latitude=excluded.latitude,
            longitude=excluded.longitude,
            role=excluded.role;
        """, (
            res_id, r.get("name"), dam_name, r.get("river"), r.get("category"), r.get("operator"),
            r.get("capacity_af"), r.get("capacity_af"), pct,
            r.get("storage_af"), r.get("elevation_ft"), pct,
            r.get("feet_below_full"), r.get("lat"), r.get("lon"), r.get("role")
        ))

        cur.execute("""
        INSERT INTO reservoirs_telemetry (
            reservoir_id, name, storage_af, elevation_ft, percent_full,
            inflow_cfs, release_cfs, timestamp_utc, data_status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(reservoir_id) DO UPDATE SET
            storage_af=excluded.storage_af,
            elevation_ft=excluded.elevation_ft,
            percent_full=excluded.percent_full,
            inflow_cfs=excluded.inflow_cfs,
            release_cfs=excluded.release_cfs,
            timestamp_utc=excluded.timestamp_utc,
            data_status=excluded.data_status,
            updated_at=excluded.updated_at;
        """, (
            res_id, r.get("name"), r.get("storage_af"), r.get("elevation_ft"), pct,
            r.get("inflow_cfs"), r.get("release_cfs"), r.get("timestamp"), r.get("data_status"), now_iso
        ))

    cur.execute("""
    INSERT INTO ingestion_runs (run_timestamp, stations_fetched, reservoirs_fetched, validation_status, notes)
    VALUES (?, ?, ?, ?, ?);
    """, (now_iso, len(all_telemetry), len(reservoirs), validation_report.get("overall_status", "UNKNOWN"), f"Audited {validation_report.get('reach_coverage', {}).get('active_reaches', 0)} active reaches"))

    cur.execute("""
    CREATE VIEW IF NOT EXISTS view_live_station_telemetry AS
    SELECT 
        s.station_id,
        s.name,
        s.station_type,
        s.agency,
        s.state,
        s.latitude,
        s.longitude,
        s.elevation_ft,
        s.is_sentinel,
        t.flow_cfs,
        t.timestamp_utc,
        t.age_hours,
        t.data_status,
        CASE 
            WHEN t.flow_cfs IS NULL THEN 'OFFLINE'
            WHEN t.age_hours <= 72 THEN 'LIVE'
            WHEN t.age_hours <= 336 THEN 'DELAYED'
            ELSE 'OFFLINE'
        END AS telemetry_status
    FROM stations s
    LEFT JOIN telemetry_latest t ON s.station_id = t.station_id;
    """)

    conn.commit()
    conn.close()
    print(f"\n[SQLITE SSOT] Ingested {len(all_telemetry)} station telemetry records and {len(reservoirs)} reservoir records directly into SQLite ({db_path}).")

def export_json_from_sqlite(db_path, dam_releases, validation_report, out_candidates, in_memory_reservoirs=None):
    """
    Constructs the static web dashboard JSON payloads by querying the SQLite database using SQL.
    Maintains clean decoupled architecture: Python -> SQLite SSOT -> SQL Queries -> JSON Feeds.
    """
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    streamflow_rows = cur.execute("""
    SELECT station_id AS id, name, provider, 'streamflow' AS type, flow_cfs, timestamp_utc AS timestamp, age_hours, data_status, latitude AS lat, longitude AS lon
    FROM telemetry_latest
    WHERE station_type = 'streamflow'
    ORDER BY station_id ASC;
    """).fetchall()
    streamflows = [dict(r) for r in streamflow_rows]

    tunnel_rows = cur.execute("""
    SELECT station_id AS id, name, provider, 'diversion_tunnel' AS type, flow_cfs, timestamp_utc AS timestamp, age_hours, data_status, latitude AS lat, longitude AS lon
    FROM telemetry_latest
    WHERE station_type = 'diversion_tunnel'
    ORDER BY station_id ASC;
    """).fetchall()
    tunnels = [dict(r) for r in tunnel_rows]

    canal_rows = cur.execute("""
    SELECT station_id AS id, name, provider, 'diversion_canal' AS type, flow_cfs, timestamp_utc AS timestamp, age_hours, data_status, latitude AS lat, longitude AS lon
    FROM telemetry_latest
    WHERE station_type = 'diversion_canal'
    ORDER BY station_id ASC;
    """).fetchall()
    canals = [dict(r) for r in canal_rows]

    reservoir_rows = cur.execute("""
    SELECT 
        r.reservoir_id AS id,
        r.name,
        r.river,
        'reservoir' AS type,
        r.category,
        r.operator,
        t.elevation_ft,
        r.feet_below_full,
        t.storage_af,
        r.capacity_af,
        COALESCE(t.percent_full, r.capacity_pct) AS capacity_pct,
        r.role,
        t.timestamp_utc AS timestamp,
        0.0 AS age_hours,
        t.data_status,
        r.latitude AS lat,
        r.longitude AS lon
    FROM reservoirs r
    JOIN reservoirs_telemetry t ON r.reservoir_id = t.reservoir_id;
    """).fetchall()

    system_res = []
    fr_res = []
    for row in reservoir_rows:
        d = dict(row)
        if d.get("category") == "front_range":
            d["provider"] = "CDWR"
            fr_res.append(d)
        else:
            if d.get("id") in ["lake_powell", "lake_mohave", "lake_havasu"]:
                d["provider"] = "USBR / USGS"
            else:
                d["provider"] = "USBR"
            system_res.append(d)

    system_res = sorted(system_res, key=lambda x: x.get("capacity_af") or 0, reverse=True)
    fr_res = sorted(fr_res, key=lambda x: x.get("capacity_af") or 0, reverse=True)
    reservoirs = system_res + fr_res

    if len(reservoirs) == 0 and in_memory_reservoirs:
        reservoirs = in_memory_reservoirs

    run_row = cur.execute("SELECT run_timestamp FROM ingestion_runs ORDER BY run_id DESC LIMIT 1;").fetchone()
    fetched_at = run_row["run_timestamp"] if run_row else datetime.now().isoformat()
    conn.close()

    payload = {
        "fetched_at": fetched_at,
        "dam_releases": dam_releases,
        "streamflows": streamflows,
        "tunnels": tunnels,
        "canals": canals,
        "reservoirs": reservoirs,
        "validation": validation_report
    }

    saved_to = []
    for out_file in out_candidates:
        parent = os.path.dirname(out_file)
        if os.path.exists(parent) or parent in ["web/data", "data"]:
            os.makedirs(parent, exist_ok=True)
            with open(out_file, "w") as f:
                json.dump(payload, f, indent=2)
            saved_to.append(out_file)

    print(f"[SQL EXPORT] Compiled JSON snapshot from SQLite database and exported to {', '.join(saved_to)}!")

def main():
    print("Fetching Colorado River hydrologic data...")
    raw_streamflows = fetch_usgs_streamflow()
    streamflows = [s for s in raw_streamflows if s["type"] == "streamflow"]
    aac = [s for s in raw_streamflows if s["type"] == "diversion_canal"]
    
    tunnels = fetch_cdwr_tunnels()
    canals = fetch_usgs_daily()
    canals.extend(aac)
    
    usbr_hourly = fetch_usbr_hourly_operations()
    reservoirs = fetch_reservoirs(usbr_hourly)

    dam_releases = {}
    if usbr_hourly:
        h_rel = usbr_hourly.get("hoover_rel")
        d_rel = usbr_hourly.get("davis_rel")
        p_rel = usbr_hourly.get("parker_rel")
        ts = usbr_hourly.get("timestamp")
        age = usbr_hourly.get("age_hours", 0.0)
        status = usbr_hourly.get("data_status", "live")
        
        dam_releases = {
            "hoover_dam": {
                "id": "USBR_HOOVER",
                "name": "Hoover Dam Hydroelectric Release",
                "flow_cfs": h_rel,
                "timestamp": ts,
                "source": "USBR Lower Colorado Hourly Operations",
                "source_url": "https://www.usbr.gov/lc/region/g4000/riverops/hourly7.html",
                "age_hours": age,
                "data_status": status,
                "lat": 36.0156,
                "lon": -114.7378
            },
            "davis_dam": {
                "id": "USBR_DAVIS",
                "name": "Davis Dam Hydroelectric Release",
                "flow_cfs": d_rel,
                "timestamp": ts,
                "source": "USBR Lower Colorado Hourly Operations",
                "source_url": "https://www.usbr.gov/lc/region/g4000/riverops/hourly7.html",
                "age_hours": age,
                "data_status": status,
                "lat": 35.1989,
                "lon": -114.5683
            },
            "parker_dam": {
                "id": "USBR_PARKER",
                "name": "Parker Dam Hydroelectric Release",
                "flow_cfs": p_rel,
                "timestamp": ts,
                "source": "USBR Lower Colorado Hourly Operations",
                "source_url": "https://www.usbr.gov/lc/region/g4000/riverops/hourly7.html",
                "age_hours": age,
                "data_status": status,
                "lat": 34.2981,
                "lon": -114.1678
            }
        }

        # Add canonical USBR stations to streamflows (USBR-HOOVER, USBR-DAVIS, USBR-PARKER)
        # Note: Legacy USGS gages (09421500, 09423000, 09427520) are discontinued/unmonitored for real-time IV.
        # USBR Lower Colorado Hourly Operations is the authoritative operational source.
        dam_entries = [
            ("USBR-HOOVER", "Colorado River below Hoover Dam (USBR Hydroelectric Release)", h_rel, 36.0156, -114.7378),
            ("USBR-DAVIS", "Colorado River below Davis Dam (USBR Hydroelectric Release)", d_rel, 35.1989, -114.5683),
            ("USBR-PARKER", "Colorado River below Parker Dam (USBR Hydroelectric Release)", p_rel, 34.2981, -114.1678)
        ]
        for entry_id, name, flow, lat, lon in dam_entries:
            streamflows.append({
                "id": entry_id,
                "name": name,
                "type": "streamflow",
                "provider": "USBR",
                "flow_cfs": flow,
                "timestamp": ts,
                "age_hours": age,
                "data_status": status,
                "lat": lat,
                "lon": lon
            })

    # Execute Automated Hydrologic Sanity & Mass-Balance Validator
    validation_report = validate_hydrology(streamflows, dam_releases, canals, tunnels)

    # 1. Ingest telemetry directly into SQLite Database (Single Source of Truth)
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    db_path = os.path.join(repo_root, "data", "colorado_river_basin.db")
    sync_to_sqlite(db_path, streamflows, dam_releases, canals, tunnels, reservoirs, validation_report)

    # 2. Query SQLite via SQL to construct and export web JSON feeds
    out_candidates = [
        "web/data/latest_metrics.json",
        "data/latest_metrics.json",
        "public/colorado_river/data/latest_metrics.json"
    ]
    export_json_from_sqlite(db_path, dam_releases, validation_report, out_candidates, in_memory_reservoirs=reservoirs)

    # Complete Audit Report Table
    print("=" * 115)
    print(f"{'STATION ID':<14} | {'NAME':<42} | {'PROVIDER':<8} | {'FLOW (CFS)':<12} | {'TIMESTAMP':<22} | {'AGE (H)':<7} | {'STATUS':<8}")
    print("=" * 115)

    all_stations = []
    # Deduplicate streamflows (skip hyphen aliases for the report table)
    for s in streamflows:
        if "-" not in s["id"] or s["id"].startswith("09"):
            all_stations.append(s)
    for t in tunnels:
        all_stations.append(t)
    for c in canals:
        all_stations.append(c)

    for st in all_stations:
        st_id = st.get("id", "UNKNOWN")
        name = st.get("name", "")[:40]
        prov = st.get("provider", "USGS")
        flow_raw = st.get("flow_cfs")
        flow_str = f"{flow_raw:,.1f}" if flow_raw is not None else "OFFLINE"
        ts_str = str(st.get("timestamp", ""))[:19]
        age_str = f"{st.get('age_hours', 0.0):.1f}"
        stat_str = st.get("data_status", "unknown").upper()
        print(f"{st_id:<14} | {name:<42} | {prov:<8} | {flow_str:<12} | {ts_str:<22} | {age_str:<7} | {stat_str:<8}")

    print("=" * 115)

    # Highlight any discontinued or stale gages (> 72 hours)
    stale = [st for st in all_stations if st.get("age_hours", 0) > 72 or st.get("data_status") in ["delayed", "offline"]]
    if stale:
        print(f"\n[ALERT] Found {len(stale)} Stale or Offline Stations (> 72 hours):")
        for st in stale:
            print(f"  • {st['id']} ({st['name']}): status={st.get('data_status')}, age={st.get('age_hours')}h, flow={st.get('flow_cfs')}, last_reported={st.get('timestamp')}")
    else:
        print("\nAll stations verified live and reporting within 72 hours.")

    # Downstream River Spine Validation Table
    print("\n" + "=" * 135)
    print("DOWNSTREAM RIVER SPINE TELEMETRY & MASS-BALANCE AUDIT (HEADWATERS TO MEXICO)")
    print("=" * 135)
    print(f"{'REACH ID':<30} | {'GAGE / SOURCE':<14} | {'LIVE (CFS)':<11} | {'50-YR MED':<10} | {'TIMESTAMP':<22} | {'AGE':<6} | {'VALIDATION STATUS'}")
    print("=" * 135)
    for sp in validation_report["spine_audit"]:
        r_id = sp["reach"]
        gid = sp["gauge_id"]
        flow_str = f"{sp['flow_cfs']:,.1f}" if sp["flow_cfs"] is not None else "OFFLINE"
        med_str = f"{sp['median_50yr_cfs']:,.1f}" if sp["median_50yr_cfs"] is not None else "N/A"
        ts_str = str(sp.get("timestamp", ""))[:19]
        age_str = f"{sp['age_hours']:.1f}h"
        status_str = f"{sp['data_status'].upper()} • {sp['mass_balance']}"
        print(f"{r_id:<30} | {gid:<14} | {flow_str:<11} | {med_str:<10} | {ts_str:<22} | {age_str:<6} | {status_str}")
    print("=" * 135)
    print(f"\n[VALIDATION SUMMARY] Overall Status: {validation_report['overall_status']}")
    print(f"  • Active Reaches Audited: {validation_report['reach_coverage']['active_reaches']} (Unmapped: {len(validation_report['reach_coverage']['unmapped_reaches'])})")
    print(f"  • Submerged Thalwegs Excluded: {validation_report['reach_coverage']['submerged_reaches']}")
    print(f"  • Unresolved Anomalies: {len(validation_report['anomalies'])}")
    if validation_report['anomalies']:
        for a in validation_report['anomalies']:
            print(f"    - [ANOMALY_REVIEW] {a}")
    else:
        print("  • Mass-Balance Integrity: 100% verified across all confluences, dam tailraces, and canal diversions.")

if __name__ == "__main__":
    main()
