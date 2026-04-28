export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function nowIso() {
  return new Date().toISOString();
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function normalizeHeader(value = '') {
  return String(value)
    .replace(/^\uFEFF/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function toNumber(value, fallback = 0) {
  const normalized = String(value ?? '').trim().replace(',', '.');
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function hoursToMinutes(value) {
  return Math.round(toNumber(value) * 60);
}

export function pad(value) {
  return String(value).padStart(2, '0');
}

export function normalizeTime(input) {
  if (!input) return null;
  let value = String(input).trim();
  const embedded = value.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
  if (embedded) value = embedded[1];

  let match = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);

  if (!match && /^\d{4}$/.test(value)) {
    match = value.match(/^(\d{2})(\d{2})$/);
  }

  if (!match && /^\d{6}$/.test(value)) {
    match = value.match(/^(\d{2})(\d{2})(\d{2})$/);
  }

  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] || '0');
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function timeToMinutes(input) {
  const normalized = normalizeTime(input);
  if (!normalized) return 0;
  const [hours, minutes] = normalized.split(':').map(Number);
  return hours * 60 + minutes;
}

export function parseIsoDate(value) {
  const normalized = String(value || '').trim();
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (Number.isNaN(date.getTime())) return null;
  return formatIsoDate(date) === normalized ? date : null;
}

export function formatIsoDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toIsoDate(input) {
  if (!input) return null;
  const value = String(input).trim();

  const validate = (year, month, day) => {
    const iso = `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
    return parseIsoDate(iso) ? iso : null;
  };

  let match = value.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (match) return validate(Number(match[1]), Number(match[2]), Number(match[3]));

  match = value.match(/(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (match) return validate(Number(match[3]), Number(match[2]), Number(match[1]));

  match = value.match(/^\D*(\d{8})\D*$/);
  if (match) {
    const compact = match[1];
    const yearFirst = validate(Number(compact.slice(0, 4)), Number(compact.slice(4, 6)), Number(compact.slice(6, 8)));
    if (yearFirst) return yearFirst;
    return validate(Number(compact.slice(4, 8)), Number(compact.slice(2, 4)), Number(compact.slice(0, 2)));
  }

  return null;
}

export function addDaysIso(dateString, amount) {
  const date = parseIsoDate(dateString);
  if (!date) return null;
  date.setDate(date.getDate() + amount);
  return formatIsoDate(date);
}

export function getCurrentWeekStartIso() {
  return getWeekStartIso(formatIsoDate(new Date()));
}

export function getWeekStartIso(dateString) {
  const date = parseIsoDate(dateString);
  if (!date) return getCurrentWeekStartIso();
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return formatIsoDate(date);
}

export function getWeekEndIso(weekStart) {
  return addDaysIso(weekStart, 6);
}

export function getWeekDates(weekStart) {
  return Array.from({ length: 6 }, (_, index) => addDaysIso(weekStart, index));
}

export function dateInRange(dateString, startDate, endDate) {
  if (!dateString || !startDate || !endDate) return false;
  return dateString >= startDate && dateString <= endDate;
}

export function rangesOverlap(startA, endA, startB, endB) {
  if (!startA || !endA || !startB || !endB) return false;
  return startA <= endB && endA >= startB;
}

export function weekdayKeyFromIso(dateString) {
  const date = parseIsoDate(dateString);
  if (!date) return 'unknown';
  const day = date.getDay();
  const map = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return map[day] || 'unknown';
}

export function formatDateShort(dateString) {
  const date = parseIsoDate(dateString);
  if (!date) return 'N/D';
  return new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

export function formatWeekRange(weekStart, weekEnd = getWeekEndIso(weekStart)) {
  if (!weekStart) return 'Semana no seleccionada';
  return `${formatDateShort(weekStart)} – ${formatDateShort(weekEnd)}`;
}

export function minutesToReadable(totalMinutes = 0) {
  const sign = totalMinutes < 0 ? '-' : '';
  const absolute = Math.abs(Math.round(totalMinutes));
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  return `${sign}${hours}h ${pad(minutes)}m`;
}

export function minutesToCompact(totalMinutes = 0) {
  const sign = totalMinutes < 0 ? '-' : '';
  const absolute = Math.abs(Math.round(totalMinutes));
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  if (minutes === 0) return `${sign}${hours}h`;
  return `${sign}${hours}h ${pad(minutes)}m`;
}

export function percent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 10) / 10;
}

export function cssStatus(status) {
  return `status-${String(status || 'Sin DAT')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '-')}`;
}

export function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('No fue posible leer el archivo.'));
    reader.readAsText(file, 'utf-8');
  });
}

export function downloadTextFile(fileName, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function buildCsv(rows, headers) {
  const escapeCell = (cell) => {
    const value = String(cell ?? '');
    if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
    return value;
  };

  return [
    headers.map((header) => escapeCell(header.label)).join(','),
    ...rows.map((row) => headers.map((header) => escapeCell(header.value(row))).join(','))
  ].join('\n');
}

export function makeId(prefix = 'id') {
  const random = Math.random().toString(36).slice(2, 9);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}
