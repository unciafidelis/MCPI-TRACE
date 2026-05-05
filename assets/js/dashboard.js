import { CALENDAR_TYPES, DAY_LABELS, DEFAULT_STATE } from './constants.js';
import { parseReferenceCsv } from './csvService.js';
import { recomputeState, selectWeekFromStoredReports } from './attendanceService.js';
import {
  buildCsv,
  cssStatus,
  downloadTextFile,
  escapeHtml,
  formatDateShort,
  formatWeekRange,
  makeId,
  minutesToReadable,
  percent,
  readTextFile
} from './utils.js';
import {
  buildPublicState,
  clearAppState,
  clearSession,
  getAppState,
  getSession,
  hydrateFromPublicState,
  saveAppState
} from './storage.js';

let state = getAppState();
let session = getSession();
let currentView = 'overview';

const screenTitle = document.querySelector('#screenTitle');
const roleBadge = document.querySelector('#roleBadge');
const summaryCards = document.querySelector('#summaryCards');
const statusBars = document.querySelector('#statusBars');
const dataSourceLabel = document.querySelector('#dataSourceLabel');
const studentList = document.querySelector('#studentList');
const incidentList = document.querySelector('#incidentList');
const referenceResult = document.querySelector('#referenceResult');
const datResult = document.querySelector('#datResult');
const searchInput = document.querySelector('#searchInput');
const statusFilter = document.querySelector('#statusFilter');
const weekSelector = document.querySelector('#weekSelector');
const weekContextPanel = document.querySelector('#weekContextPanel');
const calendarForm = document.querySelector('#calendarForm');
const calendarList = document.querySelector('#calendarList');
const calendarType = document.querySelector('#calendarType');
const calendarStart = document.querySelector('#calendarStart');
const calendarEnd = document.querySelector('#calendarEnd');
const calendarLabel = document.querySelector('#calendarLabel');

function assertSession() {
  if (!session?.role) {
    window.location.href = './index.html';
    return false;
  }
  return true;
}

function isCoordinator() {
  return session?.role === 'coordinador';
}

function setResult(element, message, type = 'muted') {
  if (!element) return;
  element.className = `result-box ${type}`;
  element.innerHTML = message;
}

function setView(viewName) {
  currentView = viewName;
  document.querySelectorAll('.view').forEach((view) => view.classList.remove('active'));
  document.querySelector(`#view-${viewName}`)?.classList.add('active');
  document.querySelectorAll('.nav-link').forEach((button) => button.classList.toggle('active', button.dataset.view === viewName));
  const activeView = document.querySelector(`#view-${viewName}`);
  screenTitle.textContent = activeView?.dataset.title || 'Panel';
  document.body.classList.remove('menu-open');
}

function initializeRoleMode() {
  document.body.classList.toggle('student-mode', !isCoordinator());
  roleBadge.textContent = isCoordinator() ? 'Coordinación' : 'Alumno';
  if (!isCoordinator()) setView('students');
}

function emptyState(icon, title, description) {
  return `
    <div class="empty-state">
      <span class="material-symbols-rounded">${icon}</span>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(description)}</p>
    </div>
  `;
}

function getAvailableWeeks() {
  const reports = Array.isArray(state.weeklyReports) ? state.weeklyReports : [];
  const weeksFromReports = reports.map((report) => report.weekStart).filter(Boolean);
  const weeksFromContext = state.weekContext?.availableWeeks || [];
  return [...new Set([...weeksFromContext, ...weeksFromReports])].sort((a, b) => b.localeCompare(a));
}

function renderWeekSelector() {
  const weeks = getAvailableWeeks();
  if (!weekSelector) return;

  if (!weeks.length) {
    weekSelector.innerHTML = '<option value="">Sin semanas DAT</option>';
    weekSelector.disabled = true;
    weekSelector.title = 'Carga un archivo .dat con fechas reconocibles para habilitar la selección de semana.';
    return;
  }

  weekSelector.disabled = false;
  weekSelector.title = 'Semanas detectadas dentro del archivo .dat.';
  weekSelector.innerHTML = weeks.map((weekStart) => {
    const report = state.weeklyReports?.find((item) => item.weekStart === weekStart);
    const label = report?.weekContext?.selectedWeekLabel || formatWeekRange(weekStart);
    return `<option value="${escapeHtml(weekStart)}">${escapeHtml(label)}</option>`;
  }).join('');
  weekSelector.value = state.selectedWeekStart || weeks[0];
}

function getFilteredSummaries() {
  const search = String(searchInput?.value || '').trim().toLowerCase();
  const status = String(statusFilter?.value || '').trim();

  return [...state.summaries]
    .filter((row) => {
      const searchable = `${row.cvu} ${row.checkerId} ${row.studentName}`.toLowerCase();
      const matchesSearch = !search || searchable.includes(search);
      const matchesStatus = !status || row.status === status;
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      const order = { 'No cumple': 1, 'Requiere revisión': 2, 'Sin DAT': 3, 'Sin actividad': 4, Cumple: 5 };
      return (order[a.status] || 9) - (order[b.status] || 9) || a.cvu.localeCompare(b.cvu);
    });
}

function renderSummaryCards() {
  const weekLabel = state.weekContext?.selectedWeekLabel || formatWeekRange(state.selectedWeekStart);
  const cards = [
    { icon: 'date_range', label: 'Semana activa', value: weekLabel },
    { icon: 'groups', label: 'CVU registrados', value: state.stats.totalStudents || 0 },
    { icon: 'task_alt', label: 'Cumplen meta', value: state.stats.meetsTarget || 0 },
    { icon: 'warning', label: 'No cumplen', value: state.stats.belowTarget || 0 },
    { icon: 'rate_review', label: 'Revisión / sin DAT', value: (state.stats.needsReview || 0) + (state.stats.noDat || 0) },
    { icon: 'event_busy', label: 'Sin actividad', value: state.stats.noActivity || 0 },
    { icon: 'query_stats', label: 'Cumplimiento promedio', value: `${state.stats.avgCompliancePercent || 0}%` },
    { icon: 'calendar_month', label: 'Eventos de calendario', value: state.stats.calendarEvents || 0 }
  ];

  summaryCards.innerHTML = cards.map((card) => `
    <article class="summary-card">
      <span class="summary-icon material-symbols-rounded">${card.icon}</span>
      <div>
        <strong>${escapeHtml(card.value)}</strong>
        <span>${escapeHtml(card.label)}</span>
      </div>
    </article>
  `).join('');
}

function renderStatusBars() {
  const total = state.stats.totalStudents || 0;
  const rows = [
    { label: 'Cumple', value: state.stats.meetsTarget || 0, className: 'cumple' },
    { label: 'No cumple', value: state.stats.belowTarget || 0, className: 'no-cumple' },
    { label: 'Requiere revisión', value: state.stats.needsReview || 0, className: 'revision' },
    { label: 'Sin DAT', value: state.stats.noDat || 0, className: 'sin-dat' },
    { label: 'Sin actividad', value: state.stats.noActivity || 0, className: 'sin-actividad' }
  ];

  dataSourceLabel.textContent = state.upload.fileName
    ? `DAT activo: ${state.upload.fileName}`
    : state.reference.fileName
      ? `Referencia activa: ${state.reference.fileName}`
      : 'Sin datos cargados';

  if (!total) {
    statusBars.innerHTML = emptyState('hourglass_empty', 'Sin datos para graficar', 'Carga una tabla de referencia CSV para iniciar el seguimiento.');
    return;
  }

  statusBars.innerHTML = rows.map((row) => {
    const width = total ? percent((row.value / total) * 100) : 0;
    return `
      <div class="progress-row">
        <div class="progress-label"><span>${escapeHtml(row.label)}</span><strong>${row.value} · ${width}%</strong></div>
        <div class="progress-track"><div class="progress-fill ${row.className}" style="width:${Math.min(width, 100)}%"></div></div>
      </div>
    `;
  }).join('');
}

function renderWeekContext() {
  if (!weekContextPanel) return;
  const context = state.weekContext || {};
  const activeEntries = context.activeCalendarEntries || [];
  const excluded = context.excludedExpectedMinutes || 0;

  weekContextPanel.innerHTML = `
    <div class="week-context-grid">
      <article>
        <span class="material-symbols-rounded">calendar_today</span>
        <strong>${escapeHtml(context.selectedWeekLabel || 'Semana no seleccionada')}</strong>
        <small>Periodo de seguimiento activo</small>
      </article>
      <article>
        <span class="material-symbols-rounded">work_history</span>
        <strong>${escapeHtml(context.workingDays ?? 0)} días</strong>
        <small>Días hábiles considerados de lunes a sábado</small>
      </article>
      <article>
        <span class="material-symbols-rounded">event_busy</span>
        <strong>${escapeHtml(minutesToReadable(excluded))}</strong>
        <small>Meta descontada por asuetos, inhábiles o vacaciones</small>
      </article>
    </div>
    ${activeEntries.length ? `
      <div class="calendar-active-list">
        ${activeEntries.map((entry) => `
          <span class="calendar-chip ${escapeHtml(entry.type)}">
            ${escapeHtml(CALENDAR_TYPES[entry.type] || entry.type)} · ${escapeHtml(formatDateShort(entry.startDate))}${entry.startDate !== entry.endDate ? ` – ${escapeHtml(formatDateShort(entry.endDate))}` : ''}
          </span>
        `).join('')}
      </div>
    ` : '<p class="muted-copy">La semana seleccionada no tiene asuetos, días inhábiles ni periodos vacacionales registrados.</p>'}
  `;
}

function formatClock(value) {
  const text = String(value || '').trim();
  return text ? text.slice(0, 5) : 'N/D';
}

function dayCellClass(day) {
  const classes = ['day-cell', 'day-flip'];
  if (day.dailyStatusCode) classes.push(day.dailyStatusCode);
  if (day.isNonWorking) classes.push('non-working');
  if (day.dailyIncidentType || day.dailyInconsistencyLabel) classes.push('has-incident');
  if (!day.eventCount) classes.push('no-registers');
  return classes.join(' ');
}

function dayStatusLabel(day) {
  if (day.dailyStatusLabel) return day.dailyStatusLabel;
  if (day.dailyIncidentType) return day.dailyIncidentType;
  if (day.eventCount > 0) return 'Ingreso completado';
  if (day.isNonWorking) return 'No laborable';
  return 'Sin registro';
}

function renderEventTimeline(events = []) {
  if (!events.length) return '<span class="day-event-empty">Sin marcajes registrados</span>';
  return events.map((event) => `
    <span class="day-event-pill ${escapeHtml(event.eventType || 'unknown')}">
      ${escapeHtml(event.displayTime || formatClock(event.eventTime))} · ${escapeHtml(event.eventLabel || 'Tipo DAT no reconocido')}
    </span>
  `).join('');
}

function renderDayCard(day) {
  const statusLabel = dayStatusLabel(day);
  const incident = day.dailyIncidentMessage || (day.eventCount ? '' : 'No hay marcajes registrados para este día.');

  return `
    <button type="button" class="${escapeHtml(dayCellClass(day))}" data-day-flip aria-pressed="false" aria-label="Ver detalle de ${escapeHtml(day.dayLabel)}">
      <span class="day-card-inner">
        <span class="day-card-face day-card-front">
          <span class="day-card-head">
            <strong>${escapeHtml(day.dayLabel)}</strong>
            <em>${escapeHtml(statusLabel)}</em>
          </span>
          <small>${escapeHtml(formatDateShort(day.date))}</small>
          <span>Real: ${escapeHtml(minutesToReadable(day.realMinutes))}</span>
          <span>Meta: ${escapeHtml(minutesToReadable(day.expectedMinutes))}</span>
          ${day.isNonWorking ? `<mark>${escapeHtml(day.calendarLabel)}</mark>` : ''}
          <i>Presiona para ver entrada/salida</i>
        </span>
        <span class="day-card-face day-card-back">
          <span class="day-card-head">
            <strong>Detalle real</strong>
            <em>${escapeHtml(minutesToReadable(day.realMinutes))}</em>
          </span>
          <small>Tipo: ${escapeHtml(day.dailyAttendanceType || statusLabel)}</small>
          <small>Entrada: ${escapeHtml(formatClock(day.entryTime))}</small>
          <small>Salida: ${escapeHtml(formatClock(day.exitTime))}</small>
          <small>Marcajes: ${escapeHtml(day.eventCount || 0)}</small>
          ${day.dailyInconsistencyLabel ? `<mark>${escapeHtml(day.dailyInconsistencyLabel)}</mark>` : ''}
          <span class="day-rule">${escapeHtml(day.calculationRule || 'Sin regla aplicada.')}</span>
          <span class="day-events">${renderEventTimeline(day.events)}</span>
          ${incident ? `<b class="day-alert">${escapeHtml(incident)}</b>` : ''}
        </span>
      </span>
    </button>
  `;
}

function renderStudents() {
  const rows = getFilteredSummaries();

  if (!rows.length) {
    studentList.innerHTML = emptyState('manage_search', 'No hay CVU para mostrar', 'Carga datos o ajusta los filtros de búsqueda.');
    return;
  }

  studentList.innerHTML = rows.map((row) => {
    const barWidth = Math.min(row.compliancePercent || 0, 100);
    const statusClass = cssStatus(row.status);
    const dayGrid = (row.dayDetails || []).map((day) => renderDayCard(day)).join('');

    return `
      <article class="student-card">
        <div class="student-main">
          <div>
            <h3>CVU ${escapeHtml(row.cvu)}</h3>
            <small>${escapeHtml(row.studentName)} · ID checador: ${escapeHtml(row.checkerId)}</small>
          </div>
          <span class="status-badge ${statusClass}">${escapeHtml(row.status)}</span>
        </div>
        <div class="student-meta">
          <span class="metric-chip">Horas: <strong>${escapeHtml(row.realLabel || minutesToReadable(row.realTotalMinutes))}</strong></span>
          <span class="metric-chip">Meta ajustada: <strong>${escapeHtml(row.expectedLabel || minutesToReadable(row.expectedTotalMinutes))}</strong></span>
          <span class="metric-chip">Meta base diaria: <strong>${escapeHtml(row.baseExpectedLabel || minutesToReadable(row.baseExpectedTotalMinutes))}</strong></span>
          <span class="metric-chip">Diferencia: <strong>${escapeHtml(row.varianceLabel || minutesToReadable(row.varianceMinutes))}</strong></span>
          <span class="metric-chip">Avance: <strong>${escapeHtml(row.compliancePercent)}%</strong></span>
        </div>
        <div>
          <div class="progress-label"><span>Progreso semanal según metas base por día</span><strong>${escapeHtml(row.compliancePercent)}%</strong></div>
          <div class="progress-track"><div class="progress-fill" style="width:${barWidth}%"></div></div>
        </div>
        <div class="day-grid">${dayGrid}</div>
        ${row.incidentSummary ? `<small class="alert">${escapeHtml(row.incidentSummary)}</small>` : ''}
      </article>
    `;
  }).join('');
}

function renderIncidents() {
  if (!state.incidents.length) {
    incidentList.innerHTML = emptyState('verified', 'Sin incidencias', 'No se detectaron registros corruptos, pares incompletos, identificadores sin vínculo ni marcajes en días no laborables.');
    return;
  }

  incidentList.innerHTML = state.incidents.map((incident) => `
    <article class="incident-item">
      <span class="material-symbols-rounded">report</span>
      <div>
        <strong>${escapeHtml(incident.type)} · ${escapeHtml(incident.priority)}</strong>
        <p>${escapeHtml(incident.message)}</p>
        <p>CVU: ${escapeHtml(incident.cvu || 'N/D')} · ID: ${escapeHtml(incident.checkerId || 'N/D')} · Fecha: ${escapeHtml(incident.date || 'N/D')}</p>
      </div>
    </article>
  `).join('');
}

function renderLoadStatus() {
  if (state.reference.fileName) {
    setResult(
      referenceResult,
      `<strong>${escapeHtml(state.reference.fileName)}</strong><br>${state.reference.rows.length} filas válidas · ${state.reference.invalid.length} filas rechazadas.`,
      'success'
    );
  } else {
    setResult(referenceResult, 'Sin CSV cargado.', 'muted');
  }

  if (state.upload.fileName) {
    const availableWeeks = state.weekContext?.availableWeeks || [];
    const baseMessage = `<strong>${escapeHtml(state.upload.fileName)}</strong><br>${state.upload.validLines} eventos válidos · ${state.upload.invalidLines} líneas inválidas · ${state.upload.duplicatedLines || 0} duplicados empalmados.`;
    const weekMessage = availableWeeks.length
      ? `<br>Semanas detectadas: ${availableWeeks.map((week) => escapeHtml(formatWeekRange(week))).join(' | ')}.`
      : '<br>No se detectó ninguna semana evaluable dentro del .dat. Revisa que las líneas contengan ID, fecha y hora.';
    setResult(
      datResult,
      `${baseMessage}${weekMessage}`,
      availableWeeks.length ? 'success' : 'danger'
    );
  } else {
    setResult(datResult, 'Sin .dat cargado. No hay semana evaluable.', 'muted');
  }
}

function renderCalendar() {
  if (!calendarList) return;
  const entries = [...(state.calendar?.entries || [])].sort((a, b) => b.startDate.localeCompare(a.startDate));

  if (!entries.length) {
    calendarList.innerHTML = emptyState('event_available', 'Sin registros de calendario', 'Agrega días de asueto, días inhábiles o periodos vacacionales para ajustar la meta semanal automáticamente.');
    return;
  }

  calendarList.innerHTML = entries.map((entry) => `
    <article class="calendar-item">
      <div>
        <span class="calendar-chip ${escapeHtml(entry.type)}">${escapeHtml(CALENDAR_TYPES[entry.type] || entry.type)}</span>
        <h3>${escapeHtml(entry.label || CALENDAR_TYPES[entry.type] || 'Evento de calendario')}</h3>
        <p>${escapeHtml(formatDateShort(entry.startDate))}${entry.startDate !== entry.endDate ? ` – ${escapeHtml(formatDateShort(entry.endDate))}` : ''}</p>
      </div>
      <button class="icon-button danger-icon" data-calendar-delete="${escapeHtml(entry.id)}" aria-label="Eliminar evento de calendario">
        <span class="material-symbols-rounded">delete</span>
      </button>
    </article>
  `).join('');
}

function renderAll() {
  renderWeekSelector();
  renderSummaryCards();
  renderStatusBars();
  renderWeekContext();
  renderStudents();
  renderIncidents();
  renderLoadStatus();
  renderCalendar();
}

async function handleReferenceFile(file) {
  const content = await readTextFile(file);
  const parsed = parseReferenceCsv(content, file.name);
  state = saveAppState(recomputeState({
    ...state,
    reference: {
      fileName: file.name,
      importedAt: new Date().toISOString(),
      rows: parsed.rows,
      invalid: parsed.invalid
    }
  }));
  renderAll();
}

async function handleDatFile(file) {
  const content = await readTextFile(file);
  state = saveAppState(recomputeState({
    ...state,
    selectedWeekStart: null,
    upload: {
      ...state.upload,
      fileName: file.name,
      importedAt: new Date().toISOString(),
      rawContent: content
    }
  }));
  renderAll();
}

function exportPublicState() {
  const publicState = buildPublicState(state);
  downloadTextFile('public-state.json', JSON.stringify(publicState, null, 2), 'application/json;charset=utf-8');
}

function exportStudentCsv() {
  const csv = buildCsv(getFilteredSummaries(), [
    { label: 'Semana', value: () => state.weekContext?.selectedWeekLabel || '' },
    { label: 'CVU', value: (row) => row.cvu },
    { label: 'Nombre', value: (row) => row.studentName },
    { label: 'ID Checador', value: (row) => row.checkerId },
    { label: 'Horas reales', value: (row) => minutesToReadable(row.realTotalMinutes) },
    { label: 'Meta ajustada', value: (row) => minutesToReadable(row.expectedTotalMinutes) },
    { label: 'Meta base', value: (row) => minutesToReadable(row.baseExpectedTotalMinutes) },
    { label: 'Diferencia', value: (row) => minutesToReadable(row.varianceMinutes) },
    { label: 'Cumplimiento %', value: (row) => row.compliancePercent },
    { label: 'Estatus', value: (row) => row.status },
    { label: 'Incidencias', value: (row) => row.incidentSummary || '' }
  ]);
  downloadTextFile('mcpi-cumplimiento-cvu-semanal.csv', csv, 'text/csv;charset=utf-8');
}

async function importPublicState(file) {
  const content = await readTextFile(file);
  const parsed = JSON.parse(content);
  state = saveAppState(recomputeState({ ...DEFAULT_STATE, ...parsed, source: 'json-importado' }));
  renderAll();
}

function addCalendarEntry(event) {
  event.preventDefault();
  if (!isCoordinator()) return;

  const startDate = calendarStart.value;
  const endDate = calendarEnd.value || calendarStart.value;
  const type = calendarType.value || 'inhabil';
  const label = calendarLabel.value.trim() || CALENDAR_TYPES[type] || 'Día no laborable';

  if (!startDate || !endDate) {
    alert('Selecciona fecha inicial y fecha final.');
    return;
  }

  const entry = {
    id: makeId('calendar'),
    type,
    label,
    startDate: startDate <= endDate ? startDate : endDate,
    endDate: startDate <= endDate ? endDate : startDate,
    createdAt: new Date().toISOString()
  };

  state = saveAppState(recomputeState({
    ...state,
    calendar: {
      entries: [entry, ...(state.calendar?.entries || [])],
      lastUpdatedAt: new Date().toISOString()
    }
  }));

  calendarForm.reset();
  calendarType.value = 'asueto';
  renderAll();
}

function deleteCalendarEntry(entryId) {
  if (!isCoordinator()) return;
  const confirmed = window.confirm('¿Deseas eliminar este registro del calendario?');
  if (!confirmed) return;

  state = saveAppState(recomputeState({
    ...state,
    calendar: {
      entries: (state.calendar?.entries || []).filter((entry) => entry.id !== entryId),
      lastUpdatedAt: new Date().toISOString()
    }
  }));
  renderAll();
}

function wireEvents() {
  document.querySelectorAll('.nav-link').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.classList.contains('coordinator-only') && !isCoordinator()) return;
      setView(button.dataset.view);
    });
  });

  document.querySelector('#logoutButton').addEventListener('click', () => {
    clearSession();
    window.location.href = './index.html';
  });

  document.querySelector('#mobileMenuButton').addEventListener('click', () => {
    document.body.classList.toggle('menu-open');
  });

  document.querySelector('#refreshButton').addEventListener('click', async () => {
    state = await hydrateFromPublicState({ force: !isCoordinator() });
    state = saveAppState(recomputeState(state));
    renderAll();
  });

  document.querySelector('#printSummaryButton').addEventListener('click', () => window.print());
  document.querySelector('#exportPublicStateButton')?.addEventListener('click', exportPublicState);
  document.querySelector('#exportCsvButton')?.addEventListener('click', exportStudentCsv);

  weekSelector?.addEventListener('change', () => {
    const selectedWeekStart = weekSelector.value;
    state = state.upload?.rawContent
      ? saveAppState(recomputeState({ ...state, selectedWeekStart }))
      : saveAppState(selectWeekFromStoredReports({ ...state, selectedWeekStart }, selectedWeekStart));
    renderAll();
  });

  document.querySelector('#referenceFile')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await handleReferenceFile(file);
    } catch (error) {
      setResult(referenceResult, escapeHtml(error.message), 'danger');
    } finally {
      event.target.value = '';
    }
  });

  document.querySelector('#datFile')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await handleDatFile(file);
    } catch (error) {
      setResult(datResult, escapeHtml(error.message), 'danger');
    } finally {
      event.target.value = '';
    }
  });

  document.querySelector('#publicStateFile')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await importPublicState(file);
    } catch (error) {
      alert(`No fue posible importar el JSON: ${error.message}`);
    } finally {
      event.target.value = '';
    }
  });

  document.querySelector('#resetDataButton')?.addEventListener('click', () => {
    const confirmed = window.confirm('¿Deseas borrar los datos locales de este navegador? Esta acción no modifica el repositorio de GitHub Pages.');
    if (!confirmed) return;
    clearAppState();
    state = saveAppState(DEFAULT_STATE);
    renderAll();
  });

  calendarForm?.addEventListener('submit', addCalendarEntry);
  calendarList?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-calendar-delete]');
    if (!button) return;
    deleteCalendarEntry(button.dataset.calendarDelete);
  });

  studentList?.addEventListener('click', (event) => {
    const dayCard = event.target.closest('[data-day-flip]');
    if (!dayCard) return;
    const nextState = !dayCard.classList.contains('is-flipped');
    dayCard.classList.toggle('is-flipped', nextState);
    dayCard.setAttribute('aria-pressed', nextState ? 'true' : 'false');
  });

  searchInput?.addEventListener('input', renderStudents);
  statusFilter?.addEventListener('change', renderStudents);
}

async function init() {
  if (!assertSession()) return;
  state = await hydrateFromPublicState();
  state = saveAppState(recomputeState(state));
  session = getSession();
  initializeRoleMode();
  wireEvents();
  renderAll();
}

init();
