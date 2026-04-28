import { DAY_KEYS } from './constants.js';
import { hoursToMinutes, normalizeHeader } from './utils.js';

function parseCsvLine(line = '') {
  const values = [];
  let current = '';
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        current += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (char === ',' && !insideQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function resolveHeaderIndexes(headers) {
  const normalized = headers.map((header) => normalizeHeader(header));
  const findIndex = (aliases) => normalized.findIndex((header) => aliases.includes(header));

  return {
    cvu: findIndex(['cvu conacyt', 'cvu conahcyt', 'cvu']),
    total: findIndex(['horas por semana', 'horas semana', 'total sem', 'total semana', 'total semanal']),
    monday: findIndex(['lunes']),
    tuesday: findIndex(['martes']),
    wednesday: findIndex(['miercoles']),
    thursday: findIndex(['jueves']),
    friday: findIndex(['viernes']),
    saturday: findIndex(['sabado']),
    checkerId: findIndex(['id checador', 'checador', 'checker id', 'checker', 'id']),
    studentName: findIndex(['estudiante', 'nombre', 'nombre estudiante', 'alumno'])
  };
}

function readColumn(values, index) {
  if (index < 0 || index >= values.length) return '';
  return String(values[index] || '').trim();
}

function validateIndexes(indexes) {
  return ['cvu', 'total', ...DAY_KEYS].every((key) => indexes[key] >= 0);
}

export function parseReferenceCsv(csvContent, fileName = 'referencia.csv') {
  const lines = String(csvContent || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((line) => line.trim().length);

  if (!lines.length) {
    throw new Error('El CSV está vacío.');
  }

  const headers = parseCsvLine(lines[0]);
  const indexes = resolveHeaderIndexes(headers);

  if (!validateIndexes(indexes)) {
    throw new Error('El CSV no contiene todas las columnas requeridas: CVU-CONACYT, Horas por semana, Lunes, Martes, Miercoles, Jueves, Viernes y Sabado.');
  }

  const rows = [];
  const invalid = [];
  const seenCvus = new Set();

  lines.slice(1).forEach((line, offset) => {
    const lineNumber = offset + 2;
    const values = parseCsvLine(line);
    const cvu = readColumn(values, indexes.cvu);
    const checkerId = readColumn(values, indexes.checkerId) || cvu;
    const studentName = readColumn(values, indexes.studentName) || 'Sin nombre';
    const totalRaw = readColumn(values, indexes.total);
    const dayRaw = {
      monday: readColumn(values, indexes.monday),
      tuesday: readColumn(values, indexes.tuesday),
      wednesday: readColumn(values, indexes.wednesday),
      thursday: readColumn(values, indexes.thursday),
      friday: readColumn(values, indexes.friday),
      saturday: readColumn(values, indexes.saturday)
    };

    const reasons = [];
    if (!cvu) reasons.push('CVU vacío.');
    if (cvu && seenCvus.has(cvu)) reasons.push('CVU duplicado.');

    const expectedTotalMinutes = hoursToMinutes(totalRaw);
    if (totalRaw === '' || Number.isNaN(Number(String(totalRaw).replace(',', '.')))) {
      reasons.push('Horas por semana no es numérico.');
    }

    const week = {};
    DAY_KEYS.forEach((dayKey) => {
      const raw = dayRaw[dayKey];
      if (raw === '' || Number.isNaN(Number(String(raw).replace(',', '.')))) {
        reasons.push(`${dayKey} no es numérico.`);
      }
      week[dayKey] = hoursToMinutes(raw);
    });

    if (reasons.length) {
      invalid.push({ line: lineNumber, raw: line, reason: reasons.join(' ') });
      return;
    }

    seenCvus.add(cvu);
    const sumDaily = DAY_KEYS.reduce((sum, dayKey) => sum + week[dayKey], 0);
    const issueNotes = [];
    if (sumDaily !== expectedTotalMinutes) {
      issueNotes.push('La suma diaria no coincide con el total semanal.');
    }

    rows.push({
      id: `${cvu}-${checkerId}`,
      cvu,
      checkerId,
      studentName,
      expectedTotalMinutes,
      week,
      hasIssue: issueNotes.length > 0,
      issueNotes: issueNotes.join(' '),
      sourceFile: fileName
    });
  });

  if (!rows.length) {
    throw new Error('No se detectaron filas válidas en el CSV.');
  }

  return { rows, invalid };
}
