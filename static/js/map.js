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
      if (!this._rafId) {
        this._rafId = requestAnimationFrame(() => {
          this._rafId = null;
          this._update();
        });
      }
    };

    map.on('move', this._onMove, this);
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
    const ctx = this._canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);

    const zoom = this._map.getZoom();
    if (zoom < 15 || this._labels.length === 0) return;

    const bounds = this._map.getBounds();
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
      if (bounds.contains(item.latlng)) {
        const pt = this._map.latLngToLayerPoint(item.latlng);
        const x = pt.x - origin.x;
        const y = pt.y - origin.y;

        let itemFontSize = defaultFontSize;
        if (item.radius && item.radius > 0) {
          const edgePt = this._map.latLngToLayerPoint([item.latlng[0], item.latlng[1] + item.radius]);
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
  dbName: 'fd_lms_spatial_v7',
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

const MapEngine = {
  map: null,
  currentBasemap: 'satellite',
  basemapLayers: {},
  canvasRenderer: null,
  layers: {
    csPlots: null,
    highlight: null
  },
  geoLayers: {
    cs: null
  },
  labelLayer: null,
  rawCSData: null,
  currentCSFeatures: [],
  isCSPlotsVisible: true,
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
      fadeAnimation: false,
      zoomAnimation: true,
      preferCanvas: true
    });

    L.control.zoom({ position: 'bottomright' }).addTo(this.map);
    L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(this.map);

    this.map.createPane('csPane');
    this.map.getPane('csPane').style.zIndex = 430;

    // Set canvasRenderer pane explicitly to csPane with generous click tolerance
    this.canvasRenderer = L.canvas({ padding: 0.5, tolerance: 10, pane: 'csPane' });

    this.map.createPane('highlightPane');
    this.map.getPane('highlightPane').style.zIndex = 480;
    this.map.getPane('highlightPane').style.pointerEvents = 'none';

    this.map.createPane('labelPane');
    this.map.getPane('labelPane').style.zIndex = 500;
    this.map.getPane('labelPane').style.pointerEvents = 'none';

    this.initBasemaps();

    this.layers.csPlots = L.featureGroup([], { pane: 'csPane' }).addTo(this.map);
    this.layers.highlight = L.featureGroup([], { pane: 'highlightPane' }).addTo(this.map);

    this.labelLayer = new PlotLabelLayer();
    this.map.addLayer(this.labelLayer);

    // Map click only clears highlight if an actual empty space was clicked
    this.map.on('click', () => {
      if (this._plotClicked) {
        return;
      }
      this.clearHighlight();
      if (typeof Dossier !== 'undefined') Dossier.close();
    });

    await this.loadCSPlots();
  },

  initBasemaps() {
    const tileOptions = {
      maxZoom: 22,
      maxNativeZoom: 19,
      crossOrigin: true,
      keepBuffer: 8,
      updateWhenIdle: false,
      updateWhenZooming: true
    };

    this.basemapLayers = {
      satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', tileOptions),
      hybrid: L.layerGroup([
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', tileOptions),
        L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { ...tileOptions, opacity: 0.85 })
      ]),
      osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { ...tileOptions, maxNativeZoom: 19 }),
      dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { ...tileOptions, maxNativeZoom: 19 })
    };

    this.basemapLayers[this.currentBasemap].addTo(this.map);
  },

  setBasemap(name) {
    if (!this.basemapLayers[name] || this.currentBasemap === name) return;
    this.map.removeLayer(this.basemapLayers[this.currentBasemap]);
    this.basemapLayers[name].addTo(this.map);
    this.currentBasemap = name;
  },

  async loadCSPlots() {
    const badge = document.getElementById('mapZoomStatus');
    let loadedFromCache = false;

    try {
      const cachedCS = await SpatialCache.get('cs_plots');
      if (cachedCS && cachedCS.features && cachedCS.features.length > 0) {
        this.rawCSData = cachedCS;
        this.renderCSPlotsGeoJSON(this.rawCSData);
        loadedFromCache = true;
        if (badge) {
          badge.innerHTML = `<i class="fa-solid fa-bolt text-success"></i> Instant Cache &bull; CS Plots: ${this.rawCSData.count.toLocaleString()} parcels loaded`;
        }
      }
    } catch (err) {
      console.warn('Cache lookup skipped:', err);
    }

    if (!loadedFromCache && badge) {
      badge.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Fast loading CS Plot Boundaries...`;
    }

    try {
      const res = await fetch('/api/plots/cs?limit=35000');
      const csData = await res.json();

      if (csData && csData.features && csData.features.length > 0) {
        SpatialCache.set('cs_plots', csData);
        this.rawCSData = csData;
        this.renderCSPlotsGeoJSON(this.rawCSData);

        if (badge) {
          badge.innerHTML = `<i class="fa-solid fa-circle-check text-success"></i> Plot Boundary (CS): ${csData.count.toLocaleString()} parcels loaded`;
        }

        if (csData.bounds) {
          const [minx, miny, maxx, maxy] = csData.bounds;
          this.map.fitBounds([[miny, minx], [maxy, maxx]], { padding: [30, 30] });
        }
      } else if (!loadedFromCache && badge) {
        badge.innerHTML = `<i class="fa-solid fa-circle-info text-warning"></i> 0 CS Parcels found`;
      }
    } catch (e) {
      if (!loadedFromCache) {
        console.error("Failed to load CS plots:", e);
        if (badge) {
          badge.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-danger"></i> Failed to load CS plots`;
        }
      }
    }
  },

  renderCSPlotsGeoJSON(geojsonData) {
    this.layers.csPlots.clearLayers();
    this.currentCSFeatures = (geojsonData && geojsonData.features) ? geojsonData.features : [];
    this.updateLabels();

    const geoLayer = L.geoJSON(geojsonData, {
      renderer: this.canvasRenderer,
      style: () => ({
        color: '#059669',
        weight: 1.5,
        opacity: 0.90,
        fillColor: '#059669',
        fillOpacity: 0.12
      }),
      onEachFeature: (feature, layer) => {
        layer.on('mouseover', () => {
          this.map.getContainer().style.cursor = 'pointer';
        });

        layer.on('mouseout', () => {
          this.map.getContainer().style.cursor = '';
        });

        layer.on('click', () => {
          this._plotClicked = true;
          setTimeout(() => {
            this._plotClicked = false;
          }, 150);
          this.selectPlot('cs_plot', feature);
        });
      }
    });

    this.geoLayers.cs = geoLayer;
    geoLayer.addTo(this.layers.csPlots);
  },

  toggleCSPlots(visible) {
    this.isCSPlotsVisible = visible;
    if (visible) this.map.addLayer(this.layers.csPlots);
    else this.map.removeLayer(this.layers.csPlots);
    this.updateLabels();
  },

  updateLabels() {
    if (!this.labelLayer) return;
    const labels = [];

    if (this.isCSPlotsVisible && this.currentCSFeatures) {
      for (let i = 0; i < this.currentCSFeatures.length; i++) {
        const p = this.currentCSFeatures[i].properties;
        if (p && p.plot_no && p.label_lat && p.label_lng) {
          labels.push({ 
            latlng: [p.label_lat, p.label_lng], 
            radius: p.label_radius || 0,
            text: String(p.plot_no)
          });
        }
      }
    }

    this.labelLayer.setLabels(labels);
  },

  highlightPlot(feature) {
    if (!this.layers.highlight) return;
    this.layers.highlight.clearLayers();

    if (!feature) return;

    L.geoJSON(feature, {
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
    if (this.layers.highlight) {
      this.layers.highlight.clearLayers();
    }
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

    // 1. Highlight plot polygon
    this.highlightPlot(feature);

    // 2. Open side bar immediately from in-memory properties
    if (typeof Dossier !== 'undefined') {
      const bounds = this.getFeatureBounds(feature);
      const plotId = p.id;
      Dossier.renderCSPlot({
        plot: {
          id: p.id,
          plot_no: p.plot_no,
          mouza: p.mouza || 'N/A',
          jl_no: p.jl_no || 'N/A',
          area_acre: p.area_acre,
          beat_name: p.beat_name,
          type: 'CS Cadastral Survey'
        },
        bounds: bounds,
        loadingParcelInfo: true
      });

      // 3. Asynchronously hydrate with full Forest Department status and reconciliation data
      if (plotId) {
        fetch(`/api/plots/cs/${plotId}`)
          .then(r => r.json())
          .then(data => {
            if (data && data.plot && typeof Dossier !== 'undefined' && Dossier.currentPlotId === plotId) {
              Dossier.renderCSPlot(data);
            }
          })
          .catch(console.warn);
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
      const center = fallbackLatLng || this.getFeatureCenter(feature);
      const bounds = this.getFeatureBounds(feature);

      if (bounds && bounds.length === 4) {
        this.map.fitBounds([[bounds[1], bounds[0]], [bounds[3], bounds[2]]], { maxZoom: 18, padding: [60, 60] });
      } else if (center) {
        this.map.setView(center, 18, { animate: true });
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
