// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DifficultyControl,
  QuestionBuilderSummary,
  QuestionCountControl,
  QuestionTypeControl,
} from "./QuestionBuilder";

let container;
let root;
afterEach(() => {
  if (root) act(() => root.unmount());
  if (container) container.remove();
  container = null; root = null;
});

function render(el) {
  container = document.createElement("div"); document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(el));
}

const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
// React tracks the last value it set on a controlled input; assigning
// `.value` directly bypasses that tracker and React's onChange never fires.
// Going through the native setter first is the standard workaround.
function typeInto(input, text) {
  nativeInputValueSetter.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("QuestionCountControl", () => {
  it("clicking a preset reports that exact value", () => {
    const onChange = vi.fn();
    render(<QuestionCountControl value={10} onChange={onChange} />);
    const btn = [...container.querySelectorAll("button")].find((b) => b.textContent === "15 câu");
    act(() => btn.click());
    expect(onChange).toHaveBeenCalledWith(15);
  });

  it("clamps a custom value above the max down to max, and clamps the DISPLAYED value too", () => {
    // Regression: an earlier version clamped the value passed to onChange
    // but left the input's own displayed value at the raw "999" -- an
    // <input type="number" max="50"> showing "999" fails native constraint
    // validation, which silently blocks the surrounding <form>'s submit
    // with no error and no callback at all.
    const onChange = vi.fn();
    render(<QuestionCountControl value={10} onChange={onChange} max={50} />);
    const input = container.querySelector('input[type="number"]');
    act(() => typeInto(input, "999"));
    expect(onChange).toHaveBeenLastCalledWith(50);
    expect(input.value).toBe("50");
    expect(input.checkValidity()).toBe(true);
  });

  it("clamps a custom value below the min up to min, and clamps the DISPLAYED value too", () => {
    const onChange = vi.fn();
    render(<QuestionCountControl value={10} onChange={onChange} min={1} />);
    const input = container.querySelector('input[type="number"]');
    act(() => typeInto(input, "0"));
    expect(onChange).toHaveBeenLastCalledWith(1);
    expect(input.value).toBe("1");
    expect(input.checkValidity()).toBe(true);
  });

  it("accepts a mid-range custom value unclamped", () => {
    const onChange = vi.fn();
    render(<QuestionCountControl value={10} onChange={onChange} />);
    const input = container.querySelector('input[type="number"]');
    act(() => typeInto(input, "12"));
    expect(onChange).toHaveBeenLastCalledWith(12);
  });

  it("highlights the preset pill, not the custom field, when value is a preset", () => {
    render(<QuestionCountControl value={10} onChange={() => {}} />);
    const preset10 = [...container.querySelectorAll("button")].find((b) => b.textContent === "10 câu");
    expect(preset10.className).toContain("pill-tab-active");
    const customLabel = container.querySelector("label");
    expect(customLabel.className).not.toContain("pill-tab-active");
  });
});

describe("DifficultyControl", () => {
  it("reports the clicked difficulty value", () => {
    const onChange = vi.fn();
    render(<DifficultyControl value="mixed" onChange={onChange} />);
    const btn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Khó");
    act(() => btn.click());
    expect(onChange).toHaveBeenCalledWith("hard");
  });
});

describe("QuestionTypeControl", () => {
  it("toggles a type into the selection", () => {
    const onChange = vi.fn();
    render(<QuestionTypeControl value={["multiple_choice"]} onChange={onChange} />);
    const btn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Đúng / Sai");
    act(() => btn.click());
    expect(onChange).toHaveBeenCalledWith(["multiple_choice", "true_false"]);
  });

  it("toggles a selected type back out", () => {
    const onChange = vi.fn();
    render(<QuestionTypeControl value={["multiple_choice", "true_false"]} onChange={onChange} />);
    const btn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Trắc nghiệm");
    act(() => btn.click());
    expect(onChange).toHaveBeenCalledWith(["true_false"]);
  });
});

describe("QuestionBuilderSummary", () => {
  it("renders count, scope, types, and difficulty", () => {
    render(<QuestionBuilderSummary count={12} difficulty="hard" types={["multiple_choice", "true_false"]} scopeLabel="Toàn bộ tài liệu" />);
    expect(container.textContent).toContain("12 câu · Toàn bộ tài liệu");
    expect(container.textContent).toContain("Trắc nghiệm, Đúng / Sai");
    expect(container.textContent).toContain("Độ khó: Khó");
  });

  it("flags an empty type selection instead of rendering a blank line", () => {
    render(<QuestionBuilderSummary count={5} difficulty="easy" types={[]} scopeLabel="Toàn bộ tài liệu" />);
    expect(container.textContent).toContain("Chưa chọn dạng câu hỏi");
  });
});
