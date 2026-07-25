/**
 * Capacitor configuration for PulseGuard native shell
 *
 * Enables the existing Vite web app to run inside a native WKWebView (iOS)
 * and Android WebView, fixing:
 *  - Vocal RAN audio capture on iOS Safari (WKWebView grants mic permission
 *    reliably via native Info.plist, unlike Safari's restrictive web permissions)
 *  - Background heartbeat via @capacitor/background-runner (see limitations below)
 *
 * The web build (vite build → dist/) remains the primary deployment target
 * for Vercel. Capacitor wraps the same dist/ output for native distribution.
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.iasolution.pulseguard',
  appName: 'PulseGuard',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    BackgroundRunner: {
      label: 'PulseGuardHeartbeat',
      src: 'pulseguard/background-heartbeat.ts',
      event: 'backgroundTask',
      repeat: true,
      // Interval in minutes. Android minimum: 15 minutes.
      // iOS: OS-determined, may not run in simulator.
      // We use 15 as a safe cross-platform minimum. The actual configured
      // checkFrequencyMs is sent via dispatchEvent extras for reference,
      // but the OS controls the real timing.
      interval: 15,
      autoStart: false, // We trigger manually after config is loaded
    },
  },
};

export default config;
