import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.chorelock',
  appName: 'ChoreKey',
  webDir: 'dist',
  ios: { contentInset: 'always', scheme: 'ChoreKey' },
  plugins: {
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
};

export default config;
