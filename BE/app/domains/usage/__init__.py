"""Server-authoritative AI usage metering and quota enforcement."""

from .context import UsageReservationContext
from .accounting import raw_provider_usage, record_provider_response
from .metering import (
    QuotaExceeded,
    claim_reservation,
    commit_reservation,
    finalize_reservation,
    get_reservation,
    get_operation_usage,
    get_summary,
    init_db,
    list_events,
    normalize_provider_usage,
    reconcile_stale_reservations,
    release_reservation,
    renew_reservation_lease,
    reserve,
    upsert_entitlement,
)

__all__ = [
    "QuotaExceeded",
    "UsageReservationContext",
    "raw_provider_usage",
    "record_provider_response",
    "claim_reservation",
    "commit_reservation",
    "finalize_reservation",
    "get_reservation",
    "get_operation_usage",
    "get_summary",
    "init_db",
    "list_events",
    "normalize_provider_usage",
    "reconcile_stale_reservations",
    "release_reservation",
    "renew_reservation_lease",
    "reserve",
    "upsert_entitlement",
]
