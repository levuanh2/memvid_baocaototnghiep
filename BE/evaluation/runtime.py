from __future__ import annotations

import os
import random
from dataclasses import dataclass


@dataclass(frozen=True)
class EvaluationControls:
    seed: int = 20260811
    semantic_cache: bool = False
    retrieval_cache: bool = False
    hitl: bool = False
    temperature: float = 0.0

    def apply_before_production_imports(self) -> None:
        """Apply controls before importing modules whose settings are import-time."""
        os.environ["EVALUATION_MODE"] = "1"
        os.environ["PYTHONHASHSEED"] = str(self.seed)
        os.environ["SEMANTIC_CACHE_ENABLED"] = "1" if self.semantic_cache else "0"
        os.environ["RETRIEVAL_CACHE_ENABLED"] = "1" if self.retrieval_cache else "0"
        os.environ["HITL_ENABLED"] = "1" if self.hitl else "0"
        os.environ["LLM_TEMPERATURE_FACTUAL"] = str(self.temperature)
        random.seed(self.seed)
        try:
            import numpy as np
            np.random.seed(self.seed)
        except ImportError:
            pass
        try:
            import torch
            torch.manual_seed(self.seed)
            if torch.cuda.is_available():
                torch.cuda.manual_seed_all(self.seed)
        except ImportError:
            pass


UNCONTROLLED_SOURCES = [
    "Remote provider scheduling, model revisions behind mutable names, and server-side kernels may be nondeterministic.",
    "FAISS/GPU and PyTorch kernels are not claimed bitwise deterministic across hardware or package versions.",
    "Human review time and decisions are intrinsically variable.",
]

