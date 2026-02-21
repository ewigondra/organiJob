const API_BASE = '';
const AUTH_TOKEN_KEY = 'organijob_token';
const AUTH_EMAIL_KEY = 'organijob_email';

const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.tab-panel');

for (const tab of tabs) {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.remove('is-active'));
    panels.forEach((p) => p.classList.remove('is-active'));

    tab.classList.add('is-active');
    const panel = document.getElementById(tab.dataset.tab);
    if (panel) panel.classList.add('is-active');
  });
}

const contactForm = document.getElementById('contact-form');
const contactsList = document.getElementById('contacts-list');
const exportBtn = document.getElementById('export-contacts');

const loginForm = document.getElementById('login-form');
const emailInput = document.getElementById('email-login');
const passwordInput = document.getElementById('password-login');
const registerBtn = document.getElementById('register-btn');
const logoutBtn = document.getElementById('logout-btn');
const syncBtn = document.getElementById('sync-now');
const authStatus = document.getElementById('auth-status');
const syncStatus = document.getElementById('sync-status');

let contactsCache = [];

function getToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY) || '';
}

function setToken(token) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

function clearAuth() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_EMAIL_KEY);
}

function setEmail(email) {
  localStorage.setItem(AUTH_EMAIL_KEY, email);
}

function getEmail() {
  return localStorage.getItem(AUTH_EMAIL_KEY) || '';
}

function formatDate(isoLike) {
  if (!isoLike) return 'Date non renseignee';
  const date = new Date(isoLike);
  return Number.isNaN(date.getTime()) ? 'Date invalide' : date.toLocaleString('fr-FR');
}

function setSyncStatus(message, isError = false) {
  syncStatus.textContent = message;
  syncStatus.classList.toggle('is-error', isError);
}

function updateAuthUi() {
  const email = getEmail();
  const isLogged = Boolean(getToken() && email);

  authStatus.textContent = isLogged ? `Connecte: ${email}` : 'Non connecte';
  logoutBtn.disabled = !isLogged;
  syncBtn.disabled = !isLogged;
  emailInput.disabled = isLogged;
  passwordInput.disabled = isLogged;
  loginForm.querySelector('button[type="submit"]').disabled = isLogged;
  registerBtn.disabled = isLogged;
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erreur API');
  return data;
}

function renderContacts() {
  contactsList.innerHTML = '';
  const sorted = [...contactsCache].sort((a, b) => new Date(b.dateAppel) - new Date(a.dateAppel));

  if (!sorted.length) {
    contactsList.innerHTML = '<li class="item">Aucun contact ajoute pour le moment.</li>';
    return;
  }

  for (const contact of sorted) {
    const li = document.createElement('li');
    li.className = 'item';
    li.innerHTML = `
      <p><strong>${contact.nom}</strong> - ${contact.organisation}</p>
      <p><strong>Quand:</strong> ${formatDate(contact.dateAppel)}</p>
      <p><strong>Expertise:</strong> ${contact.expertise || 'Non precisee'}</p>
      <p><strong>Valeurs inclusives:</strong> ${contact.inclusivite || 'Non precisees'}</p>
      <p><strong>Notes:</strong> ${contact.notes || 'Aucune note'}</p>
    `;
    contactsList.appendChild(li);
  }
}

async function pullRemoteData() {
  const data = await api('/api/sync', { method: 'GET' });
  contactsCache = Array.isArray(data.contacts) ? data.contacts : [];
  renderContacts();
  setSyncStatus(`Synchronise le ${new Date(data.syncedAt).toLocaleString('fr-FR')}`);
}

async function pushRemoteData() {
  const data = await api('/api/sync', {
    method: 'PUT',
    body: JSON.stringify({ contacts: contactsCache }),
  });
  setSyncStatus(`Enregistre (${data.count} contacts) le ${new Date(data.syncedAt).toLocaleString('fr-FR')}`);
}

async function authenticate(path) {
  const email = emailInput.value.trim().toLowerCase();
  const password = passwordInput.value;

  if (!email || !password) {
    setSyncStatus('Email et mot de passe requis.', true);
    return;
  }

  try {
    const result = await api(path, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    setToken(result.token);
    setEmail(result.user.email);
    updateAuthUi();
    await pullRemoteData();
  } catch (error) {
    setSyncStatus(error.message, true);
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await authenticate('/api/auth/login');
});

registerBtn.addEventListener('click', async () => {
  await authenticate('/api/auth/register');
});

logoutBtn.addEventListener('click', async () => {
  try {
    if (getToken()) {
      await api('/api/auth/logout', { method: 'POST' });
    }
  } catch {
    // no-op
  }

  clearAuth();
  contactsCache = [];
  renderContacts();
  updateAuthUi();
  setSyncStatus('Deconnecte.');
  emailInput.value = '';
  passwordInput.value = '';
});

syncBtn.addEventListener('click', async () => {
  try {
    await pushRemoteData();
    await pullRemoteData();
  } catch (error) {
    setSyncStatus(error.message, true);
  }
});

contactForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!getToken()) {
    setSyncStatus('Connecte-toi pour enregistrer et synchroniser tes contacts.', true);
    return;
  }

  const payload = {
    id: crypto.randomUUID(),
    nom: document.getElementById('nom').value.trim(),
    organisation: document.getElementById('organisation').value.trim(),
    dateAppel: document.getElementById('dateAppel').value,
    expertise: document.getElementById('expertise').value.trim(),
    inclusivite: document.getElementById('inclusivite').value.trim(),
    notes: document.getElementById('notes').value.trim(),
  };

  contactsCache.push(payload);
  contactForm.reset();
  renderContacts();

  try {
    await pushRemoteData();
  } catch (error) {
    setSyncStatus(`Ajout local uniquement: ${error.message}`, true);
  }
});

exportBtn.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(contactsCache, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'contacts-organijob.json';
  a.click();
  URL.revokeObjectURL(url);
});

const iaTemplates = {
  relance: ({ domaine, contexte }) =>
    `Objet: Relance candidature ${domaine || 'poste cible'}\n\nBonjour,\nJe me permets de revenir vers vous suite a notre echange. Je reste tres motive(e) pour contribuer sur des missions en ${domaine || 'lien avec mon profil'}. ${contexte ? `Contexte: ${contexte}.` : ''}\nAuriez-vous une visibilite sur la suite du processus ?\n\nMerci pour votre retour.`,
  motivation: ({ domaine, contexte }) =>
    `Plan anti-demotivation (7 jours):\n1) 2 candidatures qualitatives ciblees ${domaine ? `en ${domaine}` : ''}.\n2) 1 prise de contact reseau par jour.\n3) 1 bloc de formation de 45 minutes.\n4) Bilan chaque soir: ce qui a marche et prochaine micro-action.\n${contexte ? `Point de depart: ${contexte}.` : ''}`,
  organisation: ({ domaine, contexte }) =>
    `Semaine structuree:\n- Lundi/Mardi: candidatures ciblees ${domaine ? `(${domaine})` : ''}.\n- Mercredi: suivi des relances et appels.\n- Jeudi: simulation d'entretien + optimisation CV.\n- Vendredi: reseau + veille d'offres.\n${contexte ? `Ajustement: ${contexte}.` : ''}`,
  reseau: ({ domaine, contexte }) =>
    `Message reseau court:\n\"Bonjour, je recherche actuellement une opportunite ${domaine ? `en ${domaine}` : ''}. Si vous avez 10 minutes cette semaine, j'aimerais beneficier de votre retour terrain. ${contexte ? `Contexte: ${contexte}.` : ''} Merci d'avance.\"`,
};

document.getElementById('generer-ia').addEventListener('click', () => {
  const objectif = document.getElementById('objectif').value;
  const domaine = document.getElementById('domaine-cible').value.trim();
  const contexte = document.getElementById('contexte-ia').value.trim();

  const generator = iaTemplates[objectif];
  const result = generator ? generator({ domaine, contexte }) : 'Aucune suggestion disponible.';
  const resultBox = document.getElementById('resultat-ia');
  resultBox.innerHTML = `<pre>${result}</pre>`;
});

const formationsData = [
  { titre: 'Initiation Data Analyst', ville: 'Paris', duree: '8 semaines', niveau: 'Debutant' },
  { titre: 'Bootcamp Developpement Web', ville: 'Lyon', duree: '12 semaines', niveau: 'Intermediaire' },
  { titre: 'Marketing Digital Inclusif', ville: 'Lille', duree: '6 semaines', niveau: 'Tous niveaux' },
  { titre: 'Anglais Professionnel', ville: 'Marseille', duree: '10 semaines', niveau: 'Debutant' },
  { titre: 'UX/UI Design', ville: 'Toulouse', duree: '9 semaines', niveau: 'Intermediaire' },
  { titre: 'Bureautique et gestion de projet', ville: 'Nantes', duree: '5 semaines', niveau: 'Debutant' },
];

function renderFormationCards(items) {
  const container = document.getElementById('formations-results');
  container.innerHTML = '';

  if (!items.length) {
    container.innerHTML = '<p class="card">Aucune formation trouvee avec ces criteres.</p>';
    return;
  }

  for (const item of items) {
    const card = document.createElement('article');
    card.className = 'formation-card';
    card.innerHTML = `
      <h3>${item.titre}</h3>
      <p><strong>Ville:</strong> ${item.ville}</p>
      <p><strong>Duree:</strong> ${item.duree}</p>
      <p><strong>Niveau:</strong> ${item.niveau}</p>
    `;
    container.appendChild(card);
  }
}

document.getElementById('search-formations').addEventListener('click', () => {
  const motCle = document.getElementById('formation-motcle').value.trim().toLowerCase();
  const ville = document.getElementById('formation-ville').value.trim().toLowerCase();

  const results = formationsData.filter((f) => {
    const matchMotCle = !motCle || f.titre.toLowerCase().includes(motCle);
    const matchVille = !ville || f.ville.toLowerCase().includes(ville);
    return matchMotCle && matchVille;
  });

  renderFormationCards(results);
});

const servicesData = [
  { nom: 'France Travail - Accompagnement renforce', ville: 'Paris', type: 'Public', contact: '3949' },
  { nom: 'Mission Locale Metropole', ville: 'Lyon', type: 'Jeunes', contact: 'mission-locale.example' },
  { nom: 'Cap Emploi', ville: 'Lille', type: 'Handicap', contact: 'cap-emploi.example' },
  { nom: 'Maison de l Emploi', ville: 'Marseille', type: 'Orientation', contact: 'maison-emploi.example' },
  { nom: 'CIDFF - Accompagnement femmes', ville: 'Toulouse', type: 'Inclusion', contact: 'cidff.example' },
  { nom: 'Club Recherche Emploi', ville: 'Nantes', type: 'Associatif', contact: 'club-emploi.example' },
];

function renderServiceCards(items) {
  const container = document.getElementById('services-results');
  container.innerHTML = '';

  if (!items.length) {
    container.innerHTML = '<p class="card">Aucun service trouve. Essaie une autre ville.</p>';
    return;
  }

  for (const service of items) {
    const card = document.createElement('article');
    card.className = 'service-card';
    card.innerHTML = `
      <h3>${service.nom}</h3>
      <p><strong>Ville:</strong> ${service.ville}</p>
      <p><strong>Type:</strong> ${service.type}</p>
      <p><strong>Contact:</strong> ${service.contact}</p>
    `;
    container.appendChild(card);
  }
}

document.getElementById('search-services').addEventListener('click', () => {
  const ville = document.getElementById('localisation-input').value.trim().toLowerCase();
  const results = servicesData.filter((s) => !ville || s.ville.toLowerCase().includes(ville));
  renderServiceCards(results);
});

async function init() {
  updateAuthUi();
  renderContacts();
  renderFormationCards(formationsData);
  renderServiceCards(servicesData);

  if (getToken() && getEmail()) {
    emailInput.value = getEmail();
    try {
      await pullRemoteData();
    } catch (error) {
      setSyncStatus(`Session expiree: ${error.message}`, true);
      clearAuth();
      updateAuthUi();
      emailInput.value = '';
      passwordInput.value = '';
    }
  } else {
    setSyncStatus('Connecte-toi pour activer la synchronisation inter appareils.');
  }
}

init();
