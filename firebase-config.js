// Firebase-Konfiguration für Marmotte Trinkgeld (eigenes Projekt "marmotte-trinkgeld")
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyCL_gu1yDbrwN1Mi6EUb_SEi5I3G1eMDWY",
  authDomain: "marmotte-trinkgeld.firebaseapp.com",
  projectId: "marmotte-trinkgeld",
  storageBucket: "marmotte-trinkgeld.firebasestorage.app",
  messagingSenderId: "751635598083",
  appId: "1:751635598083:web:a9cdafb2c91f22bfaa7736"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
