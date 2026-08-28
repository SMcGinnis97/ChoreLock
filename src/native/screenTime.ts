/**
 * Bridge to the native iOS Screen Time (FamilyControls / ManagedSettings) plugin.
 *
 * The Swift side lives in ios-native/ and is registered as the Capacitor plugin
 * "ScreenTime". On web / before the plugin is built, every call is a no-op that
 * logs, so the UI can be developed without a device.
 *
 * Flow on a kid device:
 *   1. requestAuthorization()  — once, shows Apple's Family Controls consent.
 *   2. pickBlockedApps()       — parent opens Apple's FamilyActivityPicker and
 *                                chooses apps/categories/web domains to shield.
 *                                The selection is stored natively (it's opaque).
 *   3. applyLockState('locked' | 'unlocked') — whenever the backend state changes
 *      (on launch, on push, on background refresh) the shield is set or cleared.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';
import type { LockState } from '../lib/types';

export type ShieldState = 'chores' | 'critical' | 'grounded' | 'bedtime';

/** Per-state shield content; strings arrive with placeholders already substituted. */
export interface ShieldContent {
  state: ShieldState;
  title: string;
  subtitle: string;
  /** false hides the "Ask for 15 minutes" button (e.g. after a recent denial). */
  allowRequest?: boolean;
}

export interface ScreenTimePlugin {
  requestAuthorization(): Promise<{ status: 'approved' | 'denied' | 'notDetermined' }>;
  pickBlockedApps(): Promise<{ appCount: number; categoryCount: number; webDomainCount: number }>;
  getSelectionSummary(): Promise<{ appCount: number; categoryCount: number; webDomainCount: number }>;
  setShield(opts: { enabled: boolean } & Partial<ShieldContent>): Promise<void>;
  getStatus(): Promise<{ authorized: boolean; shielded: boolean }>;
  /** Re-apply the shield locally every day at this time via DeviceActivityMonitor (no network needed). */
  scheduleDailyReset(opts: { hour: number; minute: number }): Promise<void>;
  /** Shield-button taps queued by the action extension, cleared on read. */
  drainShieldRequests(): Promise<{ requests: { kind: 'fifteen' | 'inprogress'; at: number }[] }>;
}

const ScreenTime = registerPlugin<ScreenTimePlugin>('ScreenTime', {
  web: () => Promise.resolve(webStub),
});

const webStub: ScreenTimePlugin = {
  async requestAuthorization() { console.info('[ScreenTime/web] requestAuthorization'); return { status: 'notDetermined' }; },
  async pickBlockedApps() { console.info('[ScreenTime/web] pickBlockedApps'); return { appCount: 0, categoryCount: 0, webDomainCount: 0 }; },
  async getSelectionSummary() { return { appCount: 0, categoryCount: 0, webDomainCount: 0 }; },
  async setShield(opts) { console.info('[ScreenTime/web] setShield', opts); },
  async getStatus() { return { authorized: false, shielded: false }; },
  async scheduleDailyReset(opts) { console.info('[ScreenTime/web] scheduleDailyReset', opts); },
  async drainShieldRequests() { return { requests: [] }; },
};

export const isNativeIOS = () => Capacitor.getPlatform() === 'ios';

export async function applyLockState(state: LockState, content?: ShieldContent) {
  if (state === 'unknown') return; // keep last known
  try {
    await ScreenTime.setShield({
      enabled: state === 'locked',
      ...(content ?? { state: 'chores', title: 'Chores first 🔑', subtitle: 'Open ChoreKey to snap your proof.' }),
    });
  } catch (e) {
    console.warn('[ScreenTime] setShield failed', e);
  }
}

export default ScreenTime;
