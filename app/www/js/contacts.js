const KEY = 'helper_contacts';

function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
}

export function getContacts() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || [];
  } catch {
    return [];
  }
}

function save(contacts) {
  localStorage.setItem(KEY, JSON.stringify(contacts));
}

export function addContact({ name, phone, isEmergency = false }) {
  const contacts = getContacts();
  if (isEmergency) contacts.forEach(c => { c.isEmergency = false; });
  contacts.push({ id: uid(), name: name.trim(), phone: phone.trim(), isEmergency });
  save(contacts);
  return contacts;
}

export function updateContact(id, updates) {
  const contacts = getContacts();
  if (updates.isEmergency) contacts.forEach(c => { c.isEmergency = false; });
  const idx = contacts.findIndex(c => c.id === id);
  if (idx !== -1) contacts[idx] = { ...contacts[idx], ...updates };
  save(contacts);
  return contacts;
}

export function deleteContact(id) {
  const contacts = getContacts().filter(c => c.id !== id);
  save(contacts);
  return contacts;
}

export function getEmergencyContact() {
  return getContacts().find(c => c.isEmergency) || null;
}

function normalize(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
}

export function findContactByName(query) {
  const contacts = getContacts();
  const q = normalize(query);
  if (!q) return null;
  let best = null;
  let bestScore = 0;
  for (const c of contacts) {
    const n = normalize(c.name);
    let score = 0;
    if (n === q) score = 100;
    else if (n.startsWith(q) || q.startsWith(n)) score = 80;
    else if (n.split(' ').some(p => p === q || p.startsWith(q))) score = 70;
    else if (n.includes(q) || q.includes(n)) score = 60;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return bestScore >= 60 ? best : null;
}
