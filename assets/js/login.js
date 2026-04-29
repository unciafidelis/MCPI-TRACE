import {
  createSession,
  getCoordinatorLockInfo,
  verifyCoordinatorPassword
} from './authService.js';
import { hydrateFromPublicState, saveSession } from './storage.js';

const loginForm = document.querySelector('#loginForm');
const coordinatorKeyGroup = document.querySelector('#coordinatorKeyGroup');
const coordinatorKey = document.querySelector('#coordinatorKey');
const loginAlert = document.querySelector('#loginAlert');
const roleCards = [...document.querySelectorAll('[data-role-card]')];
const roleInputs = [...document.querySelectorAll('input[name="role"]')];
const submitButton = document.querySelector('#submitLoginButton');
const togglePasswordButton = document.querySelector('#togglePasswordButton');
const coordinatorSecurityHint = document.querySelector('#coordinatorSecurityHint');

function selectedRole() {
  const checked = document.querySelector('input[name="role"]:checked');
  return checked?.value || 'alumno';
}

function setSubmitState(isLoading) {
  if (!submitButton) return;
  submitButton.disabled = isLoading;
  submitButton.classList.toggle('is-loading', isLoading);
  const label = submitButton.querySelector('[data-login-label]');
  if (label) label.textContent = isLoading ? 'Validando acceso' : 'Entrar al sistema';
}

function showAlert(message, type = 'danger') {
  if (!loginAlert) return;
  loginAlert.textContent = message;
  loginAlert.className = `alert ${type}`;
}

function hideAlert() {
  if (!loginAlert) return;
  loginAlert.className = 'alert hidden';
  loginAlert.textContent = '';
}

function updateCoordinatorHint() {
  if (!coordinatorSecurityHint) return;
  const lockInfo = getCoordinatorLockInfo();

  if (lockInfo.locked) {
    coordinatorSecurityHint.textContent = `Acceso bloqueado temporalmente en este navegador. Tiempo restante: ${lockInfo.remainingMinutes} min.`;
    coordinatorSecurityHint.classList.add('danger-text');
    return;
  }

  const attempts = lockInfo.status?.failedAttempts || 0;
  coordinatorSecurityHint.textContent = attempts
    ? `Intentos fallidos registrados: ${attempts}. El bloqueo local se activa al quinto intento.`
    : 'La clave se valida mediante hash PBKDF2; la contraseña real no está guardada en el proyecto.';
  coordinatorSecurityHint.classList.toggle('danger-text', attempts > 0);
}

function setCoordinatorFieldState(isCoordinator) {
  if (!coordinatorKeyGroup || !coordinatorKey) return;

  coordinatorKeyGroup.classList.toggle('hidden', !isCoordinator);
  coordinatorKeyGroup.setAttribute('aria-hidden', String(!isCoordinator));

  coordinatorKey.disabled = !isCoordinator;
  coordinatorKey.required = isCoordinator;
  coordinatorKey.setAttribute('aria-required', String(isCoordinator));

  if (!isCoordinator) {
    coordinatorKey.value = '';
    coordinatorKey.setCustomValidity('');
    coordinatorKey.blur();
  }

  if (togglePasswordButton) {
    togglePasswordButton.disabled = !isCoordinator;
    togglePasswordButton.setAttribute('aria-hidden', String(!isCoordinator));
  }
}

function renderRoleState() {
  const role = selectedRole();
  const isCoordinator = role === 'coordinador';

  roleCards.forEach((card) => {
    card.classList.toggle('active', card.dataset.roleCard === role);
  });

  setCoordinatorFieldState(isCoordinator);
  if (isCoordinator) updateCoordinatorHint();
}

roleCards.forEach((card) => {
  card.addEventListener('click', () => {
    const input = card.querySelector('input[type="radio"]');
    if (!input) return;
    input.checked = true;
    hideAlert();
    renderRoleState();
  });
});

roleInputs.forEach((input) => {
  input.addEventListener('change', () => {
    hideAlert();
    renderRoleState();
  });
});

togglePasswordButton?.addEventListener('click', () => {
  if (!coordinatorKey || coordinatorKey.disabled) return;
  const isPassword = coordinatorKey.type === 'password';
  coordinatorKey.type = isPassword ? 'text' : 'password';
  togglePasswordButton.setAttribute('aria-label', isPassword ? 'Ocultar contraseña' : 'Mostrar contraseña');
  togglePasswordButton.querySelector('.material-symbols-rounded').textContent = isPassword ? 'visibility_off' : 'visibility';
});

loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideAlert();
  const role = selectedRole();

  try {
    setSubmitState(true);

    if (role === 'coordinador') {
      const password = coordinatorKey?.value?.trim() || '';

      if (!password) {
        showAlert('Ingresa la contraseña de coordinación para continuar.', 'warning');
        coordinatorKey?.focus();
        return;
      }

      const result = await verifyCoordinatorPassword(password);
      if (!result.ok) {
        showAlert(result.message, result.locked ? 'danger' : 'warning');
        updateCoordinatorHint();
        coordinatorKey?.focus();
        return;
      }
    }

    await hydrateFromPublicState();
    saveSession(createSession(role));
    window.location.href = './dashboard.html';
  } catch (error) {
    showAlert(error.message || 'No fue posible validar el acceso.', 'danger');
  } finally {
    setSubmitState(false);
  }
});

renderRoleState();
hydrateFromPublicState();
