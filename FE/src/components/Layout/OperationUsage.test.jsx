import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import OperationUsage from "./OperationUsage";

const draw = (usage) => renderToStaticMarkup(<OperationUsage usage={usage} />);

describe("OperationUsage", () => {
  it("shows actual totals and safe input/output details", () => {
    const html = draw({ total_tokens: 1284, input_tokens: 1000, output_tokens: 284, latency_ms: 4200, usage_source: "provider" });
    expect(html).toMatch(/1\.284 token · 4,2 giây/);
    expect(html).toMatch(/title="Đầu vào: 1\.000 · Đầu ra: 284"/);
  });

  it("labels estimates and cache hits without presenting a new charge", () => {
    expect(draw({ total_tokens: 42, estimated: true })).toMatch(/Ước tính · 42 token/);
    expect(draw({ total_tokens: 0, cache_hit: true })).toMatch(/không tính thêm token/);
  });
});
