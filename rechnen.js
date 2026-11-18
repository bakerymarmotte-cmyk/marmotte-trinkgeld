// Rechnen – alle Beträge in Rappen (ganze Zahlen)

export const fr = (r) => ((r || 0) / 100).toFixed(2);
export const fmt = (r) => "CHF " + fr(r);
export function toR(str) {
  const n = parseFloat(String(str ?? "").replace(/['’\s]/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
export function isoVon(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function deDate(iso) {
  const p = String(iso || "").split("-");
  return p.length === 3 ? `${p[2]}.${p[1]}.${p[0]}` : iso;
}

/**
 * Betrag nach Gewichten aufteilen, exakt auf den Rappen.
 * Restrappen gehen an die grössten Nachkommastellen (bei Gleichstand an die Reihenfolge).
 */
export function nachGewicht(betrag, gewichte) {
  const summe = gewichte.reduce((s, g) => s + g, 0);
  if (!(betrag > 0) || !(summe > 0)) return gewichte.map(() => 0);
  const roh = gewichte.map((g, i) => ({ i, exakt: (betrag * g) / summe }));
  roh.forEach((r) => (r.wert = Math.floor(r.exakt)));
  let rest = betrag - roh.reduce((s, r) => s + r.wert, 0);
  [...roh].sort((a, b) => (b.exakt - b.wert) - (a.exakt - a.wert) || a.i - b.i)
    .forEach((r) => { if (rest > 0) { r.wert++; rest--; } });
  return roh.map((r) => r.wert);
}

/**
 * Tagestrinkgeld eines Standorts verteilen.
 * toepfe:   aktive Töpfe des Standorts [{id, name, prozent, art}]
 * personen: aktive Personen des Standorts [{id, name, topfId, stellen}]
 * gewaehlt: {personId: true} – wer hat gearbeitet (nur für Töpfe mit Art «anwahl»)
 * Ergebnis: { ok, fehler, toepfe: [{topfId, name, prozent, art, betrag, credits:[{id,name,amount,stellen?}]}] }
 */
export function tagVerteilen(tip, toepfe, personen, gewaehlt) {
  const fehler = [];
  const prozentSumme = toepfe.reduce((s, t) => s + (t.prozent || 0), 0);
  if (!toepfe.length) fehler.push("Für diesen Standort sind noch keine Töpfe eingerichtet.");
  else if (prozentSumme !== 100) fehler.push(`Die Töpfe ergeben zusammen ${prozentSumme} % statt 100 %.`);

  const betraege = nachGewicht(tip, toepfe.map((t) => t.prozent || 0));
  const ergebnis = toepfe.map((t, i) => {
    const mitglieder = personen.filter((p) => p.topfId === t.id);
    let credits = [];
    if (t.art === "stellen") {
      const anteile = nachGewicht(betraege[i], mitglieder.map((p) => p.stellen || 0));
      credits = mitglieder.map((p, k) => ({ id: p.id, name: p.name, stellen: p.stellen || 0, amount: anteile[k] }))
        .filter((c) => c.stellen > 0);
      if ((t.prozent || 0) > 0 && !credits.length) fehler.push(`«${t.name}»: niemand mit Stellenprozent im Team.`);
    } else {
      const da = mitglieder.filter((p) => gewaehlt[p.id]);
      const anteile = nachGewicht(betraege[i], da.map(() => 1));
      credits = da.map((p, k) => ({ id: p.id, name: p.name, amount: anteile[k] }));
      if ((t.prozent || 0) > 0 && !credits.length) fehler.push(`«${t.name}»: bitte wählen, wer gearbeitet hat.`);
    }
    return { topfId: t.id, name: t.name, prozent: t.prozent || 0, art: t.art, betrag: betraege[i], credits };
  });
  return { ok: !fehler.length && tip > 0, fehler, toepfe: ergebnis };
}

/**
 * Guthaben aus allen Einträgen berechnen.
 * Ergebnis: { person: {personId: rappen}, topf: {topfId: rappen} }
 */
export function guthaben(eintraege) {
  const person = {}, topf = {};
  const plus = (obj, k, v) => { obj[k] = (obj[k] || 0) + v; };
  for (const e of eintraege) {
    if (e.type === "tag") {
      for (const t of e.toepfe || []) for (const c of t.credits || []) { plus(person, c.id, c.amount); plus(topf, t.topfId, c.amount); }
    } else if (e.type === "auszahlung" || e.type === "abzug") {
      for (const it of e.items || []) { plus(person, it.id, -it.amount); plus(topf, e.topfId, -it.amount); }
    }
  }
  return { person, topf };
}

/**
 * Abzug in einem Anwahl-Topf: Betrag anteilmässig nach gearbeiteten Tagen im Zeitraum.
 */
export function abzugBerechnen(eintraege, topfId, von, bis, betrag, namen) {
  const tage = {}, name = {};
  for (const e of eintraege) {
    if (e.type !== "tag" || e.date < von || e.date > bis) continue;
    const t = (e.toepfe || []).find((x) => x.topfId === topfId);
    for (const c of t?.credits || []) { (tage[c.id] ||= new Set()).add(e.date); name[c.id] = c.name; }
  }
  const personen = Object.keys(tage)
    .map((id) => ({ id, name: namen[id] || name[id], tage: tage[id].size }))
    .sort((a, b) => b.tage - a.tage || a.name.localeCompare(b.name));
  const sumTage = personen.reduce((s, p) => s + p.tage, 0);
  const anteile = betrag > 0 ? nachGewicht(betrag, personen.map((p) => p.tage)) : personen.map(() => 0);
  return { personen, sumTage, items: personen.map((p, i) => ({ id: p.id, name: p.name, tage: p.tage, amount: anteile[i] })) };
}
