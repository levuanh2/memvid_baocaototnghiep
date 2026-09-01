# Huỷ thật cho job `query`, và những việc còn treo sau audit vòng 8

> **Cho người thực thi:** dùng `superpowers:executing-plans`. Mỗi bước có checkbox.

**Trạng thái:** Task 1-4 ĐÃ LÀM XONG 2026-09-01. Ba mục "ngoài phạm vi" ở cuối cũng đã đóng (rerank đo + nâng hạn, NLI đổi model, ablation dùng số R1 sẵn có + thêm hàng rào sức khoẻ index).

**Mục tiêu:** bấm "Huỷ" trong chat thì job dừng thật và nhả slot LLM, thay vì chỉ ngừng
hiển thị phía trình duyệt.

**Cách tiếp cận:** graph đọc cờ huỷ giữa các node (đúng khuôn `run_quiz_generation_job`
đã làm ở vòng 8), rồi mới thêm `"query"` vào `_CANCELLABLE_JOB_TYPES` — đúng thứ tự mà
comment `main.py:3509` đã ghi. FE gọi route huỷ thật thay cho lời hứa suông.

**Ngăn xếp:** Flask + LangGraph 0.2.x + jobs_store (SQLite) / React 19 + Vite + Vitest.

**Nguồn:** `.playbook/known-issues.md` mục "Mười ba chỗ giao diện còn lại" (FE#12) và
"Ba cách job quiz kẹt" (BE#9, cùng lớp lỗi, đã sửa cho quiz).

## Ràng buộc chung

- **Trần vật lý:** không cắt được một request HTTP đang chạy tới Ollama. Huỷ chỉ tới
  được ở ranh giới node. Worst case = thời lượng của node đang chạy, thường là
  `GenerateAnswer` (`AI_TIMEOUT_SEC=180`). Nói ra, đừng hứa nhiều hơn.
- **Thứ tự bắt buộc** (comment `main.py:3509`): executor phải thật sự gọi
  `is_cancel_requested` TRƯỚC, rồi mới thêm job_type vào `_CANCELLABLE_JOB_TYPES`. Làm
  ngược lại là dựng lại đúng lỗi known-issues 2026-07-17 ("Đang huỷ… 36% mãi").
- Máy có **1 slot LLM** (`MAX_CONCURRENT_LLM_CALLS=1`) — đó là toàn bộ lý do việc này
  đáng làm: job zombie giữ slot làm câu hỏi tiếp theo phải chờ.
- Mốc hiện tại phải giữ: BE **1000 passed / 4 skipped**, FE **230 passed**, lint **70**.

---

### Task 1: Graph đọc cờ huỷ giữa các node

**Vấn đề:** `query_graph.py` không gọi `is_cancel_requested` ở bất kỳ đâu (kiểm:
`grep -rn "is_cancel_requested" BE/app/graphs/` ra rỗng).

**Files:**
- Modify: `BE/app/graphs/query_graph.py` (`build_query_graph` — thêm tham số; bọc node)
- Modify: `BE/app/wiring.py`, `BE/app/main.py` (điểm nối)
- Test: `BE/tests/test_query_cancel.py` (tạo mới)

**Interfaces:**
- Produces: `build_query_graph(..., da_huy: Callable[[str], bool] | None = None)`.
- Node bị huỷ trả về state có `{"done": True, "cancelled": True, "status_code": 499,
  "payload": {"answer": None, "cancelled": True}}` — cùng hình dạng nhánh dừng sớm mà
  `retrieve_faiss_node` đã dùng khi không có chunk nào.

- [x] **Bước 1: viết test đỏ**

```python
"""Huỷ phải tới được graph, không chỉ tới trình duyệt."""
from tests._qg_build import build_test_graph   # helper sẵn có


def test_graph_dung_lai_o_node_ke_tiep_khi_da_huy():
    goi = []

    def _da_huy(job_id):
        goi.append(job_id)
        return len(goi) >= 2          # node đầu chạy, node sau bị chặn

    g = build_test_graph(da_huy=_da_huy)
    out = g.invoke({"job_id": "j1", "q": "câu hỏi", "selected_sources": []})
    assert out.get("cancelled") is True
    assert out.get("done") is True


def test_khong_huy_thi_graph_chay_binh_thuong():
    g = build_test_graph(da_huy=lambda _jid: False)
    out = g.invoke({"job_id": "j1", "q": "câu hỏi", "selected_sources": []})
    assert not out.get("cancelled")


def test_khong_truyen_da_huy_thi_hanh_vi_y_nhu_cu():
    g = build_test_graph()
    out = g.invoke({"job_id": "j1", "q": "câu hỏi", "selected_sources": []})
    assert not out.get("cancelled")
```

- [x] **Bước 2: chạy, phải đỏ**

`./.venv/Scripts/python.exe -m pytest tests/test_query_cancel.py -q`
Kỳ vọng: FAIL — `build_test_graph()` chưa nhận `da_huy`.

- [x] **Bước 3: thêm bọc huỷ trong `build_query_graph`**

```python
def _boc_huy(ten: str, fn):
    """Đọc cờ huỷ TRƯỚC khi chạy node.

    Huỷ chỉ tới được ở ranh giới node: node đang chạy là một lời gọi HTTP tới
    Ollama, Python không cắt ngang được. Worst case = thời lượng node đó.
    """
    def _chay(state: dict) -> dict:
        if da_huy is not None and state.get("job_id") and da_huy(state["job_id"]):
            log_node_event(state["job_id"], ten, "cancelled", 0.0, {})
            return {**state, "cancelled": True, "done": True, "status_code": 499,
                    "payload": {"answer": None, "cancelled": True},
                    "current_node": ten}
        return fn(state)
    return _chay
```

Rồi đổi mọi `g.add_node("X", x_node)` thành `g.add_node("X", _boc_huy("X", x_node))`.

- [x] **Bước 4: nối dây qua `wiring.py` và `main.py`**

`main.py`, cạnh chỗ dựng graph:

```python
def _query_da_huy(job_id: str) -> bool:
    try:
        from app.domains.jobs.jobs_store import is_cancel_requested
        return bool(is_cancel_requested(job_id))
    except Exception:
        return False      # đọc cờ hỏng thì chạy tiếp, đừng giết job đang chạy tốt
```

Truyền `da_huy=_query_da_huy` xuống `build_query_graph` qua `wiring.py`.

- [x] **Bước 5: chạy test, phải xanh; chạy cả `tests/test_query.py tests/test_crag_graph.py tests/test_hitl_graph.py`**

- [x] **Bước 6: commit**

---

### Task 2: Job runner ghi trạng thái `cancelled`, không phải `error`

**Vấn đề:** đúng bẫy vừa gặp ở quiz vòng 8 — nhánh lỗi đọc trước cờ huỷ nên "Đã huỷ"
hiện thành "Thất bại".

**Files:**
- Modify: `BE/app/main.py` (`process_query_job`, phần finalize)
- Test: `BE/tests/test_query_cancel.py` (thêm ca)

- [x] **Bước 1: viết test đỏ**

```python
def test_job_bi_huy_ghi_status_cancelled_khong_phai_error(be, client, monkeypatch, owner):
    """Người dùng bấm dừng thì màn hình không được đổ lỗi cho hệ thống."""
    # monkeypatch is_cancel_requested → True từ lần gọi thứ hai, chạy job inline,
    # rồi đọc /query-status/<job_id>
    ...
    assert job["status"] == "cancelled"
    assert not job.get("error")
```

- [x] **Bước 2: chạy, phải đỏ**

- [x] **Bước 3: sửa `process_query_job`** — sau khi graph trả về, đọc `out.get("cancelled")`
      **TRƯỚC** mọi nhánh lỗi:

```python
        if out.get("cancelled"):
            _jobs_update_job(jid, status="cancelled", progress=0, current_node="Cancelled")
            return
```

- [x] **Bước 4: chạy test + `tests/test_query.py`, phải xanh**

- [x] **Bước 5: commit**

---

### Task 3: Mở cổng huỷ và cho FE gọi nó

**Chỉ làm sau khi Task 1 và 2 xanh** — đây đúng là thứ comment `main.py:3509` cấm làm
sớm.

**Files:**
- Modify: `BE/app/main.py` (`_CANCELLABLE_JOB_TYPES`)
- Modify: `FE/src/components/Layout/ChatArea.jsx` (`handleCancel`)
- Test: `BE/tests/test_query_cancel.py`, `FE` — không có test component, dựa vào build

- [x] **Bước 1: viết test đỏ**

```python
def test_route_huy_chap_nhan_job_query(be, client, monkeypatch, owner):
    # tạo job type "query" trong jobs_store rồi POST /api/jobs/<id>/cancel
    assert r.status_code == 200 and r.get_json()["cancel_requested"] is True
```

- [x] **Bước 2: chạy, phải đỏ** (409 "không hỗ trợ huỷ giữa chừng")

- [x] **Bước 3: thêm `"query"` vào `_CANCELLABLE_JOB_TYPES`, sửa comment cho khớp**

- [x] **Bước 4: FE gọi route thật**

```jsx
  const handleCancel = async () => {
    if (pendingReview) return;
    cancelledRef.current = true;
    abortControllerRef.current?.abort();
    try { eventSourceRef.current?.close(); } catch {}
    resetJobState(); setLoading(false);
    setMessages((prev) => [...prev, { role: "cancelled", content: "Đang dừng truy vấn…" }]);
    try {
      await cancelJob(jobIdRef.current);
      setMessages((prev) => [...prev.slice(0, -1),
        { role: "cancelled", content: "Đã dừng truy vấn." }]);
    } catch {
      // Route từ chối hoặc mất mạng: giữ đúng lời của bản vòng 8, đừng hứa thêm.
      setMessages((prev) => [...prev.slice(0, -1), { role: "cancelled",
        content: "Đã ngừng chờ câu trả lời. Máy chủ vẫn chạy nốt truy vấn này." }]);
    }
  };
```

`slice(0, -1)` ở đây là **an toàn** vì nó xoá đúng dòng "Đang dừng truy vấn…" mà chính
hàm này vừa thêm — khác hẳn bản cũ (xoá câu hỏi của người dùng).

- [x] **Bước 5: `npm run build` + `npx vitest run` + `npx eslint src`; so mốc 230/70**

- [x] **Bước 6: chạy toàn bộ BE suite, so mốc 1000 passed / 4 skipped**

- [x] **Bước 7: commit**

---

### Task 4: Ghi lại vào .playbook

- [x] `known-issues.md`: chuyển FE#12 từ "trần còn lại" sang đã sửa, ghi rõ trần MỚI
      (huỷ tới được ở ranh giới node, không cắt được node đang chạy).
- [x] `lessons-learned.md`: một bài học — "đăng ký huỷ được và thật sự huỷ được là hai
      việc; thứ tự đúng là executor đọc cờ trước, mở cổng sau".
- [x] Commit.

---

## Ngoài phạm vi plan này — cần bạn quyết

Ba mục còn treo trong `.playbook` không tự lên plan được, vì chúng cần một quyết định
chứ không cần một bản vá.

**1. `(CẦN ĐỂ Ý) Hạn rerank 10s sát mép`** — đây là việc ĐO, không phải việc sửa. Cần một
lần chạy đo p95 thời gian rerank trên chunk dài thật của bạn, rồi mới biết nên nâng hạn
hay giảm `RERANK_CANDIDATE_K`. Tôi làm được nếu bạn muốn, nhưng nó tốn một lượt chạy dài.

**2. `(CHƯA SỬA) NLI mDeBERTa chậm ~250 lần dự toán và chưa từng bắt được mâu thuẫn
nào`** — hai đường, khác nhau về ý định chứ không về kỹ thuật: tắt hẳn tầng NLI (nhanh
lại, mất một mục trong báo cáo), hoặc giữ và đổi model nhẹ hơn (giữ mục, tốn thời gian
hiệu chỉnh). Đây là quyết định về **nội dung báo cáo tốt nghiệp**, không phải về mã.

**3. Hai mục `(CHẶN)` của ablation E0–E7** — canonical extraction đã lệch, và late
chunking mean-pool trong khi bge-m3 dùng CLS. Playbook đã ghi "CẦN NGƯỜI QUYẾT" từ
2026-08-25. Sửa chúng nghĩa là chạy lại toàn bộ ablation; đó là nhiều giờ máy và ảnh
hưởng thẳng tới số liệu trong báo cáo. Nói rõ bạn muốn giữ số cũ hay chạy lại thì tôi
mới bắt đầu.
