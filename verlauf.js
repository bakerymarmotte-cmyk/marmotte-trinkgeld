import { db } from "./firebase-config.js";
import { doc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { S, beiAenderung, eintraegeVon } from "./state.js";
import { fr, fmt, esc, deDate } from "./rechnen.js";
import { toast } from "./ui.js";

// Verlauf des gewählten Standorts (nur Admin). Einträge werden nicht geändert:
// ein falscher Eintrag wird gelöscht und neu gebucht. Die Guthaben rechnen sich automatisch neu.
export function initVerlauf() {
  const box = document.getElementById("logList");

  function render() {
    if (!S.geladen.eintraege) { box.innerHTML = '<p class="loading">Lädt …</p>'; return; }
    const ein = eintraegeVon(S.aktSid).slice().reverse();
    if (!ein.length) { box.innerHTML = '<p class="empty">Noch keine Einträge.</p>'; return; }
    box.innerHTML = ein.map((e) => {
      const von = e.erstelltVon ? ` · ${esc(e.erstelltVon)}` : "";
      if (e.type === "tag") {
        const teile = (e.toepfe || []).map((t) =>
          `<b>${esc(t.name)}</b> ${fr(t.betrag)}: ${(t.credits || []).map((c) => `${esc(c.name)} +${fr(c.amount)}`).join(", ") || "–"}`);
        return item(e, "tag", `${fmt(e.tip)} Trinkgeld`, teile.join("<br>"), von);
      }
      if (e.type === "abzug") {
        const lines = (e.items || []).map((i) => `${esc(i.name)} (${i.tage} ${i.tage === 1 ? "Tag" : "Tage"}) −${fr(i.amount)}`);
        return item(e, "abzug", `${esc(e.text || "Abzug")} −${fr(e.betrag)}`, `${esc(e.topfName || "")} · ${deDate(e.von)} – ${deDate(e.bis)}<br>${lines.join(", ")}`, von);
      }
      const total = (e.items || []).reduce((s, i) => s + i.amount, 0);
      return item(e, "auszahlung", `Auszahlung ${esc(e.topfName || "")} −${fr(total)}`, (e.items || []).map((i) => `${esc(i.name)} −${fr(i.amount)}`).join(", "), von);
    }).join("");
    box.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => loeschen(b.dataset.del)));
  }

  function item(e, art, titel, text, von) {
    return `<div class="logitem ${art}"><div class="lh"><span class="lt">${titel}</span><span class="ld">${deDate(e.date)}${von}</span></div>
      <div class="lb">${text}</div><button class="abtn" data-del="${e.id}">Löschen</button></div>`;
  }

  async function loeschen(id) {
    const e = S.eintraege.find((x) => x.id === id);
    const was = e.type === "tag" ? `Trinkgeld ${fmt(e.tip)}` : e.type === "abzug" ? `Abzug «${e.text}»` : "Auszahlung";
    if (!confirm(`${was} vom ${deDate(e.date)} löschen?\n\nDie Guthaben werden neu berechnet. Bei Fehlern danach einfach neu buchen.`)) return;
    try { await deleteDoc(doc(db, "eintraege", id)); toast("Eintrag gelöscht"); }
    catch (err) { console.error(err); toast("Löschen fehlgeschlagen"); }
  }

  beiAenderung(render);
}
