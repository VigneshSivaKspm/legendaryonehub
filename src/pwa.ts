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
/** Installed during this visit (the browser tab stays open; the app opens in its own window) */
let installedThisSession = false;
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
    installedThisSession = true;
    notify();
  });
}

/** Running as the installed app (its own window on Windows/macOS, home-screen app on phones). */
export function isStandalone(): boolean {
  return (
    ['standalone', 'minimal-ui', 'window-controls-overlay'].some((m) => window.matchMedia?.(`(display-mode: ${m})`).matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export type BrowserKind = 'edge' | 'chrome' | 'safari' | 'firefox' | 'samsung' | 'other';

export function detectBrowser(): BrowserKind {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'edge';
  if (/SamsungBrowser/.test(ua)) return 'samsung';
  if (/Firefox\/|FxiOS/.test(ua)) return 'firefox';
  if (/Chrome\/|CriOS/.test(ua)) return 'chrome';
  if (/Safari\//.test(ua)) return 'safari';
  return 'other';
}

export function isDesktopDevice(): boolean {
  return !/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) && !isIOS();
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
    /** Just installed from this browser tab: the app is now in the Start menu / desktop */
    installedThisSession,
    browser: detectBrowser(),
    desktop: isDesktopDevice(),
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
