# Arrive Notify: UI redesign notes

Visual reference: the "Don't text. Just arrive." UI deck (dark navy, electric blue, green for arrival, orange for emergency).
Only the interface changed. Everything in `src/services/` (Supabase calls, tracking, arrival, SOS) is untouched.

## Design system
- `src/lib/theme.ts`: colours, radius, spacing, type scale, control sizes, glow. Old keys kept (bg, card, ink, mute, line, route, routeSoft, danger).
- `src/components/ui/index.tsx`: Screen, ScreenHeader, SectionHeader, Card, Button (primary/secondary/danger/success/ghost), Badge, Chip, ProgressBar, PulseDot, Avatar, IconTile, ListRow, ToggleRow, Input, SearchBar, ConfirmModal, EmptyState, ErrorNote, AppBackground, GradientView.
- `src/components/ui/Icon.tsx`: one icon set (expo-symbols). Each icon has an iOS and an Android name, both type-checked.
- `src/lib/mapStyle.ts`: dark map style for Android (iOS uses userInterfaceStyle="dark").
- `src/lib/format.ts`: shared date, duration, status and place-icon helpers.
- `src/lib/prefs.ts`: on-device preferences used by Notification Settings.
- No new packages were added.

## Navigation
Bottom tabs (`src/app/(tabs)/`): Home, Journey (Quick Arrival), Groups, History, Profile.
Everything else opens as a normal screen over the tabs (journey, notify, sos, track, places, privacy, ...).
SOS is reachable from Home (top-right badge and card) and from the live journey screen.

## New screens
Journey tab (Quick Arrival), Profile tab, Privacy Settings, Edit Profile, Notification Settings, About.

## Behaviour changes worth knowing
- Arrival and cancellation now show a full confirmation screen ("You Have Arrived!") instead of an alert.
- Cancel / delete / remove / log out use in-app confirmation dialogs instead of system alerts.
- SOS has a new "Update Location" button that sends your position immediately.
- Quick Arrival shows road travel time for the first 4 places (free OSRM server, cached for 10 minutes).
- Notification Settings: "Journey updates" hides the in-app banner for non-emergency updates. Emergency alerts are always shown.

## Smart Privacy Settings (Feature 6)
Run `privacy-backend.sql` ONCE in the Supabase SQL Editor. The app still works without it (settings are then saved on the phone only, and the screen says so).

Screens: `privacy` (hub), `privacy-recipients` (who can see my journeys), `privacy-data` (data and account), plus per-type alerts in `notification-settings`.

What it controls:
- Live status, "Stop all sharing now", active sharing sessions (journey and SOS), remove one viewer from a live journey.
- Share live location by default, default recipients (pre-selected in Start Journey).
- Which alert types I receive (started, about 10 min away, arrived, cancelled). Emergency alerts are never hidden.
- SOS: keep sending location during an SOS (on/off), cancel countdown (3, 5 or 10 seconds).
- Location permission status (including approximate vs precise), allow, open phone settings.
- Location data retention: when journey ends, 1, 7 or 30 days; delete location history now. Enforced about once a day when the app opens.
- Your data: counts of what is stored, download my data, delete journey history, sign out, delete account (type DELETE).

Code: `src/lib/prefs.ts` (shared settings store, synced to Supabase), `src/services/privacyService.ts`, `privacy-backend.sql` (table `privacy_settings` + 9 functions).
Also fixed: headline text (titles, section headings, dialog titles) was black on the dark background; the type scale now sets white.

## Add People with QR code (Feature 7)
One-time setup (do both):
1. Run `npm install` in the project folder. `package.json` now lists `expo-camera`, `expo-sharing` and `expo-file-system` at the versions your Expo SDK recommends. Then restart with `npx expo start -c`.
   If you skip this the app still starts; the scanner screen just tells you to run the command above, and Share falls back to the phone's own share sheet.
2. Run `people-qr-backend.sql` ONCE in the Supabase SQL Editor (2 tables + 7 functions).

Flow: Home, Add People, then either Generate My QR Code or Scan QR Code. A scan opens a confirmation screen (name and picture only), then Add Person connects both people.
The QR holds only `arrivenotify://c/<64 random hex characters>`: no name, email or id. The same link also works if shared as text (opens `/c/<token>`).

Screens: `add-people`, `my-qr`, `scan-qr`, `c/[token]` (confirm, also the deep-link target).
Code: `src/lib/qr.ts` (QR generator, no library), `src/lib/png.ts` (PNG writer for Save/Share), `src/components/ui/QrCode.tsx`, `src/services/connectionsService.ts`.

Rules enforced on the server: code must exist, be active and unexpired; you cannot add yourself; no duplicates (unique pair); the app can read only its own rows and can never write to the tables directly.
Relationship model: connections are mutual and instant (the owner showed the code, the scanner scanned it). This matches your People list, which has no acceptance step. Anything that notifies someone or shares a location still needs their acceptance (group invitation, emergency request).
Connected people are mirrored into the existing People list (`contacts` table) and offered as emergency contacts (no email needed).
Not yet wired: group member and journey recipient pickers, because their authorization lives in database functions that are not in this repo.
For production builds (not Expo Go): add the expo-camera config plugin with a camera permission message in app.json.

## Animated logo and entrance (Feature 8)
Built with `react-native-reanimated` (already installed), so animations run on the UI thread. No new packages.

- `src/components/brand/AnimatedLogo.tsx`: the logo (blue tile with location pin), `Wordmark` (letters rise one by one) and `Reveal` (staggered fade-and-rise for sections).
- `src/components/brand/BrandIntro.tsx`: short intro once per app launch, for signed-in users. Tap to skip.
- `src/components/brand/intro.ts`: timing and the hand-off so Home reveals as the intro fades (or is skipped). Change `INTRO_HOLD_MS` to make the intro longer or shorter.
- `src/lib/responsive.ts`: breakpoints, intro logo size, and the 720px content column used on tablet and desktop.

Where it shows: the intro (over Home on launch), Home header (compact logo + wordmark, sections reveal in turn), login screen.
Effects: spring entrance with a light burst, floating, subtle 3D tilt, orbit ring with a travelling light, glow pulse, and a soft chrome sheen every ~4 seconds.
Paused while the Home tab is hidden or the app is in the background. "Reduce Motion" in the phone's accessibility settings turns all movement off.
To remove the intro: delete the `{session ? <BrandIntro /> : null}` line in `src/app/_layout.tsx` (Home then reveals instantly).
Note: `assets/images/icon.png`, `splash-icon.png` and `favicon.png` are still Expo's starter artwork (the home-screen icon, splash and browser tab). They are not used by the animation. Replace them with Arrive Notify artwork before publishing.
