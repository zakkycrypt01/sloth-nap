# Guidance for GitHub Copilot when it reviews or edits this repo.

The nap archives notes only after a person approves. That write records an intent
before it copies files. A retry must see status "confirmed" and must not copy again.
A timeout leaves status "submitted" and must not be treated as a failure to retry.

Reads (search, the morning brief) may be retried. Writes may not, unless the
idempotency key is the same one stored with the intent.

Do not put API keys in source. Read them from the environment.
