export const STORAGE_KEYS = Object.freeze({
  appState: 'mcpiTrace.githubPages.state.v4',
  session: 'mcpiTrace.githubPages.session.v2',
  authStatus: 'mcpiTrace.githubPages.authStatus.v1'
});

export const COORDINATOR_AUTH_CONFIG = Object.freeze({
  algorithm: 'PBKDF2',
  hash: 'SHA-256',
  iterations: 210000,
  salt: 'mcpi-trace-coordinacion-2026-v5-1b3d09b0f6814847a2',
  passwordHash: 'ZweDPd3LxDa/BH5O+zkeNH36iWddl7x3fqctGBAN+po=',
  maxAttempts: 5,
  lockoutMinutes: 15,
  sessionHours: 8
});

export const STUDENT_SESSION_HOURS = 12;

export const DAY_KEYS = Object.freeze([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday'
]);

export const DAY_LABELS = Object.freeze({
  monday: 'Lunes',
  tuesday: 'Martes',
  wednesday: 'Miércoles',
  thursday: 'Jueves',
  friday: 'Viernes',
  saturday: 'Sábado'
});

export const CALENDAR_TYPES = Object.freeze({
  asueto: 'Día de asueto',
  inhabil: 'Día inhábil',
  vacacional: 'Periodo vacacional'
});

export const DEFAULT_STATE = Object.freeze({
  version: 4,
  generatedAt: null,
  source: 'local',
  selectedWeekStart: null,
  reference: {
    fileName: null,
    importedAt: null,
    rows: [],
    invalid: []
  },
  upload: {
    fileName: null,
    importedAt: null,
    totalLines: 0,
    validLines: 0,
    invalidLines: 0,
    duplicatedLines: 0,
    rawContent: ''
  },
  calendar: {
    entries: [],
    lastUpdatedAt: null
  },
  weeklyReports: [],
  summaries: [],
  incidents: [],
  weekContext: {
    selectedWeekStart: null,
    selectedWeekEnd: null,
    availableWeeks: [],
    activeCalendarEntries: [],
    excludedExpectedMinutes: 0,
    workingDays: 0
  },
  stats: {
    totalStudents: 0,
    meetsTarget: 0,
    belowTarget: 0,
    needsReview: 0,
    noDat: 0,
    noActivity: 0,
    calendarEvents: 0,
    excludedExpectedMinutes: 0,
    avgCompliancePercent: 0
  }
});
