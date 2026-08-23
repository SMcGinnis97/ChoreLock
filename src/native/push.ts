/**
 * APNs registration + handling for kid devices.
 *  - Registers the device token into `devices.push_token` for this install.
 *  - Silent pushes (kind: reset | state) trigger `onStateChange` so the store refetches
 *    and re-applies the Screen Time shield. Alert pushes do the same after the tap.
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

export async function setupPush(kidId: string, onStateChange: () => void) {
  if (!Capacitor.isNativePlatform() || !supabase) return;
  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === 'prompt') perm = await PushNotifications.requestPermissions();
  // Even if alerts are denied, background (silent) pushes still arrive, so always register.
  await PushNotifications.register();

  PushNotifications.addListener('registration', async ({ value }) => {
    await supabase!.from('devices').update({ push_token: value, last_seen: new Date().toISOString() }).eq('kid_id', kidId).eq('identifier', `ios-${installId()}`);
  });
  PushNotifications.addListener('registrationError', (e) => console.warn('[push] registration error', e));
  PushNotifications.addListener('pushNotificationReceived', () => onStateChange());
  PushNotifications.addListener('pushNotificationActionPerformed', () => onStateChange());
}
