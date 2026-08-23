# Booking write verification

Booking create/update responses are considered successful only after the persisted booking can be read back from Supabase and key fields match the submitted values.

Seat assignment also releases stale assigned seats for the same booking passenger and segment after a successful reassignment, preventing one passenger from remaining assigned to multiple buses for the same journey segment.
