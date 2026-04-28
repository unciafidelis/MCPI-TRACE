import { DEFAULT_STATE, STORAGE_KEYS } from './constants.js';
import { clone, nowIso } from './utils.js';

function mergeWithDefaults(input) {
  const state = clone(DEFAULT_STATE);
  const value = input && typeof input === 'object' ? input : {};
  return {
    ...state,
    ...value,
    reference: {
      ...state.reference,
      ...(value.reference || {})
    },
    upload: {
      ...state.upload,
      ...(value.upload || {})
    },
    calendar: {
      ...state.calendar,
      ...(value.calendar || {})
    },
    weekContext: {
      ...state.weekContext,
      ...(value.weekContext || {})
    },
    stats: {
      ...state.stats,
      ...(value.stats || {})
    },
    weeklyReports: Array.isArray(value.weeklyReports) ? value.weeklyReports : state.weeklyReports,
    summaries: Array.isArray(value.summaries) ? value.summaries : state.summaries,
    incidents: Array.isArray(value.incidents) ? value.incidents : state.incidents
  };
}

export function getAppState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.appState);
    return mergeWithDefaults(stored ? JSON.parse(stored) : null);
  } catch (error) {
    console.error(error);
    return clone(DEFAULT_STATE);
  }
}

export function saveAppState(state) {
  const nextState = mergeWithDefaults({ ...state, generatedAt: nowIso() });
  localStorage.setItem(STORAGE_KEYS.appState, JSON.stringify(nextState));
  return nextState;
}

export function clearAppState() {
  localStorage.removeItem(STORAGE_KEYS.appState);
}

export function getSession() {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEYS.session);
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.error(error);
    return null;
  }
}

export function saveSession(session) {
  sessionStorage.setItem(STORAGE_KEYS.session, JSON.stringify(session));
}

export function clearSession() {
  sessionStorage.removeItem(STORAGE_KEYS.session);
}

export async function hydrateFromPublicState({ force = false } = {}) {
  const hasLocalState = Boolean(localStorage.getItem(STORAGE_KEYS.appState));
  if (hasLocalState && !force) return getAppState();

  try {
    const response = await fetch('./data/public-state.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('No se encontró data/public-state.json.');
    const publicState = await response.json();
    return saveAppState({ ...mergeWithDefaults(publicState), source: 'public-state.json' });
  } catch (error) {
    console.info(error.message);
    return getAppState();
  }
}

export function buildPublicState(state) {
  const safeState = mergeWithDefaults(state);
  return {
    version: safeState.version,
    generatedAt: nowIso(),
    source: 'public-state.json',
    selectedWeekStart: safeState.selectedWeekStart,
    reference: {
      fileName: safeState.reference.fileName,
      importedAt: safeState.reference.importedAt,
      rows: safeState.reference.rows,
      invalid: safeState.reference.invalid
    },
    upload: {
      fileName: safeState.upload.fileName,
      importedAt: safeState.upload.importedAt,
      totalLines: safeState.upload.totalLines,
      validLines: safeState.upload.validLines,
      invalidLines: safeState.upload.invalidLines,
      duplicatedLines: safeState.upload.duplicatedLines || 0,
      rawContent: ''
    },
    calendar: {
      entries: safeState.calendar.entries,
      lastUpdatedAt: safeState.calendar.lastUpdatedAt
    },
    weeklyReports: safeState.weeklyReports,
    summaries: safeState.summaries,
    incidents: safeState.incidents,
    weekContext: safeState.weekContext,
    stats: safeState.stats
  };
}
