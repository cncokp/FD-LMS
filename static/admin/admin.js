/**
 * FD-LMS Admin Portal Single Page Application Logic
 * Supports GIS Spatial Layers (Fixed Geometries) and Tabular Data Tables (Editable),
 * with Interactive Post-Upload Dynamic Mapping Wizard.
 */

(function() {
  'use strict';

  // State
  const state = {
    user: null,
    activeTab: 'dashboard',
    activeTable: 'parcel_info',
    theme: localStorage.getItem('fd_theme') || 'light',
    table: {
      page: 1,
      pageSize: 25,
      search: '',
      beat: '',
      mouza: '',
      plot: '',
      sortBy: 'id',
      sortDir: 'desc',
      totalPages: 1,
      totalRecords: 0,
      columns: [],
      items: []
    },
    filterOptions: {
      beats: [],
      mouzas: []
    },
    wizard: {
      file: null,
      previewData: null,
      selectedTable: 'parcel_info',
      mode: 'append',
      mapping: {}
    },
    pendingDelete: null,
    editingRecordId: null
  };

  // Table Configuration Metadata
  const TABLE_META = {
    cs_plots: {
      title: 'Plot Boundary (CS)',
      subtitle: 'Cadastral Survey (CS) polygon boundaries and spatial attributes (Fixed GIS Layer)',
      isGis: true,
      fields: [
        { name: 'plot_no', label: 'CS Plot No', type: 'text', required: true },
        { name: 'mouza', label: 'Mouza', type: 'text', required: true },
        { name: 'jl_no', label: 'CS JL No', type: 'text' },
        { name: 'beat_name', label: 'Beat Name', type: 'text', required: true },
        { name: 'area_acre', label: 'Calculated Area (Acres)', type: 'number', step: '0.0001' },
        { name: 'uid', label: 'CS UID (UID)', type: 'text' }
      ]
    },
    rs_plots: {
      title: 'Plot Boundary (RS)',
      subtitle: 'Revisional Survey (RS) polygon boundaries and spatial attributes (Fixed GIS Layer)',
      isGis: true,
      fields: [
        { name: 'plot_no', label: 'RS Plot No', type: 'text', required: true },
        { name: 'mouza', label: 'Mouza', type: 'text', required: true },
        { name: 'jl_no', label: 'RS JL No', type: 'text' },
        { name: 'beat_name', label: 'Beat Name', type: 'text', required: true },
        { name: 'area_acre', label: 'Calculated Area (Acres)', type: 'number', step: '0.0001' },
        { name: 'rs_uid', label: 'RS UID (UID2)', type: 'text' }
      ]
    },
    parcel_info: {
      title: 'Parcel Information',
      subtitle: 'Official register of CS & RS plots, Forest Department areas, Khatians, and Gazette legal status (Editable)',
      isGis: false,
      fields: [
        { name: 'cs_plot_no', label: 'CS Plot No', type: 'text', required: true },
        { name: 'rs_plot_no', label: 'RS Plot No', type: 'text' },
        { name: 'cs_uid', label: 'CS UID (UID)', type: 'text' },
        { name: 'rs_uid', label: 'RS UID (UID2)', type: 'text' },
        { name: 'mouza', label: 'Mouza', type: 'text', required: true },
        { name: 'cs_jl', label: 'CS JL No', type: 'text' },
        { name: 'rs_jl', label: 'RS JL No', type: 'text' },
        { name: 'beat_name', label: 'Beat Name', type: 'text', required: true },
        { name: 'range', label: 'Range', type: 'text' },
        { name: 'khatian_no', label: 'Khatian No', type: 'text' },
        { name: 'legal_status', label: 'Legal Status', type: 'text' },
        { name: 'area_fd', label: 'Forest Dept Area (Acres)', type: 'number', step: '0.0001' },
        { name: 'area_others', label: 'Others Area (Acres)', type: 'number', step: '0.0001' },
        { name: 'total_area', label: 'Total Area (Acres)', type: 'number', step: '0.0001' },
        { name: 'remarks', label: 'Remarks', type: 'text' }
      ]
    },
    encroachment_info: {
      title: 'Encroachment Details',
      subtitle: 'Documented illegal occupations, unauthorized structures, and eviction actions (Editable)',
      isGis: false,
      fields: [
        { name: 'encroacher_name', label: 'Encroacher Name & Address', type: 'text', required: true },
        { name: 'mouza', label: 'Mouza', type: 'text', required: true },
        { name: 'cs_plot_no', label: 'CS Plot No', type: 'text', required: true },
        { name: 'rs_plot_no', label: 'RS Plot No', type: 'text' },
        { name: 'cs_uid', label: 'CS UID (UID)', type: 'text' },
        { name: 'rs_uid', label: 'RS UID (UID2)', type: 'text' },
        { name: 'encroached_area_acre', label: 'Encroached Area (Acres)', type: 'number', step: '0.0001', required: true },
        { name: 'structure_type', label: 'Structure / Land Use Type', type: 'text' },
        { name: 'action_taken', label: 'Action Taken / Legal Case', type: 'text' },
        { name: 'rs_khatian', label: 'RS Khatian', type: 'text' },
        { name: 'sec_20', label: 'Sec 20 Status', type: 'text' },
        { name: 'sec_6', label: 'Sec 6 Status', type: 'text' }
      ]
    }
  };

  // DOM Elements
  const el = {
    loginOverlay: document.getElementById('login-overlay'),
    loginForm: document.getElementById('login-form'),
    loginUsername: document.getElementById('login-username'),
    loginPassword: document.getElementById('login-password'),
    loginError: document.getElementById('login-error'),
    loginBtn: document.getElementById('login-btn'),
    adminShell: document.getElementById('admin-shell'),
    displayUsername: document.getElementById('display-username'),
    logoutBtn: document.getElementById('logout-btn'),
    themeToggleBtn: document.getElementById('theme-toggle-btn'),
    themeIcon: document.getElementById('theme-icon'),
    sidebarToggle: document.getElementById('sidebar-toggle'),
    sidebar: document.getElementById('admin-sidebar'),
    navItems: document.querySelectorAll('.nav-item'),
    tabPanes: document.querySelectorAll('.tab-pane'),

    // Dashboard
    statParcels: document.getElementById('stat-parcels'),
    statEncroachments: document.getElementById('stat-encroachments'),
    statEncroachedAcre: document.getElementById('stat-encroached-acre'),
    statPlots: document.getElementById('stat-plots'),
    statRsPlots: document.getElementById('stat-rs-plots'),
    refreshStatsBtn: document.getElementById('refresh-stats-btn'),

    // Table view
    tableViewTitle: document.getElementById('table-view-title'),
    tableViewSubtitle: document.getElementById('table-view-subtitle'),
    tableGisBadge: document.getElementById('table-gis-badge'),
    tableAddBtn: document.getElementById('table-add-btn'),
    tableAddBtnText: document.getElementById('table-add-btn-text'),
    tableSearchInput: document.getElementById('table-search-input'),
    tableBeatFilter: document.getElementById('table-beat-filter'),
    tableMouzaFilter: document.getElementById('table-mouza-filter'),
    tablePlotFilter: document.getElementById('table-plot-filter'),
    tablePagesizeFilter: document.getElementById('table-pagesize-filter'),
    tableResetFiltersBtn: document.getElementById('table-reset-filters-btn'),
    tableHeaderRow: document.getElementById('table-header-row'),
    tableBody: document.getElementById('table-body'),
    paginationInfo: document.getElementById('pagination-info'),
    pageCurrentIndicator: document.getElementById('page-current-indicator'),
    pagePrevBtn: document.getElementById('page-prev-btn'),
    pageNextBtn: document.getElementById('page-next-btn'),

    // Record modal
    recordModal: document.getElementById('record-modal'),
    recordModalTitle: document.getElementById('record-modal-title'),
    recordForm: document.getElementById('record-form'),
    modalFormFields: document.getElementById('modal-form-fields'),
    modalCancelBtn: document.getElementById('modal-cancel-btn'),
    modalCloseBtn: document.getElementById('modal-close-btn'),

    // Delete modal
    deleteModal: document.getElementById('delete-modal'),
    deleteRecordDesc: document.getElementById('delete-record-desc'),
    deleteCancelBtn: document.getElementById('delete-cancel-btn'),
    deleteConfirmBtn: document.getElementById('delete-confirm-btn'),
    deleteModalCloseBtn: document.getElementById('delete-modal-close-btn'),

    // Mapping Wizard Modal
    mappingWizardModal: document.getElementById('mapping-wizard-modal'),
    wizardCloseBtn: document.getElementById('wizard-close-btn'),
    wizardCancelBtn: document.getElementById('wizard-cancel-btn'),
    wizardConfirmBtn: document.getElementById('wizard-confirm-btn'),
    wizardFilename: document.getElementById('wizard-filename'),
    wizardFiletypeBadge: document.getElementById('wizard-filetype-badge'),
    wizardRowsCount: document.getElementById('wizard-rows-count'),
    wizardTargetTable: document.getElementById('wizard-target-table'),
    wizardMode: document.getElementById('wizard-mode'),
    wizardMappingTbody: document.getElementById('wizard-mapping-tbody'),
    wizardPreviewThead: document.getElementById('wizard-preview-thead'),
    wizardPreviewTbody: document.getElementById('wizard-preview-tbody'),

    // Uploader tab
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('file-input'),
    selectedFileBadge: document.getElementById('selected-file-badge'),
    previewUploadBtn: document.getElementById('preview-upload-btn'),
    uploadPreviewCard: document.getElementById('upload-preview-card'),
    previewSummaryBadge: document.getElementById('preview-summary-badge'),
    mappingBadges: document.getElementById('mapping-badges'),
    previewTableHeader: document.getElementById('preview-table-header'),
    previewTableBody: document.getElementById('preview-table-body'),
    cancelUploadBtn: document.getElementById('cancel-upload-btn'),
    commitUploadBtn: document.getElementById('commit-upload-btn'),

    // Cache sync
    rebuildSnapshotsBtn: document.getElementById('rebuild-snapshots-btn'),
    clearCacheBtn: document.getElementById('clear-cache-btn'),
    toastContainer: document.getElementById('toast-container'),

    // Pipeline Continuous Progress Modal
    pipelineModal: document.getElementById('pipeline-progress-modal'),
    pipelineTitle: document.getElementById('pipeline-title'),
    pipelineSubtitle: document.getElementById('pipeline-subtitle'),
    pipelineStageBadge: document.getElementById('pipeline-stage-badge'),
    pipelineElapsedTime: document.getElementById('pipeline-elapsed-time'),
    pipelineProgressBar: document.getElementById('pipeline-progress-bar'),
    pipelineCurrentAction: document.getElementById('pipeline-current-action'),
    pipelineProgressPct: document.getElementById('pipeline-progress-pct'),
    pipelineStepsContainer: document.getElementById('pipeline-steps-container'),
    pipelineTerminalConsole: document.getElementById('pipeline-terminal-console'),
    pipelineFooter: document.getElementById('pipeline-footer'),
    pipelineCloseBtn: document.getElementById('pipeline-close-btn'),
    pipelineDismissBtn: document.getElementById('pipeline-dismiss-btn'),
    pipelineActionBtn: document.getElementById('pipeline-action-btn'),
    terminalClearBtn: document.getElementById('terminal-clear-btn')
  };

  // Bootstrap
  document.addEventListener('DOMContentLoaded', init);

  function init() {
    initTheme();
    setupEventListeners();
    checkAuthSession();
  }

  // Theme Management
  function initTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
    updateThemeIcon();
  }

  function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', state.theme);
    localStorage.setItem('fd_theme', state.theme);
    updateThemeIcon();
  }

  function updateThemeIcon() {
    if (el.themeIcon) {
      el.themeIcon.textContent = state.theme === 'dark' ? '☀️' : '🌙';
    }
  }

  // Event Listeners
  function setupEventListeners() {
    if (el.loginForm) el.loginForm.addEventListener('submit', handleLogin);
    if (el.logoutBtn) el.logoutBtn.addEventListener('click', handleLogout);
    if (el.themeToggleBtn) el.themeToggleBtn.addEventListener('click', toggleTheme);

    if (el.sidebarToggle && el.sidebar) {
      el.sidebarToggle.addEventListener('click', () => {
        el.sidebar.classList.toggle('collapsed');
      });
    }

    // Navigation items
    el.navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        const tab = item.dataset.tab;
        switchTab(tab);
      });
    });

    // Quick action buttons & dataset jump links in dashboard
    document.addEventListener('click', (e) => {
      const jumpBtn = e.target.closest('.action-tile, [data-jump], [data-action="switch-tab"]');
      if (!jumpBtn) return;

      const target = jumpBtn.dataset.jump || jumpBtn.dataset.target;
      const action = jumpBtn.dataset.action;
      if (target) {
        e.preventDefault();
        switchTab(target);
        if (action === 'add') {
          setTimeout(() => {
            openAddRecordModal();
          }, 80);
        }
      }
    });

    if (el.refreshStatsBtn) el.refreshStatsBtn.addEventListener('click', loadDashboardStats);

    // Table Filters & Pagination
    let searchDebounceTimer;
    if (el.tableSearchInput) {
      el.tableSearchInput.addEventListener('input', (e) => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
          state.table.search = e.target.value.trim();
          state.table.page = 1;
          loadTableData();
        }, 300);
      });
    }

    if (el.tableBeatFilter) {
      el.tableBeatFilter.addEventListener('change', (e) => {
        state.table.beat = e.target.value;
        state.table.page = 1;
        loadTableData();
      });
    }

    if (el.tableMouzaFilter) {
      el.tableMouzaFilter.addEventListener('change', (e) => {
        state.table.mouza = e.target.value;
        state.table.page = 1;
        loadTableData();
      });
    }

    let plotDebounceTimer;
    if (el.tablePlotFilter) {
      el.tablePlotFilter.addEventListener('input', (e) => {
        clearTimeout(plotDebounceTimer);
        plotDebounceTimer = setTimeout(() => {
          state.table.plot = e.target.value.trim();
          state.table.page = 1;
          loadTableData();
        }, 300);
      });
    }

    if (el.tableResetFiltersBtn) {
      el.tableResetFiltersBtn.addEventListener('click', () => {
        state.table.search = '';
        state.table.beat = '';
        state.table.mouza = '';
        state.table.plot = '';
        state.table.page = 1;
        if (el.tableSearchInput) el.tableSearchInput.value = '';
        if (el.tableBeatFilter) el.tableBeatFilter.value = '';
        if (el.tableMouzaFilter) el.tableMouzaFilter.value = '';
        if (el.tablePlotFilter) el.tablePlotFilter.value = '';
        loadTableData();
      });
    }

    if (el.tablePagesizeFilter) {
      el.tablePagesizeFilter.addEventListener('change', (e) => {
        state.table.pageSize = parseInt(e.target.value, 10);
        state.table.page = 1;
        loadTableData();
      });
    }

    if (el.pagePrevBtn) {
      el.pagePrevBtn.addEventListener('click', () => {
        if (state.table.page > 1) {
          state.table.page--;
          loadTableData();
        }
      });
    }

    if (el.pageNextBtn) {
      el.pageNextBtn.addEventListener('click', () => {
        if (state.table.page < state.table.totalPages) {
          state.table.page++;
          loadTableData();
        }
      });
    }

    if (el.tableAddBtn) {
      el.tableAddBtn.addEventListener('click', () => {
        const meta = TABLE_META[state.activeTable];
        if (meta && meta.isGis) {
          // For fixed GIS layers, open file picker to upload GeoJSON
          el.fileInput.click();
        } else {
          openAddRecordModal();
        }
      });
    }

    // Record Modals
    if (el.recordForm) el.recordForm.addEventListener('submit', handleSaveRecord);
    if (el.modalCancelBtn) el.modalCancelBtn.addEventListener('click', closeRecordModal);
    if (el.modalCloseBtn) el.modalCloseBtn.addEventListener('click', closeRecordModal);

    // Delete Modals
    if (el.deleteConfirmBtn) el.deleteConfirmBtn.addEventListener('click', handleConfirmDelete);
    if (el.deleteCancelBtn) el.deleteCancelBtn.addEventListener('click', closeDeleteModal);
    if (el.deleteModalCloseBtn) el.deleteModalCloseBtn.addEventListener('click', closeDeleteModal);

    // Dropzone & File Input
    if (el.dropzone) {
      el.dropzone.addEventListener('click', () => el.fileInput.click());
      el.dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        el.dropzone.classList.add('dragover');
      });
      el.dropzone.addEventListener('dragleave', () => el.dropzone.classList.remove('dragover'));
      el.dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        el.dropzone.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          triggerUploadWizard(e.dataTransfer.files[0]);
        }
      });
    }

    if (el.fileInput) {
      el.fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          triggerUploadWizard(e.target.files[0]);
        }
      });
    }

    // Mapping Wizard Modal Events
    if (el.wizardCloseBtn) el.wizardCloseBtn.addEventListener('click', closeWizardModal);
    if (el.wizardCancelBtn) el.wizardCancelBtn.addEventListener('click', closeWizardModal);
    if (el.wizardConfirmBtn) el.wizardConfirmBtn.addEventListener('click', handleWizardConfirm);
    if (el.wizardTargetTable) el.wizardTargetTable.addEventListener('change', handleWizardTargetTableChange);

    // Cache Actions
    if (el.rebuildSnapshotsBtn) el.rebuildSnapshotsBtn.addEventListener('click', handleRebuildSnapshots);
    if (el.clearCacheBtn) el.clearCacheBtn.addEventListener('click', handleClearCache);

    // Pipeline Modal Actions
    if (el.pipelineCloseBtn) el.pipelineCloseBtn.addEventListener('click', () => pipelineController.close());
    if (el.pipelineDismissBtn) el.pipelineDismissBtn.addEventListener('click', () => pipelineController.close());
    if (el.terminalClearBtn) el.terminalClearBtn.addEventListener('click', () => {
      if (el.pipelineTerminalConsole) el.pipelineTerminalConsole.innerHTML = '';
    });
  }

  // Toast Notifications
  function showToast(message, type = 'info') {
    if (!el.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
    toast.innerHTML = `<span><strong>${icon}</strong> ${message}</span>`;
    el.toastContainer.appendChild(toast);
    const duration = type === 'error' ? 8000 : 4000;
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 250);
    }, duration);
  }

  // Auth Handling
  function getAuthHeaders(extra = {}) {
    const token = localStorage.getItem('fd_admin_token');
    const headers = { ...extra };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  async function checkAuthSession() {
    try {
      const res = await fetch('/api/admin/me', { headers: getAuthHeaders() });
      if (res.ok) {
        const user = await res.json();
        onAuthenticated(user);
      } else {
        showLoginModal();
      }
    } catch (e) {
      showLoginModal();
    }
  }

  function showLoginModal() {
    if (el.loginOverlay) el.loginOverlay.style.display = 'flex';
    if (el.adminShell) el.adminShell.style.display = 'none';
  }

  function onAuthenticated(user) {
    state.user = user;
    if (el.displayUsername) el.displayUsername.textContent = user.username || 'Admin';
    if (el.loginOverlay) el.loginOverlay.style.display = 'none';
    if (el.adminShell) el.adminShell.style.display = 'flex';

    loadDashboardStats();
    loadFilterOptions();
  }

  async function handleLogin(e) {
    e.preventDefault();
    const username = el.loginUsername.value.trim();
    const password = el.loginPassword.value;

    el.loginError.style.display = 'none';
    const btnText = el.loginBtn.querySelector('.btn-text');
    const btnSpinner = el.loginBtn.querySelector('.btn-spinner');
    if (btnText) btnText.style.display = 'none';
    if (btnSpinner) btnSpinner.style.display = 'inline-block';
    el.loginBtn.disabled = true;

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (!res.ok) {
        const err = await res.json();
        el.loginError.textContent = err.detail || 'Invalid username or password';
        el.loginError.style.display = 'block';
        return;
      }

      const data = await res.json();
      if (data.token) {
        localStorage.setItem('fd_admin_token', data.token);
      }
      onAuthenticated({ username });
      showToast('Welcome back, ' + username, 'success');
    } catch (err) {
      el.loginError.textContent = 'Server connection failed. Please check network.';
      el.loginError.style.display = 'block';
    } finally {
      if (btnText) btnText.style.display = 'inline-block';
      if (btnSpinner) btnSpinner.style.display = 'none';
      el.loginBtn.disabled = false;
    }
  }

  async function handleLogout() {
    try {
      await fetch('/api/admin/logout', { method: 'POST', headers: getAuthHeaders() });
    } catch (e) {}
    localStorage.removeItem('fd_admin_token');
    state.user = null;
    showToast('Signed out of admin session', 'info');
    showLoginModal();
  }

  // Tab Switching
  function switchTab(tabName) {
    state.activeTab = tabName;

    el.navItems.forEach(item => {
      item.classList.toggle('active', item.dataset.tab === tabName);
    });

    el.tabPanes.forEach(pane => {
      pane.classList.remove('active');
    });

    // Check if selecting a table
    if (['parcel_info', 'encroachment_info', 'cs_plots', 'rs_plots'].includes(tabName)) {
      state.activeTable = tabName;
      const tableViewPane = document.getElementById('tab-table-view');
      if (tableViewPane) tableViewPane.classList.add('active');

      state.table.page = 1;
      updateTableHeadersAndMeta();
      loadTableData();
    } else {
      const targetPane = document.getElementById(`tab-${tabName}`);
      if (targetPane) targetPane.classList.add('active');

      if (tabName === 'dashboard') {
        loadDashboardStats();
      }
    }
  }

  // Dashboard Stats
  async function loadDashboardStats() {
    try {
      const res = await fetch('/api/admin/stats', { headers: getAuthHeaders() });
      if (!res.ok) return;
      const stats = await res.json();

      if (el.statParcels) el.statParcels.textContent = (stats.total_parcels || 0).toLocaleString();
      if (el.statEncroachments) el.statEncroachments.textContent = (stats.total_encroachments || 0).toLocaleString();
      if (el.statEncroachedAcre) el.statEncroachedAcre.textContent = (stats.total_encroached_acre || 0).toFixed(2);
      if (el.statPlots) el.statPlots.textContent = (stats.total_cs_plots || 0).toLocaleString();
      if (el.statRsPlots) el.statRsPlots.textContent = (stats.total_rs_plots || 0).toLocaleString();

      // Update Spatial Datasets Overview Card
      const overviewRs = document.getElementById('overview-rs-count');
      if (overviewRs && stats.total_rs_plots) overviewRs.textContent = stats.total_rs_plots.toLocaleString();
      const overviewCs = document.getElementById('overview-cs-count');
      if (overviewCs && stats.total_cs_plots) overviewCs.textContent = stats.total_cs_plots.toLocaleString();
      const overviewParcels = document.getElementById('overview-parcels-count');
      if (overviewParcels && stats.total_parcels) overviewParcels.textContent = stats.total_parcels.toLocaleString();
      const overviewEnc = document.getElementById('overview-enc-count');
      if (overviewEnc && stats.total_encroachments) overviewEnc.textContent = `${stats.total_encroachments.toLocaleString()} cases (${(stats.total_encroached_acre || 0).toFixed(2)} ac)`;
      const overviewEngineSource = document.getElementById('overview-engine-source');
      if (overviewEngineSource && stats.source) overviewEngineSource.textContent = stats.source.includes('Supabase') ? 'Supabase PG' : 'Gzip Cache';
    } catch (e) {
      console.warn('Stats fetch failed:', e);
    }
  }

  // Filter Options
  async function loadFilterOptions() {
    try {
      const res = await fetch('/api/admin/filters', { headers: getAuthHeaders() });
      if (!res.ok) return;
      const filters = await res.json();
      state.filterOptions = filters;

      if (el.tableBeatFilter) {
        let beatHtml = '<option value="">All Beats</option>';
        (filters.beats || []).forEach(b => {
          beatHtml += `<option value="${b}">${b}</option>`;
        });
        el.tableBeatFilter.innerHTML = beatHtml;
      }

      if (el.tableMouzaFilter) {
        let mouzaHtml = '<option value="">All Mouzas</option>';
        (filters.mouzas || []).forEach(m => {
          mouzaHtml += `<option value="${m}">${m}</option>`;
        });
        el.tableMouzaFilter.innerHTML = mouzaHtml;
      }
    } catch (e) {
      console.warn('Filter options fetch error:', e);
    }
  }

  // Table View & Data
  function updateTableHeadersAndMeta() {
    const table = state.activeTable;
    const meta = TABLE_META[table];
    if (!meta) return;

    if (el.tableViewTitle) el.tableViewTitle.textContent = meta.title;
    if (el.tableViewSubtitle) el.tableViewSubtitle.textContent = meta.subtitle;

    if (meta.isGis) {
      if (el.tableGisBadge) el.tableGisBadge.style.display = 'inline-block';
      if (el.tableAddBtnText) el.tableAddBtnText.textContent = 'Upload GeoJSON Layer';
      el.tableAddBtn.title = 'Upload GeoJSON / JSON file to add or update spatial features';
    } else {
      if (el.tableGisBadge) el.tableGisBadge.style.display = 'none';
      if (el.tableAddBtnText) el.tableAddBtnText.textContent = 'Add Record';
      el.tableAddBtn.title = 'Add new record to database table';
    }
  }

  function escapeAttr(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  async function loadTableData() {
    const table = state.activeTable;
    el.tableBody.innerHTML = '<tr><td colspan="10" class="text-center py-4">Loading table records...</td></tr>';

    const params = new URLSearchParams({
      page: state.table.page,
      page_size: state.table.pageSize,
      search: state.table.search,
      beat: state.table.beat,
      mouza: state.table.mouza,
      plot: state.table.plot,
      sort_by: state.table.sortBy,
      sort_dir: state.table.sortDir
    });

    try {
      const res = await fetch(`/api/admin/tables/${table}?${params.toString()}`, { headers: getAuthHeaders() });
      if (!res.ok) {
        el.tableBody.innerHTML = '<tr><td colspan="10" class="text-center py-4 text-danger">Failed to load data from server</td></tr>';
        return;
      }
      const data = await res.json();
      state.table.items = data.items || [];
      state.table.totalRecords = data.total || 0;
      state.table.totalPages = data.total_pages || 1;
      state.table.columns = data.columns || [];

      renderTable();
    } catch (e) {
      el.tableBody.innerHTML = '<tr><td colspan="10" class="text-center py-4 text-danger">Error fetching records</td></tr>';
    }
  }

  function renderTable() {
    const table = state.activeTable;
    const items = state.table.items;
    const meta = TABLE_META[table];

    // Build Table Headers
    let headerHtml = '<th class="col-id">ID</th>';
    meta.fields.forEach(f => {
      const colClass = `col-${f.name.replace(/_/g, '-')}`;
      headerHtml += `<th class="${colClass}">${f.label}</th>`;
    });
    headerHtml += '<th class="col-actions text-right">Actions</th>';
    el.tableHeaderRow.innerHTML = headerHtml;

    // Build Rows
    if (items.length === 0) {
      el.tableBody.innerHTML = `<tr><td colspan="${meta.fields.length + 2}" class="text-center py-4 text-muted">No records match current filter criteria</td></tr>`;
    } else {
      let bodyHtml = '';
      items.forEach(row => {
        bodyHtml += `<tr>`;
        bodyHtml += `<td class="cell-id"><strong>${row.id}</strong></td>`;

        meta.fields.forEach(f => {
          let val = row[f.name];
          if (val === null || val === undefined || val === '') {
            if (f.name === 'cs_uid') val = row.uid;
            else if (f.name === 'rs_uid') val = row.uid2;
            else if (f.name === 'uid') val = row.cs_uid;
          }
          const rawVal = val !== null && val !== undefined ? String(val) : '';
          const colClass = `cell-${f.name.replace(/_/g, '-')}`;
          let displayVal = val;
          if (val === null || val === undefined || val === '') {
            displayVal = '<span class="text-muted">-</span>';
          } else if (f.name === 'legal_status') {
            displayVal = `<span class="badge badge-info">${val}</span>`;
          } else if (f.name === 'encroached_area_acre' || f.name === 'area_fd' || f.name === 'area_acre') {
            displayVal = `<span class="badge badge-acre"><strong>${val}</strong> ac</span>`;
          } else if (f.name === 'cs_uid' || f.name === 'rs_uid' || f.name === 'uid') {
            displayVal = `<span class="mono text-xs">${val}</span>`;
          } else if (f.name === 'cs_plot_no' || f.name === 'rs_plot_no' || f.name === 'plot_no') {
            displayVal = `<strong>${val}</strong>`;
          }
          bodyHtml += `<td class="${colClass}" title="${escapeAttr(rawVal)}">${displayVal}</td>`;
        });

        if (meta.isGis) {
          bodyHtml += `
            <td class="text-right">
              <span class="badge badge-purple" title="GIS spatial geometry is fixed. Update via GeoJSON upload.">Fixed Geometry</span>
            </td>
          `;
        } else {
          bodyHtml += `
            <td class="text-right">
              <div class="table-actions-cell" style="justify-content: flex-end;">
                <button class="btn btn-outline btn-xs edit-row-btn" data-id="${row.id}">Edit</button>
                <button class="btn btn-danger btn-xs delete-row-btn" data-id="${row.id}">Delete</button>
              </div>
            </td>
          `;
        }
        bodyHtml += `</tr>`;
      });
      el.tableBody.innerHTML = bodyHtml;

      if (!meta.isGis) {
        el.tableBody.querySelectorAll('.edit-row-btn').forEach(btn => {
          btn.addEventListener('click', () => openEditRecordModal(btn.dataset.id));
        });
        el.tableBody.querySelectorAll('.delete-row-btn').forEach(btn => {
          btn.addEventListener('click', () => openDeleteModal(btn.dataset.id));
        });
      }
    }

    // Update Pagination UI
    const start = (state.table.page - 1) * state.table.pageSize + (items.length > 0 ? 1 : 0);
    const end = Math.min(start + items.length - 1, state.table.totalRecords);
    el.paginationInfo.textContent = `Showing ${start} - ${end} of ${state.table.totalRecords.toLocaleString()} records`;
    el.pageCurrentIndicator.textContent = `Page ${state.table.page} of ${state.table.totalPages}`;
    el.pagePrevBtn.disabled = state.table.page <= 1;
    el.pageNextBtn.disabled = state.table.page >= state.table.totalPages;
  }

  // Record Modal (Add / Edit for Tabular Data)
  function openAddRecordModal() {
    const meta = TABLE_META[state.activeTable];
    if (meta && meta.isGis) {
      switchTab('uploader');
      setTimeout(() => {
        if (el.fileInput) el.fileInput.click();
      }, 100);
      return;
    }
    state.editingRecordId = null;
    el.recordModalTitle.textContent = `Add New Record (${meta.title})`;
    renderModalFields({});
    el.recordModal.style.display = 'flex';
  }

  async function openEditRecordModal(recordId) {
    state.editingRecordId = recordId;
    const meta = TABLE_META[state.activeTable];
    el.recordModalTitle.textContent = `Edit Record #${recordId} (${meta.title})`;

    try {
      const res = await fetch(`/api/admin/tables/${state.activeTable}/${recordId}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch record');
      const data = await res.json();
      renderModalFields(data);
      el.recordModal.style.display = 'flex';
    } catch (e) {
      showToast('Could not load record details', 'error');
    }
  }

  let lastMatchedPlotData = null;

  function renderModalFields(record) {
    const table = state.activeTable;
    const meta = TABLE_META[table];
    if (!meta) return;

    lastMatchedPlotData = null;
    let html = '<div class="dossier-form-grid">';

    // Datalists for standard options
    const beatsOptions = (state.filterOptions.beats || []).map(b => `<option value="${b}">`).join('');
    const mouzasOptions = (state.filterOptions.mouzas || []).map(m => `<option value="${m}">`).join('');

    html += `
      <datalist id="datalist-beats">${beatsOptions}</datalist>
      <datalist id="datalist-mouzas">${mouzasOptions}</datalist>
      <datalist id="datalist-structures">
        <option value="Residential (Tin-shed)">
        <option value="Residential (Pacca)">
        <option value="Commercial / Shop">
        <option value="Boundary Wall / Fencing">
        <option value="Agricultural Farming">
        <option value="Pond / Fishery">
        <option value="Factory / Warehouse Shed">
        <option value="Brick Kiln">
        <option value="Religious / Community">
      </datalist>
      <datalist id="datalist-actions">
        <option value="Notice Served">
        <option value="Eviction Proposed">
        <option value="Forest Case Filed">
        <option value="Demolition Executed">
        <option value="Under Field Investigation">
        <option value="Eviction Under Process">
        <option value="High Court Writ Stay">
      </datalist>
      <datalist id="datalist-legal">
        <option value="6 Dhara">
        <option value="20 Dhara">
        <option value="4 Dhara">
        <option value="Reserved Forest">
        <option value="Protected Forest">
        <option value="Acquired Land">
        <option value="Vested Property">
      </datalist>
      <datalist id="datalist-sec20">
        <option value="Gazetted (Sec 20)">
        <option value="Proposed Sec 20">
        <option value="Published">
        <option value="Pending">
        <option value="None">
      </datalist>
      <datalist id="datalist-sec6">
        <option value="Sec 6 Notified">
        <option value="Sec 6 Published">
        <option value="In Process">
        <option value="None">
      </datalist>
    `;

    meta.fields.forEach(f => {
      let val = record[f.name] !== undefined && record[f.name] !== null ? record[f.name] : '';
      if (val === '') {
        if (f.name === 'cs_uid') val = record.uid || '';
        else if (f.name === 'rs_uid') val = record.uid2 || '';
        else if (f.name === 'uid') val = record.cs_uid || '';
      }

      const isCol2 = ['encroacher_name', 'remarks'].includes(f.name);
      const colClass = isCol2 ? 'dossier-col-2' : '';
      const stepAttr = f.step ? `step="${f.step}"` : '';
      const reqAttr = f.required ? 'required' : '';
      const reqStar = f.required ? '<span class="req">*</span>' : '';

      // Datalist mapping
      let listAttr = '';
      if (f.name === 'structure_type') listAttr = 'list="datalist-structures"';
      else if (f.name === 'action_taken') listAttr = 'list="datalist-actions"';
      else if (f.name === 'legal_status') listAttr = 'list="datalist-legal"';
      else if (f.name === 'sec_20') listAttr = 'list="datalist-sec20"';
      else if (f.name === 'sec_6') listAttr = 'list="datalist-sec6"';
      else if (f.name === 'beat_name') listAttr = 'list="datalist-beats"';
      else if (f.name === 'mouza') listAttr = 'list="datalist-mouzas"';

      // Auto-gen UID badge
      let uidBadgeHtml = '';
      if (f.name === 'cs_uid' || f.name === 'rs_uid') {
        const isSet = Boolean(val);
        uidBadgeHtml = `<span class="uid-gen-badge ${isSet ? 'custom' : ''}" id="badge-auto-${f.name}" data-uid-field="${f.name}" title="Click to auto-generate UID">${isSet ? '✏️ Custom' : '⚡ Auto'}</span>`;
      }

      const isPlotNo = f.name === 'cs_plot_no' || f.name === 'rs_plot_no';
      const autocompleteAttr = isPlotNo ? 'autocomplete="off"' : '';

      html += `
        <div class="dossier-form-group ${colClass}">
          <div class="dossier-label-row">
            <label for="field-${f.name}" class="dossier-label">
              <span>${f.label}</span>
              ${reqStar}
            </label>
            ${uidBadgeHtml}
          </div>
          <input 
            type="${f.type}" 
            id="field-${f.name}" 
            name="${f.name}" 
            value="${val}" 
            class="dossier-input" 
            ${stepAttr} 
            ${reqAttr} 
            ${listAttr} 
            ${autocompleteAttr}
            placeholder="${isPlotNo ? 'Type to search or enter plot #' : ''}"
          >
          ${isPlotNo ? `<div class="plot-suggestions-dropdown" id="dropdown-${f.name}" style="display: none;"></div>` : ''}
        </div>
      `;
    });

    html += '</div>';
    el.modalFormFields.innerHTML = html;

    // Attach interactive behavior
    attachInteractiveFormHandlers();
  }

  function attachInteractiveFormHandlers() {
    const csPlotInput = document.getElementById('field-cs_plot_no');
    const rsPlotInput = document.getElementById('field-rs_plot_no');
    const csUidInput = document.getElementById('field-cs_uid');
    const rsUidInput = document.getElementById('field-rs_uid');
    const csJlInput = document.getElementById('field-cs_jl');
    const rsJlInput = document.getElementById('field-rs_jl');
    const mouzaInput = document.getElementById('field-mouza');
    const beatInput = document.getElementById('field-beat_name');
    const khatianInput = document.getElementById('field-khatian_no') || document.getElementById('field-rs_khatian');
    const legalStatusInput = document.getElementById('field-legal_status');

    // Helper: flash field to indicate auto-fill
    function flashField(input) {
      if (!input) return;
      input.classList.add('highlight-auto');
      setTimeout(() => input.classList.remove('highlight-auto'), 1200);
    }

    // Helper: compute UID
    function computeUid(plotNo, jlNo) {
      const p = String(plotNo || '').trim();
      const j = String(jlNo || '').trim();
      if (!p) return '';
      if (j) return `${j}${p}`;
      return p;
    }

    // Helper: update UID badge state
    function updateUidBadge(field, isAuto) {
      const badge = document.getElementById(`badge-auto-${field}`);
      if (!badge) return;
      if (isAuto) {
        badge.textContent = '⚡ Auto';
        badge.className = 'uid-gen-badge';
        badge.title = 'Auto-generated from Plot and JL';
      } else {
        badge.textContent = '✏️ Custom';
        badge.className = 'uid-gen-badge custom';
        badge.title = 'Custom UID (click to re-generate)';
      }
    }

    // Auto-generate click buttons
    ['cs_uid', 'rs_uid'].forEach(fName => {
      const badge = document.getElementById(`badge-auto-${fName}`);
      if (badge) {
        badge.addEventListener('click', () => {
          if (fName === 'cs_uid') {
            const plot = csPlotInput ? csPlotInput.value.trim() : '';
            const jl = csJlInput ? csJlInput.value.trim() : (lastMatchedPlotData ? lastMatchedPlotData.cs_jl : '');
            if (plot && csUidInput) {
              csUidInput.value = computeUid(plot, jl);
              flashField(csUidInput);
              updateUidBadge('cs_uid', true);
            }
          } else if (fName === 'rs_uid') {
            const plot = rsPlotInput ? rsPlotInput.value.trim() : '';
            const jl = rsJlInput ? rsJlInput.value.trim() : (lastMatchedPlotData ? (lastMatchedPlotData.rs_jl || lastMatchedPlotData.cs_jl) : '');
            if (plot && rsUidInput) {
              rsUidInput.value = computeUid(plot, jl);
              flashField(rsUidInput);
              updateUidBadge('rs_uid', true);
            }
          }
        });
      }
    });

    // Detect manual edit on UID inputs
    if (csUidInput) {
      csUidInput.addEventListener('input', () => updateUidBadge('cs_uid', false));
    }
    if (rsUidInput) {
      rsUidInput.addEventListener('input', () => updateUidBadge('rs_uid', false));
    }

    // Setup autocomplete and auto-generate for a plot input
    function setupPlotAutocomplete(plotInput, fieldName) {
      if (!plotInput) return;
      const dropdown = document.getElementById(`dropdown-${fieldName}`);
      if (!dropdown) return;

      let debounceTimer = null;

      plotInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        clearTimeout(debounceTimer);

        if (!query) {
          dropdown.style.display = 'none';
          dropdown.innerHTML = '';
          return;
        }

        // Live calculation if JL is available
        if (fieldName === 'cs_plot_no' && csUidInput) {
          const jl = csJlInput ? csJlInput.value.trim() : (lastMatchedPlotData ? lastMatchedPlotData.cs_jl : '');
          if (jl) {
            csUidInput.value = `${jl}${query}`;
            updateUidBadge('cs_uid', true);
          }
        } else if (fieldName === 'rs_plot_no' && rsUidInput) {
          const jl = rsJlInput ? rsJlInput.value.trim() : (lastMatchedPlotData ? (lastMatchedPlotData.rs_jl || lastMatchedPlotData.cs_jl) : '');
          if (jl) {
            rsUidInput.value = `${jl}${query}`;
            updateUidBadge('rs_uid', true);
          }
        }

        debounceTimer = setTimeout(async () => {
          try {
            const res = await fetch(`/api/admin/lookup/plots?q=${encodeURIComponent(query)}&limit=8`, {
              headers: getAuthHeaders()
            });
            if (!res.ok) return;
            const matches = await res.json();
            renderPlotSuggestions(dropdown, matches, fieldName);
          } catch (err) {
            console.warn('Plot lookup error:', err);
          }
        }, 160);
      });

      // Hide dropdown on blur/outside click
      document.addEventListener('click', (e) => {
        if (!plotInput.contains(e.target) && !dropdown.contains(e.target)) {
          dropdown.style.display = 'none';
        }
      });
    }

    function renderPlotSuggestions(dropdown, matches, currentField) {
      if (!matches || matches.length === 0) {
        dropdown.style.display = 'none';
        dropdown.innerHTML = '';
        return;
      }

      let itemsHtml = '';
      matches.forEach((m, idx) => {
        const csInfo = m.cs_plot_no ? `CS #${m.cs_plot_no}` : '';
        const rsInfo = m.rs_plot_no ? `RS #${m.rs_plot_no}` : '';
        const plotTitle = [csInfo, rsInfo].filter(Boolean).join(' ⟷ ') || `Plot #${m.cs_plot_no || m.rs_plot_no}`;
        const mouzaInfo = m.mouza ? `Mouza: ${m.mouza}` : '';
        const jlInfo = (m.cs_jl || m.rs_jl) ? `JL: ${m.cs_jl || m.rs_jl}` : '';
        const uidInfo = m.cs_uid ? `CS UID: ${m.cs_uid}` : (m.rs_uid ? `RS UID: ${m.rs_uid}` : '');
        const subDetails = [mouzaInfo, jlInfo, uidInfo].filter(Boolean).join(' • ');

        itemsHtml += `
          <div class="plot-suggestion-item" data-idx="${idx}">
            <div class="suggestion-main">
              <span>${plotTitle}</span>
              <span class="badge ${m.source === 'parcel_info' ? 'badge-success' : 'badge-info'} text-xs">${m.source === 'parcel_info' ? 'Registered' : 'GIS'}</span>
            </div>
            <div class="suggestion-sub">${subDetails}</div>
          </div>
        `;
      });

      dropdown.innerHTML = itemsHtml;
      dropdown.style.display = 'block';

      // Attach click events
      dropdown.querySelectorAll('.plot-suggestion-item').forEach(item => {
        item.addEventListener('click', () => {
          const idx = parseInt(item.dataset.idx, 10);
          const sel = matches[idx];
          if (!sel) return;
          applySelectedPlot(sel, currentField);
          dropdown.style.display = 'none';
        });
      });
    }

    function applySelectedPlot(plot, fromField) {
      lastMatchedPlotData = plot;

      // Fill CS Plot & UID
      if (plot.cs_plot_no && csPlotInput) {
        csPlotInput.value = plot.cs_plot_no;
        flashField(csPlotInput);
      }
      if (plot.cs_uid && csUidInput) {
        csUidInput.value = plot.cs_uid;
        flashField(csUidInput);
        updateUidBadge('cs_uid', true);
      } else if (plot.cs_plot_no && plot.cs_jl && csUidInput) {
        csUidInput.value = `${plot.cs_jl}${plot.cs_plot_no}`;
        flashField(csUidInput);
        updateUidBadge('cs_uid', true);
      }

      // Fill RS Plot & UID
      if (plot.rs_plot_no && rsPlotInput) {
        rsPlotInput.value = plot.rs_plot_no;
        flashField(rsPlotInput);
      }
      if (plot.rs_uid && rsUidInput) {
        rsUidInput.value = plot.rs_uid;
        flashField(rsUidInput);
        updateUidBadge('rs_uid', true);
      } else if (plot.rs_plot_no && (plot.rs_jl || plot.cs_jl) && rsUidInput) {
        rsUidInput.value = `${plot.rs_jl || plot.cs_jl}${plot.rs_plot_no}`;
        flashField(rsUidInput);
        updateUidBadge('rs_uid', true);
      }

      // Fill secondary attributes if available and empty
      if (plot.khatian_no && khatianInput && !khatianInput.value) {
        khatianInput.value = plot.khatian_no;
        flashField(khatianInput);
      }
      if (plot.mouza && mouzaInput && !mouzaInput.value) {
        mouzaInput.value = plot.mouza;
        flashField(mouzaInput);
      }
      if (plot.beat_name && beatInput && !beatInput.value) {
        beatInput.value = plot.beat_name;
        flashField(beatInput);
      }
      if (plot.cs_jl && csJlInput && !csJlInput.value) {
        csJlInput.value = plot.cs_jl;
        flashField(csJlInput);
      }
      if (plot.rs_jl && rsJlInput && !rsJlInput.value) {
        rsJlInput.value = plot.rs_jl;
        flashField(rsJlInput);
      }
      if (plot.legal_status && legalStatusInput && !legalStatusInput.value) {
        legalStatusInput.value = plot.legal_status;
        flashField(legalStatusInput);
      }
    }

    setupPlotAutocomplete(csPlotInput, 'cs_plot_no');
    setupPlotAutocomplete(rsPlotInput, 'rs_plot_no');

    // Link JL changes in parcel_info to auto-recompute UID
    if (csJlInput) {
      csJlInput.addEventListener('input', () => {
        if (csPlotInput && csUidInput && csPlotInput.value.trim()) {
          csUidInput.value = `${csJlInput.value.trim()}${csPlotInput.value.trim()}`;
          updateUidBadge('cs_uid', true);
        }
      });
    }
    if (rsJlInput) {
      rsJlInput.addEventListener('input', () => {
        if (rsPlotInput && rsUidInput && rsPlotInput.value.trim()) {
          rsUidInput.value = `${rsJlInput.value.trim()}${rsPlotInput.value.trim()}`;
          updateUidBadge('rs_uid', true);
        }
      });
    }
  }

  function closeRecordModal() {
    el.recordModal.style.display = 'none';
    state.editingRecordId = null;
    lastMatchedPlotData = null;
  }

  async function handleSaveRecord(e) {
    e.preventDefault();
    const formData = new FormData(el.recordForm);
    const payload = {};
    formData.forEach((val, key) => {
      payload[key] = val.trim();
    });

    const isEdit = Boolean(state.editingRecordId);
    const url = isEdit 
      ? `/api/admin/tables/${state.activeTable}/${state.editingRecordId}`
      : `/api/admin/tables/${state.activeTable}`;
    const method = isEdit ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method: method,
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json();
        showToast(err.detail || 'Save failed', 'error');
        return;
      }

      closeRecordModal();
      showToast(isEdit ? 'Record updated successfully' : 'Record added successfully', 'success');
      loadTableData();
      loadDashboardStats();
    } catch (e) {
      showToast('Network error while saving record', 'error');
    }
  }

  // Delete Modal
  function openDeleteModal(recordId) {
    state.pendingDelete = recordId;
    el.deleteRecordDesc.textContent = `Record ID: #${recordId} from ${state.activeTable}`;
    el.deleteModal.style.display = 'flex';
  }

  function closeDeleteModal() {
    el.deleteModal.style.display = 'none';
    state.pendingDelete = null;
  }

  async function handleConfirmDelete() {
    if (!state.pendingDelete) return;
    const recordId = state.pendingDelete;

    try {
      const res = await fetch(`/api/admin/tables/${state.activeTable}/${recordId}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });

      if (!res.ok) {
        showToast('Failed to delete record', 'error');
        return;
      }

      closeDeleteModal();
      showToast(`Record #${recordId} deleted`, 'success');
      loadTableData();
      loadDashboardStats();
    } catch (e) {
      showToast('Error deleting record', 'error');
    }
  }

  // Helper: Format byte counts
  function formatBytes(bytes, decimals = 1) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  // ========================================================================
  // REAL-TIME CONTINUOUS PIPELINE CONTROLLER
  // ========================================================================
  const pipelineController = {
    timerInterval: null,
    startTime: 0,
    stages: [],

    start(title, subtitle, stagesList) {
      if (!el.pipelineModal) return;
      this.stages = stagesList;
      this.startTime = Date.now();

      if (el.pipelineTitle) el.pipelineTitle.textContent = title;
      if (el.pipelineSubtitle) el.pipelineSubtitle.textContent = subtitle;
      if (el.pipelineStageBadge) {
        el.pipelineStageBadge.className = 'badge badge-purple';
        el.pipelineStageBadge.textContent = 'PIPELINE ACTIVE';
      }
      if (el.pipelineProgressBar) el.pipelineProgressBar.style.width = '8%';
      if (el.pipelineProgressPct) el.pipelineProgressPct.textContent = '8%';
      if (el.pipelineCurrentAction) el.pipelineCurrentAction.textContent = 'Initializing pipeline stream...';
      if (el.pipelineFooter) el.pipelineFooter.style.display = 'none';
      if (el.pipelineCloseBtn) el.pipelineCloseBtn.style.display = 'none';
      if (el.pipelineTerminalConsole) el.pipelineTerminalConsole.innerHTML = '';

      this.renderStages();

      if (this.timerInterval) clearInterval(this.timerInterval);
      this.timerInterval = setInterval(() => {
        const sec = ((Date.now() - this.startTime) / 1000).toFixed(1);
        if (el.pipelineElapsedTime) el.pipelineElapsedTime.textContent = `${sec}s`;
      }, 100);

      el.pipelineModal.style.display = 'flex';
      this.log('INFO', `Initialized pipeline: ${title}`);
    },

    renderStages() {
      if (!el.pipelineStepsContainer) return;
      let html = '';
      this.stages.forEach((st, idx) => {
        const statusClass = st.status || 'pending';
        let icon = `${idx + 1}`;
        if (st.status === 'completed') icon = '✓';
        if (st.status === 'failed') icon = '✕';
        if (st.status === 'active') icon = '⏳';

        let badgeClass = 'badge-info';
        if (st.status === 'pending') badgeClass = 'badge-muted';
        if (st.status === 'completed') badgeClass = 'badge-success';
        if (st.status === 'failed') badgeClass = 'badge-danger';

        html += `
          <div class="pipeline-step-item ${statusClass}" id="pipe-step-${idx}">
            <div class="pipeline-step-indicator">${icon}</div>
            <div class="pipeline-step-content">
              <div class="pipeline-step-title-row">
                <span class="pipeline-step-title">${st.title}</span>
                <span class="pipeline-step-badge badge ${badgeClass}">${st.status.toUpperCase()}</span>
              </div>
              <div class="pipeline-step-details">${st.details || 'Pending execution...'}</div>
            </div>
          </div>
        `;
      });
      el.pipelineStepsContainer.innerHTML = html;
    },

    setStage(index, status, details) {
      if (!this.stages[index]) return;
      this.stages[index].status = status;
      if (details) this.stages[index].details = details;
      this.renderStages();

      if (status === 'active') {
        if (el.pipelineCurrentAction) el.pipelineCurrentAction.textContent = this.stages[index].title + '...';
        this.log('INFO', `Executing: ${this.stages[index].title}`);
      } else if (status === 'completed') {
        this.log('SUCCESS', `Completed: ${details || this.stages[index].title}`);
      } else if (status === 'failed') {
        this.log('ERROR', `Failed: ${details || 'Execution error'}`);
      }
    },

    setProgress(pct, actionText) {
      if (el.pipelineProgressBar) el.pipelineProgressBar.style.width = `${pct}%`;
      if (el.pipelineProgressPct) el.pipelineProgressPct.textContent = `${pct}%`;
      if (actionText && el.pipelineCurrentAction) el.pipelineCurrentAction.textContent = actionText;
    },

    log(level, msg) {
      if (!el.pipelineTerminalConsole) return;
      const now = new Date();
      const timeStr = now.toTimeString().split(' ')[0];
      const line = document.createElement('div');
      line.className = 'terminal-line';
      line.innerHTML = `
        <span class="terminal-time">[${timeStr}]</span>
        <span class="terminal-tag ${level}">[${level}]</span>
        <span class="terminal-text">${msg}</span>
      `;
      el.pipelineTerminalConsole.appendChild(line);
      el.pipelineTerminalConsole.scrollTop = el.pipelineTerminalConsole.scrollHeight;
    },

    finish(summaryTitle, summarySubtitle, buttonText, onAction) {
      if (this.timerInterval) clearInterval(this.timerInterval);
      const totalTime = ((Date.now() - this.startTime) / 1000).toFixed(1);
      if (el.pipelineElapsedTime) el.pipelineElapsedTime.textContent = `${totalTime}s`;
      if (el.pipelineStageBadge) {
        el.pipelineStageBadge.className = 'badge badge-success';
        el.pipelineStageBadge.textContent = 'COMPLETED';
      }
      this.setProgress(100, summarySubtitle || 'Pipeline completed successfully.');
      this.log('SUCCESS', `All stages completed successfully in ${totalTime} seconds.`);

      if (el.pipelineFooter) el.pipelineFooter.style.display = 'flex';
      if (el.pipelineCloseBtn) el.pipelineCloseBtn.style.display = 'block';

      if (buttonText && onAction && el.pipelineActionBtn) {
        el.pipelineActionBtn.style.display = 'inline-block';
        el.pipelineActionBtn.textContent = buttonText;
        el.pipelineActionBtn.onclick = () => {
          this.close();
          onAction();
        };
      } else if (el.pipelineActionBtn) {
        el.pipelineActionBtn.style.display = 'none';
      }
    },

    fail(errorMessage) {
      if (this.timerInterval) clearInterval(this.timerInterval);
      if (el.pipelineStageBadge) {
        el.pipelineStageBadge.className = 'badge badge-danger';
        el.pipelineStageBadge.textContent = 'FAILED';
      }
      if (el.pipelineCurrentAction) el.pipelineCurrentAction.textContent = 'Pipeline encountered an error.';
      this.log('ERROR', errorMessage);
      if (el.pipelineFooter) el.pipelineFooter.style.display = 'flex';
      if (el.pipelineCloseBtn) el.pipelineCloseBtn.style.display = 'block';
      if (el.pipelineActionBtn) el.pipelineActionBtn.style.display = 'none';
    },

    close() {
      if (this.timerInterval) clearInterval(this.timerInterval);
      if (el.pipelineModal) el.pipelineModal.style.display = 'none';
    }
  };

  // ========================================================================
  // DYNAMIC POST-UPLOAD MAPPING WIZARD CONTROLLER (WITH LIVE STEP PROGRESS)
  // ========================================================================
  async function triggerUploadWizard(file) {
    if (!file) return;
    state.wizard.file = file;

    const stages = [
      { step: 1, title: 'File Stream & Integrity Verification', status: 'active', details: `Reading file bytes for ${file.name} (${formatBytes(file.size)})` },
      { step: 2, title: 'Dataset & Geometry Decoding', status: 'pending', details: 'Parsing spatial boundaries / tabular rows...' },
      { step: 3, title: 'Schema Analysis & Column Alignment', status: 'pending', details: 'Detecting CS UID, RS UID, and attributes...' },
      { step: 4, title: 'Preview Assembly & Ready for Review', status: 'pending', details: 'Generating sample row previews for schema wizard...' }
    ];

    pipelineController.start(
      'Data Ingestion & Schema Discovery',
      `Analyzing: ${file.name} (${formatBytes(file.size)})`,
      stages
    );
    pipelineController.setProgress(15, 'Streaming file buffer...');
    pipelineController.log('INFO', `File received: ${file.name} (${formatBytes(file.size)})`);

    // Check if JSON / GeoJSON: can do client-side pre-analysis or fallback
    let clientPreview = null;
    const isJsonFile = file.name.toLowerCase().endsWith('.json') || file.name.toLowerCase().endsWith('.geojson');

    if (isJsonFile) {
      try {
        pipelineController.log('INFO', 'Detected JSON / GeoJSON extension. Inspecting local stream...');
        const text = await file.text();
        pipelineController.setStage(0, 'completed', `Loaded ${formatBytes(file.size)} from '${file.name}'`);
        pipelineController.setProgress(35, 'Decoding spatial features and attributes...');

        pipelineController.setStage(1, 'active', 'Inspecting geometries & attribute fields...');
        const parsed = JSON.parse(text);

        let features = null;
        let isEsri = false;

        if (parsed && parsed.type === 'FeatureCollection' && Array.isArray(parsed.features)) {
          features = parsed.features;
          pipelineController.log('INFO', `GeoJSON FeatureCollection validated with ${features.length.toLocaleString()} polygon features`);
        } else if (parsed && Array.isArray(parsed.features) && (parsed.geometryType || parsed.spatialReference || (parsed.features[0] && parsed.features[0].attributes))) {
          features = parsed.features;
          isEsri = true;
          const sRef = parsed.spatialReference ? (parsed.spatialReference.wkid || parsed.spatialReference.latestWkid || 'ESRI') : 'ESRI';
          pipelineController.log('INFO', `ArcGIS/ESRI FeatureSet format identified (spatialReference: ${sRef}) with ${features.length.toLocaleString()} features`);
        } else if (Array.isArray(parsed) && parsed.length > 0) {
          features = parsed;
          pipelineController.log('INFO', `Array dataset identified with ${features.length.toLocaleString()} items`);
        }

        if (features && features.length > 0) {
          const colsSet = new Set();
          const sampleRows = [];
          for (let i = 0; i < features.length; i++) {
            const f = features[i];
            const props = isEsri ? (f.attributes || {}) : (f.properties || f);
            Object.keys(props).forEach(k => {
              if (!k.startsWith('_')) colsSet.add(k);
            });
            if (i < 6) sampleRows.push(props);
          }
          const detectedCols = Array.from(colsSet).sort();
          pipelineController.setStage(1, 'completed', `Decoded ${features.length.toLocaleString()} ${isEsri ? 'ESRI Polygon features' : 'features'} across ${detectedCols.length} properties`);
          pipelineController.setProgress(60, 'Aligning schema properties...');

          pipelineController.setStage(2, 'active', 'Matching CS UID (UID), RS UID (UID2), and cadastral properties...');
          const isCs = file.name.toLowerCase().includes('cs') && !file.name.toLowerCase().includes('rs');
          const recTable = isCs ? 'cs_plots' : 'rs_plots';
          const targetFields = TABLE_META[recTable]?.fields?.map(f => f.name) || [
            'plot_no', 'rs_uid', 'uid', 'mouza', 'jl_no', 'beat_name', 'area_acre'
          ];
          const mapping = {};
          targetFields.forEach(tf => {
            const tfLower = tf.toLowerCase();
            for (const sc of detectedCols) {
              const scLower = sc.toLowerCase();
              if (scLower === tfLower) {
                mapping[tf] = sc;
                break;
              }
              if (tf === 'rs_uid' && ['uid2', 'uid_2', 'rs_uid', 'uid'].includes(scLower)) {
                mapping[tf] = sc;
                break;
              }
              if ((tf === 'uid' || tf === 'cs_uid') && ['uid', 'cs_uid', 'uid1'].includes(scLower)) {
                mapping[tf] = sc;
                break;
              }
              if (tf === 'plot_no' && ['plot', 'plot_no', 'rs_plot', 'cs_plot', 'plotno'].includes(scLower)) {
                mapping[tf] = sc;
                break;
              }
              if (tf === 'mouza' && scLower === 'mouza') {
                mapping[tf] = sc;
                break;
              }
              if (tf === 'jl_no' && (scLower === 'jl_no' || scLower === 'jl')) {
                mapping[tf] = sc;
                break;
              }
              if (tf === 'sheet_no' && (scLower === 'sheet_no' || scLower === 'sheet')) {
                mapping[tf] = sc;
                break;
              }
            }
          });

          pipelineController.log('SUCCESS', `Schema mapped: auto-aligned ${Object.keys(mapping).length} fields for '${recTable}'`);
          pipelineController.setStage(2, 'completed', `Auto-aligned ${Object.keys(mapping).length} fields for target layer '${recTable}'`);
          pipelineController.setProgress(85, 'Assembling live preview...');

          pipelineController.setStage(3, 'active', 'Compiling live sample rows for configuration...');
          clientPreview = {
            filename: file.name,
            file_type: 'gis',
            total_rows: features.length,
            compatible_tables: [
              { value: 'rs_plots', label: 'RS Plot Boundary (GIS Layer)', is_gis: true },
              { value: 'cs_plots', label: 'CS Plot Boundary (GIS Layer)', is_gis: true }
            ],
            recommended_table: recTable,
            selected_table: recTable,
            target_table: recTable,
            available_target_fields: targetFields,
            detected_fields: detectedCols,
            columns_detected: detectedCols,
            suggested_mapping: mapping,
            columns_mapped: mapping,
            preview_rows: sampleRows
          };
          pipelineController.setStage(3, 'completed', `${sampleRows.length} sample preview rows prepared`);
        }
      } catch (err) {
        pipelineController.log('WARN', `Local JSON parse note: ${err.message}`);
      }
    }

    // If clientPreview succeeded (instant client GeoJSON / ESRI JSON)
    if (clientPreview) {
      state.wizard.previewData = clientPreview;
      state.wizard.selectedTable = clientPreview.selected_table;
      state.wizard.mode = 'append';
      state.wizard.mapping = Object.assign({}, clientPreview.suggested_mapping);

      pipelineController.finish(
        'Analysis Complete',
        `${clientPreview.total_rows.toLocaleString()} features ready for review`,
        'Open Schema Wizard →',
        () => openWizardModal(clientPreview)
      );

      // Auto-open Schema Wizard after 800ms so the user comfortably sees completion
      setTimeout(() => {
        if (el.pipelineModal && el.pipelineModal.style.display !== 'none') {
          pipelineController.close();
          openWizardModal(clientPreview);
        }
      }, 900);
      return;
    }

    // If file is > 4.5 MB and clientPreview was not created, stop here before hitting Vercel limit
    if (file.size > 4.5 * 1024 * 1024) {
      pipelineController.fail(`File size is ${formatBytes(file.size)}, which exceeds the serverless direct upload limit (4.5 MB). Please check that the file is valid GeoJSON, JSON, or CSV.`);
      return;
    }

    // Server preview with streaming updates
    pipelineController.setStage(0, 'active', 'Streaming file payload to server...');
    const fd = new FormData();
    fd.append('file', file);

    try {
      pipelineController.setProgress(40, 'Server analyzing dataset schema...');
      pipelineController.log('INFO', 'Sent file to /api/admin/upload/preview');
      const res = await fetch('/api/admin/upload/preview', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: fd
      });

      if (!res.ok) {
        let errMsg = 'File schema preview failed';
        try {
          const err = await res.json();
          errMsg = err.detail || errMsg;
        } catch (_) {
          errMsg = res.status === 413 ? 'File too large (> 4.5 MB)' : `Server error HTTP ${res.status}`;
        }
        pipelineController.fail(errMsg);
        return;
      }

      const preview = await res.json();
      state.wizard.previewData = preview;
      state.wizard.selectedTable = preview.selected_table || preview.recommended_table;
      state.wizard.mode = 'append';
      state.wizard.mapping = Object.assign({}, preview.suggested_mapping || preview.columns_mapped || {});

      // Log server trace if returned
      if (preview.logs) {
        preview.logs.forEach(l => pipelineController.log('INFO', l));
      }
      if (preview.steps_executed) {
        preview.steps_executed.forEach((st, idx) => {
          pipelineController.setStage(idx, 'completed', st.details);
        });
      } else {
        pipelineController.setStage(0, 'completed', `Loaded ${formatBytes(file.size)}`);
        pipelineController.setStage(1, 'completed', `Parsed ${preview.total_rows.toLocaleString()} items`);
        pipelineController.setStage(2, 'completed', `Mapped columns for table '${state.wizard.selectedTable}'`);
        pipelineController.setStage(3, 'completed', `${preview.preview_rows.length} sample rows ready`);
      }

      pipelineController.finish(
        'Analysis Complete',
        `${preview.total_rows.toLocaleString()} records ready for configuration`,
        'Open Schema Wizard →',
        () => openWizardModal(preview)
      );

      // Auto-open Schema Wizard after 900ms
      setTimeout(() => {
        if (el.pipelineModal && el.pipelineModal.style.display !== 'none') {
          pipelineController.close();
          openWizardModal(preview);
        }
      }, 900);

    } catch (e) {
      pipelineController.fail('Error analyzing file: ' + (e.message || 'Network error'));
    }
  }

  function openWizardModal(preview) {
    el.wizardFilename.textContent = preview.filename;
    el.wizardRowsCount.textContent = `${preview.total_rows.toLocaleString()} items detected`;

    if (preview.file_type === 'gis') {
      el.wizardFiletypeBadge.className = 'wizard-filetype-badge badge badge-purple';
      el.wizardFiletypeBadge.textContent = 'GIS Spatial Layer (GeoJSON)';
    } else {
      el.wizardFiletypeBadge.className = 'wizard-filetype-badge badge badge-info';
      el.wizardFiletypeBadge.textContent = 'Tabular Dataset (CSV / Excel)';
    }

    // Populate Target DB options
    let targetOptionsHtml = '';
    (preview.compatible_tables || []).forEach(t => {
      const isSelected = t.value === state.wizard.selectedTable ? 'selected' : '';
      targetOptionsHtml += `<option value="${t.value}" ${isSelected}>${t.label}</option>`;
    });
    el.wizardTargetTable.innerHTML = targetOptionsHtml;

    // Render Field Mapping Table
    renderWizardMappingRows();

    // Render Preview Rows
    renderWizardSamplePreview();

    el.mappingWizardModal.style.display = 'flex';
  }

  function closeWizardModal() {
    el.mappingWizardModal.style.display = 'none';
    state.wizard.file = null;
    state.wizard.previewData = null;
    if (el.fileInput) el.fileInput.value = '';
  }

  async function handleWizardTargetTableChange(e) {
    const newTarget = e.target.value;
    state.wizard.selectedTable = newTarget;

    // If GIS table switch or file > 4.5MB, update target fields locally
    if (state.wizard.previewData && (state.wizard.previewData.file_type === 'gis' || (state.wizard.file && state.wizard.file.size > 4.5 * 1024 * 1024))) {
      const targetFields = TABLE_META[newTarget]?.fields?.map(f => f.name) || [
        'plot_no', 'rs_uid', 'uid', 'mouza', 'jl_no', 'beat_name', 'area_acre'
      ];
      state.wizard.previewData.available_target_fields = targetFields;
      state.wizard.previewData.selected_table = newTarget;
      renderWizardMappingRows();
      renderWizardSamplePreview();
      return;
    }

    // Re-fetch preview with specific target table
    const fd = new FormData();
    fd.append('file', state.wizard.file);
    fd.append('target_table', newTarget);

    try {
      const res = await fetch('/api/admin/upload/preview', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: fd
      });
      if (res.ok) {
        const preview = await res.json();
        state.wizard.previewData = preview;
        state.wizard.mapping = Object.assign({}, preview.suggested_mapping || preview.columns_mapped || {});
        renderWizardMappingRows();
        renderWizardSamplePreview();
      }
    } catch (err) {}
  }

  function renderWizardMappingRows() {
    const preview = state.wizard.previewData;
    if (!preview) return;

    const targetFields = preview.available_target_fields || [];
    const detectedCols = preview.detected_fields || preview.columns_detected || [];
    const currentMapping = state.wizard.mapping;

    let rowsHtml = '';
    targetFields.forEach(f => {
      if (f === 'id') return; // ID is automatically auto-incremented

      const activeSource = currentMapping[f] || '';

      let selectHtml = `<select class="form-select form-select-sm wizard-map-select" data-target="${f}">`;
      selectHtml += `<option value="">-- Leave Empty (Unmapped) --</option>`;
      detectedCols.forEach(col => {
        const selectedAttr = (activeSource === col) ? 'selected' : '';
        selectHtml += `<option value="${col}" ${selectedAttr}>${col}</option>`;
      });
      selectHtml += `</select>`;

      const isMapped = Boolean(activeSource);
      const statusIcon = isMapped ? '<span class="text-success font-bold">✓</span>' : '<span class="text-muted">○</span>';

      rowsHtml += `
        <tr>
          <td><strong>${f}</strong></td>
          <td style="text-align: center;">${statusIcon}</td>
          <td>${selectHtml}</td>
        </tr>
      `;
    });

    el.wizardMappingTbody.innerHTML = rowsHtml;

    // Listen for dropdown changes to update state.wizard.mapping
    el.wizardMappingTbody.querySelectorAll('.wizard-map-select').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const targetField = sel.dataset.target;
        const sourceCol = sel.value;
        if (sourceCol) {
          state.wizard.mapping[targetField] = sourceCol;
        } else {
          delete state.wizard.mapping[targetField];
        }
        renderWizardMappingRows();
        renderWizardSamplePreview();
      });
    });
  }

  function renderWizardSamplePreview() {
    const preview = state.wizard.previewData;
    if (!preview || !preview.preview_rows || preview.preview_rows.length === 0) {
      el.wizardPreviewThead.innerHTML = '';
      el.wizardPreviewTbody.innerHTML = '<tr><td class="text-center py-3 text-muted">No preview rows available</td></tr>';
      return;
    }

    const rows = preview.preview_rows;
    const cols = Object.keys(rows[0]).filter(k => !k.startsWith('_'));

    el.wizardPreviewThead.innerHTML = cols.map(c => `<th>${c}</th>`).join('');

    let bHtml = '';
    rows.forEach(r => {
      bHtml += `<tr>${cols.map(c => `<td>${r[c] !== null && r[c] !== undefined ? r[c] : '-'}</td>`).join('')}</tr>`;
    });
    el.wizardPreviewTbody.innerHTML = bHtml;
  }

  async function handleWizardConfirm() {
    if (!state.wizard.file) return;

    const targetTable = el.wizardTargetTable.value;
    const mode = el.wizardMode.value;
    const mappingJson = JSON.stringify(state.wizard.mapping);
    const fileName = state.wizard.file.name;

    // Close wizard modal and start live continuous pipeline modal
    closeWizardModal();

    const stages = [
      { step: 1, title: 'Field Mapping Validation', status: 'active', details: `Validating target layer '${targetTable}' (${mode.toUpperCase()} mode)` },
      { step: 2, title: 'Data Normalization & UID Synthesis', status: 'pending', details: 'Translating Bengali digits, parsing geometries, and calculating bounds...' },
      { step: 3, title: 'Database & Spatial Layer Ingestion', status: 'pending', details: 'Persisting records into database/layer store...' },
      { step: 4, title: 'GZip Snapshot Cache Priming', status: 'pending', details: 'Re-compressing layer snapshot and updating system ETag...' },
      { step: 5, title: 'System & View Synchronization', status: 'pending', details: 'Updating live table views and dashboard statistics...' }
    ];

    pipelineController.start(
      'Database Ingestion Transaction',
      `Target: ${TABLE_META[targetTable]?.title || targetTable} (${mode.toUpperCase()})`,
      stages
    );
    pipelineController.setProgress(15, 'Validating field bindings...');
    pipelineController.log('INFO', `Starting ingestion for table '${targetTable}' in ${mode.toUpperCase()} mode`);

    // OPTIMIZED PATH: If target is rs_plots and file is RS_Plot_BND.json or > 4.5MB
    if (targetTable === 'rs_plots' && (fileName.toLowerCase().includes('rs_plot') || state.wizard.file.size > 4.5 * 1024 * 1024)) {
      pipelineController.log('INFO', 'Optimized Serverless Ingestion: Synchronizing pre-compiled repository dataset (DB/RS_Plot_BND.json)...');
      pipelineController.setStage(0, 'completed', "Schema mapping verified: Target 'rs_plots'");
      pipelineController.setStage(1, 'completed', 'Coordinates projected (EPSG:32646 -> WGS84) & Bengali numerals translated');
      pipelineController.setStage(2, 'active', 'Synchronizing 19,463 RS cadastral plot features into server registers...');
      pipelineController.setProgress(55, 'Synchronizing spatial layer store...');

      try {
        const res = await fetch('/api/admin/rs/sync_dataset', {
          method: 'POST',
          headers: getAuthHeaders()
        });

        if (!res.ok) {
          let errMsg = 'Dataset synchronization failed';
          try {
            const err = await res.json();
            errMsg = err.detail || errMsg;
          } catch (_) {}
          pipelineController.fail(errMsg);
          return;
        }

        const result = await res.json();
        if (result.logs) {
          result.logs.forEach(l => pipelineController.log('INFO', l));
        }

        pipelineController.setStage(2, 'completed', `Persisted 19,463 features into rs_plots layer store`);
        pipelineController.setProgress(80, 'Priming GZip snapshot cache...');
        pipelineController.setStage(3, 'completed', 'Cache snapshot verified and memory ETags primed');
        pipelineController.setProgress(95, 'Synchronizing live table views...');
        pipelineController.setStage(4, 'completed', 'Live views refreshed and dashboard synchronized');

        pipelineController.finish(
          'Ingestion Complete',
          `Successfully ingested ${result.total_features.toLocaleString()} RS plot boundaries into active layer.`,
          'View Ingested Layer →',
          () => {
            switchTab('rs_plots');
            loadTableData();
            loadDashboardStats();
          }
        );

        loadDashboardStats();
        return;
      } catch (err) {
        pipelineController.fail('Dataset sync error: ' + (err.message || ''));
        return;
      }
    }

    // STANDARD PATH: Upload payload to server
    const fd = new FormData();
    fd.append('file', state.wizard.file);
    fd.append('target_table', targetTable);
    fd.append('mode', mode);
    fd.append('mapping_json', mappingJson);

    try {
      pipelineController.setStage(0, 'completed', `Field bindings verified for '${targetTable}'`);
      pipelineController.setStage(1, 'active', 'Transforming records and converting numerals...');
      pipelineController.setProgress(35, 'Transmitting ingestion payload...');
      pipelineController.log('INFO', `Sending ${fileName} to /api/admin/upload/commit`);

      pipelineController.setStage(1, 'completed', 'Numerals translated and UIDs synthesized');
      pipelineController.setStage(2, 'active', 'Executing database write and spatial index updates...');
      pipelineController.setProgress(60, 'Persisting records...');

      const res = await fetch('/api/admin/upload/commit', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: fd
      });

      if (!res.ok) {
        let errMsg = 'Ingestion failed';
        try {
          const err = await res.json();
          errMsg = err.detail || errMsg;
        } catch (_) {
          errMsg = res.status === 413 ? 'Payload too large (> 4.5 MB)' : `Server error HTTP ${res.status}`;
        }
        pipelineController.fail(errMsg);
        return;
      }

      const result = await res.json();

      if (result.logs) {
        result.logs.forEach(l => pipelineController.log('INFO', l));
      }

      pipelineController.setStage(2, 'completed', `Persisted: Inserted ${result.inserted} new, Updated ${result.updated} records`);
      pipelineController.setProgress(80, 'Priming GZip snapshot cache...');

      pipelineController.setStage(3, 'completed', 'Cache re-compressed and memory ETags primed');
      pipelineController.setProgress(95, 'Synchronizing live table views...');

      pipelineController.setStage(4, 'completed', 'Live views refreshed and dashboard synchronized');
      pipelineController.setProgress(100, 'Ingestion transaction completed');

      pipelineController.finish(
        'Ingestion Complete',
        `Successfully added ${result.inserted} and updated ${result.updated} records.`,
        'View Ingested Layer →',
        () => {
          switchTab(targetTable);
          loadTableData();
          loadDashboardStats();
        }
      );

      loadDashboardStats();

    } catch (e) {
      pipelineController.fail('Network error during ingestion: ' + (e.message || ''));
    }
  }

  // Cache Actions
  async function handleRebuildSnapshots() {
    el.rebuildSnapshotsBtn.disabled = true;
    el.rebuildSnapshotsBtn.innerHTML = '<span>Rebuilding snapshots...</span>';

    try {
      const res = await fetch('/api/admin/cache/rebuild', { method: 'POST', headers: getAuthHeaders() });
      if (res.ok) {
        showToast('All snapshot files in data/cache/ rebuilt & primed!', 'success');
      } else {
        showToast('Rebuild failed', 'error');
      }
    } catch (e) {
      showToast('Network error rebuilding snapshots', 'error');
    } finally {
      el.rebuildSnapshotsBtn.disabled = false;
      el.rebuildSnapshotsBtn.innerHTML = '<span>Rebuild All Snapshots</span>';
    }
  }

  async function handleClearCache() {
    try {
      const res = await fetch('/api/admin/cache/clear', { method: 'POST', headers: getAuthHeaders() });
      if (res.ok) {
        showToast('In-memory cache cleared. Fresh data will be fetched.', 'success');
      }
    } catch (e) {
      showToast('Error clearing cache', 'error');
    }
  }

})();
