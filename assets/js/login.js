import { COORDINATOR_KEY } from './constants.js';
import { hydrateFromPublicState, saveSession } from './storage.js';

const loginForm = document.querySelector('#loginForm');
const coordinatorKeyGroup = document.querySelector('#coordinatorKeyGroup');
const coordinatorKey = document.querySelector('#coordinatorKey');
const loginAlert = document.querySelector('#loginAlert');
const roleCards = [...document.querySelectorAll('[data-role-card]')];

function selectedRole() {
  const checked = document.querySelector('input[name="role"]:checked');
  return checked?.value || 'alumno';
}

function renderRoleState() {
  const role = selectedRole();
  roleCards.forEach((card) => {
    card.classList.toggle('active', card.dataset.roleCard === role);
  });
  coordinatorKeyGroup.classList.toggle('hidden', role !== 'coordinador');
  if (role !== 'coordinador') coordinatorKey.value = '';
}

function showAlert(message) {
  loginAlert.textContent = message;
  loginAlert.classList.remove('hidden');
}

roleCards.forEach((card) => {
  card.addEventListener('click', () => {
    const input = card.querySelector('input[type="radio"]');
    input.checked = true;
    loginAlert.classList.add('hidden');
    renderRoleState();
  });
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const role = selectedRole();

  if (role === 'coordinador' && coordinatorKey.value.trim() !== COORDINATOR_KEY) {
    showAlert('Clave local incorrecta. La clave inicial es: coordinacion');
    return;
  }

  await hydrateFromPublicState();
  saveSession({ role, loggedAt: new Date().toISOString() });
  window.location.href = './dashboard.html';
});

renderRoleState();
hydrateFromPublicState();
