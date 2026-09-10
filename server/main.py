"""
FD-LMS: FastAPI REST API & Static File Server
Ultra-fast spatial streaming with GZip compression and in-memory cache.
"""

import os
from typing import Optional
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from starlette.middleware.base import BaseHTTPMiddleware

from fastapi.middleware.gzip import GZipMiddleware

from server import db

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(BASE_DIR, "static")

app = FastAPI(
    title="Forest Department Land Management System (FD-LMS)",
    description="High-Speed Cadastral Boundary Portal",
    version="2.1.0"
)

app.add_middleware(GZipMiddleware, minimum_size=1000)



class CacheControlMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        if request.method == "GET" and response.status_code == 200:
            path = request.url.path
            if path.startswith("/static/") or path == "/" or path == "/sw.js":
                response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
                response.headers["Pragma"] = "no-cache"
                response.headers["Expires"] = "0"
            elif path.startswith("/api/"):
                response.headers["Cache-Control"] = "no-cache"
        return response

app.add_middleware(CacheControlMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/sw.js")
def serve_service_worker():
    sw_path = os.path.join(STATIC_DIR, "sw.js")
    if os.path.exists(sw_path):
        return FileResponse(sw_path, media_type="application/javascript", headers={"Cache-Control": "no-cache"})
    raise HTTPException(status_code=404, detail="Service worker not found")

@app.get("/api/health")
def health():
    return {"status": "ok", "system": "FD-LMS", "version": "2.1.0"}

@app.get("/api/stats")
def get_stats():
    return db.get_stats()

@app.get("/api/mouza-boundaries")
def get_mouza_boundaries():
    return db.get_mouza_boundaries()

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
    bbox: Optional[str] = Query(None, description="minx,miny,maxx,maxy in EPSG:4326"),
    plot_no: Optional[str] = Query(None),
    uid: Optional[str] = Query(None),
    limit: int = Query(35000, le=50000)
):
    json_bytes = db.get_cs_plots_json_bytes(bbox=bbox, plot_no=plot_no, uid=uid, limit=limit)
    return Response(content=json_bytes, media_type="application/json")

@app.get("/api/encroachments/geojson")
def get_encroachments_geojson():
    json_bytes = db.get_encroachment_geojson_bytes()
    return Response(content=json_bytes, media_type="application/json")

@app.get("/api/encroachments/summary")
def get_encroachments_summary():
    return db.get_encroachment_summary()

@app.get("/api/plots/cs/{plot_id}")
def get_cs_plot_dossier(plot_id: int):
    dossier = db.get_cs_plot_dossier(plot_id)
    if not dossier:
        raise HTTPException(status_code=404, detail="CS Plot not found")
    return dossier

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

@app.get("/")
def serve_index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))
