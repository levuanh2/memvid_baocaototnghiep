import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import AuthFrame from "./AuthFrame";

// V9.3 P2c onboarding PREVIEW (docs/StudyMap-V9.3/04 "Onboarding"; owner D3).
// Three steps: goal, pace, how to start. Choices live in this component's state only:
// no profile write, no schedule, no reminder, no notification permission, no storage.
// Never in the sign-in path: reached from the landing page, skippable on every step.
// ponytail: no persistence until a backend contract exists (separate PR, D3).
const GOALS = ["Hiểu sâu một môn", "Ôn thi", "Đọc nghiên cứu", "Sắp xếp việc học"];
const PACES = ["15 phút", "25 phút", "45 phút", "Linh hoạt"];

function Choice({ name, options, value, onChange }) {
  return (
    <div className="onb-choices">
      {options.map((o) => (
        <label key={o} className="onb-choice">
          <input type="radio" name={name} value={o} checked={value === o} onChange={() => onChange(o)} />
          {o}
        </label>
      ))}
    </div>
  );
}

export default function Onboarding() {
  const [step, setStep] = useState(1);
  const [goal, setGoal] = useState(null);
  const [pace, setPace] = useState(null);
  const headingRef = useRef(null);
  const firstRender = useRef(true);

  // A new step moves focus to its heading (docs 03), but not on first load.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    headingRef.current?.focus();
  }, [step]);

  return (
    <AuthFrame title="Bắt đầu với StudyMap" lede="Ba bước ngắn để thử cách StudyMap đưa bạn vào việc học.">
      <p className="onb-preview-note" role="note">
        <strong>Bản xem trước.</strong> Lựa chọn ở đây không lưu vào tài khoản, không tạo lịch học
        hay nhắc nhở. Bạn có thể bỏ qua bất cứ lúc nào.
      </p>

      <section className="onb-step" data-onboarding-step={step} aria-labelledby="onb-heading">
        <p className="onb-progress">Bước {step}/3</p>
        {step === 1 && (
          <>
            <h2 id="onb-heading" ref={headingRef} tabIndex={-1}>Bạn muốn dùng StudyMap để làm gì?</h2>
            <Choice name="onb-goal" options={GOALS} value={goal} onChange={setGoal} />
          </>
        )}
        {step === 2 && (
          <>
            <h2 id="onb-heading" ref={headingRef} tabIndex={-1}>Mỗi lần học, bạn muốn ngồi bao lâu?</h2>
            <Choice name="onb-pace" options={PACES} value={pace} onChange={setPace} />
            <p className="onb-help">Chỉ để thử giao diện. StudyMap chưa tạo lịch hay nhắc học từ lựa chọn này.</p>
          </>
        )}
        {step === 3 && (
          <>
            <h2 id="onb-heading" ref={headingRef} tabIndex={-1}>Bắt đầu từ đây</h2>
            {(goal || pace) && (
              <p className="onb-help">
                Bạn đã chọn{goal ? ` mục tiêu “${goal}”` : ""}{goal && pace ? " và" : ""}{pace ? ` nhịp ${pace}` : ""}.
                Lựa chọn này chưa được lưu.
              </p>
            )}
            <ol className="onb-start">
              <li>
                <strong>Tải tài liệu lên</strong> thư viện: bài giảng hay giáo trình bạn đang học.
                <Link to="/app/study">Mở thư viện</Link>
              </li>
              <li>
                <strong>Chọn tài liệu làm nguồn</strong> và đặt câu hỏi; bấm số trích dẫn để đọc đoạn gốc.
                <Link to="/app">Vào không gian học</Link>
              </li>
              <li>
                <strong>Làm quiz</strong> để biết phần nào cần ôn.
                <Link to="/app/study/quiz/new">Tạo quiz</Link>
              </li>
            </ol>
          </>
        )}
      </section>

      <div className="onb-actions">
        {step > 1 && <button type="button" className="btn-secondary" onClick={() => setStep(step - 1)}>Quay lại</button>}
        {step < 3 && <button type="button" className="btn-seal" onClick={() => setStep(step + 1)}>Tiếp tục</button>}
        <Link to="/app" className="onb-skip">Bỏ qua</Link>
      </div>
    </AuthFrame>
  );
}
