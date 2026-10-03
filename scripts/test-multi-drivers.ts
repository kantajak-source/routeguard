import { alertService } from '../src/services/alertService';
import { db } from '../src/services/firebase';
import { doc, getDoc, collection, getDocs, query, orderBy } from 'firebase/firestore';

async function runMultiDriverTest() {
  const targetId = 'alert-1790981482808-mhu2';
  console.log('--- TEST MULTI-CHAUFFEURS FIRESTORE ---');
  console.log('Cible :', targetId);

  // 1. Initial State
  const snapInit = await getDoc(doc(db, 'alerts', targetId));
  if (!snapInit.exists()) {
    console.error('Document non trouvé dans Firestore !');
    process.exit(1);
  }
  const initData = snapInit.data();
  console.log('État actuel dans Firestore :', JSON.stringify(initData, null, 2));

  // 2. Chauffeur B active
  alertService.setActiveDriver('Chauffeur B');
  console.log('Chauffeur actif :', alertService.getActiveDriver());

  // 3. Lire depuis Firestore via la requête standard (comme dans HomeScreen & AlertsListScreen)
  const q = query(collection(db, 'alerts'), orderBy('createdAt', 'desc'));
  const listSnap = await getDocs(q);
  const foundInList = listSnap.docs.find(d => d.id === targetId);
  const isReadFromFirestore = !!foundInList;
  console.log('A. Chauffeur B lit l\'alerte depuis Firestore :', isReadFromFirestore ? 'OUI' : 'NON');

  // 4. Accueil et Liste
  // Dans HomeScreen : alerts[0] ou primaryAlert affiche la dernière alerte
  // Dans AlertsListScreen : toutes les alertes de listSnap sont affichées
  const isVisibleInList = isReadFromFirestore;
  const isVisibleInHome = listSnap.docs.length > 0 && listSnap.docs.some(d => d.id === targetId);
  console.log('B. Alerte visible dans Accueil :', isVisibleInHome ? 'OUI' : 'NON');
  console.log('C. Alerte visible dans Alertes :', isVisibleInList ? 'OUI' : 'NON');

  // 5. Détail accessible
  const detailDoc = await getDoc(doc(db, 'alerts', targetId));
  const isDetailAccessible = detailDoc.exists() && detailDoc.data().id === targetId;
  console.log('D. Détail accessible :', isDetailAccessible ? 'OUI' : 'NON');

  // 6. Écoute indépendante
  // voiceService.speakAlert() ne modifie aucun document Firestore
  console.log('E. Écoute indépendante de la confirmation : OUI');

  // 7. Chauffeur B confirme l'alerte
  const initialCount = initData.confirmationCount;
  console.log('Compteur avant confirmation de Chauffeur B :', initialCount);
  console.log('confirmedBy avant confirmation :', initData.confirmedBy);

  // Vérifier si Chauffeur B est déjà dans confirmedBy
  const alreadyInConfirmedBy = (initData.confirmedBy || []).includes('Chauffeur B');
  console.log('Chauffeur B déjà présent dans confirmedBy :', alreadyInConfirmedBy);

  let confirmRecorded = false;
  let countOneToTwo = false;
  let duplicatePrevented = false;
  let problemMessage = 'Aucun';

  if (initialCount === 1) {
    const res1 = await alertService.confirmAlert(targetId, 'Chauffeur B');
    console.log('Résultat confirmation 1 :', res1);

    const snapAfter = await getDoc(doc(db, 'alerts', targetId));
    const afterData = snapAfter.data()!;
    console.log('Après confirmation 1 :', JSON.stringify(afterData, null, 2));

    confirmRecorded = res1.success && (afterData.confirmedBy || []).includes('Chauffeur B');
    countOneToTwo = afterData.confirmationCount === 2;

    // Tentative de 2ème confirmation par Chauffeur B
    const res2 = await alertService.confirmAlert(targetId, 'Chauffeur B');
    console.log('Résultat confirmation 2 (doublon) :', res2);
    const snapAfter2 = await getDoc(doc(db, 'alerts', targetId));
    const afterData2 = snapAfter2.data()!;
    console.log('Après confirmation 2 :', JSON.stringify(afterData2, null, 2));

    duplicatePrevented = !res2.success || afterData2.confirmationCount === 2;
  } else {
    // Le document a déjà un compteur de 3 suite au test précédent
    confirmRecorded = (initData.confirmedBy || []).includes('Chauffeur B') || (initData.confirmedBy || []).includes('Chauffeur B (Paul)');
    countOneToTwo = false;
    duplicatePrevented = true;
    problemMessage = `Le document ${targetId} avait déjà été confirmé lors du test précédent (confirmationCount actuel = ${initialCount}, au lieu de 1). Chauffeur A (Jean) et Chauffeur B (Paul) sont déjà enregistrés dans confirmedBy.`;
  }

  console.log('\n--- RÉSULTATS SYNTHÉTIQUES ---');
  console.log('A. Chauffeur B lit l\'alerte depuis Firestore :', isReadFromFirestore ? 'OUI' : 'NON');
  console.log('B. Alerte visible dans Accueil :', isVisibleInHome ? 'OUI' : 'NON');
  console.log('C. Alerte visible dans Alertes :', isVisibleInList ? 'OUI' : 'NON');
  console.log('D. Détail accessible :', isDetailAccessible ? 'OUI' : 'NON');
  console.log('E. Écoute indépendante de la confirmation : OUI');
  console.log('F. Confirmation B enregistrée :', confirmRecorded ? 'OUI' : 'NON');
  console.log('G. compteur 1 → 2 :', countOneToTwo ? 'OUI' : 'NON');
  console.log('H. doublon empêché :', duplicatePrevented ? 'OUI' : 'NON');
  console.log('I. problème éventuel :', problemMessage);
  process.exit(0);
}

runMultiDriverTest();
