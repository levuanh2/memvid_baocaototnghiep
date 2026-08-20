# Phase 2 — Survey landscape

The curated database contains 40 verified records, spanning foundational IR, long-document representation, RAG, evidence refinement, structured artifacts, HITL and evaluation.

## Theme synthesis

### Long documents and segmentation

LongBench and Lost in the Middle show that nominal context capacity does not imply robust long-context use. Late Chunking addresses loss of surrounding context in independently embedded chunks. Recent peer-reviewed chunking work treats chunk boundaries, coherence and structure as measurable design choices. There is no canonical primary paper for the common software pattern called “recursive character splitting”; it should be described as an engineering baseline, not a named research method.

### Retrieval

BM25 is the canonical sparse baseline; DPR establishes dual-encoder dense passage retrieval; FAISS addresses efficient vector similarity search. BEIR shows that performance varies by dataset and that no single retrieval family uniformly dominates. RRF offers rank-based fusion, while cross-encoders jointly encode query and passage for more expensive second-stage relevance estimation.

### Hierarchical and corrective RAG

The original RAG paper combines parametric generation with retrieved non-parametric memory. RAPTOR represents long documents as a tree of recursively summarized clusters. CRAG adds an explicit retrieval evaluator and corrective actions. Query2doc shows that generated expansion can disambiguate or enrich retrieval queries, but gains are dataset-dependent.

### Grounding and evaluation

ALCE operationalizes citation correctness and completeness. RAGTruth demonstrates that unsupported or contradictory claims remain possible after retrieval augmentation. RAGAS and ARES separate context relevance, answer relevance and faithfulness. LLM judges can scale evaluation, but G-Eval, MT-Bench and later bias studies require calibration and human checks.

### Structured artifacts and HITL

Long-document summarization literature supports multi-stage and hierarchical processing rather than a single unconstrained model call. Concept-map mining literature treats concept and relation extraction as distinct problems and reports that fully automatic human-quality maps remain difficult. HITL literature supports explicit feedback and human control, but does not imply that inserting an approval button automatically improves quality.

