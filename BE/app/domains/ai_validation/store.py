"""Ghi `ai_validation_logs` (FR-13.10, FR-13.11)."""

from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from sqlalchemy import select

from app.db import session_scope
from app.db.models import AIValidationLog


def log_rejections(rejections: List[Dict[str, Any]], *, job_id: Optional[str] = None) -> int:
    """Mỗi item bị loại một dòng. Trả số dòng đã ghi.

    `job_id` chỉ gắn khi job đã có trong sổ cái Postgres (`jobs`) — FK sẽ nổ nếu trỏ vào
    job chỉ tồn tại trong SQLite. Không có job thì vẫn ghi log: FR-13.10 đòi bản ghi cho
    MỌI item bị loại, không kèm điều kiện.
    """
    if not rejections:
        return 0
    with session_scope() as s:
        for r in rejections:
            s.add(AIValidationLog(
                id=str(uuid.uuid4()),
                job_id=job_id,
                target_type=r.get("target_type") or "quiz_question",
                target_ref=(str(r["target_ref"])[:255] if r.get("target_ref") else None),
                rule_code=r["rule_code"],
                severity=r.get("severity") or "rejected",
                message=r.get("message"),
                payload_json=r.get("payload"),
            ))
    return len(rejections)


def list_for_job(job_id: str) -> List[Dict[str, Any]]:
    with session_scope() as s:
        rows = s.execute(
            select(AIValidationLog)
            .where(AIValidationLog.job_id == str(job_id))
            .order_by(AIValidationLog.created_at)
        ).scalars().all()
        return [{
            "log_id": r.id,
            "target_type": r.target_type,
            "target_ref": r.target_ref,
            "rule_code": r.rule_code,
            "severity": r.severity,
            "message": r.message,
            "payload": r.payload_json,
        } for r in rows]


def count_by_rule(job_id: str) -> Dict[str, int]:
    """Thống kê nhanh cho báo cáo chất lượng (citation accuracy, quiz relevance)."""
    from sqlalchemy import func

    with session_scope() as s:
        rows = s.execute(
            select(AIValidationLog.rule_code, func.count())
            .where(AIValidationLog.job_id == str(job_id))
            .group_by(AIValidationLog.rule_code)
        ).all()
        return {code: int(n) for code, n in rows}
