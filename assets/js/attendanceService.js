import { CALENDAR_TYPES, DAY_KEYS, DAY_LABELS } from './constants.js';
import { parseDatContent } from './datService.js';
import {
  addDaysIso,
  dateInRange,
  formatWeekRange,
  getWeekEndIso,
  getWeekStartIso,
  minutesToReadable,
  percent,
  rangesOverlap,
  timeToMinutes,
  weekdayKeyFromIso
} from './utils.js';

function calculatePairs(events) {
  if (!events.length) return { minutes: 0, pairs: 0, incidentType: null, message: null };

  let minutes = 0;
  let pairs = 0;
  const messages = [];

  for (let index = 0; index < events.length; index += 2) {
    const start = events[index];
    const end = events[index + 1];

    if (!start || !end) {
      messages.push('Número impar de marcajes.');
      break;
    }

    const startMinutes = timeToMinutes(start.eventTime);
    const endMinutes = timeToMinutes(end.eventTime);

    if (endMinutes <= startMinutes) {
      messages.push('Secuencia horaria no interpretable.');
      continue;
    }

    minutes += endMinutes - startMinutes;
    pairs += 1;
  }

  return {
    minutes,
    pairs,
    incidentType: messages.length ? 'Incompleto' : null,
    message: messages.join(' ')
  };
}

function buildStats(summaries, context = {}) {
  const totalStudents = summaries.length;
  const meetsTarget = summaries.filter((row) => row.status === 'Cumple').length;
  const belowTarget = summaries.filter((row) => row.status === 'No cumple').length;
  const needsReview = summaries.filter((row) => row.status === 'Requiere revisión').length;
  const noDat = summaries.filter((row) => row.status === 'Sin DAT').length;
  const noActivity = summaries.filter((row) => row.status === 'Sin actividad').length;
  const avgCompliancePercent = totalStudents
    ? percent(summaries.reduce((sum, row) => sum + row.compliancePercent, 0) / totalStudents)
    : 0;

  return {
    totalStudents,
    meetsTarget,
    belowTarget,
    needsReview,
    noDat,
    noActivity,
    calendarEvents: context.activeCalendarEntries?.length || 0,
    excludedExpectedMinutes: context.excludedExpectedMinutes || 0,
    avgCompliancePercent
  };
}

function emptyWeek() {
  return DAY_KEYS.reduce((week, dayKey) => ({ ...week, [dayKey]: 0 }), {});
}

function normalizeCalendarEntries(entries = []) {
  return entries
    .filter((entry) => entry?.startDate && entry?.endDate)
    .map((entry) => {
      const startDate = entry.startDate <= entry.endDate ? entry.startDate : entry.endDate;
      const endDate = entry.startDate <= entry.endDate ? entry.endDate : entry.startDate;
      return {
        id: entry.id,
        type: entry.type || 'inhabil',
        label: entry.label || CALENDAR_TYPES[entry.type] || 'Día no laborable',
        startDate,
        endDate,
        createdAt: entry.createdAt || null
      };
    })
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
}

function activeEntriesForWeek(calendarEntries, weekStart, weekEnd) {
  return normalizeCalendarEntries(calendarEntries)
    .filter((entry) => rangesOverlap(entry.startDate, entry.endDate, weekStart, weekEnd));
}

function entryForDate(entries, dateString) {
  return entries.find((entry) => dateInRange(dateString, entry.startDate, entry.endDate)) || null;
}

function collectAvailableWeeks(events) {
  const weeks = new Set(
    events
      .map((event) => getWeekStartIso(event.eventDate))
      .filter(Boolean)
  );

  return [...weeks].sort((a, b) => b.localeCompare(a));
}

function buildGlobalIncidents(parsedDat) {
  return parsedDat.invalid.map((item) => ({
    type: 'Registro corrupto',
    priority: 'Alta',
    cvu: null,
    checkerId: null,
    date: null,
    message: `Línea ${item.lineNumber}: ${item.error}`,
    raw: item.raw
  }));
}

function buildMissingDatSummaries(referenceRows = [], hasDatFile = false) {
  return referenceRows.map((reference) => {
    const week = emptyWeek();
    const dayDetails = DAY_KEYS.map((dayKey) => ({
      dayKey,
      dayLabel: DAY_LABELS[dayKey],
      date: null,
      baseExpectedMinutes: reference.week[dayKey] || 0,
      expectedMinutes: reference.week[dayKey] || 0,
      realMinutes: 0,
      isNonWorking: false,
      calendarType: null,
      calendarLabel: null
    }));

    const status = reference.hasIssue ? 'Requiere revisión' : 'Sin DAT';
    const message = hasDatFile
      ? 'El archivo .dat fue cargado, pero no contiene fechas reconocibles para construir una semana evaluable.'
      : 'Aún no se ha cargado un archivo .dat para evaluar la semana.';

    return {
      cvu: reference.cvu,
      checkerId: reference.checkerId,
      studentName: reference.studentName || 'Sin nombre',
      expectedTotalMinutes: reference.expectedTotalMinutes,
      baseExpectedTotalMinutes: reference.expectedTotalMinutes,
      realTotalMinutes: 0,
      varianceMinutes: -reference.expectedTotalMinutes,
      status,
      compliancePercent: 0,
      week,
      expectedWeek: reference.week,
      baseExpectedWeek: reference.week,
      dayDetails,
      hasIncident: Boolean(reference.issueNotes || hasDatFile),
      incidentSummary: [message, reference.issueNotes || ''].filter(Boolean).join(' | '),
      expectedLabel: minutesToReadable(reference.expectedTotalMinutes),
      baseExpectedLabel: minutesToReadable(reference.expectedTotalMinutes),
      realLabel: minutesToReadable(0),
      varianceLabel: minutesToReadable(-reference.expectedTotalMinutes)
    };
  });
}

function buildWeekReport({ referenceRows, events, parsedDat, calendarEntries, weekStart, fileName }) {
  const weekEnd = getWeekEndIso(weekStart);
  const activeCalendarEntries = activeEntriesForWeek(calendarEntries, weekStart, weekEnd);
  const globalIncidents = buildGlobalIncidents(parsedDat);
  const incidents = [...globalIncidents];
  const referenceByChecker = new Map(referenceRows.map((row) => [row.checkerId, row]));

  const eventsInWeek = events.filter((event) => dateInRange(event.eventDate, weekStart, weekEnd));
  const eventsByCheckerDate = new Map();

  eventsInWeek.forEach((event) => {
    const key = `${event.checkerId}__${event.eventDate}`;
    if (!eventsByCheckerDate.has(key)) eventsByCheckerDate.set(key, []);
    eventsByCheckerDate.get(key).push(event);
  });

  const dailyByChecker = new Map();
  eventsByCheckerDate.forEach((dayEvents, key) => {
    const [checkerId, eventDate] = key.split('__');
    const sortedEvents = dayEvents.sort((a, b) => a.eventTime.localeCompare(b.eventTime));
    const result = calculatePairs(sortedEvents);

    if (!dailyByChecker.has(checkerId)) dailyByChecker.set(checkerId, emptyWeek());
    const dayKey = weekdayKeyFromIso(eventDate);
    if (DAY_KEYS.includes(dayKey)) {
      dailyByChecker.get(checkerId)[dayKey] += result.minutes;
    }

    if (result.incidentType) {
      incidents.push({
        type: result.incidentType,
        priority: 'Media',
        cvu: referenceByChecker.get(checkerId)?.cvu || null,
        checkerId,
        date: eventDate,
        message: result.message || 'Se detectó una incidencia en el cálculo diario.',
        raw: sortedEvents.map((event) => `${event.eventDate} ${event.eventTime}`).join(' | ')
      });
    }
  });

  const eventsByChecker = new Set(eventsInWeek.map((event) => event.checkerId));
  eventsByChecker.forEach((checkerId) => {
    if (!referenceByChecker.has(checkerId)) {
      incidents.push({
        type: 'No vinculado',
        priority: 'Alta',
        cvu: null,
        checkerId,
        date: null,
        message: 'El identificador del checador no existe en la tabla de referencia activa para la semana seleccionada.',
        raw: ''
      });
    }
  });

  let excludedExpectedMinutes = 0;
  const summaries = referenceRows.map((reference) => {
    const realWeek = dailyByChecker.get(reference.checkerId) || emptyWeek();
    const adjustedExpectedWeek = {};
    const dayDetails = DAY_KEYS.map((dayKey, index) => {
      const date = addDaysIso(weekStart, index);
      const calendarEntry = entryForDate(activeCalendarEntries, date);
      const baseExpectedMinutes = reference.week[dayKey] || 0;
      const expectedMinutes = calendarEntry ? 0 : baseExpectedMinutes;
      const realMinutes = realWeek[dayKey] || 0;
      adjustedExpectedWeek[dayKey] = expectedMinutes;
      excludedExpectedMinutes += Math.max(baseExpectedMinutes - expectedMinutes, 0);

      if (calendarEntry && realMinutes > 0) {
        incidents.push({
          type: 'Marcaje en día inhábil',
          priority: 'Media',
          cvu: reference.cvu,
          checkerId: reference.checkerId,
          date,
          message: `Se detectaron ${minutesToReadable(realMinutes)} registrados en ${calendarEntry.label}.`,
          raw: `${DAY_LABELS[dayKey]} ${date}`
        });
      }

      return {
        dayKey,
        dayLabel: DAY_LABELS[dayKey],
        date,
        baseExpectedMinutes,
        expectedMinutes,
        realMinutes,
        isNonWorking: Boolean(calendarEntry),
        calendarType: calendarEntry?.type || null,
        calendarLabel: calendarEntry?.label || null
      };
    });

    const expectedTotalMinutes = DAY_KEYS.reduce((sum, dayKey) => sum + adjustedExpectedWeek[dayKey], 0);
    const realTotalMinutes = DAY_KEYS.reduce((sum, dayKey) => sum + realWeek[dayKey], 0);
    const varianceMinutes = realTotalMinutes - expectedTotalMinutes;
    const rowIncidents = incidents.filter((incident) => incident.checkerId === reference.checkerId);
    const messages = [
      ...rowIncidents.map((incident) => incident.message),
      reference.issueNotes || ''
    ].filter(Boolean);

    let status = 'Cumple';
    if (expectedTotalMinutes === 0) status = realTotalMinutes > 0 ? 'Requiere revisión' : 'Sin actividad';
    else if (!fileName) status = 'Sin DAT';
    else if (reference.hasIssue || rowIncidents.length) status = 'Requiere revisión';
    else if (varianceMinutes < 0) status = 'No cumple';

    return {
      cvu: reference.cvu,
      checkerId: reference.checkerId,
      studentName: reference.studentName || 'Sin nombre',
      expectedTotalMinutes,
      baseExpectedTotalMinutes: reference.expectedTotalMinutes,
      realTotalMinutes,
      varianceMinutes,
      status,
      compliancePercent: expectedTotalMinutes > 0
        ? percent((realTotalMinutes / expectedTotalMinutes) * 100)
        : realTotalMinutes > 0 ? 100 : 0,
      week: realWeek,
      expectedWeek: adjustedExpectedWeek,
      baseExpectedWeek: reference.week,
      dayDetails,
      hasIncident: messages.length > 0,
      incidentSummary: messages.join(' | '),
      expectedLabel: minutesToReadable(expectedTotalMinutes),
      baseExpectedLabel: minutesToReadable(reference.expectedTotalMinutes),
      realLabel: minutesToReadable(realTotalMinutes),
      varianceLabel: minutesToReadable(varianceMinutes)
    };
  });

  const workingDays = DAY_KEYS.filter((_, index) => !entryForDate(activeCalendarEntries, addDaysIso(weekStart, index))).length;
  const weekContext = {
    selectedWeekStart: weekStart,
    selectedWeekEnd: weekEnd,
    selectedWeekLabel: formatWeekRange(weekStart, weekEnd),
    activeCalendarEntries,
    excludedExpectedMinutes,
    workingDays
  };

  return {
    weekStart,
    weekEnd,
    summaries,
    incidents,
    stats: buildStats(summaries, weekContext),
    weekContext
  };
}

function applyReportToState(state, report, availableWeeks = []) {
  return {
    ...state,
    selectedWeekStart: report?.weekStart || null,
    summaries: report?.summaries || [],
    incidents: report?.incidents || [],
    stats: report?.stats || {},
    weekContext: {
      ...(report?.weekContext || {}),
      availableWeeks
    }
  };
}

export function selectWeekFromStoredReports(state, requestedWeekStart) {
  const reports = Array.isArray(state.weeklyReports) ? state.weeklyReports : [];
  const availableWeeks = reports.map((report) => report.weekStart).filter(Boolean).sort((a, b) => b.localeCompare(a));

  if (!availableWeeks.length) {
    return applyReportToState({ ...state, selectedWeekStart: null }, null, []);
  }

  const weekStart = requestedWeekStart && availableWeeks.includes(requestedWeekStart)
    ? requestedWeekStart
    : availableWeeks[0];
  const report = reports.find((item) => item.weekStart === weekStart) || reports[0];
  return applyReportToState({ ...state, selectedWeekStart: weekStart }, report, availableWeeks);
}

export function buildSummaries({ referenceRows = [], datContent = '', fileName = null, calendarEntries = [], selectedWeekStart = null }) {
  const knownCheckerIds = referenceRows.map((row) => row.checkerId).filter(Boolean);
  const parsedDat = datContent ? parseDatContent(datContent, knownCheckerIds) : { parsed: [], invalid: [], totalLines: 0, duplicatedLines: 0 };
  const events = parsedDat.parsed.map((item) => ({ ...item.data }));
  const availableWeeks = collectAvailableWeeks(events);

  if (!availableWeeks.length) {
    const summaries = buildMissingDatSummaries(referenceRows, Boolean(fileName));
    const incidents = buildGlobalIncidents(parsedDat);

    if (fileName && parsedDat.totalLines > 0 && !parsedDat.parsed.length) {
      incidents.unshift({
        type: 'DAT sin semana evaluable',
        priority: 'Alta',
        cvu: null,
        checkerId: null,
        date: null,
        message: 'El archivo .dat fue leído, pero ninguna línea permitió identificar simultáneamente ID, fecha y hora.',
        raw: ''
      });
    }

    return {
      upload: {
        fileName,
        totalLines: parsedDat.totalLines,
        validLines: parsedDat.parsed.length,
        invalidLines: parsedDat.invalid.length,
        duplicatedLines: parsedDat.duplicatedLines
      },
      weeklyReports: [],
      summaries,
      incidents,
      stats: buildStats(summaries),
      weekContext: {
        selectedWeekStart: null,
        selectedWeekEnd: null,
        selectedWeekLabel: 'Sin semana DAT',
        availableWeeks: [],
        activeCalendarEntries: [],
        excludedExpectedMinutes: 0,
        workingDays: 0
      },
      selectedWeekStart: null
    };
  }

  const selected = selectedWeekStart && availableWeeks.includes(selectedWeekStart)
    ? selectedWeekStart
    : availableWeeks[0];
  const reports = availableWeeks.map((weekStart) => buildWeekReport({
    referenceRows,
    events,
    parsedDat,
    calendarEntries,
    weekStart,
    fileName
  }));
  const selectedReport = reports.find((report) => report.weekStart === selected) || reports[0];

  return {
    upload: {
      fileName,
      totalLines: parsedDat.totalLines,
      validLines: parsedDat.parsed.length,
      invalidLines: parsedDat.invalid.length,
      duplicatedLines: parsedDat.duplicatedLines
    },
    weeklyReports: reports,
    summaries: selectedReport?.summaries || [],
    incidents: selectedReport?.incidents || [],
    stats: selectedReport?.stats || buildStats([]),
    weekContext: {
      ...(selectedReport?.weekContext || {}),
      availableWeeks
    },
    selectedWeekStart: selected
  };
}

export function recomputeState(state) {
  if (!state.upload?.rawContent && Array.isArray(state.weeklyReports) && state.weeklyReports.length) {
    return selectWeekFromStoredReports(state, state.selectedWeekStart);
  }

  const result = buildSummaries({
    referenceRows: state.reference.rows,
    datContent: state.upload.rawContent || '',
    fileName: state.upload.fileName,
    calendarEntries: state.calendar?.entries || [],
    selectedWeekStart: state.selectedWeekStart
  });

  return {
    ...state,
    selectedWeekStart: result.selectedWeekStart,
    upload: {
      ...state.upload,
      totalLines: result.upload.totalLines,
      validLines: result.upload.validLines,
      invalidLines: result.upload.invalidLines,
      duplicatedLines: result.upload.duplicatedLines || 0
    },
    weeklyReports: result.weeklyReports,
    summaries: result.summaries,
    incidents: result.incidents,
    stats: result.stats,
    weekContext: result.weekContext
  };
}
