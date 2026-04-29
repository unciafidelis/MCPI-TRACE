import { COORDINATOR_AUTH_CONFIG, STORAGE_KEYS, STUDENT_SESSION_HOURS } from './constants.js';

const encoder = new TextEncoder();

function now() {
  return Date.now();
}

function createFallbackId() {
  const randomPart = Math.random().toString(36).slice(2);
  return `session-${Date.now()}-${randomPart}`;
}

function createSessionId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return createFallbackId();
}

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary);
}

function constantTimeEquals(left, right) {
  const safeLeft = String(left || '');
  const safeRight = String(right || '');
  const length = Math.max(safeLeft.length, safeRight.length);

  if (!length) return true;

  let diff = safeLeft.length ^ safeRight.length;

  for (let index = 0; index < length; index += 1) {
    const leftCode = safeLeft.charCodeAt(index % safeLeft.length) || 0;
    const rightCode = safeRight.charCodeAt(index % safeRight.length) || 0;
    diff |= leftCode ^ rightCode;
  }

  return diff === 0;
}

function readAuthStatus() {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.authStatus);
    const parsed = stored ? JSON.parse(stored) : {};
    return {
      failedAttempts: Number(parsed.failedAttempts || 0),
      lockedUntil: parsed.lockedUntil || null,
      lastFailureAt: parsed.lastFailureAt || null
    };
  } catch (error) {
    console.error(error);
    return { failedAttempts: 0, lockedUntil: null, lastFailureAt: null };
  }
}

function saveAuthStatus(status) {
  localStorage.setItem(STORAGE_KEYS.authStatus, JSON.stringify(status));
  return status;
}

function resetAuthStatus() {
  localStorage.removeItem(STORAGE_KEYS.authStatus);
}

function getRemainingLockoutMinutes(lockedUntil) {
  if (!lockedUntil) return 0;
  const remaining = new Date(lockedUntil).getTime() - now();
  return Math.max(0, Math.ceil(remaining / 60000));
}

function getLockState() {
  const status = readAuthStatus();
  const remainingMinutes = getRemainingLockoutMinutes(status.lockedUntil);

  if (remainingMinutes <= 0 && status.lockedUntil) {
    resetAuthStatus();
    return { locked: false, remainingMinutes: 0, status: readAuthStatus() };
  }

  return {
    locked: remainingMinutes > 0,
    remainingMinutes,
    status
  };
}

async function derivePasswordHash(password) {
  if (!window.crypto?.subtle) {
    throw new Error('Este navegador no permite validar claves con Web Crypto API. Usa un navegador moderno con HTTPS o localhost.');
  }

  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const bits = await window.crypto.subtle.deriveBits(
    {
      name: COORDINATOR_AUTH_CONFIG.algorithm,
      salt: encoder.encode(COORDINATOR_AUTH_CONFIG.salt),
      iterations: COORDINATOR_AUTH_CONFIG.iterations,
      hash: COORDINATOR_AUTH_CONFIG.hash
    },
    keyMaterial,
    256
  );

  return bufferToBase64(bits);
}

function registerFailedAttempt(status) {
  const failedAttempts = Number(status.failedAttempts || 0) + 1;
  const shouldLock = failedAttempts >= COORDINATOR_AUTH_CONFIG.maxAttempts;
  const nextStatus = {
    failedAttempts,
    lastFailureAt: new Date().toISOString(),
    lockedUntil: shouldLock
      ? new Date(now() + COORDINATOR_AUTH_CONFIG.lockoutMinutes * 60000).toISOString()
      : null
  };

  saveAuthStatus(nextStatus);

  if (shouldLock) {
    return {
      ok: false,
      locked: true,
      message: `Demasiados intentos fallidos. El acceso de coordinación queda bloqueado durante ${COORDINATOR_AUTH_CONFIG.lockoutMinutes} minutos en este navegador.`
    };
  }

  const remainingAttempts = COORDINATOR_AUTH_CONFIG.maxAttempts - failedAttempts;
  return {
    ok: false,
    locked: false,
    message: `Clave incorrecta. Intentos restantes antes del bloqueo local: ${remainingAttempts}.`
  };
}

export function getCoordinatorLockInfo() {
  return getLockState();
}

export async function verifyCoordinatorPassword(password) {
  const lockState = getLockState();

  if (lockState.locked) {
    return {
      ok: false,
      locked: true,
      message: `Acceso temporalmente bloqueado. Intenta nuevamente en ${lockState.remainingMinutes} min.`
    };
  }

  const candidate = String(password || '');

  if (!candidate) {
    return {
      ok: false,
      locked: false,
      message: 'Ingresa la clave de coordinación.'
    };
  }

  const candidateHash = await derivePasswordHash(candidate);
  const isValid = constantTimeEquals(candidateHash, COORDINATOR_AUTH_CONFIG.passwordHash);

  if (!isValid) return registerFailedAttempt(lockState.status);

  resetAuthStatus();
  return { ok: true, locked: false, message: 'Acceso autorizado.' };
}

export function createSession(role) {
  const safeRole = role === 'coordinador' ? 'coordinador' : 'alumno';
  const sessionHours = safeRole === 'coordinador'
    ? COORDINATOR_AUTH_CONFIG.sessionHours
    : STUDENT_SESSION_HOURS;

  return {
    role: safeRole,
    authVersion: 2,
    sessionId: createSessionId(),
    loggedAt: new Date().toISOString(),
    expiresAt: new Date(now() + sessionHours * 60 * 60000).toISOString()
  };
}

export function isSessionActive(session) {
  if (!session || !session.role || session.authVersion !== 2) return false;
  if (!session.expiresAt) return false;
  return new Date(session.expiresAt).getTime() > now();
}

export function getSessionExpirationLabel(session) {
  if (!isSessionActive(session)) return 'Sesión vencida';
  const expiresAt = new Date(session.expiresAt);
  return expiresAt.toLocaleString('es-MX', {
    dateStyle: 'short',
    timeStyle: 'short'
  });
}
