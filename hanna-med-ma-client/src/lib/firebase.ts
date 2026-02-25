import { initializeApp } from 'firebase/app';
import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging';
import type { Messaging } from 'firebase/messaging';

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);

let messaging: Messaging | null = null;

export const getFirebaseMessaging = async (): Promise<Messaging | null> => {
    if (messaging) return messaging;

    const supported = await isSupported();
    if (!supported) {
        console.warn('Firebase Messaging is not supported in this browser');
        return null;
    }

    messaging = getMessaging(app);
    return messaging;
};

export { getToken, onMessage };
