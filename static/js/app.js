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
  setupThemeSwitcher();
  setupHorizontalWidget();
  setupBasemapSwitcher();
  setupLayerToggles();
  setupSpatialFilter();
  setupSearchAutocomplete();
  setupExportCSV();
});

function setupHorizontalWidget() {
  const tabBtnLayers = document.getElementById('tabBtnLayers');
  const tabBtnFilter = document.getElementById('tabBtnFilter');
  const dropdownPanel = document.getElementById('dropdownPanel');
  const panelHeaderTitle = document.getElementById('panelHeaderTitle');
  const viewLayers = document.getElementById('viewLayers');
  const viewFilter = document.getElementById('viewFilter');
  const btnCloseDropdownPanel = document.getElementById('btnCloseDropdownPanel');
  const btnCloseDossier = document.getElementById('btnCloseDossier');

  let currentTab = 'layers';

  window.switchPanelTab = function(tab) {
    currentTab = tab;
    if (window.closeSearchWidget) window.closeSearchWidget();
    if (dropdownPanel) dropdownPanel.classList.remove('collapsed');

    if (tab === 'layers') {
      if (tabBtnLayers) tabBtnLayers.classList.add('active');
      if (tabBtnFilter) tabBtnFilter.classList.remove('active');
      if (panelHeaderTitle) panelHeaderTitle.innerHTML = '<i class="fa-solid fa-layer-group"></i> Layers';
      if (viewLayers) viewLayers.classList.remove('hidden');
      if (viewFilter) viewFilter.classList.add('hidden');
    } else if (tab === 'filter') {
      if (tabBtnFilter) tabBtnFilter.classList.add('active');
      if (tabBtnLayers) tabBtnLayers.classList.remove('active');
      if (panelHeaderTitle) panelHeaderTitle.innerHTML = '<i class="fa-solid fa-filter"></i> Spatial Filter';
      if (viewFilter) viewFilter.classList.remove('hidden');
      if (viewLayers) viewLayers.classList.add('hidden');
    }
  };

  window.openLayersPanel = function(tab = 'layers') {
    window.switchPanelTab(tab);
  };

  window.closeLayersPanel = function() {
    if (dropdownPanel) dropdownPanel.classList.add('collapsed');
    if (tabBtnLayers) tabBtnLayers.classList.remove('active');
    if (tabBtnFilter) tabBtnFilter.classList.remove('active');
  };

  window.isLayersPanelOpen = function() {
    return dropdownPanel && !dropdownPanel.classList.contains('collapsed');
  };

  if (tabBtnLayers) {
    tabBtnLayers.addEventListener('click', () => {
      if (window.isLayersPanelOpen() && currentTab === 'layers') {
        window.closeLayersPanel();
      } else {
        window.switchPanelTab('layers');
      }
    });
  }

  if (tabBtnFilter) {
    tabBtnFilter.addEventListener('click', () => {
      if (window.isLayersPanelOpen() && currentTab === 'filter') {
        window.closeLayersPanel();
      } else {
        window.switchPanelTab('filter');
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

  const btnDefaultExtent = document.getElementById('btnDefaultExtent');
  if (btnDefaultExtent) {
    btnDefaultExtent.addEventListener('click', () => {
      MapEngine.resetToDefaultExtent();
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

function setupSpatialFilter() {
  const beatSelect = document.getElementById('filterBeatSelect');
  const mouzaSelect = document.getElementById('filterMouzaSelect');
  const plotInput = document.getElementById('filterPlotInput');
  const plotList = document.getElementById('filterPlotList');
  const statusBox = document.getElementById('filterStatusBox');
  const statusText = document.getElementById('filterStatusText');
  const btnClearMini = document.getElementById('btnClearFilterMini');
  const btnApply = document.getElementById('btnApplyFilter');
  const btnReset = document.getElementById('btnResetFilter');
  const filterDot = document.getElementById('tabFilterDot');

  if (!btnApply || !beatSelect || !mouzaSelect) return;

  const beatMouzaMap = {
    'Park Beat': ['Araishprashad', 'Barui Para'],
    'Bankhoira': ['Bankhoira'],
    'Baruipara': ['Barui Para'],
    'Rajendrapur West': ['Barui Para'],
    'BK Bari': ['B K Bari'],
    'Bhabanipur': ['Barui Para', 'Mahona Bhabanipur'],
    'Baupara': ['Araishprashad', 'Bahadurpur', 'Baupara', 'Uttar Salna']
  };

  const allMouzas = [
    'Araishprashad',
    'B K Bari',
    'Bahadurpur',
    'Bankhoira',
    'Barui Para',
    'Baupara',
    'Mahona Bhabanipur',
    'Uttar Salna'
  ];

  function updateMouzaOptions(selectedBeat) {
    const currentVal = mouzaSelect.value;
    mouzaSelect.innerHTML = '<option value="">All Mouzas</option>';
    
    let validMouzas = allMouzas;
    if (selectedBeat && beatMouzaMap[selectedBeat]) {
      validMouzas = beatMouzaMap[selectedBeat];
    }

    validMouzas.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      mouzaSelect.appendChild(opt);
    });

    if (currentVal && validMouzas.includes(currentVal)) {
      mouzaSelect.value = currentVal;
    } else {
      mouzaSelect.value = '';
    }
  }

  function updatePlotDatalist() {
    if (!plotList) return;
    const selectedBeat = beatSelect.value.trim();
    const selectedMouza = mouzaSelect.value.trim();

    const features = MapEngine.currentCSFeatures || (MapEngine.rawCSData && MapEngine.rawCSData.features) || [];
    if (!features.length) return;

    const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const targetBeat = selectedBeat ? norm(selectedBeat).replace(/\s*beat$/i, '') : '';
    const targetMouza = selectedMouza ? norm(selectedMouza) : '';

    const plotNos = new Set();
    for (let i = 0; i < features.length; i++) {
      const p = features[i].properties || {};
      if (targetBeat) {
        const pBeat = norm(p.beat_name || '').replace(/\s*beat$/i, '');
        if (pBeat !== targetBeat) continue;
      }
      if (targetMouza) {
        const pMouza = norm(p.mouza || '');
        if (pMouza !== targetMouza) continue;
      }
      if (p.plot_no) {
        plotNos.add(String(p.plot_no).trim());
      }
    }

    const sorted = Array.from(plotNos).sort((a, b) => {
      const numA = parseInt(a, 10);
      const numB = parseInt(b, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.localeCompare(b);
    });

    plotList.innerHTML = sorted.slice(0, 1000).map(p => `<option value="${p}">Plot #${p}</option>`).join('');
  }

  beatSelect.addEventListener('change', () => {
    updateMouzaOptions(beatSelect.value);
    updatePlotDatalist();
  });

  mouzaSelect.addEventListener('change', () => {
    updatePlotDatalist();
  });

  setTimeout(updatePlotDatalist, 1500);

  function executeFilter() {
    const beat = beatSelect.value.trim();
    const mouza = mouzaSelect.value.trim();
    const plotNo = plotInput.value.trim();

    if (!beat && !mouza && !plotNo) {
      if (statusBox) {
        statusBox.classList.remove('hidden');
        statusBox.classList.add('error');
        if (statusText) statusText.textContent = 'Please select a Beat, Mouza, or Plot #';
      }
      return;
    }

    const res = MapEngine.applyFilter({ beat, mouza, plotNo });

    if (res.count > 0) {
      if (statusBox) {
        statusBox.classList.remove('hidden', 'error');
        let detailParts = [];
        if (beat) detailParts.push(beat.endsWith('Beat') ? beat : `${beat} Beat`);
        if (mouza) detailParts.push(mouza);
        if (plotNo) detailParts.push(`Plot #${plotNo}`);
        const labelStr = detailParts.join(' • ');
        if (statusText) {
          statusText.textContent = res.count === 1 ? `Plot #${res.matches[0].properties.plot_no} Found (${res.matches[0].properties.mouza || ''})` : `${res.count} Plots Found (${labelStr})`;
        }
      }
      if (filterDot) filterDot.classList.remove('hidden');
    } else if (res.beatOnly) {
      if (statusBox) {
        statusBox.classList.remove('hidden', 'error');
        if (statusText) statusText.textContent = `Zoomed to ${res.beatName} Boundary`;
      }
      if (filterDot) filterDot.classList.remove('hidden');
    } else {
      if (statusBox) {
        statusBox.classList.remove('hidden');
        statusBox.classList.add('error');
        if (statusText) statusText.textContent = 'No matching parcels found';
      }
      if (filterDot) filterDot.classList.add('hidden');
    }
  }

  btnApply.addEventListener('click', executeFilter);

  plotInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      executeFilter();
    }
  });

  function resetFilter() {
    beatSelect.value = '';
    updateMouzaOptions('');
    mouzaSelect.value = '';
    plotInput.value = '';
    updatePlotDatalist();

    MapEngine.clearFilter();

    if (statusBox) {
      statusBox.classList.add('hidden');
      statusBox.classList.remove('error');
    }
    if (filterDot) {
      filterDot.classList.add('hidden');
    }
  }

  btnReset.addEventListener('click', resetFilter);
  if (btnClearMini) {
    btnClearMini.addEventListener('click', resetFilter);
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

function setupThemeSwitcher() {
  const btnThemeToggle = document.getElementById('btnThemeToggle');
  if (!btnThemeToggle) return;

  const STORAGE_KEY = 'fd_lms_theme_v2';

  const getStoredTheme = () => {
    try {
      return localStorage.getItem(STORAGE_KEY) || 'light';
    } catch (e) {
      return 'light';
    }
  };

  const applyTheme = (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (e) {}

    const isLight = theme === 'light';
    btnThemeToggle.setAttribute('title', isLight ? 'Switch to Dark Theme' : 'Switch to Light Theme');
    btnThemeToggle.setAttribute('aria-label', isLight ? 'Switch to Dark Theme' : 'Switch to Light Theme');
  };

  // Sync state on load (defaults to light)
  applyTheme(getStoredTheme());

  btnThemeToggle.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const nextTheme = currentTheme === 'light' ? 'dark' : 'light';
    applyTheme(nextTheme);
  });
}

