import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';
import appletConfig from '../firebase-applet-config.json' with { type: 'json' };

async function runTest() {
  console.log('--- TEST FONCTIONNEL FIRESTORE ---');
  console.log('Project ID:', appletConfig.projectId);
  console.log('Database ID:', appletConfig.firestoreDatabaseId);

  const app = initializeApp(appletConfig);
  const db = getFirestore(app, appletConfig.firestoreDatabaseId);

  const alertId = `alert-test-${Date.now()}`;
  const testAlertData = {
    id: alertId,
    type: 'ACCIDENT',
    description: 'Accident de test',
    location: 'Bafia',
    direction: 'Bafoussam',
    route: 'Yaoundé → Bafoussam',
    status: 'CONFIRMED',
    confirmationCount: 1,
    createdBy: 'Test Automatisé',
    createdAt: Date.now(),
    audioDuration: '0:10',
    audioTranscript: 'Attention accident de test signalé sur le secteur de Bafia.',
    confirmedBy: ['Test Automatisé'],
  };

  console.log('\n1. Tentative d\'écriture dans Firestore (collection: alerts, id:', alertId, ')...');
  try {
    const docRef = doc(db, 'alerts', alertId);
    await setDoc(docRef, testAlertData);
    console.log('>>> ÉCRITURE RÉUSSIE !');
  } catch (err: any) {
    console.error('>>> ÉCRITURE ÉCHOUÉE :', err.message || err);
    process.exit(1);
  }

  console.log('\n2. Tentative de relecture immédiate depuis Firestore...');
  try {
    const docRef = doc(db, 'alerts', alertId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      console.log('>>> LECTURE RÉUSSIE !');
      console.log('Données relues :', JSON.stringify(snap.data(), null, 2));
    } else {
      console.error('>>> ERREUR : Le document n\'existe pas après écriture !');
      process.exit(1);
    }
  } catch (err: any) {
    console.error('>>> LECTURE ÉCHOUÉE :', err.message || err);
    process.exit(1);
  }

  console.log('\n--- TEST TERMINÉ AVEC SUCCÈS ---');
  process.exit(0);
}

runTest();
