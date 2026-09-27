import { useEffect, useState } from "react";
import { QUESTION_TYPE_LABEL } from "../../utils/studyApi";
import {
  DIFFICULTY_OPTIONS,
  QUESTION_COUNT_MAX,
  QUESTION_COUNT_MIN,
  QUESTION_COUNT_PRESETS,
  QUESTION_TYPES,
} from "../../utils/questionBuilderConfig";

const clampCount = (n, min, max) => Math.min(max, Math.max(min, n));

export function QuestionCountControl({
  value, onChange,
  presets = QUESTION_COUNT_PRESETS, min = QUESTION_COUNT_MIN, max = QUESTION_COUNT_MAX,
}) {
  const isPreset = presets.includes(value);
  const [draft, setDraft] = useState(isPreset ? "" : String(value));

  // Selecting a preset pill clears any stale custom draft text so the input
  // doesn't silently keep an old value the pill click just overrode.
  useEffect(() => { if (isPreset) setDraft(""); }, [isPreset, value]);

  // Must never leave `draft` (the input's own displayed value) holding a
  // number outside [min, max]: an <input type="number" max="50"> whose DOM
  // value is "500" fails native constraint validation, which silently blocks
  // the surrounding <form>'s submit entirely -- no error, no callback, the
  // button just does nothing. Only the empty/mid-edit (non-numeric) case is
  // shown unclamped, since "" isn't a constraint violation.
  const commit = (raw) => {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) { setDraft(raw); return; }
    const clamped = clampCount(n, min, max);
    setDraft(String(clamped));
    onChange(clamped);
  };

  return (
    <div className="flex flex-wrap gap-2 items-center">
      {presets.map((n) => (
        <button key={n} type="button"
          className={`pill-tab ${isPreset && value === n ? "pill-tab-active" : ""}`}
          onClick={() => onChange(n)}>{n} câu</button>
      ))}
      <label className={`cursor-pointer pill-tab inline-flex items-center gap-1.5 ${!isPreset ? "pill-tab-active" : ""}`}>
        Tuỳ chỉnh
        <input type="number" inputMode="numeric" min={min} max={max}
          value={draft}
          placeholder={String(value)}
          onChange={(e) => commit(e.target.value)}
          onBlur={() => { if (!draft) setDraft(String(value)); }}
          onClick={(e) => e.stopPropagation()}
          className="w-12 bg-transparent text-center outline-none" />
      </label>
    </div>
  );
}

export function DifficultyControl({ value, onChange, options = DIFFICULTY_OPTIONS }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(([v, label]) => (
        <button key={v} type="button"
          className={`pill-tab ${value === v ? "pill-tab-active" : ""}`}
          onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  );
}

export function QuestionTypeControl({ value, onChange, types = QUESTION_TYPES }) {
  const toggle = (t) =>
    onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t]);
  return (
    <div className="flex flex-wrap gap-2">
      {types.map((t) => (
        <button key={t} type="button"
          className={`pill-tab ${value.includes(t) ? "pill-tab-active" : ""}`}
          onClick={() => toggle(t)}>{QUESTION_TYPE_LABEL[t] || t}</button>
      ))}
    </div>
  );
}

const DIFFICULTY_LABEL = Object.fromEntries(DIFFICULTY_OPTIONS);

/** Compact pre-submit summary — lets the learner verify intent before spending an LLM job. */
export function QuestionBuilderSummary({ count, difficulty, types, scopeLabel }) {
  const typesLabel = types.length
    ? types.map((t) => QUESTION_TYPE_LABEL[t] || t).join(", ")
    : "Chưa chọn dạng câu hỏi";
  return (
    <div className="surface-card !p-3.5 flex flex-col gap-1 font-mono text-caption text-text-secondary">
      <span>{count} câu · {scopeLabel}</span>
      <span>{typesLabel}</span>
      <span>Độ khó: {DIFFICULTY_LABEL[difficulty] || difficulty}</span>
    </div>
  );
}
