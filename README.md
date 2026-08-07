# OperationsLogs – Prototype 2

This is an offline-first Progressive Web App generated from the supplied
`20260719 Log Sheets.xlsx` workbook.

Included:
- Flying-day setup
- Winch flight entry
- Aerotow flight entry
- Existing glider, pilot and tug-pilot lists
- All names automatically converted to BLOCK CAPITALS
- Unlisted names are permitted but clearly warned and flagged
- Four-digit HHMM validation and automatic duration calculation
- Local IndexedDB storage
- Offline application cache
- Daily review
- CSV export

## Test on a Windows PC

A PWA must be served through a local web server rather than opened by
double-clicking index.html.

1. Unzip the package.
2. Open Command Prompt in the unzipped OperationsLogs folder.
3. Run:
   `py -m http.server 8080`
4. Open:
   `http://localhost:8080`

Chrome or Edge can then install it using the install icon in the address bar.

## Test on a phone

The folder needs to be placed on a small web server or secure HTTPS host.
Once opened in Chrome or Safari, use “Add to Home Screen”.

## Important prototype limitation

Records are stored safely on the current device, but central multi-device
synchronisation is not yet connected. The app already creates unique record
IDs and a local sync queue ready for the next development stage.


## Prototype 2 additions

- Take-off can be saved without a landing time.
- Open flights appear in a dedicated AIRBORNE panel.
- LAND NOW closes a flight with the current time.
- ENTER TIME allows a manually recorded landing.
- Airborne elapsed time updates on the home screen.
- Duplicate-open-aircraft warnings are included.
- Open flights persist in local device storage.
- DESIGN_PACK.md defines the workflow, database and synchronisation model.


## Prototype 3 additions

- Removed confirmation pop-ups after saving an airborne or completed flight.
- Added EDIT beside each flight in Review Today.
- Editing supports both airborne and completed records.
- Review Today shows airborne flights first.
- Airborne flights are ordered by latest take-off first.
- Completed flights are ordered by latest landing time first, falling back to take-off time if needed.


## Prototype 4 correction

- Fixed Review Today EDIT button handling.
- Added explicit non-submit button types.
- Updated the service-worker cache version so browsers do not keep running Prototype 2 or 3 JavaScript.
- Added cache-busting versions to the app assets.

When replacing an earlier installed prototype, close all OperationsLogs tabs and reopen the new version. If an installed shortcut still shows the old behaviour, remove that shortcut once and install Prototype 4 again.


## Prototype 5 correction

- Restored reliable WINCH FLIGHT and AEROTOW FLIGHT opening.
- Added direct independent handlers to both launch buttons.
- Removed duplicate delegated launch-button handlers.
- Disabled offline service-worker caching temporarily during prototype development.
- Prototype 5 automatically unregisters earlier service workers and clears old cached app files.
- Existing IndexedDB flight records are not deleted by this cache cleanup.


## Prototype 6 correction

The previous package contained mismatched files: the JavaScript expected the newer
Airborne panel and Save button, while index.html still contained the original layout.
That caused a startup error and prevented the Winch and Aerotow screens from opening.

Prototype 6:
- Rebuilds index.html to match the current JavaScript exactly.
- Restores the Airborne panel.
- Restores optional landing time and SAVE AS AIRBORNE.
- Wires Winch and Aerotow with normal JavaScript event handlers.
- Performs a build-time check that every HTML control referenced by JavaScript exists.
- Displays a visible startup error if a future mismatch occurs.


## Prototype 7 additions

- P2 is blank by default.
- SOLO remains available in the P2 autocomplete list.
- Saving with P2 blank asks whether the flight is SOLO.
- Choosing Yes fills SOLO and continues saving.
- Choosing No returns focus to P2 without saving.
- Selecting or confirming P1 moves focus to P2.
- Selecting or confirming P2 moves focus to Payee.
- Selecting or confirming Payee moves focus to Take-off.


## Prototype 8 additions

- Tug registration and tow height are blank when opening a new aerotow flight.
- Replaced the browser P2 confirmation with an in-app YES/NO dialog.
- Airborne panel is sorted by latest take-off time first.
- Review Today keeps airborne flights first.
- Airborne review records are sorted by latest take-off first.
- Completed review records are sorted by latest landing first, with take-off as fallback.
- Sorting now compares the stored four-digit operational times directly, including older records.


## Prototype 9 additions

- Export now creates an Excel workbook instead of a CSV file.
- The workbook contains separate Winch and Aerotow worksheets.
- Flights on each worksheet are sorted chronologically by take-off time, earliest first.
- The Winch worksheet omits tug-specific columns.
- The Aerotow worksheet includes tug registration, tug pilot and tow height.
- Export remains fully offline and downloads as an Excel-compatible .xls workbook.


## Version 1.0 release

OperationsLogs Version 1.0 is the first mobile/tablet release.

Included:

- Winch and aerotow flight entry.
- Airborne flight tracking.
- LAND NOW and manual landing time.
- Review Today with editing and deletion.
- Airborne-first operational sorting.
- P2 SOLO confirmation using YES/NO.
- Separate Winch and Aerotow Excel worksheets.
- Chronological take-off order in exported worksheets.
- IndexedDB local storage.
- Offline PWA application shell.
- Installable standalone mobile/tablet experience.
- Safe-area and touch-screen layout improvements.

Version 1.0 is intended for operational testing on phones and tablets before multi-user synchronisation is added.


## Version 1.1 release

Version 1.1 adds local Administration for master lists:

- Pilots
- Gliders
- Tug aircraft
- Tug pilots
- Payees

Each list supports search, add, edit and delete. Entries are converted to BLOCK CAPITALS,
deduplicated and sorted alphabetically.

Unlisted entries during flight input now include an ADD TO LIST button. List changes are
stored in IndexedDB on the current device and are not overwritten by future GitHub Pages
program updates.

Important limitation: Version 1.1 does not yet synchronise list changes between devices.
Each phone or tablet maintains its own local lists until central synchronisation is added.


## Version 1.2 — Shared Operations

Version 1.2 adds:

- Shared flights and airborne list across approved devices.
- Shared flying-day details.
- Shared pilots, gliders, tug aircraft, tug pilots and payees.
- Offline-first local saves with an automatic upload queue.
- Realtime landing and list updates.
- Device registration and administrator approval.
- Administrator-only sign-in.
- Operators do not sign in.
- Administrator-only master-list changes.
- Genuine `.xlsx` export using separate Winch and Aerotow worksheets.
- Basic server audit trail.
- Conflict detection that avoids silently overwriting a pending local change.

Run `SUPABASE_SETUP.sql` before publishing this version.


## Version 1.2.1 synchronisation correction

- Approved devices now refresh their own approval state automatically every 10 seconds.
- Approval is also refreshed when the app returns to the foreground or the browser regains focus.
- A device starts pulling and uploading records as soon as approval is detected.
- Administrator-only master-list queue entries no longer block flight or flying-day synchronisation.
- One failed queue item no longer prevents later flight records from being processed.
- Sync status now distinguishes flight changes from administrator changes waiting.
- Obsolete queue entries from older releases are removed safely.

Run `SUPABASE_1.2.1_PATCH.sql` once to add the devices table to Supabase Realtime.
The 10-second approval check works even before that patch is run.


## Version 1.2.2 correction

- Reconciles with Supabase every 30 seconds.
- Pulls current cloud data when the app becomes visible or regains focus.
- Restarts Realtime after reconnecting.
- Repairs missed INSERT, UPDATE and DELETE events automatically.


## Version 1.2.3 correction

Version 1.2.3 changes Flying Day details to automatic saving.

- Removed the Save Flying Day button.
- Date, day, runway, wind direction and wind speed are restored when reopening a date.
- Runway changes are confirmed before being shared with all devices.
- Wind direction and wind speed save automatically after a short pause.
- Flying Day changes save locally first and then synchronise through Supabase.
- No save confirmation pop-up is displayed.


## Version 1.2.4 correction

- Flying Day values are refreshed after every periodic cloud reconciliation.
- Runway and wind changes received through Realtime are applied directly to the visible controls.
- A device now refreshes its own Flying Day values after its update reaches Supabase.
- Missed Flying Day Realtime events are repaired by the 30-second reconciliation.
- The subtitle now says “Gliding operations log” so it is not confused with the connection status.


## Version 1.2.5 correction

Flying Day synchronisation is now field-based rather than whole-record based.

- Runway, wind direction and wind speed each queue and synchronise independently.
- A pending local runway change cannot be overwritten by an incoming wind update.
- A pending local wind change cannot be overwritten by an incoming runway update.
- Realtime and periodic reconciliation merge only fields that are not awaiting upload.
- Older whole-record Flying Day queue entries are migrated automatically.


## Version 1.2.6 correction

This release prevents mobile Flying Day values from reverting while being edited.

- Runway saves immediately after selection.
- Wind direction and speed remain protected while the mobile keyboard is active.
- Wind values save after typing pauses and again when the field loses focus.
- Cloud reconciliation cannot overwrite a focused Flying Day field.
- Dirty local fields are not restored from older local or cloud values until saving completes.


## Version 1.2.7 correction

- Prevents phone/tablet landing updates from reverting to airborne.
- Local landing changes remain protected while awaiting upload.
- An older airborne record cannot replace a pending completed flight.
- Supabase must return the matching landing status/time before pending is cleared.
- LAND NOW and manual landing both trigger immediate reconciliation.


## Version 1.2.8 correction

- Runway, wind direction and wind speed now use separate save timers.
- Flying Day queue changes carry a version number.
- A newer field change cannot be deleted when an older upload finishes.
- Supabase returns and acknowledges the updated Flying Day row.
- Pending fields remain protected until their exact queue version is acknowledged.


## Version 1.2.9 correction

Runway, wind direction and wind speed now have completely separate queue records and database updates. Updating one field can no longer alter either of the other fields. Android change events are handled explicitly.


## Version 1.2.10 correction

The remaining Flying Day fault was caused by stale queue records left on devices
by earlier Version 1.2 releases.

- On first opening Version 1.2.10, legacy Flying Day queue records are removed.
- The current authoritative runway and wind values are then downloaded from Supabase.
- Old whole-day queue records are never converted or replayed.
- New runway, wind-direction and wind-speed updates remain independent.
- Flight queues and locally stored flights are not removed by this cleanup.

After installing Version 1.2.10, re-enter any runway or wind change that had not
successfully reached the desktop before the update.


## Version 1.2.11 correction

Version 1.2.11 replaces the `flying_days` whole-row cloud record with
`flying_day_values`, which stores one independent row for each value:

- Day
- Runway
- Wind direction
- Wind speed

A device changing runway can no longer transmit or overwrite either wind value.
A device changing a wind value can no longer alter the runway or the other wind
value.

Run `SUPABASE_1.2.11_PATCH.sql` once before uploading this release.

## Version 1.3.0 — Flying Day rewrite

Cloud data is authoritative while online. Programmatic control updates cannot
trigger saves. Realtime updates affect only the changed field. IndexedDB is
fallback-only except for a pending local edit. Existing flight, landing,
administration and export functions are unchanged.

Run `SUPABASE_1.3.0_PATCH.sql` once before publishing.


## Version 1.3.1 correction

- Restored the WINCH FLIGHT button click handler.
- Restored the AEROTOW FLIGHT button click handler.
- Added a delegated click fallback for browser reliability.
- No Supabase SQL change is required.


## Version 1.4.0 operational improvements

- Added Ready to Launch queued flights.
- Added TAKE OFF NOW from the queue.
- Added authoritative selected-day flight reconciliation.
- Added cloud/device flight-count and airborne verification.
- Added manual SYNC NOW.
- Status shows VERIFIED only after a full consistency check.
- Master lists refresh during every cloud reconciliation.


## Version 1.4.1 queue-button correction

- SAVE TO READY QUEUE now calls the save workflow directly and no longer depends on requestSubmit().
- TAKE OFF NOW uses robust delegated button detection.
- TAKE OFF NOW gives immediate visual feedback while processing.
- Clear error messages are shown if a queued flight is no longer available locally.
- No Supabase SQL change is required.
