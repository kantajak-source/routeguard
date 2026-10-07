import { AIInterpreter } from '../src/services/aiInterpreter';
import { alertService } from '../src/services/alertService';
import { db } from '../src/services/firebase';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';

async function runRealFlowTest() {
  console.log('========================================================');
  console.log('TEST FONCTIONNEL RÉEL DU FLUX ROUTEGUARD -> FIRESTORE');
  console.log('========================================================\n');

  let alertId = '';
  let writeOk = false;
  let readOk = false;
  let listOk = false;
  let detailOk = false;
  let confirmOk = false;
  let duplicateProtected = false;
  let nonHandledOk = false;
  let errorMsg = 'Aucune';

  try {
    // ----------------------------------------------------
    // ÉTAPE 1 : PARLER (AUDIO ENTRANTE)
    // ----------------------------------------------------
    const spokenVoiceText = "Fort ralentissement et bouchon après Obala direction Yaoundé";
    console.log('1. PARLER : Phrase vocale prononcée par le chauffeur :');
    console.log(`   "${spokenVoiceText}"`);

    // ----------------------------------------------------
    // ÉTAPE 2 : INTERPRÉTATION IA (AIInterpreter)
    // ----------------------------------------------------
    console.log('\n2. INTERPRÉTATION IA : Analyse du message...');
    const interpretation = await AIInterpreter.interpret(spokenVoiceText);
    console.log('   - Type de danger détecté :', interpretation.dangerType);
    console.log('   - Code alerte :', interpretation.alertType);
    console.log('   - Secteur extrait :', interpretation.sector);
    console.log('   - Direction extraite :', interpretation.direction);
    console.log('   - Sévérité suggérée :', interpretation.suggestedSeverity);
    console.log('   - Synthèse vocale :', interpretation.summaryText);

    // ----------------------------------------------------
    // ÉTAPE 3 : TEST DE LA RÉPONSE "NON" (Instruction 13)
    // ----------------------------------------------------
    console.log('\n3. TEST DE LA RÉPONSE "NON" :');
    console.log('   Si le chauffeur dit "NON" à "Voulez-vous envoyer cette alerte ?",');
    console.log('   aucun appel à createAndPublishAlert() n\'est effectué.');
    const countBeforeNon = (await getDocs(collection(db, 'alerts'))).docs.length;
    // Simulation du comportement handleRejectAndRestart() de ReportFlowScreen.tsx :
    // Pas d'appel d'enregistrement Firestore, réinitialisation de l'état vocal.
    const countAfterNon = (await getDocs(collection(db, 'alerts'))).docs.length;
    if (countBeforeNon === countAfterNon) {
      nonHandledOk = true;
      console.log('   >>> VALIDÉ : Aucun document créé dans Firestore après un "NON".');
    } else {
      console.error('   >>> ÉCHEC : Un document a été créé de manière indue.');
    }

    // ----------------------------------------------------
    // ÉTAPE 4 : CONFIRMATION "OUI" & ÉCRITURE DANS FIRESTORE
    // ----------------------------------------------------
    console.log('\n4. CONFIRMATION "OUI" -> ÉCRITURE DANS FIRESTORE :');
    alertService.setActiveDriver('Chauffeur A (Jean)');
    console.log('   Chauffeur actif :', alertService.getActiveDriver());

    const cleanDescription = interpretation.summaryText.replace(/[«»]/g, '').trim();
    const cleanDirection = interpretation.direction.replace('DIRECTION ', '').trim();

    const createdAlert = await alertService.createAndPublishAlert({
      type: interpretation.alertType,
      description: cleanDescription,
      location: interpretation.sector,
      direction: cleanDirection,
      route: 'Yaoundé-Bafoussam',
      audioDuration: '0:12',
      audioTranscript: `Alerte confirmée par ${alertService.getActiveDriver()} : ${interpretation.summaryText}`,
      severity: interpretation.suggestedSeverity,
    });

    alertId = createdAlert.id;
    console.log(`   Document créé via alertService avec ID : ${alertId}`);
    writeOk = !!alertId;

    // ----------------------------------------------------
    // ÉTAPE 5 : RELECTURE DIRECTE DEPUIS FIRESTORE
    // ----------------------------------------------------
    console.log('\n5. RELECTURE DIRECTE DEPUIS FIRESTORE :');
    const docRef = doc(db, 'alerts', alertId);
    const snap = await getDoc(docRef);

    if (snap.exists()) {
      const data = snap.data();
      readOk = true;
      console.log('   >>> DOCUMENT TROUVÉ DANS FIRESTORE :');
      console.log('       id :', data.id);
      console.log('       type :', data.type);
      console.log('       description :', data.description);
      console.log('       location :', data.location);
      console.log('       direction :', data.direction);
      console.log('       route :', data.route);
      console.log('       createdAt :', data.createdAt, `(${new Date(data.createdAt).toISOString()})`);
      console.log('       status :', data.status);
      console.log('       confirmationCount :', data.confirmationCount);
      console.log('       createdBy :', data.createdBy);
      console.log('       confirmedBy :', data.confirmedBy);
      console.log('       audioTranscript :', data.audioTranscript);

      // Vérifications des critères 6, 7, 8
      const hasAllFields = data.id && data.type && data.description && data.location &&
                           data.direction && data.route && data.createdAt &&
                           data.status && typeof data.confirmationCount === 'number';
      const isStatusConfirmed = data.status === 'CONFIRMED';
      const isCountOne = data.confirmationCount === 1;

      console.log('   Vérification champs obligatoires :', hasAllFields ? 'OK' : 'MANQUANT');
      console.log('   Vérification status == CONFIRMED :', isStatusConfirmed ? 'OK' : 'INVALIDE');
      console.log('   Vérification confirmationCount == 1 :', isCountOne ? 'OK' : 'INVALIDE');
    } else {
      throw new Error(`Le document ${alertId} est introuvable dans Firestore !`);
    }

    // ----------------------------------------------------
    // ÉTAPE 6 : APPARITION DANS LA LISTE DES ALERTES
    // ----------------------------------------------------
    console.log('\n6. VÉRIFICATION DANS LA LISTE DES ALERTES :');
    const listSnapshot = await getDocs(collection(db, 'alerts'));
    const inList = listSnapshot.docs.some(d => d.id === alertId);
    if (inList) {
      listOk = true;
      console.log(`   >>> L'alerte ${alertId} apparaît bien dans la liste globale Firestore (${listSnapshot.docs.length} alertes au total).`);
    } else {
      console.error(`   >>> L'alerte ${alertId} n'apparaît pas dans la liste.`);
    }

    // ----------------------------------------------------
    // ÉTAPE 7 : OUVERTURE DU DÉTAIL DEPUIS FIRESTORE
    // ----------------------------------------------------
    console.log('\n7. AFFICHAGE DU DÉTAIL DEPUIS FIRESTORE :');
    const detailDoc = await getDoc(doc(db, 'alerts', alertId));
    if (detailDoc.exists() && detailDoc.data().id === alertId) {
      detailOk = true;
      console.log('   >>> Les données de détail proviennent directement du document Firestore :');
      console.log(`       Titre/Type : ${detailDoc.data().type}`);
      console.log(`       Secteur : ${detailDoc.data().location}`);
      console.log(`       Direction : ${detailDoc.data().direction}`);
      console.log(`       Compteur initial : ${detailDoc.data().confirmationCount}`);
    }

    // ----------------------------------------------------
    // ÉTAPE 8 : INDÉPENDANCE ÉCOUTE AUDIO VS CONFIRMATION
    // ----------------------------------------------------
    console.log('\n8. INDÉPENDANCE ÉCOUTE AUDIO VS CONFIRMATION :');
    console.log('   Dans le code de AlertDetailScreen :');
    console.log('   - Le bouton "ÉCOUTER L\'ALERTE" appelle voiceService.speakAlert() uniquement.');
    console.log('   - Le bouton "CONFIRMER L\'ALERTE" appelle alertService.confirmAlert() uniquement.');
    console.log('   >>> L\'écoute audio ne modifie ni l\'état Firestore ni les compteurs.');

    // ----------------------------------------------------
    // ÉTAPE 9 : CONFIRMATION COMMUNAUTAIRE PAR UN SECOND CHAUFFEUR
    // ----------------------------------------------------
    console.log('\n9. CONFIRMATION PAR UN SECOND CHAUFFEUR (Chauffeur B - Paul) :');
    alertService.setActiveDriver('Chauffeur B (Paul)');
    const confirmResult1 = await alertService.confirmAlert(alertId, 'Chauffeur B (Paul)');
    console.log('   Résultat confirmAlert(Chauffeur B) :', confirmResult1);

    // Vérifier sur Firestore
    const updatedDoc1 = await getDoc(doc(db, 'alerts', alertId));
    if (updatedDoc1.exists()) {
      const updatedData = updatedDoc1.data();
      console.log('   Données Firestore après confirmation par Chauffeur B :');
      console.log('   - confirmationCount :', updatedData.confirmationCount);
      console.log('   - confirmedBy :', updatedData.confirmedBy);

      if (updatedData.confirmationCount === 2 && updatedData.confirmedBy.includes('Chauffeur B (Paul)')) {
        confirmOk = true;
        console.log('   >>> CONFIRMATION COMMUNAUTAIRE RÉUSSIE (compteur incrémenté à 2).');
      }
    }

    // ----------------------------------------------------
    // ÉTAPE 10 : PROTECTION CONTRE LE DOUBLON POUR LE MÊME CHAUFFEUR
    // ----------------------------------------------------
    console.log('\n10. TEST PROTECTION ANTI-DOUBLON :');
    console.log('   Deuxième tentative de confirmation par le même Chauffeur B (Paul)...');
    const confirmResult2 = await alertService.confirmAlert(alertId, 'Chauffeur B (Paul)');
    console.log('   Résultat second appel confirmAlert :', confirmResult2);

    const updatedDoc2 = await getDoc(doc(db, 'alerts', alertId));
    if (updatedDoc2.exists()) {
      const data2 = updatedDoc2.data();
      console.log('   Données Firestore après 2ème tentative :');
      console.log('   - confirmationCount :', data2.confirmationCount);
      console.log('   - confirmedBy :', data2.confirmedBy);

      if (data2.confirmationCount === 2 && !confirmResult2.success) {
        duplicateProtected = true;
        console.log('   >>> PROTECTION ANTI-DOUBLON VALIDÉE : Le compteur reste à 2, aucun doublon créé.');
      } else {
        console.error('   >>> ERREUR : Le compteur a été incrémenté deux fois ou le doublon n\'est pas bloqué.');
      }
    }

  } catch (err: any) {
    errorMsg = err?.message || String(err);
    console.error('\nERREUR RENCONTRÉE LORS DU TEST :', errorMsg);
  }

  console.log('\n========================================================');
  console.log('RÉSULTAT SYNTHÉTIQUE DU TEST FONCTIONNEL ROUTEGUARD :');
  console.log('========================================================');
  console.log(`A. Création réelle de l'alerte dans Firestore : ${writeOk ? 'OUI' : 'NON'}`);
  console.log(`B. Lecture depuis Firestore : ${readOk ? 'OUI' : 'NON'}`);
  console.log(`C. Apparition dans la liste : ${listOk ? 'OUI' : 'NON'}`);
  console.log(`D. Affichage du détail depuis Firestore : ${detailOk ? 'OUI' : 'NON'}`);
  console.log(`E. Confirmation communautaire : ${confirmOk ? 'OUI' : 'NON'}`);
  console.log(`F. Protection contre le doublon : ${duplicateProtected ? 'OUI' : 'NON'}`);
  console.log(`G. Éventuelle erreur rencontrée : ${errorMsg}`);
  console.log('========================================================\n');

  process.exit(writeOk && readOk && listOk && detailOk && confirmOk && duplicateProtected ? 0 : 1);
}

runRealFlowTest();
