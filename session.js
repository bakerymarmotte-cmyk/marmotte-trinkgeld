// Gemeinsames Modul: prüft Login-Status und lädt die Rolle/Daten des Nutzers.
// Wird von app.html (Trinkgeld) verwendet.

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/**
 * Wartet auf den Login-Status und lädt das zugehörige Firestore-Profil.
 * Leitet automatisch zu index.html um, wenn nicht eingeloggt oder kein Profil vorhanden.
 * Leitet zu change-password.html um, wenn das Passwort noch geändert werden muss.
 * @returns {Promise<{uid: string, profile: object}>}
 */
export function requireSession() {
  return new Promise((resolve, reject) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        window.location.href = "index.html";
        reject(new Error("not-authenticated"));
        return;
      }
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (!snap.exists()) {
          window.location.href = "index.html";
          reject(new Error("no-profile"));
          return;
        }
        const profile = snap.data();
        if (profile.active === false) {
          await signOut(auth);
          window.location.href = "index.html";
          reject(new Error("account-deactivated"));
          return;
        }
        if (profile.mustChangePassword) {
          window.location.href = "change-password.html";
          reject(new Error("must-change-password"));
          return;
        }
        resolve({ uid: user.uid, profile });
      } catch (err) {
        console.error("Fehler beim Laden des Profils:", err);
        reject(err);
      }
    });
  });
}

export async function logout() {
  await signOut(auth);
  window.location.href = "index.html";
}
