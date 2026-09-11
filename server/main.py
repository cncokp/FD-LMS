"""
FD-LMS: FastAPI REST API & Static File Server
Ultra-fast spatial streaming with GZip compression and in-memory cache.
Fully Supabase-backed — no local SQLite fallback.
"""

import os
import threading
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.gzip import GZipMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from server import db

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(BASE_DIR, "static")


# ---------------------------------------------------------------------------
# Startup: pre-warm the in-memory CS cache so the first real request is fast
# ---------------------------------------------------------------------------
def _prewarm():
    try:
        db.init_disk_cache()
        print("[FD-LMS] All disk caches pre-warmed [OK]")
    except Exception as e:
        print(f"[FD-LMS] Pre-warm failed: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    threading.Thread(target=_prewarm, daemon=True).start()
    yield


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Forest Department Land Management System (FD-LMS)",
    description="High-Speed Cadastral Boundary Portal",
    version="2.2.0",
    lifespan=lifespan
)

app.add_middleware(GZipMiddleware, minimum_size=1000)


class CacheControlMiddleware(BaseHTTPMiddleware):
    """
    Fine-grained cache headers:
    - /              → no-cache (HTML must always be re-validated)
    - /static/js/    → 1-year immutable (cache-busted via ?v= query param)
    - /static/css/   → 1-year immutable (cache-busted via ?v= query param)
    - /static/data/  → 24h (beat boundaries GeoJSON, etc.)
    - /static/*.svg  → 24h (logos)
    - /api/          → no-store
    """
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        if request.method == "GET" and response.status_code == 200:
            path = request.url.path
            if path == "/" or path.endswith(".html"):
                response.headers["Cache-Control"] = "no-cache"
            elif path.startswith("/static/js/") or path.startswith("/static/css/"):
                response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            elif path.startswith("/static/data/"):
                response.headers["Cache-Control"] = "public, max-age=86400, stale-while-revalidate=3600"
            elif path.startswith("/static/") and path.endswith(".svg"):
                response.headers["Cache-Control"] = "public, max-age=86400, stale-while-revalidate=3600"
            elif path.startswith("/api/"):
                if "Cache-Control" not in response.headers:
                    response.headers["Cache-Control"] = "no-store"
        return response


app.add_middleware(CacheControlMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/api/health")
def health():
    return {"status": "ok", "system": "FD-LMS", "version": "2.2.0"}


@app.get("/api/stats")
def get_stats():
    return db.get_stats()


@app.get("/api/mouza-boundaries")
def get_mouza_boundaries():
    return db.get_mouza_boundaries()


@app.get("/api/beats/geojson")
@app.get("/api/boundaries/beats")
def get_beat_boundaries():
    path = os.path.join(STATIC_DIR, "data", "beat_boundaries.geojson")
    if os.path.exists(path):
        return FileResponse(path, media_type="application/json")
    raise HTTPException(status_code=404, detail="Beat boundaries not found")


@app.get("/api/plots")
@app.get("/api/plots/rs")
def get_plots(
    bbox: Optional[str] = Query(None, description="minx,miny,maxx,maxy in EPSG:4326"),
    plot_no: Optional[str] = Query(None),
    uid: Optional[str] = Query(None),
    limit: int = Query(35000, le=50000)
):
    json_bytes = db.get_rs_plots_json_bytes(bbox=bbox, plot_no=plot_no, uid=uid, limit=limit)
    return Response(content=json_bytes, media_type="application/json")


@app.get("/api/plots/cs")
def get_cs_plots(
    request: Request,
    bbox: Optional[str] = Query(None, description="minx,miny,maxx,maxy in EPSG:4326"),
    plot_no: Optional[str] = Query(None),
    uid: Optional[str] = Query(None),
    limit: int = Query(35000, le=50000)
):
    if not bbox and not plot_no and not uid:
        gzip_bytes, etag = db.get_cs_plots_gzip_and_etag()
        if request.headers.get("if-none-match") == etag:
            return Response(status_code=304, headers={"ETag": etag, "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600"})
        return Response(
            content=gzip_bytes,
            media_type="application/json",
            headers={
                "Content-Encoding": "gzip",
                "ETag": etag,
                "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600"
            }
        )
    json_bytes = db.get_cs_plots_json_bytes(bbox=bbox, plot_no=plot_no, uid=uid, limit=limit)
    return Response(content=json_bytes, media_type="application/json")


@app.get("/api/encroachments/geojson")
def get_encroachments_geojson(request: Request):
    gzip_bytes, etag = db.get_encroachment_gzip_and_etag()
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag, "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600"})
    return Response(
        content=gzip_bytes,
        media_type="application/json",
        headers={
            "Content-Encoding": "gzip",
            "ETag": etag,
            "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600"
        }
    )


@app.get("/api/encroachments/summary")
def get_encroachments_summary():
    return db.get_encroachment_summary()


@app.get("/api/plots/cs/{plot_id}")
def get_cs_plot_dossier(plot_id: int):
    dossier = db.get_cs_plot_dossier(plot_id)
    if not dossier:
        raise HTTPException(status_code=404, detail="CS Plot not found")
    return dossier


@app.get("/api/dossier/bulk")
def get_bulk_dossier(request: Request):
    """Returns all parcel_info + encroachment data keyed by uid in one payload.
    Client caches in IndexedDB — enables instant zero-API-call dossier rendering."""
    gzip_bytes, etag = db.get_bulk_dossier_gzip_and_etag()
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag, "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600"})
    return Response(
        content=gzip_bytes,
        media_type="application/json",
        headers={
            "Content-Encoding": "gzip",
            "ETag": etag,
            "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600"
        }
    )


@app.get("/api/plots/{plot_id}")
@app.get("/api/plots/rs/{plot_id}")
def get_plot_dossier(plot_id: int):
    dossier = db.get_plot_dossier(plot_id)
    if not dossier:
        raise HTTPException(status_code=404, detail="RS Plot not found")
    return dossier


@app.get("/api/search")
def search(q: str = Query(..., min_length=1)):
    return db.search_records(query=q)


@app.get("/api/export/csv")
def export_csv():
    csv_data = db.export_plots_to_csv()
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=fd_plots_cs.csv"}
    )


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.api_route("/favicon.ico", methods=["GET", "HEAD"])
def serve_favicon():
    icon_path = os.path.join(STATIC_DIR, "bdfd_logo.svg")
    if os.path.exists(icon_path):
        return FileResponse(icon_path, media_type="image/svg+xml")
    return Response(status_code=204)


@app.api_route("/", methods=["GET", "HEAD"])
def serve_index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))
