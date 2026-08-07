-- Admins who can unclaim ANY spot (managed from the hub Settings → Admins page).
-- Replaces the hardcoded default list; UNCLAIM_ADMIN_EMAILS env still adds extras.
create table if not exists admins (
  email text primary key,
  created_at timestamptz not null default now()
);
insert into admins (email) values
  ('nchen@makenotion.com'),
  ('eyy@makenotion.com'),
  ('vanessa.intan@makenotion.com'),
  ('faisa.mohamed@makenotion.com')
on conflict (email) do nothing;
