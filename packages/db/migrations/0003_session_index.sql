-- AuthGuard asks "is this session family still live?" on every request.
CREATE INDEX refresh_tokens_live_family ON core.refresh_tokens (family_id) WHERE revoked_at IS NULL;
