/**
 * APNs registration + handling.
 *  Kid devices:
 *   - Registers the device token into `devices.push_token` for this install.
 *   - Silent pushes (kind: reset | state) trigger `onStateChange` so the store refetches
 *     and re-applies the Screen Time shield. Alert pushes do the same after the tap.
 *  Parent devices:
 *   - Registers the token into `parent_devices` (keyed by user + install).
 *   - Every parent push carries `route`; tapping one navigates there (ParentShell listens
 *     for the `chorekey:route` window event).
 */
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from '../lib/supabase';

export const installId = () => {
  const key = 'chorelock.installId';
  let id = localStorage.getItem(key);
  if (!id) { id = crypto.randomUUID().slice(0, 8); localStorage.setItem(key, id); }
  return id;
};

async function ensureRegistered() {
  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === 'prompt') perm = await PushNotifications.requestPermissions();
  // Even if alerts are denied, background (silent) pushes still arrive, so always register.
  await PushNotifications.register();
}

export async function setupPush(kidId: string, onStateChange: () => void) {
  if (!Capacitor.isNativePlatform() || !supabase) return;
  await ensureRegistered();

  PushNotifications.addListener('registration', async ({ value }) => {
    await supabase!.from('devices').update({ push_token: value, last_seen: new Date().toISOString() }).eq('kid_id', kidId).eq('identifier', `ios-${installId()}`);
  });
  PushNotifications.addListener('registrationError', (e) => console.warn('[push] registration error', e));
  PushNotifications.addListener('pushNotificationReceived', () => onStateChange());
  PushNotifications.addListener('pushNotificationActionPerformed', () => onStateChange());
}

export const ROUTE_EVENT = 'chorekey:route';

export async function setupParentPush(userId: string, onStateChange: () => void) {
  if (!Capacitor.isNativePlatform() || !supabase) return;
  await ensureRegistered();

  PushNotifications.addListener('registration', async ({ value }) => {
    await supabase!.from('parent_devices').upsert(
      { user_id: userId, identifier: `ios-${installId()}`, push_token: value, last_seen: new Date().toISOString() },
      { onConflict: 'user_id,identifier' },
    );
  });
  PushNotifications.addListener('registrationError', (e) => console.warn('[push] registration error', e));
  PushNotifications.addListener('pushNotificationReceived', () => onStateChange());
  PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
    onStateChange();
    const route = (notification.data as { route?: string } | undefined)?.route;
    if (route) window.dispatchEvent(new CustomEvent(ROUTE_EVENT, { detail: route }));
  });
}
