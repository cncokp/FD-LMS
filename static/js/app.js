/**
 * FD-LMS: Main WebGIS Application Coordinator
 * Handles:
 * - Map initialization
 * - CS Plot boundary toggles
 * - Basemap selection
 * - Search autocomplete by Plot # or UID
 * - CSV Export
 */

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Initialize Map
  await MapEngine.init();

  // 2. Setup UI controls
  setupHorizontalWidget();
  setupBasemapSwitcher();
  setupLayerToggles();
  setupSearchAutocomplete();
  setupExportCSV();
});

function setupHorizontalWidget() {
  const tabBtnLayers = document.getElementById('tabBtnLayers');
  const dropdownPanel = document.getElementById('dropdownPanel');
  const btnCloseDropdownPanel = document.getElementById('btnCloseDropdownPanel');
  const btnCloseDossier = document.getElementById('btnCloseDossier');

  window.openLayersPanel = function() {
    if (dropdownPanel) dropdownPanel.classList.remove('collapsed');
    if (tabBtnLayers) tabBtnLayers.classList.add('active');
    // Collapse search when opening layers
    if (window.closeSearchWidget) window.closeSearchWidget();
  };

  window.closeLayersPanel = function() {
    if (dropdownPanel) dropdownPanel.classList.add('collapsed');
    if (tabBtnLayers) tabBtnLayers.classList.remove('active');
  };

  window.isLayersPanelOpen = function() {
    return dropdownPanel && !dropdownPanel.classList.contains('collapsed');
  };

  if (tabBtnLayers) {
    tabBtnLayers.addEventListener('click', () => {
      if (window.isLayersPanelOpen()) {
        window.closeLayersPanel();
      } else {
        window.openLayersPanel();
      }
    });
  }

  if (btnCloseDropdownPanel) {
    btnCloseDropdownPanel.addEventListener('click', () => {
      window.closeLayersPanel();
    });
  }

  if (btnCloseDossier) {
    btnCloseDossier.addEventListener('click', () => {
      if (typeof Dossier !== 'undefined') Dossier.close();
      MapEngine.clearHighlight();
    });
  }
}

function setupBasemapSwitcher() {
  const toggleBtn = document.getElementById('btnBasemapToggle');
  const popup = document.getElementById('basemapPickerPopup');
  const items = document.querySelectorAll('.basemap-picker-item');
  const btnZoomIn = document.getElementById('btnZoomIn');
  const btnZoomOut = document.getElementById('btnZoomOut');

  if (toggleBtn && popup) {
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = popup.classList.contains('hidden');
      if (isHidden) {
        popup.classList.remove('hidden');
        popup.style.display = 'flex';
        toggleBtn.classList.add('active');
      } else {
        popup.classList.add('hidden');
        popup.style.display = 'none';
        toggleBtn.classList.remove('active');
      }
    });

    document.addEventListener('click', (e) => {
      if (!popup.contains(e.target) && e.target !== toggleBtn && !toggleBtn.contains(e.target)) {
        popup.classList.add('hidden');
        popup.style.display = 'none';
        toggleBtn.classList.remove('active');
      }
    });
  }

  items.forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      items.forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      const basemap = item.dataset.basemap;
      MapEngine.setBasemap(basemap);
      if (popup) {
        popup.classList.add('hidden');
        popup.style.display = 'none';
      }
      if (toggleBtn) {
        toggleBtn.classList.remove('active');
      }
    });
  });

  if (btnZoomIn) {
    btnZoomIn.addEventListener('click', () => {
      if (MapEngine.map) MapEngine.map.zoomIn();
    });
  }

  if (btnZoomOut) {
    btnZoomOut.addEventListener('click', () => {
      if (MapEngine.map) MapEngine.map.zoomOut();
    });
  }
}

function setupLayerToggles() {
  const toggleAllPlots = document.getElementById('toggleAllPlots');
  if (toggleAllPlots) {
    toggleAllPlots.addEventListener('change', (e) => {
      MapEngine.toggleAllPlots(e.target.checked);
    });
  }

  const toggleForestPlots = document.getElementById('toggleForestPlots');
  if (toggleForestPlots) {
    toggleForestPlots.addEventListener('change', (e) => {
      MapEngine.toggleForestPlots(e.target.checked);
    });
  }

  const toggleBeatBoundaries = document.getElementById('toggleBeatBoundaries');
  if (toggleBeatBoundaries) {
    toggleBeatBoundaries.addEventListener('change', (e) => {
      MapEngine.toggleBeatBoundaries(e.target.checked);
    });
  }

  const toggleCSPlots = document.getElementById('toggleCSPlots');
  if (toggleCSPlots) {
    toggleCSPlots.addEventListener('change', (e) => {
      MapEngine.toggleCSPlots(e.target.checked);
    });
  }

  const toggleEncroachments = document.getElementById('toggleEncroachments');
  if (toggleEncroachments) {
    toggleEncroachments.addEventListener('change', (e) => {
      MapEngine.toggleEncroachments(e.target.checked);
    });
  }

  const btnQuickEncroach = document.getElementById('btnQuickEncroach');
  if (btnQuickEncroach) {
    btnQuickEncroach.addEventListener('click', () => {
      MapEngine.focusEncroachments();
    });
  }
}

function setupSearchAutocomplete() {
  const container = document.getElementById('expandableSearchContainer');
  const toggleBtn = document.getElementById('btnToggleSearch');
  const input = document.getElementById('searchInput');
  const dropdown = document.getElementById('searchResults');
  const btnClear = document.getElementById('btnClearSearch');
  if (!input || !dropdown) return;

  let searchTimeout = null;

  function collapseSearch() {
    dropdown.classList.add('hidden');
    dropdown.style.display = 'none';
    dropdown.innerHTML = '';
  }

  function expandSearch() {
    if (container) container.classList.add('expanded');
    if (toggleBtn) toggleBtn.classList.add('active');
    // Collapse Layers panel when search expands
    if (window.closeLayersPanel) window.closeLayersPanel();
    setTimeout(() => input.focus(), 50);
  }

  function closeSearch() {
    if (container) container.classList.remove('expanded');
    if (toggleBtn) toggleBtn.classList.remove('active');
    collapseSearch();
  }

  window.closeSearchWidget = function() {
    closeSearch();
  };

  if (toggleBtn) {
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isExpanded = container && container.classList.contains('expanded');
      if (isExpanded) {
        closeSearch();
        // If closing search and layers panel is closed, restore layers panel
        if (window.openLayersPanel && !window.isLayersPanelOpen()) {
          window.openLayersPanel();
        }
      } else {
        expandSearch();
      }
    });
  }

  if (btnClear) {
    btnClear.addEventListener('click', (e) => {
      e.stopPropagation();
      input.value = '';
      btnClear.classList.add('hidden');
      collapseSearch();
      input.focus();
    });
  }

  input.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const q = input.value.trim();

    if (btnClear) {
      if (q.length > 0) {
        btnClear.classList.remove('hidden');
      } else {
        btnClear.classList.add('hidden');
      }
    }

    if (q.length === 0) {
      collapseSearch();
      return;
    }

    searchTimeout = setTimeout(async () => {
      try {
        const qLower = q.toLowerCase();

        // 1. In-memory Beat Boundary search
        const beatMatches = [];
        if (MapEngine.rawBeatData && MapEngine.rawBeatData.features) {
          for (const feat of MapEngine.rawBeatData.features) {
            const p = feat.properties || {};
            const bName = (p.beat_name || '').toLowerCase();
            const rName = (p.raw_name || '').toLowerCase();
            if (bName.includes(qLower) || rName.includes(qLower) || (qLower.includes('beat') && (bName || rName))) {
              beatMatches.push({
                type: 'beat',
                id: p.id,
                label: p.beat_name,
                sublabel: `${p.area_acre ? Number(p.area_acre).toLocaleString() + ' Acres' : 'Forest Beat'} • Administrative Boundary`,
                lat: p.center_lat,
                lng: p.center_lng,
                bounds: p.bounds
              });
            }
          }
        }

        // 2. Server Plot & Mouza search
        let serverResults = [];
        try {
          const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
          if (res.ok) {
            serverResults = await res.json();
          }
        } catch (fetchErr) {
          console.warn("Search fetch error:", fetchErr);
        }

        const combined = [...beatMatches, ...serverResults];

        if (combined.length === 0) {
          dropdown.innerHTML = `<div class="search-item" style="color: var(--text-dim); font-size: 11.5px; padding: 10px 12px; pointer-events: none;"><i class="fa-solid fa-circle-exclamation" style="margin-right: 6px;"></i>No matching plot, mouza, or beat found</div>`;
          dropdown.classList.remove('hidden');
          dropdown.style.display = 'flex';
          return;
        }

        dropdown.innerHTML = combined.map((item, idx) => {
          const boundsAttr = JSON.stringify(item.bounds || []);
          let badgeClass = 'badge-plot';
          let badgeText = 'PLOT';
          let iconClass = 'fa-solid fa-scroll';
          let iconColor = '#34d399';

          if (item.type === 'beat') {
            badgeClass = 'badge-beat';
            badgeText = 'BEAT';
            iconClass = 'fa-solid fa-tree-city';
            iconColor = '#38bdf8';
          } else if (item.type === 'mouza') {
            badgeClass = 'badge-mouza';
            badgeText = 'MOUZA';
            iconClass = 'fa-solid fa-map-location-dot';
            iconColor = '#c084fc';
          }

          return `
            <div class="search-item ${idx === 0 ? 'selected' : ''}" data-index="${idx}" data-type="${item.type}" data-id="${item.id || ''}" data-lat="${item.lat}" data-lng="${item.lng}" data-bounds='${boundsAttr}'>
              <div class="search-item-header">
                <div class="search-item-label">
                  <i class="${iconClass}" style="color: ${iconColor};"></i>
                  <span>${item.label}</span>
                </div>
                <span class="search-badge ${badgeClass}">${badgeText}</span>
              </div>
              <div class="search-item-sublabel">${item.sublabel}</div>
            </div>
          `;
        }).join('');

        dropdown.classList.remove('hidden');
        dropdown.style.display = 'flex';

        dropdown.querySelectorAll('.search-item').forEach(el => {
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = el.dataset.id;
            const type = el.dataset.type;
            const lat = parseFloat(el.dataset.lat);
            const lng = parseFloat(el.dataset.lng);
            let bounds = null;
            try {
              bounds = JSON.parse(el.dataset.bounds || 'null');
            } catch (err) {}

            collapseSearch();
            input.value = '';
            if (btnClear) btnClear.classList.add('hidden');
            input.blur();

            if (type === 'beat') {
              MapEngine.flyToBeat({ id, lat, lng, bounds });
            } else if (id && type === 'cs_plot') {
              MapEngine.selectPlotById('cs_plot', id, (lat && lng) ? [lat, lng] : null, bounds);
            } else if (lat && lng) {
              MapEngine.map.panTo([lat, lng], { animate: true });
            }
          });

          el.addEventListener('mouseenter', () => {
            dropdown.querySelectorAll('.search-item').forEach(it => it.classList.remove('selected'));
            el.classList.add('selected');
          });
        });

      } catch (err) {
        console.error("Search error:", err);
      }
    }, 150);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      collapseSearch();
      if (!input.value) {
        closeSearch();
      }
      input.blur();
      return;
    }

    const items = Array.from(dropdown.querySelectorAll('.search-item'));
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      let curr = items.findIndex(el => el.classList.contains('selected'));
      if (curr >= 0) items[curr].classList.remove('selected');
      curr = (curr + 1) % items.length;
      items[curr].classList.add('selected');
      items[curr].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      let curr = items.findIndex(el => el.classList.contains('selected'));
      if (curr >= 0) items[curr].classList.remove('selected');
      curr = (curr - 1 + items.length) % items.length;
      items[curr].classList.add('selected');
      items[curr].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selected = dropdown.querySelector('.search-item.selected') || items[0];
      if (selected) {
        selected.click();
      }
    }
  });

  document.addEventListener('click', (e) => {
    if (container && !container.contains(e.target)) {
      collapseSearch();
      if (!input.value.trim()) {
        closeSearch();
      }
    }
  });
}

function setupExportCSV() {
  const btnExport = document.getElementById('btnExport');
  if (!btnExport) return;

  btnExport.addEventListener('click', () => {
    window.location.href = `/api/export/csv`;
  });
}
