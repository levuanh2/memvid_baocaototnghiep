import { TASK_VIEW } from "../../utils/libraryActionMatrix";

const VIEWS = [
  [TASK_VIEW.ALL, "Tất cả"],
  [TASK_VIEW.CONTINUE, "Tiếp tục học"],
  [TASK_VIEW.NEEDS_QUIZ, "Cần quiz"],
  [TASK_VIEW.NEEDS_SUMMARY, "Cần tóm tắt"],
];

export default function LibraryTaskViews({ value, counts, onChange }) {
  return (
    <div className="library-task-views" aria-label="Mục tiêu học tập">
      {VIEWS.map(([key, label]) => (
        <button
          key={key}
          type="button"
          data-task-view={key}
          aria-pressed={value === key}
          className="library-task-view"
          onClick={() => onChange(key)}
        >
          <span>{label}</span>
          <strong>{counts?.[key] ?? 0}</strong>
        </button>
      ))}
    </div>
  );
}
