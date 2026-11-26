#!/usr/bin/env python3
"""
Pure SQLite-to-JSON Exporter (Single Source of Truth -> Frontend Contracts).

Reads ONLY from data/colorado_river_basin.db (zero HTTP requests, zero synthetic
fallbacks) and writes all non-GeoJSON static JSON payloads in web/data/ and data/:
  - latest_metrics.json
  - portal_historical.json
  - seasonal_regimes.json
  - tributary_hydrology.json
  - station_hierarchy.json
  - historical_normals.json
  - water_budget.json
  - provenance_registry.json
  - replay_7d.json / replay_30d.json
"""

import argparse
import json
import os
import sqlite3
from datetime import datetime, timezone

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(REPO_ROOT, "data", "colorado_river_basin.db")
_PRIMARY_WEB_DATA = os.path.join(REPO_ROOT, "web", "data")
_PORTFOLIO_WEB_DATA = os.path.join(REPO_ROOT, "public", "colorado_river", "data")
WEB_DATA_DIR = (
    _PORTFOLIO_WEB_DATA
    if (not os.path.isdir(_PRIMARY_WEB_DATA) and os.path.isdir(os.path.join(REPO_ROOT, "public", "colorado_river")))
    else _PRIMARY_WEB_DATA
)
DATA_DIR = os.path.join(REPO_ROOT, "data")

MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]


def get_conn(db_path: str = DB_PATH) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def export_latest_metrics(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()
    streamflows = [
        dict(r) for r in cur.execute("""
            SELECT station_id AS id, name, provider, 'streamflow' AS type,
                   flow_cfs, timestamp_utc AS timestamp, age_hours, data_status,
                   latitude AS lat, longitude AS lon
            FROM telemetry_latest
            WHERE station_type = 'streamflow'
            ORDER BY station_id ASC
        """).fetchall()
    ]
    tunnels = [
        dict(r) for r in cur.execute("""
            SELECT station_id AS id, name, provider, 'diversion_tunnel' AS type,
                   flow_cfs, timestamp_utc AS timestamp, age_hours, data_status,
                   latitude AS lat, longitude AS lon
            FROM telemetry_latest
            WHERE station_type = 'diversion_tunnel'
            ORDER BY station_id ASC
        """).fetchall()
    ]
    canals = [
        dict(r) for r in cur.execute("""
            SELECT station_id AS id, name, provider, 'diversion_canal' AS type,
                   flow_cfs, timestamp_utc AS timestamp, age_hours, data_status,
                   latitude AS lat, longitude AS lon
            FROM telemetry_latest
            WHERE station_type = 'diversion_canal'
            ORDER BY station_id ASC
        """).fetchall()
    ]

    res_rows = cur.execute("""
        SELECT r.reservoir_id AS id, r.name, r.river, 'reservoir' AS type,
               r.category, r.operator, t.elevation_ft, r.feet_below_full,
               t.storage_af, r.capacity_af,
               COALESCE(t.percent_full, r.capacity_pct) AS capacity_pct,
               r.role, t.timestamp_utc AS timestamp, 0.0 AS age_hours,
               t.data_status, r.latitude AS lat, r.longitude AS lon
        FROM reservoirs r
        JOIN reservoirs_telemetry t ON r.reservoir_id = t.reservoir_id
    """).fetchall()

    sys_res, fr_res = [], []
    for row in res_rows:
        d = dict(row)
        if d.get("category") == "front_range":
            d["provider"] = "CDWR"
            fr_res.append(d)
        else:
            d["provider"] = "USBR / USGS" if d.get("id") in ("lake_powell", "lake_mohave", "lake_havasu") else "USBR"
            sys_res.append(d)
    sys_res.sort(key=lambda x: x.get("capacity_af") or 0, reverse=True)
    fr_res.sort(key=lambda x: x.get("capacity_af") or 0, reverse=True)
    reservoirs = sys_res + fr_res

    dam_releases = {}
    for dr in cur.execute("SELECT * FROM dam_releases_latest").fetchall():
        dam_releases[dr["dam_key"]] = {
            "id": dr["station_id"],
            "name": dr["name"],
            "flow_cfs": dr["flow_cfs"],
            "timestamp": dr["timestamp_utc"],
            "source": dr["source"],
            "source_url": dr["source_url"],
            "age_hours": dr["age_hours"],
            "data_status": dr["data_status"],
            "lat": dr["lat"],
            "lon": dr["lon"],
        }

    run_row = cur.execute("SELECT run_timestamp, validation_json FROM ingestion_runs ORDER BY run_id DESC LIMIT 1").fetchone()
    fetched_at = run_row["run_timestamp"] if run_row else datetime.now(timezone.utc).isoformat()
    validation = json.loads(run_row["validation_json"]) if (run_row and run_row["validation_json"]) else {}

    payload = {
        "fetched_at": fetched_at,
        "dam_releases": dam_releases,
        "streamflows": streamflows,
        "tunnels": tunnels,
        "canals": canals,
        "reservoirs": reservoirs,
        "validation": validation,
    }
    for out_path in (
        os.path.join(WEB_DATA_DIR, "latest_metrics.json"),
        os.path.join(DATA_DIR, "latest_metrics.json"),
    ):
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)
    print(f"[EXPORT] latest_metrics.json ({len(streamflows)} gages, {len(reservoirs)} reservoirs)")


def export_portal_historical(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()

    def build_matrix(rid: str):
        rows = cur.execute(
            "SELECT * FROM reservoir_monthly_history WHERE reservoir_id=? ORDER BY year ASC",
            (rid,),
        ).fetchall()
        out = []
        for r in rows:
            elevs = {m: r[m.lower()] for m in MONTHS}
            out.append({
                "year": r["year"],
                "elevations": elevs,
                "min": r["annual_min"],
                "max": r["annual_max"],
                "mean": r["annual_mean"],
                "range": r["annual_range"],
            })
        return out

    powell_wy = [
        {
            "year": r["water_year"],
            "min_af": r["min_af"],
            "max_af": r["max_af"],
            "mean_af": r["mean_af"],
            "year_end_af": r["year_end_af"],
        }
        for r in cur.execute("SELECT * FROM reservoir_wy_storage WHERE reservoir_id='lake_powell' ORDER BY water_year ASC").fetchall()
    ]

    lees_daily = [
        {"date": r["obs_date"], "cfs": int(round(r["cfs"]))}
        for r in cur.execute("SELECT obs_date, cfs FROM lees_ferry_daily_recent ORDER BY obs_date ASC").fetchall()
    ]

    timeline = [
        {
            "year": r["year"],
            "as_of_date": r["as_of_date"],
            "mead_maf": r["mead_maf"],
            "powell_maf": r["powell_maf"],
            "flaming_gorge_maf": r["flaming_gorge_maf"],
            "navajo_maf": r["navajo_maf"],
            "blue_mesa_maf": r["blue_mesa_maf"],
            "dillon_maf": r["dillon_maf"],
            "granby_maf": r["granby_maf"],
            "total_major_storage_maf": r["total_major_storage_maf"],
        }
        for r in cur.execute("SELECT * FROM basin_storage_timeline ORDER BY year ASC").fetchall()
    ]

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "monthly_aggregation_method": "End-of-Month (EOM)",
        "lake_mead_historical": build_matrix("lake_mead"),
        "lake_powell_historical": powell_wy,
        "lees_ferry_daily": lees_daily,
        "lake_powell_elevation_historical": build_matrix("lake_powell"),
        "flaming_gorge_elevation_historical": build_matrix("flaming_gorge"),
        "navajo_elevation_historical": build_matrix("navajo_reservoir"),
        "blue_mesa_elevation_historical": build_matrix("blue_mesa"),
        "dillon_elevation_historical": build_matrix("dillon_reservoir"),
        "basin_storage_timeline": timeline,
    }
    out_path = os.path.join(WEB_DATA_DIR, "portal_historical.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"[EXPORT] portal_historical.json ({len(timeline)} timeline yrs, {len(lees_daily)} daily LF pts)")


def export_seasonal_regimes(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()
    lf_rows = cur.execute(
        "SELECT * FROM annual_lees_ferry WHERE in_compact_era = 1 ORDER BY water_year ASC"
    ).fetchall()

    annual_ts = []
    for r in lf_rows:
        sup = round(float(r["natural_flow_maf"]), 2)
        rel = round(float(r["gaged_flow_maf"]), 2) if r["gaged_flow_maf"] is not None else None
        annual_ts.append({
            "wy": r["water_year"],
            "supply_maf": sup,
            "lees_ferry_release_maf": rel,
            "surplus_deficit_maf": round(sup - 16.5, 2),
            "meets_compact": bool(sup >= 16.5),
        })

    n_all = len(annual_ts)
    p_all = round(sum(1 for x in annual_ts if x["meets_compact"]) / n_all * 100.0, 1) if n_all else 0.0
    def_pct_all = round(100.0 - p_all, 1)
    modern = [x for x in annual_ts if x["wy"] >= 2000]
    def_2000 = sum(1 for x in modern if not x["meets_compact"])
    p_2000 = round((len(modern) - def_2000) / len(modern) * 100.0, 1) if modern else 0.0

    hb_rows = cur.execute("SELECT * FROM seasonal_heartbeats ORDER BY doy ASC").fetchall()
    sd_rows = cur.execute("SELECT * FROM seasonal_supply_demand ORDER BY doy ASC").fetchall()
    s_meta = dict(cur.execute("SELECT meta_key, meta_value FROM seasonal_meta").fetchall())

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "compact_accounting_100yr": {
            "source_id": "usbr_lf_natflow_1906_2024",
            "source_url": "https://www.usbr.gov/lc/region/g4000/NaturalFlow/LFnatFlow1906-2024.2024.9.12.xlsx",
            "start_wy": annual_ts[0]["wy"] if annual_ts else None,
            "end_wy": annual_ts[-1]["wy"] if annual_ts else None,
            "exceedance_probability_1922_2024_pct": p_all,
            "deficit_probability_1922_2024_pct": def_pct_all,
            "exceedance_probability_2000_2024_pct": p_2000,
            "deficit_years_since_2000": def_2000,
            "total_years_since_2000": len(modern),
            "paper_water_allocation_maf": 16.5,
            "upper_basin_statutory_maf": 7.5,
            "lower_basin_statutory_maf": 7.5,
            "mexico_treaty_maf": 1.5,
            "annual_time_series": annual_ts,
        },
        "seasonal_heartbeats": {
            "doy": [r["doy"] for r in hb_rows],
            "monsoon_stations": ["09402000", "09382000"],
            "regimes": {
                "alpine_snowmelt": [r["alpine_snowmelt"] for r in hb_rows],
                "front_range_tunnels": [r["front_range_tunnels"] for r in hb_rows],
                "monsoon_tributaries": [r["monsoon_tributaries"] for r in hb_rows],
                "regulated_dam_releases": [r["regulated_dam_releases"] for r in hb_rows],
                "lower_basin_canals": [r["lower_basin_canals"] for r in hb_rows],
            },
        },
        "supply_demand_mismatch": {
            "period": "WY 2000-2024",
            "doy": [r["doy"] for r in sd_rows],
            "supply_cfs": [r["supply_cfs"] for r in sd_rows],
            "demand_cfs": [r["demand_cfs"] for r in sd_rows],
            "surplus_days": int(s_meta.get("surplus_days", 0)),
            "deficit_days": int(s_meta.get("deficit_days", 0)),
            "spring_peak_cfs": int(s_meta.get("spring_peak_cfs", 0)),
            "winter_base_cfs": int(s_meta.get("winter_base_cfs", 0)),
            "mean_release_cfs": int(s_meta.get("mean_release_cfs", 0)),
        },
    }
    out_path = os.path.join(WEB_DATA_DIR, "seasonal_regimes.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"[EXPORT] seasonal_regimes.json ({n_all} water years, zero synthetic blocks)")


def export_tributary_hydrology(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()
    tribs = [
        {
            "id": r["station_id"],
            "short_name": r["short_name"],
            "name": r["name"],
            "regime": r["regime"],
            "is_terminal_inflow": bool(r["is_terminal_inflow"]),
            "approx_miles_to_powell": r["approx_miles_to_powell"],
            "complete_water_years": r["complete_water_years"],
            "annual_maf": r["annual_maf"],
            "rbi": r["rbi"],
            "median_cfs": r["median_cfs"],
            "max_daily_cfs": r["max_daily_cfs"],
            "max_daily_date": r["max_daily_date"],
            "peak_to_median": r["peak_to_median"],
            "usgs_url": r["usgs_url"],
            "inflow_share_pct": r["inflow_share_pct"],
        }
        for r in cur.execute("SELECT * FROM tributary_summaries ORDER BY rowid ASC").fetchall()
    ]
    term_tot = round(sum(t["annual_maf"] for t in tribs if t["is_terminal_inflow"]), 3)

    curve = [
        {
            "elev_ft": r["elev_ft"],
            "sample_elev_ft": r["sample_elev_ft"],
            "storage_af": r["storage_af"],
            "sample_latest_date": r["sample_latest_date"],
            "n_samples": r["n_samples"],
            "af_per_ft": r["af_per_ft"],
            "k_af_per_ft": r["k_af_per_ft"],
            "storage_maf": r["storage_maf"],
            "rise_ft_per_100k_af": r["rise_ft_per_100k_af"],
        }
        for r in cur.execute("SELECT * FROM powell_hypsometry_curve ORDER BY elev_ft ASC").fetchall()
    ]
    h_meta = dict(cur.execute("SELECT meta_key, meta_value FROM powell_hypsometry_meta").fetchall())
    min_af_ft = int(h_meta["min_power_af_per_ft"])
    cur_af_ft = int(h_meta["current_af_per_ft"])
    full_af_ft = int(h_meta["full_pool_af_per_ft"])

    ev_rows = cur.execute("SELECT * FROM event_hydrograph_comparison ORDER BY obs_date ASC").fetchall()
    e_meta = dict(cur.execute("SELECT meta_key, meta_value FROM event_hydrograph_meta").fetchall())

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "period": "WY 2016-2025 (2015-10-01 to 2025-09-30)",
        "terminal_inflow_total_maf": term_tot,
        "tributaries": tribs,
        "powell_hypsometry": {
            "latest_date": h_meta["latest_date"],
            "latest_elev_ft": float(h_meta["latest_elev_ft"]),
            "latest_storage_af": int(h_meta["latest_storage_af"]),
            "latest_storage_maf": float(h_meta["latest_storage_maf"]),
            "elev_csv_url": "https://www.usbr.gov/uc/water/hydrodata/reservoir_data/919/csv/49.csv",
            "stor_csv_url": "https://www.usbr.gov/uc/water/hydrodata/reservoir_data/919/csv/17.csv",
            "benchmarks": {
                "min_power_pool": {"label": "Min Power Pool", "elev_ft": 3490, "af_per_ft": min_af_ft, "rise_ft_per_100k_af": round(100000.0 / min_af_ft, 2)},
                "current_pool": {"label": "Current Pool", "elev_ft": round(float(h_meta["latest_elev_ft"]), 1), "af_per_ft": cur_af_ft, "rise_ft_per_100k_af": round(100000.0 / cur_af_ft, 2)},
                "full_pool": {"label": "Full Pool", "elev_ft": 3700, "af_per_ft": full_af_ft, "rise_ft_per_100k_af": round(100000.0 / full_af_ft, 2)},
            },
            "curve": curve,
        },
        "event_comparison": {
            "water_year": int(e_meta["water_year"]),
            "cisco_station_id": "09180500",
            "cisco_label": "Colorado River near Cisco, UT (Snowmelt)",
            "dirty_devil_station_id": "09333500",
            "dirty_devil_label": "Dirty Devil River near Hanksville, UT (Flash Flood)",
            "cisco_wy_maf": float(e_meta["cisco_wy_maf"]),
            "cisco_peak_cfs": float(e_meta["cisco_peak_cfs"]),
            "dirty_devil_wy_af": int(e_meta["dirty_devil_wy_af"]),
            "dirty_devil_wy_maf": float(e_meta["dirty_devil_wy_maf"]),
            "dirty_devil_peak_date": e_meta["dirty_devil_peak_date"],
            "dirty_devil_peak_cfs": float(e_meta["dirty_devil_peak_cfs"]),
            "dirty_devil_event_3d_af": int(e_meta["dirty_devil_event_3d_af"]),
            "dirty_devil_event_powell_inches": float(e_meta["dirty_devil_event_powell_inches"]),
            "dates": [r["obs_date"] for r in ev_rows],
            "cisco_cfs": [r["cisco_cfs"] for r in ev_rows],
            "dirty_devil_cfs": [r["dirty_devil_cfs"] for r in ev_rows],
        },
    }
    out_path = os.path.join(WEB_DATA_DIR, "tributary_hydrology.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"[EXPORT] tributary_hydrology.json ({len(tribs)} tributaries, {len(curve)} hypsometry bins)")


def export_station_hierarchy(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()
    rows = cur.execute("SELECT * FROM station_hierarchy ORDER BY tier_rank ASC, station_id ASC").fetchall()
    stations = {}
    for r in rows:
        stations[r["station_id"]] = {
            "id": r["station_id"],
            "name": r["name"],
            "type": r["station_type"],
            "tier_code": r["tier_code"],
            "tier_label": r["tier_label"],
            "tier_rank": r["tier_rank"],
            "rbi": r["rbi"],
            "regime": r["regime"],
            "badge_class": r["badge_class"],
        }

    payload = {
        "metadata": {
            "description": "True daily Richards-Baker Flashiness Index (WY 2016-2025) & Basin Sentinel Hierarchy",
            "formula": "RBI = mean_WY( sum(|Q_t - Q_{t-1}|) / sum(Q_t) ) (Baker et al., 2004)",
            "thresholds": {
                "regulated": "< 0.045 (or major dam tailwater)",
                "snowmelt": "0.045 - 0.150 (project regime band)",
                "flashy": ">= 0.150 (project regime band)",
            },
            "tiers": [
                "Compact Sentinel (Tier 1)",
                "Basin Sentinel (Tier 2)",
                "Tributary Gage (Tier 3)",
                "Trans-Divide Tunnel (Tier 4)",
                "Conveyance Canal (Tier 5)",
                "Storage Reservoir (Tier 6)",
            ],
        },
        "stations": stations,
    }
    out_path = os.path.join(WEB_DATA_DIR, "station_hierarchy.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"[EXPORT] station_hierarchy.json ({len(stations)} facilities)")


def export_historical_normals(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()
    meta_rows = cur.execute(
        """
        SELECT m.*, COALESCE(s.name, m.station_name) AS resolved_name
        FROM station_normals_meta m
        LEFT JOIN stations s ON s.station_id = m.station_id
        ORDER BY m.station_id ASC
        """
    ).fetchall()
    norm_rows = cur.execute("SELECT station_id, mm_dd, mean_cfs FROM station_daily_normals ORDER BY station_id ASC, mm_dd ASC").fetchall()

    sites = {}
    for r in norm_rows:
        sites.setdefault(r["station_id"], {})[r["mm_dd"]] = r["mean_cfs"]

    site_meta = {
        r["station_id"]: {
            "station_name": r["resolved_name"],
            "begin_yr": r["begin_yr"],
            "end_yr": r["end_yr"],
            "count_nu": r["count_nu"],
            "period_label": f"{r['begin_yr']}-{r['end_yr']} ({r['count_nu']} yrs)",
        }
        for r in meta_rows
    }

    payload = {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "description": "USGS historical daily-mean streamflow (cfs) keyed by site_no -> MM-DD, with per-gage Period of Record metadata",
        "site_meta": site_meta,
        "sites": sites,
    }
    out_path = os.path.join(WEB_DATA_DIR, "historical_normals.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"[EXPORT] historical_normals.json ({len(sites)} gages with POR metadata)")


def export_water_budget(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()
    meta = dict(cur.execute("SELECT meta_key, meta_value FROM water_budget_meta").fetchall())
    nodes = []
    for r in cur.execute("SELECT * FROM water_budget_nodes ORDER BY col_tier ASC, rowid ASC").fetchall():
        nodes.append({
            "id": r["node_id"],
            "name": r["name"],
            "displayName": r["display_name"],
            "col": r["col_tier"],
            "category": r["category"],
            "basin": r["basin"],
            "maf_yr": round(r["maf_yr"], 4),
            "summary": r["summary"],
            "breakdowns": json.loads(r["breakdowns_json"]) if r["breakdowns_json"] else None,
            "stationId": r["station_id"],
            "stationLabel": r["station_label"],
            "portalUrl": r["portal_url"],
            "source_id": r["source_id"],
            "locator": r["locator"],
        })

    links = [
        {
            "source": r["source_name"],
            "target": r["target_name"],
            "value": round(r["value_maf"], 5),
            "category": r["category"],
            "source_id": r["source_id"],
            "locator": r["locator"],
        }
        for r in cur.execute("SELECT * FROM water_budget_links ORDER BY link_id ASC").fetchall()
    ]

    stacked = [
        {
            "side": r["side"],
            "label": r["label"],
            "maf_yr": round(r["maf_yr"], 4),
            "share_label": r["share_label"],
            "category": r["category"],
            "color_hex": r["color_hex"],
            "excluded": bool(r["excluded"]),
            "description": r["description"],
            "source_id": r["source_id"],
            "locator": r["locator"],
        }
        for r in cur.execute("SELECT * FROM water_budget_stacked ORDER BY seg_id ASC").fetchall()
    ]

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "meta": meta,
        "nodes": nodes,
        "links": links,
        "stacked": stacked,
    }
    out_path = os.path.join(WEB_DATA_DIR, "water_budget.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"[EXPORT] water_budget.json ({len(nodes)} nodes, {len(links)} links, {len(stacked)} stacked segments)")


def export_provenance_registry(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()
    sources = [dict(r) for r in cur.execute("SELECT * FROM source_catalog ORDER BY category ASC, source_id ASC").fetchall()]
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_sources": len(sources),
        "sources": sources,
    }
    out_path = os.path.join(WEB_DATA_DIR, "provenance_registry.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"[EXPORT] provenance_registry.json ({len(sources)} cataloged sources)")


def export_replay(conn: sqlite3.Connection, window_key: str) -> None:
    cur = conn.cursor()
    row = cur.execute("SELECT payload_json FROM replay_matrices WHERE window_key=?", (window_key,)).fetchone()
    if not row:
        print(f"[SKIP  ] replay_{window_key}.json (no matrix stored in SQLite)")
        return
    out_path = os.path.join(WEB_DATA_DIR, f"replay_{window_key}.json")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(row["payload_json"])
    print(f"[EXPORT] replay_{window_key}.json ({os.path.getsize(out_path)/1024:.1f} KB)")


def main():
    parser = argparse.ArgumentParser(description="Export static JSON contracts from SQLite SSOT.")
    parser.add_argument("--only", nargs="*", help="Optional target subset: latest_metrics portal_historical seasonal_regimes tributary_hydrology station_hierarchy historical_normals water_budget provenance_registry replay_7d replay_30d")
    args = parser.parse_args()

    targets = set(args.only) if args.only else {
        "latest_metrics", "portal_historical", "seasonal_regimes",
        "tributary_hydrology", "station_hierarchy", "historical_normals",
        "water_budget", "provenance_registry", "replay_7d", "replay_30d",
    }

    conn = get_conn()
    try:
        if "latest_metrics" in targets:
            export_latest_metrics(conn)
        if "portal_historical" in targets:
            export_portal_historical(conn)
        if "seasonal_regimes" in targets:
            export_seasonal_regimes(conn)
        if "tributary_hydrology" in targets:
            export_tributary_hydrology(conn)
        if "station_hierarchy" in targets:
            export_station_hierarchy(conn)
        if "historical_normals" in targets:
            export_historical_normals(conn)
        if "water_budget" in targets:
            export_water_budget(conn)
        if "provenance_registry" in targets:
            export_provenance_registry(conn)
        if "replay_7d" in targets:
            export_replay(conn, "7d")
        if "replay_30d" in targets:
            export_replay(conn, "30d")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
