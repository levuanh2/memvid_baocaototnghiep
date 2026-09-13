import { Component } from "react";
import { Icon } from "./Icon";

/**
 * Lưới an toàn cuối cùng (Phase 6, Step 8) — chưa từng có ở đâu trong app này
 * trước Phase 6 (rà toàn bộ `src/`, không một `componentDidCatch` nào). Một
 * lỗi render bất kỳ, ở bất kỳ trang nào, trước đây làm TRẮNG TOÀN BỘ MÀN HÌNH —
 * không thông báo, không lối ra, người dùng chỉ còn cách tự đoán bấm F5.
 *
 * Class component vì React CHỈ hỗ trợ bắt lỗi render qua
 * `getDerivedStateFromError`/`componentDidCatch` — chưa có hook tương đương.
 * Bọc TOÀN ứng dụng (main.jsx) — không bọc riêng từng trang: mục tiêu là
 * "không bao giờ trắng màn hình", không phải cô lập lỗi theo khu vực (việc đó
 * cần nhiều boundary hơn, một thay đổi kiến trúc lớn hơn phạm vi phase này).
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { loi: null };
  }

  static getDerivedStateFromError(loi) {
    return { loi };
  }

  componentDidCatch(loi, info) {
    // Chưa có dịch vụ theo dõi lỗi nào được nối (Sentry, v.v.) — Step 8 cấm
    // thêm hạ tầng mới, nên đây là CẢI THIỆN TRONG GIỚI HẠN ĐÃ CÓ: một dòng
    // console rõ ràng, dễ tìm, thay vì im lặng hoàn toàn như trước.
    console.error("[ErrorBoundary] Lỗi render chưa bắt được:", loi, info?.componentStack);
  }

  render() {
    if (!this.state.loi) return this.props.children;
    return (
      <div className="h-screen flex items-center justify-center px-5"
        style={{ background: "var(--bg-base)" }}>
        <div className="surface-card max-w-[420px] text-center">
          <Icon name="AlertCircle" size={28} className="mx-auto mb-3" style={{ color: "var(--err)" }} />
          <h1 className="font-display text-h2 font-semibold text-text-primary mb-2">
            Có lỗi xảy ra
          </h1>
          <p className="text-body text-text-secondary mb-5">
            Trang gặp một lỗi không mong muốn. Dữ liệu đã lưu không bị mất —
            tải lại trang để tiếp tục.
          </p>
          <button type="button" className="btn-seal inline-flex items-center gap-2"
            onClick={() => window.location.reload()}>
            <Icon name="RotateCcw" size={15} /> Tải lại trang
          </button>
        </div>
      </div>
    );
  }
}
