# Arrive Notify: Quick Arrival backend

All journey logic runs inside Supabase (PostgreSQL functions called with `supabase.rpc`).
The app never holds a service-role key. Every function reads the signed-in user from
`auth.uid()` and only touches that user's rows.

## 1. Tables

| Table | Purpose | Written by |
|---|---|---|
| `places` | Saved destinations (name, category, address, latitude, longitude, `arrival_radius`, `is_favorite`, timestamps) | The app (rules below) |
| `journeys` | One row per trip. Keeps its OWN copy of the destination, so editing or deleting a place never changes history | Database functions only |
| `journey_locations` | GPS points of a journey | Database functions only |
| `journey_recipients` | People to tell about a journey (`recipient_name`, optional `recipient_id`, `notification_enabled`) | `start_quick_journey` only |
| `journey_events` | `started`, `arrived`, `cancelled`. UNIQUE per journey and type, so "arrived" exists once | Database functions only |
| `notifications` | Message records. `status = 'pending'` means **not delivered yet** | Database functions only |

Changed from your earlier schema: `places.radius_m` became `arrival_radius`; the old journey
columns were renamed (`dest_lat` to `destination_latitude`, `dest_lng` to `destination_longitude`,
`start_lat` to `start_latitude`, `start_lng` to `start_longitude`, `radius_m` to `arrival_radius`).
No rows are deleted. The old `ended_at` column is kept but no longer used.

## 2. Row Level Security

| Table | Who can read | Who can write |
|---|---|---|
| `places` | Owner only | Owner only (insert, update, delete policies) |
| `journeys` | Owner only | Nobody directly. Writes only through the functions |
| `journey_locations` | Owner of the journey | Functions only |
| `journey_recipients` | Owner of the journey | Functions only |
| `journey_events` | Owner | Functions only |
| `notifications` | The traveller, and a recipient **only for notifications addressed to them** | Functions only |

Table privileges for writing are revoked from `authenticated`, and everything is revoked from
`anon`. That is why a user cannot change a journey status, insert GPS points, or touch another
user's journey. A recipient never gets access to the journey or its GPS points.

## 3. Functions (database) and services (app)

Every database function returns `{"ok": true, ...}` or `{"ok": false, "error": {"code", "message"}}`.
The app wraps these in `src/services/*` and returns `{ ok: true, data }` or `{ ok: false, error }`.

| Spec | Service (app) | Database |
|---|---|---|
| getSavedPlaces | `placesService.getSavedPlaces()` | table query + RLS |
| addSavedPlace | `placesService.addSavedPlace(input)` | table insert + CHECK constraints |
| updateSavedPlace | `placesService.updateSavedPlace(id, patch)` | table update + RLS |
| deleteSavedPlace | `placesService.deleteSavedPlace(id)` | table delete (journeys keep their copy) |
| startQuickJourney | `journeyService.startQuickJourney(placeId, {recipients?})` | `start_quick_journey(...)` |
| getActiveJourney | `journeyService.getActiveJourney()` | `get_active_journey()` |
| updateJourneyLocation | `locationService.updateJourneyLocation(...)`, `sendJourneyLocation(...)` (with queue) | `update_journey_location(...)` |
| cancelJourney | `journeyService.cancelJourney(id)` | `cancel_journey(id)` |
| completeJourney | `arrivalService.processArrival(id)` | `complete_journey(...)` |
| getJourneyHistory | `journeyService.getJourneyHistory({limit, offset, status, sort})` | `get_journey_history(...)` |
| getLatestJourneyLocation | `locationService.getLatestJourneyLocation(id)` | `get_latest_journey_location(id)` |
| getNotificationHistory | `notificationService.getNotificationHistory()` | table query + RLS |
| createArrivalNotification | not in the app, on purpose | created inside `qa_process_arrival` |

### start_quick_journey (atomic)
Checks, in order: logged in, place id, GPS values, recipients list, the place belongs to the user,
no other active journey. Then it creates the journey (status `active`) with a copy of the
destination, the recipients, a `started` event and the first GPS point. A partial unique index
(`one_active_journey_per_user`) means two simultaneous taps can never create two active journeys.

Success:
```json
{
  "ok": true,
  "journey": {
    "id": "6f1c0c1e-...", "destination_name": "Home", "status": "active",
    "start_latitude": 22.7196, "start_longitude": 75.8577,
    "destination_latitude": 22.7251, "destination_longitude": 75.8830,
    "arrival_radius": 500, "started_at": "2026-11-08T10:15:00Z",
    "estimated_arrival_at": null, "arrived_at": null, "cancelled_at": null
  },
  "distance_m": 2860, "eta_seconds": null, "estimated_arrival_at": null
}
```
Failures:
```json
{ "ok": false, "error": { "code": "ACTIVE_JOURNEY_EXISTS", "message": "You already have an active journey.", "journey": { "id": "..." } } }
{ "ok": false, "error": { "code": "PLACE_NOT_FOUND", "message": "That destination was not found." } }
{ "ok": false, "error": { "code": "INVALID_COORDINATES", "message": "Your current location is not valid." } }
{ "ok": false, "error": { "code": "UNAUTHENTICATED", "message": "You must be logged in." } }
```
App-side error codes: `LOCATION_PERMISSION_DENIED`, `LOCATION_UNAVAILABLE`, `NETWORK_ERROR`, `INVALID_PLACE`.

### update_journey_location
Rejects: journey not yours, not active, bad coordinates, a timestamp more than 1 minute in the
future or more than 1 hour old, or not newer than the last stored point.
Stores a point only if it is at least 10 m or 30 s away from the last stored point (less data).

Success:
```json
{ "ok": true, "accepted": true, "stored": true, "counted_for_arrival": true,
  "distance_m": 420, "status": "active", "arrived": false, "newly_arrived": false,
  "eta_seconds": null, "estimated_arrival_at": null, "journey": { "...": "..." } }
```
Failure:
```json
{ "ok": false, "error": { "code": "JOURNEY_NOT_ACTIVE", "message": "This journey is no longer active.", "status": "cancelled" } }
{ "ok": false, "error": { "code": "OUTDATED_LOCATION", "message": "A newer location was already received." } }
```

### Automatic arrival (server side)
1. A reading counts only if its accuracy is 100 m or better (or unknown).
2. A counted reading inside the arrival circle adds 1 to `arrival_streak`; outside resets it to 0.
3. Poor readings (worse than 100 m) are stored but change nothing.
4. At 2 counted readings in a row the server runs `qa_process_arrival`.
5. `qa_process_arrival` does `UPDATE ... WHERE status = 'active'`, so only the first call changes
   anything. A cancelled journey can never become arrived, and repeating it is harmless.
6. It then creates the `arrived` event (unique) and one `pending` notification per enabled
   recipient (unique `dedupe_key`).
The journey row is locked (`FOR UPDATE`) during an update, so simultaneous updates are handled in order.

### cancel_journey / complete_journey
`cancel_journey` sets `cancelled` and `cancelled_at`; calling it twice returns `already_cancelled: true`.
`complete_journey` re-checks the position: it must be inside the arrival radius (plus up to 50 m for
GPS error) or it fails with `NOT_AT_DESTINATION`. Calling it again returns `already_arrived: true`.

### get_journey_history
Arguments: `p_limit` (1 to 100, default 20), `p_offset`, `p_status` (optional), `p_sort` (`asc` or `desc`).
```json
{ "ok": true, "total": 12, "limit": 20, "offset": 0,
  "items": [ { "id": "...", "destination_name": "Office", "status": "arrived",
               "started_at": "2026-11-07T08:00:00Z", "arrived_at": "2026-11-07T08:22:10Z",
               "duration_seconds": 1330 } ] }
```

## 4. Data retention
`purge_old_journey_locations(7)` deletes GPS points older than 7 days (journeys themselves are kept).
It cannot be called from the app. To run it daily, enable the `pg_cron` extension and run the
`cron.schedule(...)` line that is commented in the SQL file.

## 5. ETA
No routing provider is connected. `eta_seconds` and `estimated_arrival_at` are always `null`, and the
app says so. Distances shown are straight-line and are used only for the arrival circle.

## 6. What is NOT done yet
- Background tracking: location updates are sent only while the Active Journey screen is open.
- Delivery of notifications (push, SMS, links): rows are created as `pending` only.
- A screen to choose recipients: the database and `startQuickJourney(placeId, { recipients })` accept them.
- Road routing and real ETA.

## 7. How to test
App tests
1. Run `quick-arrival-backend.sql` in the Supabase SQL Editor (no errors expected).
2. Add a place, mark it favorite with the star, and check it appears first on Home.
3. Tap Start Journey, confirm, and check Supabase Table Editor > `journeys`: one row, status `active`.
4. Go Home and tap Start Journey on another place: you must get "Journey already active".
5. Save a place at your current spot with a 100 m radius, cancel the first journey, start this one.
   After about 10 seconds the screen shows ARRIVED. Check `journeys` (status `arrived`),
   `journey_events` (`started`, `arrived`) and `journey_locations`.
6. Open History: the journeys are listed with duration.
7. Cancel test: start a journey and cancel it. Status becomes `cancelled`, and no more rows appear in `journey_locations`.

See a notification record: after step 3, run in the SQL Editor
`insert into journey_recipients (journey_id, recipient_name) values ('JOURNEY-ID', 'Mom');`
then finish the journey by arriving. `select * from notifications;` shows one `pending` row.

Security test: sign in with a second account. Home must show none of the first account's places,
and `select * from journeys` in the app must return only that account's journeys.
