/**
 * FD-LMS: Leaflet WebGIS Map Controller
 * High-performance vector rendering & robust plot interaction
 */

const PlotLabelLayer = L.Layer.extend({
  initialize(options) {
    L.setOptions(this, options);
    this._labels = [];
  },

  onAdd(map) {
    this._map = map;
    if (!this._canvas) {
      this._canvas = L.DomUtil.create('canvas', 'leaflet-plot-label-canvas');
      this._canvas.style.position = 'absolute';
      this._canvas.style.pointerEvents = 'none';
      this._canvas.style.willChange = 'transform';
    }
    const pane = map.getPane('labelPane') || map.getPanes().overlayPane;
    pane.appendChild(this._canvas);

    this._onMove = () => {
      if (this._map && this._map._animatingZoom) return;
      if (!this._rafId) {
        this._rafId = requestAnimationFrame(() => {
          this._rafId = null;
          this._update();
        });
      }
    };

    map.on('move', this._onMove, this);
    map.on('moveend', this._onMove, this);
    map.on('zoomend', this._onMove, this);
    map.on('resize', this._resize, this);
    this._resize();
    this._update();
  },

  onRemove(map) {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this._canvas && this._canvas.parentNode) {
      this._canvas.parentNode.removeChild(this._canvas);
    }
    map.off('move', this._onMove, this);
    map.off('moveend', this._onMove, this);
    map.off('zoomend', this._onMove, this);
    map.off('resize', this._resize, this);
  },

  setLabels(labels) {
    this._labels = labels || [];
    if (!this._rafId) {
      this._rafId = requestAnimationFrame(() => {
        this._rafId = null;
        this._update();
      });
    }
  },

  _resize() {
    if (!this._map || !this._canvas) return;
    const size = this._map.getSize();
    const dpr = window.devicePixelRatio || 1;
    this._canvas.width = size.x * dpr;
    this._canvas.height = size.y * dpr;
    this._canvas.style.width = size.x + 'px';
    this._canvas.style.height = size.y + 'px';
    this._update();
  },

  _update() {
    if (!this._map || !this._canvas) return;
    if (this._map._animatingZoom) return; // Never block zoom animation frames!
    const ctx = this._canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);

    const zoom = this._map.getZoom();
    if (zoom < 15 || this._labels.length === 0) return;

    const bounds = this._map.getBounds();
    const south = bounds.getSouth();
    const north = bounds.getNorth();
    const west = bounds.getWest();
    const east = bounds.getEast();

    const origin = this._map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(this._canvas, origin);

    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    let defaultFontSize = 11.5;
    if (zoom >= 18) defaultFontSize = 14;
    else if (zoom >= 17) defaultFontSize = 13;
    else if (zoom === 16) defaultFontSize = 11.5;
    else defaultFontSize = 10.5;

    ctx.lineJoin = 'round';

    for (let i = 0; i < this._labels.length; i++) {
      const item = this._labels[i];
      const lat = item.latlng[0];
      const lng = item.latlng[1];
      if (lat >= south && lat <= north && lng >= west && lng <= east) {
        const pt = this._map.latLngToLayerPoint(item.latlng);
        const x = pt.x - origin.x;
        const y = pt.y - origin.y;

        let itemFontSize = defaultFontSize;
        if (item.radius && item.radius > 0) {
          const edgePt = this._map.latLngToLayerPoint([lat, lng + item.radius]);
          const clearancePx = Math.hypot(pt.x - edgePt.x, pt.y - edgePt.y);

          if (clearancePx < 4.5) continue;

          if (clearancePx < 11.0) {
            itemFontSize = Math.max(8.0, clearancePx * 0.95);
          }
        }

        ctx.font = `800 ${itemFontSize}px "JetBrains Mono", "Plus Jakarta Sans", monospace`;
        ctx.lineWidth = itemFontSize > 10 ? 3.0 : 2.0;

        ctx.strokeStyle = '#1e1b18';
        ctx.strokeText(item.text, x, y);
        ctx.fillStyle = '#fde047';
        ctx.fillText(item.text, x, y);
      }
    }

    ctx.restore();
  }
});

const SpatialCache = {
  dbName: 'fd_lms_spatial_v8',
  storeName: 'datasets',
  dbPromise: null,

  async getDB() {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve) => {
        if (typeof indexedDB === 'undefined') return resolve(null);
        const req = indexedDB.open(this.dbName, 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            db.createObjectStore(this.storeName);
          }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = () => resolve(null);
      });
    }
    return this.dbPromise;
  },

  async get(key) {
    try {
      const db = await this.getDB();
      if (!db) return null;
      return new Promise((resolve) => {
        const tx = db.transaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  },

  async set(key, val) {
    try {
      const db = await this.getDB();
      if (!db) return;
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      store.put(val, key);
    } catch {
      // ignore
    }
  }
};

// ---------------------------------------------------------------------------
// Dossier LRU Cache — keyed by plot_id (integer), max 100 entries
// JS Map preserves insertion order, so the first key is always the oldest.
// ---------------------------------------------------------------------------
const _dossierCache = new Map();
const DOSSIER_CACHE_MAX = 100;

function _dossierCacheGet(plotId) {
  return _dossierCache.get(plotId) ?? null;
}

function _dossierCacheSet(plotId, data) {
  if (_dossierCache.size >= DOSSIER_CACHE_MAX) {
    // Evict the oldest entry (first key in insertion order)
    _dossierCache.delete(_dossierCache.keys().next().value);
  }
  _dossierCache.set(plotId, data);
}

// ---------------------------------------------------------------------------
// Bulk Dossier Map — keyed by uid (string), populated from /api/dossier/bulk
// Enables instant full-dossier render from memory, zero API calls per click.
// ---------------------------------------------------------------------------
let _bulkDossierMap = null; // null = not yet loaded; {} = loaded but empty

const BULK_DOSSIER_CACHE_KEY = 'bulk_dossier_v3';
const BULK_DOSSIER_TTL       = 86400 * 1000; // 24 hours

async function _storeBulkInMemory(payload) {
  if (!payload || !payload.by_uid) return;
  _bulkDossierMap = payload.by_uid; // plain object — O(1) uid lookup
}

async function _fetchAndCacheBulk() {
  try {
    const res  = await fetch('/api/dossier/bulk');
    const data = await res.json();
    if (data && data.by_uid) {
      await SpatialCache.set(BULK_DOSSIER_CACHE_KEY, { data, _ts: Date.now() });
      await _storeBulkInMemory(data);
    }
  } catch (e) {
    console.warn('Bulk dossier fetch failed:', e);
  }
}

async function loadBulkDossier() {
  // 1. Try IndexedDB — if fresh (<24h) render immediately and refresh in background
  try {
    const cached = await SpatialCache.get(BULK_DOSSIER_CACHE_KEY);
    if (cached && cached._ts && cached.data && cached.data.by_uid) {
      await _storeBulkInMemory(cached.data); // load into memory instantly
      const age = Date.now() - cached._ts;
      if (age < BULK_DOSSIER_TTL) {
        // Stale-while-revalidate: serve instantly, refresh silently in background
        _fetchAndCacheBulk();
        return;
      }
    }
  } catch (e) {
    console.warn('Bulk dossier IndexedDB lookup failed:', e);
  }
  // 2. Cache miss or expired → fetch fresh (blocks until done so first clicks are ready)
  await _fetchAndCacheBulk();
}

const MapEngine = {
  map: null,
  currentBasemap: 'satellite',
  basemapLayers: {},
  canvasRenderer: null,
  encroachRenderer: null,
  layers: {
    allPlots: null,
    forestPlots: null,
    csPlots: null,
    beatBoundaries: null,
    beatLabels: null,
    encroachments: null,
    hover: null,
    highlight: null,
    filterHighlight: null
  },
  geoLayers: {
    allPlots: null,
    forestPlots: null,
    cs: null,
    beatBoundaries: null,
    encroachments: null
  },
  labelLayer: null,
  rawCSData: null,
  rawEncroachData: null,
  rawBeatData: null,
  currentCSFeatures: [],
  forestFeatures: [],
  nonForestFeatures: [],
  plotsByUid: null,
  _currentHoveredId: null,
  _selectedUid: null,
  _selectedPlotId: null,
  isAllPlotsVisible: true,
  isForestPlotsVisible: true,
  isCSPlotsVisible: true,
  isBeatBoundariesVisible: true,
  isEncroachmentsVisible: true,
  _plotClicked: false,

  defaultParkBounds: [
    [24.030, 90.370],
    [24.150, 90.460]
  ],

  async init() {
    this.map = L.map('map', {
      center: [24.088, 90.415],
      zoom: 13,
      minZoom: 10,
      maxZoom: 22,
      zoomControl: false,
      attributionControl: false,
      fadeAnimation: true,
      zoomAnimation: true,
      zoomAnimationThreshold: 8,
      zoomSnap: 0.5,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 120,
      wheelDebounceTime: 40,
      preferCanvas: true
    });

    L.control.scale({ metric: true, imperial: false, position: 'bottomright' }).addTo(this.map);

    this.map.createPane('csPane');
    this.map.getPane('csPane').style.zIndex = 430;
    this.map.getPane('csPane').style.pointerEvents = 'auto';

    this.map.createPane('beatPane');
    this.map.getPane('beatPane').style.zIndex = 440;
    this.map.getPane('beatPane').style.pointerEvents = 'auto';

    this.map.createPane('encroachPane');
    this.map.getPane('encroachPane').style.zIndex = 450;
    this.map.getPane('encroachPane').style.pointerEvents = 'none';

    // Set canvasRenderer pane explicitly to csPane with generous click tolerance
    this.canvasRenderer = L.canvas({ padding: 0.5, tolerance: 10, pane: 'csPane' });
    this.encroachRenderer = L.svg({ pane: 'encroachPane' });

    this.map.createPane('hoverPane');
    this.map.getPane('hoverPane').style.zIndex = 470;
    this.map.getPane('hoverPane').style.pointerEvents = 'none';

    this.map.createPane('highlightPane');
    this.map.getPane('highlightPane').style.zIndex = 480;
    this.map.getPane('highlightPane').style.pointerEvents = 'none';

    this.map.createPane('labelPane');
    this.map.getPane('labelPane').style.zIndex = 500;
    this.map.getPane('labelPane').style.pointerEvents = 'none';

    this.initBasemaps();

    this.layers.allPlots = L.featureGroup([], { pane: 'csPane' }).addTo(this.map);
    this.layers.forestPlots = L.featureGroup([], { pane: 'csPane' }).addTo(this.map);
    this.layers.csPlots = this.layers.allPlots;
    this.layers.beatBoundaries = L.featureGroup([], { pane: 'beatPane' }).addTo(this.map);
    this.layers.beatLabels = L.featureGroup([], { pane: 'labelPane' }).addTo(this.map);
    this.layers.encroachments = L.featureGroup([], { pane: 'encroachPane' }).addTo(this.map);
    this.layers.hover = L.featureGroup([], { pane: 'hoverPane' }).addTo(this.map);
    this.layers.highlight = L.featureGroup([], { pane: 'highlightPane' }).addTo(this.map);
    this.layers.filterHighlight = L.featureGroup([], { pane: 'highlightPane' }).addTo(this.map);

    this.labelLayer = new PlotLabelLayer();
    this.map.addLayer(this.labelLayer);

    this.map.on('zoomend', () => {
      this.updateBeatLabelsVisibility();
    });

    // Map click: check if a plot was clicked
    this.map.on('click', (e) => {
      if (this._plotClicked) {
        return;
      }
      if (e.originalEvent && (e.originalEvent._stopped || e.originalEvent.defaultPrevented)) {
        return;
      }

      // Check if clicked inside a CS / Forest plot
      if (this.isAllPlotsVisible || this.isForestPlotsVisible) {
        const clickedPlot = this.findPlotAtLatLng(e.latlng);
        if (clickedPlot) {
          this._plotClicked = true;
          setTimeout(() => {
            this._plotClicked = false;
          }, 60);
          this.selectPlot('cs_plot', clickedPlot);
          return;
        }
      }

      this.clearHighlight();
      if (typeof Dossier !== 'undefined') Dossier.close();
    });

    // Hover prefetch: silently fetch dossier data while the user moves over plots.
    // Interactive Plot Hover Cursor & Background Prefetch
    let _hoverThrottled = false;
    let _prefetchTimer = null;
    let _lastPrefetchId = null;

    this.map.on('mousemove', (e) => {
      // 1. Dynamic Hover Cursor & Slight Plot Highlight
      if (!_hoverThrottled) {
        _hoverThrottled = true;
        requestAnimationFrame(() => {
          _hoverThrottled = false;
          const container = this.map.getContainer();
          let isOverPlot = false;
          let hoveredFeature = null;
          let isEncroach = false;

          if (this.isEncroachmentsVisible && this.rawEncroachData && this.rawEncroachData.features) {
            hoveredFeature = this.pointInFeatures(e.latlng, this.rawEncroachData.features);
            if (hoveredFeature) {
              isOverPlot = true;
              isEncroach = true;
            }
          }

          if (!isOverPlot && (this.isAllPlotsVisible || this.isForestPlotsVisible)) {
            hoveredFeature = this.findPlotAtLatLng(e.latlng);
            if (hoveredFeature) {
              isOverPlot = true;
            }
          }

          if (isOverPlot && hoveredFeature) {
            container.classList.add('map-hover-plot');
            this.setHoverPlot(hoveredFeature, isEncroach);
          } else {
            container.classList.remove('map-hover-plot');
            this.clearHoverPlot();
          }
        });
      }

      // 2. Prefetch dossier if bulk data is not yet in memory
      if (!this.isAllPlotsVisible && !this.isForestPlotsVisible) return;
      if (_bulkDossierMap) return;
      if (_prefetchTimer) return;
      _prefetchTimer = setTimeout(() => {
        _prefetchTimer = null;
        const feat = this.findPlotAtLatLng(e.latlng);
        if (!feat) return;
        const plotId = feat.properties && feat.properties.id;
        if (!plotId || plotId === _lastPrefetchId) return;
        if (_dossierCacheGet(plotId)) return;
        _lastPrefetchId = plotId;
        fetch(`/api/plots/cs/${plotId}`)
          .then(r => r.json())
          .then(data => { if (data && data.plot) _dossierCacheSet(plotId, data); })
          .catch(() => {});
      }, 100);
    });

    this.map.on('mouseout', () => {
      this.map.getContainer().classList.remove('map-hover-plot');
      this.clearHoverPlot();
    });

    this.map.on('dragstart', () => {
      this.map.getContainer().classList.remove('map-hover-plot');
      this.clearHoverPlot();
    });

    this.map.on('zoomstart', () => {
      this.clearHoverPlot();
    });

    await Promise.all([
      this.loadCSPlots(),
      this.loadEncroachments(),
      this.loadBeatBoundaries(),
      loadBulkDossier()          // bulk parcel+encroachment → IndexedDB → _bulkDossierMap
    ]);
    this.hideLoading();
  },

  showLoading(text = 'Loading Cadastral Parcels...') {
    const el = document.getElementById('mapLoadingIndicator');
    if (el) {
      const span = el.querySelector('#loadingStatusText') || el.querySelector('span');
      if (span && text) span.textContent = text;
      el.classList.remove('hidden');
    }
  },

  hideLoading() {
    const el = document.getElementById('mapLoadingIndicator');
    if (el) {
      el.classList.add('hidden');
    }
  },

  initBasemaps() {
    const tileOptions = {
      maxZoom: 22,
      maxNativeZoom: 19,
      crossOrigin: true,
      keepBuffer: 3,
      updateWhenIdle: true,
      updateWhenZooming: false
    };

    this.basemapLayers = {
      satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', tileOptions),
      hybrid: L.layerGroup([
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', tileOptions),
        L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { ...tileOptions, opacity: 0.85 })
      ]),
      street: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { ...tileOptions, maxNativeZoom: 19 }),
      osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { ...tileOptions, maxNativeZoom: 19 })
    };

    if (!this.basemapLayers[this.currentBasemap]) {
      this.currentBasemap = 'satellite';
    }
    this.basemapLayers[this.currentBasemap].addTo(this.map);
  },

  setBasemap(name) {
    if (name === 'osm') name = 'street';
    if (!this.basemapLayers[name] || this.currentBasemap === name) return;
    this.map.removeLayer(this.basemapLayers[this.currentBasemap]);
    this.basemapLayers[name].addTo(this.map);
    this.currentBasemap = name;
  },

  async loadCSPlots() {
    const CACHE_KEY = 'cs_plots_v3';
    const CACHE_TTL = 86400 * 1000; // 24 hours

    let cachedData = null;

    try {
      const cached = await SpatialCache.get(CACHE_KEY);
      if (cached) {
        cachedData = cached.data || cached;
        const ts = cached._ts || 0;
        if (cachedData && cachedData.features && cachedData.features.length > 0) {
          this.rawCSData = cachedData;
          this.renderCSPlotsGeoJSON(this.rawCSData);
          this.hideLoading();

          // If fresh (< 24 hours), we are completely done! Do not refetch, do not re-show loading, do not jump zoom!
          if (ts && (Date.now() - ts) < CACHE_TTL) {
            return;
          }
        }
      }
    } catch (err) {
      console.warn('Cache lookup skipped:', err);
    }

    // Only show loading if we didn't have any cached data to display
    if (!cachedData) {
      this.showLoading('Loading 11,300+ Cadastral Parcels...');
    }

    try {
      const res = await fetch('/api/plots/cs?limit=35000');
      const csData = await res.json();

      if (csData && csData.features && csData.features.length > 0) {
        SpatialCache.set(CACHE_KEY, { data: csData, _ts: Date.now() });
        this.rawCSData = csData;

        // If cold visit (first time without cache):
        if (!cachedData) {
          this.showLoading('Rendering Cadastral Parcels...');
          await new Promise(r => setTimeout(r, 20));
          this.renderCSPlotsGeoJSON(this.rawCSData);
          this.hideLoading();

          // Set initial bounds only on initial cold visit so user's map position is never jerked later
          if (csData.bounds) {
            const [minx, miny, maxx, maxy] = csData.bounds;
            this.map.fitBounds([[miny, minx], [maxy, maxx]], { padding: [30, 30] });
          }
        } else {
          // Stale-while-revalidate background update:
          // Silently refresh layer without showing loading screen and WITHOUT resetting user's zoom/pan!
          this.renderCSPlotsGeoJSON(this.rawCSData);
        }
      } else {
        this.hideLoading();
      }
    } catch (e) {
      this.hideLoading();
      if (!cachedData) {
        console.error("Failed to load CS plots:", e);
      }
    }
  },

  indexPlotBBoxes(features) {
    if (!features || !features.length) return;
    for (let i = 0; i < features.length; i++) {
      const f = features[i];
      if (f._bbox) continue;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const expand = (ring) => {
        if (!ring) return;
        for (let j = 0; j < ring.length; j++) {
          const pt = ring[j];
          if (pt[0] < minX) minX = pt[0];
          if (pt[0] > maxX) maxX = pt[0];
          if (pt[1] < minY) minY = pt[1];
          if (pt[1] > maxY) maxY = pt[1];
        }
      };
      const g = f.geometry;
      if (!g) continue;
      if (g.type === 'Polygon') {
        if (g.coordinates && g.coordinates.length > 0) expand(g.coordinates[0]);
      } else if (g.type === 'MultiPolygon') {
        if (g.coordinates) {
          for (let k = 0; k < g.coordinates.length; k++) {
            if (g.coordinates[k] && g.coordinates[k].length > 0) expand(g.coordinates[k][0]);
          }
        }
      }
      f._bbox = [minX, minY, maxX, maxY];
    }
  },

  pointInFeatures(latlng, features) {
    if (!latlng || !features || !features.length) return null;
    const lng = latlng.lng;
    const lat = latlng.lat;

    const candidates = [];
    for (let i = 0; i < features.length; i++) {
      const f = features[i];
      const b = f._bbox;
      if (b && lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3]) {
        candidates.push(f);
      }
    }

    if (!candidates.length) return null;

    function pointInRing(x, y, ring) {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    }

    function pointInPolygon(x, y, coords) {
      if (!coords || !coords.length) return false;
      if (!pointInRing(x, y, coords[0])) return false;
      for (let i = 1; i < coords.length; i++) {
        if (pointInRing(x, y, coords[i])) return false;
      }
      return true;
    }

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const g = c.geometry;
      if (!g) continue;
      if (g.type === 'Polygon') {
        if (pointInPolygon(lng, lat, g.coordinates)) return c;
      } else if (g.type === 'MultiPolygon') {
        if (g.coordinates) {
          for (let k = 0; k < g.coordinates.length; k++) {
            if (pointInPolygon(lng, lat, g.coordinates[k])) return c;
          }
        }
      }
    }
    return null;
  },

  findPlotAtLatLng(latlng) {
    if (!latlng) return null;
    if (!this.isAllPlotsVisible && !this.isForestPlotsVisible) return null;

    // If forest plots are visible, prioritize Forest Department plot
    if (this.isForestPlotsVisible && this.forestFeatures && this.forestFeatures.length) {
      const forestCandidate = this.pointInFeatures(latlng, this.forestFeatures);
      if (forestCandidate) return forestCandidate;
    }

    if (this.isAllPlotsVisible) {
      const allFeatures = this.currentCSFeatures || (this.rawCSData && this.rawCSData.features) || [];
      return this.pointInFeatures(latlng, allFeatures);
    }

    return null;
  },

  renderCSPlotsGeoJSON(geojsonData) {
    if (this.layers.allPlots) this.layers.allPlots.clearLayers();
    if (this.layers.forestPlots) this.layers.forestPlots.clearLayers();

    this.currentCSFeatures = (geojsonData && geojsonData.features) ? geojsonData.features : [];
    this.forestFeatures = [];
    this.nonForestFeatures = [];
    this.plotsByUid = new Map();

    for (let i = 0; i < this.currentCSFeatures.length; i++) {
      const f = this.currentCSFeatures[i];
      const p = f.properties;
      if (p && p.beat_name && p.beat_name.trim()) {
        this.forestFeatures.push(f);
      } else {
        this.nonForestFeatures.push(f);
      }
      if (p && p.uid != null) {
        const sUid = String(p.uid);
        let list = this.plotsByUid.get(sUid);
        if (!list) {
          list = [];
          this.plotsByUid.set(sUid, list);
        }
        list.push(f);
      }
    }

    this.indexPlotBBoxes(this.currentCSFeatures);
    this.updateLabels();

    // 1. Tier 1: Base Cadastral Grid (All 11,312 plots, subtle slate outline)
    const allPlotsGeoLayer = L.geoJSON(geojsonData, {
      renderer: this.canvasRenderer,
      interactive: true,
      style: () => ({
        color: '#64748b',
        weight: 0.9,
        opacity: 0.55,
        fillColor: '#64748b',
        fillOpacity: 0.03,
        interactive: true
      }),
      onEachFeature: (feature, layer) => {
        layer.on('click', (e) => {
          if (e) {
            if (e.originalEvent) {
              e.originalEvent._stopped = true;
              if (e.originalEvent.stopPropagation) e.originalEvent.stopPropagation();
            }
            if (L.DomEvent && L.DomEvent.stopPropagation) {
              L.DomEvent.stopPropagation(e);
            }
          }
          this._plotClicked = true;
          setTimeout(() => {
            this._plotClicked = false;
          }, 60);
          this.selectPlot('cs_plot', feature);
        });
      }
    });

    this.geoLayers.allPlots = allPlotsGeoLayer;
    this.geoLayers.cs = allPlotsGeoLayer;
    allPlotsGeoLayer.addTo(this.layers.allPlots);

    // 2. Tier 2: Forest Department Land (1,408 parcels, rich emerald green)
    const forestGeoData = {
      type: 'FeatureCollection',
      features: this.forestFeatures
    };

    const forestGeoLayer = L.geoJSON(forestGeoData, {
      renderer: this.canvasRenderer,
      interactive: true,
      style: () => ({
        color: '#059669',
        weight: 1.8,
        opacity: 0.95,
        fillColor: '#10b981',
        fillOpacity: 0.18,
        interactive: true
      }),
      onEachFeature: (feature, layer) => {
        layer.on('click', (e) => {
          if (e) {
            if (e.originalEvent) {
              e.originalEvent._stopped = true;
              if (e.originalEvent.stopPropagation) e.originalEvent.stopPropagation();
            }
            if (L.DomEvent && L.DomEvent.stopPropagation) {
              L.DomEvent.stopPropagation(e);
            }
          }
          this._plotClicked = true;
          setTimeout(() => {
            this._plotClicked = false;
          }, 60);
          this.selectPlot('cs_plot', feature);
        });
      }
    });

    this.geoLayers.forestPlots = forestGeoLayer;
    forestGeoLayer.addTo(this.layers.forestPlots);
  },

  toggleAllPlots(visible) {
    this.isAllPlotsVisible = visible;
    if (visible) {
      if (!this.map.hasLayer(this.layers.allPlots)) {
        this.map.addLayer(this.layers.allPlots);
      }
    } else {
      if (this.map.hasLayer(this.layers.allPlots)) {
        this.map.removeLayer(this.layers.allPlots);
      }
    }
    this.updateLabels();
    this.updateActiveLayerCount();
  },

  toggleForestPlots(visible) {
    this.isForestPlotsVisible = visible;
    if (visible) {
      if (!this.map.hasLayer(this.layers.forestPlots)) {
        this.map.addLayer(this.layers.forestPlots);
      }
    } else {
      if (this.map.hasLayer(this.layers.forestPlots)) {
        this.map.removeLayer(this.layers.forestPlots);
      }
    }
    this.updateLabels();
    this.updateActiveLayerCount();
  },

  toggleCSPlots(visible) {
    this.toggleAllPlots(visible);
    this.toggleForestPlots(visible);
  },

  async loadBeatBoundaries() {
    const CACHE_KEY   = 'beat_boundaries';
    const CACHE_TTL   = 86400 * 1000; // 24 hours

    // Try IndexedDB cache first
    try {
      const cached = await SpatialCache.get(CACHE_KEY);
      if (cached && cached._ts && (Date.now() - cached._ts) < CACHE_TTL && cached.data && cached.data.features) {
        this.rawBeatData = cached.data;
        this.renderBeatBoundariesGeoJSON(cached.data);
        return; // served from cache — no network fetch needed
      }
    } catch (err) {
      console.warn('Beat boundary cache lookup failed:', err);
    }

    // Fetch fresh from server
    try {
      const res  = await fetch('/static/data/beat_boundaries.geojson');
      const data = await res.json();
      if (data && data.features && data.features.length > 0) {
        SpatialCache.set(CACHE_KEY, { data, _ts: Date.now() });
        this.rawBeatData = data;
        this.renderBeatBoundariesGeoJSON(data);
      }
    } catch (e) {
      console.warn("Failed to load beat boundaries:", e);
    }
  },

  renderBeatBoundariesGeoJSON(geojsonData) {
    if (!this.layers.beatBoundaries) return;
    this.layers.beatBoundaries.clearLayers();
    if (this.layers.beatLabels) this.layers.beatLabels.clearLayers();
    if (!geojsonData || !geojsonData.features) return;

    // 1. Static Beat Boundary Polygons (no tooltip, no hover styling changes)
    const geoLayer = L.geoJSON(geojsonData, {
      pane: 'beatPane',
      interactive: false,
      style: () => ({
        color: '#0284c7',
        weight: 2.2,
        opacity: 0.90,
        fillColor: '#38bdf8',
        fillOpacity: 0.04,
        dashArray: '6, 5',
        interactive: false
      })
    });

    this.geoLayers.beatBoundaries = geoLayer;
    geoLayer.addTo(this.layers.beatBoundaries);

    // 2. Static Beat Name Labels (visible when zoom < 15, toggled with plot labels)

    // Compute geometric centroid of a polygon ring using the signed-area formula
    function ringCentroid(ring) {
      let area = 0, cx = 0, cy = 0;
      for (let j = 0, k = ring.length - 1; j < ring.length; k = j++) {
        const xj = ring[j][0], yj = ring[j][1];
        const xk = ring[k][0], yk = ring[k][1];
        const f = xj * yk - xk * yj;
        cx   += (xj + xk) * f;
        cy   += (yj + yk) * f;
        area += f;
      }
      area *= 0.5;
      const inv = 1 / (6 * area);
      return [cy * inv, cx * inv]; // [lat, lng]
    }

    function geometricCentroid(geometry) {
      if (!geometry) return null;
      let ring = null;
      if (geometry.type === 'Polygon' && geometry.coordinates && geometry.coordinates[0]) {
        ring = geometry.coordinates[0];
      } else if (geometry.type === 'MultiPolygon' && geometry.coordinates) {
        // Use the largest ring by vertex count
        for (const poly of geometry.coordinates) {
          if (poly[0] && (!ring || poly[0].length > ring.length)) ring = poly[0];
        }
      }
      if (!ring || ring.length < 3) return null;
      return ringCentroid(ring);
    }

    for (let i = 0; i < geojsonData.features.length; i++) {
      const feat = geojsonData.features[i];
      const p = feat.properties || {};

      // Prefer computed geometric centroid; fall back to stored center values
      let centroid = geometricCentroid(feat.geometry);
      const lat = centroid ? centroid[0] : p.center_lat;
      const lng = centroid ? centroid[1] : p.center_lng;

      let rawName = (p.raw_name || p.beat_name || 'Beat').trim();
      let displayName = rawName;
      if (!displayName.toLowerCase().endsWith('beat')) {
        displayName += ' Beat';
      }

      if (lat && lng && this.layers.beatLabels) {
        const beatIcon = L.divIcon({
          className: 'beat-map-marker-container',
          html: `<div class="beat-map-label">${displayName}</div>`,
          iconSize: [0, 0],
          iconAnchor: [0, 0]
        });

        L.marker([lat, lng], {
          icon: beatIcon,
          pane: 'labelPane',
          interactive: false
        }).addTo(this.layers.beatLabels);
      }
    }


    this.updateBeatLabelsVisibility();
  },

  updateBeatLabelsVisibility() {
    if (!this.layers.beatLabels) return;
    const zoom = this.map ? this.map.getZoom() : 13;
    // Beat label and plot label automatically toggled:
    // Plot labels appear at zoom >= 15.
    // Beat labels are visible when zoom < 15 and isBeatBoundariesVisible is true.
    const shouldShow = Boolean(this.isBeatBoundariesVisible && zoom < 15);
    if (shouldShow) {
      if (!this.map.hasLayer(this.layers.beatLabels)) {
        this.map.addLayer(this.layers.beatLabels);
      }
    } else {
      if (this.map.hasLayer(this.layers.beatLabels)) {
        this.map.removeLayer(this.layers.beatLabels);
      }
    }
  },

  toggleBeatBoundaries(visible) {
    this.isBeatBoundariesVisible = visible;
    if (visible) {
      if (!this.map.hasLayer(this.layers.beatBoundaries)) {
        this.map.addLayer(this.layers.beatBoundaries);
      }
    } else {
      if (this.map.hasLayer(this.layers.beatBoundaries)) {
        this.map.removeLayer(this.layers.beatBoundaries);
      }
    }
    this.updateBeatLabelsVisibility();
  },

  flyToBeat(beat) {
    if (!beat) return;
    const toggle = document.getElementById('toggleBeatBoundaries');
    if (toggle && !toggle.checked) {
      toggle.checked = true;
      this.toggleBeatBoundaries(true);
    }

    if (beat.bounds && beat.bounds.length === 4) {
      const [minx, miny, maxx, maxy] = beat.bounds;
      this.map.fitBounds([[miny, minx], [maxy, maxx]], { padding: [50, 50], maxZoom: 14 });
    } else if (beat.lat && beat.lng) {
      this.map.setView([beat.lat, beat.lng], 13, { animate: true });
    }
  },

  async loadEncroachments() {
    const CACHE_KEY = 'encroachments_v2';
    const CACHE_TTL = 86400 * 1000; // 24 hours

    try {
      const cached = await SpatialCache.get(CACHE_KEY);
      if (cached && cached._ts && (Date.now() - cached._ts) < CACHE_TTL && cached.data && cached.data.features) {
        this.rawEncroachData = cached.data;
        this.renderEncroachmentsGeoJSON(cached.data);
        return; // served from cache — no network fetch needed
      }
    } catch (e) {}

    try {
      const res = await fetch('/api/encroachments/geojson');
      const data = await res.json();
      if (data && data.features && data.features.length > 0) {
        SpatialCache.set(CACHE_KEY, { data, _ts: Date.now() });
        this.rawEncroachData = data;
        this.renderEncroachmentsGeoJSON(data);
      }
    } catch (e) {
      console.error("Failed to load encroachments:", e);
    }
  },

  renderEncroachmentsGeoJSON(geojsonData) {
    this.layers.encroachments.clearLayers();
    if (!geojsonData || !geojsonData.features) return;
    this.indexPlotBBoxes(geojsonData.features);

    const geoLayer = L.geoJSON(geojsonData, {
      pane: 'encroachPane',
      renderer: this.encroachRenderer,
      interactive: true,
      style: () => ({
        color: '#ef4444',
        weight: 2.5,
        opacity: 0.95,
        fillColor: '#ef4444',
        fillOpacity: 0.28,
        dashArray: '5, 4'
      }),
      onEachFeature: (feature, layer) => {
        layer.on('mouseover', () => {
          this.map.getContainer().style.cursor = 'pointer';
        });

        layer.on('mouseout', () => {
          this.map.getContainer().style.cursor = '';
        });

        layer.on('click', (e) => {
          if (e) {
            if (e.originalEvent) {
              e.originalEvent._stopped = true;
              if (e.originalEvent.stopPropagation) e.originalEvent.stopPropagation();
            }
            if (L.DomEvent && L.DomEvent.stopPropagation) {
              L.DomEvent.stopPropagation(e);
            }
          }
          this._plotClicked = true;
          setTimeout(() => {
            this._plotClicked = false;
          }, 60);

          // Resolve corresponding CS parcel feature to highlight the exact plot boundary
          let csFeature = null;
          const p = feature.properties || {};
          const allFeatures = this.currentCSFeatures || (this.rawCSData && this.rawCSData.features) || [];
          if (p.uid) {
            csFeature = allFeatures.find(f => f.properties && String(f.properties.uid) === String(p.uid));
          }
          if (!csFeature && p.id) {
            csFeature = allFeatures.find(f => f.id == p.id || (f.properties && f.properties.id == p.id));
          }
          if (!csFeature && p.plot_no) {
            csFeature = allFeatures.find(f => f.properties && String(f.properties.plot_no) === String(p.plot_no));
          }

          this.selectPlot('cs_plot', csFeature || feature);
        });
      }
    });

    this.geoLayers.encroachments = geoLayer;
    geoLayer.addTo(this.layers.encroachments);
  },

  toggleEncroachments(visible) {
    this.isEncroachmentsVisible = visible;
    if (visible) {
      if (!this.map.hasLayer(this.layers.encroachments)) {
        this.map.addLayer(this.layers.encroachments);
      }
    } else {
      if (this.map.hasLayer(this.layers.encroachments)) {
        this.map.removeLayer(this.layers.encroachments);
      }
    }
    this.updateActiveLayerCount();
  },

  focusEncroachments() {
    const toggle = document.getElementById('toggleEncroachments');
    if (toggle && !toggle.checked) {
      toggle.checked = true;
      this.toggleEncroachments(true);
    }

    if (this.rawEncroachData && this.rawEncroachData.bounds) {
      const [minx, miny, maxx, maxy] = this.rawEncroachData.bounds;
      this.map.fitBounds([[miny, minx], [maxy, maxx]], { padding: [50, 50], maxZoom: 16 });
    } else if (this.layers.encroachments) {
      const b = this.layers.encroachments.getBounds();
      if (b.isValid()) {
        this.map.fitBounds(b, { padding: [50, 50], maxZoom: 16 });
      }
    }
  },

  updateLabels() {
    if (!this.labelLayer) return;
    const labels = [];

    const showAll = this.isAllPlotsVisible;
    const showForest = this.isForestPlotsVisible;

    if ((showAll || showForest) && this.currentCSFeatures) {
      for (let i = 0; i < this.currentCSFeatures.length; i++) {
        const feat = this.currentCSFeatures[i];
        const p = feat.properties;
        if (!p || !p.plot_no || !p.label_lat || !p.label_lng) continue;

        const isForest = Boolean(p.beat_name && p.beat_name.trim());
        // If only forest plots are visible, skip non-forest plot labels
        if (!showAll && showForest && !isForest) {
          continue;
        }

        labels.push({ 
          latlng: [p.label_lat, p.label_lng], 
          radius: p.label_radius || 0,
          text: String(p.plot_no)
        });
      }
    }

    this.labelLayer.setLabels(labels);
  },

  updateActiveLayerCount() {
    const badge = document.getElementById('layerCountBadge');
    if (!badge) return;
    let count = 0;
    if (this.isAllPlotsVisible) count++;
    if (this.isForestPlotsVisible) count++;
    if (this.isEncroachmentsVisible) count++;
    badge.textContent = `${count} Active`;
  },

  setHoverPlot(feature, isEncroach = false) {
    if (!feature || !this.layers.hover) return;

    const p = feature.properties || {};
    const featureId = p.id != null ? p.id : (p.uid != null ? p.uid : (p.encroach_id != null ? p.encroach_id : (feature._bbox ? feature._bbox.join(',') : null)));

    // If already hovering the exact same feature, avoid redundant redraws
    if (this._currentHoveredId === featureId) return;
    this._currentHoveredId = featureId;

    this.layers.hover.clearLayers();

    // If this feature is already actively selected in the dossier, don't double highlight
    if (this._selectedUid && p.uid && String(this._selectedUid) === String(p.uid)) {
      return;
    }
    if (this._selectedPlotId && p.id && String(this._selectedPlotId) === String(p.id)) {
      return;
    }

    // Determine style based on whether it's encroachment, forest plot, or general CS plot
    let style = null;
    if (isEncroach || p.encroach_id || p.encroached_area_acre) {
      style = {
        color: '#f87171',
        weight: 2.5,
        opacity: 0.95,
        fillColor: '#ef4444',
        fillOpacity: 0.25
      };
    } else if (p.beat_name && p.beat_name.trim()) {
      // Forest plot: luminous mint outline with delicate translucent wash
      style = {
        color: '#34d399',
        weight: 2.2,
        opacity: 0.95,
        fillColor: '#10b981',
        fillOpacity: 0.22
      };
    } else {
      // Standard CS plot: slight sky-blue highlight
      style = {
        color: '#38bdf8',
        weight: 2.0,
        opacity: 0.95,
        fillColor: '#38bdf8',
        fillOpacity: 0.16
      };
    }

    // Support multi-part parcel highlighting (all parts of the same UID light up in unison)
    const targetUid = p.uid;
    let featuresToHighlight = [feature];
    if (targetUid && this.plotsByUid && this.plotsByUid.has(String(targetUid))) {
      featuresToHighlight = this.plotsByUid.get(String(targetUid));
    }

    L.geoJSON(featuresToHighlight, {
      pane: 'hoverPane',
      style: style,
      interactive: false
    }).addTo(this.layers.hover);
  },

  clearHoverPlot() {
    this._currentHoveredId = null;
    if (this.layers.hover) {
      this.layers.hover.clearLayers();
    }
  },

  highlightPlot(feature) {
    if (!this.layers.highlight) return;
    this.layers.highlight.clearLayers();

    if (!feature) {
      this._selectedUid = null;
      this._selectedPlotId = null;
      return;
    }

    const p = feature.properties || {};
    this._selectedUid = p.uid ? String(p.uid) : null;
    this._selectedPlotId = p.id ? String(p.id) : null;
    this.clearHoverPlot();

    // Find and highlight all plots with the same UID
    const targetUid = p.uid;
    let featuresToHighlight = [feature];

    if (targetUid) {
      if (this.plotsByUid && this.plotsByUid.has(String(targetUid))) {
        featuresToHighlight = this.plotsByUid.get(String(targetUid));
      } else {
        const allFeatures = this.currentCSFeatures || (this.rawCSData && this.rawCSData.features) || [];
        const matches = allFeatures.filter(f => f.properties && String(f.properties.uid) === String(targetUid));
        if (matches.length > 0) {
          featuresToHighlight = matches;
        }
      }
    }

    L.geoJSON(featuresToHighlight, {
      pane: 'highlightPane',
      style: {
        color: '#00f0ff',
        weight: 3.5,
        opacity: 1.0,
        fillColor: '#00f0ff',
        fillOpacity: 0.25
      },
      interactive: false
    }).addTo(this.layers.highlight);
  },

  clearHighlight() {
    this._selectedUid = null;
    this._selectedPlotId = null;
    this.clearHoverPlot();
    if (this.layers.highlight) {
      this.layers.highlight.clearLayers();
    }
  },

  applyFilter(criteria) {
    if (!criteria) return { count: 0, matches: [] };
    const { beat, mouza, plotNo } = criteria;

    const allFeatures = this.currentCSFeatures || (this.rawCSData && this.rawCSData.features) || [];
    if (!allFeatures.length) {
      return { count: 0, matches: [] };
    }

    const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const cleanPlot = (s) => String(s || '').trim().toLowerCase().replace(/^#/, '');

    const targetBeat = beat ? norm(beat).replace(/\s*beat$/i, '') : '';
    const targetMouza = mouza ? norm(mouza) : '';
    const targetPlot = plotNo ? cleanPlot(plotNo) : '';

    const matches = allFeatures.filter(f => {
      const p = f.properties || {};
      if (targetBeat) {
        const pBeat = norm(p.beat_name || '').replace(/\s*beat$/i, '');
        if (pBeat !== targetBeat) return false;
      }
      if (targetMouza) {
        const pMouza = norm(p.mouza || '');
        if (pMouza !== targetMouza) return false;
      }
      if (targetPlot) {
        const pPlot = cleanPlot(p.plot_no);
        if (pPlot !== targetPlot) return false;
      }
      return true;
    });

    if (this.layers.filterHighlight) {
      this.layers.filterHighlight.clearLayers();
    }
    this.clearHighlight();

    if (matches.length === 0) {
      // If no individual plot matched but a Beat was selected, check if we can zoom to the Beat Boundary
      if (targetBeat && this.rawBeatData && this.rawBeatData.features) {
        const beatFeat = this.rawBeatData.features.find(f => {
          const bName = norm((f.properties && f.properties.beat_name) || '').replace(/\s*beat$/i, '');
          const rName = norm((f.properties && f.properties.raw_name) || '').replace(/\s*beat$/i, '');
          return bName === targetBeat || rName === targetBeat;
        });
        if (beatFeat) {
          this.flyToBeat(beatFeat.properties);
          return { count: 0, matches: [], beatOnly: true, beatName: beatFeat.properties.beat_name };
        }
      }
      return { count: 0, matches: [] };
    }

    // 1 parcel matched: select plot directly and open Dossier
    if (matches.length === 1) {
      this.selectPlot('cs_plot', matches[0]);
      const bounds = this.getFeatureBounds(matches[0]);
      if (bounds && bounds.length === 4) {
        this.map.fitBounds([[bounds[1], bounds[0]], [bounds[3], bounds[2]]], { maxZoom: 18, padding: [60, 60] });
      } else {
        const c = this.getFeatureCenter(matches[0]);
        if (c) this.map.setView(c, 18, { animate: true });
      }
    } else {
      // Multiple parcels matched: render bright highlight layer and fit bounds
      L.geoJSON(matches, {
        pane: 'highlightPane',
        style: () => ({
          color: '#00f0ff',
          weight: 2.8,
          opacity: 1.0,
          fillColor: '#00f0ff',
          fillOpacity: 0.28
        }),
        interactive: false
      }).addTo(this.layers.filterHighlight);

      const group = L.geoJSON(matches);
      const b = group.getBounds();
      if (b.isValid()) {
        this.map.fitBounds(b, { padding: [40, 40], maxZoom: 16 });
      }
    }

    return { count: matches.length, matches };
  },

  clearFilter() {
    if (this.layers.filterHighlight) {
      this.layers.filterHighlight.clearLayers();
    }
    this.clearHighlight();
  },

  getFeatureCenter(feature) {
    if (!feature) return null;
    const p = feature.properties;
    if (p && p.label_lat && p.label_lng) {
      return L.latLng(p.label_lat, p.label_lng);
    }
    try {
      const layer = L.geoJSON(feature);
      const bounds = layer.getBounds();
      if (bounds.isValid()) {
        return bounds.getCenter();
      }
    } catch (e) {
      console.error("Failed to get center:", e);
    }
    return null;
  },

  getFeatureBounds(feature) {
    if (!feature) return [];
    try {
      const layer = L.geoJSON(feature);
      const b = layer.getBounds();
      if (b.isValid()) {
        return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
      }
    } catch (e) {}
    return [];
  },

  /**
   * Instantly highlights plot and displays Dossier drawer with 0ms delay
   */
  selectPlot(type, feature) {
    if (!feature) return;
    const p = feature.properties || {};
    const targetUid = p.uid;

    // 1. Highlight all plot polygons with the same UID
    this.highlightPlot(feature);

    // 2. Open side bar immediately from in-memory properties
    if (typeof Dossier !== 'undefined') {
      const allFeatures = this.currentCSFeatures || (this.rawCSData && this.rawCSData.features) || [];
      const matchingFeatures = targetUid
        ? allFeatures.filter(f => f.properties && String(f.properties.uid) === String(targetUid))
        : [feature];

      // Sum area across all matching polygons if multi-part parcel
      let initialArea = p.area_acre;
      if (matchingFeatures.length > 1) {
        initialArea = matchingFeatures.reduce((acc, f) => acc + ((f.properties && f.properties.area_acre) || 0), 0);
      }

      const bounds = this.getFeatureBounds(feature);
      const plotId = p.id;
      const uid    = p.uid ? String(p.uid) : null;

      // 3. Assemble full dossier — three-tier priority:
      //    a) _bulkDossierMap (in-memory from IndexedDB bulk cache) → instant, zero network
      //    b) _dossierCache   (per-plot LRU, populated by hover-prefetch) → instant
      //    c) individual API  (fallback for very first visit before bulk loads)

      const plotBase = {
        id: p.id, uid: p.uid, plot_no: p.plot_no,
        mouza: p.mouza || 'N/A', jl_no: p.jl_no || 'N/A',
        area_acre: initialArea, beat_name: p.beat_name,
        type: 'CS Cadastral Survey'
      };

      // Priority A — bulk map (instant 0ms in-memory lookup)
      if (_bulkDossierMap) {
        if (uid && _bulkDossierMap[uid]) {
          const bulk = _bulkDossierMap[uid];
          Dossier.renderCSPlot({
            plot: plotBase, bounds,
            parcel_info: { cs_uid: uid, ...bulk },
            encroachment: bulk.encroachment || { has_encroachment: false, count: 0, total_encroached_acre: 0, records: [] }
          });
          return;
        } else {
          // Bulk dossier is fully loaded and includes 100% of all registered parcel_info records.
          // Since this plot is not in the register, render immediately as non-registered parcel with 0ms latency.
          Dossier.renderCSPlot({
            plot: plotBase, bounds,
            parcel_info: {
              has_record: false,
              cs_uid: uid,
              cs_plot_no: p.plot_no,
              mouza: p.mouza || 'N/A',
              cs_jl: p.jl_no || 'N/A',
              beat_name: p.beat_name || null,
              range: null,
              total_area: initialArea,
              total_area_fd: null,
              total_area_others: null,
              linked_rs_plots: []
            },
            encroachment: { has_encroachment: false, count: 0, total_encroached_acre: 0, records: [] }
          });
          return;
        }
      }

      // Optimistic render while fetching (only during initial startup before bulk map is ready)
      Dossier.renderCSPlot({ plot: plotBase, bounds, loadingParcelInfo: true });

      if (plotId) {
        // Priority B — per-plot LRU cache (hover prefetch may have filled this)
        const cached = _dossierCacheGet(plotId);
        if (cached) {
          if (typeof Dossier !== 'undefined' && Dossier.currentPlotId === plotId) {
            Dossier.renderCSPlot(cached);
          }
        } else {
          // Priority C — individual API fetch (only on very first visit before bulk loads)
          fetch(`/api/plots/cs/${plotId}`)
            .then(r => r.json())
            .then(data => {
              if (data && data.plot) {
                _dossierCacheSet(plotId, data);
                if (typeof Dossier !== 'undefined' && Dossier.currentPlotId === plotId) {
                  Dossier.renderCSPlot(data);
                }
              }
            })
            .catch(console.warn);
        }
      }
    }
  },

  /**
   * Selects a plot by ID or search result, zooms into parcel level, and opens dossier
   */
  selectPlotById(type, id, fallbackLatLng = null, fallbackBounds = null) {
    let feature = null;
    if (this.rawCSData && this.rawCSData.features) {
      feature = this.rawCSData.features.find(f => f.id == id || (f.properties && f.properties.id == id));
    }

    if (feature) {
      const targetUid = feature.properties && feature.properties.uid;
      const allFeatures = this.currentCSFeatures || (this.rawCSData && this.rawCSData.features) || [];
      const matchingFeatures = targetUid
        ? allFeatures.filter(f => f.properties && String(f.properties.uid) === String(targetUid))
        : [feature];

      if (matchingFeatures.length > 1) {
        const group = L.geoJSON(matchingFeatures);
        const b = group.getBounds();
        if (b.isValid()) {
          this.map.fitBounds(b, { maxZoom: 18, padding: [60, 60] });
        }
      } else {
        const center = fallbackLatLng || this.getFeatureCenter(feature);
        const bounds = this.getFeatureBounds(feature);

        if (bounds && bounds.length === 4) {
          this.map.fitBounds([[bounds[1], bounds[0]], [bounds[3], bounds[2]]], { maxZoom: 18, padding: [60, 60] });
        } else if (center) {
          this.map.setView(center, 18, { animate: true });
        }
      }

      this.selectPlot(type, feature);
      return feature;
    } else if (fallbackLatLng) {
      if (fallbackBounds && fallbackBounds.length === 4) {
        this.map.fitBounds([[fallbackBounds[1], fallbackBounds[0]], [fallbackBounds[3], fallbackBounds[2]]], { maxZoom: 18, padding: [60, 60] });
      } else {
        this.map.setView(fallbackLatLng, 18, { animate: true });
      }

      // Fetch specific feature from API
      fetch(`/api/plots/cs/${id}`)
        .then(r => r.json())
        .then(data => {
          if (data && data.plot && typeof Dossier !== 'undefined') {
            Dossier.renderCSPlot(data);
          }
        })
        .catch(console.warn);
    }
    return null;
  }
};
