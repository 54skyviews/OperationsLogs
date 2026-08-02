# OperationsLogs Version 1.2 — Supabase Setup

Complete these steps before uploading Version 1.2 to GitHub Pages.

## 1. Run the database setup

1. Open the Supabase OperationsLogs project.
2. Select **SQL Editor**.
3. Select **New query**.
4. Open `SUPABASE_SETUP.sql` from this package.
5. Copy the entire contents into the query.
6. Select **Run**.

The script creates the shared flights, flying-day, device, master-list,
administrator and audit tables. It also enables Row Level Security and Realtime.

## 2. Enable automatic operator device sessions

1. Open **Authentication**.
2. Open **Providers**.
3. Find **Anonymous Sign-Ins**.
4. Enable anonymous sign-ins.
5. Save.

Operators are not asked for a username or password. The app creates a background
anonymous session for each installed phone or tablet.

## 3. Create the first administrator

1. Open **Authentication → Users**.
2. Select **Add user**.
3. Create the administrator using an email address and password.
4. Open the new user and copy the user UUID.
5. Return to **SQL Editor**.
6. Run:

```sql
insert into public.admin_users(user_id)
values ('PASTE-THE-USER-UUID-HERE');
```

Only users added to `admin_users` can change lists or approve devices.

## 4. Upload Version 1.2 to GitHub

Replace the Version 1.1 files in the repository with every file inside the
`OperationsLogs` folder in this package.

The new important files are:

- `sync.js`
- `supabase-config.js`
- `SUPABASE_SETUP.sql`
- `SUPABASE_SETUP_GUIDE.md`

Commit the files directly to `main`. GitHub Pages will update automatically.

## 5. Register and approve each device

On first opening Version 1.2, the app asks for a device name, such as:

- LAUNCH POINT IPAD
- OFFICE COMPUTER
- TUG TABLET

The header then shows **DEVICE WAITING FOR ADMIN APPROVAL**.

To approve it:

1. Select **Administration**.
2. Sign in with the administrator email and password.
3. Under **Approved Devices**, select **APPROVE** beside the device.
4. The device begins synchronising automatically.

Operators never need to sign in.

## 6. Existing Version 1.1 local data

Version 1.2 keeps the same local IndexedDB database. Existing flights remain on
the device. After approval, pending and recent local flights are uploaded through
the synchronisation queue when they are next edited or saved.

For a controlled first rollout, export Version 1.1 records before updating and
start Version 1.2 at the beginning of a new flying day.


## Version 1.2.1 patch

After the original Version 1.2 SQL has been run, execute `SUPABASE_1.2.1_PATCH.sql` once.
This lets device approval changes arrive through Realtime. Version 1.2.1 also checks approval
automatically every 10 seconds, so approval will still be detected if Realtime is delayed.
