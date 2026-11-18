// Gemeinsamer Zustand der Trinkgeld-App

export const S = {
  session: null,
  isAdmin: false,
  standorte: [],   // [{id, name, active}]
  toepfe: [],      // [{id, standortId, name, prozent, art, reihenfolge, active}]
  personen: [],    // [{id, standortId, topfId, name, stellen, active}]
  eintraege: [],   // nur Admin: alle Einträge (Tag, Auszahlung, Abzug), nach Zeit sortiert
  aktSid: null,    // gewählter Standort
  geladen: { standorte: false, toepfe: false, personen: false, eintraege: false },
};

const hoerer = [];
/** Bereich meldet sich an, um bei Datenänderungen neu zu zeichnen */
export function beiAenderung(fn) { hoerer.push(fn); }
export function aenderung() { hoerer.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); }

const sortTopf = (a, b) => (a.reihenfolge ?? 0) - (b.reihenfolge ?? 0) || a.name.localeCompare(b.name);
export function toepfeVon(sid, auchInaktive = false) {
  return S.toepfe.filter((t) => t.standortId === sid && (auchInaktive || t.active !== false)).sort(sortTopf);
}
export function personenVon(sid, auchInaktive = false) {
  return S.personen.filter((p) => p.standortId === sid && (auchInaktive || p.active !== false))
    .sort((a, b) => a.name.localeCompare(b.name));
}
export function standortName(sid) { return S.standorte.find((s) => s.id === sid)?.name || ""; }
export function eintraegeVon(sid) { return S.eintraege.filter((e) => e.standortId === sid); }
