import { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { dbFirestore } from '../config/firebase';

/**
 * Office-network rule for employee self check-in / lunch / check-out.
 *
 * Browsers can't read the WiFi name (SSID), so the office network is identified by its
 * public IP address: every device on the office WiFi shares it, while phones on mobile
 * data or home WiFi have a different one.
 *
 * Stored at integrations/attendancePolicy: the existing rules let every member read it and
 * only Owners/Admins change it, so no rules deploy is needed.
 */
export interface OfficeNetwork {
  ip: string;
  label: string;
  addedAt: string;
}

export interface AttendancePolicy {
  requireOfficeNetwork: boolean;
  networks: OfficeNetwork[];
  updatedAt?: string;
  updatedBy?: string;
}

const POLICY_DOC = 'integrations/attendancePolicy';
const EMPTY_POLICY: AttendancePolicy = { requireOfficeNetwork: false, networks: [] };

export function useAttendancePolicy(): { policy: AttendancePolicy; loading: boolean } {
  const [policy, setPolicy] = useState<AttendancePolicy>(EMPTY_POLICY);
  const [loading, setLoading] = useState(true);
  useEffect(
    () =>
      onSnapshot(
        doc(dbFirestore, POLICY_DOC),
        (snap) => {
          const data = snap.data() as Partial<AttendancePolicy> | undefined;
          setPolicy({ requireOfficeNetwork: !!data?.requireOfficeNetwork, networks: data?.networks || [] });
          setLoading(false);
        },
        (err) => {
          console.warn('[AttendancePolicy] Could not load policy:', err);
          setLoading(false);
        }
      ),
    []
  );
  return { policy, loading };
}

export async function saveAttendancePolicy(policy: AttendancePolicy, updatedBy?: string): Promise<void> {
  await setDoc(doc(dbFirestore, POLICY_DOC), {
    requireOfficeNetwork: policy.requireOfficeNetwork,
    networks: policy.networks,
    updatedAt: new Date().toISOString(),
    updatedBy: updatedBy || '',
  });
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 6000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}

/** Public IPv4 address of the network this device is on. */
export async function getPublicIp(): Promise<string> {
  const providers: Array<() => Promise<string>> = [
    async () => (await (await fetchWithTimeout('https://api.ipify.org?format=json')).json()).ip,
    async () => (await (await fetchWithTimeout('https://ipv4.icanhazip.com')).text()).trim(),
  ];
  for (const provider of providers) {
    try {
      const ip = await provider();
      if (ip && /^[\d.]+$/.test(ip)) return ip;
    } catch {
      // try the next provider
    }
  }
  throw new Error('Could not detect your network. Check your internet connection (or turn off ad-blockers) and try again.');
}

/**
 * Current time from the web server's Date header, so changing the device clock can't
 * dodge the 9 AM / 6 PM rules. Falls back to the device clock if the server can't be reached.
 */
export async function getTrustedNow(): Promise<Date> {
  try {
    const res = await fetchWithTimeout(`${window.location.origin}/?t=${Date.now()}`, { method: 'HEAD' }, 4000);
    const header = res.headers.get('date');
    const server = header ? new Date(header) : null;
    if (server && !isNaN(server.getTime())) return server;
  } catch {
    // fall through to the device clock
  }
  return new Date();
}

/** Throws a readable error unless this device is on one of the office networks (when required). */
export async function assertOnOfficeNetwork(policy: AttendancePolicy): Promise<void> {
  if (!policy.requireOfficeNetwork || policy.networks.length === 0) return;
  const ip = await getPublicIp();
  if (!policy.networks.some((n) => n.ip === ip)) {
    throw new Error(`You're not connected to the office WiFi (this network: ${ip}). Connect to the office network and try again.`);
  }
}
