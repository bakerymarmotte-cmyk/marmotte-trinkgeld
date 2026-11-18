import { db } from "./firebase-config.js";
import {
  collection, addDoc, getDocs, query, where, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { S, beiAenderung, toepfeVon, personenVon, standortName } from "./state.js";
import { tagVerteilen, toR, fr, fmt, esc, isoVon, deDate } from "./rechnen.js";
import { toast } from "./ui.js";

// Tagestrinkgeld eines Standorts buchen: wird nach Prozent auf die Töpfe verteilt,
// in jedem Topf nach Anwahl (wer gearbeitet hat) oder nach Stellenprozent.
export function initBuchen() {
  let gewaehlt = {};       // personId → true
  let letzterSid = null;
  const dateEl = document.getElementById("bookDate");
  const tipEl = document.getElementById("tip");
  const box = document.getElementById("buchenToepfe");
  const btn = document.getElementById("bookBtn");
  const hint = document.getElementById("bookHint");
  dateEl.value = isoVon();

  function daten() {
    const toepfe = toepfeVon(S.aktSid);
    const personen = personenVon(S.aktSid);
    return { toepfe, personen, r: tagVerteilen(toR(tipEl.value), toepfe, personen, gewaehlt) };
  }

  function render() {
    if (S.aktSid !== letzterSid) { gewaehlt = {}; letzterSid = S.aktSid; }
    if (!S.geladen.toepfe || !S.geladen.personen) { box.innerHTML = '<p class="loading">Lädt …</p>'; return; }
    if (!S.aktSid) { box.innerHTML = '<p class="empty">Noch kein Standort eingerichtet.</p>'; aktualisiereKnopf(); return; }
    const { toepfe, personen, r } = daten();
    if (!toepfe.length) {
      box.innerHTML = `<p class="empty">Für ${esc(standortName(S.aktSid))} sind noch keine Töpfe eingerichtet.${S.isAdmin ? " Das geht unter «Einstellungen»." : ""}</p>`;
      aktualisiereKnopf(); return;
    }
    box.innerHTML = toepfe.map((t) => {
      const v = r.toepfe.find((x) => x.topfId === t.id);
      const cmap = Object.fromEntries((v?.credits || []).map((c) => [c.id, c.amount]));
      const mitglieder = personen.filter((p) => p.topfId === t.id);
      const zeilen = !mitglieder.length
        ? `<p class="hint left">Noch niemand in diesem Topf.${S.isAdmin ? " Personen erfassen unter «Personen»." : ""}</p>`
        : mitglieder.map((p) => {
            if (t.art === "stellen") {
              return `<div class="pick fix"><span class="pname">${esc(p.name)}</span><span class="pst">${p.stellen || 0} %</span>${cmap[p.id] != null ? `<span class="amt">+${fr(cmap[p.id])}</span>` : ""}</div>`;
            }
            const on = !!gewaehlt[p.id];
            return `<button class="pick ${on ? "on" : ""}" data-id="${p.id}"><span class="box">${on ? '<i data-icon="check" data-size="14"></i>' : ""}</span><span class="pname">${esc(p.name)}</span>${on && cmap[p.id] != null ? `<span class="amt">+${fr(cmap[p.id])}</span>` : ""}</button>`;
          }).join("");
      return `<div class="card">
        <div class="topf-head"><span><span class="tn">${esc(t.name)}</span> <span class="tp">${t.prozent} %</span></span><span class="tb">${fr(v?.betrag || 0)}</span></div>
        <div class="topf-art">${t.art === "stellen" ? "Ganzes Team nach Stellenprozent" : "Wer hat gearbeitet?"}</div>
        ${zeilen}
      </div>`;
    }).join("");
    box.querySelectorAll("button.pick").forEach((b) => b.addEventListener("click", () => {
      gewaehlt[b.dataset.id] = !gewaehlt[b.dataset.id];
      render();
    }));
    aktualisiereKnopf();
  }

  function aktualisiereKnopf() {
    const tip = toR(tipEl.value);
    if (!S.aktSid) { btn.disabled = true; hint.textContent = ""; return; }
    const { r } = daten();
    btn.disabled = !r.ok;
    hint.classList.toggle("fehler", tip > 0 && !r.ok);
    if (tip <= 0) hint.textContent = "Betrag eingeben.";
    else if (!r.ok) hint.textContent = r.fehler.join(" ");
    else hint.textContent = r.toepfe.map((t) => `${t.name}: ${fr(t.betrag)}`).join(" · ");
  }

  tipEl.addEventListener("input", render);

  btn.addEventListener("click", async () => {
    const tip = toR(tipEl.value);
    const datum = dateEl.value;
    const { r } = daten();
    if (!r.ok || !datum) return;
    btn.disabled = true;
    try {
      // Doppelbuchung? (gleicher Standort, gleiches Datum)
      const vorhanden = await getDocs(query(collection(db, "eintraege"),
        where("standortId", "==", S.aktSid), where("date", "==", datum), where("type", "==", "tag")));
      if (vorhanden.docs.length) {
        const summe = vorhanden.docs.reduce((s, d) => s + (d.data().tip || 0), 0);
        if (!confirm(`Für ${standortName(S.aktSid)} am ${deDate(datum)} ist schon ${fmt(summe)} gebucht. Trotzdem nochmals buchen?`)) { aktualisiereKnopf(); return; }
      }
      await addDoc(collection(db, "eintraege"), {
        type: "tag",
        standortId: S.aktSid,
        date: datum,
        tip,
        toepfe: r.toepfe,
        ts: Date.now(),
        createdAt: serverTimestamp(),
        erstelltVon: S.session.profile.name || "",
      });
      tipEl.value = "";
      gewaehlt = {};
      render();
      const f = document.getElementById("bookFlash");
      f.innerHTML = `<div class="flash">Gebucht: ${fmt(tip)} vom ${deDate(datum)} – ${r.toepfe.map((t) => `${esc(t.name)} ${fr(t.betrag)}`).join(", ")}.</div>`;
      setTimeout(() => { f.innerHTML = ""; }, 5000);
    } catch (e) {
      console.error(e);
      toast("Buchen fehlgeschlagen. Bitte Verbindung prüfen.");
      aktualisiereKnopf();
    }
  });

  beiAenderung(render);
}
