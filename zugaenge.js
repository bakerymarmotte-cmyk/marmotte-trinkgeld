import { db, firebaseConfig } from "./firebase-config.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, getDocs, setDoc, updateDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { S, beiAenderung, standortName } from "./state.js";
import { esc } from "./rechnen.js";
import { toast } from "./ui.js";

// Zugänge (Anmeldekonten) verwalten – nur Admin.
// Rolle «Standort»: darf nur das Tagestrinkgeld des eigenen Standorts buchen.
export function initZugaenge() {
  const liste = document.getElementById("zugaengeListe");
  const errEl = document.getElementById("zErr");
  const saveBtn = document.getElementById("zSpeichern");
  const rolleEl = document.getElementById("zRolle");
  const standortEl = document.getElementById("zStandort");
  const standortFeld = document.getElementById("zStandortFeld");
  let geladen = false;

  function rolleAnzeigen() { standortFeld.style.visibility = rolleEl.value === "standort" ? "visible" : "hidden"; }
  rolleEl.addEventListener("change", rolleAnzeigen);
  rolleAnzeigen();

  async function lade() {
    try {
      const snap = await getDocs(collection(db, "users"));
      const users = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.active === false) - (b.active === false) || (a.name || "").localeCompare(b.name || ""));
      liste.innerHTML = users.map((u) => `
        <div class="item ${u.active === false ? "inaktiv" : ""}">
          <div class="im"><div class="in">${esc(u.name)}</div>
            <div class="is">${esc(u.email)} · ${u.role === "admin" ? "Admin" : u.role === "standort" ? `Standort ${esc(standortName(u.standortId) || "?")}` : "ohne Zugriff"}${u.active === false ? " · inaktiv" : ""}</div></div>
          ${u.id === S.session.uid ? '<span class="is">Du</span>' :
            `<button class="ibtn" data-toggle="${u.id}" data-active="${u.active !== false}">${u.active === false ? "Aktivieren" : "Deaktivieren"}</button>`}
        </div>`).join("");
      liste.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", async () => {
        try { await updateDoc(doc(db, "users", b.dataset.toggle), { active: b.dataset.active !== "true" }); lade(); }
        catch (e) { console.error(e); toast("Ändern fehlgeschlagen"); }
      }));
    } catch (e) {
      console.error(e);
      liste.innerHTML = '<p class="fehler hint left">Zugänge konnten nicht geladen werden.</p>';
    }
  }

  // Erst laden, wenn die Einstellungen geöffnet werden
  document.querySelector('.tab[data-v="einst"]').addEventListener("click", () => { if (!geladen) { geladen = true; lade(); } });

  saveBtn.addEventListener("click", async () => {
    errEl.textContent = "";
    const name = document.getElementById("zName").value.trim();
    const email = document.getElementById("zEmail").value.trim();
    const pass = document.getElementById("zPass").value;
    const role = rolleEl.value;
    const standortId = standortEl.value;
    if (!name || !email) { errEl.textContent = "Bitte Name und E-Mail ausfüllen."; return; }
    if (pass.length < 8) { errEl.textContent = "Das temporäre Passwort braucht mindestens 8 Zeichen."; return; }
    if (role === "standort" && !standortId) { errEl.textContent = "Bitte einen Standort wählen."; return; }
    saveBtn.disabled = true;
    // Zweite Firebase-Instanz: so bleibt der Admin angemeldet
    const zweit = initializeApp(firebaseConfig, "Zweit-" + Date.now());
    const zweitAuth = getAuth(zweit);
    try {
      const cred = await createUserWithEmailAndPassword(zweitAuth, email, pass);
      const daten = { name, email, role, active: true, mustChangePassword: true, createdAt: serverTimestamp() };
      if (role === "standort") daten.standortId = standortId;
      await setDoc(doc(db, "users", cred.user.uid), daten);
      await signOut(zweitAuth);
      ["zName", "zEmail", "zPass"].forEach((id) => (document.getElementById(id).value = ""));
      toast(`Zugang für ${name} erstellt`);
      geladen = true;
      lade();
    } catch (e) {
      console.error(e);
      errEl.textContent = {
        "auth/email-already-in-use": "Diese E-Mail-Adresse wird bereits verwendet.",
        "auth/invalid-email": "Diese E-Mail-Adresse ist ungültig.",
        "auth/weak-password": "Das Passwort ist zu schwach.",
      }[e.code] || "Zugang konnte nicht erstellt werden.";
    } finally {
      await deleteApp(zweit).catch(() => {});
      saveBtn.disabled = false;
    }
  });

  beiAenderung(() => {
    const aktuell = standortEl.value;
    standortEl.innerHTML = S.standorte.length
      ? S.standorte.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("")
      : '<option value="">– zuerst Standort anlegen –</option>';
    if (S.standorte.some((s) => s.id === aktuell)) standortEl.value = aktuell;
  });
}
