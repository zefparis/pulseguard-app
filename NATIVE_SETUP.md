# PulseGuard — Native Setup Guide

## Capacitor Configuration

The app is configured for Capacitor via `capacitor.config.ts`:
- **appId**: `com.iasolution.pulseguard`
- **appName**: `PulseGuard`
- **webDir**: `dist` (Vite build output)
- **Plugins**: CapacitorHttp (native HTTP), BackgroundRunner (silent heartbeat)

## Adding Native Platforms

### iOS (requires macOS with Xcode)
```bash
npx cap add ios
npx cap sync ios
npx cap open ios
```

### Android
```bash
npx cap add android
npx cap sync android
npx cap open android
```

## iOS Permissions (Info.plist)

After `npx cap add ios`, add these entries to `ios/App/App/Info.plist`:

```xml
<!-- Microphone — required for Vocal RAN cognitive enrollment test -->
<key>NSMicrophoneUsageDescription</key>
<string>PulseGuard captures a brief voice sample during the one-time cognitive enrollment to verify your identity. This recording is encrypted and used solely for authentication purposes.</string>

<!-- Motion — required for periodic behavioral signal capture -->
<key>NSMotionUsageDescription</key>
<string>PulseGuard uses motion sensors to periodically capture behavioral signals (movement patterns) as part of continuous identity verification. This data helps ensure the security of your authenticated session.</string>
```

### iOS Background Modes

In Xcode, enable the **Background Modes** capability for the target:
- ✅ Background fetch
- ✅ Background processing

These are required by `@capacitor/background-runner` to schedule the silent heartbeat task.

## Android Permissions (AndroidManifest.xml)

After `npx cap add android`, add to `android/app/src/main/AndroidManifest.xml`:

```xml
<!-- Motion sensors -->
<uses-permission android:name="android.permission.ACTIVITY_RECOGNITION" />
<uses-permission android:name="android.permission.HIGH_SAMPLING_RATE_SENSORS" />

<!-- Microphone -->
<uses-permission android:name="android.permission.RECORD_AUDIO" />

<!-- Background network access -->
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
```

## Background Heartbeat Limitations

The `@capacitor/background-runner` plugin runs JavaScript in a **restricted engine**
(not a WebView). This has important consequences:

### What it CAN do:
- `fetch()` for network requests (method, headers, body only — no Request object)
- `console.log/warn/error/info/debug`
- `TextEncoder`/`TextDecoder`
- Access to Capacitor device APIs (geolocation, notifications, KV store)

### What it CANNOT do:
- Access DOM APIs (no document, no window in the traditional sense)
- Capture motion/touch/sensor data (no devicemotion, deviceorientation, touch events)
- Interact with the app's WebView or React component tree
- Run at exact intervals (OS decides timing)

### OS-Imposed Constraints:
- **iOS**: ~30 seconds of runtime per invocation. OS determines when and how
  often the task runs. Not executed in simulator. Frequency influenced by app
  usage patterns.
- **Android**: 15-minute minimum interval between executions. Actual timing
  subject to battery optimizations (vendor-specific settings may need to be
  disabled by the user).

### What this means for PulseGuard:
The background heartbeat sends a **"device alive" ping** with no behavioral
data (empty signals object + `background_heartbeat: true` flag). This tells
the server the device is still present even when the app is backgrounded.

The **full behavioral check** (motion/touch capture + snapshot submission)
continues to run via the existing JavaScript scheduler in `PulseGuardApp.tsx`
whenever the app is in the foreground. The visibility handler already
triggers a catch-up check when the app returns to foreground if the configured
interval has elapsed.

This is a **real improvement** over the previous situation (total silence in
background), not a perfect solution. True background behavioral capture would
require a custom native plugin with direct sensor access — a significantly
larger engineering effort.

## Web Build (Vercel) — No Regression

The web build (`npm run build` → `vite build`) continues to work exactly as
before. The Capacitor dependencies are installed as dev dependencies and
the background-runner hook uses a lazy `import()` that silently fails on web
(caught and logged as a warning). No native code is loaded in the browser.

## Vocal RAN Fix (iOS)

The primary user-facing fix from this integration: running inside a native
WKWebView (via Capacitor) grants microphone access through the native iOS
permission system (`NSMicrophoneUsageDescription` in Info.plist), which is
significantly more reliable than Safari's web permission flow. The same
`audio.ts` code that works in `demoguard-app` (Capacitor) will now work in
`pulseguard-app` (Capacitor) without modification.

---

## API Base URL for Native Builds

On web (Vercel), API calls use relative URLs (`/api/...`) proxied via `vercel.json` rewrites.
On Capacitor native, the origin is `https://localhost` which has no server, so API calls
must use absolute URLs.

A `.env.capacitor` file is provided with:
```
VITE_API_BASE_URL=https://hybrid-vector-api-m5xt.onrender.com
```

**Build for Capacitor (native):**
```bash
vite build --mode capacitor
npx cap sync
```

**Build for web (Vercel):**
```bash
vite build
```
(No `VITE_API_BASE_URL` set — URLs stay relative, Vercel rewrites handle proxying.)

---
(c) 2026 Benjamin BARRERE / IA SOLUTION
Patents Pending FR2514274 | FR2514546
