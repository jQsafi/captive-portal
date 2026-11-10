const fs = require('node:fs');
const path = require('node:path');

const TEMPLATES_DIR = path.join(__dirname, 'templates');
const templateCache = {};

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}

function loadTemplate(filename) {
  if (!templateCache[filename]) {
    const filePath = path.join(TEMPLATES_DIR, filename);
    templateCache[filename] = fs.readFileSync(filePath, 'utf8');
  }
  return templateCache[filename];
}

function render(templateName, data = {}) {
  const tpl = loadTemplate(templateName);
  return tpl.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (match, key) => {
    return data[key] !== undefined ? data[key] : '';
  });
}

const COUNTRY_CODES = [
  { code: '+880', label: '🇧🇩 +880' },
  { code: '+1', label: '🇺🇸 +1' },
  { code: '+91', label: '🇮🇳 +91' },
  { code: '+44', label: '🇬🇧 +44' },
  { code: '+971', label: '🇦🇪 +971' },
  { code: '+65', label: '🇸🇬 +65' },
  { code: '+61', label: '🇦🇺 +61' },
  { code: '+49', label: '🇩🇪 +49' },
  { code: '+92', label: '🇵🇰 +92' },
  { code: '+966', label: '🇸🇦 +966' },
  { code: '+33', label: '🇫🇷 +33' },
  { code: '+81', label: '🇯🇵 +81' },
  { code: '+62', label: '🇮🇩 +62' },
  { code: '+234', label: '🇳🇬 +234' },
  { code: '', label: '🌐 Other' }
];

function renderCountryOptions(selectedCode = '+880') {
  return COUNTRY_CODES.map(c => {
    const isSelected = c.code === selectedCode ? ' selected' : '';
    return `<option value="${c.code}"${isSelected}>${c.label}</option>`;
  }).join('\n                ');
}

function getCustomerTypeBadge(type) {
  const t = (type || 'Hotspot').trim();
  if (t === 'Hotspot') {
    return '<span class="type-badge badge-hotspot">📶 Hotspot</span>';
  }
  if (t === 'Walk-in Client') {
    return '<span class="type-badge badge-walkin">🚶 Walk-in</span>';
  }
  if (t === 'Service / Repair') {
    return '<span class="type-badge badge-repair">🛠️ Service/Repair</span>';
  }
  if (t === 'Sales / Purchase') {
    return '<span class="type-badge badge-sales">🛒 Sales/Buyer</span>';
  }
  return `<span class="type-badge badge-general">${escapeHtml(t)}</span>`;
}

function getPortalHtml(clientIp, error = '', oldValues = {}, config = {}) {
  const businessName = config.businessName || 'Smart Computer';
  const promoHeadline = config.promoHeadline || 'Welcome to Smart Computer! 🎁';
  const promoSubtext = config.promoSubtext || 'Enter your name and mobile number to unlock instant unlimited high-speed internet.';
  const defaultCountry = config.defaultCountryCode || '+880';
  const prevCountry = oldValues.countryCode || defaultCountry;
  const ssid = config.hotspot && config.hotspot.ssid ? config.hotspot.ssid : `${businessName} Guest`;

  const errorBlock = error ? `
      <div class="error-box" role="alert">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
        <span>${escapeHtml(error)}</span>
      </div>` : '';

  return render('portal.html', {
    title: `${escapeHtml(businessName)} - Wi-Fi Access`,
    promoHeadline: escapeHtml(promoHeadline),
    promoSubtext: escapeHtml(promoSubtext),
    ssid: escapeHtml(ssid),
    errorBlock,
    prevName: escapeHtml(oldValues.name || ''),
    prevPhone: escapeHtml(oldValues.phone || ''),
    countryOptions: renderCountryOptions(prevCountry)
  });
}

function getSuccessHtml(name, redirectUrl, config = {}) {
  const businessName = escapeHtml(config.businessName || 'Smart Computer');
  const safeName = escapeHtml(name || 'Guest');
  const safeUrl = escapeHtml(redirectUrl || (config && config.redirectUrl) || 'https://www.google.com');
  const durationMinutes = (config.session && config.session.durationMinutes) || 120;
  const durationHours = Math.round(durationMinutes / 60);
  const durationText = durationMinutes >= 60 ? `${durationHours} Hours` : `${durationMinutes} Minutes`;

  return render('success.html', {
    safeUrl,
    businessName,
    safeName,
    durationText,
    targetUrlJson: JSON.stringify(redirectUrl || (config && config.redirectUrl) || 'https://www.google.com')
  });
}

function getAdminHtml(leads = [], options = {}) {
  const config = options.config || {};
  const authorizedIps = options.authorizedIps || new Set();
  const getCustomerFolderName = options.getCustomerFolderName || (c => c.phone || '');
  const getWhatsAppDigits = options.getWhatsAppDigits || (p => String(p || '').replace(/[^0-9]/g, ''));
  const getSessionRemaining = options.getSessionRemaining || (() => null);

  const businessName = escapeHtml(config.businessName || 'Smart Computer');
  const totalCount = leads.length;
  const hotspotCount = leads.filter(l => (l.customer_type || 'Hotspot') === 'Hotspot').length;
  const walkinCount = leads.filter(l => (l.customer_type || '') !== 'Hotspot').length;
  const activeDeviceCount = authorizedIps.size;

  const tableRows = leads.map(l => {
    const safeName = escapeHtml(l.name);
    const safePhone = escapeHtml(l.phone);
    const waDigits = getWhatsAppDigits(l.phone);
    const safeIp = escapeHtml(l.ip || '');
    const safeDate = escapeHtml(l.created_at || '');
    const cType = l.customer_type || 'Hotspot';
    const typeBadge = getCustomerTypeBadge(cType);
    const folderName = getCustomerFolderName(l);
    const escapedNameForJs = safeName.replace(/'/g, "\\'");
    const escapedTypeForJs = cType.replace(/'/g, "\\'");
    const escapedFolderForJs = folderName.replace(/'/g, "\\'");

    // Session time remaining
    const sessionInfo = safeIp ? getSessionRemaining(safeIp) : null;
    let sessionPill = '';
    if (sessionInfo) {
      if (sessionInfo.active) {
        const warnClass = sessionInfo.isWarning ? 'session-pill-warn' : 'session-pill-active';
        sessionPill = `<span class="session-pill ${warnClass}" title="Expires in ${escapeHtml(sessionInfo.text)}">⏱️ ${escapeHtml(sessionInfo.text)}</span>`;
      } else {
        sessionPill = '<span class="session-pill session-pill-expired" title="Wi-Fi Session Expired">⏱️ Expired</span>';
      }
    }

    const ipCell = safeIp 
      ? `<div class="ip-cell-box"><code class="ip-tag">${safeIp}</code>${sessionPill}</div>` 
      : '<span class="no-ip">—</span>';

    const actionCell = `
      <div class="action-buttons-group">
        <button type="button" class="btn-action btn-notes" onclick="openNotesModal(${l.id}, '${escapedNameForJs}', '${safePhone}', '${escapedFolderForJs}')" title="Customer Notes & Service History">
          <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
          <span>Notes</span>
        </button>
        <button type="button" class="btn-action btn-edit" onclick="openEditModal(${l.id}, '${escapedNameForJs}', '${safePhone}', '${escapedTypeForJs}')" title="Edit Customer">
          <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          <span>Edit</span>
        </button>
        ${safeIp ? `
        <form method="POST" action="/admin/session/extend" style="display:inline;" onsubmit="return confirm('Extend Wi-Fi session by +1 hour for ${escapedNameForJs} (${safeIp})?');">
          <input type="hidden" name="ip" value="${safeIp}">
          <input type="hidden" name="minutes" value="60">
          <button type="submit" class="btn-action btn-extend" title="Extend Wi-Fi by +1 Hour">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline><line x1="12" y1="2" x2="12" y2="4"></line></svg>
            <span>+1h</span>
          </button>
        </form>` : ''}
        <form method="POST" action="/admin/customer/delete" style="display:inline;" onsubmit="return confirm('⚠️ Are you sure you want to delete customer ${escapedNameForJs} (${safePhone})?\\n\\nThis will remove their database record and delete their folder in customers/${escapeHtml(folderName)}.');">
          <input type="hidden" name="id" value="${l.id}">
          <button type="submit" class="btn-action btn-delete" title="Delete Customer">
            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
            <span>Delete</span>
          </button>
        </form>
        ${safeIp ? `
        <form method="POST" action="/admin/revoke" style="display:inline;" onsubmit="return confirm('Disconnect Wi-Fi access for ${escapedNameForJs} (${safeIp})?');">
          <input type="hidden" name="ip" value="${safeIp}">
          <button type="submit" class="btn-action btn-disconnect" title="Disconnect Wi-Fi">
            <svg viewBox="0 0 24 24"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path><path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>
            <span>Disconnect</span>
          </button>
        </form>` : ''}
      </div>
    `;

    return `
    <tr class="customer-row" data-search="${safeName.toLowerCase()} ${safePhone} ${safeIp.toLowerCase()} ${cType.toLowerCase()}" data-type="${escapeHtml(cType.toLowerCase())}">
      <td class="col-id">#${l.id}</td>
      <td class="col-name">
        <b>${safeName}</b>
        <div style="font-size:11px; color:#64748b; margin-top:2px;">📁 customers/${escapeHtml(folderName)}</div>
      </td>
      <td class="col-type">${typeBadge}</td>
      <td class="col-phone"><a href="tel:${safePhone}" class="phone-link">${safePhone}</a></td>
      <td class="col-wa">
        <a href="https://wa.me/${waDigits}" target="_blank" class="btn-wa">
          <svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
          <span>Chat WhatsApp</span>
        </a>
      </td>
      <td class="col-ip">${ipCell}</td>
      <td class="col-date">${safeDate}</td>
      <td class="col-action">${actionCell}</td>
    </tr>
  `;
  }).join('');

  const mobileCards = leads.map(l => {
    const safeName = escapeHtml(l.name);
    const safePhone = escapeHtml(l.phone);
    const waDigits = getWhatsAppDigits(l.phone);
    const safeIp = escapeHtml(l.ip || '');
    const safeDate = escapeHtml(l.created_at || '');
    const cType = l.customer_type || 'Hotspot';
    const typeBadge = getCustomerTypeBadge(cType);
    const folderName = getCustomerFolderName(l);
    const escapedNameForJs = safeName.replace(/'/g, "\\'");
    const escapedTypeForJs = cType.replace(/'/g, "\\'");
    const escapedFolderForJs = folderName.replace(/'/g, "\\'");

    // Session time remaining
    const sessionInfo = safeIp ? getSessionRemaining(safeIp) : null;
    let sessionPill = '';
    if (sessionInfo) {
      if (sessionInfo.active) {
        const warnClass = sessionInfo.isWarning ? 'session-pill-warn' : 'session-pill-active';
        sessionPill = `<span class="session-pill ${warnClass}">⏱️ ${escapeHtml(sessionInfo.text)}</span>`;
      } else {
        sessionPill = '<span class="session-pill session-pill-expired">⏱️ Expired</span>';
      }
    }

    return `
    <div class="mobile-lead-card customer-card" data-search="${safeName.toLowerCase()} ${safePhone} ${safeIp.toLowerCase()} ${cType.toLowerCase()}" data-type="${escapeHtml(cType.toLowerCase())}">
      <div class="card-top">
        <div>
          <span class="card-id">#${l.id}</span>
          <h3 class="card-name">${safeName}</h3>
        </div>
        <div>${typeBadge}</div>
      </div>
      <div class="card-meta">
        <div class="meta-item">
          <span>📞 Phone:</span>
          <a href="tel:${safePhone}" class="phone-link"><b>${safePhone}</b></a>
        </div>
        <div class="meta-item">
          <span>📁 Folder:</span>
          <span style="font-family:monospace; font-size:11px; color:#cbd5e1;">customers/${escapeHtml(folderName)}</span>
        </div>
        <div class="meta-item">
          <span>🌐 Device IP:</span>
          <span>${safeIp ? `<code class="ip-tag">${safeIp}</code> ${sessionPill}` : '—'}</span>
        </div>
        <div class="meta-item">
          <span>🕒 Recorded:</span>
          <span>${safeDate}</span>
        </div>
      </div>
      <div class="card-actions">
        <a href="https://wa.me/${waDigits}" target="_blank" class="btn-wa">
          <svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
          <span>WhatsApp</span>
        </a>
        <button type="button" class="btn-action btn-notes" onclick="openNotesModal(${l.id}, '${escapedNameForJs}', '${safePhone}', '${escapedFolderForJs}')" title="Customer Notes & History">
          <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
          <span>Notes</span>
        </button>
        <button type="button" class="btn-action btn-edit" onclick="openEditModal(${l.id}, '${escapedNameForJs}', '${safePhone}', '${escapedTypeForJs}')">
          <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          <span>Edit</span>
        </button>
        ${safeIp ? `
        <form method="POST" action="/admin/session/extend" style="display:inline;">
          <input type="hidden" name="ip" value="${safeIp}">
          <input type="hidden" name="minutes" value="60">
          <button type="submit" class="btn-action btn-extend" title="Extend Wi-Fi +1 Hour">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            <span>+1h</span>
          </button>
        </form>` : ''}
        <form method="POST" action="/admin/customer/delete" onsubmit="return confirm('⚠️ Are you sure you want to delete customer ${escapedNameForJs} (${safePhone})?\\n\\nThis will remove their database record and delete their folder.');">
          <input type="hidden" name="id" value="${l.id}">
          <button type="submit" class="btn-action btn-delete">
            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
            <span>Delete</span>
          </button>
        </form>
        ${safeIp ? `
        <form method="POST" action="/admin/revoke" onsubmit="return confirm('Disconnect Wi-Fi access for ${escapedNameForJs} (${safeIp})?');">
          <input type="hidden" name="ip" value="${safeIp}">
          <button type="submit" class="btn-action btn-disconnect">
            <svg viewBox="0 0 24 24"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path><path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>
            <span>Disconnect</span>
          </button>
        </form>` : ''}
      </div>
    </div>
  `;
  }).join('');

  const emptyTable = '<tr><td colspan="8" class="empty-state">No customer records yet. Add a customer or connect via Wi-Fi to test!</td></tr>';
  const emptyCards = '<div class="empty-state">No customer records yet. Add a customer or connect via Wi-Fi to test!</div>';

  return render('admin.html', {
    businessName,
    businessNameUpper: businessName.toUpperCase(),
    totalCount,
    hotspotCount,
    walkinCount,
    activeDeviceCount,
    tableRows: tableRows || emptyTable,
    mobileCards: mobileCards || emptyCards
  });
}

module.exports = {
  escapeHtml,
  getCustomerTypeBadge,
  getPortalHtml,
  getSuccessHtml,
  getAdminHtml,
  renderCountryOptions,
  render
};

