"""Immutable user-scoped usage context passed across execution boundaries."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class UsageReservationContext:
    user_id: str
    reservation_id: str
    idempotency_key: str
    request_id: str | None = None
    job_id: str | None = None
    feature: str = "unknown"
    operation: str = "unknown"
    provider: str | None = None
    model: str | None = None
    period_identifier: str | None = None
    lease_owner: str | None = None

    @classmethod
    def from_reservation(cls, reservation: dict) -> "UsageReservationContext":
        return cls(
            user_id=str(reservation["user_id"]),
            reservation_id=str(reservation["id"]),
            idempotency_key=str(reservation["idempotency_key"]),
            request_id=reservation.get("request_id"),
            job_id=reservation.get("job_id"),
            feature=str(reservation.get("feature") or "unknown"),
            operation=str(reservation.get("operation") or "unknown"),
            provider=reservation.get("provider"),
            model=reservation.get("model"),
            period_identifier=(
                f"{reservation.get('period_start')}/{reservation.get('period_end')}"
                if reservation.get("period_start") and reservation.get("period_end") else None
            ),
            lease_owner=reservation.get("lease_owner"),
        )

    def to_dict(self) -> dict[str, Any]:
        """JSON-safe durable representation; intentionally contains no content."""
        return {
            "user_id": self.user_id,
            "reservation_id": self.reservation_id,
            "idempotency_key": self.idempotency_key,
            "request_id": self.request_id,
            "job_id": self.job_id,
            "feature": self.feature,
            "operation": self.operation,
            "provider": self.provider,
            "model": self.model,
            "period_identifier": self.period_identifier,
            "lease_owner": self.lease_owner,
        }

    @classmethod
    def from_dict(cls, value: dict[str, Any] | None) -> "UsageReservationContext | None":
        if not isinstance(value, dict) or not value.get("reservation_id"):
            return None
        return cls(
            user_id=str(value["user_id"]),
            reservation_id=str(value["reservation_id"]),
            idempotency_key=str(value["idempotency_key"]),
            request_id=value.get("request_id"),
            job_id=value.get("job_id"),
            feature=str(value.get("feature") or "unknown"),
            operation=str(value.get("operation") or "unknown"),
            provider=value.get("provider"),
            model=value.get("model"),
            period_identifier=value.get("period_identifier"),
            lease_owner=value.get("lease_owner"),
        )
