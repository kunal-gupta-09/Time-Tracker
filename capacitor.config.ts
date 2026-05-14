import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.timesheet.app",
  appName: "Time Tracker",
  webDir: "dist",
  android: {
    allowMixedContent: false,
  },
};

export default config;