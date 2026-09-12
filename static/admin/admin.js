/**
 * FD-LMS Admin Portal Single Page Application Logic
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
    upload: {
      file: null,
      targetTable: 'parcel_info',
      mode: 'append',
      preview: null
    },
    pendingDelete: null,
    editingRecordId: null
  };

  // Table Configuration Metadata
  const TABLE_META = {
    parcel_info: {
      title: 'Parcels & Legal Status',
      subtitle: 'Official record of CS & RS plots, Forest Department areas, Khatians, and Gazette legal status',
      fields: [
        { name: 'cs_plot_no', label: 'CS Plot No', type: 'text', required: true },
        { name: 'rs_plot_no', label: 'RS Plot No', type: 'text' },
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
      title: 'Encroachment Cases',
      subtitle: 'Documented illegal occupations, unauthorized structures, and eviction actions taken',
      fields: [
        { name: 'encroacher_name', label: 'Encroacher Name & Address', type: 'text', required: true },
        { name: 'cs_plot_no', label: 'CS Plot No', type: 'text', required: true },
        { name: 'rs_plot_no', label: 'RS Plot No', type: 'text' },
        { name: 'encroached_area_acre', label: 'Encroached Area (Acres)', type: 'number', step: '0.0001', required: true },
        { name: 'structure_type', label: 'Structure / Land Use Type', type: 'text' },
        { name: 'action_taken', label: 'Action Taken / Legal Case', type: 'text' },
        { name: 'rs_khatian', label: 'RS Khatian', type: 'text' },
        { name: 'sec_20', label: 'Sec 20 Status', type: 'text' },
        { name: 'sec_6', label: 'Sec 6 Status', type: 'text' }
      ]
    },
    cs_plots: {
      title: 'Cadastral CS Plots',
      subtitle: 'GIS polygon boundary records and spatial metadata',
      fields: [
        { name: 'plot_no', label: 'Plot No', type: 'text', required: true },
        { name: 'mouza', label: 'Mouza', type: 'text', required: true },
        { name: 'jl_no', label: 'JL No', type: 'text' },
        { name: 'beat_name', label: 'Beat Name', type: 'text', required: true },
        { name: 'area_acre', label: 'Calculated Area (Acres)', type: 'number', step: '0.0001' },
        { name: 'uid', label: 'Unique Identifier (UID)', type: 'text' }
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
    beatDistributionList: document.getElementById('beat-distribution-list'),
    refreshStatsBtn: document.getElementById('refresh-stats-btn'),

    // Table view
    tableViewTitle: document.getElementById('table-view-title'),
    tableViewSubtitle: document.getElementById('table-view-subtitle'),
    tableAddBtn: document.getElementById('table-add-btn'),
    tableSearchInput: document.getElementById('table-search-input'),
    tableBeatFilter: document.getElementById('table-beat-filter'),
    tableMouzaFilter: document.getElementById('table-mouza-filter'),
    tablePageSizeFilter: document.getElementById('table-pagesize-filter'),
    tableHeaderRow: document.getElementById('table-header-row'),
    tableBody: document.getElementById('table-body'),
    paginationInfo: document.getElementById('pagination-info'),
    pageCurrentIndicator: document.getElementById('page-current-indicator'),
    pagePrevBtn: document.getElementById('page-prev-btn'),
    pageNextBtn: document.getElementById('page-next-btn'),

    // Uploader
    uploadTargetTable: document.getElementById('upload-target-table'),
    uploadMode: document.getElementById('upload-mode'),
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('file-input'),
    selectedFileBadge: document.getElementById('selected-file-badge'),
    previewUploadBtn: document.getElementById('preview-upload-btn'),
    uploadPreviewCard: document.getElementById('upload-preview-card'),
    mappingBadges: document.getElementById('mapping-badges'),
    previewTableHeader: document.getElementById('preview-table-header'),
    previewTableBody: document.getElementById('preview-table-body'),
    previewSummaryBadge: document.getElementById('preview-summary-badge'),
    cancelUploadBtn: document.getElementById('cancel-upload-btn'),
    commitUploadBtn: document.getElementById('commit-upload-btn'),

    // Cache
    rebuildSnapshotsBtn: document.getElementById('rebuild-snapshots-btn'),
    clearCacheBtn: document.getElementById('clear-cache-btn'),

    // Modals
    recordModal: document.getElementById('record-modal'),
    recordModalTitle: document.getElementById('record-modal-title'),
    recordForm: document.getElementById('record-form'),
    modalFormFields: document.getElementById('modal-form-fields'),
    modalCloseBtn: document.getElementById('modal-close-btn'),
    modalCancelBtn: document.getElementById('modal-cancel-btn'),

    deleteModal: document.getElementById('delete-modal'),
    deleteModalCloseBtn: document.getElementById('delete-modal-close-btn'),
    deleteCancelBtn: document.getElementById('delete-cancel-btn'),
    deleteConfirmBtn: document.getElementById('delete-confirm-btn'),
    deleteRecordDesc: document.getElementById('delete-record-desc'),

    toastContainer: document.getElementById('toast-container')
  };

  // Initialize
  init();

  function init() {
    applyTheme(state.theme);
    bindEvents();
    checkAuth();
  }

  // Event Listeners
  function bindEvents() {
    // Theme Switcher
    el.themeToggleBtn.addEventListener('click', () => {
      const nextTheme = state.theme === 'light' ? 'dark' : 'light';
      applyTheme(nextTheme);
    });

    // Sidebar Toggle
    el.sidebarToggle.addEventListener('click', () => {
      el.sidebar.classList.toggle('collapsed');
    });

    // Navigation Tabs
    el.navItems.forEach(item => {
      item.addEventListener('click', () => {
        const tab = item.dataset.tab;
        switchTab(tab);
      });
    });

    // Quick action tiles
    document.querySelectorAll('.action-tile').forEach(tile => {
      tile.addEventListener('click', () => {
        const jump = tile.dataset.jump;
        const action = tile.dataset.action;
        switchTab(jump);
        if (action === 'add') {
          setTimeout(openAddRecordModal, 150);
        }
      });
    });

    // Login & Logout
    el.loginForm.addEventListener('submit', handleLogin);
    el.logoutBtn.addEventListener('click', handleLogout);

    // Refresh Dashboard Stats
    el.refreshStatsBtn.addEventListener('click', loadDashboardStats);

    // Table Filters & Search
    let searchTimeout = null;
    el.tableSearchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        state.table.search = el.tableSearchInput.value.trim();
        state.table.page = 1;
        loadTableData();
      }, 300);
    });

    el.tableBeatFilter.addEventListener('change', () => {
      state.table.beat = el.tableBeatFilter.value;
      state.table.page = 1;
      loadTableData();
    });

    el.tableMouzaFilter.addEventListener('change', () => {
      state.table.mouza = el.tableMouzaFilter.value;
      state.table.page = 1;
      loadTableData();
    });

    el.tablePageSizeFilter.addEventListener('change', () => {
      state.table.pageSize = parseInt(el.tablePageSizeFilter.value, 10);
      state.table.page = 1;
      loadTableData();
    });

    el.pagePrevBtn.addEventListener('click', () => {
      if (state.table.page > 1) {
        state.table.page--;
        loadTableData();
      }
    });

    el.pageNextBtn.addEventListener('click', () => {
      if (state.table.page < state.table.totalPages) {
        state.table.page++;
        loadTableData();
      }
    });

    el.tableAddBtn.addEventListener('click', openAddRecordModal);

    // Record Modal Events
    el.modalCloseBtn.addEventListener('click', closeRecordModal);
    el.modalCancelBtn.addEventListener('click', closeRecordModal);
    el.recordForm.addEventListener('submit', handleSaveRecord);

    // Delete Modal Events
    el.deleteModalCloseBtn.addEventListener('click', closeDeleteModal);
    el.deleteCancelBtn.addEventListener('click', closeDeleteModal);
    el.deleteConfirmBtn.addEventListener('click', handleConfirmDelete);

    // Uploader Events
    el.dropzone.addEventListener('click', () => el.fileInput.click());
    el.fileInput.addEventListener('change', handleFileSelect);

    el.dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      el.dropzone.classList.add('drag-over');
    });

    el.dropzone.addEventListener('dragleave', () => {
      el.dropzone.classList.remove('drag-over');
    });

    el.dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      el.dropzone.classList.remove('drag-over');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        processSelectedFile(e.dataTransfer.files[0]);
      }
    });

    el.previewUploadBtn.addEventListener('click', handlePreviewUpload);
    el.cancelUploadBtn.addEventListener('click', resetUploader);
    el.commitUploadBtn.addEventListener('click', handleCommitUpload);

    // Cache Events
    el.rebuildSnapshotsBtn.addEventListener('click', handleRebuildSnapshots);
    el.clearCacheBtn.addEventListener('click', handleClearCache);
  }

  // Theme Management
  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('fd_theme', theme);
    el.themeIcon.textContent = theme === 'light' ? '🌙' : '☀️';
  }

  // Toast Notifications
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <div class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</div>
      <div class="toast-msg">${message}</div>
    `;
    el.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // Navigation & Tabs
  function switchTab(tabName) {
    state.activeTab = tabName;

    // Update active nav button
    el.navItems.forEach(item => {
      item.classList.toggle('active', item.dataset.tab === tabName);
    });

    // Handle generic table tabs vs standalone tabs
    if (tabName in TABLE_META) {
      state.activeTable = tabName;
      el.tabPanes.forEach(pane => pane.classList.remove('active'));
      document.getElementById('tab-table-view').classList.add('active');

      const meta = TABLE_META[tabName];
      el.tableViewTitle.textContent = meta.title;
      el.tableViewSubtitle.textContent = meta.subtitle;

      // Reset filters & page
      state.table.page = 1;
      state.table.search = '';
      el.tableSearchInput.value = '';
      loadTableData();
    } else {
      el.tabPanes.forEach(pane => {
        pane.classList.toggle('active', pane.id === `tab-${tabName}`);
      });

      if (tabName === 'dashboard') {
        loadDashboardStats();
      }
    }
  }

  // Authentication
  async function checkAuth() {
    try {
      const res = await fetch('/api/admin/me');
      if (res.ok) {
        const data = await res.json();
        setAuthenticated(data.username);
      } else {
        setUnauthenticated();
      }
    } catch (e) {
      setUnauthenticated();
    }
  }

  function setAuthenticated(username) {
    state.user = username;
    el.displayUsername.textContent = username;
    el.loginOverlay.style.display = 'none';
    el.adminShell.style.display = 'flex';

    loadFilters();
    loadDashboardStats();
  }

  function setUnauthenticated() {
    state.user = null;
    el.loginOverlay.style.display = 'flex';
    el.adminShell.style.display = 'none';
  }

  async function handleLogin(e) {
    e.preventDefault();
    el.loginError.style.display = 'none';
    el.loginBtn.disabled = true;

    const username = el.loginUsername.value.trim();
    const password = el.loginPassword.value.trim();

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (res.ok) {
        const data = await res.json();
        setAuthenticated(data.username);
        showToast('Successfully authenticated as Administrator', 'success');
      } else {
        const err = await res.json();
        el.loginError.textContent = err.detail || 'Invalid username or password';
        el.loginError.style.display = 'block';
      }
    } catch (e) {
      el.loginError.textContent = 'Network or server error during sign-in';
      el.loginError.style.display = 'block';
    } finally {
      el.loginBtn.disabled = false;
    }
  }

  async function handleLogout() {
    try {
      await fetch('/api/admin/logout', { method: 'POST' });
    } catch (e) {}
    setUnauthenticated();
    showToast('Signed out from Admin Portal', 'info');
  }

  // Dashboard Stats
  async function loadDashboardStats() {
    try {
      const res = await fetch('/api/admin/stats');
      if (!res.ok) return;
      const data = await res.json();

      el.statParcels.textContent = (data.total_parcels || 0).toLocaleString();
      el.statEncroachments.textContent = (data.total_encroachments || 0).toLocaleString();
      el.statEncroachedAcre.textContent = (data.total_encroached_acre || 0).toLocaleString() + ' ac';
      el.statPlots.textContent = (data.total_cs_plots || 0).toLocaleString();

      // Render Beat Distribution
      const dist = data.beat_distribution || {};
      const maxCount = Math.max(...Object.values(dist), 1);
      
      let html = '';
      for (const [beat, count] of Object.entries(dist)) {
        const pct = Math.round((count / maxCount) * 100);
        html += `
          <div class="beat-item">
            <span class="beat-item-name" title="${beat}">${beat}</span>
            <div class="beat-bar-wrapper">
              <div class="beat-bar-fill" style="width: ${pct}%"></div>
            </div>
            <span class="beat-item-count">${count.toLocaleString()}</span>
          </div>
        `;
      }
      el.beatDistributionList.innerHTML = html || '<div class="placeholder-text">No beat statistics available</div>';
    } catch (e) {
      console.error('Failed to load dashboard stats:', e);
    }
  }

  // Load Filter Options
  async function loadFilters() {
    try {
      const res = await fetch('/api/admin/filters');
      if (!res.ok) return;
      const data = await res.json();
      state.filterOptions = data;

      // Populate Beat Select
      el.tableBeatFilter.innerHTML = '<option value="">All Beats</option>';
      data.beats.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b;
        opt.textContent = b;
        el.tableBeatFilter.appendChild(opt);
      });

      // Populate Mouza Select
      el.tableMouzaFilter.innerHTML = '<option value="">All Mouzas</option>';
      data.mouzas.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        el.tableMouzaFilter.appendChild(opt);
      });
    } catch (e) {
      console.error('Failed to load filters:', e);
    }
  }

  // Table Data Loading
  async function loadTableData() {
    const table = state.activeTable;
    el.tableBody.innerHTML = '<tr><td colspan="10" class="text-center py-4">Loading table records...</td></tr>';

    const params = new URLSearchParams({
      page: state.table.page,
      page_size: state.table.pageSize,
      search: state.table.search,
      beat: state.table.beat,
      mouza: state.table.mouza,
      sort_by: state.table.sortBy,
      sort_dir: state.table.sortDir
    });

    try {
      const res = await fetch(`/api/admin/tables/${table}?${params.toString()}`);
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
    let headerHtml = '<th>ID</th>';
    meta.fields.forEach(f => {
      headerHtml += `<th>${f.label}</th>`;
    });
    headerHtml += '<th class="text-right">Actions</th>';
    el.tableHeaderRow.innerHTML = headerHtml;

    // Build Rows
    if (items.length === 0) {
      el.tableBody.innerHTML = `<tr><td colspan="${meta.fields.length + 2}" class="text-center py-4 text-muted">No records match current filter criteria</td></tr>`;
    } else {
      let bodyHtml = '';
      items.forEach(row => {
        bodyHtml += `<tr>`;
        bodyHtml += `<td><strong>${row.id}</strong></td>`;

        meta.fields.forEach(f => {
          let val = row[f.name];
          if (val === null || val === undefined || val === '') {
            val = '<span class="text-muted">-</span>';
          } else if (f.name === 'legal_status') {
            val = `<span class="badge badge-info">${val}</span>`;
          } else if (f.name === 'encroached_area_acre' || f.name === 'area_fd') {
            val = `<strong>${val}</strong> ac`;
          }
          bodyHtml += `<td>${val}</td>`;
        });

        bodyHtml += `
          <td class="text-right">
            <div class="table-actions-cell" style="justify-content: flex-end;">
              <button class="btn btn-outline btn-xs edit-row-btn" data-id="${row.id}">Edit</button>
              <button class="btn btn-danger btn-xs delete-row-btn" data-id="${row.id}">Delete</button>
            </div>
          </td>
        `;
        bodyHtml += `</tr>`;
      });
      el.tableBody.innerHTML = bodyHtml;

      // Attach row action handlers
      el.tableBody.querySelectorAll('.edit-row-btn').forEach(btn => {
        btn.addEventListener('click', () => openEditRecordModal(btn.dataset.id));
      });

      el.tableBody.querySelectorAll('.delete-row-btn').forEach(btn => {
        btn.addEventListener('click', () => openDeleteModal(btn.dataset.id));
      });
    }

    // Update Pagination UI
    const start = (state.table.page - 1) * state.table.pageSize + (items.length > 0 ? 1 : 0);
    const end = Math.min(start + items.length - 1, state.table.totalRecords);
    el.paginationInfo.textContent = `Showing ${start} - ${end} of ${state.table.totalRecords.toLocaleString()} records`;
    el.pageCurrentIndicator.textContent = `Page ${state.table.page} of ${state.table.totalPages}`;
    el.pagePrevBtn.disabled = state.table.page <= 1;
    el.pageNextBtn.disabled = state.table.page >= state.table.totalPages;
  }

  // Record Modal (Add / Edit)
  function openAddRecordModal() {
    state.editingRecordId = null;
    const meta = TABLE_META[state.activeTable];
    el.recordModalTitle.textContent = `Add New Record (${meta.title})`;
    renderModalFields({});
    el.recordModal.style.display = 'flex';
  }

  async function openEditRecordModal(recordId) {
    state.editingRecordId = recordId;
    const meta = TABLE_META[state.activeTable];
    el.recordModalTitle.textContent = `Edit Record #${recordId} (${meta.title})`;

    try {
      const res = await fetch(`/api/admin/tables/${state.activeTable}/${recordId}`);
      if (!res.ok) throw new Error('Failed to fetch record');
      const data = await res.json();
      renderModalFields(data);
      el.recordModal.style.display = 'flex';
    } catch (e) {
      showToast('Could not load record details', 'error');
    }
  }

  function renderModalFields(record) {
    const meta = TABLE_META[state.activeTable];
    let html = '';

    meta.fields.forEach(f => {
      const val = record[f.name] !== undefined && record[f.name] !== null ? record[f.name] : '';
      const stepAttr = f.step ? `step="${f.step}"` : '';
      const reqAttr = f.required ? 'required' : '';

      html += `
        <div class="form-group">
          <label for="field-${f.name}">${f.label} ${f.required ? '<span class="text-danger">*</span>' : ''}</label>
          <input type="${f.type}" id="field-${f.name}" name="${f.name}" value="${val}" class="form-input" ${stepAttr} ${reqAttr}>
        </div>
      `;
    });

    el.modalFormFields.innerHTML = html;
  }

  function closeRecordModal() {
    el.recordModal.style.display = 'none';
    state.editingRecordId = null;
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
        headers: { 'Content-Type': 'application/json' },
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
        method: 'DELETE'
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

  // File Upload & Ingestion
  function handleFileSelect(e) {
    if (e.target.files && e.target.files.length > 0) {
      processSelectedFile(e.target.files[0]);
    }
  }

  function processSelectedFile(file) {
    state.upload.file = file;
    el.selectedFileBadge.textContent = `📄 ${file.name} (${Math.round(file.size / 1024)} KB)`;
    el.selectedFileBadge.style.display = 'inline-flex';
    el.previewUploadBtn.disabled = false;
  }

  function resetUploader() {
    state.upload.file = null;
    state.upload.preview = null;
    el.fileInput.value = '';
    el.selectedFileBadge.style.display = 'none';
    el.previewUploadBtn.disabled = true;
    el.uploadPreviewCard.style.display = 'none';
  }

  async function handlePreviewUpload() {
    if (!state.upload.file) return;

    el.previewUploadBtn.disabled = true;
    const targetTable = el.uploadTargetTable.value;
    state.upload.targetTable = targetTable;
    state.upload.mode = el.uploadMode.value;

    const fd = new FormData();
    fd.append('file', state.upload.file);
    fd.append('target_table', targetTable);

    try {
      const res = await fetch('/api/admin/upload/preview', {
        method: 'POST',
        body: fd
      });

      if (!res.ok) {
        const err = await res.json();
        showToast(err.detail || 'Preview failed', 'error');
        el.previewUploadBtn.disabled = false;
        return;
      }

      const previewData = await res.json();
      state.upload.preview = previewData;
      renderUploadPreview(previewData);
    } catch (e) {
      showToast('Network error during file preview analysis', 'error');
    } finally {
      el.previewUploadBtn.disabled = false;
    }
  }

  function renderUploadPreview(data) {
    el.previewSummaryBadge.textContent = `${data.total_rows.toLocaleString()} rows detected`;

    // Render Mapping Badges
    let badgesHtml = '';
    for (const [col, field] of Object.entries(data.columns_mapped)) {
      badgesHtml += `<span class="map-badge map-badge-matched">✓ "${col}" &rarr; <strong>${field}</strong></span>`;
    }
    data.unmapped_columns.forEach(col => {
      badgesHtml += `<span class="map-badge map-badge-unmapped">⚠ "${col}" (unmapped)</span>`;
    });
    el.mappingBadges.innerHTML = badgesHtml;

    // Render Sample Preview Rows
    const previewRows = data.preview_rows || [];
    if (previewRows.length > 0) {
      const headers = Object.keys(previewRows[0]);
      el.previewTableHeader.innerHTML = headers.map(h => `<th>${h}</th>`).join('');
      
      let rowsHtml = '';
      previewRows.forEach(r => {
        rowsHtml += `<tr>${headers.map(h => `<td>${r[h] !== null && r[h] !== undefined ? r[h] : '-'}</td>`).join('')}</tr>`;
      });
      el.previewTableBody.innerHTML = rowsHtml;
    }

    el.uploadPreviewCard.style.display = 'block';
  }

  async function handleCommitUpload() {
    if (!state.upload.file) return;

    el.commitUploadBtn.disabled = true;
    const fd = new FormData();
    fd.append('file', state.upload.file);
    fd.append('target_table', state.upload.targetTable);
    fd.append('mode', state.upload.mode);

    try {
      const res = await fetch('/api/admin/upload/commit', {
        method: 'POST',
        body: fd
      });

      if (!res.ok) {
        const err = await res.json();
        showToast(err.detail || 'Upload ingestion failed', 'error');
        return;
      }

      const result = await res.json();
      showToast(`Ingestion complete! Inserted: ${result.inserted}, Updated: ${result.updated}`, 'success');
      resetUploader();
      loadDashboardStats();
    } catch (e) {
      showToast('Network error during ingestion commit', 'error');
    } finally {
      el.commitUploadBtn.disabled = false;
    }
  }

  // Cache Actions
  async function handleRebuildSnapshots() {
    el.rebuildSnapshotsBtn.disabled = true;
    el.rebuildSnapshotsBtn.innerHTML = '<span>Rebuilding snapshots...</span>';

    try {
      const res = await fetch('/api/admin/cache/rebuild', { method: 'POST' });
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
      const res = await fetch('/api/admin/cache/clear', { method: 'POST' });
      if (res.ok) {
        showToast('In-memory cache cleared. Fresh data will be fetched.', 'success');
      }
    } catch (e) {
      showToast('Error clearing cache', 'error');
    }
  }

})();
