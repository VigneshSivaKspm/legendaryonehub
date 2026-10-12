// Firebase Cloud Messaging Service Worker for Background Push Notifications
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// Extract URL query params or fallback to default project credentials
const searchParams = new URL(location.href).searchParams;

const firebaseConfig = {
  apiKey: searchParams.get('apiKey') || '',
  authDomain: searchParams.get('authDomain') || '',
  projectId: searchParams.get('projectId') || 'legendary-one-business-os',
  storageBucket: searchParams.get('storageBucket') || '',
  messagingSenderId: searchParams.get('messagingSenderId') || '1023659466648',
  appId: searchParams.get('appId') || '',
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const messaging = firebase.messaging();

// Handle Background Push Messages when app is closed or minimized
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Background message received:', payload);

  const title = payload.notification?.title || payload.data?.title || 'Legendary One Business OS';
  const options = {
    body: payload.notification?.body || payload.data?.body || 'New workspace alert received.',
    icon: payload.notification?.icon || payload.data?.icon || '/legendary-one-logo.png',
    badge: '/legendary-one-logo.png',
    data: payload.data || {},
  };

  return self.registration.showNotification(title, options);
});
