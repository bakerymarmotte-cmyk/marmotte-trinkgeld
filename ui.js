// Kleine gemeinsame UI-Hilfen

/** Kurze Rückmeldung unten am Bildschirm */
export function toast(text) {
  const el = document.getElementById("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2600);
}

export function openModal(id) { document.getElementById(id).classList.add("active"); }
export function closeModal(id) { document.getElementById(id).classList.remove("active"); }
