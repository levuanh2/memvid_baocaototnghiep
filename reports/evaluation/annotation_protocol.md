# Human annotation protocol — corpus_v1

Protocol version: `annotation-v1`. This protocol extends, rather than replaces, the Phase 4A dataset schema and quality protocols.

## 1. Roles and blindness

- Candidate author proposes questions or spans from the source documents.
- Validator independently checks naturalness, answerability, evidence relevance and completeness, gold status, and labels.
- Adjudicator resolves disagreements without seeing E0–E7 outputs.
- Annotators receive original source text with page/heading locators. They must not see system rankings, reranker/NLI scores, CRAG grades, generated answers, or runtime paths while creating ground truth.
- Use pseudonymous IDs. Do not store names, emails, credentials, or personal participant data.

LLM suggestions, if used, enter as `candidate` only. An LLM cannot assign `human_validated` or `adjudicated`.

## 2. Annotation status

- `candidate`: proposed or machine-inventoried; prohibited from final evaluation.
- `human_validated`: independently checked by a human under this protocol.
- `adjudicated`: disagreement resolved and rationale recorded.
- `excluded`: intentionally omitted with a reason.

Only `human_validated` and `adjudicated` query/label records may enter the final test evaluation.

## 3. Document screening

Confirm filename/hash, permission to use, primary/secondary language, format, structure quality, scan/OCR status, detected tables/images, duplicate group, and provenance resolvability. Reject documents whose original cannot be frozen or whose extraction cannot reliably locate supporting passages. Compare near versions manually; all versions of one source stay in the same split.

## 4. Two-stage query workflow

### Stage A — candidate generation

Propose natural questions only after reading the actual document. Assign one primary stratum: exact-term factual, paraphrase factual, multi-chunk, cross-section, overview, main-points, compare, how/why, ambiguous, insufficient evidence, contradictory evidence, or citation-sensitive. Record language, candidate difficulty, multi-chunk and hierarchical-context requirements, ambiguity type, and conceptual expected path only when relevant to the routing study.

Do not degrade grammar to manufacture ambiguity. Do not mention chunk IDs in question wording. Candidate generation may use document headings or an LLM, but must record `candidate_origin`.

### Stage B — human validation

The validator checks:

1. wording is natural and represents a plausible information need;
2. answerable/unanswerable status is correct for the selected corpus scope;
3. every marked passage contributes to the answer;
4. all evidence necessary for the reference answer is included;
5. no irrelevant passage is marked relevant;
6. ambiguity/contradiction rationale is genuine;
7. gold answer contains only supported facts;
8. split assignment follows the document split.

Failed records become `excluded`, with a reason. Records needing revision remain `candidate`.

## 5. Relevance and evidence completeness

Corpus_v1 uses binary relevance initially:

- `1 relevant`: directly answers part/all of the question or is necessary supporting context.
- `0 not relevant`: does not contribute to the answer, even if topically similar.

Do not use graded relevance unless a pilot double-annotation shows that levels 1/2/3 can be applied consistently. For evidence completeness, ask: “Could the complete reference answer be justified using only these spans?” If no, locate missing evidence or exclude the query.

### Protocol training example — not a corpus_v1 label

In `2-day24-ragas-guardrails.pdf`, PDF page 17 explains that Faithfulness extracts claims, verifies entailment against context, and computes verified claims divided by total claims. A claim describing that mechanism is a positive support example. The same slide’s example marks the “FPT revenue 50 nghìn tỷ” claim false because the shown context contains employee count and company-size statements but not revenue; merely citing page 17 would therefore be a negative support example for the revenue claim. These examples train the rule and must not be copied into the dataset without normal candidate and validation steps.

## 6. Canonical evidence spans and RQ1 mapping

Annotate source-level evidence before representation-specific chunks:

- `doc_id` and immutable source SHA-256;
- PDF page or DOCX heading path where available;
- normalized `char_start` and `char_end`;
- exact normalized evidence passage and SHA-256;
- whether the passage contains a complete annotated fact;
- validator status and evidence-completeness decision.

The coordinate system uses Unicode NFC, normalized newlines, and collapsed inline whitespace over production-extracted source text. `canonical-overlap-v1` maps a chunk as relevant when overlap/gold-span length is at least 0.50 or the chunk contains the complete normalized annotated fact. The threshold is fixed a priori and cannot be tuned on test. Unresolved alignments receive no automatic label and require adjudication. R0/R1/R2 keep distinct chunk IDs in `representation_qrels.jsonl`.

## 7. Gold answers and insufficient evidence

For answerable questions, write a concise reference answer containing only facts in validated spans. Record acceptable formulations/aliases separately where needed. Do not impose one stylistic form.

For unanswerable questions set `gold_status=insufficient_evidence`, leave `gold_answer=null`, and record:

- why evidence is insufficient;
- nearest potentially misleading source span, if one exists;
- expected behavior: do not assert an unsupported answer.

Do not create an unanswerable question by silently restricting access to a document that the experiment otherwise supplies.

## 8. Ambiguity

Allowed types: underspecified entity, multiple-meaning abbreviation, missing temporal/reference context, repeated concept across sections, or natural lexical mismatch. Record why it is ambiguous, what clarification would resolve it, and candidate evidence sets for each legitimate interpretation. The validator must confirm the wording is natural.

## 9. Contradictions

Annotate canonical source spans A and B before mapping to chunks. Labels:

- `contradiction`: both claims concern the same entity, time, population, condition, and scope and cannot both be true;
- `not_contradiction`: compatible statements;
- `conditional_difference`: differing stated conditions;
- `temporal_difference`: different times/versions;
- `scope_difference`: different populations or scope.

Record a human rationale referencing both spans. If natural cases are insufficient, create a separately versioned `controlled_contradiction_challenge_v1`; mark every document/query synthetic and exclude it from organic-corpus distributions.

## 10. Claim-level citation support

Split each reference answer into atomic verifiable claims. For each claim record canonical supporting spans and one label:

- `full`: all material parts supported;
- `partial`: some but not all material parts supported;
- `none`: no supporting evidence;
- `contradicted`: validated evidence opposes the claim.

A matching source ID is not evidence of support. Validate the cited passage text itself.

## 11. Summary rubric

For selected documents, annotate important sections, must-cover facts/concepts, critical exclusions, optional facts, and source spans. Do not require a single exact summary. Human raters score:

- coverage: proportion of must-cover items represented;
- faithfulness: claims supported by validated source spans;
- redundancy: unnecessary repetition (lower is better; report scale direction);
- organization: coherent section/order structure;
- provenance validity: every asserted source pointer resolves and supports its claim.

Use a predeclared 1–5 rubric with anchors: 1 = serious failure, 3 = materially adequate with omissions/errors, 5 = complete/faithful for the defined scope.

## 12. Mind-map rubric

Annotate required core concepts, acceptable parent–child relations, important cross-relations, invalid relation examples where useful, and evidence for every concept/relation. Do not define one exact tree as absolute truth. Rate concept coverage, hierarchy correctness, relation correctness, redundancy, and provenance validity on the same anchored 1–5 scale.

## 13. Multiple annotators and agreement

Where two humans are available, independently double-label at least 20% of each suitable categorical task, stratified across documents/query types. Use Cohen’s kappa for two-annotator nominal labels and Krippendorff’s alpha when there are more annotators, missing labels, or ordinal scales. Also report raw agreement and sample size. Evidence-span overlap/completeness disagreements require adjudication; do not hide them inside one kappa value.

If only one human is available, record `single_annotator=true`, omit agreement statistics, and state the limitation.

## 14. Adjudication and audit trail

Keep both original labels. The adjudicator records final label, rationale, protocol version, timestamp, and pseudonymous ID. Never overwrite a disagreement silently. Corrections after freeze require a new dataset version; experiments using the old version retain the old hashes.

## 15. HITL separation

Dataset annotators do not manufacture E7 reviewer actions. Real HITL review follows `annotations/HITL_PROTOCOL.md` after system drafts exist. Annotation time and human review/wait time remain separate from machine latency.
