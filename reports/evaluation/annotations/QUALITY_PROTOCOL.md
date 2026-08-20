# QA, provenance, summary, and mind-map annotation

Annotators label a representative, predeclared subset. QA fields are answer correctness, faithfulness, context relevance, claim-level citation support, citation completeness, and unsupported claims. Summary rubric fields are coverage, faithfulness, redundancy, section organization, and provenance validity. Mind-map fields are concept coverage, hierarchy correctness, relation correctness, redundancy, and provenance validity.

Every supporting ID must resolve to an indexed chunk. An unresolved reference is invalid provenance; annotators must not infer or invent evidence. Preserve raw LLM-judge output separately when a judge supplements human labels. Judge output never replaces the human subset.

Use pseudonymous annotator identifiers, record rubric version, and double-annotate an agreement subset.
