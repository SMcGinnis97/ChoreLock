import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.chorelock',
  appName: 'ChoreKey',
  webDir: 'dist',
  // 'never': the web view fills the screen edge to edge and CSS env(safe-area-inset-*) pads
  // the content itself. 'always' insetted the native scroll view on top of that (double top
  // spacing) and let the whole page bounce; the app-shell layout scrolls inside instead.
  ios: { contentInset: 'never', scheme: 'ChoreKey' },
  plugins: {
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
};

export default config;
