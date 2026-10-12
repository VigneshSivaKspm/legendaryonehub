import { useEffect, useState } from 'react';
import { firebaseConfig } from './config/firebase';

/**
 * PWA support: one service worker (public/sw.js) handles the offline app shell and push
 * notifications, so the URL must be identical wherever it's registered.
 */
export function serviceWorkerUrl(): string {
  const params = new URLSearchParams({
    projectId: firebaseConfig.projectId || '',
    messagingSenderId: firebaseConfig.messagingSenderId || '',
    apiKey: firebaseConfig.apiKey || '',
    appId: firebaseConfig.appId || '',
  });
  return `/sw.js?${params.toString()}`;
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(serviceWorkerUrl(), { scope: '/' }).catch((err) => {
      console.warn('[PWA] Service worker registration failed:', err);
    });
  });
}

// ---------- Install prompt ----------
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // show our own Install button instead of the mini-infobar
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * canInstall: Chrome/Edge/Android offered an install prompt.
 * needsIOSHelp: iPhone/iPad Safari, where installing is "Share → Add to Home Screen".
 */
export function useInstallPrompt() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  const installed = isStandalone();
  return {
    installed,
    canInstall: !installed && !!deferredPrompt,
    needsIOSHelp: !installed && !deferredPrompt && isIOS(),
    install: async (): Promise<boolean> => {
      if (!deferredPrompt) return false;
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      notify();
      return outcome === 'accepted';
    },
  };
}
