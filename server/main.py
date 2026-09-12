"""
FD-LMS: FastAPI REST API, Static File Server & Admin Portal
Ultra-fast spatial streaming with GZip compression and in-memory cache.
Fully Supabase-backed — no local SQLite fallback.
"""

import os
import json
import threading
from typing import Optional, Dict, Any
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Request, Response, Depends, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.gzip import GZipMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from pydantic import BaseModel

from server import db, auth, admin_db, uploader

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(BASE_DIR, "static")
ADMIN_STATIC_DIR = os.path.join(STATIC_DIR, "admin")
try:
    os.makedirs(ADMIN_STATIC_DIR, exist_ok=True)
except OSError:
    pass


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
    description="High-Speed Cadastral Boundary Portal & Administrative Backend",
    version="2.3.0",
    lifespan=lifespan
)

app.add_middleware(GZipMiddleware, minimum_size=1000)


class CacheControlMiddleware(BaseHTTPMiddleware):
    """
    Fine-grained cache headers:
    - /              → no-cache (HTML must always be re-validated)
    - /admin         → no-cache
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
            if path == "/" or path.startswith("/admin") or path.endswith(".html"):
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
# Public APIs
# ---------------------------------------------------------------------------
@app.get("/api/health")
def health():
    return {"status": "ok", "system": "FD-LMS", "version": "2.3.0"}


@app.get("/api/stats")
def get_stats():
    return db.get_stats()


@app.get("/api/mouzas")
@app.get("/api/mouza-boundaries")
def get_mouzas():
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
@app.get("/api/cs_plots/geojson")
def get_cs_plots_geojson(
    request: Request,
    bbox: Optional[str] = Query(None, description="minx,miny,maxx,maxy"),
    plot_no: Optional[str] = Query(None),
    uid: Optional[str] = Query(None),
    limit: int = Query(35000, ge=1, le=100000)
):
    is_unfiltered = not bbox and not plot_no and not uid
    if is_unfiltered:
        gzip_bytes, etag = db.get_cs_plots_gzip_and_etag()
        if request.headers.get("if-none-match") == etag:
            return Response(status_code=304, headers={"ETag": etag, "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600"})
        return Response(
            content=gzip_bytes,
            media_type="application/geo+json",
            headers={
                "Content-Encoding": "gzip",
                "ETag": etag,
                "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600"
            }
        )

    json_bytes = db.get_cs_plots_json_bytes(bbox=bbox, plot_no=plot_no, uid=uid, limit=limit)
    return Response(content=json_bytes, media_type="application/geo+json")


@app.get("/api/encroachments/geojson")
def get_encroachments_geojson(request: Request):
    gzip_bytes, etag = db.get_encroachment_gzip_and_etag()
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag, "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600"})
    return Response(
        content=gzip_bytes,
        media_type="application/geo+json",
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
@app.get("/api/cs_plots/{plot_id}/dossier")
def get_cs_plot_dossier(plot_id: int):
    dossier = db.get_cs_plot_dossier(plot_id)
    if not dossier:
        raise HTTPException(status_code=404, detail="CS Plot not found")
    return dossier


@app.get("/api/dossier/bulk")
def get_bulk_dossier(request: Request):
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


# ---------------------------------------------------------------------------
# Admin Authentication Endpoints
# ---------------------------------------------------------------------------
class LoginPayload(BaseModel):
    username: str
    password: str


@app.post("/api/admin/login")
def admin_login(creds: LoginPayload, response: Response):
    if not auth.verify_credentials(creds.username, creds.password):
        raise HTTPException(status_code=401, detail="Invalid admin username or password")
    token = auth.create_access_token(creds.username)
    response.set_cookie(
        key="fd_admin_session",
        value=token,
        max_age=auth.TOKEN_EXPIRY_SECONDS,
        httponly=True,
        samesite="lax"
    )
    return {"success": True, "token": token, "username": creds.username}


@app.post("/api/admin/logout")
def admin_logout(response: Response):
    response.delete_cookie(key="fd_admin_session")
    return {"success": True}


@app.get("/api/admin/me")
def admin_me(current_user: dict = Depends(auth.get_current_admin)):
    return {"authenticated": True, "username": current_user["username"]}


# ---------------------------------------------------------------------------
# Admin Data Management & Table CRUD Endpoints
# ---------------------------------------------------------------------------
@app.get("/api/admin/stats")
def admin_get_stats(current_user: dict = Depends(auth.get_current_admin)):
    return admin_db.get_admin_stats()


@app.get("/api/admin/filters")
def admin_get_filters(current_user: dict = Depends(auth.get_current_admin)):
    return admin_db.get_filter_options()


@app.get("/api/admin/tables/{table}")
def admin_list_table_records(
    table: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=5, le=100),
    search: str = Query("", max_length=100),
    beat: str = Query(""),
    mouza: str = Query(""),
    sort_by: str = Query("id"),
    sort_dir: str = Query("desc"),
    current_user: dict = Depends(auth.get_current_admin)
):
    try:
        return admin_db.list_records(
            table=table,
            page=page,
            page_size=page_size,
            search=search,
            beat=beat,
            mouza=mouza,
            sort_by=sort_by,
            sort_dir=sort_dir
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/admin/tables/{table}/{record_id}")
def admin_get_single_record(
    table: str,
    record_id: int,
    current_user: dict = Depends(auth.get_current_admin)
):
    rec = admin_db.get_record(table, record_id)
    if not rec:
        raise HTTPException(status_code=404, detail=f"Record {record_id} not found in {table}")
    return rec


@app.post("/api/admin/tables/{table}")
async def admin_create_record(
    table: str,
    request: Request,
    current_user: dict = Depends(auth.get_current_admin)
):
    data = await request.json()
    try:
        return admin_db.create_record(table, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.put("/api/admin/tables/{table}/{record_id}")
async def admin_update_record(
    table: str,
    record_id: int,
    request: Request,
    current_user: dict = Depends(auth.get_current_admin)
):
    data = await request.json()
    rec = admin_db.update_record(table, record_id, data)
    if not rec:
        raise HTTPException(status_code=404, detail=f"Record {record_id} not found in {table}")
    return rec


@app.delete("/api/admin/tables/{table}/{record_id}")
def admin_delete_record(
    table: str,
    record_id: int,
    current_user: dict = Depends(auth.get_current_admin)
):
    ok = admin_db.delete_record(table, record_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Record {record_id} not found in {table}")
    return {"success": True, "deleted_id": record_id}


# ---------------------------------------------------------------------------
# Admin File Upload & Ingestion Endpoints
# ---------------------------------------------------------------------------
@app.post("/api/admin/upload/preview")
async def admin_upload_preview(
    file: UploadFile = File(...),
    target_table: str = Form(...),
    current_user: dict = Depends(auth.get_current_admin)
):
    contents = await file.read()
    try:
        return uploader.preview_upload(contents, file.filename, target_table)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Preview error: {str(e)}")


@app.post("/api/admin/upload/commit")
async def admin_upload_commit(
    file: UploadFile = File(...),
    target_table: str = Form(...),
    mode: str = Form("append"),
    mapping_json: Optional[str] = Form(None),
    current_user: dict = Depends(auth.get_current_admin)
):
    contents = await file.read()
    custom_mapping = None
    if mapping_json:
        try:
            custom_mapping = json.loads(mapping_json)
        except Exception:
            pass
    try:
        return uploader.commit_upload(contents, file.filename, target_table, mode, custom_mapping)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Commit error: {str(e)}")


# ---------------------------------------------------------------------------
# Admin Cache & Snapshot Rebuild Endpoints
# ---------------------------------------------------------------------------
@app.post("/api/admin/cache/rebuild")
def admin_rebuild_cache(current_user: dict = Depends(auth.get_current_admin)):
    try:
        results = db.rebuild_snapshots()
        return {"success": True, "results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/admin/cache/clear")
def admin_clear_cache(current_user: dict = Depends(auth.get_current_admin)):
    db.invalidate_cache()
    return {"success": True, "message": "In-memory caches cleared"}


# ---------------------------------------------------------------------------
# Static Files & SPA Routing
# ---------------------------------------------------------------------------
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.api_route("/favicon.ico", methods=["GET", "HEAD"])
def serve_favicon():
    icon_path = os.path.join(STATIC_DIR, "bdfd_logo.svg")
    if os.path.exists(icon_path):
        return FileResponse(icon_path, media_type="image/svg+xml")
    return Response(status_code=204)


@app.api_route("/admin", methods=["GET", "HEAD"])
@app.api_route("/admin/{subpath:path}", methods=["GET", "HEAD"])
def serve_admin(subpath: str = ""):
    admin_index = os.path.join(ADMIN_STATIC_DIR, "index.html")
    if os.path.exists(admin_index):
        return FileResponse(admin_index)
    return Response(content="Admin Portal under initialization...", media_type="text/plain")


@app.api_route("/", methods=["GET", "HEAD"])
def serve_index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))
