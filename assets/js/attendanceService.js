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

function formatClockTime(value) {
  return String(value || '').slice(0, 5) || null;
}

function eventTypeLabel(eventType) {
  if (eventType === 'in') return 'Entrada';
  if (eventType === 'out') return 'Salida';
  return 'Tipo DAT no reconocido';
}

function emptyDailyAttendance() {
  return {
    minutes: 0,
    incidentType: null,
    message: null,
    entryTime: null,
    exitTime: null,
    eventCount: 0,
    events: [],
    calculationRule: 'Sin registros del día.',
    hasCompleteEntryExit: false,
    inconsistencyLabels: [],
    dailyAttendanceType: 'Sin registro',
    dailyStatusLabel: 'Sin registro',
    dailyStatusCode: 'sin-registro'
  };
}

function normalizeDailyEvents(events) {
  return [...events]
    .sort((a, b) => a.eventTime.localeCompare(b.eventTime))
    .map((event) => ({
      checkerId: event.checkerId,
      eventDate: event.eventDate,
      eventTime: event.eventTime,
      displayTime: formatClockTime(event.eventTime),
      eventType: event.eventType || 'unknown',
      eventLabel: eventTypeLabel(event.eventType),
      sourceLine: event.sourceLine || null
    }));
}

function hasConsecutiveType(events, eventType) {
  return events.some((event, index) => index > 0 && event.eventType === eventType && events[index - 1].eventType === eventType);
}

function uniqueMessages(messages) {
  return [...new Set(messages.filter(Boolean))];
}

function buildDailyResult({
  minutes = 0,
  incidentType = null,
  messages = [],
  entryEvent = null,
  exitEvent = null,
  events = [],
  calculationRule = '',
  hasCompleteEntryExit = false,
  inconsistencyLabels = []
}) {
  const normalizedMessages = uniqueMessages(messages);
  const normalizedIssues = uniqueMessages(inconsistencyLabels);
  const completePair = Boolean(hasCompleteEntryExit || (entryEvent && exitEvent));

  return {
    minutes: Math.max(0, Math.round(minutes)),
    incidentType: incidentType || (normalizedMessages.length ? 'Completado con inconsistencia' : null),
    message: normalizedMessages.join(' '),
    entryTime: entryEvent?.eventTime || null,
    exitTime: exitEvent?.eventTime || null,
    eventCount: events.length,
    events,
    calculationRule,
    hasCompleteEntryExit: completePair,
    inconsistencyLabels: normalizedIssues
  };
}

function calculateUntypedDailyAttendance(events) {
  if (events.length < 2) {
    return buildDailyResult({
      minutes: 0,
      incidentType: 'Tipo DAT no reconocido',
      messages: ['El .dat no permite identificar entrada/salida y solo existe un marcaje; el día queda en 0 horas.'],
      events,
      calculationRule: 'Sin par entrada/salida interpretable.',
      inconsistencyLabels: ['Tipo DAT no reconocido']
    });
  }

  const firstEvent = events[0];
  const lastEvent = events[events.length - 1];
  const startMinutes = timeToMinutes(firstEvent.eventTime);
  const endMinutes = timeToMinutes(lastEvent.eventTime);

  if (endMinutes <= startMinutes) {
    return buildDailyResult({
      minutes: 0,
      incidentType: 'Secuencia no interpretable',
      messages: ['El .dat no especifica entrada/salida y el último marcaje no es posterior al primero; el día queda en 0 horas.'],
      entryEvent: firstEvent,
      exitEvent: lastEvent,
      events,
      calculationRule: 'No fue posible inferir entrada y salida con orden horario válido.',
      inconsistencyLabels: ['Tipo DAT no reconocido']
    });
  }

  return buildDailyResult({
    minutes: endMinutes - startMinutes,
    incidentType: 'Completado con inconsistencia',
    messages: ['Tipo DAT no reconocido: el archivo no especifica entrada/salida; se asumió el primer registro como entrada y el último como salida.'],
    entryEvent: firstEvent,
    exitEvent: lastEvent,
    events,
    calculationRule: 'Primer marcaje del día contra último marcaje del día por falta de tipo explícito.',
    hasCompleteEntryExit: true,
    inconsistencyLabels: ['Tipo DAT no reconocido']
  });
}

function calculateDailyAttendance(dayEvents) {
  const events = normalizeDailyEvents(dayEvents);
  if (!events.length) return emptyDailyAttendance();

  const typedEvents = events.filter((event) => ['in', 'out'].includes(event.eventType));
  const unknownEvents = events.filter((event) => !['in', 'out'].includes(event.eventType));

  if (!typedEvents.length) {
    return calculateUntypedDailyAttendance(events);
  }

  const entries = typedEvents.filter((event) => event.eventType === 'in');
  const exits = typedEvents.filter((event) => event.eventType === 'out');
  const messages = [];
  const inconsistencyLabels = [];

  if (unknownEvents.length) {
    messages.push('Hay marcajes con tipo DAT no reconocido; no se usaron para cerrar la jornada.');
    inconsistencyLabels.push('Tipo DAT no reconocido');
  }

  if (hasConsecutiveType(typedEvents, 'in') || entries.length > 1) {
    messages.push('Doble entrada detectada.');
    inconsistencyLabels.push('Doble entrada');
  }

  if (hasConsecutiveType(typedEvents, 'out') || exits.length > 1) {
    messages.push('Doble salida detectada.');
    inconsistencyLabels.push('Doble salida');
  }

  if (entries.length && exits.length) {
    const firstEntry = entries[0];
    const lastExit = exits[exits.length - 1];
    const startMinutes = timeToMinutes(firstEntry.eventTime);
    const endMinutes = timeToMinutes(lastExit.eventTime);

    if (typedEvents[0].eventType === 'out') {
      messages.push('Existe una salida antes de la primera entrada válida; se ignora para el conteo.');
      inconsistencyLabels.push('Entrada faltante inicial');
    }

    if (typedEvents[typedEvents.length - 1].eventType === 'in') {
      messages.push('Existe una entrada sin salida posterior; no se usa para cerrar la jornada.');
      inconsistencyLabels.push('Salida faltante final');
    }

    if (entries.length > 1) {
      messages.push('Entradas múltiples: se considera la primera entrada registrada.');
    }

    if (exits.length > 1) {
      messages.push('Salidas múltiples: se considera la última salida registrada.');
    }

    if (endMinutes <= startMinutes) {
      return buildDailyResult({
        minutes: 0,
        incidentType: 'Secuencia no interpretable',
        messages: [...messages, 'La última salida no es posterior a la primera entrada; el día queda en 0 horas.'],
        entryEvent: firstEntry,
        exitEvent: lastExit,
        events,
        calculationRule: 'Entrada y salida detectadas, pero con orden horario inválido.',
        hasCompleteEntryExit: false,
        inconsistencyLabels: [...inconsistencyLabels, 'Orden horario inválido']
      });
    }

    return buildDailyResult({
      minutes: endMinutes - startMinutes,
      incidentType: inconsistencyLabels.length ? 'Completado con inconsistencia' : null,
      messages,
      entryEvent: firstEntry,
      exitEvent: lastExit,
      events,
      calculationRule: 'Primera entrada real contra última salida real del día.',
      hasCompleteEntryExit: true,
      inconsistencyLabels
    });
  }

  if (entries.length) {
    const isDoubleEntry = entries.length > 1;
    return buildDailyResult({
      minutes: 0,
      incidentType: isDoubleEntry ? 'Doble entrada' : 'Salida faltante',
      messages: [
        ...messages,
        isDoubleEntry
          ? 'Solo hay entradas registradas y no existe salida; el día queda en 0 horas por doble entrada sin salida.'
          : 'Existe entrada registrada, pero la salida está faltante; el día queda en 0 horas.'
      ],
      entryEvent: entries[0],
      exitEvent: null,
      events,
      calculationRule: 'Sin salida válida para cerrar la jornada.',
      hasCompleteEntryExit: false,
      inconsistencyLabels: [isDoubleEntry ? 'Doble entrada' : 'Salida faltante']
    });
  }

  const isDoubleExit = exits.length > 1;
  return buildDailyResult({
    minutes: 0,
    incidentType: isDoubleExit ? 'Doble salida' : 'Entrada faltante',
    messages: [
      ...messages,
      isDoubleExit
        ? 'Solo hay salidas registradas y no existe entrada; el día queda en 0 horas por doble salida sin entrada.'
        : 'Existe salida registrada, pero la entrada está faltante; el día queda en 0 horas.'
    ],
    entryEvent: null,
    exitEvent: exits[exits.length - 1] || null,
    events,
    calculationRule: 'Sin entrada válida para abrir la jornada.',
    hasCompleteEntryExit: false,
    inconsistencyLabels: [isDoubleExit ? 'Doble salida' : 'Entrada faltante']
  });
}

function sumDailyExpectedMinutes(reference) {
  return DAY_KEYS.reduce((sum, dayKey) => sum + (reference.week?.[dayKey] || 0), 0);
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
    const baseExpectedTotalMinutes = sumDailyExpectedMinutes(reference);
    const dayDetails = DAY_KEYS.map((dayKey) => ({
      dayKey,
      dayLabel: DAY_LABELS[dayKey],
      date: null,
      baseExpectedMinutes: reference.week[dayKey] || 0,
      expectedMinutes: reference.week[dayKey] || 0,
      realMinutes: 0,
      entryTime: null,
      exitTime: null,
      eventCount: 0,
      events: [],
      dailyIncidentType: null,
      dailyIncidentMessage: null,
      calculationRule: 'Sin registros del día.',
      hasCompleteEntryExit: false,
      inconsistencyLabels: [],
      dailyAttendanceType: 'Sin registro',
      dailyStatusLabel: 'Sin registro',
      dailyStatusCode: 'sin-registro',
      dailyInconsistencyLabel: null,
      isNonWorking: false,
      calendarType: null,
      calendarLabel: null
    }));

    const status = 'Sin DAT';
    const message = hasDatFile
      ? 'El archivo .dat fue cargado, pero no contiene fechas reconocibles para construir una semana evaluable.'
      : 'Aún no se ha cargado un archivo .dat para evaluar la semana.';

    return {
      cvu: reference.cvu,
      checkerId: reference.checkerId,
      studentName: reference.studentName || 'Sin nombre',
      expectedTotalMinutes: baseExpectedTotalMinutes,
      baseExpectedTotalMinutes,
      realTotalMinutes: 0,
      varianceMinutes: -baseExpectedTotalMinutes,
      status,
      compliancePercent: 0,
      week,
      expectedWeek: reference.week,
      baseExpectedWeek: reference.week,
      dayDetails,
      hasIncident: Boolean(reference.issueNotes || hasDatFile),
      incidentSummary: [message, reference.issueNotes || ''].filter(Boolean).join(' | '),
      expectedLabel: minutesToReadable(baseExpectedTotalMinutes),
      baseExpectedLabel: minutesToReadable(baseExpectedTotalMinutes),
      realLabel: minutesToReadable(0),
      varianceLabel: minutesToReadable(-baseExpectedTotalMinutes)
    };
  });
}

function normalizeStatusIssueLabel(label) {
  const value = String(label || '').trim();
  if (!value) return null;
  const normalized = value.toLowerCase();

  if (normalized.includes('doble entrada')) return 'doble entrada';
  if (normalized.includes('doble salida')) return 'doble salida';
  if (normalized.includes('salida faltante')) return 'salida faltante';
  if (normalized.includes('entrada faltante')) return 'entrada faltante';
  if (normalized.includes('tipo dat')) return 'tipo DAT no reconocido';
  if (normalized.includes('orden horario')) return 'orden horario inválido';
  if (normalized.includes('entrada sin salida')) return 'salida faltante';
  if (normalized.includes('salida antes')) return 'entrada faltante inicial';

  return value;
}

function statusCodeFromLabel(label) {
  const normalized = String(label || '').toLowerCase();
  if (normalized.includes('ingreso completado')) return 'ingreso-completado';
  if (normalized.includes('ingreso incompleto')) return 'ingreso-incompleto';
  if (normalized.includes('doble entrada')) return 'doble-entrada';
  if (normalized.includes('doble salida')) return 'doble-salida';
  if (normalized.includes('salida faltante')) return 'salida-faltante';
  if (normalized.includes('entrada faltante')) return 'entrada-faltante';
  if (normalized.includes('tipo dat')) return 'tipo-dat-no-reconocido';
  if (normalized.includes('no laborable')) return 'no-laborable';
  return 'sin-registro';
}

function classifyDailyAttendance(dailyResult, expectedMinutes, isNonWorking = false) {
  const eventCount = dailyResult.eventCount || 0;
  const hasCompleteEntryExit = Boolean(dailyResult.hasCompleteEntryExit && dailyResult.entryTime && dailyResult.exitTime);
  const issueLabels = uniqueMessages([
    ...(dailyResult.inconsistencyLabels || []),
    dailyResult.incidentType
  ].map(normalizeStatusIssueLabel));
  const visibleIssues = issueLabels.filter((label) => !['Completado con inconsistencia', 'Secuencia con ajuste'].includes(label));

  if (!eventCount) {
    const label = isNonWorking ? 'No laborable' : 'Sin registro';
    return {
      dailyAttendanceType: label,
      dailyStatusLabel: label,
      dailyStatusCode: statusCodeFromLabel(label),
      dailyInconsistencyLabel: null
    };
  }

  if (hasCompleteEntryExit) {
    const requiredMinutes = Math.max(expectedMinutes || 0, 0);
    const baseType = requiredMinutes > 0 && dailyResult.minutes < requiredMinutes
      ? 'Ingreso incompleto'
      : 'Ingreso completado';
    const issueSuffix = visibleIssues.length
      ? ` · completado con inconsistencia: ${visibleIssues.join(', ')}`
      : '';
    const label = `${baseType}${issueSuffix}`;

    return {
      dailyAttendanceType: baseType,
      dailyStatusLabel: label,
      dailyStatusCode: statusCodeFromLabel(baseType),
      dailyInconsistencyLabel: visibleIssues.join(', ') || null
    };
  }

  const fallbackLabel = visibleIssues[0] || normalizeStatusIssueLabel(dailyResult.incidentType) || 'Registro incompleto';
  return {
    dailyAttendanceType: fallbackLabel,
    dailyStatusLabel: fallbackLabel,
    dailyStatusCode: statusCodeFromLabel(fallbackLabel),
    dailyInconsistencyLabel: visibleIssues.join(', ') || fallbackLabel
  };
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
  const dailyDetailsByChecker = new Map();
  eventsByCheckerDate.forEach((dayEvents, key) => {
    const [checkerId, eventDate] = key.split('__');
    const result = calculateDailyAttendance(dayEvents);

    if (!dailyByChecker.has(checkerId)) dailyByChecker.set(checkerId, emptyWeek());
    if (!dailyDetailsByChecker.has(checkerId)) dailyDetailsByChecker.set(checkerId, {});

    const dayKey = weekdayKeyFromIso(eventDate);
    if (DAY_KEYS.includes(dayKey)) {
      dailyByChecker.get(checkerId)[dayKey] = result.minutes;
      dailyDetailsByChecker.get(checkerId)[dayKey] = result;
    }

    if (result.incidentType) {
      incidents.push({
        type: result.incidentType,
        priority: 'Media',
        cvu: referenceByChecker.get(checkerId)?.cvu || null,
        checkerId,
        date: eventDate,
        message: result.message || 'Se detectó una incidencia en el cálculo diario.',
        raw: result.events.map((event) => `${event.eventDate} ${event.displayTime || event.eventTime} ${event.eventLabel}`).join(' | ')
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
    const realDailyDetails = dailyDetailsByChecker.get(reference.checkerId) || {};
    const baseExpectedTotalMinutes = sumDailyExpectedMinutes(reference);
    const adjustedExpectedWeek = {};
    const dayDetails = DAY_KEYS.map((dayKey, index) => {
      const date = addDaysIso(weekStart, index);
      const calendarEntry = entryForDate(activeCalendarEntries, date);
      const baseExpectedMinutes = reference.week[dayKey] || 0;
      const expectedMinutes = calendarEntry ? 0 : baseExpectedMinutes;
      const dailyResult = realDailyDetails[dayKey] || emptyDailyAttendance();
      const realMinutes = dailyResult.minutes || 0;
      const dailyClassification = classifyDailyAttendance(dailyResult, expectedMinutes, Boolean(calendarEntry));
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
        entryTime: dailyResult.entryTime || null,
        exitTime: dailyResult.exitTime || null,
        eventCount: dailyResult.eventCount || 0,
        events: dailyResult.events || [],
        dailyIncidentType: dailyResult.incidentType || null,
        dailyIncidentMessage: dailyResult.message || null,
        calculationRule: dailyResult.calculationRule || 'Sin registros del día.',
        hasCompleteEntryExit: Boolean(dailyResult.hasCompleteEntryExit),
        inconsistencyLabels: dailyResult.inconsistencyLabels || [],
        dailyAttendanceType: dailyClassification.dailyAttendanceType,
        dailyStatusLabel: dailyClassification.dailyStatusLabel,
        dailyStatusCode: dailyClassification.dailyStatusCode,
        dailyInconsistencyLabel: dailyClassification.dailyInconsistencyLabel,
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
    else if (rowIncidents.length) status = 'Requiere revisión';
    else if (varianceMinutes < 0) status = 'No cumple';

    return {
      cvu: reference.cvu,
      checkerId: reference.checkerId,
      studentName: reference.studentName || 'Sin nombre',
      expectedTotalMinutes,
      baseExpectedTotalMinutes,
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
      baseExpectedLabel: minutesToReadable(baseExpectedTotalMinutes),
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
