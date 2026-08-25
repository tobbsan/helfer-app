import {
  speakText, stopSpeaking, createRecognizer, isSpeechRecognitionSupported,
  isSpeechSynthesisSupported, isNative, requestVoicePermissions,
} from './speech.js';
import { getContacts, addContact, deleteContact, getEmergencyContact, findContactByName } from './contacts.js';
import {
  getMedications, addMedication, deleteMedication, markTaken, snoozeTaken,
  findDueMedication, registerReminderActions, syncNativeReminders, requestReminderPermissions,
} from './medications.js';
import { askHelper } from './ai.js';
import { parseCommand } from './commands.js';

const SETTINGS_KEY = 'helper_settings';
const HISTORY_KEY = 'helper_chat_history';

const defaultSettings = {
  rate: 0.9,
  lang: 'en-US',
};

function loadSettings() {
  try {
    return { ...defaultSettings, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}) };
  } catch {
    return { ...defaultSettings };
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

function saveHistory(history) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-20)));
}

const state = {
  settings: loadSettings(),
  history: loadHistory(),
  lastSpoken: '',
  currentReminder: null,
};

// --- Element refs ---
const el = {
  homeStatus: document.getElementById('home-status'),
  micButton: document.getElementById('mic-button'),
  youSaid: document.getElementById('you-said'),
  helperSaid: document.getElementById('helper-said'),
  repeatButton: document.getElementById('repeat-button'),
  helpButton: document.getElementById('help-button'),
  emergencyButton: document.getElementById('emergency-call-button'),
  emergencyName: document.getElementById('emergency-name'),
  settingsShortcut: document.getElementById('settings-shortcut'),
  navButtons: document.querySelectorAll('.nav-item'),
  views: document.querySelectorAll('.view'),

  contactsList: document.getElementById('contacts-list'),
  contactName: document.getElementById('contact-name'),
  contactPhone: document.getElementById('contact-phone'),
  contactEmergency: document.getElementById('contact-emergency'),
  addContactButton: document.getElementById('add-contact-button'),

  medsList: document.getElementById('medications-list'),
  medName: document.getElementById('med-name'),
  medTime: document.getElementById('med-time'),
  addMedTimeButton: document.getElementById('add-med-time-button'),
  medTimeChips: document.getElementById('med-time-chips'),
  addMedButton: document.getElementById('add-med-button'),

  installAppBox: document.getElementById('install-app-box'),
  permissionStatus: document.getElementById('permission-status'),
  enablePermissionsButton: document.getElementById('enable-permissions-button'),
  homeEnablePermissionsButton: document.getElementById('home-enable-permissions-button'),
  homeDownloadAppLink: document.getElementById('home-download-app-link'),
  speechRateSelect: document.getElementById('speech-rate'),
  speechLangSelect: document.getElementById('speech-lang'),
  fallbackText: document.getElementById('fallback-text'),
  fallbackSend: document.getElementById('fallback-send'),

  reminderOverlay: document.getElementById('reminder-overlay'),
  reminderText: document.getElementById('reminder-text'),
  reminderTaken: document.getElementById('reminder-taken'),
  reminderSnooze: document.getElementById('reminder-snooze'),
};

let pendingMedTimes = [];

// --- View switching ---
function showView(name) {
  el.views.forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
  el.navButtons.forEach(b => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'contacts') renderContacts();
  if (name === 'medications') renderMedications();
  if (name === 'settings') fillSettingsForm();
}

el.navButtons.forEach(btn => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});
el.settingsShortcut.addEventListener('click', () => showView('settings'));

// --- Home: speaking helper ---
async function say(text) {
  state.lastSpoken = text;
  el.helperSaid.textContent = text;
  el.micButton.classList.add('speaking');
  el.homeStatus.textContent = 'Helfer is speaking...';
  await speakText(text, { rate: Number(state.settings.rate) || 0.9, lang: state.settings.lang });
  el.micButton.classList.remove('speaking');
  el.homeStatus.textContent = 'Tap the big button and speak';
}

el.repeatButton.addEventListener('click', () => {
  if (state.lastSpoken) say(state.lastSpoken);
});

el.helpButton.addEventListener('click', () => {
  say('You can say things like: call Mary, what time is it, I took my pill, or just ask me a question. Tap the microphone, then speak.');
});

// --- Emergency quick call ---
function refreshEmergencyButton() {
  const contact = getEmergencyContact();
  if (contact) {
    el.emergencyButton.hidden = false;
    el.emergencyName.textContent = contact.name;
    el.emergencyButton.onclick = () => placeCall(contact);
  } else {
    el.emergencyButton.hidden = true;
  }
}

function placeCall(contact) {
  say(`Calling ${contact.name} now.`);
  window.location.href = `tel:${contact.phone.replace(/[^0-9+]/g, '')}`;
}

// --- Command handling ---
async function handleUserText(text) {
  el.youSaid.textContent = `You said: "${text}"`;
  const command = parseCommand(text);

  switch (command.type) {
    case 'empty':
      await say("I didn't catch that. Please try again.");
      return;

    case 'stop':
      stopSpeaking();
      el.homeStatus.textContent = 'Tap the big button and speak';
      return;

    case 'call': {
      const contact = findContactByName(command.name);
      if (contact) {
        placeCall(contact);
      } else {
        await say(`I couldn't find anyone named ${command.name} in your contacts. You can add them in the Contacts tab.`);
      }
      return;
    }

    case 'time': {
      const now = new Date();
      await say(`It's ${now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`);
      return;
    }

    case 'date': {
      const now = new Date();
      await say(`Today is ${now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}.`);
      return;
    }

    case 'help':
      await say('You can say: call, and then a name. What time is it. What is the date. I took my pill. Or just ask me anything.');
      return;

    case 'took_pill':
      acknowledgeCurrentReminder();
      await say('Good job! I have marked that pill as taken.');
      return;

    case 'ai':
    default: {
      el.homeStatus.textContent = 'Thinking...';
      const result = await askHelper(command.text, state.history);
      state.history.push({ role: 'user', content: command.text });
      state.history.push({ role: 'assistant', content: result.text });
      saveHistory(state.history);
      await say(result.text);
      return;
    }
  }
}

// --- Microphone / recognition ---
let recognizer = null;

function ensureRecognizer() {
  if (recognizer) return recognizer;
  recognizer = createRecognizer({
    lang: state.settings.lang,
    onStart: () => {
      el.micButton.classList.add('listening');
      el.homeStatus.textContent = 'Listening...';
    },
    onEnd: () => {
      el.micButton.classList.remove('listening');
    },
    onError: (err) => {
      el.micButton.classList.remove('listening');
      el.homeStatus.textContent = 'Tap the big button and speak';
      if (err && err.error === 'permission-denied') {
        say('I need permission to use the microphone. Please turn it on in Settings.');
      }
    },
    onResult: (transcript) => {
      handleUserText(transcript);
    },
  });
  return recognizer;
}

el.micButton.addEventListener('click', () => {
  stopSpeaking();
  if (!isSpeechRecognitionSupported()) {
    say('Sorry, this device cannot listen to your voice. Please use the text box in Settings instead.');
    return;
  }
  const r = ensureRecognizer();
  r.lang = state.settings.lang;
  if (r.listening()) {
    r.stop();
  } else {
    r.start();
  }
});

el.fallbackSend.addEventListener('click', () => {
  const text = el.fallbackText.value.trim();
  if (!text) return;
  el.fallbackText.value = '';
  handleUserText(text);
});
el.fallbackText.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el.fallbackSend.click();
});

// --- Contacts ---
function renderContacts() {
  const contacts = getContacts();
  el.contactsList.innerHTML = '';
  if (!contacts.length) {
    el.contactsList.innerHTML = '<p class="empty-note">No contacts yet. Add someone below.</p>';
  }
  contacts.forEach(c => {
    const card = document.createElement('div');
    card.className = 'list-card';
    card.innerHTML = `
      <div class="info">
        <div class="name">${escapeHtml(c.name)}${c.isEmergency ? ' ⭐' : ''}</div>
        <div class="meta">${escapeHtml(c.phone)}</div>
      </div>
      <div class="actions">
        <button class="icon-action call" aria-label="Call ${escapeHtml(c.name)}">📞</button>
        <button class="icon-action delete" aria-label="Delete ${escapeHtml(c.name)}">🗑️</button>
      </div>
    `;
    card.querySelector('.call').addEventListener('click', () => placeCall(c));
    card.querySelector('.delete').addEventListener('click', () => {
      deleteContact(c.id);
      renderContacts();
      refreshEmergencyButton();
    });
    el.contactsList.appendChild(card);
  });
}

el.addContactButton.addEventListener('click', () => {
  const name = el.contactName.value.trim();
  const phone = el.contactPhone.value.trim();
  if (!name || !phone) {
    alert('Please enter both a name and a phone number.');
    return;
  }
  addContact({ name, phone, isEmergency: el.contactEmergency.checked });
  el.contactName.value = '';
  el.contactPhone.value = '';
  el.contactEmergency.checked = false;
  renderContacts();
  refreshEmergencyButton();
});

// --- Medications ---
function renderMedTimeChips() {
  el.medTimeChips.innerHTML = '';
  pendingMedTimes.forEach((time, idx) => {
    const chip = document.createElement('span');
    chip.className = 'time-chip';
    chip.textContent = formatTime(time);
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '✕';
    removeBtn.setAttribute('aria-label', `Remove ${formatTime(time)}`);
    removeBtn.addEventListener('click', () => {
      pendingMedTimes.splice(idx, 1);
      renderMedTimeChips();
    });
    chip.appendChild(removeBtn);
    el.medTimeChips.appendChild(chip);
  });
}

el.addMedTimeButton.addEventListener('click', () => {
  const time = el.medTime.value;
  if (!time) return;
  if (!pendingMedTimes.includes(time)) {
    pendingMedTimes.push(time);
    renderMedTimeChips();
  }
  el.medTime.value = '';
});

el.addMedButton.addEventListener('click', () => {
  const name = el.medName.value.trim();
  if (!name || !pendingMedTimes.length) {
    alert('Please enter a pill name and at least one time.');
    return;
  }
  addMedication({ name, times: pendingMedTimes });
  el.medName.value = '';
  pendingMedTimes = [];
  renderMedTimeChips();
  renderMedications();
});

function renderMedications() {
  const meds = getMedications();
  el.medsList.innerHTML = '';
  if (!meds.length) {
    el.medsList.innerHTML = '<p class="empty-note">No pill reminders yet. Add one below.</p>';
  }
  meds.forEach(m => {
    const card = document.createElement('div');
    card.className = 'list-card';
    card.innerHTML = `
      <div class="info">
        <div class="name">${escapeHtml(m.name)}</div>
        <div class="meta">${m.times.map(formatTime).join(', ')}</div>
      </div>
      <div class="actions">
        <button class="icon-action delete" aria-label="Delete ${escapeHtml(m.name)}">🗑️</button>
      </div>
    `;
    card.querySelector('.delete').addEventListener('click', () => {
      deleteMedication(m.id);
      renderMedications();
    });
    el.medsList.appendChild(card);
  });
}

function formatTime(time24) {
  const [h, m] = time24.split(':').map(Number);
  const date = new Date();
  date.setHours(h, m, 0, 0);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// --- Medication reminders (in-app, while the app is open) ---
function acknowledgeCurrentReminder() {
  if (!state.currentReminder) return;
  markTaken(state.currentReminder.medication.id, state.currentReminder.time);
  closeReminderOverlay();
}

function openReminderOverlay(due) {
  state.currentReminder = due;
  el.reminderText.textContent = `It's time to take your ${due.medication.name}.`;
  el.reminderOverlay.hidden = false;
  say(`It's time to take your ${due.medication.name}.`);
}

function closeReminderOverlay() {
  state.currentReminder = null;
  el.reminderOverlay.hidden = true;
}

el.reminderTaken.addEventListener('click', () => {
  acknowledgeCurrentReminder();
});
el.reminderSnooze.addEventListener('click', () => {
  if (state.currentReminder) {
    snoozeTaken(state.currentReminder.medication.id, state.currentReminder.time, 10);
  }
  closeReminderOverlay();
});

function checkMedications() {
  if (state.currentReminder) return;
  const due = findDueMedication();
  if (due) openReminderOverlay(due);
}

setInterval(checkMedications, 20000);
setTimeout(checkMedications, 2000);

// --- Native reminder notification actions (app closed/backgrounded case) ---
function wireNativeReminderListeners() {
  const plugins = window.Capacitor && window.Capacitor.Plugins;
  if (!plugins || !plugins.LocalNotifications) return;

  plugins.LocalNotifications.addListener('localNotificationActionPerformed', (payload) => {
    const extra = payload && payload.notification && payload.notification.extra;
    if (!extra) return;
    if (payload.actionId === 'taken') {
      markTaken(extra.medId, extra.time);
    } else if (payload.actionId === 'snooze') {
      snoozeTaken(extra.medId, extra.time, 10);
    }
  });
}

// --- Settings ---
function fillSettingsForm() {
  el.speechRateSelect.value = String(state.settings.rate);
  el.speechLangSelect.value = state.settings.lang;
  if (isNative()) el.installAppBox.hidden = true;
  updatePermissionStatus();
}

function updatePermissionStatus() {
  if (isNative()) {
    el.permissionStatus.textContent = 'Voice and reminders are ready. Tap the button if you were not asked to allow them yet.';
    el.permissionStatus.className = 'status-banner ok';
  } else {
    const supported = isSpeechRecognitionSupported() && isSpeechSynthesisSupported();
    el.permissionStatus.textContent = supported
      ? 'Using your browser\'s voice features.'
      : 'Voice may be limited in this browser - install the app for full support.';
    el.permissionStatus.className = supported ? 'status-banner ok' : 'status-banner warn';
  }
}

el.speechRateSelect.addEventListener('change', () => {
  state.settings.rate = Number(el.speechRateSelect.value);
  saveSettings(state.settings);
});

el.speechLangSelect.addEventListener('change', () => {
  state.settings.lang = el.speechLangSelect.value;
  saveSettings(state.settings);
  if (recognizer) recognizer.lang = state.settings.lang;
});

async function handleEnablePermissions() {
  const voiceOk = await requestVoicePermissions();
  const remindersOk = await requestReminderPermissions();
  if (voiceOk && remindersOk) {
    say('Thank you. Voice and reminders are turned on.');
  } else {
    say('Some permissions were not turned on. You can allow them from your phone\'s app settings.');
  }
  updatePermissionStatus();
}

el.enablePermissionsButton.addEventListener('click', handleEnablePermissions);
el.homeEnablePermissionsButton.addEventListener('click', handleEnablePermissions);

function updateHomeInstallLinks() {
  if (isNative()) {
    el.homeDownloadAppLink.hidden = true;
    el.homeEnablePermissionsButton.textContent = '🔔 Voice & Reminders are on';
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Service worker (browser/PWA use only) ---
if ('serviceWorker' in navigator && !isNative()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {
      // Offline support is best-effort; ignore registration failures.
    });
  });
}

// --- Init ---
refreshEmergencyButton();
updateHomeInstallLinks();
wireNativeReminderListeners();
registerReminderActions();
syncNativeReminders();
if (!isSpeechSynthesisSupported()) {
  el.homeStatus.textContent = 'Voice is not supported on this device.';
}
