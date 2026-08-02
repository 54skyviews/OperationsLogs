# OperationsLogs — Version 1.0 Design Pack

## 1. Product principle

OperationsLogs must be fast enough to operate at the launch point with one hand.
The main screen is a live operational view, not a spreadsheet.

## 2. Version 1.0 scope

- Flying-day setup
- Winch launch entry
- Aerotow launch entry
- Open airborne flights
- One-tap landing
- Manual correction of take-off and landing times
- Searchable pilot, tug-pilot and aircraft lists
- Unlisted names and aircraft allowed with warnings
- Names stored and displayed in BLOCK CAPITALS
- Local offline storage
- Daily review
- CSV and later Excel export
- Multi-device synchronisation architecture

## 3. Primary workflow

### Start flying day
1. Select date.
2. Confirm runway and wind.
3. Save the flying day.
4. The settings remain active until changed.

### Record take-off
1. Tap WINCH FLIGHT or AEROTOW FLIGHT.
2. Select aircraft and crew.
3. Tap TAKE-OFF NOW or enter HHMM.
4. Leave landing blank.
5. Tap SAVE AS AIRBORNE.
6. The flight appears in AIRBORNE on the home screen.

### Record landing
1. Tap LAND NOW beside the correct aircraft.
2. The app inserts current HHMM.
3. Duration is calculated.
4. The flight moves from AIRBORNE to completed records.

A manual ENTER TIME option supports delayed entry.

## 4. Status model

Each flight has one of these statuses:

- `airborne` — take-off recorded; no landing time
- `completed` — take-off and landing recorded
- `landing_unknown` — authorised administrative exception
- `cancelled` — retained in audit history, excluded from totals

## 5. Safeguards

- Landing is optional during initial entry.
- Take-off is mandatory.
- A duplicate-airborne warning appears when the same aircraft is already open.
- The app cannot close a flying day while an aircraft remains airborne.
- Airborne records survive closing the app and restarting the device.
- Elapsed time is displayed but not written as final duration until landing.
- Cross-midnight duration is supported.
- Every change is retained in the audit trail.

## 6. Navigation

HOME
├── Flying Day Setup
├── Winch Flight Entry
├── Aerotow Flight Entry
├── Airborne Flights
│   ├── Land Now
│   └── Enter Landing Time
├── Review Today
└── Export

ADMINISTRATION
├── Names
├── Gliders
├── Tug Aircraft
├── Tug Pilots
├── Unlisted Entries
├── Users and Roles
└── Sync Status

## 7. Core data model

### flying_days
- date
- day
- runway
- wind_direction
- wind_speed
- status
- created_by
- created_at
- modified_at

### flights
- id
- date
- type
- status
- sequence_number
- glider
- p1
- p2
- payee
- takeoff_hhmm
- landing_hhmm
- takeoff_timestamp
- landing_timestamp
- duration_minutes
- tug_registration
- tug_pilot
- tow_height
- remarks
- aerobatic_minutes
- office_use
- warnings
- created_by
- created_on_device
- created_at
- modified_at
- sync_status

### master_names
- id
- display_name
- active
- roles
- created_at
- modified_at

### audit_events
- id
- record_type
- record_id
- action
- old_values
- new_values
- user_id
- device_id
- timestamp

### sync_queue
- id
- record_id
- action
- queued_at
- retry_count
- last_error

## 8. Synchronisation model

Each device writes locally first. Network availability never blocks flight entry.

1. A unique UUID is created for each record.
2. The record is saved to IndexedDB.
3. A sync event is placed in the local queue.
4. When online, queued changes are uploaded.
5. The server accepts new records idempotently.
6. Server changes are downloaded to each device.
7. Conflicting edits are flagged rather than silently overwritten.
8. Landing an airborne flight updates the original record; it does not create a second flight.

Recommended conflict rule:
- Non-overlapping field changes merge automatically.
- A landing update takes priority over an earlier airborne copy.
- Two different landing times require administrative review.
- Deletion never removes the historical record.

## 9. User roles

### Launch Point
- Create flights
- Land flights
- Correct current-day entries
- View current-day records

### Office
- Review and correct records
- Resolve unlisted names
- Export data
- Reconcile flight numbers

### Administrator
- Manage users and master lists
- Unlock days
- Resolve conflicts
- Restore cancelled records
- View audit and sync logs

## 10. Prototype 2 acceptance checks

- A take-off can be saved with no landing time.
- The open flight appears immediately on HOME.
- LAND NOW closes it and calculates duration.
- ENTER TIME accepts a manual HHMM.
- Airborne records remain after browser or device restart.
- Duplicate aircraft generate a warning.
- Names remain in BLOCK CAPITALS.
- Unlisted names remain permitted and flagged.


## 11. Review Today ordering and editing

Review Today uses this order:

1. All airborne flights first.
2. Airborne flights ordered by newest take-off time first.
3. Completed flights ordered by newest landing time first.
4. If no landing time is available, take-off time is used.

Each record provides:

- EDIT — opens the flight-entry form with all values loaded.
- DELETE — removes the local record after confirmation.

Saving an edited flight updates the original record and queues the change for synchronisation.
Normal save actions do not display confirmation pop-ups.


## Version 1.1 — Local master-list administration

Administration manages Pilots, Gliders, Tug Aircraft, Tug Pilots and Payees.
Values are stored in the local IndexedDB `masterLists` object store.

Rules:
- Values are saved in BLOCK CAPITALS.
- Blank and duplicate values are rejected.
- Lists are alphabetically sorted.
- SOLO remains a special P2 option and is not stored as a pilot.
- Removing a list entry does not alter historical flight records.
- Unlisted flight-entry values may be promoted into the appropriate list.
- Version 1.1 list changes are device-local; multi-device synchronisation remains future work.


## Version 1.2 — Authentication and synchronisation decision

Operators are not asked to sign in. Each installed device receives an automatic
anonymous Supabase Auth session and must be approved by an administrator.

Administrators sign in only when opening Administration. A separate browser
authentication storage key preserves the operator device session while the
administrator session is active.

The Supabase database is authoritative when online. IndexedDB remains the
immediate offline working store. Flight changes are queued locally and uploaded
when connectivity returns.

Master lists are readable by approved devices but writable only by authenticated
users present in `admin_users`.


## Version 1.2.2 — Realtime reconciliation

Realtime is supplemented by a 30-second full reconciliation and foreground/online refreshes so missed events cannot leave a device permanently out of date.


## Version 1.2.3 — Flying Day auto-save

The Flying Day area no longer has an explicit Save button.

Runway changes require confirmation because they alter the shared operational
state for all approved devices. Wind values auto-save after a short debounce.
All values are persisted in IndexedDB and synchronised to `flying_days`.
