-- RFC 6238 §5.2 replay defense. STEP_SKEW = 1 lets us accept a code across
-- three 30-second windows (previous, current, next) to tolerate authenticator
-- clock skew, but nothing today rejects the SAME code inside that window if
-- it is replayed by a network snoop / screen recording / keylog before the
-- next window rolls. `last_used_counter` stores the highest TOTP counter
-- (floor(unixSec/30) offset by the ±1 window) previously accepted for this
-- user; a verify that matches a counter <= last_used_counter is a replay.
ALTER TABLE user_totp
  ADD COLUMN IF NOT EXISTS last_used_counter INTEGER NOT NULL DEFAULT 0;
