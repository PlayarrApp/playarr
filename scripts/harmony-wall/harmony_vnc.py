#!/usr/bin/env python3
"""Bridge for the DevEco Previewer (slot 7): frames to VNC, remote keys to the Previewer.

- Hosts the Previewer's command socket (/tmp/<name>_commandPipe); the Previewer connects to it as a client.
- Reads JPEG frames from the Previewer websocket (127.0.0.1:<ws>).
- Serves VNC through sim_vnc.Server (RFB 3.8, VNC auth, Tight/JPEG) on --bind:--port (tailnet only).
- Local control on 127.0.0.1:<ctl>: GET /shot (jpeg), /key/<up|down|left|right|ok|back|space>, /click?x=&y=, POST /cmd.
Standard library only. Password from the environment (PLAYARR_VNC_SLOT7_PASSWORD), never the command line.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import http.server
import json
import math
import os
import re
import socket
import struct
import sys
import threading
import time
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sim_vnc  # noqa: E402  (copied next to this file from scripts/sim-vnc)
from capture_identity import match_profile_identity
from capture_diagnostics import MAX_IMAGE_PAYLOAD_BYTES, image_payload_metrics  # noqa: E402

MAX_PREVIEW_TELEMETRY_BATCH_SIZE = 64
MAX_PREVIEW_TELEMETRY_BATCH_BYTES = 1 * 1024 * 1024
PREVIEW_TELEMETRY_BATCH_LOCK = threading.Lock()
PREVIEW_TELEMETRY_BATCH_LAST_ID = 0
PREVIEW_TELEMETRY_BATCH_DIGESTS = {}
PREVIEW_TELEMETRY_POST_PATHS = {
    "/preview-state", "/row-image", "/row-image-stage", "/image-metrics-scope", "/layout-stage",
    "/detail-load", "/episode-target", "/episode-card-area", "/episode-card-container-area",
}

# OpenHarmony KeyCode values (range the Previewer accepts: 2000-2119)
OH_KEYS = {"up": 2012, "down": 2013, "left": 2014, "right": 2015, "ok": 2054, "center": 2016, "space": 2050, "esc": 2070, "tab": 2049, "enter": 2054, "pagedown": 2020}
KEYSYM = {0xFF52: "up", 0xFF54: "down", 0xFF51: "left", 0xFF53: "right", 0xFF0D: "ok", 0xFF8D: "ok",
          0x0020: "space", 0xFF1B: "back", 0xFF08: "back"}


# Preview-only route mailbox: the capture scripts set a route name, the patched Index polls and consumes it.
ROUTE_BOX = {"name": ""}
# Parity state the patched app reports (route, library kind, last focused item); GET /state returns it with the derived label.
IMAGES: dict = {}  # id -> bytes, posted by the patched app (the Previewer cannot decode images itself)
IMAGE_METRICS: dict[str, dict] = {}  # ephemeral /img key -> numeric diagnostics, never written to artifacts
IMAGE_SCOPES: dict[str, dict] = {}  # ephemeral /img key -> in-memory Detail row scope
IMAGE_DIAGNOSTICS_LOCK = threading.Lock()
IMAGE_DIAGNOSTICS_LIMIT = 256
# A series-detail capture emits well over 300 events; keep enough that the target and route events are never evicted.
DEBUG_EVENT_LIMIT = 3000
DEBUG_EVENTS_LOCK = threading.Lock()
STATE = {"route": "", "kind": "", "focused": None, "focus_ack": None, "lib_kind": ""}
EXPECTED_IDENTITY_SHA256 = ""
DEBUG_SEQUENCE = 0
DETAIL_IMAGE_STAGES = {
    "source", "fetch-start", "fetch-ok", "fetch-error", "bridge-source-ready",
    "assigned", "image-source", "image-area-positive", "image-area-zero", "on-complete", "on-error",
    "row-match-found", "row-match-missing", "artwork-state-present", "artwork-state-absent", "artwork-state-mutated",
    "artwork-store-present", "artwork-store-absent", "artwork-store-updated",
    "poster-artwork-prop-undefined", "poster-artwork-prop-present",
    "poster-render-artwork-undefined", "poster-render-artwork-present",
    "visible-item-artwork-state-absent", "visible-item-artwork-state-present",
}
DETAIL_LAYOUT_STAGES = {
    "detail-rails-count", "rail-items-count", "rail-item-appear",
    "rail-items-prop-update-count", "rail-items-prop-update-artwork-count",
    "poster-card-root-area", "poster-card-art-area", "rail-list-area",
    "rail-list-height-explicit", "rail-list-height-default-fill",
    "series-focus-request-count", "series-focused-row-is-target",
    "series-target-season-row-area", "series-target-season-centre-delta-vp",
    "series-target-card-visibility", "series-target-area-sample",
    "episode-card-container-report", "episode-card-container-receiver",
    "series-focus-request-issued", "series-focus-request-result",
    "detail-preview-generation-scope",
    "detail-row-area-geometry", "target-episode-initial-index-watch",
    "target-episode-initial-index-watch-hook-ran", "target-episode-list-appeared",
    "target-episode-list-appeared-hook-ran", "target-episode-initial-index-applied",
    "target-episode-live-item-count-at-callback", "target-episode-positioned-callback",
    "target-episode-live-prop-target-found", "target-episode-live-prop-target-index",
    "target-episode-live-prop-target-at-callback-found", "target-episode-live-prop-target-at-callback-index",
    "target-episode-callback-captured-item-count", "target-episode-callback-captured-target-found",
    "target-episode-callback-captured-target-index", "target-episode-callback-live-rail-found",
    "target-episode-callback-live-item-count", "target-episode-callback-live-target-found",
    "target-episode-callback-live-target-index",
    "resume-plan-loaded", "target-present", "target-in-any-rail", "target-card-mounted",
    "target-season-scroll-requested", "target-episode-scroll-requested", "focus-pending", "focus-suppressed",
    "focus-request-count",
}
DETAIL_LOAD_RESULT_CATEGORIES = {"ok", "http_failure", "network_failure"}
DETAIL_LOAD_ERROR_CATEGORIES = {
    "", "timeout", "no_connection", "cancelled", "unknown", "general", "oauth", "upgrade_required",
    "not_json", "malformed",
}
DETAIL_RENDER_STATES = {"loading", "error", "detail-ready"}


def valid_numeric_image_key(image_id: str) -> bool:
    return 0 < len(image_id) <= 16 and all("0" <= character <= "9" for character in image_id)


def _valid_image_scope(body: dict) -> dict | None:
    route = str(body.get("route", ""))
    work_id = str(body.get("work_id", ""))
    parent_work_id = str(body.get("parent_work_id", ""))
    row_id = str(body.get("row_id", ""))
    try:
        generation = int(body.get("generation", 0))
    except (TypeError, ValueError):
        return None
    if (route != "Detail" or not work_id or work_id != parent_work_id or not row_id
            or generation <= 0):
        return None
    current_generation = STATE.get("route_generation", 0)
    if generation < current_generation:
        return None
    if (generation == current_generation and current_generation > 0
            and (STATE.get("route") != route or STATE.get("work_id") != work_id)):
        return None
    return {
        "route": route,
        "work_id": work_id,
        "parent_work_id": parent_work_id,
        "row_id": row_id,
        "generation": generation,
    }


def _append_image_payload_event(scope: dict, metrics: dict) -> None:
    if metrics.get("decode_status") == "malformed":
        category = "detail-image-payload-decode-error"
        numeric_metrics = None
    elif metrics.get("decode_status") == "oversized":
        category = "detail-image-payload-oversized"
        numeric_metrics = None
    else:
        category = "detail-image-payload-metrics"
        numeric_metrics = {
            key: value for key, value in metrics.items()
            if (key != "decode_status" and isinstance(value, (int, float))
                and not isinstance(value, bool) and math.isfinite(value))
        }
    append_debug_event(category, route=scope["route"], work_id=scope["work_id"],
                       parent_work_id=scope["parent_work_id"], row_id=scope["row_id"],
                       generation=scope["generation"], metrics=numeric_metrics)


def _join_image_metrics_scope(image_id: str) -> None:
    scope = IMAGE_SCOPES.get(image_id)
    metrics = IMAGE_METRICS.get(image_id)
    if scope is not None and metrics is not None:
        del IMAGE_SCOPES[image_id]
        del IMAGE_METRICS[image_id]
        if _valid_image_scope(scope) is not None:
            _append_image_payload_event(scope, metrics)


PREVIEW_IMAGE_MAX_EDGE = 1280  # the Previewer decodes in software: full-size posters kept cards grey for minutes


def downscale_jpeg(payload: bytes, metrics: dict) -> bytes:
    """JPEGs wider than the longest on-screen use (the 1920 px hero, drawn faded) are re-encoded at PREVIEW_IMAGE_MAX_EDGE; others pass."""
    if payload[:2] != b"\xff\xd8" or max(metrics.get("width", 0), metrics.get("height", 0)) <= PREVIEW_IMAGE_MAX_EDGE:
        return payload
    import io
    from PIL import Image
    try:
        with Image.open(io.BytesIO(payload)) as image:
            image = image.convert("RGB")
            image.thumbnail((PREVIEW_IMAGE_MAX_EDGE, PREVIEW_IMAGE_MAX_EDGE))
            out = io.BytesIO()
            image.save(out, "JPEG", quality=88)
            return out.getvalue()
    except Exception:
        return payload


def record_image_upload(image_id: str, payload: bytes) -> str:
    """Cache only decodable bounded images; retain metrics and failures without payload bytes."""
    if not valid_numeric_image_key(image_id):
        return "invalid-key"
    metrics = image_payload_metrics(payload)
    status = metrics.get("decode_status", "malformed")
    if status != "ok":
        record_image_payload_status(image_id, status)
        return status
    IMAGES[image_id] = downscale_jpeg(payload, metrics)
    if not image_id.isdigit() or len(image_id) > 16:
        return status
    with IMAGE_DIAGNOSTICS_LOCK:
        IMAGE_METRICS[image_id] = metrics
        _join_image_metrics_scope(image_id)
        while len(IMAGE_METRICS) > IMAGE_DIAGNOSTICS_LIMIT:
            IMAGE_METRICS.pop(next(iter(IMAGE_METRICS)))
    return status


def record_image_payload_status(image_id: str, status: str) -> None:
    """Record a bounded decode stage when rejecting a body before reading it."""
    if not valid_numeric_image_key(image_id) or status not in ("malformed", "oversized"):
        return
    with IMAGE_DIAGNOSTICS_LOCK:
        IMAGE_METRICS[image_id] = {"decode_status": status}
        _join_image_metrics_scope(image_id)
        while len(IMAGE_METRICS) > IMAGE_DIAGNOSTICS_LIMIT:
            IMAGE_METRICS.pop(next(iter(IMAGE_METRICS)))


def append_detail_image_payload_scope(body: dict) -> bool:
    """Join an ephemeral numeric /img key to a valid Detail row only in bridge memory."""
    image_id = str(body.get("image_id", ""))
    if not valid_numeric_image_key(image_id):
        return False
    scope = _valid_image_scope(body)
    if scope is None:
        return False
    with IMAGE_DIAGNOSTICS_LOCK:
        IMAGE_SCOPES[image_id] = scope
        _join_image_metrics_scope(image_id)
        while len(IMAGE_SCOPES) > IMAGE_DIAGNOSTICS_LIMIT:
            IMAGE_SCOPES.pop(next(iter(IMAGE_SCOPES)))
    return True


def append_debug_event(category: str, *, route: str = "", work_id: str = "", parent_work_id: str = "",
                       row_id: str = "", generation: int = 0, metrics: dict | None = None) -> dict:
    global DEBUG_SEQUENCE
    with DEBUG_EVENTS_LOCK:
        DEBUG_SEQUENCE += 1
        event = {
            "sequence": DEBUG_SEQUENCE,
            "category": category,
            "timestamp": time.monotonic(),
            "route": route or STATE.get("route", ""),
            "work_id": work_id or STATE.get("work_id", ""),
            "generation": generation or STATE.get("route_generation", 0),
        }
        if parent_work_id and row_id:
            event["parent_work_id"] = parent_work_id
            event["row_id"] = row_id
        if metrics:
            event.update(metrics)
        STATE["debug_events"] = (STATE.get("debug_events", []) + [event])[-DEBUG_EVENT_LIMIT:]
        STATE["debug_sequence"] = DEBUG_SEQUENCE
    return event


def snapshot_state() -> dict:
    """Copy bridge state and complete debug events under the event publication lock."""
    with DEBUG_EVENTS_LOCK:
        snapshot = dict(STATE)
        snapshot["debug_events"] = [dict(event) for event in STATE.get("debug_events", [])]
        return snapshot


def append_detail_load_event(body: dict) -> bool:
    """Accept content-free Detail load diagnostics from the preview overlay only."""
    route = str(body.get("route", ""))
    work_id = str(body.get("work_id", ""))
    try:
        generation_raw = body.get("generation", 0)
        load_sequence_raw = body.get("load_sequence", 0)
        if (isinstance(generation_raw, bool) or not isinstance(generation_raw, int)
                or isinstance(load_sequence_raw, bool) or not isinstance(load_sequence_raw, int)):
            return False
        generation = generation_raw
        load_sequence = load_sequence_raw
    except (TypeError, ValueError):
        return False
    stage = body.get("stage")
    render_state = body.get("render_state")
    if (route != "Detail" or not work_id or generation <= 0 or load_sequence <= 0
            or stage not in ("load-start", "api-result", "render-state")
            or render_state not in DETAIL_RENDER_STATES):
        return False
    current_generation = STATE.get("route_generation", 0)
    if (generation != current_generation or STATE.get("route") != route
            or STATE.get("work_id") != work_id):
        return False

    metrics = {"load_sequence": load_sequence, "render_state": render_state}
    active_load_sequence = STATE.get("detail_load_sequence", 0)
    if load_sequence < active_load_sequence:
        return False
    if stage == "load-start" and render_state != "loading":
        return False
    if stage == "api-result":
        result_category = body.get("result_category")
        error_category = body.get("error_category", "")
        status = body.get("status", -1)
        if result_category not in DETAIL_LOAD_RESULT_CATEGORIES:
            return False
        if (isinstance(status, bool) or not isinstance(status, int)
                or status != -1 and not 100 <= status <= 599):
            return False
        if error_category not in DETAIL_LOAD_ERROR_CATEGORIES:
            return False
        if result_category == "ok" and (status < 200 or status >= 300 or error_category):
            return False
        if result_category == "network_failure" and (status != -1 or not error_category):
            return False
        if result_category == "http_failure" and (not 400 <= status <= 599 or not error_category):
            return False
        metrics.update({"result_category": result_category, "status": status,
                        "error_category": error_category})
    elif stage == "render-state" and render_state not in DETAIL_RENDER_STATES:
        return False
    if load_sequence > active_load_sequence:
        STATE["detail_load_sequence"] = load_sequence
    append_debug_event("detail-load-" + stage, route=route, work_id=work_id,
                       generation=generation, metrics=metrics)
    return True


def append_row_image_event(body: dict) -> bool:
    route = str(body.get("route", ""))
    work_id = str(body.get("work_id", ""))
    parent_work_id = str(body.get("parent_work_id", ""))
    row_id = str(body.get("row_id", ""))
    try:
        generation = int(body.get("generation", 0))
    except (TypeError, ValueError):
        return False
    if route != "Detail" or not work_id or work_id != parent_work_id or not row_id or generation <= 0:
        return False
    current_generation = STATE.get("route_generation", 0)
    if generation < current_generation:
        return False
    if (generation == current_generation and current_generation > 0
            and (STATE.get("route") != route or STATE.get("work_id") != work_id)):
        return False
    append_debug_event("detail-row-image-complete", route=route, work_id=work_id,
                       parent_work_id=parent_work_id, row_id=row_id, generation=generation)
    return True


def append_detail_image_stage(body: dict) -> bool:
    """Accept a scoped preview-only image stage without exposing IDs in logs/artifacts."""
    route = str(body.get("route", ""))
    work_id = str(body.get("work_id", ""))
    parent_work_id = str(body.get("parent_work_id", ""))
    row_id = str(body.get("row_id", ""))
    stage = str(body.get("stage", ""))
    try:
        generation = int(body.get("generation", 0))
    except (TypeError, ValueError):
        return False
    if (route != "Detail" or not work_id or work_id != parent_work_id or not row_id
            or generation <= 0 or stage not in DETAIL_IMAGE_STAGES):
        return False
    current_generation = STATE.get("route_generation", 0)
    if generation < current_generation:
        return False
    if (generation == current_generation and current_generation > 0
            and (STATE.get("route") != route or STATE.get("work_id") != work_id)):
        return False
    append_debug_event("detail-row-image-" + stage, route=route, work_id=work_id,
                       parent_work_id=parent_work_id, row_id=row_id, generation=generation)
    return True


def append_detail_layout_stage(body: dict) -> bool:
    """Accept only scoped layout stages and numeric measurements."""
    route = str(body.get("route", ""))
    work_id = str(body.get("work_id", ""))
    stage = str(body.get("stage", ""))
    try:
        generation = int(body.get("generation", 0))
    except (TypeError, ValueError):
        return False
    if route != "Detail" or not work_id or generation <= 0 or stage not in DETAIL_LAYOUT_STAGES:
        return False
    current_generation = STATE.get("route_generation", 0)
    if generation < current_generation:
        return False
    if (generation == current_generation and current_generation > 0
            and (STATE.get("route") != route or STATE.get("work_id") != work_id)):
        return False
    numeric = {}
    if stage == "episode-card-container-report":
        predicate_fields = (
            "report_invoked", "sender_route_ok", "sender_work_present", "sender_work_matches",
            "sender_generation_matches", "sender_rect_finite", "sender_rect_positive",
            "sender_density_valid",
        )
        for field in predicate_fields:
            value = body.get(field)
            if isinstance(value, bool) or not isinstance(value, int) or value not in (0, 1):
                return False
            numeric[field] = value
        geometry_fields = ("x_vp", "y_vp", "width_vp", "height_vp", "density")
        for field in geometry_fields:
            value = body.get(field)
            if value is None:
                continue
            if (isinstance(value, bool) or not isinstance(value, (int, float))
                    or (isinstance(value, float) and not math.isfinite(value)) or abs(value) > 1000000):
                return False
            numeric[field] = value
        if numeric["sender_rect_finite"] == 1 and any(field not in numeric for field in geometry_fields[:4]):
            return False
        if numeric["sender_density_valid"] == 1 and "density" not in numeric:
            return False
    elif stage == "series-target-card-visibility":
        expected = {"visible", "intersection_width_vp", "intersection_height_vp", "page_offset_vp",
                    "rail_offset_vp", "offsets_fresh"}
        if any(field not in body for field in expected):
            return False
        for field in expected:
            raw = body[field]
            if (isinstance(raw, bool) or not isinstance(raw, (int, float))
                    or (isinstance(raw, float) and not math.isfinite(raw)) or abs(raw) > 1000000):
                return False
        if (body["visible"] not in (0, 1) or body["offsets_fresh"] not in (0, 1)
                or body["intersection_width_vp"] < 0 or body["intersection_height_vp"] < 0):
            return False
        numeric.update({
            "visible": body["visible"],
            "intersection_width_vp": body["intersection_width_vp"],
            "intersection_height_vp": body["intersection_height_vp"],
            "page_offset_vp": body["page_offset_vp"],
            "rail_offset_vp": body["rail_offset_vp"],
            "offsets_fresh": body["offsets_fresh"],
        })
    elif stage == "series-target-area-sample":
        present = body.get("present")
        if isinstance(present, bool) or present not in (0, 1):
            return False
        fields = ("width_vp", "height_vp", "page_offset_vp", "rail_offset_vp")
        values = {field: body.get(field) for field in fields}
        if any(isinstance(value, bool) or not isinstance(value, (int, float)) for value in values.values()):
            return False
        if any(abs(value) > 1000000 or not math.isfinite(value) for value in values.values()):
            return False
        sampled_at_ms = body.get("sampled_at_ms")
        if (isinstance(sampled_at_ms, bool) or not isinstance(sampled_at_ms, int)
                or sampled_at_ms < 1000000000000 or sampled_at_ms > 10000000000000
                or values["width_vp"] <= 0 or values["height_vp"] <= 0):
            return False
        numeric.update({"present": present, **values, "sampled_at_ms": sampled_at_ms})
    elif stage == "detail-preview-generation-scope":
        captured = body.get("captured_generation")
        live = body.get("live_generation")
        matches = body.get("scope_matches")
        if (isinstance(captured, bool) or not isinstance(captured, int) or captured <= 0 or captured > 1000000
                or isinstance(live, bool) or not isinstance(live, int) or live != generation
                or live <= 0 or live > 1000000
                or isinstance(matches, bool) or matches not in (0, 1)
                or matches != (1 if captured == live else 0)):
            return False
        numeric.update({"captured_generation": captured, "live_generation": live, "scope_matches": matches})
    elif stage == "detail-row-area-geometry":
        type_codes = {0, 1, 2, 3, 4, 5}
        unit_codes = {0, 1, 2, 3, 4, 5, 6}
        for name in ("x", "y", "global_x", "global_y", "width", "height"):
            type_field = name + "_type_code"
            unit_field = name + "_unit_code"
            type_code = body.get(type_field)
            unit_code = body.get(unit_field)
            if (isinstance(type_code, bool) or not isinstance(type_code, int) or type_code not in type_codes
                    or isinstance(unit_code, bool) or not isinstance(unit_code, int) or unit_code not in unit_codes):
                return False
            numeric[type_field] = type_code
            numeric[unit_field] = unit_code
            raw = body.get(name)
            if raw is None:
                continue
            if (isinstance(raw, bool) or not isinstance(raw, (int, float))
                    or (isinstance(raw, float) and not math.isfinite(raw)) or abs(raw) > 1000000):
                return False
            numeric[name] = raw
        if "width" in numeric and "height" in numeric:
            numeric["area"] = numeric["width"] * numeric["height"]
    elif stage in ("series-focus-request-issued", "series-focus-request-result",
                   "series-focused-row-is-target"):
        raw = body.get("value")
        if isinstance(raw, bool) or raw not in (0, 1):
            return False
        numeric["value"] = raw
    for field in (() if stage in ("series-target-card-visibility", "series-target-area-sample",
                                  "detail-preview-generation-scope",
                                  "series-focus-request-issued",
                                  "series-focus-request-result", "series-focused-row-is-target") else ("value", "width", "height")):
        raw = body.get(field)
        if raw is None:
            continue
        signed_centre_delta = field == "value" and stage == "series-target-season-centre-delta-vp"
        minimum = -1000000 if signed_centre_delta else -1
        if (isinstance(raw, bool) or not isinstance(raw, (int, float))
                or (isinstance(raw, float) and not math.isfinite(raw)) or raw < minimum):
            return False
        if raw > 1000000:
            return False
        if raw >= 0 or signed_centre_delta:
            numeric[field] = raw
    if "width" in numeric and "height" in numeric:
        numeric["area"] = numeric["width"] * numeric["height"]
    append_debug_event("detail-layout-" + stage, route=route, work_id=work_id,
                       generation=generation, metrics=numeric)
    return True


def _detail_row_scope(body: dict) -> dict | None:
    route = str(body.get("route", ""))
    work_id = str(body.get("work_id", ""))
    parent_work_id = str(body.get("parent_work_id", ""))
    row_id = str(body.get("row_id", ""))
    try:
        generation = int(body.get("generation", 0))
    except (TypeError, ValueError):
        return None
    if route != "Detail" or not work_id or parent_work_id != work_id or not row_id or generation <= 0:
        return None
    current_generation = STATE.get("route_generation", 0)
    if generation < current_generation:
        return None
    if (generation == current_generation and current_generation > 0
            and (STATE.get("route") != route or STATE.get("work_id") != work_id)):
        return None
    return {"route": route, "work_id": work_id, "parent_work_id": parent_work_id,
            "row_id": row_id, "generation": generation}


def append_detail_episode_target(body: dict) -> bool:
    scope = _detail_row_scope(body)
    if scope is None:
        return False
    append_debug_event("detail-episode-target", **scope)
    return True


def _append_detail_episode_card_area_event(body: dict, *, category: str = "detail-episode-card-area",
                                          extra_metrics: dict | None = None) -> dict | None:
    scope = _detail_row_scope(body)
    if scope is None:
        return None
    metrics = {}
    for field in ("x_vp", "y_vp", "width_vp", "height_vp", "density"):
        raw = body.get(field)
        if (isinstance(raw, bool) or not isinstance(raw, (int, float))
                or (isinstance(raw, float) and not math.isfinite(raw))
                or raw < -1000000 or raw > 1000000):
            return None
        metrics[field] = raw
    if (metrics["width_vp"] <= 0 or metrics["height_vp"] <= 0
            or metrics["density"] <= 0 or metrics["density"] > 10):
        return None
    if extra_metrics:
        metrics.update(extra_metrics)
    return append_debug_event(category, **scope, metrics=metrics)


def append_detail_episode_card_area(body: dict) -> bool:
    return _append_detail_episode_card_area_event(body) is not None


def _append_container_area_receiver_outcome(accepted: bool, reason_code: int) -> None:
    route = STATE.get("route", "")
    work_id = STATE.get("work_id", "")
    generation = STATE.get("route_generation", 0)
    if route != "Detail" or not work_id or not isinstance(generation, int) or generation <= 0:
        return
    append_debug_event("detail-layout-episode-card-container-receiver", route=route, work_id=work_id,
                       generation=generation,
                       metrics={"accepted": 1 if accepted else 0, "reason_code": reason_code})


def append_detail_episode_card_container_area(body: dict) -> bool:
    event = _append_detail_episode_card_area_event(
        body, category="detail-episode-card-container-area",
        extra_metrics={"receiver_accepted": 1, "receiver_reason_code": 0})
    if event is not None:
        return True
    # Keep rejection evidence scoped to current bridge state, never the rejected identifiers.
    _append_container_area_receiver_outcome(False, _container_area_rejection_code(body))
    return False


def _container_area_rejection_code(body: dict) -> int:
    """Return a bounded reason enum for the rejected area body."""
    route = str(body.get("route", ""))
    work_id = str(body.get("work_id", ""))
    parent_work_id = str(body.get("parent_work_id", ""))
    row_id = str(body.get("row_id", ""))
    try:
        generation = int(body.get("generation", 0))
    except (TypeError, ValueError):
        return 1
    if route != "Detail" or not work_id or parent_work_id != work_id or not row_id or generation <= 0:
        return 1
    current_generation = STATE.get("route_generation", 0)
    if generation < current_generation or (generation == current_generation and current_generation > 0
            and (STATE.get("route") != route or STATE.get("work_id") != work_id)):
        return 2
    for field in ("x_vp", "y_vp", "width_vp", "height_vp", "density"):
        value = body.get(field)
        if (isinstance(value, bool) or not isinstance(value, (int, float))
                or (isinstance(value, float) and not math.isfinite(value))
                or value < -1000000 or value > 1000000):
            return 3
    if body["width_vp"] <= 0 or body["height_vp"] <= 0 or body["density"] <= 0 or body["density"] > 10:
        return 4
    return 0


def apply_state(q):
    global EXPECTED_IDENTITY_SHA256
    if "clear_identity" in q:
        STATE.pop("auth_verified", None)
        STATE.pop("auth_current", None)
        expected = q.get("expected_digest", [""])[0]
        EXPECTED_IDENTITY_SHA256 = expected if re.fullmatch(r"[0-9a-f]{64}", expected) else ""
    if "route" in q:
        route = q["route"][0]
        work_id = q.get("work", [""])[0] if route == "Detail" else ""
        previous_route = STATE.get("route", "")
        previous_work_id = STATE.get("work_id", "")
        previous_generation = STATE.get("route_generation", 0)
        try:
            generation = int(q.get("generation", ["0"])[0])
        except (TypeError, ValueError):
            generation = 0
        if "generation" in q and generation < STATE.get("route_generation", 0):
            return
        STATE["route"] = route
        STATE["kind"] = q.get("kind", [""])[0]
        STATE["work_id"] = work_id
        STATE["route_generation"] = max(STATE.get("route_generation", 0), generation)
        if route != "Detail" or route != previous_route or work_id != previous_work_id or generation != previous_generation:
            STATE["detail_load_sequence"] = 0
        if STATE["route"] == "Library":
            STATE["lib_kind"] = STATE["kind"]
    if "resetfocused" in q:
        STATE["focused"] = None
        STATE["focus_ack"] = None
    if "resetdbg" in q:
        STATE["dbgcount"] = {}
    if "img" in q:
        # Poster cards still showing their placeholder (the app adds one when a placeholder appears and removes one when it goes).
        try:
            STATE["img_pending"] = max(0, STATE.get("img_pending", 0) + int(q["img"][0]))
        except ValueError:
            pass
    if "net" in q:
        # The preview HTTP gate reports idle when no API call or artwork request is pending; the capture waits for it.
        STATE["net_idle"] = q["net"][0] == "idle"
        print(f"[net] {time.monotonic():.1f} {q['net'][0]}", flush=True)
    if "auth" in q:
        # Compare the transient app profile ID with the approver digest, then discard it.
        matched, current = match_profile_identity(
            q["auth"][0], EXPECTED_IDENTITY_SHA256, q.get("auth_current", ["0"])[0] == "1")
        STATE["auth_verified"] = matched
        STATE["auth_current"] = current
    if "dbg" in q:
        if q["dbg"][0].startswith("http:"):
            print(f"[http] {time.monotonic():.1f} {q['dbg'][0][:140]}", flush=True)
        STATE["dbg"] = q["dbg"][0]
        if not q["dbg"][0].startswith("http:"):  # per-name totals for the capture's settle dump (the http lines flood dbglog)
            STATE.setdefault("dbgcount", {})[q["dbg"][0][:40]] = STATE.get("dbgcount", {}).get(q["dbg"][0][:40], 0) + 1
        STATE.setdefault("dbglog", []).append(q["dbg"][0])
        del STATE["dbglog"][:-300]
        append_debug_event(q["dbg"][0].split(":", 1)[0][:64])
    if "nav" in q:
        STATE["focused"] = q["nav"][0]
    if "focusack" in q:
        # Keep helper acknowledgement separate from labels that title/nav events can update.
        STATE["focus_ack"] = q["focusack"][0]
    if "title" in q:
        title, sub = q["title"][0], q.get("sub", [""])[0]
        # web's accessible names: Home cards read "<title><subtitle>", grid cards "open <title>"
        STATE["focused"] = title + sub if STATE["route"] in ("Home", "") else "open " + title


def validate_preview_telemetry_batch(events):
    """Return a fully validated batch, or None without applying any event."""
    if not isinstance(events, list) or not events or len(events) > MAX_PREVIEW_TELEMETRY_BATCH_SIZE:
        return None
    validated = []
    for event in events:
        if not isinstance(event, dict) or set(event) != {"method", "path", "body"}:
            return None
        method = event.get("method")
        path = event.get("path")
        body = event.get("body")
        if not isinstance(method, str) or not isinstance(path, str):
            return None
        if method == "GET":
            parsed = urllib.parse.urlparse(path)
            if (not path.startswith("/state?") or parsed.scheme or parsed.netloc or parsed.fragment or
                    parsed.path != "/state" or not parsed.query or body != ""):
                return None
            validated.append((method, urllib.parse.parse_qs(parsed.query), None))
            continue
        if method != "POST" or path not in PREVIEW_TELEMETRY_POST_PATHS or not isinstance(body, str):
            return None
        try:
            parsed_body = json.loads(body or "{}")
        except (TypeError, ValueError):
            return None
        if not isinstance(parsed_body, dict):
            return None
        validated.append((method, path, parsed_body))
    return validated


def dispatch_preview_telemetry_event(method, path_or_query, body):
    """Apply one prevalidated overlay telemetry event."""
    if method == "GET":
        apply_state(path_or_query)
        return True
    path = path_or_query
    if path == "/preview-state":
        apply_state({"route": [str(body.get("route", ""))], "kind": [str(body.get("kind", ""))],
                     "work": [str(body.get("work_id", ""))], "generation": [str(body.get("generation", "0"))]})
        return True
    elif path == "/row-image":
        return append_row_image_event(body)
    elif path == "/row-image-stage":
        return append_detail_image_stage(body)
    elif path == "/image-metrics-scope":
        return append_detail_image_payload_scope(body)
    elif path == "/layout-stage":
        return append_detail_layout_stage(body)
    elif path == "/detail-load":
        return append_detail_load_event(body)
    elif path == "/episode-target":
        return append_detail_episode_target(body)
    elif path == "/episode-card-area":
        return append_detail_episode_card_area(body)
    elif path == "/episode-card-container-area":
        return append_detail_episode_card_container_area(body)
    return False


def dispatch_preview_telemetry_batch(batch_id, events, request_digest):
    """Apply each ordered batch once and acknowledge retries with the same body digest."""
    global PREVIEW_TELEMETRY_BATCH_LAST_ID
    if (not isinstance(batch_id, int) or isinstance(batch_id, bool) or batch_id < 1 or
            not isinstance(request_digest, str) or len(request_digest) != 64):
        return False
    validated = validate_preview_telemetry_batch(events)
    if validated is None:
        return False
    with PREVIEW_TELEMETRY_BATCH_LOCK:
        previous_digest = PREVIEW_TELEMETRY_BATCH_DIGESTS.get(batch_id)
        if previous_digest is not None:
            return previous_digest == request_digest
        if batch_id != PREVIEW_TELEMETRY_BATCH_LAST_ID + 1:
            return False
        try:
            for method, path_or_query, body in validated:
                # Existing endpoints acknowledge stale route scopes while intentionally dropping them.
                dispatch_preview_telemetry_event(method, path_or_query, body)
        except Exception:
            return False
        PREVIEW_TELEMETRY_BATCH_LAST_ID = batch_id
        PREVIEW_TELEMETRY_BATCH_DIGESTS[batch_id] = request_digest
        while len(PREVIEW_TELEMETRY_BATCH_DIGESTS) > 64:
            del PREVIEW_TELEMETRY_BATCH_DIGESTS[min(PREVIEW_TELEMETRY_BATCH_DIGESTS)]
        return True


def log(message: str) -> None:
    print(f"{time.strftime('%H:%M:%S')} {message}", flush=True)


class WinPipe:
    """Server end of a Windows named pipe (the Windows Previewer connects to \\\\.\\pipe\\<name>_commandPipe as a client).
    Message mode, overlapped I/O so a pending read never blocks a write. Same recv/sendall/close surface as a socket."""

    def __init__(self, name: str):
        import _winapi
        self.w = _winapi
        self.h = _winapi.CreateNamedPipe(
            name, _winapi.PIPE_ACCESS_DUPLEX | 0x40000000,  # FILE_FLAG_OVERLAPPED
            _winapi.PIPE_TYPE_MESSAGE | _winapi.PIPE_READMODE_MESSAGE | _winapi.PIPE_WAIT, 1, 1 << 20, 1 << 20, 0, 0)
        ov = _winapi.ConnectNamedPipe(self.h, overlapped=True)
        try:
            ov.GetOverlappedResult(True)
        except OSError as error:
            if error.winerror != 535:  # ERROR_PIPE_CONNECTED: the client was already there
                raise

    def recv(self, n: int) -> bytes:
        try:
            ov, err = self.w.ReadFile(self.h, n, overlapped=True)
            transferred, err = ov.GetOverlappedResult(True)
            return ov.getbuffer()[:transferred] if transferred else b""
        except OSError:
            return b""

    def sendall(self, data: bytes) -> None:
        ov, err = self.w.WriteFile(self.h, data, overlapped=True)
        ov.GetOverlappedResult(True)


class Commands:
    """The Previewer's command channel (we are the server; it connects once at start)."""

    def __init__(self, name: str):
        self.path = f"/tmp/{name}_commandPipe"
        self.conn = None
        self.lock = threading.Lock()
        self.last_reply = b""
        self.replied = threading.Event()
        if sys.platform == "win32":
            self.pipe_name = rf"\\.\pipe\{name}_commandPipe"
            self.server = None
        else:
            try:
                os.unlink(self.path)
            except FileNotFoundError:
                pass
            self.server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            self.server.bind(self.path)
            os.chmod(self.path, 0o600)
            self.server.listen(1)
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self):
        while True:
            conn = self._wait_client()
            self.conn = conn
            log("previewer connected to the command socket")
            try:
                while True:
                    data = conn.recv(1 << 20)
                    if not data:
                        break
                    self.last_reply = (self.last_reply + data)[-(8 << 20):]
                    self.replied.set()
            except OSError:
                pass
            log("previewer left the command socket")
            self.conn = None

    def _wait_client(self):
        if self.server is not None:
            return self.server.accept()[0]
        return WinPipe(self.pipe_name)

    def send(self, command: str, args, kind: str = "action") -> bool:
        conn = self.conn
        if conn is None:
            return False
        payload = json.dumps({"type": kind, "command": command, "version": "1.0.1", "args": args}).encode()
        with self.lock:
            # The Previewer parses whatever one recv() returns as ONE JSON: two commands in one read wedge it.
            # Wait for this command's reply (every command answers) before the next one goes out.
            self.replied.clear()
            conn.sendall(payload)
            self.replied.wait(3)
            time.sleep(0.03)
        return True

    def key(self, name: str) -> bool:
        if name == "back":
            return self.send("BackClicked", None)
        code = OH_KEYS[name]
        ok = True
        for action in (0, 1):  # down, up: the release carries no pressed codes
            ok &= self.send("KeyPress", {"isInputMethod": False, "keyCode": code, "keyAction": action,
                                         "pressedCodes": [code] if action == 0 else [], "keyString": ""})
        return ok

    def key_long(self, name: str) -> bool:
        """Hold a key for about a second (down, wait, up)."""
        code = OH_KEYS[name]
        ok = self.send("KeyPress", {"isInputMethod": False, "keyCode": code, "keyAction": 0, "pressedCodes": [code], "keyString": ""})
        time.sleep(1.1)
        return ok & self.send("KeyPress", {"isInputMethod": False, "keyCode": code, "keyAction": 1, "pressedCodes": [code], "keyString": ""})

    def type_char(self, ch: str) -> bool:
        """One hardware key event; the Previewer inserts keyString (one action only, or it doubles)."""
        if ch.isalpha():
            code = 2017 + ord(ch.lower()) - ord("a")
        elif ch.isdigit():
            code = 2000 + int(ch)
        else:
            code = {".": 2044, ",": 2043, "/": 2064, "-": 2057, ":": 2062, ";": 2062, "@": 2065, "_": 2057,
                    " ": 2050, "=": 2058}.get(ch, 2062)
        pressed = [2047, code] if ch in ":_" or ch.isupper() else [code]  # 2047 = left shift
        return self.send("KeyPress", {"isInputMethod": False, "keyCode": code, "keyAction": 0,
                                      "pressedCodes": pressed, "keyString": ch})

    def clear_field(self, count: int = 80) -> bool:
        return all(self.send("KeyPress", {"isInputMethod": False, "keyCode": 2055, "keyAction": 0,
                                          "pressedCodes": [2055], "keyString": ""}) for _ in range(count))

    def hold(self, x: int, y: int, seconds: float = 1.3) -> bool:
        """A long press: press, wait, release."""
        ok = self.send("MousePress", {"x": x, "y": y})
        time.sleep(seconds)
        return ok and self.send("MouseRelease", {"x": x, "y": y})

    def swipe(self, x1: int, y1: int, x2: int, y2: int, steps: int = 12, ms: int = 300) -> bool:
        """A drag: press at (x1, y1), `steps` pointer moves spread over about `ms` ms along the line, release at (x2, y2)."""
        steps = max(1, steps)
        ok = self.send("MousePress", {"x": x1, "y": y1})
        for i in range(1, steps + 1):
            x = round(x1 + (x2 - x1) * i / steps)
            y = round(y1 + (y2 - y1) * i / steps)
            ok &= self.send("MouseMove", {"x": x, "y": y})
            time.sleep(max(0.0, ms / 1000 / steps - 0.03))  # send() already waits about 30 ms
        return ok and self.send("MouseRelease", {"x": x2, "y": y2})

    def wheel(self, x: int, y: int, rotate: float) -> bool:
        """A mouse-wheel turn over (x, y): positive scrolls the content up (towards its end), negative back."""
        return self.send("MouseWheel", {"x": x, "y": y, "rotate": rotate})

    def click(self, x: int, y: int) -> bool:
        return self.send("MousePress", {"x": x, "y": y}) and self.send("MouseRelease", {"x": x, "y": y})

    def long_click(self, x: int, y: int) -> bool:
        """Press, hold for about 1.3 s (past the long-press threshold), release."""
        ok = self.send("MousePress", {"x": x, "y": y})
        time.sleep(1.3)
        return ok and self.send("MouseRelease", {"x": x, "y": y})


def ws_connect(port: int, path: str):
    """Client websocket handshake; returns (socket, leftover bytes)."""
    sock = socket.create_connection(("127.0.0.1", port), timeout=10)
    key = base64.b64encode(os.urandom(16)).decode()
    sock.sendall((f"GET /{path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                  f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
    head = b""
    while b"\r\n\r\n" not in head:
        chunk = sock.recv(4096)
        if not chunk:
            raise ConnectionError("closed during handshake")
        head += chunk
    if b" 101 " not in head.split(b"\r\n", 1)[0]:
        raise ConnectionError(head.split(b"\r\n", 1)[0].decode("latin-1"))
    sock.settimeout(None)
    return sock, head.split(b"\r\n\r\n", 1)[1]


def ws_messages(sock, buf: bytes):
    """Yields complete (opcode, payload) messages from an unmasked server stream."""
    message, first = b"", 0

    def need(n):
        nonlocal buf
        while len(buf) < n:
            chunk = sock.recv(1 << 20)
            if not chunk:
                raise ConnectionError("websocket closed")
            buf += chunk

    while True:
        need(2)
        b0, b1 = buf[0], buf[1]
        length, off = b1 & 0x7F, 2
        if length == 126:
            need(4)
            length, off = struct.unpack(">H", buf[2:4])[0], 4
        elif length == 127:
            need(10)
            length, off = struct.unpack(">Q", buf[2:10])[0], 10
        need(off + length)
        payload, buf = buf[off:off + length], buf[off + length:]
        opcode = b0 & 0x0F
        if opcode == 8:
            raise ConnectionError("websocket close frame")
        if opcode in (0, 1, 2):
            if opcode:
                first = opcode
            message += payload
            if b0 & 0x80:
                yield first, message
                message = b""


def ws_send_text(sock, text: str) -> None:
    data, mask = text.encode(), os.urandom(4)
    head = bytes([0x81])
    if len(data) < 126:
        head += bytes([0x80 | len(data)])
    elif len(data) < 65536:
        head += bytes([0x80 | 126]) + struct.pack(">H", len(data))
    else:
        head += bytes([0x80 | 127]) + struct.pack(">Q", len(data))
    sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))


def run_ws(hub, port: int, sid: str):
    """Reads frames from the Previewer websocket; publishes the JPEG part of each message."""
    while True:
        try:
            sock, buf = ws_connect(port, sid)
            hub.source = "previewer-ws"
            log("websocket connected")
            for _, message in ws_messages(sock, buf):
                start = message.find(b"\xff\xd8")
                if start >= 0:
                    hub.publish(message[start:])
        except (OSError, ConnectionError) as error:
            log(f"websocket: {error}; retrying")
            time.sleep(2)


def run_debugger(port: int):
    """Debug-mode Previewer (needed so EntryAbility runs) waits for a debugger: attach, release it, stay attached."""
    while True:
        try:
            sock, buf = ws_connect(port, "")
            log("debugger attached")
            for i, method in enumerate(("Runtime.enable", "Debugger.enable", "Runtime.runIfWaitingForDebugger"), 1):
                ws_send_text(sock, json.dumps({"id": i, "method": method, "params": {}}))
            for opcode, message in ws_messages(sock, buf):
                if b'"Debugger.paused"' in message:
                    ws_send_text(sock, json.dumps({"id": 99, "method": "Debugger.resume", "params": {}}))
        except (OSError, ConnectionError) as error:
            log(f"debugger: {error}; retrying")
            time.sleep(1)


class PreviewKeys:
    sent = failed = 0

    def __init__(self, commands: Commands):
        self.commands = commands

    def press(self, name: str) -> None:
        if self.commands.key(name):
            self.sent += 1
        else:
            self.failed += 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bind", required=True)
    parser.add_argument("--port", type=int, default=5907)
    parser.add_argument("--ws", type=int, default=40007)
    parser.add_argument("--ctl", type=int, default=40017)
    parser.add_argument("--sid", default="")
    parser.add_argument("--debug-port", type=int, default=40027)
    parser.add_argument("--cmd-name", default="playarr_cmd")
    parser.add_argument("--password-env", default="PLAYARR_VNC_SLOT7_PASSWORD")
    args = parser.parse_args()
    if args.bind in ("0.0.0.0", "::", ""):
        parser.error("--bind must be one interface address")

    commands = Commands(args.cmd_name)
    threading.Thread(target=run_debugger, args=(args.debug_port,), daemon=True).start()
    # VNC keysyms map to Previewer key names instead of tvOS HID usages
    sim_vnc.KEYSYM_TO_HID = KEYSYM
    vnc_args = argparse.Namespace(bind=args.bind, port=args.port, fps=30, password_env=args.password_env, ready_file="",
                                  metrics_file="", frame_file="", no_keys=True, udid="", idb="", source="auto")
    server = sim_vnc.Server(vnc_args)
    server.keys = PreviewKeys(commands)
    sim_vnc.start_frames = lambda hub, a, lg, stop: threading.Thread(
        target=run_ws, args=(hub, args.ws, args.sid), daemon=True).start()

    class Ctl(http.server.BaseHTTPRequestHandler):
        def _reply(self, code, body, kind="text/plain"):
            self.send_response(code)
            self.send_header("content-type", kind)
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):  # noqa: N802
            url = urllib.parse.urlparse(self.path)
            query = urllib.parse.parse_qs(url.query)
            if url.path == "/shot":
                with server.hub.cond:
                    jpeg = server.hub.jpeg
                return self._reply(200 if jpeg else 503, jpeg or b"no frame", "image/jpeg")
            if url.path == "/shot.png":
                with server.hub.cond:
                    jpeg = server.hub.jpeg
                if not jpeg:
                    return self._reply(503, b"no frame")
                from PIL import Image  # noqa: PLC0415  (only the PNG route needs Pillow)
                import io  # noqa: PLC0415
                out = io.BytesIO()
                Image.open(io.BytesIO(jpeg)).convert("RGB").save(out, "PNG")
                return self._reply(200, out.getvalue(), "image/png")
            if url.path.startswith("/key/"):
                name = url.path[5:]
                if name != "back" and name not in OH_KEYS:
                    return self._reply(400, b"unknown key")
                return self._reply(200 if commands.key(name) else 503, b"ok")
            if url.path == "/click":
                ok = commands.click(int(query["x"][0]), int(query["y"][0]))
                return self._reply(200 if ok else 503, b"ok")
            if url.path == "/swipe":
                ok = commands.swipe(int(query["x1"][0]), int(query["y1"][0]), int(query["x2"][0]), int(query["y2"][0]),
                                    int(query.get("steps", ["12"])[0]), int(query.get("ms", ["300"])[0]))
                return self._reply(200 if ok else 503, b"ok")
            if url.path == "/wheel":
                ok = commands.wheel(int(query["x"][0]), int(query["y"][0]), float(query["rotate"][0]))
                return self._reply(200 if ok else 503, b"ok")
            if url.path == "/longclick":
                ok = commands.long_click(int(query["x"][0]), int(query["y"][0]))
                return self._reply(200 if ok else 503, b"ok")
            if url.path == "/hold":
                ok = commands.hold(int(query["x"][0]), int(query["y"][0]))
                return self._reply(200 if ok else 503, b"ok")
            if url.path == "/type":
                ok = all(commands.type_char(ch) for ch in query["text"][0])
                return self._reply(200 if ok else 503, b"ok")
            if url.path == "/clear":
                return self._reply(200 if commands.clear_field() else 503, b"ok")
            if url.path == "/reply":
                body, commands.last_reply = commands.last_reply, b""
                return self._reply(200, body)
            if url.path.startswith("/img/"):
                data = IMAGES.get(url.path[5:])
                key = "bridge-img-served" if data is not None else "bridge-img-404"  # temporary diagnostic: Home poster stall
                STATE.setdefault("dbgcount", {})[key] = STATE.get("dbgcount", {}).get(key, 0) + 1
                if data is None:
                    print(f"[img404] {time.monotonic():.1f} {url.path}", flush=True)
                    return self._reply(404, b"")
                return self._reply(200, data, "image/png" if data[:1] == b"\x89" else "image/jpeg")
            if url.path == "/state" and query:
                apply_state(query)
                return self._reply(200, b"ok")
            if url.path == "/state":
                return self._reply(200, json.dumps(snapshot_state()).encode(), "application/json")
            if url.path.startswith("/keylong/"):
                name = url.path[9:]
                if name not in OH_KEYS:
                    return self._reply(400, b"unknown key")
                return self._reply(200 if commands.key_long(name) else 503, b"ok")
            if url.path == "/setroute":
                ROUTE_BOX["name"] = query.get("name", [""])[0]
                return self._reply(200, b"ok")
            if url.path == "/route":
                name, ROUTE_BOX["name"] = ROUTE_BOX["name"], ""
                return self._reply(200, name.encode())
            if url.path == "/health":
                return self._reply(200, f"frames={server.hub.count} size={server.hub.size} cmd={'up' if commands.conn else 'down'} images={len(IMAGES)} reply={commands.last_reply[-120:]!r}\n".encode())
            return self._reply(404, b"")

        def do_POST(self):  # noqa: N802
            url = urllib.parse.urlparse(self.path)
            if url.path == "/imgput":
                image_id = urllib.parse.parse_qs(url.query).get("id", [""])[0]
                if not valid_numeric_image_key(image_id):
                    return self._reply(400, b"invalid image key")
                try:
                    content_length = int(self.headers.get("content-length", "0"))
                except ValueError:
                    return self._reply(400, b"invalid image payload length")
                if content_length <= 0:
                    return self._reply(400, b"empty image payload")
                if content_length > MAX_IMAGE_PAYLOAD_BYTES:
                    record_image_payload_status(image_id, "oversized")
                    return self._reply(413, b"image payload too large")
                raw = self.rfile.read(content_length)
                if len(raw) != content_length:
                    return self._reply(400, b"truncated image payload")
                status = record_image_upload(image_id, raw)
                key = "bridge-imgput-" + status  # temporary diagnostic: Home poster stall
                STATE.setdefault("dbgcount", {})[key] = STATE.get("dbgcount", {}).get(key, 0) + 1
                if status == "oversized":
                    return self._reply(413, b"image payload too large")
                if status != "ok":
                    return self._reply(415, b"unsupported image payload")
                return self._reply(200, b"ok")
            try:
                content_length = int(self.headers.get("content-length", "0"))
            except ValueError:
                return self._reply(400, b"invalid request length")
            if content_length < 0 or (url.path == "/preview-batch" and
                                      content_length > MAX_PREVIEW_TELEMETRY_BATCH_BYTES):
                return self._reply(413, b"request too large")
            raw = self.rfile.read(content_length)
            if url.path == "/preview-batch":
                if len(raw) != content_length:
                    return self._reply(400, b"truncated telemetry batch")
                try:
                    payload = json.loads(raw or b"{}")
                except (TypeError, ValueError):
                    return self._reply(400, b"invalid telemetry batch")
                if (not isinstance(payload, dict) or set(payload) != {"batch_id", "events"} or
                        not dispatch_preview_telemetry_batch(payload.get("batch_id"), payload.get("events"),
                                                             hashlib.sha256(raw).hexdigest())):
                    return self._reply(400, b"telemetry batch rejected")
                return self._reply(200, b"ok")
            body = json.loads(raw or b"{}")
            if url.path == "/preview-state":
                apply_state({
                    "route": [str(body.get("route", ""))],
                    "kind": [str(body.get("kind", ""))],
                    "work": [str(body.get("work_id", ""))],
                    "generation": [str(body.get("generation", "0"))],
                })
                return self._reply(200, b"ok")
            if url.path == "/row-image":
                # Compatibility for older local overlays; capture.py gates on the staged on-complete event below.
                append_row_image_event(body)
                return self._reply(200, b"ok")
            if url.path == "/row-image-stage":
                append_detail_image_stage(body)
                return self._reply(200, b"ok")
            if url.path == "/image-metrics-scope":
                append_detail_image_payload_scope(body)
                return self._reply(200, b"ok")
            if url.path == "/layout-stage":
                append_detail_layout_stage(body)
                return self._reply(200, b"ok")
            if url.path == "/detail-load":
                append_detail_load_event(body)
                return self._reply(200, b"ok")
            if url.path == "/episode-target":
                append_detail_episode_target(body)
                return self._reply(200, b"ok")
            if url.path == "/episode-card-area":
                append_detail_episode_card_area(body)
                return self._reply(200, b"ok")
            if url.path == "/episode-card-container-area":
                append_detail_episode_card_container_area(body)
                return self._reply(200, b"ok")
            ok = commands.send(body["command"], body.get("args"), body.get("type", "action"))
            return self._reply(200 if ok else 503, b"ok")

        def log_message(self, *a):
            pass

    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", args.ctl), Ctl)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    log(f"control on 127.0.0.1:{args.ctl}")
    server.serve()


if __name__ == "__main__":
    main()
