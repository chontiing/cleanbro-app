import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.cleanbro.app',
  appName: '클린브로',
  webDir: 'dist',
  server: {
    url: 'http://192.168.219.105:5174',
    cleartext: true
  }
};

export default config;
