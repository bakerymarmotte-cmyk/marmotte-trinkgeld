import { requireSession, logout } from "./session.js";
import { db } from "./firebase-config.js";
import {
  collection, doc, onSnapshot, query, where, orderBy,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { S, aenderung, standortName } from "./state.js";
import { initBuchen } from "./buchen.js";
import { initGuthaben } from "./guthaben.js";
import { initPersonen } from "./personen.js";
import { initVerlauf } from "./verlauf.js";
import { initEinstellungen } from "./einstellungen.js";
import { initZugaenge } from "./zugaenge.js";
import { esc } from "./rechnen.js";
import { toast } from "./ui.js";

// ==========================================================================
// Marmotte Trinkgeld – Projekt marmotte-trinkgeld
//   standorte/{id}   name
//   toepfe/{id}      standortId, name, prozent, art ("anwahl" | "stellen"), reihenfolge, active
//   personen/{id}    standortId, topfId, name, stellen, active
//   eintraege/{id}   type "tag" | "auszahlung" | "abzug", standortId, date, …
// Rollen: admin = alles; standort = nur Tagestrinkgeld des eigenen Standorts buchen.
// Guthaben werden nicht gespeichert, sondern immer aus allen Einträgen berechnet.
// ==========================================================================

const MERKER = "trinkgeld-standort";

async function start() {
  try { S.session = await requireSession(); } catch (e) { return; }
  const { profile } = S.session;
  document.getElementById("logout-btn").addEventListener("click", logout);
  document.getElementById("user-name-label").textContent = profile.name || "";

  if (profile.role !== "admin" && !(profile.role === "standort" && profile.standortId)) {
    document.getElementById("wrap").innerHTML = '<p class="empty">Dieses Konto hat keinen Zugriff auf die Trinkgeld-App.</p>';
    return;
  }
  S.isAdmin = profile.role === "admin";
  document.body.classList.toggle("is-admin", S.isAdmin);
  S.aktSid = S.isAdmin ? merkerLesen() : profile.standortId;

  setupNav();
  initBuchen();
  if (S.isAdmin) { initGuthaben(); initPersonen(); initVerlauf(); initEinstellungen(); initZugaenge(); }

  const wahl = document.getElementById("standort-wahl");
  wahl.addEventListener("change", () => { S.aktSid = wahl.value; merkerSchreiben(S.aktSid); aenderung(); });

  const fehler = (was) => (err) => { console.error(err); toast(`${was} konnten nicht geladen werden.`); };
  const fertig = (was) => { S.geladen[was] = true; standortPruefen(); aenderung(); };

  if (S.isAdmin) {
    onSnapshot(collection(db, "standorte"), (snap) => {
      S.standorte = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name));
      fertig("standorte");
    }, fehler("Standorte"));
    onSnapshot(collection(db, "toepfe"), (snap) => {
      S.toepfe = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      fertig("toepfe");
    }, fehler("Töpfe"));
    onSnapshot(collection(db, "personen"), (snap) => {
      S.personen = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      fertig("personen");
    }, fehler("Personen"));
    onSnapshot(query(collection(db, "eintraege"), orderBy("ts")), (snap) => {
      S.eintraege = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      fertig("eintraege");
    }, fehler("Einträge"));
  } else {
    const sid = profile.standortId;
    onSnapshot(doc(db, "standorte", sid), (snap) => {
      S.standorte = snap.exists() ? [{ id: snap.id, ...snap.data() }] : [];
      fertig("standorte");
    }, fehler("Standortdaten"));
    onSnapshot(query(collection(db, "toepfe"), where("standortId", "==", sid)), (snap) => {
      S.toepfe = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      fertig("toepfe");
    }, fehler("Töpfe"));
    onSnapshot(query(collection(db, "personen"), where("standortId", "==", sid)), (snap) => {
      S.personen = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      fertig("personen");
    }, fehler("Personen"));
    S.geladen.eintraege = true; // Standort-Konten laden keine Guthaben
  }
}

// Gewählten Standort prüfen und die Standort-Leiste zeichnen
function standortPruefen() {
  if (!S.geladen.standorte) return;
  if (S.isAdmin && !S.standorte.some((s) => s.id === S.aktSid)) S.aktSid = S.standorte[0]?.id || null;
  const wahl = document.getElementById("standort-wahl");
  const name = document.getElementById("standort-name");
  if (S.isAdmin) {
    wahl.innerHTML = S.standorte.length
      ? S.standorte.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("")
      : '<option value="">– zuerst unter Einstellungen anlegen –</option>';
    wahl.value = S.aktSid || "";
    name.textContent = "";
  } else {
    name.textContent = standortName(S.aktSid) || "…";
  }
}

function setupNav() {
  const tabs = document.querySelectorAll(".tab");
  tabs.forEach((t) => t.addEventListener("click", () => {
    tabs.forEach((x) => x.classList.remove("on"));
    t.classList.add("on");
    document.querySelectorAll("section[id^='v-']").forEach((s) => s.classList.add("hidden"));
    document.getElementById("v-" + t.dataset.v).classList.remove("hidden");
    document.body.dataset.v = t.dataset.v;
    window.scrollTo(0, 0);
  }));
  document.body.dataset.v = "buchen";
}

function merkerLesen() { try { return localStorage.getItem(MERKER); } catch { return null; } }
function merkerSchreiben(v) { try { localStorage.setItem(MERKER, v); } catch { /* egal */ } }

start();
