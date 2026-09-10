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
  currentPlotId: null,

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
    const pi = data.parcel_info;

    this.currentPlotId = p.id;

    // Remove "CS Cadastral Parcel" text from the title
    if (this.badge) this.badge.style.display = 'none';

    // Remain # in title
    if (this.title) this.title.textContent = `Plot #${p.plot_no} ${p.mouza ? '• ' + p.mouza : ''}`;

    const areaFormatted = p.area_acre != null 
      ? Number(p.area_acre).toFixed(2) + ' Ac' 
      : '0.00 Ac';

    let fdAreaFormatted = '0.00 Ac';
    let othersAreaFormatted = '0.00 Ac';

    if (pi && pi.has_record) {
      if (pi.total_area_fd != null) {
        fdAreaFormatted = Number(pi.total_area_fd).toFixed(2) + ' Ac';
      }
      if (pi.total_area_others != null) {
        othersAreaFormatted = Number(pi.total_area_others).toFixed(2) + ' Ac';
      }
    } else if (data.loadingParcelInfo) {
      fdAreaFormatted = `<span style="font-size: 12px; color: #94a3b8;"><i class="fa-solid fa-spinner fa-spin"></i></span>`;
      othersAreaFormatted = `<span style="font-size: 12px; color: #94a3b8;"><i class="fa-solid fa-spinner fa-spin"></i></span>`;
    }

    const effectiveBeat = p.beat_name || (pi && pi.beat_name);
    const effectiveRange = pi && pi.range;

    const beatDisplay = effectiveBeat 
      ? `<span style="color: #34d399; font-weight: 700;"><i class="fa-solid fa-tree" style="margin-right: 6px;"></i>${effectiveBeat}</span>`
      : `<span style="color: #94a3b8; font-style: italic; font-size: 11px;"><i class="fa-solid fa-tree" style="color: #64748b; margin-right: 6px;"></i>Not in current survey register</span>`;

    const rangeDisplay = effectiveRange
      ? `<span style="color: #38bdf8; font-weight: 600;"><i class="fa-solid fa-mountain-sun" style="margin-right: 6px;"></i>${effectiveRange}</span>`
      : (data.loadingParcelInfo
          ? `<span style="color: #94a3b8; font-size: 11px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</span>`
          : `<span style="color: #94a3b8; font-style: italic; font-size: 11px;"><i class="fa-solid fa-mountain-sun" style="color: #64748b; margin-right: 6px;"></i>Not in current survey register</span>`);

    // RS Plots Details Table Section (with Legal Status as last column)
    let rsDetailsHtml = '';
    if (pi && pi.linked_rs_plots && pi.linked_rs_plots.length > 0) {
      const rsRows = pi.linked_rs_plots.map(r => {
        const rowBadge = (r.legal_status || '').includes('20') ? 'sec20' : ((r.legal_status || '').includes('6') ? 'sec6' : 'general');
        const fdStr = r.area_fd != null ? Number(r.area_fd).toFixed(2) : '-';
        const othersStr = r.area_others != null ? Number(r.area_others).toFixed(2) : '-';
        return `
          <tr>
            <td class="mono" style="font-weight: 700; color: #38bdf8;">${r.rs_plot_no || 'N/A'}</td>
            <td class="mono" style="font-size: 11px;">${r.khatian_no || '-'}</td>
            <td class="mono" style="text-align: right; color: #34d399; font-weight: 600;">${fdStr}</td>
            <td class="mono" style="text-align: right; color: #94a3b8;">${othersStr}</td>
            <td style="text-align: center;"><span class="badge-stat ${rowBadge}" style="font-size: 9.5px; padding: 2px 6px;">${r.legal_status || 'N/A'}</span></td>
          </tr>
        `;
      }).join('');

      rsDetailsHtml = `
        <!-- RS Plots Details -->
        <div class="dossier-card">
          <div class="dossier-card-title">
            <span><i class="fa-solid fa-diagram-project"></i> RS Plots Details</span>
            <span class="badge-stat general">${pi.linked_rs_plots.length} RS Plot${pi.linked_rs_plots.length > 1 ? 's' : ''}</span>
          </div>
          <div style="overflow-x: auto; max-height: 240px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.05);">
            <table class="data-table">
              <thead>
                <tr>
                  <th>RS Plot No</th>
                  <th>Khatian</th>
                  <th style="text-align: right;">FD Area</th>
                  <th style="text-align: right;">Others</th>
                  <th style="text-align: center;">Legal Status</th>
                </tr>
              </thead>
              <tbody>
                ${rsRows}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    let html = `
      <!-- Parcel Identification Card -->
      <div class="dossier-card">
        <div class="dossier-card-title">
          <span><i class="fa-solid fa-map-location-dot"></i> Parcel Identification</span>
        </div>
        <div class="dossier-grid">
          <div class="dossier-prop">
            <span class="prop-label">Plot Number</span>
            <span class="prop-val mono" style="font-size: 16px; font-weight: 700; color: #38bdf8;">
              ${p.plot_no || 'N/A'}
            </span>
          </div>

          <div class="dossier-prop">
            <span class="prop-label">Total Area</span>
            <span class="prop-val mono" style="font-size: 16px; font-weight: 700; color: #34d399;">
              ${areaFormatted}
            </span>
          </div>

          <div class="dossier-prop">
            <span class="prop-label">FD Owned Area</span>
            <span class="prop-val mono" style="font-size: 15px; font-weight: 700; color: #34d399;">
              ${fdAreaFormatted}
            </span>
          </div>

          <div class="dossier-prop">
            <span class="prop-label">Other / Private Area</span>
            <span class="prop-val mono" style="font-size: 15px; font-weight: 600; color: #cbd5e1;">
              ${othersAreaFormatted}
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
            <span class="prop-label">Forest Range</span>
            <span class="prop-val">
              ${rangeDisplay}
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

      ${rsDetailsHtml}

      <!-- Quick Actions -->
      <div style="display: flex; gap: 10px; margin-top: 10px;">
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

    if (this.badge) this.badge.style.display = 'none';
    if (this.title) this.title.textContent = `Plot #${p.plot_no} ${p.mouza ? '• ' + p.mouza : ''}`;

    const areaFormatted = p.area_acre != null 
      ? Number(p.area_acre).toFixed(2) + ' Ac' 
      : '0.00 Ac';

    const beatDisplay = p.beat_name 
      ? `<span style="color: #34d399; font-weight: 700;"><i class="fa-solid fa-tree" style="margin-right: 6px;"></i>${p.beat_name}</span>`
      : `<span style="color: #94a3b8; font-style: italic; font-size: 11px;"><i class="fa-solid fa-tree" style="color: #64748b; margin-right: 6px;"></i>Pending separate dataset</span>`;

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
              ${p.plot_no || 'N/A'}
            </span>
          </div>

          <div class="dossier-prop">
            <span class="prop-label">Total Area</span>
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

      <!-- Quick Actions -->
      <div style="display: flex; gap: 10px; margin-top: 10px;">
        <button class="btn btn-outline" style="flex: 1;" onclick="window.print()">
          <i class="fa-solid fa-print"></i> Print Details
        </button>
      </div>
    `;

    if (this.content) this.content.innerHTML = html;
    this.open();
  }
};
