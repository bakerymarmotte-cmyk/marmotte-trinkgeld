import { requireSession, logout } from "./session.js";
import { db } from "./firebase-config.js";
import {
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc, onSnapshot, query, orderBy, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { toast } from "./ui.js";

// ==========================================================================
// Marmotte Trinkgeld – Daten in Firebase (Projekt marmotte-trinkgeld), nur Admin
//   mitarbeiter/{id}         name, active
//   einstellungen/abteilung  name, percent
//   buchungen/{id}           type "booking" | "payout", ts, date, …
// Guthaben werden nicht gespeichert, sondern immer aus allen Buchungen berechnet.
// So können sie nie «auseinanderlaufen».
// ==========================================================================

const DEPT = "__dept";

let employees = [];          // alle Mitarbeitenden (auch inaktive, für Namen im Verlauf)
let dept = { name: "Abteilung", percent: 10 };
let logs = [];               // alle Buchungen, nach Zeit sortiert
let balances = {};
let worked = {}, deptOn = true;
let editing = null;          // {id,date,tipStr,deptOn,checked:{},roster:[{id,name}]}
let geladen = { emp: false, logs: false };

const aktive = () => employees.filter((e) => e.active !== false);
function fmt(r) { return "CHF " + (r / 100).toFixed(2); }
function fr(r) { return (r / 100).toFixed(2); }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function bal(id) { return balances[id] || 0; }
function toR(str) { return Math.round((parseFloat(String(str).replace(",", ".")) || 0) * 100); }
function todayISO() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function deDate(iso) { const p = String(iso).split("-"); return p.length === 3 ? `${p[2]}.${p[1]}.${p[0]}` : iso; }

// gemeinsame Aufteilungslogik (exakt, Restrappen an erste Empfänger)
function splitCredits(tipR, on, roster, isChecked) {
  const ws = roster.filter((m) => isChecked(m.id));
  const n = ws.length;
  const deptShare = on ? Math.round(tipR * dept.percent / 100) : 0;
  const remaining = tipR - deptShare;
  const per = n > 0 ? Math.floor(remaining / n) : 0;
  const rest = n > 0 ? remaining - per * n : remaining;
  const credits = ws.map((w, i) => ({ id: w.id, name: w.name, amount: per + (i < rest ? 1 : 0) }));
  return { n, deptShare, credits };
}

// Guthaben aus allen Buchungen berechnen
function berechneGuthaben() {
  balances = {};
  for (const l of logs) {
    if (l.type === "booking") {
      if (l.deptOn && l.deptShare > 0) balances[DEPT] = bal(DEPT) + l.deptShare;
      l.credits.forEach((c) => (balances[c.id] = bal(c.id) + c.amount));
    } else if (l.type === "payout" || l.type === "abzug") {
      l.items.forEach((it) => (balances[it.id] = bal(it.id) - it.amount));
    }
  }
}

// ---- Start ----
async function start() {
  let session;
  try { session = await requireSession(); } catch (e) { return; }
  document.getElementById("logout-btn").addEventListener("click", logout);
  document.getElementById("user-name-label").textContent = session.profile.name || "";
  if (session.profile.role !== "admin") {
    document.querySelector(".wrap").innerHTML = '<p class="empty">Die Trinkgeld-App ist nur für den Admin freigegeben.</p>';
    return;
  }
  setup();

  onSnapshot(query(collection(db, "mitarbeiter"), orderBy("name")), (snap) => {
    employees = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    geladen.emp = true;
    alleNeuZeichnen();
  }, (err) => { console.error(err); toast("Mitarbeitende konnten nicht geladen werden."); });

  onSnapshot(doc(db, "einstellungen", "abteilung"), (snap) => {
    if (snap.exists()) dept = { name: snap.data().name || "Abteilung", percent: snap.data().percent ?? 10 };
    // Eingabefelder nur nachführen, wenn gerade niemand darin tippt
    if (document.activeElement !== deptNameEl) deptNameEl.value = dept.name;
    if (document.activeElement !== deptPctEl) deptPctEl.value = dept.percent;
    deptLabel(); renderPick(); updateBookBtn();
  }, (err) => console.error(err));

  onSnapshot(query(collection(db, "buchungen"), orderBy("ts")), (snap) => {
    logs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    geladen.logs = true;
    berechneGuthaben();
    alleNeuZeichnen();
  }, (err) => { console.error(err); toast("Buchungen konnten nicht geladen werden."); });
}

function alleNeuZeichnen() {
  renderPick(); updateBookBtn(); renderEmp(); renderPot();
  if (!editing) renderLog();
}

// ---- Tabs ----
let deptNameEl, deptPctEl;
function setup() {
  const views = { book: "viewBook", pot: "viewPot", team: "viewTeam", log: "viewLog" };
  document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("on")); t.classList.add("on");
    Object.values(views).forEach((v) => document.getElementById(v).classList.add("hidden"));
    document.getElementById(views[t.dataset.v]).classList.remove("hidden");
    if (t.dataset.v === "log") { editing = null; renderLog(); }
  }));

  // Abteilung (Name und Prozent) – mit kurzer Verzögerung speichern, nicht bei jedem Tastendruck
  deptNameEl = document.getElementById("deptName");
  deptPctEl = document.getElementById("deptPct");
  let t;
  const speichereDept = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      setDoc(doc(db, "einstellungen", "abteilung"), { name: dept.name, percent: dept.percent, updatedAt: serverTimestamp() })
        .catch((e) => { console.error(e); toast("Abteilung konnte nicht gespeichert werden."); });
    }, 600);
  };
  deptNameEl.addEventListener("input", () => { dept.name = deptNameEl.value; deptLabel(); speichereDept(); });
  deptPctEl.addEventListener("input", () => {
    let p = parseFloat(deptPctEl.value); if (isNaN(p)) p = 0; p = Math.max(0, Math.min(100, p));
    dept.percent = p; deptLabel(); speichereDept();
  });

  // Team
  const newName = document.getElementById("newName");
  document.getElementById("addBtn").onclick = addEmp;
  newName.addEventListener("keydown", (e) => { if (e.key === "Enter") addEmp(); });

  // Buchen
  document.getElementById("bookDate").value = todayISO();
  document.getElementById("tip").addEventListener("input", () => { renderPick(); updateBookBtn(); });
  document.getElementById("deptToggle").onclick = () => {
    deptOn = !deptOn;
    document.getElementById("deptToggle").classList.toggle("on", deptOn);
    document.getElementById("deptState").textContent = deptOn ? "aktiv" : "aus";
    renderPick(); updateBookBtn();
  };
  document.getElementById("bookBtn").onclick = buchen;
  document.getElementById("payBtn").onclick = auszahlen;

  // Abzug nach Arbeitstagen: Standard = die letzten 7 Tage
  const h = new Date(); const vor = new Date(h.getFullYear(), h.getMonth(), h.getDate() - 6);
  document.getElementById("abzVon").value = isoVon(vor);
  document.getElementById("abzBis").value = todayISO();
  ["abzVon", "abzBis", "abzBetrag", "abzText"].forEach((id) => document.getElementById(id).addEventListener("input", renderAbzug));
  document.getElementById("abzBtn").onclick = abzugBuchen;
  deptLabel();
}

function deptLabel() { document.getElementById("deptLabel").textContent = `${dept.name} · ${dept.percent}%`; }

// ---- Team ----
async function addEmp() {
  const el = document.getElementById("newName");
  const n = el.value.trim(); if (!n) return;
  if (aktive().some((e) => e.name.toLowerCase() === n.toLowerCase())) { toast("Diesen Namen gibt es schon"); return; }
  el.value = "";
  try { await addDoc(collection(db, "mitarbeiter"), { name: n, active: true, createdAt: serverTimestamp() }); }
  catch (e) { console.error(e); toast("Speichern fehlgeschlagen"); el.value = n; }
}
// Mitarbeitende werden nicht gelöscht, nur ausgeblendet – sonst fehlen Namen im Verlauf
async function removeEmp(id) {
  const e = employees.find((x) => x.id === id);
  if (bal(id) !== 0 && !confirm(`${e.name} hat noch ein Guthaben von ${fmt(bal(id))}. Trotzdem entfernen? Das Guthaben bleibt im Topf sichtbar, bis es ausbezahlt ist.`)) return;
  if (bal(id) === 0 && !confirm(`${e.name} aus dem Team entfernen?`)) return;
  delete worked[id];
  try { await updateDoc(doc(db, "mitarbeiter", id), { active: false }); }
  catch (err) { console.error(err); toast("Entfernen fehlgeschlagen"); }
}
function renderEmp() {
  const box = document.getElementById("empList");
  if (!geladen.emp) return;
  const list = aktive();
  if (!list.length) { box.innerHTML = '<p class="empty">Noch keine Mitarbeiter. Oben eintragen.</p>'; return; }
  box.innerHTML = list.map((e) => `<div class="emp"><span class="name">${esc(e.name)}</span><button class="del" data-id="${e.id}" aria-label="Entfernen"><i data-icon="trash-2" data-size="17"></i></button></div>`).join("");
  box.querySelectorAll(".del").forEach((b) => (b.onclick = () => removeEmp(b.dataset.id)));
}

// ---- Buchen ----
function currentSplit() { return splitCredits(toR(document.getElementById("tip").value), deptOn, aktive(), (id) => !!worked[id]); }
function renderPick() {
  const box = document.getElementById("pickList");
  if (!geladen.emp) return;
  if (!aktive().length) { box.innerHTML = '<p class="empty" style="text-align:left">Noch keine Mitarbeiter. Wechsle zu <b>Team</b>.</p>'; return; }
  const { credits } = currentSplit(); const cmap = {}; credits.forEach((c) => (cmap[c.id] = c.amount));
  box.innerHTML = aktive().map((e) => {
    const on = !!worked[e.id];
    const amt = (on && cmap[e.id] != null) ? `<span class="amt">+${fr(cmap[e.id])}</span>` : "";
    return `<button class="pick ${on ? "on" : ""}" data-id="${e.id}"><span class="box">${on ? '<i data-icon="check" data-size="14"></i>' : ""}</span><span class="pname">${esc(e.name)}</span>${amt}</button>`;
  }).join("");
  box.querySelectorAll(".pick").forEach((b) => (b.onclick = () => { const id = b.dataset.id; worked[id] = !worked[id]; renderPick(); updateBookBtn(); }));
}
function updateBookBtn() {
  const t = toR(document.getElementById("tip").value); const { n, deptShare } = currentSplit();
  const btn = document.getElementById("bookBtn"), hint = document.getElementById("bookHint");
  btn.disabled = !(t > 0 && n > 0);
  if (t <= 0) hint.textContent = "Betrag eingeben.";
  else if (n <= 0) hint.textContent = "Mindestens eine Person auswählen.";
  else hint.textContent = deptOn ? `${dept.name}: +${fr(deptShare)} · ${n} Mitarbeiter` : `${n} Mitarbeiter`;
}
async function buchen() {
  const t = toR(document.getElementById("tip").value); const { n, deptShare, credits } = currentSplit();
  if (!(t > 0 && n > 0)) return;
  const entry = { type: "booking", ts: Date.now(), date: document.getElementById("bookDate").value,
    tip: t, deptOn, deptName: dept.name, deptShare: deptOn ? deptShare : 0, credits, createdAt: serverTimestamp() };
  const btn = document.getElementById("bookBtn");
  btn.disabled = true;
  try {
    await addDoc(collection(db, "buchungen"), entry);
    document.getElementById("tip").value = ""; worked = {}; renderPick(); updateBookBtn();
    const f = document.getElementById("bookFlash");
    f.innerHTML = `<div class="flash">Gebucht: ${fmt(t)} vom ${deDate(entry.date)} verteilt.</div>`;
    setTimeout(() => { f.innerHTML = ""; }, 4000);
  } catch (e) {
    console.error(e); toast("Buchen fehlgeschlagen. Bitte Verbindung prüfen."); updateBookBtn();
  }
}

// ---- Topf ----
function totalPot() { let s = 0; for (const k in balances) s += balances[k]; return s; }
function isoVon(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

function renderPot() {
  renderAbzug();
  document.getElementById("potTotal").textContent = fmt(totalPot());
  const box = document.getElementById("balList"); const rows = [];
  if (bal(DEPT) !== 0) rows.push(balRow(DEPT, dept.name, bal(DEPT), true));
  // aktive Mitarbeitende + ausgeblendete, die noch Guthaben haben
  employees.filter((e) => e.active !== false || bal(e.id) !== 0)
    .forEach((e) => rows.push(balRow(e.id, e.name + (e.active === false ? " (ausgetreten)" : ""), bal(e.id), false)));
  box.innerHTML = rows.length ? rows.join("") : '<p class="empty">Noch keine Guthaben.</p>';
}
function balRow(id, name, r, isDept) {
  const suggest = Math.max(0, Math.floor(r / 100) * 100);
  const right = r > 0
    ? `<span class="pin"><span>CHF</span><input inputmode="decimal" data-id="${id}" data-max="${r}" value="${(suggest / 100).toFixed(2)}" /></span>`
    : '<span class="dash">—</span>';
  return `<div class="bal ${isDept ? "dept" : ""}"><span class="bn">${esc(name)}</span>` +
         `<span class="bb ${r < 0 ? "neg" : ""}">Guthaben ${fr(r)}</span>${right}</div>`;
}
async function auszahlen() {
  const inputs = document.querySelectorAll("#balList input"); const items = []; let over = false;
  inputs.forEach((inp) => {
    const id = inp.dataset.id, max = parseInt(inp.dataset.max, 10);
    let r = toR(inp.value); if (r <= 0) return; if (r > max) { r = max; over = true; }
    const name = id === DEPT ? dept.name : ((employees.find((e) => e.id === id) || {}).name || "—");
    items.push({ id, name, amount: r });
  });
  if (!items.length) { alert("Keine Auszahlbeträge eingegeben."); return; }
  const total = items.reduce((s, i) => s + i.amount, 0);
  if (!confirm(`Auszahlung von ${fmt(total)} an ${items.length} ${items.length === 1 ? "Person" : "Personen"} buchen?`)) return;
  try {
    await addDoc(collection(db, "buchungen"), { type: "payout", ts: Date.now(), date: todayISO(), items, createdAt: serverTimestamp() });
    toast(over ? "Auszahlung gebucht. Einzelne Beträge wurden aufs Guthaben begrenzt." : "Auszahlung gebucht.");
  } catch (e) { console.error(e); toast("Auszahlung fehlgeschlagen. Bitte Verbindung prüfen."); }
}

// ---- Abzug nach Arbeitstagen ----
// Zählt pro Person, an wie vielen verschiedenen Tagen sie im Zeitraum Trinkgeld bekommen hat,
// und verteilt den Betrag anteilmässig. Restrappen gehen an die grössten Nachkommastellen.
function abzugBerechnen() {
  const von = document.getElementById("abzVon").value, bis = document.getElementById("abzBis").value;
  const betrag = toR(document.getElementById("abzBetrag").value);
  const tage = {}; // id → Set(datum)
  const namen = {};
  for (const l of logs) {
    if (l.type !== "booking" || l.date < von || l.date > bis) continue;
    l.credits.forEach((c) => { (tage[c.id] ||= new Set()).add(l.date); namen[c.id] = c.name; });
  }
  const personen = Object.keys(tage).map((id) => ({
    id, name: (employees.find((e) => e.id === id) || {}).name || namen[id], tage: tage[id].size,
  })).sort((a, b) => b.tage - a.tage || a.name.localeCompare(b.name));
  const sumTage = personen.reduce((s, p) => s + p.tage, 0);
  if (!(betrag > 0) || !sumTage || !von || !bis || von > bis) return { von, bis, betrag, personen, sumTage, items: [] };
  const roh = personen.map((p) => ({ ...p, exakt: betrag * p.tage / sumTage }));
  roh.forEach((p) => (p.amount = Math.floor(p.exakt)));
  let rest = betrag - roh.reduce((s, p) => s + p.amount, 0);
  [...roh].sort((a, b) => (b.exakt - b.amount) - (a.exakt - a.amount)).forEach((p) => { if (rest > 0) { p.amount++; rest--; } });
  return { von, bis, betrag, personen, sumTage, items: roh.map(({ id, name, tage, amount }) => ({ id, name, tage, amount })) };
}
function renderAbzug() {
  const box = document.getElementById("abzVorschau"), btn = document.getElementById("abzBtn");
  if (!box || !geladen.logs) return;
  const r = abzugBerechnen();
  if (!r.von || !r.bis || r.von > r.bis) { box.innerHTML = '<p class="hint" style="text-align:left">Bitte einen gültigen Zeitraum wählen.</p>'; btn.disabled = true; return; }
  if (!r.personen.length) { box.innerHTML = '<p class="hint" style="text-align:left">In diesem Zeitraum hat niemand Trinkgeld bekommen.</p>'; btn.disabled = true; return; }
  box.innerHTML = `<div class="vorschau">${r.personen.map((p) => {
    const it = r.items.find((i) => i.id === p.id);
    return `<div class="vr"><span>${esc(p.name)}<span class="vt">${p.tage} ${p.tage === 1 ? "Tag" : "Tage"}</span></span><span class="va">${it ? "−" + fr(it.amount) : ""}</span></div>`;
  }).join("")}</div><p class="hint" style="text-align:left; margin-top:0;">${r.sumTage} Arbeitstage total${r.betrag > 0 ? ` · ${fmt(r.betrag)} verteilt` : ""}</p>`;
  btn.disabled = !(r.betrag > 0 && r.items.length && document.getElementById("abzText").value.trim());
}
async function abzugBuchen() {
  const r = abzugBerechnen();
  const text = document.getElementById("abzText").value.trim();
  if (!(r.betrag > 0) || !r.items.length) return;
  if (!text) { toast("Bitte eine Bezeichnung eingeben"); return; }
  if (!confirm(`«${text}»: ${fmt(r.betrag)} auf ${r.items.length} Personen verteilen und von ihrem Guthaben abziehen?`)) return;
  try {
    await addDoc(collection(db, "buchungen"), {
      type: "abzug", ts: Date.now(), date: todayISO(), von: r.von, bis: r.bis, text, betrag: r.betrag, items: r.items, createdAt: serverTimestamp(),
    });
    document.getElementById("abzBetrag").value = ""; document.getElementById("abzText").value = "";
    toast("Abzug gebucht");
  } catch (e) { console.error(e); toast("Abzug fehlgeschlagen. Bitte Verbindung prüfen."); }
}

// ---- Verlauf ----
function renderLog() {
  const box = document.getElementById("logList");
  if (!geladen.logs) { box.innerHTML = '<p class="loading">Lädt …</p>'; return; }
  if (!logs.length) { box.innerHTML = '<p class="empty">Noch keine Einträge.</p>'; return; }
  const items = logs.slice().reverse();
  box.innerHTML = items.map((l, idx) => {
    const isLast = idx === 0;
    if (editing && l.type === "booking" && l.id === editing.id) return '<div id="editorMount"></div>';
    if (l.type === "booking") {
      const lines = [];
      if (l.deptOn && l.deptShare > 0) lines.push(`${esc(l.deptName)}: +${fr(l.deptShare)}`);
      l.credits.forEach((c) => lines.push(`${esc(c.name)}: +${fr(c.amount)}`));
      return `<div class="logitem booking"><div class="lh"><span class="lt">${fmt(l.tip)} gebucht${l.edited ? '<span class="edited">bearbeitet</span>' : ""}</span><span class="ld">${deDate(l.date)}</span></div>` +
             `<div class="lb">${lines.join(" · ")}</div>` +
             `<div class="actions"><button class="abtn" data-edit="${l.id}">Bearbeiten</button>` +
             (isLast ? `<button class="abtn danger" data-undo="${l.id}">Löschen</button>` : "") + "</div></div>";
    }
    if (l.type === "abzug") {
      const lines = l.items.map((i) => `${esc(i.name)} (${i.tage} ${i.tage === 1 ? "Tag" : "Tage"}): −${fr(i.amount)}`);
      return `<div class="logitem abzug"><div class="lh"><span class="lt">${esc(l.text || "Abzug")} −${fr(l.betrag)}</span><span class="ld">${deDate(l.date)}</span></div>` +
             `<div class="lb">Zeitraum ${deDate(l.von)} – ${deDate(l.bis)} · ${lines.join(" · ")}</div>` +
             (isLast ? `<div class="actions"><button class="abtn danger" data-undo="${l.id}">Löschen</button></div>` : "") + "</div>";
    }
    const total = l.items.reduce((s, i) => s + i.amount, 0);
    const lines = l.items.map((i) => `${esc(i.name)}: −${fr(i.amount)}`);
    return `<div class="logitem payout"><div class="lh"><span class="lt">Auszahlung −${fr(total)}</span><span class="ld">${deDate(l.date)}</span></div>` +
           `<div class="lb">${lines.join(" · ")}</div>` +
           (isLast ? `<div class="actions"><button class="abtn danger" data-undo="${l.id}">Löschen</button></div>` : "") + "</div>";
  }).join("");
  box.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => openEdit(b.dataset.edit)));
  box.querySelectorAll("[data-undo]").forEach((b) => (b.onclick = () => undoEntry(b.dataset.undo)));
  if (editing) mountEditor();
}
async function undoEntry(id) {
  if (!confirm("Diesen Eintrag löschen?")) return;
  try { await deleteDoc(doc(db, "buchungen", id)); toast("Eintrag gelöscht"); }
  catch (e) { console.error(e); toast("Löschen fehlgeschlagen"); }
}

// ---- Buchung bearbeiten ----
function openEdit(id) {
  const l = logs.find((x) => x.id === id); if (!l || l.type !== "booking") return;
  const roster = aktive().map((e) => ({ id: e.id, name: e.name }));
  l.credits.forEach((c) => { if (!roster.find((e) => e.id === c.id)) roster.push({ id: c.id, name: c.name }); });
  editing = { id, date: l.date, tipStr: (l.tip / 100).toFixed(2), deptOn: l.deptOn, checked: {}, roster };
  l.credits.forEach((c) => (editing.checked[c.id] = true));
  renderLog();
}
function mountEditor() {
  const m = document.getElementById("editorMount"); if (!m) return;
  m.innerHTML =
    `<div class="editor">
       <div class="ecap">Buchung bearbeiten</div>
       <div class="erow"><input class="smtxt" type="date" id="eDate" value="${editing.date}"></div>
       <div class="erow"><input class="smtxt" id="eTip" inputmode="decimal" value="${editing.tipStr}" placeholder="Betrag CHF"></div>
       <div class="erow"><button class="etoggle ${editing.deptOn ? "on" : ""}" id="eDept">${esc(dept.name)} · ${dept.percent}%<span>${editing.deptOn ? "aktiv" : "aus"}</span></button></div>
       <div id="ePicks"></div>
       <div class="epreview" id="ePreview"></div>
       <div class="actions">
         <button class="abtn" id="eCancel">Abbrechen</button>
         <button class="cta" id="eSave" style="margin-top:0">Speichern</button>
       </div>
     </div>`;
  document.getElementById("eDate").onchange = (e) => { editing.date = e.target.value; };
  document.getElementById("eTip").oninput = (e) => { editing.tipStr = e.target.value; renderEditDynamic(); };
  document.getElementById("eDept").onclick = () => {
    editing.deptOn = !editing.deptOn;
    document.getElementById("eDept").classList.toggle("on", editing.deptOn);
    document.getElementById("eDept").querySelector("span").textContent = editing.deptOn ? "aktiv" : "aus";
    renderEditDynamic();
  };
  document.getElementById("eCancel").onclick = () => { editing = null; renderLog(); };
  document.getElementById("eSave").onclick = saveEdit;
  renderEditDynamic();
}
function editSplit() { return splitCredits(toR(editing.tipStr), editing.deptOn, editing.roster, (id) => !!editing.checked[id]); }
function renderEditDynamic() {
  const { n, deptShare, credits } = editSplit(); const cmap = {}; credits.forEach((c) => (cmap[c.id] = c.amount));
  document.getElementById("ePicks").innerHTML = editing.roster.map((e) => {
    const on = !!editing.checked[e.id];
    const amt = (on && cmap[e.id] != null) ? `<span class="amt">+${fr(cmap[e.id])}</span>` : "";
    return `<button class="pick ${on ? "on" : ""}" data-id="${e.id}"><span class="box">${on ? '<i data-icon="check" data-size="14"></i>' : ""}</span><span class="pname">${esc(e.name)}</span>${amt}</button>`;
  }).join("");
  document.querySelectorAll("#ePicks .pick").forEach((b) => (b.onclick = () => { const id = b.dataset.id; editing.checked[id] = !editing.checked[id]; renderEditDynamic(); }));
  const t = toR(editing.tipStr);
  let msg;
  if (t <= 0) msg = "Betrag eingeben.";
  else if (n <= 0) msg = "Mindestens eine Person auswählen.";
  else msg = (editing.deptOn ? `${dept.name}: +${fr(deptShare)} · ` : "") + `${n} Mitarbeiter · Total ${fmt(t)}`;
  document.getElementById("ePreview").textContent = msg;
  document.getElementById("eSave").disabled = !(t > 0 && n > 0);
}
async function saveEdit() {
  const t = toR(editing.tipStr); const { n, deptShare, credits } = editSplit();
  if (!(t > 0 && n > 0)) { alert("Betrag und mindestens eine Person nötig."); return; }
  try {
    await updateDoc(doc(db, "buchungen", editing.id), {
      date: editing.date, tip: t, deptOn: editing.deptOn, deptName: dept.name,
      deptShare: editing.deptOn ? deptShare : 0, credits, edited: true, updatedAt: serverTimestamp(),
    });
    editing = null; renderLog(); toast("Buchung gespeichert");
  } catch (e) { console.error(e); toast("Speichern fehlgeschlagen"); }
}

start();
