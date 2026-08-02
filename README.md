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
