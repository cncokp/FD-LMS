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
    const p = data.plot || {};
    const pi = data.parcel_info;

    this.currentPlotId = p.id;

    // Remove "CS Cadastral Parcel" text from the title
    if (this.badge) this.badge.style.display = 'none';

    // Prioritize Parcel Info DB for all attributes in Parcel Identification Card
    const displayPlotNo = (pi && pi.has_record && pi.cs_plot_no) ? pi.cs_plot_no : (p.plot_no || 'N/A');
    const displayMouza = (pi && pi.has_record && pi.mouza) ? pi.mouza : (p.mouza || 'N/A');
    const displayJl = (pi && pi.has_record && pi.cs_jl) ? pi.cs_jl : (p.jl_no || 'N/A');

    // Remain # in title
    if (this.title) {
      this.title.textContent = `Plot #${displayPlotNo} ${displayMouza && displayMouza !== 'N/A' ? '• ' + displayMouza : ''}`;
    }

    // Total Area & FD / Private Areas strictly from Parcel Info DB
    let areaFormatted = '0.00 Ac';
    let fdAreaFormatted = '0.00 Ac';
    let othersAreaFormatted = '0.00 Ac';

    if (pi && pi.has_record) {
      const totalAreaVal = pi.total_area != null ? pi.total_area : (pi.cs_land_acre != null ? pi.cs_land_acre : p.area_acre);
      areaFormatted = totalAreaVal != null ? Number(totalAreaVal).toFixed(2) + ' Ac' : '0.00 Ac';

      if (pi.total_area_fd != null) {
        fdAreaFormatted = Number(pi.total_area_fd).toFixed(2) + ' Ac';
      }
      if (pi.total_area_others != null) {
        othersAreaFormatted = Number(pi.total_area_others).toFixed(2) + ' Ac';
      }
    } else if (data.loadingParcelInfo) {
      areaFormatted = p.area_acre != null ? Number(p.area_acre).toFixed(2) + ' Ac' : '0.00 Ac';
      fdAreaFormatted = `<span style="font-size: 11px; color: #64748b;"><i class="fa-solid fa-spinner fa-spin"></i></span>`;
      othersAreaFormatted = `<span style="font-size: 11px; color: #64748b;"><i class="fa-solid fa-spinner fa-spin"></i></span>`;
    } else {
      areaFormatted = p.area_acre != null ? Number(p.area_acre).toFixed(2) + ' Ac' : '0.00 Ac';
    }

    const effectiveBeat = (pi && pi.has_record && pi.beat_name) ? pi.beat_name : (p.beat_name || (pi && pi.beat_name));
    const effectiveRange = pi && pi.range;

    const beatDisplay = effectiveBeat 
      ? `<i class="fa-solid fa-tree prop-icon"></i><span class="prop-highlight-beat">${effectiveBeat}</span>`
      : `<span class="prop-dim-italic"><i class="fa-solid fa-tree prop-icon"></i>Not in current survey register</span>`;

    const rangeDisplay = effectiveRange
      ? `<i class="fa-solid fa-mountain-sun prop-icon"></i><span class="prop-highlight-range">${effectiveRange}</span>`
      : (data.loadingParcelInfo
          ? `<span class="prop-dim"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</span>`
          : `<span class="prop-dim-italic"><i class="fa-solid fa-mountain-sun prop-icon"></i>Not in current survey register</span>`);

    // RS Plots Details Table Section (with Legal Status as last column)
    let rsDetailsHtml = '';
    if (pi && pi.linked_rs_plots && pi.linked_rs_plots.length > 0) {
      const rsRows = pi.linked_rs_plots.map(r => {
        const legal = r.legal_status || '';
        const badgeClass = legal.includes('20') ? 'sec20' : (legal.includes('6') ? 'sec6' : 'general');
        const fdStr = r.area_fd != null ? Number(r.area_fd).toFixed(2) : '-';
        const othersStr = r.area_others != null ? Number(r.area_others).toFixed(2) : '-';
        return `
          <tr>
            <td class="mono td-bold">${r.rs_plot_no || 'N/A'}</td>
            <td class="mono td-khatian">${r.khatian_no || '-'}</td>
            <td class="mono td-fd-area">${fdStr}</td>
            <td class="mono td-muted" style="text-align: right;">${othersStr}</td>
            <td style="text-align: right;"><span class="badge-stat ${badgeClass}">${legal || 'N/A'}</span></td>
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
          <div class="rs-table-container">
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

    // Encroachment Details Section
    const enc = data.encroachment;
    let encroachBanner = '';
    let encroachHtml = '';

    if (enc && enc.has_encroachment && enc.records && enc.records.length > 0) {
      encroachBanner = `
        <div class="encroach-banner">
          <i class="fa-solid fa-triangle-exclamation" style="color: #ef4444; font-size: 12px;"></i>
          <span>Encroached Land: <strong style="color: #fca5a5;">${enc.total_encroached_acre.toFixed(2)} Ac</strong> across <strong style="color: #fca5a5;">${enc.count} Cases</strong></span>
        </div>
      `;

      const encRows = enc.records.map(r => {
        const areaStr = r.encroached_area_acre != null ? Number(r.encroached_area_acre).toFixed(2) : '-';
        const rawAction = (r.action_taken || '').trim().replace(/\n/g, ' ');
        const actionDisplay = rawAction 
          ? `<span title="${rawAction.replace(/"/g, '&quot;')}">${rawAction.length > 28 ? rawAction.substring(0, 26) + '...' : rawAction}</span>`
          : '<span style="color: #64748b;">-</span>';
        const rawName = (r.encroacher_name || 'N/A').trim().replace(/\n/g, ' ');
        const nameDisplay = `<span title="${rawName.replace(/"/g, '&quot;')}">${rawName.length > 32 ? rawName.substring(0, 30) + '...' : rawName}</span>`;

        return `
          <tr>
            <td class="td-encroacher">${nameDisplay}</td>
            <td class="mono td-bold">${r.rs_plot_no || '-'}</td>
            <td class="mono td-khatian">${r.rs_khatian || '-'}</td>
            <td class="mono td-danger" style="text-align: right;">${areaStr}</td>
            <td class="td-structure">${r.structure_type || '-'}</td>
            <td class="td-action">${actionDisplay}</td>
          </tr>
        `;
      }).join('');

      encroachHtml = `
        <!-- Encroachment Details Card -->
        <div class="dossier-card card-encroach">
          <div class="dossier-card-title">
            <span style="display: flex; align-items: center; gap: 6px;">
              <i class="fa-solid fa-triangle-exclamation"></i>
              <span>Encroachment Details</span>
            </span>
            <span class="badge-stat-danger">${enc.count} Cases &bull; ${enc.total_encroached_acre.toFixed(2)} Ac</span>
          </div>
          <div class="rs-table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Encroacher Name & Address</th>
                  <th>RS Plot</th>
                  <th>Khatian</th>
                  <th style="text-align: right;">Area (Ac)</th>
                  <th>Structure</th>
                  <th>Action Taken</th>
                </tr>
              </thead>
              <tbody>
                ${encRows}
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
        ${encroachBanner}
        <div class="dossier-grid">
          <div class="dossier-prop">
            <span class="prop-label">Plot Number</span>
            <span class="prop-val mono prop-bold">
              ${displayPlotNo}
            </span>
          </div>

          <div class="dossier-prop">
            <span class="prop-label">Total Area</span>
            <span class="prop-val mono prop-bold">
              ${areaFormatted}
            </span>
          </div>

          <div class="dossier-prop">
            <span class="prop-label">FD Owned Area</span>
            <span class="prop-val mono prop-fd-area">
              ${fdAreaFormatted}
            </span>
          </div>

          <div class="dossier-prop">
            <span class="prop-label">Other / Private Area</span>
            <span class="prop-val mono prop-muted">
              ${othersAreaFormatted}
            </span>
          </div>

          <div class="dossier-prop">
            <span class="prop-label">Mouza</span>
            <span class="prop-val prop-bold">
              ${displayMouza}
            </span>
          </div>

          <div class="dossier-prop">
            <span class="prop-label">JL No</span>
            <span class="prop-val mono prop-muted">
              ${displayJl}
            </span>
          </div>

          <div class="dossier-prop">
            <span class="prop-label">Beat Name</span>
            <span class="prop-val">
              ${beatDisplay}
            </span>
          </div>

          <div class="dossier-prop">
            <span class="prop-label">Forest Range</span>
            <span class="prop-val">
              ${rangeDisplay}
            </span>
          </div>
        </div>
      </div>

      ${rsDetailsHtml}
      ${encroachHtml}

      <!-- Quick Actions -->
      <div style="margin-top: 6px;">
        <button class="btn btn-outline btn-print-dossier" onclick="window.print()">
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
  renderRSPlot(data) {
    const p = data.plot || {};
    const pi = data.parcel_info;
    const enc = data.encroachment || (pi && pi.encroachment) || {};

    this.currentPlotId = p.id;

    if (this.badge) this.badge.style.display = 'none';

    const displayPlotNo = (pi && pi.has_record && pi.rs_plot_no) ? pi.rs_plot_no : (p.plot_no || 'N/A');
    const displayMouza = (pi && pi.has_record && pi.mouza) ? pi.mouza : (p.mouza || 'N/A');
    const displayJl = (pi && pi.has_record && pi.rs_jl) ? pi.rs_jl : (p.jl_no || 'N/A');

    if (this.title) {
      this.title.textContent = `RS Plot #${displayPlotNo} ${displayMouza && displayMouza !== 'N/A' ? '• ' + displayMouza : ''}`;
    }

    let areaFormatted = '0.00 Ac';
    let fdAreaFormatted = '0.00 Ac';
    let othersAreaFormatted = '0.00 Ac';

    if (pi && pi.has_record) {
      const totalAreaVal = pi.total_area != null ? pi.total_area : p.area_acre;
      areaFormatted = totalAreaVal != null ? Number(totalAreaVal).toFixed(2) + ' Ac' : '0.00 Ac';
      if (pi.total_area_fd != null) {
        fdAreaFormatted = Number(pi.total_area_fd).toFixed(2) + ' Ac';
      }
      if (pi.total_area_others != null) {
        othersAreaFormatted = Number(pi.total_area_others).toFixed(2) + ' Ac';
      }
    } else if (data.loadingParcelInfo) {
      areaFormatted = p.area_acre != null ? Number(p.area_acre).toFixed(2) + ' Ac' : '0.00 Ac';
      fdAreaFormatted = `<span style="font-size: 11px; color: #64748b;"><i class="fa-solid fa-spinner fa-spin"></i></span>`;
      othersAreaFormatted = `<span style="font-size: 11px; color: #64748b;"><i class="fa-solid fa-spinner fa-spin"></i></span>`;
    } else {
      areaFormatted = p.area_acre != null ? Number(p.area_acre).toFixed(2) + ' Ac' : '0.00 Ac';
    }

    const effectiveBeat = (pi && pi.has_record && pi.beat_name) ? pi.beat_name : (p.beat_name || (pi && pi.beat_name));
    const effectiveRange = pi && pi.range;

    const beatDisplay = effectiveBeat 
      ? `<i class="fa-solid fa-tree prop-icon"></i><span class="prop-highlight-beat">${effectiveBeat}</span>`
      : `<span class="prop-dim-italic"><i class="fa-solid fa-tree prop-icon"></i>Not in current survey register</span>`;

    const rangeDisplay = effectiveRange
      ? `<i class="fa-solid fa-mountain-sun prop-icon"></i><span class="prop-highlight-range">${effectiveRange}</span>`
      : (data.loadingParcelInfo
          ? `<span class="prop-dim"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</span>`
          : `<span class="prop-dim-italic"><i class="fa-solid fa-mountain-sun prop-icon"></i>Not in current survey register</span>`);

    // Linked CS Plots Table Section
    let csDetailsHtml = '';
    if (pi && pi.linked_cs_plots && pi.linked_cs_plots.length > 0) {
      const csRows = pi.linked_cs_plots.map(r => {
        const legal = r.legal_status || '';
        const badgeClass = legal.includes('20') ? 'sec20' : (legal.includes('6') ? 'sec6' : 'general');
        const fdStr = r.area_fd != null ? Number(r.area_fd).toFixed(2) : '-';
        const othersStr = r.area_others != null ? Number(r.area_others).toFixed(2) : '-';
        return `
          <tr>
            <td class="mono td-bold">${r.cs_plot_no || 'N/A'}</td>
            <td class="mono td-khatian">${r.cs_jl || '-'}</td>
            <td class="mono td-fd-area">${fdStr}</td>
            <td class="mono td-muted" style="text-align: right;">${othersStr}</td>
            <td style="text-align: right;"><span class="badge-stat ${badgeClass}">${legal || 'N/A'}</span></td>
          </tr>
        `;
      }).join('');

      csDetailsHtml = `
        <!-- CS Plots Details -->
        <div class="dossier-card">
          <div class="dossier-card-title">
            <span>CS Plots Details</span>
            <span style="font-size: 10.5px; color: #64748b; font-weight: 400; text-transform: none;">${pi.linked_cs_plots.length} linked</span>
          </div>
          <div class="rs-table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>CS Plot</th>
                  <th>CS JL</th>
                  <th style="text-align: right;">FD Area</th>
                  <th style="text-align: right;">Others</th>
                  <th style="text-align: right;">Legal Status</th>
                </tr>
              </thead>
              <tbody>
                ${csRows}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    // Encroachment Section
    let encroachBanner = '';
    let encroachHtml = '';
    if (enc && enc.has_encroachment && enc.records && enc.records.length > 0) {
      encroachBanner = `
        <div class="encroach-banner">
          <i class="fa-solid fa-triangle-exclamation" style="color: #ef4444; font-size: 12px;"></i>
          <span>Encroached Land: <strong style="color: #fca5a5;">${Number(enc.total_encroached_acre || 0).toFixed(2)} Ac</strong> across <strong style="color: #fca5a5;">${enc.count} Cases</strong></span>
        </div>
      `;

      const encRows = enc.records.map(r => {
        const areaStr = r.encroached_area_acre != null ? Number(r.encroached_area_acre).toFixed(2) : '-';
        const rawAction = (r.action_taken || '').trim().replace(/\n/g, ' ');
        const actionDisplay = rawAction 
          ? `<span title="${rawAction.replace(/"/g, '&quot;')}">${rawAction.length > 28 ? rawAction.substring(0, 26) + '...' : rawAction}</span>`
          : '<span style="color: #64748b;">-</span>';
        const rawName = (r.encroacher_name || 'N/A').trim().replace(/\n/g, ' ');
        const nameDisplay = `<span title="${rawName.replace(/"/g, '&quot;')}">${rawName.length > 32 ? rawName.substring(0, 30) + '...' : rawName}</span>`;

        return `
          <tr>
            <td class="td-encroacher">${nameDisplay}</td>
            <td class="mono td-bold">${r.cs_plot_no || '-'}</td>
            <td class="mono td-khatian">${r.rs_khatian || '-'}</td>
            <td class="mono td-danger" style="text-align: right;">${areaStr}</td>
            <td class="td-structure">${r.structure_type || '-'}</td>
            <td class="td-action">${actionDisplay}</td>
          </tr>
        `;
      }).join('');

      encroachHtml = `
        <!-- Encroachment Details Card -->
        <div class="dossier-card card-encroach">
          <div class="dossier-card-title">
            <span style="display: flex; align-items: center; gap: 6px;">
              <i class="fa-solid fa-triangle-exclamation"></i>
              <span>Encroachment Details</span>
            </span>
            <span class="badge-stat-danger">${enc.count} Cases &bull; ${Number(enc.total_encroached_acre || 0).toFixed(2)} Ac</span>
          </div>
          <div class="rs-table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Encroacher Name & Address</th>
                  <th>CS Plot</th>
                  <th>Khatian</th>
                  <th style="text-align: right;">Area (Ac)</th>
                  <th>Structure</th>
                  <th>Action Taken</th>
                </tr>
              </thead>
              <tbody>
                ${encRows}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    let html = `
      <!-- RS Parcel Identification Card -->
      <div class="dossier-card">
        <div class="dossier-card-title">
          <span>RS Parcel Identification</span>
          <span style="font-size: 10px; color: #c084fc; font-weight: 700; text-transform: uppercase;">RS Cadastre</span>
        </div>
        ${encroachBanner}
        <div class="dossier-grid">
          <div class="dossier-prop">
            <span class="prop-label">RS Plot No</span>
            <span class="prop-val mono prop-bold prop-highlight-pno">
              ${displayPlotNo}
            </span>
          </div>

          <div class="dossier-prop">
            <span class="prop-label">Total Area</span>
            <span class="prop-val mono prop-bold">
              ${areaFormatted}
            </span>
          </div>

          <div class="dossier-prop">
            <span class="prop-label">Mouza</span>
            <span class="prop-val prop-bold">
              ${displayMouza}
            </span>
          </div>

          <div class="dossier-prop">
            <span class="prop-label">RS JL No</span>
            <span class="prop-val mono prop-muted">
              ${displayJl}
            </span>
          </div>

          <div class="dossier-prop">
            <span class="prop-label">FD Land Area</span>
            <span class="prop-val mono prop-fd">
              ${fdAreaFormatted}
            </span>
          </div>

          <div class="dossier-prop">
            <span class="prop-label">Private / Others</span>
            <span class="prop-val mono prop-muted">
              ${othersAreaFormatted}
            </span>
          </div>

          <div class="dossier-prop">
            <span class="prop-label">Beat Name</span>
            <span class="prop-val">
              ${beatDisplay}
            </span>
          </div>

          <div class="dossier-prop">
            <span class="prop-label">Range</span>
            <span class="prop-val">
              ${rangeDisplay}
            </span>
          </div>
        </div>
      </div>

      ${csDetailsHtml}
      ${encroachHtml}

      <!-- Quick Actions -->
      <div style="margin-top: 6px;">
        <button class="btn btn-outline btn-print-dossier" onclick="window.print()">
          <i class="fa-solid fa-print"></i> Print Details
        </button>
      </div>
    `;

    if (this.content) this.content.innerHTML = html;
    this.open();
  },

  renderPlot(data) {
    if (data && data.plot && data.plot.type && data.plot.type.includes('RS')) {
      return this.renderRSPlot(data);
    }
    return this.renderCSPlot(data);
  }
};
