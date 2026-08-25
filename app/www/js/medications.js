const MEDS_KEY = 'helper_medications';
const LOG_KEY = 'helper_med_log';
const ACTION_TYPE_ID = 'PILL_REMINDER';

function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
}

function nativePlugins() {
  return (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())
    ? window.Capacitor.Plugins
    : null;
}

// Stable 31-bit id derived from "medId_time" so the same reminder always
// maps to the same native notification id (needed to cancel/replace it).
function notificationId(medId, time) {
  const str = `${medId}_${time}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 2147483647;
}

export function getMedications() {
  try {
    return JSON.parse(localStorage.getItem(MEDS_KEY)) || [];
  } catch {
    return [];
  }
}

function saveMeds(meds) {
  localStorage.setItem(MEDS_KEY, JSON.stringify(meds));
  syncNativeReminders(meds);
}

export function addMedication({ name, times }) {
  const meds = getMedications();
  meds.push({ id: uid(), name: name.trim(), times: [...times].sort(), enabled: true });
  saveMeds(meds);
  return meds;
}

export function updateMedication(id, updates) {
  const meds = getMedications();
  const idx = meds.findIndex(m => m.id === id);
  if (idx !== -1) meds[idx] = { ...meds[idx], ...updates };
  saveMeds(meds);
  return meds;
}

export function deleteMedication(id) {
  const meds = getMedications().filter(m => m.id !== id);
  saveMeds(meds);
  return meds;
}

function getLog() {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY)) || {};
  } catch {
    return {};
  }
}

function saveLog(log) {
  localStorage.setItem(LOG_KEY, JSON.stringify(log));
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function markTaken(medId, time) {
  const log = getLog();
  log[`${todayKey()}_${medId}_${time}`] = true;
  saveLog(log);
}

export function snoozeTaken(medId, time, minutes = 10) {
  const log = getLog();
  log[`snooze_${medId}_${time}`] = Date.now() + minutes * 60 * 1000;
  saveLog(log);
}

function wasTaken(medId, time) {
  const log = getLog();
  return !!log[`${todayKey()}_${medId}_${time}`];
}

function isSnoozed(medId, time) {
  const log = getLog();
  const until = log[`snooze_${medId}_${time}`];
  return typeof until === 'number' && Date.now() < until;
}

/** Returns the first due, unacknowledged medication reminder, or null.
 *  Used for the in-app checker while the app is open; native OS
 *  notifications (see syncNativeReminders) cover the app-closed case. */
export function findDueMedication({ windowMinutes = 15 } = {}) {
  const meds = getMedications().filter(m => m.enabled);
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  for (const med of meds) {
    for (const time of med.times) {
      const [h, m] = time.split(':').map(Number);
      const schedMinutes = h * 60 + m;
      const diff = nowMinutes - schedMinutes;
      if (diff >= 0 && diff <= windowMinutes && !wasTaken(med.id, time) && !isSnoozed(med.id, time)) {
        return { medication: med, time };
      }
    }
  }
  return null;
}

/** Registers the "I took it" / "Remind me later" buttons on native
 *  reminder notifications. Call once at app start. */
export async function registerReminderActions() {
  const plugins = nativePlugins();
  if (!plugins || !plugins.LocalNotifications) return;
  try {
    await plugins.LocalNotifications.registerActionTypes({
      types: [{
        id: ACTION_TYPE_ID,
        actions: [
          { id: 'taken', title: 'I took it' },
          { id: 'snooze', title: 'Remind me in 10 minutes' },
        ],
      }],
    });
  } catch {
    // Action buttons are a nice-to-have; ignore if unsupported.
  }
}

/** Keeps native OS-level daily reminders in sync with the saved
 *  medication list, so reminders still fire while the app is closed. */
export async function syncNativeReminders(meds = getMedications()) {
  const plugins = nativePlugins();
  if (!plugins || !plugins.LocalNotifications) return;

  try {
    const pending = await plugins.LocalNotifications.getPending();
    if (pending.notifications.length) {
      await plugins.LocalNotifications.cancel({
        notifications: pending.notifications.map(n => ({ id: n.id })),
      });
    }

    const notifications = [];
    for (const med of meds.filter(m => m.enabled)) {
      for (const time of med.times) {
        const [hour, minute] = time.split(':').map(Number);
        notifications.push({
          id: notificationId(med.id, time),
          title: `Time for your ${med.name}`,
          body: 'Tap "I took it" once you have taken it.',
          actionTypeId: ACTION_TYPE_ID,
          extra: { medId: med.id, time },
          schedule: { on: { hour, minute }, repeats: true, allowWhileIdle: true },
        });
      }
    }

    if (notifications.length) {
      await plugins.LocalNotifications.schedule({ notifications });
    }
  } catch {
    // Native scheduling is best-effort - the in-app checker still covers
    // reminders while the app is open.
  }
}

export async function requestReminderPermissions() {
  const plugins = nativePlugins();
  if (!plugins || !plugins.LocalNotifications) return true;
  try {
    const status = await plugins.LocalNotifications.requestPermissions();
    return status.display === 'granted';
  } catch {
    return false;
  }
}
