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
  submitButton.querySelector('[data-login-label]').textContent = isLoading ? 'Validando acceso' : 'Entrar al sistema';
}

function showAlert(message, type = 'danger') {
  loginAlert.textContent = message;
  loginAlert.className = `alert ${type}`;
}

function hideAlert() {
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

function renderRoleState() {
  const role = selectedRole();
  roleCards.forEach((card) => {
    card.classList.toggle('active', card.dataset.roleCard === role);
  });
  coordinatorKeyGroup.classList.toggle('hidden', role !== 'coordinador');
  if (role !== 'coordinador') coordinatorKey.value = '';
  if (role === 'coordinador') updateCoordinatorHint();
}

roleCards.forEach((card) => {
  card.addEventListener('click', () => {
    const input = card.querySelector('input[type="radio"]');
    input.checked = true;
    hideAlert();
    renderRoleState();
  });
});

togglePasswordButton?.addEventListener('click', () => {
  const isPassword = coordinatorKey.type === 'password';
  coordinatorKey.type = isPassword ? 'text' : 'password';
  togglePasswordButton.setAttribute('aria-label', isPassword ? 'Ocultar contraseña' : 'Mostrar contraseña');
  togglePasswordButton.querySelector('.material-symbols-rounded').textContent = isPassword ? 'visibility_off' : 'visibility';
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideAlert();
  const role = selectedRole();

  try {
    setSubmitState(true);

    if (role === 'coordinador') {
      const result = await verifyCoordinatorPassword(coordinatorKey.value);
      if (!result.ok) {
        showAlert(result.message, result.locked ? 'danger' : 'warning');
        updateCoordinatorHint();
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
