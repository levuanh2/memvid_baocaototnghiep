"""Provider-boundary helpers for explicit usage reservation contexts."""
from __future__ import annotations

from typing import Any

from .context import UsageReservationContext
from .metering import commit_reservation, normalize_provider_usage


def raw_provider_usage(response: Any) -> dict[str, Any] | None:
    """Read official counters from common provider/LangChain response shapes."""
    direct = getattr(response, "usage_metadata", None)
    if isinstance(direct, dict) and direct:
        return direct
    metadata = getattr(response, "response_metadata", None)
    if not isinstance(metadata, dict):
        return None
    for key in ("usage", "token_usage", "usage_metadata"):
        value = metadata.get(key)
        if isinstance(value, dict) and value:
            return value
    return None


def record_provider_response(
    context: UsageReservationContext | None,
    response: Any,
    *,
    attempt_id: str,
    provider: str | None = None,
    model: str | None = None,
    kind: str = "chat",
    status: str = "committed",
    usage_source: str = "provider",
    latency_ms: int | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Persist official provider usage immediately and idempotently.

    Missing counters are not estimated and do not create a charged event.
    """
    if context is None:
        return None
    if not attempt_id:
        raise ValueError("usage attempt_id is required")
    raw = raw_provider_usage(response)
    if not raw:
        return None
    usage = normalize_provider_usage(raw, kind=kind)
    return commit_reservation(
        context.reservation_id,
        attempt_id=attempt_id,
        close_reservation=False,
        provider=provider or context.provider,
        model=model or context.model,
        usage_source=usage_source,
        status=status,
        latency_ms=latency_ms,
        metadata=metadata,
        **usage,
    )
