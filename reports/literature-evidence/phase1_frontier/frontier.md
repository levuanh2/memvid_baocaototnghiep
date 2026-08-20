# Phase 1 — Frontier scan

Scope: long-document representation, evidence-aware/corrective RAG, structured artifacts, HITL and evaluation. Sources below were verified against official proceedings/publisher pages.

## Current frontier papers

1. Liu et al. (2024), *Lost in the Middle: How Language Models Use Long Contexts*, TACL 12, 157–173, DOI 10.1162/tacl_a_00638.
2. Bai et al. (2024), *LongBench: A Bilingual, Multitask Benchmark for Long Context Understanding*, ACL 2024, DOI 10.18653/v1/2024.acl-long.172.
3. Chen et al. (2024), *M3-Embedding: Multi-Linguality, Multi-Functionality, Multi-Granularity Text Embeddings Through Self-Knowledge Distillation*, Findings ACL 2024, DOI 10.18653/v1/2024.findings-acl.137.
4. Günther et al. (2024), *Late Chunking: Contextual Chunk Embeddings Using Long-Context Embedding Models*, arXiv:2409.04701, original preprint.
5. Sarthi et al. (2024), *RAPTOR: Recursive Abstractive Processing for Tree-Organized Retrieval*, ICLR 2024.
6. Yan et al. (2024), *Corrective Retrieval Augmented Generation*, arXiv:2401.15884, original preprint.
7. Niu et al. (2024), *RAGTruth: A Hallucination Corpus for Developing Trustworthy Retrieval-Augmented Language Models*, ACL 2024, DOI 10.18653/v1/2024.acl-long.585.
8. Saad-Falcon et al. (2024), *ARES: An Automated Evaluation Framework for Retrieval-Augmented Generation Systems*, NAACL 2024, DOI 10.18653/v1/2024.naacl-long.20.
9. Es et al. (2024), *RAGAs: Automated Evaluation of Retrieval Augmented Generation*, EACL System Demonstrations 2024, DOI 10.18653/v1/2024.eacl-demo.16.
10. Wang et al. (2024), *Large Language Models are not Fair Evaluators*, ACL 2024, DOI 10.18653/v1/2024.acl-long.511.
11. Wang et al. (2025), *Document Segmentation Matters for Retrieval-Augmented Generation*, Findings ACL 2025, DOI 10.18653/v1/2025.findings-acl.422.
12. Jain et al. (2025), *AutoChunker: Structured Text Chunking and its Evaluation*, ACL Industry 2025.

## Frontier tendencies

- Long context capacity does not guarantee robust use of information across positions.
- Chunking is increasingly treated as an evaluable methodological decision rather than preprocessing trivia.
- Recent RAG work separates retrieval quality, answer faithfulness and citation quality.
- Corrective retrieval adds explicit evidence assessment before generation.
- LLM judges are useful but require calibration and human validation due to positional and self-preference biases.

