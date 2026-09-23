"""guided_mindmap_jobs.force -- persist the request's force flag

Root cause of the force-cache bug: `force` was computed in app/main.py's
/generate-mindmap handler and only gated that handler's OWN immediate
cache lookup. It was never written into the durable job row (only `intent`
was, via guided_config_json), so `guided_worker.py`'s independent
content-hash cache check in run_once() had no way to know the original
request asked for a fresh generation -- it always reused a matching
existing record regardless of `force`. This column closes that gap.
"""
from alembic import op
import sqlalchemy as sa

revision = "20260923_guided_job_force_flag"
down_revision = "20260921_guided_job_ledger"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "guided_mindmap_jobs",
        sa.Column("force", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade():
    op.drop_column("guided_mindmap_jobs", "force")
