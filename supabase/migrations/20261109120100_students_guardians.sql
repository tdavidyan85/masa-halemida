-- Students and the parent ↔ child link.

create table public.students (
  id         uuid primary key references public.profiles (id) on delete cascade,
  birth_date date not null check (birth_date > date '2005-01-01'),
  grade      text not null check (grade in ('גן', 'א', 'ב', 'ג', 'ד', 'ה', 'ו')),
  -- young children: picture + PIN on an enrolled device; older: username + password
  login_mode text not null check (login_mode in ('pin', 'password')),
  username   text unique check (username is null or username ~ '^[a-z0-9._-]{3,32}$'),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check ((login_mode = 'password') = (username is not null))
);
comment on table public.students is 'Created only by the server (student accounts need an auth user). birth_date and username are not readable through the API.';

-- PIN hashes and lockout state. No API access at all: only the student-login Edge Function (service role).
create table public.student_credentials (
  student_id   uuid primary key references public.students (id) on delete cascade,
  pin_hash     text,                         -- salted slow hash (argon2id/scrypt), set by the server
  failed_count int not null default 0 check (failed_count >= 0),
  locked_until timestamptz,
  hard_locked  boolean not null default false, -- after 10 failures: only a parent can release
  updated_at   timestamptz not null default now()
);

create table public.guardianships (
  parent_id   uuid not null references public.profiles (id) on delete cascade,
  student_id  uuid not null references public.students (id) on delete cascade,
  relation    text not null check (relation in ('אמא', 'אבא', 'אפוטרופוס/ית')),
  status      text not null default 'pending' check (status in ('pending', 'active', 'revoked')),
  -- set when the parent completed verification (e-mail + phone + declaration). Required to consent.
  verified_at timestamptz,
  created_at  timestamptz not null default now(),
  primary key (parent_id, student_id),
  check (parent_id <> student_id)
);
