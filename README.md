# Time Tracker

A mobile-first timesheet app for recording office hours. Employees sign in with Google, punch in / out, mark Work from Home or On Leave, add notes per day, view their history as a list or monthly calendar, and export to PDF or JSON.

Multi-user: each person sees only their own timesheet. Isolation is enforced by Postgres Row-Level Security, not by UI code.

Built as a Vite + React + TypeScript single-page app on [Supabase](https://supabase.com/), wrapped with [Capacitor](https://capacitorjs.com/) for the Android build.

## Features

- **Google Sign-In** — one-tap authentication on web and Android.
- **Punch In / Punch Out** — large circular button on the Home screen; live `H:MM:SS` elapsed counter while a session is active.
- **Manual entry** — pick a date and Type (Time / WFH / Leave). Time entries support optional Time Out (leave blank to start a Working session retroactively).
- **WFH & On Leave** — single-tap quick actions for today, or use the manual entry form for any date.
- **Notes per date** — tap any date card (or any calendar cell) to add or edit notes; the cell shows a small dot when notes exist.
- **Dashboard** — month dropdown, three summary cards (Total / Average / Days), color-coded entries (red < 7h, yellow 7–8h, green ≥ 8h, violet WFH, amber Leave, indigo Working).
- **Two views** — List and Calendar (view preference kept in localStorage).
- **Export** — PDF (per-month report, stamped with the employee's name and email) and JSON (re-importable backup), with month picker and Android's native share sheet.
- **Import** — load any JSON backup with a preview of how many entries will overwrite existing dates.
- **Color-coded average preview** in the Punch Out confirmation modal.
- **Account management** — Sign Out, Erase All Data, and Delete My Account (two-step confirmations).

## Tech stack

- [Vite](https://vitejs.dev/) 4 + React 18 + TypeScript 5
- [Tailwind CSS](https://tailwindcss.com/) 3
- [React Router](https://reactrouter.com/) 6
- [Supabase](https://supabase.com/) — Postgres, Auth (Google OAuth), Row-Level Security
- [jsPDF](https://github.com/parallax/jsPDF) + [jsPDF-AutoTable](https://github.com/simonbengtsson/jsPDF-AutoTable) for PDF export
- [Capacitor](https://capacitorjs.com/) 6 (`@capacitor/app`, `@capacitor/browser`, `@capacitor/share`, `@capacitor/filesystem`)

## Setup

### 1. Supabase project

1. Create a free project at [supabase.com](https://supabase.com/).
2. Open the **SQL Editor** and run [`supabase/schema.sql`](supabase/schema.sql). This creates the `profiles` and `records` tables, the RLS policies, the auto-profile trigger, and the account-deletion function.
3. Create a Google OAuth client in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials) (type: *Web application*). Set the authorized redirect URI to `https://<your-project-ref>.supabase.co/auth/v1/callback`.
4. In Supabase, go to **Authentication → Providers → Google**, enable it, and paste the Client ID and Secret.
5. Under **Authentication → URL Configuration**, add these redirect URLs:
   - `http://localhost:5173`
   - `com.timesheet.app://auth-callback` (required for the Android app)

### 2. Environment

```bash
cp .env.example .env
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from **Project Settings → API**. The anon key is safe to ship — RLS is the security boundary. Never put the `service_role` key in this file.

### 3. Run

```bash
npm install
npm run dev          # starts Vite dev server, listening on LAN (--host)
```

Open the URL shown in the terminal. On your phone, use `http://<your-pc-lan-ip>:5173/` (must be on the same Wi-Fi).

> If you used the app before it had accounts, your old localStorage entries are detected on first sign-in and you'll be offered a one-time upload into your account.

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

## Release builds

Signing is already configured. Credentials are read from `android/keystore.properties`,
which is **gitignored**; the keystore itself lives outside the repo entirely so it
can never be committed.

```
Keystore   ~/keystores/timetracker-release.jks
Alias      timetracker
Password   ~/keystores/PASSWORD-BACKUP.txt
```

> **Back up the keystore and its password somewhere off this machine.** If they
> are lost, the app can never be updated — you would have to republish under a
> new package name and lose every existing user. Google Play App Signing can
> reset a lost *upload* key, but only if you enrolled.

Building requires JDK 17 (the system default here is JDK 8, so set it per-shell):

```bash
export JAVA_HOME="C:/Tools/java/jdk17.0.13"   # PowerShell: $env:JAVA_HOME = "..."

npm run build && npx cap sync android
cd android
./gradlew bundleRelease      # -> app/build/outputs/bundle/release/app-release.aab
```

Verify it was signed with the right key before uploading:

```bash
keytool -printcert -jarfile app/build/outputs/bundle/release/app-release.aab
```

The SHA-1 must be `22:80:FF:48:B6:2F:EB:77:9A:27:90:B8:17:0E:23:14:F2:B3:FF:09`.

Bump `versionCode` in `android/app/build.gradle` before every upload — Play
rejects a reused one.

A fresh clone without `keystore.properties` still builds debug fine; only the
release tasks need it.

## Publishing to the Play Store

1. **Google Play Console** — $25 one-time developer registration.

2. **Enroll in Play App Signing** (offered on first upload). Google then holds
   the final signing key and your keystore becomes the *upload* key, which
   Google can reset if you lose it.

3. **Add the release SHA-1 to Google Cloud.** Create a second OAuth client,
   type **Android**, package `com.timesheet.app`, with the SHA-1 above.
   After enrolling in Play App Signing, also add the **app signing SHA-1** that
   the Play Console shows under *Setup → App integrity* — that is the
   fingerprint production installs actually carry.

   > Skipping this is the classic failure: sign-in works in debug, then breaks
   > for real users the moment the app ships.

4. **Privacy policy** — required, since the app collects email, name, and
   work-hours data. Source: [`docs/privacy-policy.md`](docs/privacy-policy.md).
   It must be reachable at a **public URL** before submission.

5. **Data Safety form** — declare:
   - *Personal info → Name, Email* — account management, required, not shared
   - *App activity / Other* — work hours, app functionality, required
   - Encrypted in transit: **yes**
   - Users can request deletion: **yes**

6. **Account deletion** — implemented in-app at *Dashboard → Delete My Account*.
   Play also requires a web-accessible deletion request URL in the console.

7. **Store listing** — icon (in `assets/`), feature graphic, at least two
   screenshots, short and full descriptions.

8. **Test on the internal testing track first**, with a real signed build, to
   confirm Google Sign-In works under the production signature.

## Project structure

```
src/
├── App.tsx                  # auth guard + router
├── main.tsx                 # entry point, wraps app in AuthProvider
├── index.css                # Tailwind directives + mesh background
├── context/
│   ├── AuthContext.tsx      # session, profile, sign-in/out, deep-link handling
│   └── SyncContext.tsx      # online status, pending queue, conflict state
├── components/
│   ├── BottomNav.tsx
│   ├── MigrationPrompt.tsx  # one-time localStorage → Supabase upload
│   ├── SyncBanner.tsx       # offline / pending-changes strip
│   └── ConflictModal.tsx    # pick local vs server version of a day
├── lib/
│   ├── types.ts             # TimeRecord / Profile + row ↔ record mappers
│   ├── supabase.ts          # Supabase client singleton
│   ├── auth.ts              # Google OAuth (web + native), profile, account deletion
│   ├── storage.ts           # Supabase CRUD (async, offline-tolerant)
│   ├── offlineQueue.ts      # local cache + pending mutation log + projection
│   ├── sync.ts              # queue replay, conflict detection
│   ├── network.ts           # connectivity detection + network-error heuristic
│   ├── localMigration.ts    # reads legacy localStorage data
│   ├── pdfExport.ts         # jsPDF report generator
│   └── importExport.ts      # JSON parse/export + saveBlob (Capacitor share)
└── pages/
    ├── LoginPage.tsx        # Google Sign-In screen
    ├── HomePage.tsx         # punch button, manual entry, greeting
    └── DashboardPage.tsx    # month dropdown, list/calendar views, account section

supabase/
└── schema.sql               # tables, RLS policies, triggers — run once

scripts/
├── generate-icon.mjs        # SVG → PNG for app icon
└── xlsm-to-json.mjs         # one-off importer for legacy .xlsm time-trackers

android/                     # Capacitor-generated native project
```

## Data shape

```ts
interface TimeRecord {
  id: string;
  userId: string;          // owner; stamped by the storage layer, enforced by RLS
  date: string;            // YYYY-MM-DD
  timeIn: string;          // HH:MM 24h (empty for WFH/Leave/Note)
  timeOut: string | null;
  totalHours: number | null;
  status: "Working" | "Completed" | "Note" | "WFH" | "Leave";
  notes?: string;
}
```

One record per user per day, enforced by a `unique (user_id, date)` constraint.

## Security model

All data isolation happens in Postgres, not in the client:

- Every `records` query is scoped by RLS to `user_id = auth.uid()`. The client never filters by user on reads — even a tampered client cannot see another employee's rows.
- `profiles.role` is an enum of `employee | admin`. The select policies already include `or is_admin()`, so a manager view can be enabled later by flipping one row — no migration needed.
- The anon key in `.env` is public by design. Security comes from RLS.

To promote someone to admin:

```sql
update profiles set role = 'admin' where email = 'you@company.com';
```

## Offline behavior

Punches work without a connection. A punch is never silently lost.

**How it works.** Each user gets two namespaced localStorage keys — `tt_cache_<userId>` (last known server state) and `tt_queue_<userId>` (mutations made offline). When a write fails because the network is unreachable, it's appended to the queue and replayed on reconnect. The UI renders `cache + queue` projected together, so an offline punch appears immediately.

Only genuine network failures fall back to the queue. RLS denials and constraint violations still throw — queueing those would just retry forever.

**What the user sees.** An amber "You're offline" bar with a pending count, plus a "Not synced" marker on affected entries (a dot in calendar view). Both disappear once the queue drains.

**Conflicts.** If a queued edit collides with a *different* server row for the same date — typically the employee punched on a second device — the sync pauses on that entry and asks which version to keep, showing both side by side. Nothing is overwritten until they choose.

**Edge cases handled:**
- Punch in then out while offline collapses into one queued write, not two conflicting ones
- `Erase All Data` supersedes everything queued before it
- Sign-out flushes the queue first; if it can't, the queue survives on disk until that user signs back in
- Local state is per-user, so a shared device never leaks one employee's cache into another's view
- **Import requires a connection** — a backup can be hundreds of rows and is never as time-critical as a punch

Queue logic is covered by a runtime test (19 assertions) exercising collapse, projection, deletes, `clearAll` precedence, and per-user isolation.

## License

Personal project — no license specified.