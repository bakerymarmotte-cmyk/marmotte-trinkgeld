import { db } from "./firebase-config.js";
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { S, beiAenderung, toepfeVon, eintraegeVon } from "./state.js";
import { guthaben, abzugBerechnen, toR, fr, fmt, esc, isoVon, deDate } from "./rechnen.js";
import { toast } from "./ui.js";

// Guthaben pro Topf, Auszahlung pro Topf, Abzug (nur in Töpfen «wer gearbeitet hat»). Nur Admin.
export function initGuthaben() {
  const box = document.getElementById("guthabenToepfe");
  const payDate = document.getElementById("payDate");
  payDate.value = isoVon();
  const abzugEingaben = {}; // topfId → {von, bis, betrag, text, offen}
  const payEingaben = {};   // personId → eingegebener Auszahlbetrag (Text), bleibt bei Live-Aktualisierungen stehen

  function render() {
    if (!S.geladen.eintraege || !S.geladen.toepfe || !S.geladen.personen) { box.innerHTML = '<p class="loading">Lädt …</p>'; return; }
    if (!S.aktSid) { box.innerHTML = '<p class="empty">Noch kein Standort eingerichtet.</p>'; return; }
    // Fokus und Eingaben merken, damit Live-Aktualisierungen nichts überschreiben
    const fokus = document.activeElement?.dataset?.fokus;

    const ein = eintraegeVon(S.aktSid);
    const g = guthaben(ein);
    const aktiv = toepfeVon(S.aktSid);
    const inaktivMitGeld = toepfeVon(S.aktSid, true).filter((t) => t.active === false && (g.topf[t.id] || 0) !== 0);
    const toepfe = [...aktiv, ...inaktivMitGeld];
    if (!toepfe.length) { box.innerHTML = '<p class="empty">Noch keine Töpfe eingerichtet.</p>'; return; }

    box.innerHTML = toepfe.map((t) => {
      const personen = S.personen.filter((p) => p.topfId === t.id && (p.active !== false || (g.person[p.id] || 0) !== 0))
        .sort((a, b) => a.name.localeCompare(b.name));
      const zeilen = personen.length ? personen.map((p) => {
        const r = g.person[p.id] || 0;
        const vorschlag = Math.max(0, Math.floor(r / 100) * 100);
        const key = `pay-${p.id}`;
        const wert = payEingaben[p.id] ?? (vorschlag / 100).toFixed(2);
        const rechts = r > 0
          ? `<span class="pin"><span>CHF</span><input inputmode="decimal" data-fokus="${key}" data-id="${p.id}" data-max="${r}" value="${esc(wert)}"></span>`
          : '<span class="dash">—</span>';
        return `<div class="bal"><span class="bn">${esc(p.name)}${p.active === false ? " (ausgetreten)" : ""}</span><span class="bb ${r < 0 ? "neg" : ""}">Guthaben ${fr(r)}</span>${rechts}</div>`;
      }).join("") : '<p class="hint left">Niemand in diesem Topf.</p>';

      const a = abzugEingaben[t.id] || {};
      const abzug = t.art === "anwahl" ? `
        <details class="abzug" data-topf="${t.id}" ${a.offen ? "open" : ""}>
          <summary>Abzug nach Arbeitstagen</summary>
          <p class="hint left">Ein Betrag wird auf alle verteilt, die im Zeitraum in diesem Topf Trinkgeld bekommen haben – anteilmässig nach Anzahl Tage. Guthaben dürfen ins Minus gehen.</p>
          <div class="row2">
            <div><label class="lbl">Von</label><input class="txt" type="date" data-abz="von" value="${a.von || ""}"></div>
            <div><label class="lbl">Bis</label><input class="txt" type="date" data-abz="bis" value="${a.bis || ""}"></div>
          </div>
          <label class="lbl">Betrag</label>
          <div class="tipbox small"><span class="cur">CHF</span><input data-abz="betrag" inputmode="decimal" placeholder="0.00" value="${esc(a.betrag || "")}"></div>
          <label class="lbl">Bezeichnung</label>
          <input class="txt" data-abz="text" maxlength="80" placeholder="z.B. Kassendifferenz Woche 47" value="${esc(a.text || "")}" style="margin-bottom:12px;">
          <div class="abz-vorschau"></div>
          <button class="cta" data-abzug-buchen="${t.id}" disabled>Abzug buchen</button>
        </details>` : "";

      return `<div class="card" data-topf-card="${t.id}">
        <div class="pot"><span class="k">${esc(t.name)}${t.active === false ? " (inaktiv)" : ""}</span><span class="v">${fmt(g.topf[t.id] || 0)}</span></div>
        ${zeilen}
        ${personen.some((p) => (g.person[p.id] || 0) > 0) ? `<button class="cta" data-auszahlen="${t.id}">Auszahlung ${esc(t.name)} buchen</button>` : ""}
        ${abzug}
      </div>`;
    }).join("");

    // Abzug: Eingaben merken, Vorschau rechnen
    box.querySelectorAll("details.abzug").forEach((d) => {
      const tid = d.dataset.topf;
      const st = (abzugEingaben[tid] ||= standardAbzug());
      d.querySelector('[data-abz="von"]').value = st.von;
      d.querySelector('[data-abz="bis"]').value = st.bis;
      d.addEventListener("toggle", () => { st.offen = d.open; });
      d.querySelectorAll("[data-abz]").forEach((i) => i.addEventListener("input", () => { st[i.dataset.abz] = i.value; abzugVorschau(d, tid, ein); }));
      abzugVorschau(d, tid, ein);
    });
    box.querySelectorAll("input[data-max]").forEach((i) => i.addEventListener("input", () => { payEingaben[i.dataset.id] = i.value; }));
    box.querySelectorAll("[data-auszahlen]").forEach((b) => b.addEventListener("click", () => auszahlen(b.dataset.auszahlen)));
    box.querySelectorAll("[data-abzug-buchen]").forEach((b) => b.addEventListener("click", () => abzugBuchen(b.dataset.abzugBuchen, ein)));
    if (fokus) box.querySelector(`[data-fokus="${fokus}"]`)?.focus();
  }

  function standardAbzug() {
    const h = new Date();
    return { von: isoVon(new Date(h.getFullYear(), h.getMonth(), h.getDate() - 6)), bis: isoVon(h), betrag: "", text: "", offen: false };
  }
  const namen = () => Object.fromEntries(S.personen.map((p) => [p.id, p.name]));

  function abzugVorschau(d, tid, ein) {
    const st = abzugEingaben[tid];
    const out = d.querySelector(".abz-vorschau");
    const btn = d.querySelector("[data-abzug-buchen]");
    if (!st.von || !st.bis || st.von > st.bis) { out.innerHTML = '<p class="hint left">Bitte einen gültigen Zeitraum wählen.</p>'; btn.disabled = true; return; }
    const betrag = toR(st.betrag);
    const r = abzugBerechnen(ein, tid, st.von, st.bis, betrag, namen());
    if (!r.personen.length) { out.innerHTML = '<p class="hint left">In diesem Zeitraum hat in diesem Topf niemand Trinkgeld bekommen.</p>'; btn.disabled = true; return; }
    out.innerHTML = `<div class="vorschau">${r.items.map((i) => `<div class="vr"><span>${esc(i.name)}<span class="vt">${i.tage} ${i.tage === 1 ? "Tag" : "Tage"}</span></span><span class="va">${betrag > 0 ? "−" + fr(i.amount) : ""}</span></div>`).join("")}</div>
      <p class="hint left" style="margin-top:0;">${r.sumTage} Arbeitstage total${betrag > 0 ? ` · ${fmt(betrag)} verteilt` : ""}</p>`;
    btn.disabled = !(betrag > 0 && String(st.text || "").trim());
  }

  async function auszahlen(tid) {
    const t = S.toepfe.find((x) => x.id === tid);
    const card = box.querySelector(`[data-topf-card="${tid}"]`);
    const items = [];
    let begrenzt = false;
    card.querySelectorAll("input[data-max]").forEach((inp) => {
      let r = toR(inp.value);
      const max = parseInt(inp.dataset.max, 10);
      if (r <= 0) return;
      if (r > max) { r = max; begrenzt = true; }
      const p = S.personen.find((x) => x.id === inp.dataset.id);
      items.push({ id: p.id, name: p.name, amount: r });
    });
    if (!items.length) { toast("Keine Auszahlbeträge eingegeben."); return; }
    const total = items.reduce((s, i) => s + i.amount, 0);
    if (!payDate.value) { toast("Bitte ein Datum wählen."); return; }
    if (!confirm(`Auszahlung «${t.name}» vom ${deDate(payDate.value)}: ${fmt(total)} an ${items.length} ${items.length === 1 ? "Person" : "Personen"} buchen?`)) return;
    try {
      await addDoc(collection(db, "eintraege"), {
        type: "auszahlung", standortId: S.aktSid, topfId: tid, topfName: t.name, date: payDate.value,
        items, ts: Date.now(), createdAt: serverTimestamp(), erstelltVon: S.session.profile.name || "",
      });
      items.forEach((i) => delete payEingaben[i.id]);
      render();
      toast(begrenzt ? "Auszahlung gebucht. Einzelne Beträge wurden aufs Guthaben begrenzt." : "Auszahlung gebucht.");
    } catch (e) { console.error(e); toast("Auszahlung fehlgeschlagen. Bitte Verbindung prüfen."); }
  }

  async function abzugBuchen(tid, ein) {
    const t = S.toepfe.find((x) => x.id === tid);
    const st = abzugEingaben[tid];
    const betrag = toR(st.betrag);
    const text = String(st.text || "").trim();
    const r = abzugBerechnen(ein, tid, st.von, st.bis, betrag, namen());
    if (!(betrag > 0) || !r.items.length || !text) return;
    if (!confirm(`«${text}»: ${fmt(betrag)} auf ${r.items.length} Personen im Topf «${t.name}» verteilen und von ihrem Guthaben abziehen?`)) return;
    try {
      await addDoc(collection(db, "eintraege"), {
        type: "abzug", standortId: S.aktSid, topfId: tid, topfName: t.name, date: isoVon(),
        von: st.von, bis: st.bis, text, betrag, items: r.items,
        ts: Date.now(), createdAt: serverTimestamp(), erstelltVon: S.session.profile.name || "",
      });
      st.betrag = ""; st.text = "";
      render();
      toast("Abzug gebucht");
    } catch (e) { console.error(e); toast("Abzug fehlgeschlagen. Bitte Verbindung prüfen."); }
  }

  beiAenderung(render);
}
