const app = {
  reviewer: "",
  data: null,
  kind: "corpus",
  indexes: { queries: 0, citations: 0, contradictions: 0, artifacts: 0 },
};

const $ = (selector) => document.querySelector(selector);
const esc = (value = "") => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const list = (values = []) => `<ul>${values.map(v => `<li>${esc(v)}</li>`).join("")}</ul>`;

function toast(message, error = false) {
  const node = $("#toast");
  node.textContent = message;
  node.style.background = error ? "#8f2d36" : "#11283d";
  node.classList.add("show");
  setTimeout(() => node.classList.remove("show"), 2600);
}

async function api(path, options = {}) {
  const response = await fetch(path, {headers: {"Content-Type": "application/json"}, ...options});
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `Request failed (${response.status})`);
  return value;
}

function sourceCard(view, label = "Canonical evidence") {
  return `<article class="evidence-card">
    <div class="locator-ruler"><span>${esc(label)}</span><span>${esc(view.locator_label)}</span></div>
    <p class="source-text">${esc(view.context_before)}<mark>${esc(view.exact_source_text)}</mark>${esc(view.context_after)}</p>
    <p class="exact-label">EXACT SOURCE TEXT · OFFSETS ${view.start_offset}–${view.end_offset}</p>
  </article>`;
}

function sheetHeader(id, title, decision) {
  return `<header class="sheet-head"><div><span class="id-tag">${esc(id)}</span><h2>${esc(title)}</h2></div>
    <span class="status-pill ${decision ? "saved" : ""}">${decision ? "autosaved" : "pending"}</span></header>`;
}

function option(value, label, current) { return `<option value="${value}" ${value === current ? "selected" : ""}>${label}</option>`; }

function queryNeedsReview(item) {
  const d = item.decision;
  if (!d) return true;
  if (d.query_decision === "reject" || d.answer_decision === "reject") return false;
  return d.answerability === "answerable" && d.evidence_decision !== "approve";
}

function pendingIndex(items, currentIndex) {
  if (app.kind !== "queries") return -1;
  for (let offset = 1; offset < items.length; offset++) {
    const index = (currentIndex + offset) % items.length;
    if (queryNeedsReview(items[index])) return index;
  }
  return -1;
}

function corpusView() {
  const documents = app.data.corpus;
  return `<article class="review-sheet corpus-approval"><header class="sheet-head"><div><span class="id-tag">Required corpus gate</span><h2>Corpus membership and document-level split</h2></div><span class="status-pill ${app.data.progress.corpus.complete ? "saved" : ""}">${app.data.progress.corpus.complete ? "autosaved" : "pending"}</span></header>
    <div class="candidate-pane"><div class="rationale">The values marked Proposed are annotation aids only. No inclusion or split is selected automatically; the reviewer must explicitly choose both where required.</div></div>
    <form id="corpus-form" class="decision-panel"><div class="corpus-grid">${documents.map((doc, index) => {
      const d = doc.decision || {};
      return `<section class="artifact-block corpus-document" data-index="${index}">
        <span class="id-tag">${esc(doc.document_id)}</span><h3>${esc(doc.filename)}</h3>
        <dl class="corpus-meta"><div><dt>Domain</dt><dd>${esc(doc.domain)}</dd></div><div><dt>Format</dt><dd>${esc(doc.format)}</dd></div><div><dt>Immutable source hash</dt><dd class="hash">${esc(doc.source_hash)}</dd></div><div><dt>Proposed membership</dt><dd>${esc(doc.proposed_include_in_corpus)}</dd></div><div><dt>Proposed split</dt><dd>${esc(doc.proposed_split)}</dd></div></dl>
        <div class="decision-grid"><label class="control"><span class="field-label">Include in corpus</span><select data-field="include"><option value="">Choose…</option>${option("yes","Yes",d.include_in_corpus)}${option("no","No",d.include_in_corpus)}</select></label>
        <label class="control"><span class="field-label">Approved split</span><select data-field="split"><option value="">Choose…</option>${option("development","Development",d.split)}${option("test","Test",d.split)}</select></label>
        <label class="control full"><span class="field-label">Optional reviewer note</span><textarea data-field="note">${esc(d.reviewer_note || "")}</textarea></label></div>
      </section>`;
    }).join("")}</div><div class="save-row"><span class="save-note">Excluded documents must have no split. Included documents require development or test.</span><button class="primary" type="submit">Save corpus approval</button></div></form></article>`;
}

function queryView(item) {
  const d = item.decision || {};
  const evidence = item.source_views.length ? item.source_views.map(v => sourceCard(v)).join("") : `<p class="rationale">No supporting span is proposed. The human must verify ambiguity or insufficiency against the source scope.</p>`;
  return `<article class="review-sheet" data-item-id="${esc(item.query_id)}">
    ${sheetHeader(item.query_id, item.query, item.decision)}
    <dl class="meta-grid">
      <div><dt>Document</dt><dd>${esc(item.document_filename)}</dd></div><div><dt>Split</dt><dd>${esc(item.split)}</dd></div>
      <div><dt>Proposed type</dt><dd>${esc(item.query_type)}</dd></div><div><dt>Answerability</dt><dd>${esc(item.answerability)}</dd></div>
    </dl>
    <div class="content-grid"><div class="candidate-pane">
      <h3 class="section-title">Candidate answer · annotation aid</h3><div class="candidate-answer">${esc(item.candidate_answer || "No candidate answer")}</div>
      <h3 class="section-title" style="margin-top:22px">Candidate rationale</h3><div class="rationale">${esc(item.candidate_rationale)}</div>
      ${item.ambiguity_reason ? `<h3 class="section-title" style="margin-top:22px">Ambiguity note</h3><div class="rationale">${esc(item.ambiguity_reason)}${list(item.acceptable_interpretations)}</div>` : ""}
      ${item.nearest_passage ? `<h3 class="section-title" style="margin-top:22px">Nearest passage note</h3><div class="rationale">${esc(item.nearest_passage)}</div>` : ""}
    </div><div class="source-pane"><h3 class="section-title">Source view · candidate, not ground truth</h3>${evidence}</div></div>
    <form id="decision-form" class="decision-panel">
      <h3 class="section-title">Human decision — every field is explicit</h3>
      <div class="decision-grid">
        <label class="control"><span class="field-label">Query decision</span><select id="query-decision"><option value="">Choose…</option>${option("approve","Approve",d.query_decision)}${option("edit","Edit + Approve",d.query_decision)}${option("reject","Reject",d.query_decision)}</select></label>
        <label class="control"><span class="field-label">Answerability</span><select id="answerability"><option value="">Choose…</option>${option("answerable","Answerable",d.answerability)}${option("ambiguous","Ambiguous",d.answerability)}${option("insufficient_evidence","Insufficient",d.answerability)}</select></label>
        <label class="control"><span class="field-label">Answer decision</span><select id="answer-decision"><option value="">Choose…</option>${option("approve","Approve",d.answer_decision)}${option("edit","Edit",d.answer_decision)}${option("reject","Reject",d.answer_decision)}</select></label>
        <label class="control"><span class="field-label">Evidence decision</span><select id="evidence-decision"><option value="">Choose…</option>${option("approve","Approve",d.evidence_decision)}${option("incomplete","Incomplete",d.evidence_decision)}${option("wrong","Wrong",d.evidence_decision)}</select></label>
        <label class="control full"><span class="field-label">Corrected query (required for Edit + Approve)</span><textarea id="corrected-query">${esc(d.corrected_query || "")}</textarea></label>
        <label class="control full"><span class="field-label">Corrected answer</span><textarea id="corrected-answer">${esc(d.corrected_answer || "")}</textarea></label>
        <label class="control full"><span class="field-label">Corrected evidence JSON (optional; must resolve exactly)</span><textarea id="corrected-evidence" class="code">${esc(d.corrected_evidence ? JSON.stringify(d.corrected_evidence, null, 2) : "")}</textarea></label>
        <label class="control full"><span class="field-label">Reviewer notes</span><textarea id="notes">${esc(d.notes || "")}</textarea></label>
      </div><div class="save-row"><span class="save-note">Saving records your decision under ${esc(app.reviewer)}.</span><button class="primary" type="submit">Save human decision</button></div>
    </form></article>`;
}

function citationView(item) {
  const d = item.decision || {};
  const defaultIds = item.supporting_span_ids || [];
  return `<article class="review-sheet" data-item-id="${esc(item.answer_or_claim_id)}">
    ${sheetHeader(item.answer_or_claim_id, item.claim, item.decision)}
    <dl class="meta-grid"><div><dt>Query</dt><dd>${esc(item.query_id)}</dd></div><div><dt>Candidate label</dt><dd>${esc(item.support_label)}</dd></div><div><dt>Evidence spans</dt><dd>${defaultIds.length}</dd></div><div><dt>Status</dt><dd>CANDIDATE</dd></div></dl>
    <div class="content-grid"><div class="candidate-pane"><h3 class="section-title">Atomic claim</h3><div class="candidate-answer">${esc(item.claim)}</div>
    <h3 class="section-title" style="margin-top:22px">Instruction</h3><div class="rationale">Judge whether the displayed passages support every material part of this claim. A source ID alone is not support.</div></div>
    <div class="source-pane"><h3 class="section-title">Candidate supporting evidence</h3>${item.source_views.map(v => sourceCard(v)).join("")}</div></div>
    <form id="decision-form" class="decision-panel"><div class="decision-grid">
      <label class="control"><span class="field-label">Claim decision</span><select id="claim-decision"><option value="">Choose…</option>${option("approve","Approve claim text",d.claim_decision)}${option("edit","Edit + Approve claim",d.claim_decision)}${option("reject","Reject claim",d.claim_decision)}</select></label>
      <label class="control"><span class="field-label">Support label</span><select id="support-label"><option value="">Choose…</option>${option("full","Full",d.support_label)}${option("partial","Partial",d.support_label)}${option("none","None",d.support_label)}${option("contradicted","Contradicted",d.support_label)}</select></label>
      <label class="control full"><span class="field-label">Corrected claim</span><textarea id="corrected-claim">${esc(d.corrected_claim || "")}</textarea></label>
      <label class="control full"><span class="field-label">Supporting candidate span IDs (comma-separated)</span><input id="supporting-ids" value="${esc((d.supporting_span_ids || defaultIds).join(", "))}"></label>
      <label class="control full"><span class="field-label">Reviewer notes</span><textarea id="notes">${esc(d.notes || "")}</textarea></label>
    </div><div class="save-row"><span class="save-note">No label is preselected.</span><button class="primary" type="submit">Save claim review</button></div></form></article>`;
}

function contradictionView(item) {
  const d = item.decision || {};
  return `<article class="review-sheet" data-item-id="${esc(item.pair_id)}">${sheetHeader(item.pair_id, "Compare both passages under the same scope", item.decision)}
    <dl class="meta-grid"><div><dt>Query</dt><dd>${esc(item.query_id)}</dd></div><div><dt>Proposed only</dt><dd>${esc(item.proposed_label)}</dd></div><div><dt>Passage A</dt><dd>${esc(item.span_a_id)}</dd></div><div><dt>Passage B</dt><dd>${esc(item.span_b_id)}</dd></div></dl>
    <div class="passage-pair">${sourceCard(item.passage_a,"Passage A")}${sourceCard(item.passage_b,"Passage B")}</div>
    <form id="decision-form" class="decision-panel"><div class="decision-grid">
      <label class="control"><span class="field-label">Human label</span><select id="contradiction-label"><option value="">Choose…</option>${option("direct_contradiction","Direct contradiction",d.label)}${option("conditional_difference","Conditional difference",d.label)}${option("scope_difference","Scope difference",d.label)}${option("temporal_difference","Temporal difference",d.label)}${option("not_contradiction","Not contradiction",d.label)}</select></label>
      <label class="control full"><span class="field-label">Required human rationale</span><textarea id="rationale">${esc(d.rationale || "")}</textarea></label>
      <label class="control full"><span class="field-label">Reviewer notes</span><textarea id="notes">${esc(d.notes || "")}</textarea></label>
    </div><div class="save-row"><span class="save-note">Different time, conditions, or scope are not automatically contradictions.</span><button class="primary" type="submit">Save comparison</button></div></form></article>`;
}

function artifactView(item) {
  const d = item.decision || {};
  const candidate = {evaluation_scope:item.evaluation_scope, important_concepts:item.important_concepts, important_sections:item.important_sections, expected_relations:item.expected_relations, critical_facts:item.critical_facts, critical_exclusions:item.critical_exclusions, invalid_or_redundant_relations:item.invalid_or_redundant_relations};
  return `<article class="review-sheet" data-item-id="${esc(item.document_id)}">${sheetHeader(item.document_id, item.document.filename, item.decision)}
    <dl class="meta-grid"><div><dt>Domain</dt><dd>${esc(item.document.domain)}</dd></div><div><dt>Format</dt><dd>${esc(item.document.format)}</dd></div><div><dt>Language</dt><dd>${esc(item.document.language)}</dd></div><div><dt>Scope</dt><dd>Summary + mind map</dd></div></dl>
    <div class="artifact-columns"><section class="artifact-block"><h3>Summary review</h3><b>Must-cover concepts</b>${list(item.important_concepts)}<b>Important sections</b>${list(item.important_sections)}<b>Key facts</b>${list(item.critical_facts)}<b>Prohibited unsupported assertions</b>${list(item.critical_exclusions)}</section>
    <section class="artifact-block"><h3>Mind-map review</h3><b>Core concepts</b>${list(item.important_concepts)}<b>Parent-child / cross-relations</b>${list(item.expected_relations)}<b>Invalid or redundant relations</b>${list(item.invalid_or_redundant_relations)}</section></div>
    <form id="decision-form" class="decision-panel"><div class="decision-grid">
      <label class="control"><span class="field-label">Artifact decision</span><select id="artifact-decision"><option value="">Choose…</option>${option("approve","Approve",d.artifact_decision)}${option("edit","Edit + Approve",d.artifact_decision)}${option("reject","Reject",d.artifact_decision)}</select></label>
      <label class="control full"><span class="field-label">Corrected annotation JSON (required for edit)</span><textarea id="corrected-annotation" class="code">${esc(d.corrected_annotation ? JSON.stringify(d.corrected_annotation,null,2) : JSON.stringify(candidate,null,2))}</textarea></label>
      <label class="control full"><span class="field-label">Reviewer notes</span><textarea id="notes">${esc(d.notes || "")}</textarea></label>
    </div><div class="save-row"><span class="save-note">Approve only after checking the source document.</span><button class="primary" type="submit">Save artifact review</button></div></form></article>`;
}

function progressView() {
  const p = app.data.progress;
  const qDone = p.queries.approved + p.queries.edited + p.queries.rejected;
  const queryTotal = app.data.items.queries.length;
  const metrics = [
    ["Corpus approval", p.corpus.reviewed, p.corpus.total, `${p.corpus.pending} pending`],
    ["Queries", qDone, queryTotal, `${p.queries.approved} approved · ${p.queries.edited} edited · ${p.queries.rejected} rejected · ${p.queries.pending} pending`],
    ["Citation claims", p.citations.reviewed, p.citations.total, `${p.citations.pending} pending`],
    ["Contradictions", p.contradictions.reviewed, p.contradictions.total, `${p.contradictions.pending} pending`],
    ["Artifacts", p.artifacts.reviewed, p.artifacts.total, `${p.artifacts.pending} pending`],
  ];
  return `<article class="review-sheet progress-board"><p class="kicker">Counts only · no performance metrics</p><h2>Annotation progress</h2>
    ${metrics.map(([name,n,total,note]) => `<div class="metric-row"><div><strong>${name}: ${n}/${total}</strong><br><small>${note}</small></div><div class="bar"><span style="width:${total ? (100*n/total) : 0}%"></span></div></div>`).join("")}
    <div class="blocked-banner ${p.complete ? "ready-banner" : ""}"><strong>${p.complete ? "Review complete — export is available." : "Dataset remains blocked."}</strong><br>${p.complete ? "Export creates new reviewed files; it does not import or freeze them." : "Required human decisions are still pending. No export approval is inferred."}</div>
    <button id="export" class="primary" ${p.complete ? "" : "disabled"}>Export reviewed files</button><p id="export-result" class="save-note"></p></article>`;
}

function render() {
  document.querySelectorAll("#section-nav button").forEach(b => b.classList.toggle("active", b.dataset.kind === app.kind));
  const toolbar = $("#item-toolbar");
  if (app.kind === "progress") {
    toolbar.style.display = "none"; $("#review-canvas").innerHTML = progressView();
    $("#export")?.addEventListener("click", exportReview); updateNav(); return;
  }
  if (app.kind === "corpus") {
    toolbar.style.display = "none"; $("#review-canvas").innerHTML = corpusView();
    $("#corpus-form").addEventListener("submit", saveCorpusApproval); updateNav(); return;
  }
  toolbar.style.display = "grid";
  const items = app.data.items[app.kind];
  const index = Math.max(0, Math.min(app.indexes[app.kind], items.length - 1)); app.indexes[app.kind] = index;
  const item = items[index];
  const wrappedPendingIndex = pendingIndex(items, index);
  $("#item-progress").textContent = `${index + 1} / ${items.length}`;
  $("#previous").disabled = index === 0;
  $("#next").disabled = index >= items.length - 1 && wrappedPendingIndex < 0;
  $("#next").textContent = index >= items.length - 1 && wrappedPendingIndex >= 0 ? "Next pending →" : "Next →";
  const renderers = {queries:queryView, citations:citationView, contradictions:contradictionView, artifacts:artifactView};
  $("#review-canvas").innerHTML = renderers[app.kind](item);
  $("#decision-form").addEventListener("submit", event => saveCurrent(event, item));
  localStorage.setItem(`review-index-${app.kind}`, String(index));
  updateNav();
}

async function saveCorpusApproval(event) {
  event.preventDefault();
  try {
    const documents = app.data.corpus.map((doc, index) => {
      const card = document.querySelector(`.corpus-document[data-index="${index}"]`);
      return {document_id:doc.document_id, source_hash:doc.source_hash,
        include_in_corpus:card.querySelector('[data-field="include"]').value,
        split:card.querySelector('[data-field="split"]').value,
        reviewer_note:card.querySelector('[data-field="note"]').value.trim()};
    });
    const result = await api("/api/corpus-approval", {method:"POST", body:JSON.stringify({reviewer_id:app.reviewer, documents})});
    app.data.corpus = app.data.corpus.map(doc => ({...doc, decision:result.approval.documents.find(row => row.document_id === doc.document_id)}));
    app.data.progress = result.progress; toast("Corpus approval autosaved"); render();
  } catch (error) { toast(error.message, true); }
}

async function saveCurrent(event, item) {
  event.preventDefault();
  let payload = {reviewer_id: app.reviewer, notes: $("#notes")?.value || ""};
  let id;
  try {
    if (app.kind === "queries") {
      id = item.query_id;
      const rawEvidence = $("#corrected-evidence").value.trim();
      payload = {...payload, query_decision:$("#query-decision").value, answerability:$("#answerability").value,
        answer_decision:$("#answer-decision").value, evidence_decision:$("#evidence-decision").value,
        corrected_query:$("#corrected-query").value.trim(), corrected_answer:$("#corrected-answer").value.trim(),
        corrected_evidence:rawEvidence ? JSON.parse(rawEvidence) : null};
    } else if (app.kind === "citations") {
      id = item.answer_or_claim_id;
      payload = {...payload, claim_decision:$("#claim-decision").value, support_label:$("#support-label").value,
        corrected_claim:$("#corrected-claim").value.trim(), supporting_span_ids:$("#supporting-ids").value.split(",").map(x=>x.trim()).filter(Boolean)};
    } else if (app.kind === "contradictions") {
      id = item.pair_id; payload = {...payload, label:$("#contradiction-label").value, rationale:$("#rationale").value.trim()};
    } else {
      id = item.document_id; const action=$("#artifact-decision").value;
      payload = {...payload, artifact_decision:action, corrected_annotation:action === "edit" ? JSON.parse($("#corrected-annotation").value) : null};
    }
    const result = await api(`/api/review/${app.kind}/${encodeURIComponent(id)}`, {method:"POST", body:JSON.stringify(payload)});
    item.decision = result.decision; app.data.progress = result.progress; toast("Human decision autosaved"); render();
  } catch (error) { toast(error.message, true); }
}

function updateNav() {
  const p = app.data.progress;
  const qDone = p.queries.approved + p.queries.edited + p.queries.rejected;
  $("#nav-corpus").textContent = `${p.corpus.reviewed}/${p.corpus.total}`;
  $("#nav-queries").textContent = `${qDone}/${app.data.items.queries.length}`;
  $("#nav-citations").textContent = `${p.citations.reviewed}/${p.citations.total}`;
  $("#nav-contradictions").textContent = `${p.contradictions.reviewed}/${p.contradictions.total}`;
  $("#nav-artifacts").textContent = `${p.artifacts.reviewed}/${p.artifacts.total}`;
  $("#nav-status").textContent = p.complete ? "Ready" : "Blocked";
}

async function exportReview() {
  try {
    const value = await api("/api/export", {method:"POST", body:JSON.stringify({reviewer_id:app.reviewer})});
    $("#export-result").textContent = `Written to ${value.export_dir}`; toast("Reviewed files exported");
  } catch (error) { toast(error.message, true); }
}

async function startSession(reviewer) {
  await api("/api/session", {method:"POST", body:JSON.stringify({reviewer_id:reviewer})});
  app.reviewer = reviewer; localStorage.setItem("reviewer-id", reviewer);
  for (const kind of ["queries","citations","contradictions","artifacts"]) app.indexes[kind] = Number(localStorage.getItem(`review-index-${kind}`) || 0);
  app.data = await api(`/api/bootstrap?reviewer_id=${encodeURIComponent(reviewer)}`);
  $("#reviewer-chip").textContent = reviewer; $("#session-gate").classList.add("hidden"); render();
}

$("#session-form").addEventListener("submit", async event => {
  event.preventDefault(); $("#session-error").textContent = "";
  try { await startSession($("#reviewer-id").value.trim()); }
  catch (error) { $("#session-error").textContent = error.message; }
});
$("#reviewer-id").value = localStorage.getItem("reviewer-id") || "";
$("#section-nav").addEventListener("click", event => { const button=event.target.closest("button[data-kind]"); if(button){app.kind=button.dataset.kind; render();} });
$("#previous").addEventListener("click", () => { app.indexes[app.kind]--; render(); });
$("#next").addEventListener("click", () => {
  const items = app.data.items[app.kind];
  const current = app.indexes[app.kind];
  app.indexes[app.kind] = current < items.length - 1 ? current + 1 : pendingIndex(items, current);
  render();
});
