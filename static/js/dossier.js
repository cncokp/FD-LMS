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
      fdAreaFormatted = `<span style="font-size: 11px; color: #64748b;"><i class="fa-solid fa-spinner fa-spin"></i></span>`;
      othersAreaFormatted = `<span style="font-size: 11px; color: #64748b;"><i class="fa-solid fa-spinner fa-spin"></i></span>`;
    }

    const effectiveBeat = p.beat_name || (pi && pi.beat_name);
    const effectiveRange = pi && pi.range;

    const beatDisplay = effectiveBeat 
      ? `<i class="fa-solid fa-tree" style="color: #94a3b8; font-size: 11px; margin-right: 6px;"></i><span style="color: #e2e8f0; font-weight: 500;">${effectiveBeat}</span>`
      : `<span style="color: #64748b; font-style: italic; font-size: 11px;"><i class="fa-solid fa-tree" style="color: #64748b; font-size: 11px; margin-right: 6px;"></i>Not in current survey register</span>`;

    const rangeDisplay = effectiveRange
      ? `<i class="fa-solid fa-mountain-sun" style="color: #94a3b8; font-size: 11px; margin-right: 6px;"></i><span style="color: #e2e8f0; font-weight: 500;">${effectiveRange}</span>`
      : (data.loadingParcelInfo
          ? `<span style="color: #64748b; font-size: 11px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</span>`
          : `<span style="color: #64748b; font-style: italic; font-size: 11px;"><i class="fa-solid fa-mountain-sun" style="color: #64748b; font-size: 11px; margin-right: 6px;"></i>Not in current survey register</span>`);

    // RS Plots Details Table Section (with Legal Status as last column)
    let rsDetailsHtml = '';
    if (pi && pi.linked_rs_plots && pi.linked_rs_plots.length > 0) {
      const rsRows = pi.linked_rs_plots.map(r => {
        const fdStr = r.area_fd != null ? Number(r.area_fd).toFixed(2) : '-';
        const othersStr = r.area_others != null ? Number(r.area_others).toFixed(2) : '-';
        return `
          <tr>
            <td class="mono" style="color: #f8fafc; font-weight: 500;">${r.rs_plot_no || 'N/A'}</td>
            <td class="mono" style="color: #94a3b8; font-size: 11px;">${r.khatian_no || '-'}</td>
            <td class="mono" style="text-align: right; color: #e2e8f0;">${fdStr}</td>
            <td class="mono" style="text-align: right; color: #94a3b8;">${othersStr}</td>
            <td style="text-align: right;"><span class="tag-muted">${r.legal_status || 'N/A'}</span></td>
          </tr>
        `;
      }).join('');

      rsDetailsHtml = `
        <!-- RS Plots Details -->
        <div class="dossier-card">
          <div class="dossier-card-title">
            <span>RS Plots Details</span>
            <span style="font-size: 10.5px; color: #64748b; font-weight: 400; text-transform: none;">${pi.linked_rs_plots.length} linked</span>
          </div>
          <div style="overflow-x: auto; max-height: 230px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.04);">
            <table class="data-table">
              <thead>
                <tr>
                  <th>RS Plot</th>
                  <th>Khatian</th>
                  <th style="text-align: right;">FD Area</th>
                  <th style="text-align: right;">Others</th>
                  <th style="text-align: right;">Legal Status</th>
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
          <span>Parcel Identification</span>
        </div>
        <div class="dossier-grid">
          <div class="dossier-prop">
            <span class="prop-label">Plot Number</span>
            <span class="prop-val mono" style="font-size: 14px; font-weight: 600; color: #f8fafc;">
              ${p.plot_no || 'N/A'}
            </span>
          </div>

          <div class="dossier-prop">
            <span class="prop-label">Total Area</span>
            <span class="prop-val mono" style="font-size: 14px; font-weight: 600; color: #f8fafc;">
              ${areaFormatted}
            </span>
          </div>

          <div class="dossier-prop">
            <span class="prop-label">FD Owned Area</span>
            <span class="prop-val mono" style="font-size: 13px; color: #e2e8f0;">
              ${fdAreaFormatted}
            </span>
          </div>

          <div class="dossier-prop">
            <span class="prop-label">Other / Private Area</span>
            <span class="prop-val mono" style="font-size: 13px; color: #94a3b8;">
              ${othersAreaFormatted}
            </span>
          </div>

          <div class="dossier-prop">
            <span class="prop-label">Mouza</span>
            <span class="prop-val" style="font-size: 13px; color: #e2e8f0;">
              ${p.mouza || 'N/A'}
            </span>
          </div>

          <div class="dossier-prop">
            <span class="prop-label">JL No</span>
            <span class="prop-val mono" style="font-size: 13px; color: #94a3b8;">
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
      <div style="margin-top: 4px;">
        <button class="btn btn-outline" style="width: 100%; height: 30px; font-size: 11px; justify-content: center; gap: 6px; color: #94a3b8; border-color: rgba(255,255,255,0.08);" onclick="window.print()">
          <i class="fa-solid fa-print" style="font-size: 10.5px;"></i> Print Details
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
      ? `<i class="fa-solid fa-tree" style="color: #94a3b8; font-size: 11px; margin-right: 6px;"></i><span style="color: #e2e8f0; font-weight: 500;">${p.beat_name}</span>`
      : `<span style="color: #64748b; font-style: italic; font-size: 11px;"><i class="fa-solid fa-tree" style="color: #64748b; font-size: 11px; margin-right: 6px;"></i>Pending separate dataset</span>`;

    let html = `
      <!-- Parcel Identification Card -->
      <div class="dossier-card">
        <div class="dossier-card-title">
          <span>Parcel Identification</span>
        </div>
        <div class="dossier-grid">
          <div class="dossier-prop">
            <span class="prop-label">Plot Number</span>
            <span class="prop-val mono" style="font-size: 14px; font-weight: 600; color: #f8fafc;">
              ${p.plot_no || 'N/A'}
            </span>
          </div>

          <div class="dossier-prop">
            <span class="prop-label">Total Area</span>
            <span class="prop-val mono" style="font-size: 14px; font-weight: 600; color: #f8fafc;">
              ${areaFormatted}
            </span>
          </div>

          <div class="dossier-prop">
            <span class="prop-label">Mouza</span>
            <span class="prop-val" style="font-size: 13px; color: #e2e8f0;">
              ${p.mouza || 'N/A'}
            </span>
          </div>

          <div class="dossier-prop">
            <span class="prop-label">JL No</span>
            <span class="prop-val mono" style="font-size: 13px; color: #94a3b8;">
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
      <div style="margin-top: 4px;">
        <button class="btn btn-outline" style="width: 100%; height: 30px; font-size: 11px; justify-content: center; gap: 6px; color: #94a3b8; border-color: rgba(255,255,255,0.08);" onclick="window.print()">
          <i class="fa-solid fa-print" style="font-size: 10.5px;"></i> Print Details
        </button>
      </div>
    `;

    if (this.content) this.content.innerHTML = html;
    this.open();
  }
};
