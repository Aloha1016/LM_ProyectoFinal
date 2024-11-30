import admin from 'firebase-admin';
import serviceAccount from './config/lenguajesad.json' with { type: 'json' };

// Inicializa Firebase solo si no está inicializado
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

export { admin, db };
