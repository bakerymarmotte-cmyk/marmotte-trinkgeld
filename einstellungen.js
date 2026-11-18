import { db } from "./firebase-config.js";
import {
  collection, doc, addDoc, updateDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { S, beiAenderung, toepfeVon, standortName } from "./state.js";
import { esc } from "./rechnen.js";
import { toast } from "./ui.js";

// Standorte und Töpfe verwalten (nur Admin)
export function initEinstellungen() {
  // ---------- Standorte ----------
  const sName = document.getElementById("sName");
  const sErr = document.getElementById("sErr");
  const sListe = document.getElementById("standorteListe");

  document.getElementById("sSpeichern").addEventListener("click", async () => {
    sErr.textContent = "";
    const name = sName.value.trim();
    if (!name) { sErr.textContent = "Bitte einen Namen eingeben."; return; }
    if (S.standorte.some((s) => s.name.toLowerCase() === name.toLowerCase())) { sErr.textContent = "Diesen Standort gibt es schon."; return; }
    try {
      await addDoc(collection(db, "standorte"), { name, active: true, createdAt: serverTimestamp() });
      sName.value = "";
      toast(`Standort «${name}» angelegt`);
    } catch (e) { console.error(e); sErr.textContent = "Speichern fehlgeschlagen."; }
  });

  function renderStandorte() {
    sListe.innerHTML = S.standorte.length ? S.standorte.map((s) => `
      <div class="item"><div class="im"><div class="in">${esc(s.name)}</div>
        <div class="is">${toepfeVon(s.id).length} Töpfe · ${S.personen.filter((p) => p.standortId === s.id && p.active !== false).length} Personen</div></div>
        <button class="ibtn" data-umbenennen="${s.id}"><i data-icon="pencil" data-size="14"></i> Umbenennen</button>
      </div>`).join("") : '<p class="hint left">Noch kein Standort.</p>';
    sListe.querySelectorAll("[data-umbenennen]").forEach((b) => b.addEventListener("click", async () => {
      const s = S.standorte.find((x) => x.id === b.dataset.umbenennen);
      const neu = (prompt("Neuer Name für den Standort:", s.name) || "").trim();
      if (!neu || neu === s.name) return;
      try { await updateDoc(doc(db, "standorte", s.id), { name: neu, updatedAt: serverTimestamp() }); }
      catch (e) { console.error(e); toast("Umbenennen fehlgeschlagen"); }
    }));
  }

  // ---------- Töpfe ----------
  let bearbeite = null;
  let art = "anwahl";
  const tName = document.getElementById("tName");
  const tProzent = document.getElementById("tProzent");
  const tErr = document.getElementById("tErr");
  const tSave = document.getElementById("tSpeichern");
  const tCancel = document.getElementById("tAbbrechen");
  const tTitel = document.getElementById("tForm-titel");
  const tListe = document.getElementById("toepfeListe");
  const tSumme = document.getElementById("tSumme");
  const artBtns = document.querySelectorAll("#tArt button");

  function setzeArt(a) { art = a; artBtns.forEach((b) => b.classList.toggle("on", b.dataset.art === a)); }
  artBtns.forEach((b) => b.addEventListener("click", () => setzeArt(b.dataset.art)));

  function topfFormLeeren() {
    bearbeite = null; tName.value = ""; tProzent.value = ""; tErr.textContent = ""; setzeArt("anwahl");
    tTitel.textContent = "Neuer Topf"; tSave.textContent = "Topf anlegen"; tCancel.classList.add("hidden");
  }
  tCancel.addEventListener("click", topfFormLeeren);

  tSave.addEventListener("click", async () => {
    tErr.textContent = "";
    if (!S.aktSid) { tErr.textContent = "Bitte zuerst einen Standort anlegen."; return; }
    const name = tName.value.trim();
    const prozent = parseInt(tProzent.value, 10);
    if (!name) { tErr.textContent = "Bitte einen Namen eingeben."; return; }
    if (!(prozent >= 0 && prozent <= 100)) { tErr.textContent = "Anteil zwischen 0 und 100 % eingeben."; return; }
    if (toepfeVon(S.aktSid).some((t) => t.id !== bearbeite && t.name.toLowerCase() === name.toLowerCase())) {
      tErr.textContent = "Diesen Topf gibt es an diesem Standort schon."; return;
    }
    tSave.disabled = true;
    try {
      if (bearbeite) {
        await updateDoc(doc(db, "toepfe", bearbeite), { name, prozent, art, updatedAt: serverTimestamp() });
        toast("Topf gespeichert");
      } else {
        await addDoc(collection(db, "toepfe"), {
          name, prozent, art, standortId: S.aktSid, active: true,
          reihenfolge: toepfeVon(S.aktSid, true).length, createdAt: serverTimestamp(),
        });
        toast(`Topf «${name}» angelegt`);
      }
      topfFormLeeren();
    } catch (e) { console.error(e); tErr.textContent = "Speichern fehlgeschlagen."; }
    finally { tSave.disabled = false; }
  });

  function renderToepfe() {
    document.getElementById("tStandort").textContent = standortName(S.aktSid) || "–";
    if (bearbeite && !S.toepfe.some((t) => t.id === bearbeite && t.standortId === S.aktSid)) topfFormLeeren();
    const alle = toepfeVon(S.aktSid, true);
    tListe.innerHTML = alle.length ? alle.map((t) => `
      <div class="item ${t.active === false ? "inaktiv" : ""}"><div class="im"><div class="in">${esc(t.name)} · ${t.prozent} %</div>
        <div class="is">${t.art === "stellen" ? "Nach Stellenprozent" : "Wer gearbeitet hat"} · ${S.personen.filter((p) => p.topfId === t.id && p.active !== false).length} Personen${t.active === false ? " · inaktiv" : ""}</div></div>
        ${t.active !== false ? `<button class="ibtn" data-edit="${t.id}"><i data-icon="pencil" data-size="14"></i></button>` : ""}
        <button class="ibtn" data-toggle="${t.id}">${t.active === false ? "Aktivieren" : "Deaktivieren"}</button>
      </div>`).join("") : '<p class="hint left">Noch keine Töpfe an diesem Standort.</p>';
    const summe = toepfeVon(S.aktSid).reduce((s, t) => s + (t.prozent || 0), 0);
    tSumme.className = "summe " + (summe === 100 ? "ok" : "nok");
    tSumme.textContent = alle.length ? (summe === 100 ? "Zusammen 100 % ✓" : `Zusammen ${summe} % – muss 100 % ergeben, sonst kann nicht gebucht werden.`) : "";

    tListe.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => {
      const t = S.toepfe.find((x) => x.id === b.dataset.edit);
      bearbeite = t.id; tName.value = t.name; tProzent.value = t.prozent; setzeArt(t.art);
      tTitel.textContent = "Topf bearbeiten"; tSave.textContent = "Speichern"; tCancel.classList.remove("hidden"); tErr.textContent = "";
      tName.scrollIntoView({ behavior: "smooth", block: "center" });
    }));
    tListe.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", async () => {
      const t = S.toepfe.find((x) => x.id === b.dataset.toggle);
      const neu = t.active === false;
      if (!neu && !confirm(`Topf «${t.name}» deaktivieren? Er bekommt dann kein Trinkgeld mehr. Bestehende Guthaben bleiben sichtbar.`)) return;
      try { await updateDoc(doc(db, "toepfe", t.id), { active: neu, updatedAt: serverTimestamp() }); }
      catch (e) { console.error(e); toast("Ändern fehlgeschlagen"); }
    }));
  }

  beiAenderung(() => { renderStandorte(); renderToepfe(); });
}
