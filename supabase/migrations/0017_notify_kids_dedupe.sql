-- 0014 added a 5-arg private.notify_kids (…, p_sender) but left the old 4-arg
-- overload from 0004 in place. Both have defaults, so every call with fewer args
-- ("function private.notify_kids(uuid[], unknown) is not unique") threw - which
-- aborted the CALLING transaction: set_override rolled back (parent "unlock now"
-- silently did nothing), and the same landmine sat under absence changes,
-- notify_due, and the critical-task engine's state pushes. Summons survived by
-- always passing all five args. Drop the old overload; the 5-arg version's
-- defaults cover every legacy call site.

drop function private.notify_kids(uuid[], text, text, text);
