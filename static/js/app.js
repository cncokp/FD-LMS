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

  let isExpanded = true;

  function togglePanel() {
    isExpanded = !isExpanded;
    if (isExpanded) {
      dropdownPanel.classList.remove('collapsed');
      if (tabBtnLayers) tabBtnLayers.classList.add('active');
    } else {
      dropdownPanel.classList.add('collapsed');
      if (tabBtnLayers) tabBtnLayers.classList.remove('active');
    }
  }

  if (tabBtnLayers) {
    tabBtnLayers.addEventListener('click', togglePanel);
  }

  if (btnCloseDropdownPanel) {
    btnCloseDropdownPanel.addEventListener('click', () => {
      isExpanded = false;
      dropdownPanel.classList.add('collapsed');
      if (tabBtnLayers) tabBtnLayers.classList.remove('active');
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
  document.querySelectorAll('.btn-basemap').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-basemap').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const basemap = btn.dataset.basemap;
      MapEngine.setBasemap(basemap);
    });
  });
}

function setupLayerToggles() {
  const toggleCSPlots = document.getElementById('toggleCSPlots');
  if (toggleCSPlots) {
    toggleCSPlots.addEventListener('change', (e) => {
      MapEngine.toggleCSPlots(e.target.checked);
    });
  }
}

function setupSearchAutocomplete() {
  const input = document.getElementById('searchInput');
  const dropdown = document.getElementById('searchResults');
  if (!input || !dropdown) return;

  let searchTimeout = null;

  function collapseSearch() {
    dropdown.classList.add('hidden');
    dropdown.style.display = 'none';
    dropdown.innerHTML = '';
  }

  input.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const q = input.value.trim();

    if (q.length === 0) {
      collapseSearch();
      return;
    }

    searchTimeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const results = await res.json();

        if (results.length === 0) {
          dropdown.innerHTML = `<div class="search-item" style="color: var(--text-dim);">No matching plot or mouza found</div>`;
          dropdown.classList.remove('hidden');
          dropdown.style.display = 'block';
          return;
        }

        dropdown.innerHTML = results.map(item => {
          const boundsAttr = JSON.stringify(item.bounds || []);
          return `
            <div class="search-item" data-type="${item.type}" data-id="${item.id || ''}" data-lat="${item.lat}" data-lng="${item.lng}" data-bounds='${boundsAttr}'>
              <div class="search-item-label">
                <i class="fa-solid fa-scroll text-warning"></i>
                <span>${item.label}</span>
              </div>
              <div class="search-item-sublabel">${item.sublabel}</div>
            </div>
          `;
        }).join('');

        dropdown.classList.remove('hidden');
        dropdown.style.display = 'block';

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
            input.blur();

            if (id && type === 'cs_plot') {
              MapEngine.selectPlotById('cs_plot', id, (lat && lng) ? [lat, lng] : null, bounds);
            } else if (lat && lng) {
              MapEngine.map.panTo([lat, lng], { animate: true });
            }
          });
        });

      } catch (err) {
        console.error("Search error:", err);
      }
    }, 180);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      collapseSearch();
      input.blur();
      return;
    }
    if (e.key === 'Enter') {
      const firstItem = dropdown.querySelector('.search-item[data-id]');
      if (firstItem) {
        firstItem.click();
      }
    }
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      collapseSearch();
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
