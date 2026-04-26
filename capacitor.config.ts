import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.questionbank.app',
  appName: 'Synap',
  webDir: 'out',
  // 配置服务器 URL - 请替换为你的局域网IP地址或生产服务器地址
  server: {
    url: 'http://43.161.215.86:8080/',
    cleartext: true,
    allowNavigation: ['*']
  },
  android: {
    buildOptions: {
      signingType: 'apksigner'
    }
  },
  plugins: {
    StatusBar: {
      style: 'DARK',
      overlaysWebView: false
    }
  }
};

export default config;
