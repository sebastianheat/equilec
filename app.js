/* =========================================================================
   COTIZADOR EQUILEC — Single-page application
   Persistencia: localStorage. Routing: hash. PDF: jsPDF + autoTable.
   ========================================================================= */

const STORAGE_KEY = 'equilec_cotizador_v1';
const SESSION_KEY = 'equilec_session_v1';
const ADMIN_PASSWORD = 'equilec2026';

const COMPANY = {
  name: 'EQUILEC SOC COM LTDA',
  shortName: 'Equilec',
  rut: '76.580.030-2',
  address: 'Picton 8973, La Florida, Santiago, Región Metropolitana',
  phones: '(56-2) 2419 5410',
  web: 'www.equilec.cl',
  email: 'ventas@equilec.cl'
};

const DEFAULT_VENDORS = [
  { name: 'Andrés Cruz',      email: 'acruz@equilec.cl',     phone: '+56 9 4388 2384', role: 'Ventas Corporativas' },
  { name: 'Giovani Quezada',  email: 'gquezada@equilec.cl',  phone: '+56 9 9879 2325', role: 'Ventas Técnicas' },
  { name: 'Waldo Molina',     email: '',                     phone: '+56 9 9822 5069', role: 'Ventas Técnicas' },
  { name: 'Esteban González', email: 'egonzalez@equilec.cl', phone: '+56 9 6571 5162', role: 'Proyectos e Ingeniería' }
];

const PRESET_MARGINS = [10, 12, 15, 20, 25, 30, 35, 40, 45, 50, 60];

const FASES = [
  { id: 'ofertado',  label: 'Ofertado'  },
  { id: 'aceptado',  label: 'Aceptado'  },
  { id: 'rechazado', label: 'Rechazado' },
  { id: 'cancelado', label: 'Cancelado' }
];

const CONDICIONES_PAGO = [
  '30 días',
  '50% contra OC, 50% contra entrega',
  'Contado',
  'A convenir'
];

let state = {
  session: null,
  cotizaciones: [],
  vendors: [],
  clientes: [],
  currentCot: null,
  view: 'login',
  filters: { search: '', vendor: '', fase: '', dateFrom: '', dateTo: '' },
  logoDataUrl: null
};

/* ---------- Persistence ---------- */
function loadStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      state.cotizaciones = data.cotizaciones || [];
      state.vendors = (data.vendors && data.vendors.length) ? data.vendors : DEFAULT_VENDORS.slice();
      state.clientes = data.clientes || [];
    } else {
      state.vendors = DEFAULT_VENDORS.slice();
    }
  } catch (e) {
    console.warn('storage load failed', e);
    state.vendors = DEFAULT_VENDORS.slice();
  }
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) state.session = JSON.parse(raw);
  } catch (e) { console.warn('session load failed', e); }
}
function saveStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    cotizaciones: state.cotizaciones,
    vendors: state.vendors,
    clientes: state.clientes
  }));
}
function saveSession() {
  if (state.session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(state.session));
  else sessionStorage.removeItem(SESSION_KEY);
}

/* ---------- Helpers ---------- */
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

function uid() { return 'cot_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function formatCLP(n) { if (!isFinite(n)) return '$ 0'; return '$ ' + Math.round(n).toLocaleString('es-CL'); }
function formatDate(d) {
  if (!d) return '—';
  const date = (d instanceof Date) ? d : new Date(d);
  if (isNaN(date)) return '—';
  return date.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function formatDateLong(d) {
  const date = (d instanceof Date) ? d : new Date(d);
  if (isNaN(date)) return '—';
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  return `${date.getDate()} de ${meses[date.getMonth()]} de ${date.getFullYear()}`;
}
function todayISO() { return new Date().toISOString().slice(0, 10); }
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
}
function nextNumero() {
  const existing = state.cotizaciones.map(c => parseInt(c.numero) || 0);
  const max = existing.length ? Math.max(...existing) : 240;
  return max + 1;
}
function newEmptyCot() {
  return {
    id: uid(),
    numero: nextNumero(),
    vendor: state.session?.vendor || '',
    fecha: todayISO(),
    fechaCierre: '',
    fase: 'ofertado',
    referencia: '',
    npCliente: '',
    cliente: { rut: '', nombre: '', direccion: '', fono: '', email: '' },
    validez: '15 días',
    entrega: '4 a 6 semanas',
    condicionPago: '30 días',
    observacion: 'Material ofertado cumple 100% con lo solicitado.',
    items: [emptyItem()],
    descuentoPct: 0,
    moneda: 'CLP',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}
function emptyItem() { return { sku: '', desc: '', cantidad: 1, costo: 0, margen: 30 }; }

/* ---------- Cálculos (idéntica a Selle / Excel) ---------- */
function calcPrecioUnit(item) {
  const m = (parseFloat(item.margen) || 0) / 100;
  if (m >= 1) return Infinity;
  const c = parseFloat(item.costo) || 0;
  return c / (1 - m);
}
function calcLineTotal(item) { return calcPrecioUnit(item) * (parseFloat(item.cantidad) || 0); }
function calcLineCost(item) { return (parseFloat(item.costo) || 0) * (parseFloat(item.cantidad) || 0); }
function calcTotals(cot) {
  const subtotal = (cot.items || []).reduce((acc, it) => acc + calcLineTotal(it), 0);
  const costoTotal = (cot.items || []).reduce((acc, it) => acc + calcLineCost(it), 0);
  const descuentoPct = (parseFloat(cot.descuentoPct) || 0) / 100;
  const descuentoMonto = subtotal * descuentoPct;
  const neto = subtotal - descuentoMonto;
  const iva = neto * 0.19;
  const total = neto + iva;
  const utilidad = neto - costoTotal;
  const margenPromedio = neto > 0 ? (utilidad / neto) * 100 : 0;
  return { subtotal, descuentoMonto, descuentoPct: descuentoPct * 100, neto, iva, total, costoTotal, margenPromedio, utilidad };
}

/* ---------- Toast ---------- */
function toast(message, type = 'info', timeout = 3500) {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = message;
  $('#toast-container').appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    setTimeout(() => el.remove(), 300);
  }, timeout);
}

/* ---------- Login flow ---------- */
function login(vendor, password) {
  vendor = (vendor || '').trim();
  if (!vendor) { toast('Ingresa tu nombre', 'error'); return; }
  const isAdmin = password === ADMIN_PASSWORD;
  if (password && !isAdmin) { toast('Contraseña incorrecta', 'error'); return; }
  state.session = { vendor, isAdmin };
  if (!isAdmin && !state.vendors.find(v => v.name.toLowerCase() === vendor.toLowerCase())) {
    state.vendors.push({ name: vendor, email: '', phone: '', role: 'Vendedor' });
    saveStorage();
  }
  saveSession();
  navigate('cotizador');
  toast(`Bienvenido, ${vendor}${isAdmin ? ' (admin)' : ''}`, 'success');
}
function logout() {
  state.session = null; saveSession();
  state.currentCot = null;
  navigate('login');
}

/* ---------- Router ---------- */
function navigate(view) {
  if (view !== 'login' && !state.session) view = 'login';
  if (view === 'login' && state.session) view = 'cotizador';
  if (state.session) {
    const allowed = ['cotizador', 'mis', 'admin', 'config'];
    if (!allowed.includes(view)) view = 'cotizador';
    if ((view === 'admin' || view === 'config') && !state.session.isAdmin) view = 'cotizador';
  }
  state.view = view;
  if (view === 'cotizador' && !state.currentCot) state.currentCot = newEmptyCot();
  render();
}
function render() {
  const app = $('#app');
  app.classList.add('fade-in');
  if (state.view === 'login') {
    app.innerHTML = renderLogin(); bindLogin();
  } else {
    app.innerHTML = renderShell(renderViewContent());
    bindShell(); bindCurrentView();
  }
  setTimeout(() => app.classList.remove('fade-in'), 250);
}
function renderViewContent() {
  switch (state.view) {
    case 'cotizador': return renderCotizador();
    case 'mis':       return renderMisCotizaciones();
    case 'admin':     return renderAdmin();
    case 'config':    return renderConfig();
    default:          return renderCotizador();
  }
}
function bindCurrentView() {
  switch (state.view) {
    case 'cotizador': bindCotizador(); break;
    case 'mis':       bindMisCotizaciones(); break;
    case 'admin':     bindAdmin(); break;
    case 'config':    bindConfig(); break;
  }
}

/* =========================================================================
   LOGIN VIEW
   ========================================================================= */
function renderLogin() {
  const recentVendors = state.vendors.slice(0, 6);
  return `
  <div class="login-shell">
    <div class="login-side">
      <div class="login-hero">
        <div class="login-logo-wrap"><img src="logo-equilec.png" alt="Equilec" /></div>
        <h1>Cotiza más rápido,<br/>cierra <span class="accent">más ventas.</span></h1>
        <p>Herramienta de cotización en línea para el equipo Equilec. Calcula márgenes, genera PDF profesional con la marca de la empresa, y mantén el historial de cotizaciones organizado por vendedor.</p>
        <div class="login-features">
          <div class="login-feature"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>Cálculo automático de márgenes y totales con IVA</div>
          <div class="login-feature"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>Generación de PDF profesional con un click</div>
          <div class="login-feature"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>Historial por vendedor y panel administrativo</div>
          <div class="login-feature"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></svg>Optimizado para uso desde celular</div>
        </div>
      </div>
      <div class="login-foot">© ${new Date().getFullYear()} ${COMPANY.name} · ${COMPANY.address}</div>
    </div>
    <div class="login-form-side">
      <div class="login-card">
        <h2>Acceso al cotizador</h2>
        <p class="subtitle">Ingresa tu nombre para empezar a cotizar</p>
        <form class="login-form" id="login-form">
          <div class="field">
            <label>Nombre del vendedor</label>
            <input id="vendor-input" class="input" type="text" placeholder="Ej: Andrés Cruz" autofocus required autocomplete="off" />
            ${recentVendors.length ? `<div class="vendor-chips" style="margin-top:8px;">${recentVendors.map(v => `<button type="button" class="vendor-chip" data-vendor="${escapeHtml(v.name)}">${escapeHtml(v.name)}</button>`).join('')}</div>` : ''}
          </div>
          <div class="field">
            <label>Contraseña <span style="color:var(--text-muted);font-weight:400;text-transform:none;letter-spacing:0">(opcional · solo admin)</span></label>
            <input id="password-input" class="input" type="password" placeholder="••••••••••" autocomplete="off" />
          </div>
          <button class="btn btn-primary btn-lg" type="submit" style="margin-top:6px;">Ingresar al cotizador <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg></button>
        </form>
        <div class="login-help">
          <strong>Vendedor:</strong> ingresa tu nombre y deja la contraseña vacía. Tus cotizaciones quedarán registradas con tu nombre.<br/>
          <strong>Administrador:</strong> ingresa tu nombre + la contraseña de admin para ver todas las cotizaciones, márgenes y administrar vendedores.
        </div>
      </div>
    </div>
  </div>`;
}
function bindLogin() {
  $('#login-form').addEventListener('submit', e => {
    e.preventDefault();
    login($('#vendor-input').value, $('#password-input').value);
  });
  $$('.vendor-chip').forEach(b => b.addEventListener('click', () => {
    $('#vendor-input').value = b.dataset.vendor;
    $('#password-input').focus();
  }));
}

/* =========================================================================
   SHELL
   ========================================================================= */
function renderShell(content) {
  const isAdmin = state.session?.isAdmin;
  const initials = (state.session?.vendor || '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
  const sidebarMarkup = `
    <aside class="sidebar">
      <div class="brand"><div class="brand-logo"><img src="logo-equilec.png" alt="Equilec" /></div></div>
      <div style="padding:0 8px;margin-top:-8px;">
        <div style="font-size:0.66rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.14em;font-weight:700;">Cotizador 2026</div>
      </div>
      <nav class="nav">
        <div class="nav-section-title">Trabajo</div>
        <button class="nav-item ${state.view === 'cotizador' ? 'active' : ''}" data-nav="cotizador">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-4"/><path d="M9 11V7a3 3 0 0 1 6 0v4"/><circle cx="12" cy="16" r="1"/></svg>
          ${state.currentCot && state.cotizaciones.find(c => c.id === state.currentCot.id) ? 'Editar cotización' : 'Nueva cotización'}
        </button>
        <button class="nav-item ${state.view === 'mis' ? 'active' : ''}" data-nav="mis">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6"/></svg>
          Mis cotizaciones
        </button>
        ${isAdmin ? `
        <div class="nav-section-title" style="margin-top:16px;">Administración</div>
        <button class="nav-item ${state.view === 'admin' ? 'active' : ''}" data-nav="admin">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/></svg>
          Panel general
        </button>
        <button class="nav-item ${state.view === 'config' ? 'active' : ''}" data-nav="config">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 10v6m11-11h-6m-10 0H1"/></svg>
          Configuración
        </button>
        ` : ''}
      </nav>
      <div class="user-card">
        <div class="user-avatar">${escapeHtml(initials)}</div>
        <div class="user-info">
          <div class="name">${escapeHtml(state.session?.vendor || '')}</div>
          <div class="role">${isAdmin ? 'Administrador' : 'Vendedor'}</div>
        </div>
        <button class="btn btn-ghost btn-sm" id="logout-btn" title="Cerrar sesión" style="padding:0;width:32px;height:32px;justify-content:center;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg></button>
      </div>
    </aside>`;
  return `
  <div class="mobile-bar">
    <div class="brand" style="padding:0;"><div class="brand-logo" style="width:110px;"><img src="logo-equilec.png" alt="Equilec" /></div></div>
    <button class="mobile-menu-btn" id="mobile-menu-btn" aria-label="Menú"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg></button>
  </div>
  <div class="mobile-drawer" id="mobile-drawer">${sidebarMarkup}</div>
  <div class="app-shell">${sidebarMarkup}<main class="main">${content}</main></div>
  <nav class="mobile-tabbar">
    <button class="tab-item ${state.view === 'cotizador' ? 'active' : ''}" data-nav="cotizador"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-4"/><path d="M9 11V7a3 3 0 0 1 6 0v4"/></svg>Nueva</button>
    <button class="tab-item ${state.view === 'mis' ? 'active' : ''}" data-nav="mis"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>Mis cotiz.</button>
    ${isAdmin ? `
    <button class="tab-item ${state.view === 'admin' ? 'active' : ''}" data-nav="admin"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/></svg>Admin</button>
    <button class="tab-item ${state.view === 'config' ? 'active' : ''}" data-nav="config"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 10v6m11-11h-6m-10 0H1"/></svg>Config</button>
    ` : ''}
    <button class="tab-item" id="logout-tab"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/></svg>Salir</button>
  </nav>`;
}
function bindShell() {
  $$('[data-nav]').forEach(b => b.addEventListener('click', () => { closeDrawer(); navigate(b.dataset.nav); }));
  $$('#logout-btn').forEach(b => b.addEventListener('click', logout));
  $('#logout-tab')?.addEventListener('click', logout);
  $('#mobile-menu-btn')?.addEventListener('click', () => $('#mobile-drawer').classList.add('open'));
  $('#mobile-drawer')?.addEventListener('click', e => { if (e.target.id === 'mobile-drawer') closeDrawer(); });
}
function closeDrawer() { $('#mobile-drawer')?.classList.remove('open'); }

/* =========================================================================
   COTIZADOR VIEW (form)
   ========================================================================= */
function renderCotizador() {
  const cot = state.currentCot;
  if (!cot) return '<div class="empty">Cargando…</div>';
  const totals = calcTotals(cot);
  const isAdmin = state.session?.isAdmin;
  const isExisting = !!state.cotizaciones.find(c => c.id === cot.id);
  const isOwnerOrAdmin = isAdmin || cot.vendor === state.session.vendor;

  return `
  <div class="page-header">
    <div>
      <h1 class="page-title">${isExisting ? 'Editar cotización' : 'Nueva cotización'}</h1>
      <div class="page-subtitle">N° <span class="mono">COT-${cot.numero}</span> · ${formatDateLong(cot.fecha)}</div>
    </div>
    <div class="flex">
      <span class="phase-pill phase-${cot.fase}" id="phase-display">${(FASES.find(f => f.id === cot.fase) || {}).label || cot.fase}</span>
    </div>
  </div>

  <div class="quote-bar">
    <div><span class="label">N° Cotización</span><span class="value">COT-${cot.numero}</span></div>
    <div><span class="label">Vendedor</span><span class="value">${escapeHtml(cot.vendor || '—')}</span></div>
    <div><span class="label">Total Bruto</span><span class="value mono" id="qb-total">${formatCLP(totals.total)}</span></div>
    <div><span class="label">Margen prom.</span><span class="value mono" id="qb-margin">${totals.margenPromedio.toFixed(1)}%</span></div>
  </div>

  <!-- DATOS GENERALES -->
  <div class="card mb-12" style="margin-bottom:14px;">
    <div class="card-header"><div class="card-title"><span class="dot"></span> Datos generales</div></div>
    <div class="field-row-4">
      <div class="field">
        <label>Fecha emisión</label>
        <input class="input" type="date" data-f="fecha" value="${cot.fecha}" />
      </div>
      <div class="field">
        <label>Fase</label>
        <select class="input select" data-f="fase">
          ${FASES.map(f => `<option value="${f.id}" ${cot.fase === f.id ? 'selected' : ''}>${f.label}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Validez de oferta</label>
        <input class="input" type="text" data-f="validez" value="${escapeHtml(cot.validez)}" placeholder="Ej: 15 días" />
      </div>
      <div class="field">
        <label>Fecha probable cierre</label>
        <input class="input" type="date" data-f="fechaCierre" value="${cot.fechaCierre || ''}" />
      </div>
    </div>
    <div class="field-row-3">
      <div class="field">
        <label>Asignado a (vendedor)</label>
        <select class="input select" data-f="vendor" ${isAdmin ? '' : 'disabled'}>
          ${state.vendors.map(v => `<option value="${escapeHtml(v.name)}" ${cot.vendor === v.name ? 'selected' : ''}>${escapeHtml(v.name)}</option>`).join('')}
          ${cot.vendor && !state.vendors.find(v => v.name === cot.vendor) ? `<option value="${escapeHtml(cot.vendor)}" selected>${escapeHtml(cot.vendor)}</option>` : ''}
        </select>
      </div>
      <div class="field">
        <label>Referencia interna</label>
        <input class="input" type="text" data-f="referencia" value="${escapeHtml(cot.referencia || '')}" placeholder="Ej: 150kw 2p 380V" />
      </div>
      <div class="field">
        <label>N° de parte cliente</label>
        <input class="input" type="text" data-f="npCliente" value="${escapeHtml(cot.npCliente || '')}" placeholder="Opcional" />
      </div>
    </div>
  </div>

  <!-- CLIENTE -->
  <div class="card mb-12" style="margin-bottom:14px;">
    <div class="card-header"><div class="card-title"><span class="dot"></span> Cliente</div></div>
    <div class="field-row">
      <div class="field autocomplete-wrap">
        <label>Razón social / Nombre</label>
        <input class="input" type="text" data-f="cliente.nombre" id="cliente-nombre" value="${escapeHtml(cot.cliente.nombre || '')}" placeholder="Buscar o ingresar..." autocomplete="off" />
        <div class="autocomplete-list" id="cliente-suggest" style="display:none;"></div>
      </div>
      <div class="field">
        <label>RUT</label>
        <input class="input input-mono" type="text" data-f="cliente.rut" value="${escapeHtml(cot.cliente.rut || '')}" placeholder="76.123.456-7" />
      </div>
    </div>
    <div class="field">
      <label>Dirección</label>
      <input class="input" type="text" data-f="cliente.direccion" value="${escapeHtml(cot.cliente.direccion || '')}" placeholder="Calle, comuna, ciudad" />
    </div>
    <div class="field-row">
      <div class="field">
        <label>Contacto / Teléfono</label>
        <input class="input" type="text" data-f="cliente.fono" value="${escapeHtml(cot.cliente.fono || '')}" />
      </div>
      <div class="field">
        <label>Email</label>
        <input class="input" type="email" data-f="cliente.email" value="${escapeHtml(cot.cliente.email || '')}" />
      </div>
    </div>
  </div>

  <!-- ITEMS -->
  <div class="card mb-12" style="margin-bottom:14px;">
    <div class="card-header">
      <div class="card-title"><span class="dot"></span> Productos / Items</div>
      <button class="btn btn-primary btn-sm" id="add-item-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg> Agregar item</button>
    </div>
    <div class="help-inline" style="margin-bottom:10px;"><strong>Fórmula:</strong> Precio unitario = Costo / (1 − Margen%) — el margen es sobre el precio de venta (gross margin), idéntico al cotizador Selle. Ingresa el costo neto, el margen y el sistema calcula el precio final.</div>
    <div class="items-wrap" id="items-wrap"></div>

    <div class="flex-between mt-16" style="margin-top:14px;flex-wrap:wrap;gap:14px;">
      <div>
        <div class="text-xs text-muted" style="margin-bottom:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Aplicar margen a todos los items</div>
        <div class="margin-presets" id="margin-presets">
          ${PRESET_MARGINS.map(m => `<button data-margin="${m}">${m}%</button>`).join('')}
        </div>
      </div>
      <div style="min-width:260px;flex:1;max-width:340px;">
        <div class="totals-box" id="totals-box">${renderTotals(cot)}</div>
      </div>
    </div>
  </div>

  <!-- CONDICIONES -->
  <div class="card mb-12" style="margin-bottom:14px;">
    <div class="card-header"><div class="card-title"><span class="dot"></span> Condiciones comerciales</div></div>
    <div class="field-row-3">
      <div class="field">
        <label>Condición de pago</label>
        <select class="input select" data-f="condicionPago">
          ${CONDICIONES_PAGO.map(c => `<option value="${escapeHtml(c)}" ${cot.condicionPago === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Plazo de entrega</label>
        <input class="input" type="text" data-f="entrega" value="${escapeHtml(cot.entrega)}" placeholder="Ej: 4 a 6 semanas" />
      </div>
      <div class="field">
        <label>Descuento (%)</label>
        <input class="input" type="number" min="0" max="100" step="0.5" data-f="descuentoPct" value="${cot.descuentoPct || 0}" />
      </div>
    </div>
    <div class="field">
      <label>Observaciones / Comentarios</label>
      <textarea class="textarea" data-f="observacion">${escapeHtml(cot.observacion || '')}</textarea>
    </div>
  </div>

  ${isAdmin && isExisting ? `
  <!-- DETALLE DE MÁRGENES (solo admin) -->
  <div class="card mb-12" style="margin-bottom:14px;border-color:var(--primary);">
    <div class="card-header">
      <div class="card-title"><span class="dot"></span> Detalle de márgenes (vista admin)</div>
      <span class="badge badge-primary">Solo administrador</span>
    </div>
    <div class="help-inline" style="background:var(--primary-soft);border-left-color:var(--primary);color:var(--ink);">
      Esta sección solo es visible para administradores. Muestra el detalle del margen aplicado a cada producto por el vendedor.
    </div>
    ${renderMarginBreakdown(cot)}
  </div>
  ` : ''}

  <div class="action-bar-sticky">
    <button class="btn btn-ghost" id="btn-cancel">Cancelar</button>
    ${isExisting && isOwnerOrAdmin ? `<button class="btn btn-danger" id="btn-delete">Eliminar</button>` : ''}
    <button class="btn btn-secondary" id="btn-pdf"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Generar PDF</button>
    <button class="btn btn-primary" id="btn-save"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Guardar cotización</button>
  </div>
  `;
}

function renderTotals(cot) {
  const t = calcTotals(cot);
  return `
    <div class="totals-row"><span>Subtotal</span><span class="mono">${formatCLP(t.subtotal)}</span></div>
    ${t.descuentoPct > 0 ? `<div class="totals-row"><span>Descuento (${t.descuentoPct}%)</span><span class="mono">−${formatCLP(t.descuentoMonto)}</span></div>` : ''}
    <div class="totals-row bold"><span>Neto</span><span class="mono">${formatCLP(t.neto)}</span></div>
    <div class="totals-row"><span>IVA 19%</span><span class="mono">${formatCLP(t.iva)}</span></div>
    <div class="totals-row total"><span>TOTAL</span><span class="mono">${formatCLP(t.total)}</span></div>
    ${state.session?.isAdmin ? `
      <div style="border-top:1px dashed var(--border);margin-top:10px;padding-top:10px;">
        <div class="totals-row"><span class="text-xs text-muted">Costo total (neto)</span><span class="mono text-xs">${formatCLP(t.costoTotal)}</span></div>
        <div class="totals-row"><span class="text-xs text-muted">Utilidad bruta</span><span class="mono text-xs" style="color:var(--success);font-weight:700;">${formatCLP(t.utilidad)}</span></div>
        <div class="totals-row"><span class="text-xs text-muted">Margen promedio</span><span class="mono text-xs" style="color:var(--primary);font-weight:700;">${t.margenPromedio.toFixed(1)}%</span></div>
      </div>` : ''}`;
}

function renderItemsTable(cot) {
  // Desktop
  const desktop = `
  <table class="items-table items-table-desktop">
    <thead>
      <tr>
        <th style="width:120px;">SKU / Código</th>
        <th>Descripción</th>
        <th class="num" style="width:70px;">Cant.</th>
        <th class="num" style="width:120px;">Costo neto</th>
        <th class="col-margin" style="width:90px;">Margen %</th>
        <th class="num" style="width:120px;">P. Unitario</th>
        <th class="num" style="width:130px;">Total línea</th>
        <th class="col-actions"></th>
      </tr>
    </thead>
    <tbody>
      ${cot.items.map((it, idx) => `
        <tr data-idx="${idx}">
          <td><input class="input input-mono" data-field="sku" value="${escapeHtml(it.sku)}" placeholder="SKU" /></td>
          <td><input class="input" data-field="desc" value="${escapeHtml(it.desc)}" placeholder="Descripción del producto" /></td>
          <td class="num"><input class="input" data-field="cantidad" type="number" min="0" step="1" value="${it.cantidad}" /></td>
          <td class="num"><input class="input" data-field="costo" type="number" min="0" step="0.01" value="${it.costo}" /></td>
          <td class="col-margin"><input class="input" data-field="margen" type="number" min="0" max="99" step="0.5" value="${it.margen}" /></td>
          <td class="num row-total" data-cell="precio">${formatCLP(calcPrecioUnit(it))}</td>
          <td class="num row-total" data-cell="total">${formatCLP(calcLineTotal(it))}</td>
          <td class="col-actions"><button class="icon-btn danger" data-action="del-item" title="Eliminar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button></td>
        </tr>
      `).join('')}
    </tbody>
  </table>`;

  // Mobile cards
  const mobile = `
  <div class="items-table-mobile">
    ${cot.items.map((it, idx) => `
      <div class="item-card-m" data-idx="${idx}">
        <div class="flex-between" style="margin-bottom:8px;">
          <strong style="font-size:0.82rem;color:var(--text-muted);">Item ${idx + 1}</strong>
          <button class="icon-btn danger" data-action="del-item" title="Eliminar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
        </div>
        <div class="row">
          <div><label>SKU</label><input class="input input-mono" data-field="sku" value="${escapeHtml(it.sku)}" placeholder="Código" /></div>
          <div><label>Cantidad</label><input class="input" data-field="cantidad" type="number" min="0" step="1" value="${it.cantidad}" /></div>
        </div>
        <div style="margin-bottom:8px;display:flex;flex-direction:column;gap:3px;">
          <label>Descripción</label>
          <input class="input" data-field="desc" value="${escapeHtml(it.desc)}" placeholder="Descripción" />
        </div>
        <div class="row3">
          <div><label>Costo neto</label><input class="input" data-field="costo" type="number" min="0" step="0.01" value="${it.costo}" /></div>
          <div><label>Margen %</label><input class="input" data-field="margen" type="number" min="0" max="99" step="0.5" value="${it.margen}" /></div>
          <div><label>P. Unit.</label><div class="input" style="background:var(--surface-2);font-family:'JetBrains Mono',monospace;font-weight:700;color:var(--primary);" data-cell="precio">${formatCLP(calcPrecioUnit(it))}</div></div>
        </div>
        <div class="total-row"><span>Total línea</span><span data-cell="total">${formatCLP(calcLineTotal(it))}</span></div>
      </div>
    `).join('')}
  </div>`;
  return desktop + mobile;
}

function renderMarginBreakdown(cot) {
  return `
  <table class="margin-breakdown">
    <thead>
      <tr>
        <th>SKU</th>
        <th>Descripción</th>
        <th class="num">Cant.</th>
        <th class="num">Costo</th>
        <th class="num">P. Venta</th>
        <th>Margen aplicado</th>
        <th class="num">Utilidad</th>
      </tr>
    </thead>
    <tbody>
      ${cot.items.map(it => {
        const p = calcPrecioUnit(it);
        const c = parseFloat(it.costo) || 0;
        const q = parseFloat(it.cantidad) || 0;
        const utilidad = (p - c) * q;
        return `
          <tr>
            <td class="mono text-xs text-muted">${escapeHtml(it.sku || '—')}</td>
            <td>${escapeHtml((it.desc || '—').slice(0, 60))}</td>
            <td class="num">${q}</td>
            <td class="num">${formatCLP(c)}</td>
            <td class="num">${formatCLP(p)}</td>
            <td><span class="margin-cell" style="display:inline-block;padding:3px 10px;border-radius:6px;">${(parseFloat(it.margen) || 0).toFixed(1)}%</span></td>
            <td class="num" style="color:var(--success);font-weight:700;">${formatCLP(utilidad)}</td>
          </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}

function bindCotizador() {
  $('#items-wrap').innerHTML = renderItemsTable(state.currentCot);
  bindItemsTable();
  bindCotizadorFields();

  $('#add-item-btn').addEventListener('click', () => {
    state.currentCot.items.push(emptyItem());
    rerenderItems();
  });

  $('#margin-presets').querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      const m = parseFloat(b.dataset.margin);
      state.currentCot.items.forEach(it => it.margen = m);
      rerenderItems();
      toast(`Margen ${m}% aplicado a todos los items`, 'success');
    });
  });

  $('#btn-cancel').addEventListener('click', () => {
    if (confirm('¿Descartar los cambios?')) {
      state.currentCot = newEmptyCot();
      navigate('mis');
    }
  });
  $('#btn-save').addEventListener('click', () => saveCotizacion(false));
  $('#btn-pdf').addEventListener('click', () => { saveCotizacion(true); generatePDF(state.currentCot); });
  $('#btn-delete')?.addEventListener('click', () => {
    if (confirm(`¿Eliminar cotización COT-${state.currentCot.numero}?`)) {
      state.cotizaciones = state.cotizaciones.filter(c => c.id !== state.currentCot.id);
      saveStorage();
      state.currentCot = newEmptyCot();
      navigate('mis');
      toast('Cotización eliminada', 'info');
    }
  });

  // Cliente autocomplete
  const nombreInput = $('#cliente-nombre');
  const suggest = $('#cliente-suggest');
  nombreInput?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase().trim();
    state.currentCot.cliente.nombre = e.target.value;
    if (q.length < 2 || !state.clientes.length) {
      suggest.style.display = 'none';
      return;
    }
    const matches = state.clientes.filter(c =>
      (c.nombre || '').toLowerCase().includes(q) || (c.rut || '').toLowerCase().includes(q)
    ).slice(0, 8);
    if (!matches.length) { suggest.style.display = 'none'; return; }
    suggest.innerHTML = matches.map(c => `<div class="autocomplete-item" data-rut="${escapeHtml(c.rut)}">${escapeHtml(c.nombre)}<span class="rut">${escapeHtml(c.rut)}</span></div>`).join('');
    suggest.style.display = 'block';
  });
  suggest?.addEventListener('click', e => {
    const item = e.target.closest('.autocomplete-item');
    if (!item) return;
    const cli = state.clientes.find(c => c.rut === item.dataset.rut);
    if (cli) {
      state.currentCot.cliente = {
        rut: cli.rut || '', nombre: cli.nombre || '',
        direccion: cli.direccion || '', fono: cli.fono || '', email: cli.email || ''
      };
      navigate('cotizador');
    }
    suggest.style.display = 'none';
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#cliente-nombre') && !e.target.closest('#cliente-suggest')) {
      if (suggest) suggest.style.display = 'none';
    }
  });
}
function bindCotizadorFields() {
  $$('[data-f]').forEach(el => {
    el.addEventListener('input', () => {
      const path = el.dataset.f;
      let val = el.value;
      if (path === 'descuentoPct') val = parseFloat(val) || 0;
      if (path.includes('.')) {
        const [a, b] = path.split('.');
        state.currentCot[a][b] = val;
      } else {
        state.currentCot[path] = val;
      }
      if (path === 'fase') {
        const fase = FASES.find(f => f.id === val);
        const el2 = $('#phase-display');
        if (el2) { el2.className = `phase-pill phase-${val}`; el2.textContent = fase ? fase.label : val; }
      }
      if (path === 'descuentoPct') rerenderTotals();
    });
    el.addEventListener('change', () => {
      const path = el.dataset.f;
      if (path === 'vendor') { state.currentCot.vendor = el.value; rerenderQuoteBar(); }
    });
  });
}
function bindItemsTable() {
  // Listen to changes on inputs in both desktop and mobile rows
  $$('#items-wrap input[data-field]').forEach(input => {
    input.addEventListener('input', () => {
      const row = input.closest('[data-idx]');
      const idx = parseInt(row.dataset.idx);
      const field = input.dataset.field;
      let val = input.value;
      if (['cantidad', 'costo', 'margen'].includes(field)) val = parseFloat(val) || 0;
      state.currentCot.items[idx][field] = val;

      const it = state.currentCot.items[idx];
      const p = calcPrecioUnit(it);
      const t = calcLineTotal(it);
      // Update both desktop and mobile cells for this idx
      $$(`[data-idx="${idx}"] [data-cell="precio"]`).forEach(c => c.textContent = formatCLP(p));
      $$(`[data-idx="${idx}"] [data-cell="total"]`).forEach(c => c.textContent = formatCLP(t));
      rerenderTotals();
    });
  });
  $$('[data-action="del-item"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.closest('[data-idx]');
      const idx = parseInt(row.dataset.idx);
      state.currentCot.items.splice(idx, 1);
      if (!state.currentCot.items.length) state.currentCot.items.push(emptyItem());
      rerenderItems();
    });
  });
}
function rerenderItems() {
  $('#items-wrap').innerHTML = renderItemsTable(state.currentCot);
  bindItemsTable();
  rerenderTotals();
}
function rerenderTotals() {
  $('#totals-box').innerHTML = renderTotals(state.currentCot);
  const t = calcTotals(state.currentCot);
  $('#qb-total').textContent = formatCLP(t.total);
  $('#qb-margin').textContent = t.margenPromedio.toFixed(1) + '%';
}
function rerenderQuoteBar() {
  const t = calcTotals(state.currentCot);
  $('#qb-total').textContent = formatCLP(t.total);
  $('#qb-margin').textContent = t.margenPromedio.toFixed(1) + '%';
}

function saveCotizacion(silent) {
  const cot = state.currentCot;
  if (!cot.cliente.nombre) { toast('Falta el nombre del cliente', 'error'); return false; }
  if (!cot.items.length || cot.items.every(it => !it.desc && !it.sku)) {
    toast('Agrega al menos un item con descripción', 'error'); return false;
  }
  cot.updated_at = new Date().toISOString();
  // Save cliente
  if (cot.cliente.rut && cot.cliente.nombre) {
    const existing = state.clientes.findIndex(c => c.rut === cot.cliente.rut);
    if (existing >= 0) state.clientes[existing] = { ...state.clientes[existing], ...cot.cliente };
    else state.clientes.push({ ...cot.cliente });
  }
  const idx = state.cotizaciones.findIndex(c => c.id === cot.id);
  if (idx >= 0) state.cotizaciones[idx] = JSON.parse(JSON.stringify(cot));
  else state.cotizaciones.unshift(JSON.parse(JSON.stringify(cot)));
  saveStorage();
  if (!silent) toast(`Cotización COT-${cot.numero} guardada`, 'success');
  return true;
}

/* =========================================================================
   MIS COTIZACIONES (vendedor)
   ========================================================================= */
function renderMisCotizaciones() {
  const isAdmin = state.session?.isAdmin;
  const all = [...state.cotizaciones].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  const mine = isAdmin ? all : all.filter(c => c.vendor === state.session.vendor);
  const filtered = filterCotizaciones(mine);

  return `
  <div class="page-header">
    <div>
      <h1 class="page-title">Mis cotizaciones</h1>
      <div class="page-subtitle">${mine.length} cotización${mine.length === 1 ? '' : 'es'} a tu nombre</div>
    </div>
    <button class="btn btn-primary" data-nav="cotizador" id="new-cot-btn">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
      Nueva cotización
    </button>
  </div>

  <div class="list-toolbar">
    <input class="input flex-1" id="filter-search" type="text" placeholder="Buscar por cliente, RUT, referencia, número…" value="${escapeHtml(state.filters.search)}" />
    <select class="input select" id="filter-fase" style="max-width:180px;">
      <option value="">Todas las fases</option>
      ${FASES.map(f => `<option value="${f.id}" ${state.filters.fase === f.id ? 'selected' : ''}>${f.label}</option>`).join('')}
    </select>
  </div>

  ${filtered.length === 0 ? renderEmptyState('Sin cotizaciones', 'Crea tu primera cotización con el botón "Nueva cotización"') : `
    <div style="overflow-x:auto;">
      <table class="cot-list-table">
        <thead>
          <tr>
            <th class="num">N°</th>
            <th>Fecha</th>
            <th>Cliente</th>
            <th>Referencia</th>
            <th>Fase</th>
            <th class="num">Items</th>
            <th class="num">Total</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(c => {
            const totals = calcTotals(c);
            const fase = FASES.find(f => f.id === c.fase) || { label: c.fase };
            return `
            <tr data-id="${c.id}">
              <td class="num"><strong>${c.numero}</strong></td>
              <td>${formatDate(c.fecha)}</td>
              <td>${escapeHtml(c.cliente.nombre || '—')}</td>
              <td class="text-xs text-muted">${escapeHtml((c.referencia || '—').slice(0, 32))}</td>
              <td><span class="phase-pill phase-${c.fase}">${fase.label}</span></td>
              <td class="num">${c.items.length}</td>
              <td class="num"><strong>${formatCLP(totals.total)}</strong></td>
              <td class="actions">
                <button class="icon-btn" data-action="edit" title="Editar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                <button class="icon-btn" data-action="duplicate" title="Duplicar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
                <button class="icon-btn" data-action="pdf" title="Descargar PDF"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
                <button class="icon-btn danger" data-action="delete" title="Eliminar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `}`;
}
function renderEmptyState(title, sub) {
  return `<div class="empty">
    <div class="empty-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg></div>
    <h3>${escapeHtml(title)}</h3>
    <div>${escapeHtml(sub)}</div>
  </div>`;
}
function filterCotizaciones(list) {
  const q = (state.filters.search || '').toLowerCase();
  return list.filter(c => {
    if (state.filters.fase && c.fase !== state.filters.fase) return false;
    if (state.filters.vendor && c.vendor !== state.filters.vendor) return false;
    if (state.filters.dateFrom && c.fecha < state.filters.dateFrom) return false;
    if (state.filters.dateTo && c.fecha > state.filters.dateTo) return false;
    if (!q) return true;
    return String(c.numero).includes(q) ||
      (c.cliente.nombre || '').toLowerCase().includes(q) ||
      (c.cliente.rut || '').toLowerCase().includes(q) ||
      (c.referencia || '').toLowerCase().includes(q) ||
      (c.vendor || '').toLowerCase().includes(q);
  });
}
function bindMisCotizaciones() {
  $('#filter-search')?.addEventListener('input', e => {
    state.filters.search = e.target.value;
    rerenderList(renderMisCotizaciones, bindMisCotizaciones);
  });
  $('#filter-fase')?.addEventListener('change', e => {
    state.filters.fase = e.target.value;
    rerenderList(renderMisCotizaciones, bindMisCotizaciones);
  });
  $('#new-cot-btn')?.addEventListener('click', () => {
    state.currentCot = newEmptyCot();
    navigate('cotizador');
  });
  bindRowActions();
}
function rerenderList(renderFn, bindFn) {
  $('.main').innerHTML = renderFn();
  bindFn();
}
function bindRowActions() {
  $$('.cot-list-table tr[data-id]').forEach(tr => {
    tr.addEventListener('click', e => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      const id = tr.dataset.id;
      const cot = state.cotizaciones.find(c => c.id === id);
      if (!cot) return;
      if (action === 'edit' || !action) {
        state.currentCot = JSON.parse(JSON.stringify(cot));
        navigate('cotizador');
      } else if (action === 'duplicate') {
        const dup = JSON.parse(JSON.stringify(cot));
        dup.id = uid();
        dup.numero = nextNumero();
        dup.fecha = todayISO();
        dup.created_at = new Date().toISOString();
        dup.updated_at = new Date().toISOString();
        state.currentCot = dup;
        navigate('cotizador');
        toast('Cotización duplicada (sin guardar)', 'info');
      } else if (action === 'pdf') {
        generatePDF(cot);
      } else if (action === 'delete') {
        if (confirm(`¿Eliminar cotización COT-${cot.numero}?`)) {
          state.cotizaciones = state.cotizaciones.filter(c => c.id !== id);
          saveStorage();
          render();
          toast('Cotización eliminada', 'info');
        }
      }
    });
  });
}

/* =========================================================================
   ADMIN PANEL
   ========================================================================= */
function renderAdmin() {
  const all = [...state.cotizaciones].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  const filtered = filterCotizaciones(all);

  const totalMonto = all.reduce((acc, c) => acc + calcTotals(c).total, 0);
  const totalUtilidad = all.reduce((acc, c) => acc + calcTotals(c).utilidad, 0);
  const monthAgo = new Date(); monthAgo.setMonth(monthAgo.getMonth() - 1);
  const recent = all.filter(c => new Date(c.created_at) > monthAgo);
  const recentMonto = recent.reduce((acc, c) => acc + calcTotals(c).total, 0);

  const vendorStats = {};
  all.forEach(c => {
    if (!vendorStats[c.vendor]) vendorStats[c.vendor] = { count: 0, monto: 0, utilidad: 0, costoTotal: 0, neto: 0 };
    const t = calcTotals(c);
    vendorStats[c.vendor].count++;
    vendorStats[c.vendor].monto += t.total;
    vendorStats[c.vendor].utilidad += t.utilidad;
    vendorStats[c.vendor].costoTotal += t.costoTotal;
    vendorStats[c.vendor].neto += t.neto;
  });

  const faseStats = {};
  FASES.forEach(f => faseStats[f.id] = 0);
  all.forEach(c => { faseStats[c.fase] = (faseStats[c.fase] || 0) + 1; });

  return `
  <div class="page-header">
    <div>
      <h1 class="page-title">Panel de administración</h1>
      <div class="page-subtitle">Vista general de todas las cotizaciones del equipo Equilec</div>
    </div>
    <button class="btn btn-ghost" id="export-csv-btn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Exportar CSV</button>
  </div>

  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-label">Cotizaciones totales</div>
      <div class="stat-value">${all.length}</div>
      <div class="stat-meta"><span class="pos">+${recent.length}</span> últimos 30 días</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Monto total cotizado</div>
      <div class="stat-value">${formatCLP(totalMonto)}</div>
      <div class="stat-meta">${formatCLP(recentMonto)} últimos 30 días</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Utilidad bruta total</div>
      <div class="stat-value" style="color:var(--success);">${formatCLP(totalUtilidad)}</div>
      <div class="stat-meta">Margen prom. ${all.length ? (totalUtilidad / all.reduce((a,c) => a + calcTotals(c).neto, 0) * 100).toFixed(1) : '0'}%</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Vendedores activos</div>
      <div class="stat-value">${Object.keys(vendorStats).length}</div>
      <div class="stat-meta">${state.vendors.length} registrados</div>
    </div>
  </div>

  ${Object.keys(vendorStats).length > 0 ? `
  <div class="card mb-12" style="margin-bottom:18px;">
    <div class="card-header"><div class="card-title"><span class="dot"></span> Performance por vendedor</div></div>
    <div style="display:flex;flex-direction:column;gap:8px;">
      ${Object.entries(vendorStats).sort((a,b) => b[1].monto - a[1].monto).map(([v, s]) => {
        const maxMonto = Math.max(...Object.values(vendorStats).map(x => x.monto));
        const pct = maxMonto > 0 ? (s.monto / maxMonto * 100) : 0;
        const margenProm = s.neto > 0 ? (s.utilidad / s.neto * 100) : 0;
        return `<div style="display:grid;grid-template-columns:160px 1fr 80px 100px 140px;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
          <div style="font-weight:600;font-size:0.9rem;">${escapeHtml(v)}</div>
          <div style="height:8px;background:var(--surface);border-radius:4px;overflow:hidden;"><div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--primary),var(--accent));border-radius:4px;"></div></div>
          <div style="text-align:right;color:var(--text-muted);font-size:0.85rem;">${s.count} cotiz.</div>
          <div style="text-align:right;font-family:'JetBrains Mono',monospace;font-size:0.82rem;color:var(--primary);font-weight:700;">${margenProm.toFixed(1)}%</div>
          <div style="text-align:right;font-family:'JetBrains Mono',monospace;font-size:0.88rem;font-weight:700;">${formatCLP(s.monto)}</div>
        </div>`;
      }).join('')}
    </div>
    <div style="margin-top:10px;font-size:0.74rem;color:var(--text-muted);display:flex;gap:18px;flex-wrap:wrap;">
      <span>● Vendedor</span><span>● Volumen relativo</span><span>● Cantidad</span><span style="color:var(--primary);">● Margen promedio</span><span>● Total cotizado</span>
    </div>
  </div>` : ''}

  <div class="card mb-12" style="margin-bottom:18px;">
    <div class="card-header"><div class="card-title"><span class="dot"></span> Cotizaciones por fase</div></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      ${FASES.map(f => `<div style="flex:1;min-width:140px;background:var(--surface-2);padding:14px;border-radius:var(--radius);border:1px solid var(--border);">
        <span class="phase-pill phase-${f.id}">${f.label}</span>
        <div style="font-family:'Barlow',sans-serif;font-size:1.8rem;font-weight:800;margin-top:6px;">${faseStats[f.id] || 0}</div>
      </div>`).join('')}
    </div>
  </div>

  <div class="list-toolbar">
    <input class="input" id="filter-search" type="text" placeholder="Buscar por cliente, RUT, número, referencia…" value="${escapeHtml(state.filters.search)}" style="min-width:240px;flex:1;" />
    <select class="input select" id="filter-vendor" style="max-width:200px;">
      <option value="">Todos los vendedores</option>
      ${state.vendors.map(v => `<option value="${escapeHtml(v.name)}" ${state.filters.vendor === v.name ? 'selected' : ''}>${escapeHtml(v.name)}</option>`).join('')}
    </select>
    <select class="input select" id="filter-fase" style="max-width:160px;">
      <option value="">Todas las fases</option>
      ${FASES.map(f => `<option value="${f.id}" ${state.filters.fase === f.id ? 'selected' : ''}>${f.label}</option>`).join('')}
    </select>
    <input class="input" id="filter-from" type="date" value="${state.filters.dateFrom}" style="max-width:150px;" />
    <input class="input" id="filter-to" type="date" value="${state.filters.dateTo}" style="max-width:150px;" />
    ${(state.filters.search || state.filters.vendor || state.filters.fase || state.filters.dateFrom || state.filters.dateTo) ? '<button class="btn btn-ghost btn-sm" id="clear-filters">Limpiar</button>' : ''}
  </div>

  ${filtered.length === 0 ? renderEmptyState('Sin cotizaciones', 'No se encontraron resultados con los filtros aplicados') : `
    <div style="overflow-x:auto;">
      <table class="cot-list-table">
        <thead>
          <tr>
            <th class="num">N°</th>
            <th>Fecha</th>
            <th>Vendedor</th>
            <th>Cliente</th>
            <th>Fase</th>
            <th class="num">Items</th>
            <th class="num">Total</th>
            <th class="num">Margen %</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(c => {
            const totals = calcTotals(c);
            const fase = FASES.find(f => f.id === c.fase) || { label: c.fase };
            return `
            <tr data-id="${c.id}">
              <td class="num"><strong>${c.numero}</strong></td>
              <td>${formatDate(c.fecha)}</td>
              <td><span class="badge badge-primary">${escapeHtml(c.vendor)}</span></td>
              <td>${escapeHtml(c.cliente.nombre || '—')}</td>
              <td><span class="phase-pill phase-${c.fase}">${fase.label}</span></td>
              <td class="num">${c.items.length}</td>
              <td class="num"><strong>${formatCLP(totals.total)}</strong></td>
              <td class="num" style="color:var(--primary);font-weight:700;">${totals.margenPromedio.toFixed(1)}%</td>
              <td class="actions">
                <button class="icon-btn" data-action="edit" title="Ver / editar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
                <button class="icon-btn" data-action="pdf" title="Descargar PDF"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
                <button class="icon-btn danger" data-action="delete" title="Eliminar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `}`;
}
function bindAdmin() {
  $('#filter-search')?.addEventListener('input', e => { state.filters.search = e.target.value; rerenderList(renderAdmin, bindAdmin); });
  $('#filter-vendor')?.addEventListener('change', e => { state.filters.vendor = e.target.value; rerenderList(renderAdmin, bindAdmin); });
  $('#filter-fase')?.addEventListener('change', e => { state.filters.fase = e.target.value; rerenderList(renderAdmin, bindAdmin); });
  $('#filter-from')?.addEventListener('change', e => { state.filters.dateFrom = e.target.value; rerenderList(renderAdmin, bindAdmin); });
  $('#filter-to')?.addEventListener('change', e => { state.filters.dateTo = e.target.value; rerenderList(renderAdmin, bindAdmin); });
  $('#clear-filters')?.addEventListener('click', () => { state.filters = { search: '', vendor: '', fase: '', dateFrom: '', dateTo: '' }; rerenderList(renderAdmin, bindAdmin); });
  $('#export-csv-btn')?.addEventListener('click', exportCSV);
  bindRowActions();
}
function exportCSV() {
  const rows = [['N°', 'Fecha', 'Vendedor', 'Fase', 'Cliente', 'RUT', 'Referencia', 'Items', 'Costo', 'Neto', 'IVA', 'Total', 'Utilidad', 'Margen %']];
  state.cotizaciones.forEach(c => {
    const t = calcTotals(c);
    rows.push([c.numero, c.fecha, c.vendor, c.fase, c.cliente.nombre, c.cliente.rut, c.referencia, c.items.length, Math.round(t.costoTotal), Math.round(t.neto), Math.round(t.iva), Math.round(t.total), Math.round(t.utilidad), t.margenPromedio.toFixed(1)]);
  });
  const csv = rows.map(r => r.map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(["﻿" + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cotizaciones_equilec_${todayISO()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV exportado', 'success');
}

/* =========================================================================
   CONFIG (admin) — gestión de vendedores
   ========================================================================= */
function renderConfig() {
  return `
  <div class="page-header">
    <div>
      <h1 class="page-title">Configuración</h1>
      <div class="page-subtitle">Gestiona vendedores, datos de empresa y opciones</div>
    </div>
  </div>

  <div class="card mb-12" style="margin-bottom:18px;">
    <div class="card-header">
      <div class="card-title"><span class="dot"></span> Vendedores</div>
      <button class="btn btn-primary btn-sm" id="add-vendor-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg> Agregar vendedor</button>
    </div>
    <div class="help-inline">Los vendedores listados aquí aparecen en el desplegable "Asignado a" del cotizador. Puedes agregar, editar o eliminar vendedores.</div>
    <div class="vendor-list" id="vendor-list" style="margin-top:14px;">
      ${state.vendors.map((v, idx) => `
        <div class="vendor-row" data-idx="${idx}">
          <div class="info">
            <div class="av">${v.name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()}</div>
            <div>
              <div style="font-weight:700;">${escapeHtml(v.name)}</div>
              <div class="text-xs text-muted">${escapeHtml(v.role || 'Vendedor')}${v.email ? ' · ' + escapeHtml(v.email) : ''}${v.phone ? ' · ' + escapeHtml(v.phone) : ''}</div>
            </div>
          </div>
          <div class="flex">
            <button class="btn btn-ghost btn-sm" data-action="edit-vendor">Editar</button>
            <button class="btn btn-danger btn-sm" data-action="del-vendor">Eliminar</button>
          </div>
        </div>`).join('')}
    </div>
  </div>

  <div class="card mb-12" style="margin-bottom:18px;">
    <div class="card-header"><div class="card-title"><span class="dot"></span> Datos de empresa</div></div>
    <div class="help-inline">Estos datos aparecen en el PDF generado. Configurados según la información oficial de Equilec.</div>
    <div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:14px;">
      <div><label>Razón social</label><div class="input" style="background:var(--surface-2);">${escapeHtml(COMPANY.name)}</div></div>
      <div><label>RUT</label><div class="input" style="background:var(--surface-2);font-family:'JetBrains Mono',monospace;">${escapeHtml(COMPANY.rut)}</div></div>
      <div><label>Dirección</label><div class="input" style="background:var(--surface-2);">${escapeHtml(COMPANY.address)}</div></div>
      <div><label>Teléfono</label><div class="input" style="background:var(--surface-2);">${escapeHtml(COMPANY.phones)}</div></div>
      <div><label>Email</label><div class="input" style="background:var(--surface-2);">${escapeHtml(COMPANY.email)}</div></div>
      <div><label>Web</label><div class="input" style="background:var(--surface-2);">${escapeHtml(COMPANY.web)}</div></div>
    </div>
  </div>

  <div class="card mb-12" style="margin-bottom:18px;">
    <div class="card-header"><div class="card-title"><span class="dot"></span> Mantenimiento</div></div>
    <div class="flex" style="flex-wrap:wrap;gap:10px;">
      <button class="btn btn-ghost btn-sm" id="backup-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Descargar respaldo (JSON)</button>
      <label class="btn btn-ghost btn-sm" style="cursor:pointer;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Restaurar respaldo <input type="file" id="restore-input" accept=".json" style="display:none;" /></label>
      <button class="btn btn-danger btn-sm" id="clear-all-btn">Borrar todas las cotizaciones</button>
    </div>
    <div class="text-xs text-muted" style="margin-top:8px;">Los datos se guardan localmente en el navegador. Te recomendamos descargar un respaldo periódicamente.</div>
  </div>
  `;
}
function bindConfig() {
  $('#add-vendor-btn').addEventListener('click', () => openVendorModal());
  $$('.vendor-row').forEach(row => {
    const idx = parseInt(row.dataset.idx);
    row.querySelector('[data-action="edit-vendor"]').addEventListener('click', () => openVendorModal(idx));
    row.querySelector('[data-action="del-vendor"]').addEventListener('click', () => {
      const v = state.vendors[idx];
      if (confirm(`¿Eliminar al vendedor "${v.name}"?\n\nLas cotizaciones existentes mantienen su nombre, pero no se podrá asignar más cotizaciones a este vendedor.`)) {
        state.vendors.splice(idx, 1);
        saveStorage();
        render();
        toast('Vendedor eliminado', 'info');
      }
    });
  });
  $('#backup-btn').addEventListener('click', () => {
    const data = { cotizaciones: state.cotizaciones, vendors: state.vendors, clientes: state.clientes, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `respaldo_equilec_${todayISO()}.json`; a.click();
    URL.revokeObjectURL(url);
    toast('Respaldo descargado', 'success');
  });
  $('#restore-input').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    if (!confirm('¿Reemplazar los datos actuales con el archivo seleccionado? Esto sobrescribirá las cotizaciones existentes.')) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      state.cotizaciones = data.cotizaciones || [];
      state.vendors = data.vendors || DEFAULT_VENDORS.slice();
      state.clientes = data.clientes || [];
      saveStorage();
      toast('Respaldo restaurado correctamente', 'success');
      render();
    } catch (err) {
      toast('Error al leer el archivo', 'error');
    }
  });
  $('#clear-all-btn').addEventListener('click', () => {
    if (!confirm('¿Eliminar TODAS las cotizaciones? Esta acción no se puede deshacer.')) return;
    if (!confirm('Confirma una vez más: ¿Borrar todas las cotizaciones?')) return;
    state.cotizaciones = [];
    saveStorage();
    toast('Cotizaciones eliminadas', 'info');
    render();
  });
}
function openVendorModal(idx) {
  const v = idx != null ? { ...state.vendors[idx] } : { name: '', email: '', phone: '', role: '' };
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.55);z-index:60;display:grid;place-items:center;padding:20px;';
  modal.innerHTML = `<div class="card" style="max-width:460px;width:100%;">
    <div class="card-header"><div class="card-title"><span class="dot"></span> ${idx != null ? 'Editar' : 'Agregar'} vendedor</div></div>
    <div class="field"><label>Nombre completo *</label><input class="input" id="v-name" value="${escapeHtml(v.name)}" placeholder="Ej: Andrés Cruz" /></div>
    <div class="field"><label>Rol / Cargo</label><input class="input" id="v-role" value="${escapeHtml(v.role)}" placeholder="Ej: Ventas Técnicas" /></div>
    <div class="field"><label>Email</label><input class="input" id="v-email" type="email" value="${escapeHtml(v.email)}" placeholder="vendedor@equilec.cl" /></div>
    <div class="field"><label>Teléfono</label><input class="input" id="v-phone" value="${escapeHtml(v.phone)}" placeholder="+56 9 ..." /></div>
    <div class="flex-end" style="margin-top:16px;"><button class="btn btn-ghost" id="v-cancel">Cancelar</button><button class="btn btn-primary" id="v-save">Guardar</button></div>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  modal.querySelector('#v-cancel').addEventListener('click', () => modal.remove());
  modal.querySelector('#v-save').addEventListener('click', () => {
    const name = modal.querySelector('#v-name').value.trim();
    if (!name) { toast('El nombre es obligatorio', 'error'); return; }
    const data = {
      name,
      role: modal.querySelector('#v-role').value.trim(),
      email: modal.querySelector('#v-email').value.trim(),
      phone: modal.querySelector('#v-phone').value.trim()
    };
    if (idx != null) state.vendors[idx] = data;
    else state.vendors.push(data);
    saveStorage();
    modal.remove();
    render();
    toast(`Vendedor ${idx != null ? 'actualizado' : 'agregado'}`, 'success');
  });
}

/* =========================================================================
   PDF GENERATION
   ========================================================================= */
async function loadLogoForPDF() {
  if (state.logoDataUrl) return state.logoDataUrl;
  try {
    const resp = await fetch('logo-equilec.png');
    const blob = await resp.blob();
    return new Promise(resolve => {
      const fr = new FileReader();
      fr.onload = () => { state.logoDataUrl = fr.result; resolve(fr.result); };
      fr.readAsDataURL(blob);
    });
  } catch (e) { console.warn('logo load failed', e); return null; }
}

async function generatePDF(cot) {
  if (!window.jspdf) { toast('Error cargando jsPDF', 'error'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const PAGE_W = 210, PAGE_H = 297, MARGIN = 14;

  // Equilec brand colors
  const NAVY = [0, 62, 118];
  const PRIMARY = [0, 88, 163];
  const ACCENT = [0, 174, 239];
  const INK = [10, 25, 41];
  const TEXT = [51, 65, 85];
  const MUTED = [100, 116, 139];
  const LIGHT = [244, 247, 251];
  const RULE = [203, 213, 225];
  const RULE_2 = [226, 232, 240];

  const totals = calcTotals(cot);
  const truncate = (s, n) => (s || '').length > n ? (s || '').slice(0, n - 1) + '…' : (s || '');

  // ============ HEADER ============
  const logoData = await loadLogoForPDF();
  if (logoData) {
    try { doc.addImage(logoData, 'PNG', MARGIN, 10, 42, 17, undefined, 'FAST'); }
    catch (e) { console.warn('logo embed failed', e); }
  }

  // Phase badge top-right
  const faseLabel = (FASES.find(f => f.id === cot.fase) || {}).label || cot.fase;
  const faseColors = { ofertado: ACCENT, aceptado: [16, 185, 129], rechazado: [220, 38, 38], cancelado: MUTED };
  const faseColor = faseColors[cot.fase] || PRIMARY;
  doc.setFillColor(...faseColor);
  doc.roundedRect(PAGE_W - MARGIN - 32, 12, 32, 6.5, 1.5, 1.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text(faseLabel.toUpperCase(), PAGE_W - MARGIN - 16, 16.4, { align: 'center' });

  // Quote number
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(`COTIZACIÓN N° ${cot.numero}`, PAGE_W - MARGIN, 24, { align: 'right' });
  doc.setTextColor(...MUTED);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(formatDateLong(cot.fecha), PAGE_W - MARGIN, 28.5, { align: 'right' });

  // Company info under logo
  doc.setTextColor(...MUTED);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.text(COMPANY.name + '  ·  RUT ' + COMPANY.rut, MARGIN, 32.5);
  doc.text(COMPANY.address, MARGIN, 35.5);
  doc.text(`Tel. ${COMPANY.phones}  ·  ${COMPANY.web}`, MARGIN, 38.5);

  // ============ ACCENT LINE ============
  let y = 43;
  doc.setDrawColor(...PRIMARY);
  doc.setLineWidth(0.8);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  doc.setDrawColor(...ACCENT);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y + 1.2, PAGE_W - MARGIN - 60, y + 1.2);

  // ============ CLIENT INFO ============
  y += 8;
  const labelStyle = () => { doc.setFont('helvetica', 'bold'); doc.setFontSize(6.8); doc.setTextColor(...MUTED); };
  const valueStyle = (bold = false) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(9.3); doc.setTextColor(...INK); };

  labelStyle();
  doc.text('FACTURADO A', MARGIN, y);
  doc.text('RUT', MARGIN + 95, y);
  doc.text('VALIDEZ', MARGIN + 135, y);
  doc.text('VENDEDOR', MARGIN + 165, y);
  valueStyle(true);
  doc.text(truncate(cot.cliente.nombre || '—', 48), MARGIN, y + 4.6);
  valueStyle(false);
  doc.text(cot.cliente.rut || '—', MARGIN + 95, y + 4.6);
  doc.text(cot.validez || '—', MARGIN + 135, y + 4.6);
  doc.text(truncate(cot.vendor || '—', 22), MARGIN + 165, y + 4.6);

  y += 9.5;
  labelStyle();
  doc.text('DIRECCIÓN', MARGIN, y);
  doc.text('CONTACTO', MARGIN + 95, y);
  doc.text('EMAIL', MARGIN + 135, y);
  valueStyle(false);
  doc.text(truncate(cot.cliente.direccion || '—', 48), MARGIN, y + 4.6);
  doc.text(truncate(cot.cliente.fono || '—', 22), MARGIN + 95, y + 4.6);
  doc.text(truncate(cot.cliente.email || '—', 30), MARGIN + 135, y + 4.6);

  y += 9.5;
  labelStyle();
  doc.text('CONDICIÓN DE PAGO', MARGIN, y);
  doc.text('PLAZO DE ENTREGA', MARGIN + 95, y);
  doc.text('REFERENCIA', MARGIN + 135, y);
  valueStyle(true);
  doc.text(truncate(cot.condicionPago || '—', 48), MARGIN, y + 4.6);
  valueStyle(false);
  doc.text(truncate(cot.entrega || '—', 22), MARGIN + 95, y + 4.6);
  doc.text(truncate(cot.referencia || '—', 30), MARGIN + 135, y + 4.6);

  // Bottom rule
  y += 7;
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);

  // ============ ITEMS TABLE ============
  y += 4;
  const tableData = cot.items.filter(it => it.desc || it.sku || parseFloat(it.cantidad)).map(it => {
    const precio = calcPrecioUnit(it);
    const total = calcLineTotal(it);
    return [it.sku || '', it.desc || '', String(parseFloat(it.cantidad) || 0), formatCLP(precio), formatCLP(total)];
  });

  doc.autoTable({
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    head: [['CÓDIGO', 'DESCRIPCIÓN', 'CANT.', 'P. UNITARIO', 'TOTAL NETO']],
    body: tableData.length ? tableData : [['', 'Sin items', '', '', '']],
    theme: 'plain',
    headStyles: { fillColor: PRIMARY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.8, halign: 'left', cellPadding: { top: 3.2, right: 3, bottom: 3.2, left: 3 } },
    bodyStyles: { fontSize: 9, textColor: TEXT, cellPadding: { top: 3.2, right: 3, bottom: 3.2, left: 3 }, lineColor: RULE_2, lineWidth: { bottom: 0.2 } },
    alternateRowStyles: { fillColor: LIGHT },
    columnStyles: {
      0: { cellWidth: 28, font: 'courier', fontSize: 8.5, textColor: MUTED },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 14, halign: 'center' },
      3: { cellWidth: 30, halign: 'right' },
      4: { cellWidth: 32, halign: 'right', fontStyle: 'bold', textColor: INK }
    },
    didParseCell: (data) => {
      if (data.section === 'head') {
        if (data.column.index === 2) data.cell.styles.halign = 'center';
        if (data.column.index >= 3) data.cell.styles.halign = 'right';
      }
    }
  });
  y = doc.lastAutoTable.finalY + 4;

  // ============ TOTALS ============
  const tBoxX = PAGE_W - MARGIN - 70;
  const tBoxW = 70;
  doc.setTextColor(...TEXT);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Subtotal', tBoxX + 2, y + 4);
  doc.setFont('helvetica', 'bold');
  doc.text(formatCLP(totals.subtotal), tBoxX + tBoxW - 2, y + 4, { align: 'right' });

  if (totals.descuentoPct > 0) {
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...MUTED);
    doc.text(`Descuento (${totals.descuentoPct}%)`, tBoxX + 2, y + 4);
    doc.text('−' + formatCLP(totals.descuentoMonto), tBoxX + tBoxW - 2, y + 4, { align: 'right' });
  }
  y += 5;
  doc.setTextColor(...TEXT);
  doc.setFont('helvetica', 'normal');
  doc.text('Neto', tBoxX + 2, y + 4);
  doc.setFont('helvetica', 'bold');
  doc.text(formatCLP(totals.neto), tBoxX + tBoxW - 2, y + 4, { align: 'right' });
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.text('I.V.A. 19%', tBoxX + 2, y + 4);
  doc.setFont('helvetica', 'bold');
  doc.text(formatCLP(totals.iva), tBoxX + tBoxW - 2, y + 4, { align: 'right' });

  // TOTAL bar
  y += 6;
  doc.setFillColor(...NAVY);
  doc.rect(tBoxX, y, tBoxW, 10, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('TOTAL', tBoxX + 2.5, y + 6.5);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12.5);
  doc.text(formatCLP(totals.total), tBoxX + tBoxW - 2.5, y + 7, { align: 'right' });

  // ============ OBSERVATIONS ============
  y += 16;
  if (cot.observacion) {
    doc.setTextColor(...MUTED);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text('OBSERVACIONES', MARGIN, y);
    doc.setTextColor(...TEXT);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    const obsLines = doc.splitTextToSize(cot.observacion, PAGE_W - MARGIN * 2);
    doc.text(obsLines, MARGIN, y + 4);
    y += 4 + obsLines.length * 4;
  }
  y += 4;

  // ============ CONDITIONS / BANK ============
  const condW = 108;
  doc.setFillColor(...LIGHT);
  doc.rect(MARGIN, y, condW, 32, 'F');
  doc.setDrawColor(...PRIMARY);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, y, MARGIN + condW, y);
  doc.setLineWidth(0.2);
  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text('CONDICIONES COMERCIALES', MARGIN + 3, y + 5);
  doc.setTextColor(...TEXT);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.3);
  const conds = [
    `• Condición de pago: ${cot.condicionPago}`,
    `• Validez de la cotización: ${cot.validez}`,
    `• Plazo de entrega: ${cot.entrega}`,
    `• Precios netos no incluyen IVA (19%).`,
    `• Material entregado en bodega Equilec, La Florida, Santiago.`
  ];
  let cy = y + 9;
  conds.forEach(c => { const lines = doc.splitTextToSize(c, condW - 6); doc.text(lines, MARGIN + 3, cy); cy += lines.length * 3.4; });

  // Vendor contact box (right) — navy
  const bankX = MARGIN + condW + 4;
  const bankW = PAGE_W - MARGIN - bankX;
  doc.setFillColor(...NAVY);
  doc.rect(bankX, y, bankW, 32, 'F');
  doc.setTextColor(180, 200, 230);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text('SU EJECUTIVO COMERCIAL', bankX + 3, y + 5);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(cot.vendor || '—', bankX + 3, y + 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  const vendorInfo = state.vendors.find(v => v.name === cot.vendor);
  if (vendorInfo) {
    if (vendorInfo.role) doc.text(vendorInfo.role, bankX + 3, y + 14);
    if (vendorInfo.email) doc.text(vendorInfo.email, bankX + 3, y + 18);
    if (vendorInfo.phone) doc.text(vendorInfo.phone, bankX + 3, y + 22);
  }
  doc.setTextColor(180, 200, 230);
  doc.setFontSize(6.5);
  doc.text(COMPANY.shortName + ' · ' + COMPANY.email, bankX + 3, y + 28);

  // Thank you message
  y += 40;
  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(10);
  doc.text('Gracias por preferir Equilec.', MARGIN, y);
  doc.setTextColor(...MUTED);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text('Quedamos atentos a sus consultas y comentarios.', MARGIN, y + 3.5);

  // Footer bar
  doc.setFillColor(...NAVY);
  doc.rect(0, PAGE_H - 6, PAGE_W, 6, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text(`${COMPANY.web}  ·  ${COMPANY.email}  ·  Cotización COT-${cot.numero} generada el ${formatDate(new Date())}`, PAGE_W / 2, PAGE_H - 2, { align: 'center' });

  // ============ PAGE 2 — Condiciones Generales ============
  doc.addPage();
  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('Condiciones Generales de Suministro', MARGIN, 18);
  doc.setDrawColor(...PRIMARY);
  doc.setLineWidth(0.6);
  doc.line(MARGIN, 21, MARGIN + 80, 21);

  doc.setTextColor(...TEXT);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('Precio y Condiciones de Pago', MARGIN, 28);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const cgp = [
    'Los precios son netos y no incluyen el impuesto al valor agregado (IVA).',
    'El precio será facturado contra despacho o retiro de material o prestación del servicio.',
    'El pago se considera según plazo acordado a partir de la fecha de emisión de la factura.',
    'La condición de pago está sujeta a confirmación de nuestra área de finanzas.',
    'En oferta en USD u otra moneda extranjera, el pago será su equivalente en moneda nacional a la fecha de facturación.',
    'En caso de pago fuera de la fecha de vencimiento, devengará interés por mora equivalente al interés máximo convencional anual.'
  ];
  let py = 31;
  cgp.forEach(t => { const lines = doc.splitTextToSize('• ' + t, PAGE_W - MARGIN * 2); doc.text(lines, MARGIN, py); py += lines.length * 3.6; });

  py += 3;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('Plazos y Lugar de Entrega', MARGIN, py); py += 3.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const cge = [
    'El cumplimiento de plazos de entrega está supeditado al recibo a tiempo de documentación, anticipos, permisos, validación de planos y demás obligaciones del cliente.',
    'El plazo de entrega se cuenta a partir de la recepción de la orden de compra confirmada por Equilec.',
    'Los suministros serán entregados sobre camión en bodega Equilec, Picton 8973, La Florida, Santiago, salvo acuerdo contrario.',
    'El cliente es responsable del material una vez despachado de las oficinas de Equilec.',
    'El cliente debe revisar las hojas técnicas de cada equipo antes de su encargo, adquisición y utilización.'
  ];
  cge.forEach(t => { const lines = doc.splitTextToSize('• ' + t, PAGE_W - MARGIN * 2); doc.text(lines, MARGIN, py); py += lines.length * 3.6; });

  py += 3;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('Garantía', MARGIN, py); py += 3.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const cgg = [
    'Equilec otorga una garantía válida por 6 meses desde la fecha de facturación. En proyectos o fabricación de productos podrá variar y se especificará en la oferta.',
    'La garantía cubre defectos de materiales o de fabricación. Excluye desgaste normal, mal uso, intervenciones no autorizadas, exposición a fuego/agua/humedad, o configuraciones inadecuadas.',
    'La reparación o cambio no prolonga ni renueva la garantía.',
    'La garantía queda limitada al valor y a los productos de la venta y orden acordada.'
  ];
  cgg.forEach(t => { const lines = doc.splitTextToSize('• ' + t, PAGE_W - MARGIN * 2); doc.text(lines, MARGIN, py); py += lines.length * 3.6; });

  py += 3;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('Devolución o Cambio', MARGIN, py); py += 3.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const cgd = [
    'El cliente puede tramitar devolución o cambio coordinando con su vendedor y enviando el producto a nuestra oficina en Picton 8973, La Florida, Santiago, con guía de despacho mencionando el número de factura y dentro del plazo legal de 90 días.',
    'El producto será sometido a revisión y deberá ser aprobado para iniciar el proceso de nota de crédito. No se recibirá material usado, sin embalaje, sin sellos o faltos de accesorios o manuales.',
    'Los costos de traslado a Equilec son de cargo del cliente.'
  ];
  cgd.forEach(t => { const lines = doc.splitTextToSize('• ' + t, PAGE_W - MARGIN * 2); doc.text(lines, MARGIN, py); py += lines.length * 3.6; });

  py += 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('Aceptación de Condiciones Generales de Suministro', MARGIN, py); py += 3.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const cga = 'La adjudicación de la oferta o la emisión por parte del cliente de la orden de compra supone la aceptación formal de todas las condiciones señaladas en el presente documento.';
  const cgaLines = doc.splitTextToSize(cga, PAGE_W - MARGIN * 2);
  doc.text(cgaLines, MARGIN, py);

  // Footer on page 2
  doc.setFillColor(...NAVY);
  doc.rect(0, PAGE_H - 6, PAGE_W, 6, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text(`${COMPANY.web}  ·  ${COMPANY.email}  ·  Cotización COT-${cot.numero} - Página 2/2`, PAGE_W / 2, PAGE_H - 2, { align: 'center' });

  // SAVE PDF
  const safeName = (cot.cliente.nombre || 'cliente').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
  doc.save(`COT-${cot.numero}_${safeName}.pdf`);
  toast('PDF generado correctamente', 'success');
}

/* =========================================================================
   INIT
   ========================================================================= */
loadStorage();
if (state.session) state.view = 'cotizador';
navigate(state.view);
