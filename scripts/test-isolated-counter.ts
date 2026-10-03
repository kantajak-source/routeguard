import { alertService } from '../src/services/alertService';
import { db } from '../src/services/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

async function runIsolatedTest() {
  const newAlertId = `alert-iso-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  console.log('1. Création de la nouvelle alerte :', newAlertId);

  let newAlertCreated = false;
  let initCountOne = false;
  let initConfirmedByA = false;
  let confirmBRecorded = false;
  let countOneToTwo = false;
  let bInConfirmedBy = false;
  let secondConfirmPrevented = false;
  let countFinalTwo = false;
  let exactError = 'Aucune';

  try {
    // S'assurer que le service écoute Firestore pour refléter le comportement réel de l'application
    const unsub = alertService.subscribeAlerts(() => {});
    // Attendre 500ms la synchro initiale
    await new Promise(r => setTimeout(r, 500));

    // A. Créer la nouvelle alerte avec l'état initial obligatoire
    const initialPayload = {
      id: newAlertId,
      type: 'RALENTISSEMENT',
      description: 'TEST COMPTEUR CONFIRMATION',
      location: 'SECTEUR DE TEST',
      direction: 'BAFOUSSAM',
      route: 'Yaoundé-Bafoussam',
      createdAt: Date.now(),
      status: 'CONFIRMED',
      confirmationCount: 1,
      createdBy: 'Chauffeur A (Jean)',
      confirmedBy: ['Chauffeur A (Jean)'],
      audioDuration: '0:10',
      audioTranscript: 'Test isolé compteur',
    };

    const docRef = doc(db, 'alerts', newAlertId);
    await setDoc(docRef, initialPayload);
    newAlertCreated = true;

    // Attendre que le snapshot se propage
    await new Promise(r => setTimeout(r, 600));

    // B & C. Vérification de l'état initial depuis Firestore
    const snap1 = await getDoc(docRef);
    if (!snap1.exists()) {
      throw new Error(`Le document ${newAlertId} n'a pas pu être créé.`);
    }
    const data1 = snap1.data();
    console.log('AVANT CONFIRMATION DE B :');
    console.log('- ID :', data1.id);
    console.log('- confirmationCount :', data1.confirmationCount);
    console.log('- confirmedBy :', data1.confirmedBy);

    initCountOne = data1.confirmationCount === 1;
    initConfirmedByA = Array.isArray(data1.confirmedBy) &&
      data1.confirmedBy.length === 1 &&
      data1.confirmedBy[0] === 'Chauffeur A (Jean)';

    // D, E, F. Action 1 : Chauffeur B (Paul) confirme l'alerte
    alertService.setActiveDriver('Chauffeur B (Paul)');
    const res1 = await alertService.confirmAlert(newAlertId, 'Chauffeur B (Paul)');
    console.log('Résultat première confirmation Chauffeur B :', res1);

    // Attendre 600ms la propagation Firestore
    await new Promise(r => setTimeout(r, 600));

    // Relecture immédiate depuis Firestore
    const snap2 = await getDoc(docRef);
    const data2 = snap2.data()!;
    console.log('APRÈS PREMIÈRE CONFIRMATION :');
    console.log('- confirmationCount :', data2.confirmationCount);
    console.log('- confirmedBy :', data2.confirmedBy);

    confirmBRecorded = res1.success;
    countOneToTwo = data2.confirmationCount === 2;
    bInConfirmedBy = Array.isArray(data2.confirmedBy) && data2.confirmedBy.includes('Chauffeur B (Paul)');

    // G & H. Action 2 : Deuxième confirmation par Chauffeur B (Paul)
    console.log('Tentative deuxième confirmation par Chauffeur B (Paul)...');
    const res2 = await alertService.confirmAlert(newAlertId, 'Chauffeur B (Paul)');
    console.log('Résultat deuxième confirmation :', res2);

    await new Promise(r => setTimeout(r, 600));

    // Relecture finale depuis Firestore
    const snap3 = await getDoc(docRef);
    const data3 = snap3.data()!;
    console.log('APRÈS DEUXIÈME TENTATIVE (ÉTAT FINAL) :');
    console.log('- confirmationCount :', data3.confirmationCount);
    console.log('- confirmedBy :', data3.confirmedBy);

    secondConfirmPrevented = !res2.success && data3.confirmationCount === 2;
    countFinalTwo = data3.confirmationCount === 2;

    unsub();
  } catch (err: any) {
    exactError = err?.message || String(err);
    console.error('Erreur :', exactError);
  }

  console.log('\n--- BILAN DE L\'EXÉCUTION ---');
  console.log(`A. Nouvelle alerte créée : ${newAlertCreated ? 'OUI' : 'NON'}`);
  console.log(`B. État initial count = 1 : ${initCountOne ? 'OUI' : 'NON'}`);
  console.log(`C. confirmedBy initial contient seulement A : ${initConfirmedByA ? 'OUI' : 'NON'}`);
  console.log(`D. Confirmation de B enregistrée : ${confirmBRecorded ? 'OUI' : 'NON'}`);
  console.log(`E. Count 1 → 2 : ${countOneToTwo ? 'OUI' : 'NON'}`);
  console.log(`F. B apparaît dans confirmedBy : ${bInConfirmedBy ? 'OUI' : 'NON'}`);
  console.log(`G. Deuxième confirmation de B empêchée : ${secondConfirmPrevented ? 'OUI' : 'NON'}`);
  console.log(`H. Count final reste 2 : ${countFinalTwo ? 'OUI' : 'NON'}`);
  console.log(`I. ID de la nouvelle alerte : ${newAlertId}`);
  console.log(`J. Erreur éventuelle exacte : ${exactError}`);

  process.exit(0);
}

runIsolatedTest();
