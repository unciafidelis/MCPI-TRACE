import { normalizeTime, toIsoDate } from './utils.js';

const EVENT_REGEX = /^(IN|OUT|ENTRADA|SALIDA|E|S|CHECKIN|CHECKOUT|CHECK-IN|CHECK-OUT)$/i;
const HEADER_TOKENS = new Set([
  'id',
  'usuario',
  'user',
  'checker',
  'checador',
  'no',
  'num',
  'numero',
  'fecha',
  'hora',
  'time',
  'date',
  'datetime',
  'registro',
  'nombre',
  'name',
  'event',
  'evento',
  'estado',
  'status',
  'verify',
  'verifymode',
  'devicename',
  'device',
  'departamento',
  'department'
]);

function splitLine(line) {
  if (line.includes('|')) return line.split('|').map((token) => token.trim()).filter(Boolean);
  if (line.includes(';')) return line.split(';').map((token) => token.trim()).filter(Boolean);
  if (line.includes(',')) return line.split(',').map((token) => token.trim()).filter(Boolean);
  if (line.includes('\t')) return line.split('\t').map((token) => token.trim()).filter(Boolean);
  return line.split(/\s{2,}|\s+/).map((token) => token.trim()).filter(Boolean);
}

function normalizeIdentifier(token) {
  return String(token || '').trim().replace(/^['"]+|['"]+$/g, '').replace(/[^a-zA-Z0-9_-]/g, '');
}

function normalizeToken(token) {
  return normalizeIdentifier(token)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizeEventType(token) {
  if (!token) return 'unknown';
  const value = token.trim().toUpperCase();
  if (['IN', 'ENTRADA', 'E', 'CHECKIN', 'CHECK-IN'].includes(value)) return 'in';
  if (['OUT', 'SALIDA', 'S', 'CHECKOUT', 'CHECK-OUT'].includes(value)) return 'out';
  return 'unknown';
}

function extractDate(raw, tokens) {
  for (const token of tokens) {
    const iso = toIsoDate(token);
    if (iso) return iso;
  }

  const match = raw.match(/(\d{4}[-\/]\d{1,2}[-\/]\d{1,2}|\d{1,2}[-\/]\d{1,2}[-\/]\d{4}|\b\d{8}\b)/);
  return match ? toIsoDate(match[1]) : null;
}

function extractTime(raw, tokens) {
  for (const token of tokens) {
    const normalized = normalizeTime(token);
    if (normalized) return normalized;
  }

  const match = raw.match(/(\d{1,2}:\d{2}(?::\d{2})?|\b\d{4}(?:\d{2})?\b)/);
  return match ? normalizeTime(match[1]) : null;
}

function findKnownCheckerId(raw, tokens, knownCheckerIds) {
  if (!knownCheckerIds.length) return null;
  const normalizedTokens = new Set(tokens.map((token) => normalizeIdentifier(token)));

  for (const id of knownCheckerIds) {
    if (normalizedTokens.has(id)) return id;
  }

  for (const id of knownCheckerIds) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const expression = new RegExp(`(^|[^a-zA-Z0-9_-])${escaped}([^a-zA-Z0-9_-]|$)`);
    if (expression.test(raw)) return id;
  }

  return null;
}

function looksLikeMetadataToken(token) {
  const normalized = normalizeToken(token);
  if (!normalized) return true;
  if (HEADER_TOKENS.has(normalized)) return true;
  if (EVENT_REGEX.test(token)) return true;
  if (toIsoDate(token)) return true;
  if (normalizeTime(token)) return true;
  if (/^\d{1,3}$/.test(normalized)) return true;
  return false;
}

function findFallbackCheckerId(tokens) {
  const candidates = tokens
    .map((token) => normalizeIdentifier(token))
    .filter((token) => token && !looksLikeMetadataToken(token));

  return candidates.find((token) => /^\d{4,}$/.test(token))
    || candidates.find((token) => /^[a-zA-Z0-9_-]{4,}$/.test(token))
    || null;
}

function parseDatLine(line, lineNumber, knownCheckerIds = []) {
  const raw = String(line || '').trim();
  if (!raw) {
    return { ok: false, lineNumber, raw, error: 'Línea vacía.' };
  }

  const tokens = splitLine(raw);
  const eventToken = tokens.find((token) => EVENT_REGEX.test(token));
  const checkerId = findKnownCheckerId(raw, tokens, knownCheckerIds) || findFallbackCheckerId(tokens);
  const eventDate = extractDate(raw, tokens);
  const eventTime = extractTime(raw, tokens);

  if (!checkerId || !eventDate || !eventTime) {
    return {
      ok: false,
      lineNumber,
      raw,
      error: 'No se identificó ID, fecha u hora.'
    };
  }

  return {
    ok: true,
    lineNumber,
    raw,
    data: {
      checkerId,
      eventDate,
      eventTime,
      eventType: normalizeEventType(eventToken),
      sourceLine: lineNumber
    }
  };
}

export function parseDatContent(content, knownCheckerIds = []) {
  const lines = String(content || '').split(/\r?\n/);
  const parsed = [];
  const invalid = [];
  const unique = new Map();
  const knownIds = [...new Set((knownCheckerIds || []).map((id) => normalizeIdentifier(id)).filter(Boolean))];

  lines.forEach((line, index) => {
    if (!line.trim()) return;
    const result = parseDatLine(line, index + 1, knownIds);
    if (!result.ok) {
      invalid.push(result);
      return;
    }

    const key = `${result.data.checkerId}__${result.data.eventDate}__${result.data.eventTime}`;
    unique.set(key, result);
  });

  unique.forEach((item) => parsed.push(item));
  parsed.sort((a, b) => `${a.data.checkerId}${a.data.eventDate}${a.data.eventTime}`.localeCompare(`${b.data.checkerId}${b.data.eventDate}${b.data.eventTime}`));

  return {
    parsed,
    invalid,
    totalLines: lines.filter((line) => line.trim()).length,
    duplicatedLines: lines.filter((line) => line.trim()).length - parsed.length - invalid.length
  };
}
