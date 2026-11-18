import { db } from "./firebase-config.js";
import {
  collection, doc, addDoc, updateDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { S, beiAenderung, toepfeVon, eintraegeVon } from "./state.js";
import { guthaben, fr, esc } from "./rechnen.js";
import { toast } from "./ui.js";

// Team pro Standort. Jede Person gehört zu genau einem Topf.
// Personen werden nie gelöscht, nur deaktiviert (sonst fehlen Namen im Verlauf).
export function initPersonen() {
  let bearbeite = null;
  const nameEl = document.getElementById("pName");
  const topfEl = document.getElementById("pTopf");
  const stellenEl = document.getElementById("pStellen");
  const stellenFeld = document.getElementById("pStellenFeld");
  const errEl = document.getElementById("pErr");
  const saveBtn = document.getElementById("pSpeichern");
  const cancelBtn = document.getElementById("pAbbrechen");
  const titel = document.getElementById("pForm-titel");
  const liste = document.getElementById("personenListe");

  const topfVon = (id) => S.toepfe.find((t) => t.id === id);
  function stellenAnzeigen() {
    stellenFeld.style.visibility = topfVon(topfEl.value)?.art === "stellen" ? "visible" : "hidden";
  }
  topfEl.addEventListener("change", stellenAnzeigen);

  function formLeeren() {
    bearbeite = null;
    nameEl.value = ""; stellenEl.value = 100; errEl.textContent = "";
    titel.textContent = "Neue Person"; saveBtn.textContent = "Person hinzufügen";
    cancelBtn.classList.add("hidden"); topfEl.disabled = false;
    stellenAnzeigen();
  }
  cancelBtn.addEventListener("click", formLeeren);

  saveBtn.addEventListener("click", async () => {
    errEl.textContent = "";
    const name = nameEl.value.trim();
    const topf = topfVon(topfEl.value);
    const stellen = parseInt(stellenEl.value, 10);
    if (!name) { errEl.textContent = "Bitte einen Namen eingeben."; return; }
    if (!topf) { errEl.textContent = "Bitte zuerst unter «Einstellungen» einen Topf anlegen."; return; }
    if (topf.art === "stellen" && !(stellen >= 1 && stellen <= 100)) { errEl.textContent = "Stellenprozent zwischen 1 und 100 eingeben."; return; }
    const doppelt = S.personen.some((p) => p.standortId === S.aktSid && p.active !== false && p.id !== bearbeite &&
      p.name.toLowerCase() === name.toLowerCase());
    if (doppelt) { errEl.textContent = "Diesen Namen gibt es an diesem Standort schon."; return; }
    const st = topf.art === "stellen" ? stellen : (Number.isFinite(stellen) ? Math.max(0, Math.min(100, stellen)) : 100);
    saveBtn.disabled = true;
    try {
      if (bearbeite) {
        await updateDoc(doc(db, "personen", bearbeite), { name, stellen: st, updatedAt: serverTimestamp() });
        toast("Person gespeichert");
      } else {
        await addDoc(collection(db, "personen"), {
          name, standortId: S.aktSid, topfId: topf.id, stellen: st, active: true, createdAt: serverTimestamp(),
        });
        toast(`${name} hinzugefügt`);
      }
      formLeeren();
    } catch (e) { console.error(e); errEl.textContent = "Speichern fehlgeschlagen."; }
    finally { saveBtn.disabled = false; }
  });

  function render() {
    const toepfe = toepfeVon(S.aktSid);
    const aktuell = topfEl.value;
    topfEl.innerHTML = toepfe.length
      ? toepfe.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")
      : '<option value="">– zuerst Topf anlegen –</option>';
    if (toepfe.some((t) => t.id === aktuell)) topfEl.value = aktuell;
    if (bearbeite && !S.personen.some((p) => p.id === bearbeite && p.standortId === S.aktSid)) formLeeren();
    stellenAnzeigen();

    if (!S.aktSid) { liste.innerHTML = '<p class="empty">Noch kein Standort eingerichtet.</p>'; return; }
    const g = guthaben(eintraegeVon(S.aktSid));
    const alleToepfe = toepfeVon(S.aktSid, true);
    const html = alleToepfe.map((t) => {
      const ps = S.personen.filter((p) => p.topfId === t.id)
        .sort((a, b) => (a.active === false) - (b.active === false) || a.name.localeCompare(b.name));
      if (!ps.length && t.active === false) return "";
      return `<div class="gruppe">${esc(t.name)} · ${t.art === "stellen" ? "nach Stellenprozent" : "wer gearbeitet hat"}</div>` +
        (ps.length ? ps.map((p) => `
          <div class="item ${p.active === false ? "inaktiv" : ""}">
            <div class="im"><div class="in">${esc(p.name)}</div>
              <div class="is">${t.art === "stellen" ? `${p.stellen || 0} % · ` : ""}Guthaben ${fr(g.person[p.id] || 0)}${p.active === false ? " · inaktiv" : ""}</div></div>
            ${p.active !== false ? `<button class="ibtn" data-edit="${p.id}"><i data-icon="pencil" data-size="14"></i></button>` : ""}
            <button class="ibtn" data-toggle="${p.id}">${p.active === false ? "Aktivieren" : "Deaktivieren"}</button>
          </div>`).join("") : '<p class="hint left">Noch niemand.</p>');
    }).join("");
    liste.innerHTML = html || '<p class="empty">Noch keine Töpfe eingerichtet.</p>';

    liste.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => {
      const p = S.personen.find((x) => x.id === b.dataset.edit);
      bearbeite = p.id;
      nameEl.value = p.name; topfEl.value = p.topfId; topfEl.disabled = true; stellenEl.value = p.stellen ?? 100;
      titel.textContent = "Person bearbeiten (Topf bleibt)"; saveBtn.textContent = "Speichern";
      cancelBtn.classList.remove("hidden"); errEl.textContent = "";
      stellenAnzeigen();
      nameEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }));
    liste.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", async () => {
      const p = S.personen.find((x) => x.id === b.dataset.toggle);
      const neu = p.active === false;
      const r = g.person[p.id] || 0;
      if (!neu && !confirm(`${p.name} deaktivieren?${r !== 0 ? ` Das Guthaben von ${fr(r)} bleibt unter «Guthaben» sichtbar, bis es ausbezahlt ist.` : ""}`)) return;
      try { await updateDoc(doc(db, "personen", p.id), { active: neu, updatedAt: serverTimestamp() }); }
      catch (e) { console.error(e); toast("Ändern fehlgeschlagen"); }
    }));
  }

  beiAenderung(render);
}
