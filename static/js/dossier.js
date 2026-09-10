/**
 * FD-LMS: Parcel Dossier & Inspector Component
 * Displays Plot Number, Mouza, JL No, Beat Name, and Area (Acre).
 * UID is used strictly in the backend and hidden from user-facing cards.
 */

const Dossier = {
  drawer: document.getElementById('dossierDrawer'),
  title: document.getElementById('dossierTitle'),
  badge: document.getElementById('dossierBadge'),
  content: document.getElementById('dossierContent'),

  open() {
    if (this.drawer) this.drawer.classList.remove('hidden');
  },

  close() {
    if (this.drawer) this.drawer.classList.add('hidden');
  },

  /**
   * Render CS Cadastral Plot Dossier
   */
  renderCSPlot(data) {
    const p = data.plot;
    const bounds = data.bounds || [];

    if (this.badge) this.badge.textContent = `CS CADASTRAL PARCEL`;
    if (this.title) this.title.textContent = `Plot #${p.plot_no} ${p.mouza ? '• ' + p.mouza : ''}`;

    const boundsText = bounds.length === 4 
      ? `[${bounds[1].toFixed(5)}, ${bounds[0].toFixed(5)}] to [${bounds[3].toFixed(5)}, ${bounds[2].toFixed(5)}]`
      : 'N/A';

    const areaFormatted = p.area_acre != null 
      ? Number(p.area_acre).toFixed(2) + ' Ac' 
      : '0.00 Ac';

    const beatDisplay = p.beat_name 
      ? p.beat_name 
      : `<span style="color: #94a3b8; font-style: italic; font-size: 11px;">Pending separate dataset</span>`;

    let html = `
      <!-- Parcel Identification Card -->
      <div class="dossier-card">
        <div class="dossier-card-title">
          <span><i class="fa-solid fa-map-location-dot"></i> Parcel Identification</span>
          <span class="badge-stat sec20">CS Survey</span>
        </div>
        <div class="dossier-grid">
          <div class="dossier-prop">
            <span class="prop-label">Plot Number</span>
            <span class="prop-val mono" style="font-size: 16px; font-weight: 700; color: #38bdf8;">
              #${p.plot_no || 'N/A'}
            </span>
          </div>

          <div class="dossier-prop">
            <span class="prop-label">Area (Acre)</span>
            <span class="prop-val mono" style="font-size: 16px; font-weight: 700; color: #34d399;">
              ${areaFormatted}
            </span>
          </div>

          <div class="dossier-prop">
            <span class="prop-label">Mouza</span>
            <span class="prop-val" style="font-weight: 600; color: #f1f5f9;">
              ${p.mouza || 'N/A'}
            </span>
          </div>

          <div class="dossier-prop">
            <span class="prop-label">JL No</span>
            <span class="prop-val mono" style="font-weight: 600;">
              ${p.jl_no || 'N/A'}
            </span>
          </div>

          <div class="dossier-prop" style="grid-column: 1 / -1;">
            <span class="prop-label">Beat Name</span>
            <span class="prop-val">
              ${beatDisplay}
            </span>
          </div>
        </div>
      </div>

      <!-- Spatial Coordinates -->
      <div class="dossier-card">
        <div class="dossier-card-title">
          <span><i class="fa-solid fa-location-crosshairs"></i> Spatial Bounding Box</span>
          <span class="prop-label">WGS84</span>
        </div>
        <div class="dossier-grid">
          <div class="dossier-prop" style="grid-column: 1 / -1;">
            <span class="prop-label">Bounding Extent</span>
            <span class="prop-val mono" style="font-size: 11px; word-break: break-all;">${boundsText}</span>
          </div>
        </div>
      </div>

      <!-- Quick Actions -->
      <div style="display: flex; gap: 10px; margin-top: 14px;">
        <button class="btn btn-outline" style="flex: 1;" onclick="window.print()">
          <i class="fa-solid fa-print"></i> Print Details
        </button>
      </div>
    `;

    if (this.content) this.content.innerHTML = html;
    this.open();
  },

  /**
   * Render RS Cadastral Plot Dossier
   */
  renderPlot(data) {
    const p = data.plot;
    const bounds = data.bounds || [];

    if (this.badge) this.badge.textContent = `RS CADASTRAL PARCEL`;
    if (this.title) this.title.textContent = `Plot #${p.plot_no} ${p.mouza ? '• ' + p.mouza : ''}`;

    const boundsText = bounds.length === 4 
      ? `[${bounds[1].toFixed(5)}, ${bounds[0].toFixed(5)}] to [${bounds[3].toFixed(5)}, ${bounds[2].toFixed(5)}]`
      : 'N/A';

    const areaFormatted = p.area_acre != null 
      ? Number(p.area_acre).toFixed(2) + ' Ac' 
      : '0.00 Ac';

    const beatDisplay = p.beat_name 
      ? p.beat_name 
      : `<span style="color: #94a3b8; font-style: italic; font-size: 11px;">Pending separate dataset</span>`;

    let html = `
      <!-- Parcel Identification Card -->
      <div class="dossier-card">
        <div class="dossier-card-title">
          <span><i class="fa-solid fa-map-location-dot"></i> Parcel Identification</span>
          <span class="badge-stat general">RS Survey</span>
        </div>
        <div class="dossier-grid">
          <div class="dossier-prop">
            <span class="prop-label">Plot Number</span>
            <span class="prop-val mono" style="font-size: 16px; font-weight: 700; color: #38bdf8;">
              #${p.plot_no || 'N/A'}
            </span>
          </div>

          <div class="dossier-prop">
            <span class="prop-label">Area (Acre)</span>
            <span class="prop-val mono" style="font-size: 16px; font-weight: 700; color: #34d399;">
              ${areaFormatted}
            </span>
          </div>

          <div class="dossier-prop">
            <span class="prop-label">Mouza</span>
            <span class="prop-val" style="font-weight: 600; color: #f1f5f9;">
              ${p.mouza || 'N/A'}
            </span>
          </div>

          <div class="dossier-prop">
            <span class="prop-label">JL No</span>
            <span class="prop-val mono" style="font-weight: 600;">
              ${p.jl_no || 'N/A'}
            </span>
          </div>

          <div class="dossier-prop" style="grid-column: 1 / -1;">
            <span class="prop-label">Beat Name</span>
            <span class="prop-val">
              ${beatDisplay}
            </span>
          </div>
        </div>
      </div>

      <!-- Spatial Coordinates -->
      <div class="dossier-card">
        <div class="dossier-card-title">
          <span><i class="fa-solid fa-location-crosshairs"></i> Spatial Bounding Box</span>
          <span class="prop-label">WGS84</span>
        </div>
        <div class="dossier-grid">
          <div class="dossier-prop" style="grid-column: 1 / -1;">
            <span class="prop-label">Bounding Extent</span>
            <span class="prop-val mono" style="font-size: 11px; word-break: break-all;">${boundsText}</span>
          </div>
        </div>
      </div>

      <!-- Quick Actions -->
      <div style="display: flex; gap: 10px; margin-top: 14px;">
        <button class="btn btn-outline" style="flex: 1;" onclick="window.print()">
          <i class="fa-solid fa-print"></i> Print Details
        </button>
      </div>
    `;

    if (this.content) this.content.innerHTML = html;
    this.open();
  }
};
