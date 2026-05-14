# Time Tracker

A mobile-first timesheet app — punch in / out, mark Work from Home or On Leave, add notes per day, view your history as a list or monthly calendar, and export to PDF or JSON.

Built as a Vite + React + TypeScript single-page app, wrapped with [Capacitor](https://capacitorjs.com/) for the Android APK build.

## Features

- **Punch In / Punch Out** — large circular button on the Home screen; live `H:MM:SS` elapsed counter while a session is active.
- **Manual entry** — pick a date and Type (Time / WFH / Leave). Time entries support optional Time Out (leave blank to start a Working session retroactively).
- **WFH & On Leave** — single-tap quick actions for today, or use the manual entry form for any date.
- **Notes per date** — tap any date card (or any calendar cell) to add or edit notes; the cell shows a small dot when notes exist.
- **Dashboard** — month dropdown, three summary cards (Total / Average / Days), color-coded entries (red < 7h, yellow 7–8h, green ≥ 8h, violet WFH, amber Leave, indigo Working).
- **Two views** — List and Calendar (preserved across sessions in localStorage).
- **Export** — PDF (per-month report) and JSON (re-importable backup), with month picker and Android's native share sheet (pick the destination folder via _Save to Files_, send to Drive, email, etc.).
- **Import** — load any JSON backup back into the app with a preview of how many entries will overwrite existing dates.
- **Color-coded average preview** in the Punch Out confirmation modal — see what your monthly average will become before you commit.
- **First-launch name prompt** — the app greets the user by name on the Home screen.
- **Erase / Delete** — two-step confirmation for both _Erase All Data_ and per-record _Delete_.

## Tech stack

- [Vite](https://vitejs.dev/) 4 + React 18 + TypeScript 5
- [Tailwind CSS](https://tailwindcss.com/) 3
- [React Router](https://reactrouter.com/) 6
- [jsPDF](https://github.com/parallax/jsPDF) + [jsPDF-AutoTable](https://github.com/simonbengtsson/jsPDF-AutoTable) for PDF export
- [Capacitor](https://capacitorjs.com/) 6 (`@capacitor/share`, `@capacitor/filesystem`) for the native Android shell
- LocalStorage for persistence (no backend)

## Running locally

```bash
npm install
npm run dev          # starts Vite dev server, listening on LAN (--host)
```

Open the URL shown in the terminal. On your phone, use `http://<your-pc-lan-ip>:5173/` (must be on the same Wi-Fi).

## Building the Android APK

Requires JDK 17 and the Android SDK installed (no full Android Studio required — the command-line tools work).

```bash
npm run android:sync           # builds web app and copies into Android project
cd android
./gradlew assembleDebug        # outputs app/build/outputs/apk/debug/app-debug.apk
```

To re-generate the app icons after editing the source SVGs:

```bash
node scripts/generate-icon.mjs
npx capacitor-assets generate --android
```

## Project structure

```
src/
├── App.tsx                  # top-level router + welcome gate
├── main.tsx                 # entry point
├── index.css                # Tailwind directives + mesh background
├── components/
│   ├── AppShell.tsx
│   ├── BottomNav.tsx
│   └── WelcomeModal.tsx
├── lib/
│   ├── types.ts             # TimeRecord interface
│   ├── storage.ts           # localStorage CRUD + helpers
│   ├── pdfExport.ts         # jsPDF report generator
│   └── importExport.ts      # JSON parse/export + saveBlob (Capacitor share)
└── pages/
    ├── HomePage.tsx         # punch button, manual entry, greeting
    └── DashboardPage.tsx    # month dropdown, list/calendar views, modals

scripts/
├── generate-icon.mjs        # SVG → PNG for app icon
└── xlsm-to-json.mjs         # one-off importer for legacy .xlsm time-trackers

android/                     # Capacitor-generated native project
```

## Data shape

```ts
interface TimeRecord {
  id: string;
  date: string;            // YYYY-MM-DD
  timeIn: string;          // HH:MM 24h (empty for WFH/Leave/Note)
  timeOut: string | null;
  totalHours: number | null;
  status: "Working" | "Completed" | "Note" | "WFH" | "Leave";
  notes?: string;
}
```

## License

Personal project — no license specified.