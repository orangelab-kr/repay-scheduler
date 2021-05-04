import admin from 'firebase-admin';

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIAL || '{}')
  ),
});

export const firestore = admin.firestore();
export const auth = admin.auth();
