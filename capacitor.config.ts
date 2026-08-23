import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.chorelock',
  appName: 'ChoreLock',
  webDir: 'dist',
  ios: { contentInset: 'always', scheme: 'ChoreLock' },
  plugins: {
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
};

export default config;
