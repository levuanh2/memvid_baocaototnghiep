# A3 MindMap and Export Studio — Live UX Inventory

Phạm vi LIVE được lần theo từ `FE/src/App.jsx:64,74`:
1. Tuyến đường chuyên biệt StudyMap `/app/study/map/:documentId` → `pages/study/StudyMapView.jsx` (cây khái niệm D3-tree SVG, phân tầng tài liệu, trích dẫn neo).
2. Không gian làm việc Workspace `/app?tab=mindmap` → `Workspace.jsx` → `MainLayout.jsx` → `WorkspaceContainer.jsx` → `components/mindmap/MindElixirView.jsx` (sơ đồ tư duy tương tác canvas Mind-Elixir, Export Studio, Appearance Drawer, Knowledge Inspector).

Breakpoints và đáp ứng giao diện:
- Canvas thu phóng/neo: hẹp `<500px` tự động co tỷ lệ tối thiểu `MOBILE_SCALE_MIN=0.65`, mobile `<640px` áp sàn đọc `MOBILE_READABLE_MIN_SCALE=0.75`, desktop/tablet `≥500px` giữ mặc định 0.8 / 1.0 (`StudyMapView.jsx:318`, `MindElixirView.jsx:50-60`).
- Mobile `<768px`: thanh ngữ cảnh nguồn/bằng chứng thu gọn dạng drawer/bottom-sheet; touch target 22px ẩn được kích hoạt trên canvas SVG (`StudyMapView.jsx:93,452`).
- Desktop `≥1280px`: Knowledge Inspector gắn cố định cột phải; tablet/desktop `768–1279px` hiển thị dạng floating drawer/shelf khi mở node.

Feature flag ghi nhận:
- `VITE_LIBRARY_ACTION_MATRIX`: Tại `/app/study` (`DocumentList.jsx`), cờ này kiểm soát hiển thị ma trận hành động tài liệu (`StudyDocumentActionRow.jsx`) hoặc danh sách thẻ cũ (`StudyCard.jsx`). Cả hai trạng thái cờ đều dẫn tới hai mặt sơ đồ: "Bản đồ học tập" (StudyMapView) và "Sơ đồ tư duy" (Workspace MindElixirView).
- `guided_mindmap_v3`: Cờ năng lực phía máy chủ (`GET /mindmaps/capability`). Khi `enabled`, mở `GuidedMindmapDialog` (hỏi mục đích, độ chi tiết, chủ đề); khi `disabled` hoặc `error`, chạy luồng sinh cũ V2 (fail-closed, không bao giờ treo).

---

## Bảng kiểm kê hành động người dùng (Live Actions)

| screen/route | component file:line | visible label (exact Vietnamese text or aria-label) | position (header/toolbar/menu/card/drawer/dialog; desktop vs mobile breakpoint) | handler / callback | navigation target or API call | user goal | condition (flag/state/viewport/empty) |
|---|---|---|---|---|---|---|---|
| StudyMap `/app/study/map/:documentId` | `pages/study/StudyMapView.jsx:539` | `Về nguồn` | header action button | React Router `Link` | `/app?source=<stem>&tab=mindmap&right=timeline` | quay lại Workspace với tab sơ đồ và dòng thời gian đã mở sẵn | LIVE; chỉ khi tài liệu có `doc.source_stem` |
| StudyMap `/app/study/map/:documentId` | `pages/study/StudyMapView.jsx:549` | `Dựng lại` | header action button | `build({ force: true })` | API `POST /api/study/map` với `force=true` | tái tạo toàn bộ cây khái niệm bỏ qua bộ nhớ đệm | LIVE; khi đã có sơ đồ (`map !== null`), disabled khi đang dựng |
| StudyMap `/app/study/map/:documentId` | `pages/study/StudyMapView.jsx:563` | `Huỷ` | job progress banner | `job.cancel` | API `DELETE /api/study/jobs/:id` | dừng tiến trình dựng sơ đồ đang chạy ngầm | khi có job đang chạy (`job.running === true`) |
| StudyMap `/app/study/map/:documentId` | `pages/study/StudyMapView.jsx:579` | `Đóng` | job error banner | `job.reset` | local state | đóng thông báo lỗi tiến trình dựng | khi job gặp lỗi (`job.error !== null`) |
| StudyMap `/app/study/map/:documentId` | `pages/study/StudyMapView.jsx:587` | `Đóng` | export error banner | `setLoiXuat(null)` | local state | đóng thông báo lỗi xuất ảnh | khi xuất ảnh lỗi (`loiXuat !== null`) |
| StudyMap `/app/study/map/:documentId` | `pages/study/StudyMapView.jsx:598` | `Kiểm tra lại` | empty state card | `load()` | API `GET /api/documents/:id`, `GET /api/study/maps` | làm mới kiểm tra tiến trình đang chạy từ phiên khác | khi sơ đồ đang được dựng ngầm (`!map && dangDung`) |
| StudyMap `/app/study/map/:documentId` | `pages/study/StudyMapView.jsx:614` | `Dựng sơ đồ kiến thức` / `Đang bắt đầu…` | empty state card CTA | `build()` | API `POST /api/study/map` | bắt đầu đọc tài liệu và dựng cây khái niệm | khi tài liệu chưa từng dựng sơ đồ (`!map && !job.running`) |
| StudyMap `/app/study/map/:documentId` | `pages/study/StudyMapView.jsx:448,452` | Tiêu đề node (SVG text, ví dụ gốc/chương/khái niệm/ví dụ) | canvas SVG node element; touch target 22px ẩn hiện trên `<768px` | `onPick` | `selectNode(node_id)` qua StudyContext; local `setSelected`, `setFocusedId` | xem chi tiết khái niệm ở cột phải, làm nổi bật nhánh và bung/thu nhánh con | khi có sơ đồ; click root node lần đầu triệt tiêu hiệu ứng mời gọi (Spark Effect) |
| StudyMap `/app/study/map/:documentId` | `pages/study/StudyMapView.jsx:660` | `Thu nhỏ` (title: `Thu nhỏ (−)`) | canvas zoom toolbar | `zoomBy(-ZOOM_STEP)` | local zoom state | thu nhỏ tỷ lệ cây D3 | khi có sơ đồ; không trong chế độ trình chiếu |
| StudyMap `/app/study/map/:documentId` | `pages/study/StudyMapView.jsx:666` | `Đặt lại thu phóng` (title: `Đặt lại thu phóng (0)`) | canvas zoom toolbar; hiển thị `%` thu phóng thực tế | `zoomReset()` | local zoom state (`0.8`) | đưa độ phóng về tỷ lệ chuẩn mặc định | khi có sơ đồ; không trong chế độ trình chiếu |
| StudyMap `/app/study/map/:documentId` | `pages/study/StudyMapView.jsx:671` | `Phóng to` (title: `Phóng to (+)`) | canvas zoom toolbar | `zoomBy(ZOOM_STEP)` | local zoom state | phóng to tỷ lệ cây D3 | khi có sơ đồ; không trong chế độ trình chiếu |
| StudyMap `/app/study/map/:documentId` | `pages/study/StudyMapView.jsx:678` | `Bỏ focus` | canvas toolbar | `boFocus()` | local `focusedId = null` | bỏ làm mờ các nhánh không liên quan | chỉ hiện khi đang focus một node (`focusedId !== null`) |
| StudyMap `/app/study/map/:documentId` | `pages/study/StudyMapView.jsx:691` | `Tìm trong sơ đồ kiến thức` (placeholder: `Tìm theo tên khái niệm…`) | canvas toolbar input | `onChange`, `onKeyDown` (`xuLyPhimTim`) | lọc client-side; phím mũi tên duyệt kết quả | tìm kiếm nhanh khái niệm trong sơ đồ | khi có sơ đồ; không trong chế độ trình chiếu |
| StudyMap `/app/study/map/:documentId` | `pages/study/StudyMapView.jsx:707` | `Bố cục sơ đồ` | canvas toolbar select dropdown | `doiLayout(e.target.value)` | localStorage `docPrefs`; cập nhật hướng/dáng cây D3 | chuyển đổi bố cục (Cây ngang, Bậc ngang, Cây dọc, Bậc dọc, Thu gọn) | khi có sơ đồ; không trong chế độ trình chiếu |
| StudyMap `/app/study/map/:documentId` | `pages/study/StudyMapView.jsx:720` | `PNG` (title: `Xuất PNG (nền theo giao diện hiện tại, x2 độ phân giải)`) | canvas toolbar button | `xuatAnh("png")` | gọi client-side `exportImage` (snapdom) | tải file ảnh PNG của cây D3 hiện tại | khi có sơ đồ; disabled khi đang xuất (`dangXuat`) |
| StudyMap `/app/study/map/:documentId` | `pages/study/StudyMapView.jsx:725` | `PNG trong suốt` (title: `Xuất PNG nền trong suốt`) | canvas toolbar button | `xuatAnh("png", { transparent: true })` | gọi client-side `exportImage` (snapdom) | tải file ảnh PNG trong suốt không nền | khi có sơ đồ; disabled khi đang xuất |
| StudyMap `/app/study/map/:documentId` | `pages/study/StudyMapView.jsx:731` | `SVG` (title: `Xuất SVG`) | canvas toolbar button | `xuatAnh("svg")` | gọi client-side `exportImage` (snapdom) | tải file vector SVG sắc nét | khi có sơ đồ; disabled khi đang xuất |
| StudyMap `/app/study/map/:documentId` | `pages/study/StudyMapView.jsx:737` | `Trình chiếu` (title: `Chế độ trình chiếu (Esc để thoát)`) | canvas toolbar button | `doiTrinhChieu(true)` | localStorage `docPrefs`; mở rộng khung canvas toàn màn hình | xem sơ đồ toàn cảnh, ẩn thanh công cụ và bảng chi tiết | khi có sơ đồ; không trong chế độ trình chiếu |
| StudyMap `/app/study/map/:documentId` | `pages/study/StudyMapView.jsx:783` | `Thoát trình chiếu` (title: `Thoát trình chiếu (Esc)`) | góc trên phải canvas | `doiTrinhChieu(false)` | localStorage `docPrefs`; đóng chế độ toàn cảnh | quay lại giao diện đầy đủ có bảng bên | chỉ hiện khi đang ở chế độ trình chiếu (`trinhChieu === true`) |
| Workspace `/app` | `components/Layout/MainLayout.jsx:596` | `Sơ đồ tư duy` | header workspace mode tabs | `setWorkspaceMode("mindmap")` | local state; URL sync `?tab=mindmap` | chuyển vùng làm việc chính sang sơ đồ tư duy Mind-Elixir | LIVE, luôn bật trên mọi viewport |
| Workspace `/app?tab=mindmap` | `components/Layout/WorkspaceEmptyState.jsx:74` | `Thử lại` | empty state card | `onRetry` | chạy lại tiến trình tạo sơ đồ bị lỗi | tạo sơ đồ từ trạng thái rỗng bị thất bại | khi `kind="mindmap"` và có `jobError` |
| Workspace `/app?tab=mindmap` | `components/Layout/WorkspaceEmptyState.jsx:78,96` | `Tạo sơ đồ tư duy` | empty state card primary CTA | `onCreate` (`onMindmapAction`) | mở `GuidedMindmapDialog` (hoặc tạo trực tiếp) | tạo sơ đồ tư duy cho tài liệu đã chọn | khi chưa có dữ liệu sơ đồ (`hasMindmap === false`), disabled khi chưa chọn tài liệu |
| Workspace `/app?tab=mindmap` | `components/Layout/SidebarRight.jsx:872` | `Tạo sơ đồ` / `Đang kiểm tra tính năng…` / `Đang tạo…` | right sidebar/drawer Evidence tab | `onGenerate` (`handleGenerateMindMap`) | mở `GuidedMindmapDialog` nếu capability bật, hoặc gọi API `POST /mindmaps` | bắt đầu tạo sơ đồ từ danh sách nguồn đã chọn | tab Artifacts chọn "Sơ đồ tư duy"; disabled khi không có nguồn hoặc đang tạo |
| Workspace `/app?tab=mindmap` | `components/Layout/SidebarRight.jsx:898` | `Chờ tiếp` | right sidebar progress chip | `dismissStall` | local state | ẩn cảnh báo tiến trình lâu, tiếp tục chờ | khi poller phát hiện job bị stalled (`stallShown === true`) |
| Workspace `/app?tab=mindmap` | `components/Layout/SidebarRight.jsx:900` | `Huỷ` | right sidebar progress chip | `onCancelJob` (`handleCancelMindMap`) | API `POST /mindmaps/:id/cancel` | hủy tiến trình tạo sơ đồ ngầm | khi tiến trình đang chạy (`jobUi.running === true`) |
| Workspace `/app?tab=mindmap` | `components/Layout/SidebarRight.jsx:913` | `Thử lại` | right sidebar error chip | `handleRetry` | gọi lại `runMindmapGeneration` | thử lại tạo sơ đồ sau khi thất bại | khi tạo lỗi và không có job đang chạy (`showRetry === true`) |
| Workspace `/app?tab=mindmap` | `components/Layout/SidebarRight.jsx:929` | `Thử lại` | right sidebar saved list | `fetchMindMaps` | API `GET /mindmaps` | tải lại danh sách sơ đồ đã lưu khi bị lỗi mạng | khi danh sách sơ đồ tải lỗi (`loiTaiMindmap !== null`) |
| Workspace `/app?tab=mindmap` | `components/Layout/SidebarRight.jsx:608,621` | `Xóa` (title: `Xóa sơ đồ`) | right sidebar saved mindmap card | `handleDeleteMap` → xác nhận qua `DestructiveConfirmDialog` | API `DELETE /mindmaps/:id` | xóa vĩnh viễn một bản ghi sơ đồ đã lưu | trên mỗi thẻ sơ đồ đã lưu; yêu cầu xác nhận hộp thoại |
| Workspace `/app?tab=mindmap` | `components/Layout/SidebarRight.jsx:617` | Tên sơ đồ tư duy (thẻ danh sách đã lưu) | right sidebar saved mindmap list | click chọn bản ghi | tải bản đồ vào canvas, kích hoạt `MindElixirView` | mở sơ đồ đã lưu trước đó | danh sách có ít nhất một sơ đồ |
| Workspace `/app?tab=mindmap` | `components/Layout/GuidedMindmapDialog.jsx:70` | `Đóng` | modal dialog header | `onClose` | đóng dialog có xác thực tiêu điểm | đóng hộp thoại định hướng sơ đồ | dialog mở |
| Workspace `/app?tab=mindmap` | `components/Layout/GuidedMindmapDialog.jsx:72` | `Yêu cầu riêng (tuỳ chọn)` (placeholder: `Ví dụ: Tập trung vào quy trình triển khai...`) | modal dialog textarea | `setInstruction` | cập nhật `instruction` gửi kèm payload | chỉ định prompt định hướng riêng cho AI | dialog mở |
| Workspace `/app?tab=mindmap` | `components/Layout/GuidedMindmapDialog.jsx:73` | `Thử lại` | modal dialog topics section | `loadTopics` | API `POST /mindmaps/suggest-topics` | tải lại danh sách chủ đề gợi ý khi lỗi | khi gợi ý chủ đề thất bại (`topicError !== null`) |
| Workspace `/app?tab=mindmap` | `components/Layout/GuidedMindmapDialog.jsx:73` | Tên từng chủ đề gợi ý (button chips) | modal dialog topics section | toggle id trong `selected` | chọn/bỏ chọn chủ đề đưa vào sơ đồ | chọn các trọng tâm kiến thức mong muốn | khi đã tải xong danh sách gợi ý |
| Workspace `/app?tab=mindmap` | `components/Layout/GuidedMindmapDialog.jsx:74` | `Tổng quan`, `Khái niệm chính`, `Quy trình`, `So sánh`, `Ôn tập` | modal dialog purpose radio group | `setPurpose(id)` | cập nhật tham số `preset` trong payload | định hình cấu trúc và mục đích học tập của sơ đồ | dialog mở |
| Workspace `/app?tab=mindmap` | `components/Layout/GuidedMindmapDialog.jsx:74` | `Gọn`, `Cân bằng`, `Chi tiết` | modal dialog detail level radio group | `setDetailLevel(id)` | cập nhật tham số `detailLevel` trong payload | điều chỉnh độ sâu và số lượng node con | dialog mở |
| Workspace `/app?tab=mindmap` | `components/Layout/GuidedMindmapDialog.jsx:75` | `Tạo sơ đồ` / `Đang tạo…` | modal dialog sticky footer CTA | `submit` | API `POST /mindmaps` với `idempotencyKey` | gửi yêu cầu tạo sơ đồ có định hướng | disabled khi không có nguồn sẵn sàng hoặc đang tạo |
| Workspace `/app?tab=mindmap` | `components/mindmap/MindElixirView.jsx:1112` | `Lưu sơ đồ` (`Lưu` / `Đang lưu…`) | top identity strip (ẩn CSS) / overflow menu | `handleSave()` | API `PUT /mindmaps/:id` | lưu các thay đổi cấu trúc/vị trí node đã sửa | chỉ khi record có id thật (`!== preview`), có sửa đổi chưa lưu (`dirty === true`) |
| Workspace `/app?tab=mindmap` | `components/mindmap/MindElixirView.jsx:1126` | `Đóng thông báo lỗi` | top error alert banner | `setErrorMsg(null)` | local state | xóa thông báo lỗi lưu/xuất sơ đồ | khi có thông báo lỗi (`errorMsg !== null`) |
| Workspace `/app?tab=mindmap` | `components/mindmap/MindElixirView.jsx:1136` | `Mở thư viện sơ đồ` | toolbar map selector trigger | `setMapSelectorOpen((v) => !v)` | mở popover danh sách sơ đồ | chuyển đổi nhanh giữa các sơ đồ đã lưu | thanh công cụ sơ đồ |
| Workspace `/app?tab=mindmap` | `components/mindmap/MindElixirView.jsx:1150` | Tên từng sơ đồ trong thư viện | map selector dropdown listbox | `data.onSelectMap(map)` | nạp dữ liệu sơ đồ được chọn vào canvas | chuyển sang xem/chỉnh sửa sơ đồ khác | dropdown đang mở |
| Workspace `/app?tab=mindmap` | `components/mindmap/MindElixirView.jsx:1155` | `Tạo sơ đồ mới` / `Đang kiểm tra tính năng…` | cuối map selector dropdown | `data.onCreateNew()` | mở `GuidedMindmapDialog` | bắt đầu tạo thêm sơ đồ mới từ nguồn hiện tại | dropdown đang mở; disabled khi đang tạo |
| Workspace `/app?tab=mindmap` | `components/mindmap/MindElixirView.jsx:1169` | `Tạo lại` | toolbar context link | `onRegenerate` (`handleRegenerateMindMap`) | hỏi xác nhận nếu có sửa chưa lưu, gọi `runMindmapGeneration` | tạo lại sơ đồ bằng AI | luôn hiển thị; disabled khi đang generating |
| Workspace `/app?tab=mindmap` | `components/mindmap/MindElixirView.jsx:1179` | `Giao diện` | toolbar action button | `setAppearanceOpen(true)` | mở modal `AppearanceEditorDrawer` | tuỳ biến màu sắc, kiểu dáng node, đường nối và nền sơ đồ | luôn hiển thị trên thanh công cụ |
| Workspace `/app?tab=mindmap` | `components/mindmap/MindElixirView.jsx:1183` | `Xuất` (aria-label: `Xuất sơ đồ`) | toolbar action button | `setExportOpen(true)` | mở modal `ExportStudioDialog` | mở xưởng xuất ảnh/tài liệu đa định dạng | luôn hiển thị trên thanh công cụ |
| Workspace `/app?tab=mindmap` | `components/mindmap/MindElixirView.jsx:1188` | `Thêm tùy chọn` | toolbar overflow button | `setContextOverflowOpen((v) => !v)` | mở menu dropdown tuỳ chọn nâng cao | truy cập các chức năng khung nhìn, độ sâu và quan hệ | thanh công cụ sơ đồ |
| Workspace `/app?tab=mindmap` | `components/mindmap/MindElixirView.jsx:1194` | `Đặt lại khung nhìn` | overflow menu item | `resetView()` | gọi `mind.scale(1)`, `mind.toCenter()` | khôi phục zoom 100% và căn giữa node gốc | menu mở |
| Workspace `/app?tab=mindmap` | `components/mindmap/MindElixirView.jsx:1195` | `Căn giữa` | overflow menu item | `mindRef.current?.toCenter()` | dịch chuyển camera về vị trí node gốc giữ nguyên tỷ lệ zoom | đưa sơ đồ về trung tâm màn hình | menu mở |
| Workspace `/app?tab=mindmap` | `components/mindmap/MindElixirView.jsx:1196` | `Ẩn quan hệ` / `Hiện quan hệ` | overflow menu item | `setShowRelations((v) => !v)` | toggle CSS class `.me-hide-arrows` | bật hoặc tắt các đường mũi tên liên kết ngang | menu mở |
| Workspace `/app?tab=mindmap` | `components/mindmap/MindElixirView.jsx:1200` | `Chỉ chủ đề chính` | overflow menu item (độ sâu 0) | `applyDepthLevel(0)` | gọi `setRootOnly(mind)` | thu gọn toàn bộ chỉ giữ lại node gốc | menu mở |
| Workspace `/app?tab=mindmap` | `components/mindmap/MindElixirView.jsx:1201` | `Hiện 1 tầng nhánh` | overflow menu item (độ sâu 1) | `applyDepthLevel(1)` | mở các nhánh cấp 1, thu gọn các cấp sâu hơn | xem cấu trúc tổng quát cấp cao | menu mở |
| Workspace `/app?tab=mindmap` | `components/mindmap/MindElixirView.jsx:1202` | `Hiện 2 tầng nhánh` | overflow menu item (độ sâu 2) | `applyDepthLevel(2)` | mở các nhánh đến cấp 2 | xem cấu trúc chi tiết vừa phải | menu mở |
| Workspace `/app?tab=mindmap` | `components/mindmap/MindElixirView.jsx:1203` | `Hiện 3 tầng nhánh` | overflow menu item (độ sâu 3) | `applyDepthLevel(3)` | mở các nhánh đến cấp 3 | xem chi tiết sâu hơn | menu mở |
| Workspace `/app?tab=mindmap` | `components/mindmap/MindElixirView.jsx:1204` | `Mở toàn bộ` | overflow menu item (độ sâu all) | `applyDepthLevel("all")` | mở toàn bộ tất cả các nhánh trong cây | bung hết nội dung toàn bộ sơ đồ | menu mở |
| Workspace `/app?tab=mindmap` | `components/mindmap/MindElixirView.jsx:1209` | `Lưu sơ đồ` | overflow menu item | `handleSave()` | API `PUT /mindmaps/:id` | lưu sơ đồ từ menu | menu mở; chỉ hiện khi id thật, disabled khi chưa sửa |
| Workspace `/app?tab=mindmap` | `components/mindmap/MindElixirView.jsx:1233` | `Huỷ` | generating banner | `data.onCancel` | API `POST /mindmaps/:id/cancel` | hủy tiến trình tạo lại sơ đồ | khi đang chạy lại AI (`generating === true`) |
| Workspace `/app?tab=mindmap` | `components/mindmap/MindElixirView.jsx:1248` | `Thử lại` | failed banner | `data.onRetryJob` | gọi lại tiến trình tạo | thử lại sau khi job tạo lại bị lỗi | khi job tạo lại lỗi |
| Workspace `/app?tab=mindmap` | `components/mindmap/MindElixirView.jsx:1276` | `Thử lại` | canvas render error overlay | `retryRender` | gọi lại `initOrRefresh()` | thử dựng lại canvas khi DOM gặp sự cố kích thước | khi trạng thái render canvas lỗi (`renderState === "error"`) |
| Workspace `/app?tab=mindmap` | `components/mindmap/MindElixirView.jsx:1288` | Node trên canvas `<me-tpc>` | Mind-Elixir canvas DOM | click node | `controller.selectNode(id)` | chọn node mở Knowledge Inspector bên phải | khi click node trên canvas; click đúp để chỉnh sửa văn bản |
| Workspace `/app?tab=mindmap` | `components/mindmap/MindElixirView.jsx:1288` | Nút bung/thu nhánh con `<me-epd>` | Mind-Elixir node caret | click caret | gọi nội bộ `mind.expandNode()` | bung hoặc thu gọn các nhánh con của node | node có nhánh con |
| Workspace `/app?tab=mindmap` | `components/mindmap/MindElixirView.jsx:1309` | `Thu nhỏ` (title: `Thu nhỏ (−)`) | floating canvas toolbar góc dưới phải | `zoomBy(-ZOOM_STEP)` | gọi `mind.scale(zoom - 0.1)` | thu nhỏ khung nhìn canvas | luôn hiện trên canvas |
| Workspace `/app?tab=mindmap` | `components/mindmap/MindElixirView.jsx:1313` | `Đặt lại thu phóng` (title: `Đặt lại thu phóng (100%)`) | floating canvas toolbar; nhãn `%` | `resetZoom()` | gọi `mind.scale(1.0)` | đặt lại độ phóng đúng 100% | luôn hiện trên canvas |
| Workspace `/app?tab=mindmap` | `components/mindmap/MindElixirView.jsx:1317` | `Phóng to` (title: `Phóng to (+)`) | floating canvas toolbar | `zoomBy(+ZOOM_STEP)` | gọi `mind.scale(zoom + 0.1)` | phóng to khung nhìn canvas | luôn hiện trên canvas |
| Workspace `/app?tab=mindmap` | `components/mindmap/MindElixirView.jsx:1322` | `Vừa khung` (title: `Vừa khung (F)`) | floating canvas toolbar | `fitView()` | gọi `mind.scaleFit()` | tự động co giãn sơ đồ vừa khít khung nhìn | luôn hiện trên canvas |
| Workspace `/app?tab=mindmap` | `components/mindmap/MindElixirView.jsx:1337` | `Thu nhánh` / `Mở nhánh` | floating canvas toolbar | `toggleSelectedBranch()` | gọi `mind.expandNode()` cho node đang chọn | bung hoặc thu nhánh con của node đang chọn từ thanh công cụ | chỉ hiện khi có node được chọn VÀ node đó có con |
| Workspace `/app?tab=mindmap` | `components/mindmap/MindElixirView.jsx:1360` | `Toàn màn hình` / `Thoát toàn màn hình` | nút độc lập góc dưới phải canvas | `toggleFullscreen()` | HTML5 Fullscreen API trên wrapper `.mm-canvas-wrap` | chuyển đổi chế độ hiển thị toàn màn hình trình duyệt | luôn hiển thị |
| Workspace `/app?tab=mindmap` | `components/mindmap/MindElixirView.jsx:1381` | `Xóa chọn` | thanh chế độ chọn xuất (`mm-selection-bar`) | `setSelectedBranchIds(new Set())` | xóa sạch danh sách node đã tick | xóa toàn bộ lựa chọn xuất cụ thể | đang ở chế độ chọn node xuất và có ≥1 node đã tick |
| Workspace `/app?tab=mindmap` | `components/mindmap/MindElixirView.jsx:1384` | `Tiếp tục` | thanh chế độ chọn xuất (`mm-selection-bar`) primary | `setSelectionModeActive(false); setExportOpen(true)` | đóng chế độ chọn trên canvas, mở lại Export Studio | xác nhận danh sách node đã tick và cấu hình xuất | đang ở chế độ chọn node xuất; disabled khi chưa tick node nào |
| Workspace `/app?tab=mindmap` | `components/mindmap/MindElixirView.jsx:1386` | `Bỏ chọn và quay lại` | thanh chế độ chọn xuất (`mm-selection-bar`) | `setSelectionModeActive(false); setExportOpen(true)` | hủy danh sách đã tick, mở lại Export Studio | quay lại hộp thoại xuất mà không chọn node cụ thể | đang ở chế độ chọn node xuất |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:394` | `Đóng` / icon X | modal header | `close()` | đóng modal Export Studio | thoát xưởng xuất sơ đồ | modal mở; disabled khi đang xuất file |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:394` | `Nội dung`, `Trình bày`, `Kiểm tra` | navigation rail bên trái modal | `selectBenchSection(key)` | cuộn mượt tới bước thiết lập tương ứng | điều hướng nhanh giữa 3 bước cấu hình xuất | modal mở; disabled khi đang xuất file |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:373` | `Ảnh PNG`, `PDF học tập`, `Ảnh WebP` | content step: xuất nhanh | `applyQuick(key)` | áp dụng cấu hình định dạng + nền + độ phân giải chuẩn | thiết lập nhanh cấu hình xuất thông dụng nhất | bước Nội dung |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:373` | `Toàn bộ sơ đồ`, `Nhánh hiện tại`, `Các node được chọn`, `Phần đang hiển thị` | content step: phạm vi xuất (radiogroup) | `setScopeType(key)` | cập nhật phạm vi xuất trong Preview Bench | chọn phạm vi cây muốn đưa vào bản xuất | bước Nội dung; "Nhánh hiện tại" cần node chọn trên canvas |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:373` | `Chọn trên canvas` | content step: trong mục "Các node được chọn" | `onRequestBranchSelection()` | đóng modal, kích hoạt `selectionModeActive` trên canvas | quay ra canvas để tick chọn từng node cụ thể | khi chọn phạm vi `selected_branches` |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:372` | `Tự động thêm node cha để giữ cấu trúc` | content step: context controls | `setAutoParentContext(e.target.checked)` | cập nhật trạng thái tự suy diễn node tổ tiên tối thiểu | giữ quan hệ cây hợp lệ khi xuất các node rời rạc | khi chọn phạm vi `selected_branches` |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:372` | `Không thêm` (aria-label: `Không thêm node cha {label}`) | content step: context node item | thêm id vào `suppressedAutoContextIds` | loại bỏ node cha cụ thể khỏi bản xuất | tách nhánh độc lập không cần node cha nối | khi node cha tự động được suy ra |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:372` | `Khôi phục` (aria-label: `Khôi phục node cha {label}`) | content step: context node item bị loại | xóa id khỏi `suppressedAutoContextIds` | đưa node cha trở lại bản xuất | khôi phục node cha đã loại trước đó | node cha đang ở trạng thái bị loại |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:373` | `Nâng cao` | content step accordion | `setAdvanced((v) => !v)` | mở/đóng tuỳ chọn nâng cao | cấu hình bộ lọc hiển thị | bước Nội dung |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:373` | `Chỉ giữ node đang hiển thị trong phạm vi đã chọn` | content step: nâng cao checkbox | `setVisibleOnly(e.target.checked)` | chỉ xuất các node đang mở trên canvas | loại bỏ các nhánh đang thu gọn | chỉ áp dụng được cho phạm vi "Toàn bộ sơ đồ" |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:375` | `PNG`, `JPEG`, `SVG`, `WebP` | presentation step: nhóm Ảnh | `changeFormat(key)` | cập nhật định dạng xuất ảnh | chọn định dạng hình ảnh phù hợp nhu cầu | bước Trình bày |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:375` | `PDF` | presentation step: nhóm Tài liệu | `changeFormat("pdf")` | cập nhật định dạng tài liệu PDF | xuất tài liệu có dàn ý và trích dẫn | bước Trình bày; disabled khi sơ đồ chưa lưu vào server |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:382` | `Dùng giao diện của sơ đồ` | presentation step: appearance mode | `switchAppearanceMode(true)` | áp dụng cấu hình giao diện đã lưu của sơ đồ | giữ nguyên màu sắc, kiểu dáng node hiện hành | bước Trình bày |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:382` | `Tùy chỉnh riêng bản xuất` | presentation step: appearance mode | `switchAppearanceMode(false)` | mở bộ điều khiển RoleTabs/NodeRoleEditor/ConnectorEditor | thay đổi kiểu dáng node chỉ cho tệp xuất không đổi canvas | bước Trình bày |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:382` | `Áp dụng cho sơ đồ` | presentation step: nút lưu override vào map | `handleApplyAppearanceToMap()` | API `PATCH /mindmaps/:id/appearance` | ghi nhận tuỳ chỉnh giao diện vào sơ đồ gốc | chỉ khi ở chế độ tuỳ chỉnh riêng và sơ đồ có id thật |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:383` | `Mẫu dựng sẵn` (`Giống canvas`, `Tài liệu học tập`, `Tối giản`, `Trình bày`) | presentation step: visual presets | `applyAppearancePreset(name)` | áp dụng bộ mẫu màu sắc/font/độ dày | đổi nhanh phong cách thị giác bản xuất | bước Trình bày |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:377,379` | `Nền` (`Giống canvas`, `Trắng`, `Tối`, `Trong suốt`, `Tùy chỉnh`) | accordion "Màu và kiểu chữ" | `setBackground(v)` | cập nhật màu nền bản xuất | điều chỉnh nền phù hợp in ấn hay chèn slide | bước Trình bày; "Trong suốt" disabled với JPEG/PDF |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:377,379` | `Phông chữ` (`Giống canvas`, `Sans (Inter)`, `Serif (Spectral)`) | accordion "Màu và kiểu chữ" | `updateAppearance({ font })` | cập nhật font chữ sơ đồ | chọn kiểu chữ hiện đại hoặc học thuật | bước Trình bày |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:377,379` | `Màu nhánh` / `Màu tiêu đề` (`Giữ nguyên`, `Đơn sắc`, `Bảng màu riêng`) | accordion "Màu và kiểu chữ" | cập nhật branchColorMode | điều chỉnh màu sắc nhánh cây | làm rõ cấu trúc hoặc tinh gọn màu | bước Trình bày |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:377` | `Độ dày đường nối` (`Mảnh`, `Vừa`, `Đậm`) | accordion "Màu và kiểu chữ" | `updateAppearance({ connectorThickness })` | cập nhật độ dày đường nối | tăng giảm độ đậm của liên kết | xuất định dạng Ảnh |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:378` | `Khoảng cách` (`Gọn`, `Vừa`, `Rộng`) | accordion "Bố cục" | `updateAppearance({ spacing })` | cập nhật khoảng cách node | tạo mật độ thông tin thoáng hay dày | xuất định dạng Ảnh |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:378` | `Độ phân giải` (`1×`, `2×`, `4×`) | accordion "Bố cục" | `setScale(v)` | tăng hệ số scale canvas khi capture | tạo ảnh độ nét cao để in | xuất định dạng Ảnh |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:380` | `Chế độ` PDF (`Chỉ dàn ý`, `Chỉ sơ đồ`, `Sơ đồ + dàn ý`) | accordion "Bố cục" (PDF) | `updatePdfMode(mode)` | cập nhật cấu trúc trang PDF | xuất riêng sơ đồ, dàn ý hoặc cả hai | xuất định dạng PDF |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:380` | `Khổ giấy` (`A4 — In tài liệu`, `A3 — In sơ đồ lớn`, `Vừa nội dung`) | accordion "Bố cục" (PDF) | `updateDoc("pageSize", v)` | điều chỉnh kích thước trang tài liệu | in tài liệu tiêu chuẩn hoặc khổ lớn | xuất định dạng PDF; "Vừa nội dung" chỉ cho sơ đồ |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:380` | `Hướng trang` (`Dọc`, `Ngang`) | accordion "Bố cục" (PDF) | `updateDoc("orientation", v)` | điều chỉnh hướng trang tài liệu | phù hợp đọc dọc hoặc xem ngang | khi chế độ PDF là "Chỉ dàn ý" (sơ đồ tự động) |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:380` | `Lề` (`Hẹp`, `Vừa`, `Rộng`) | accordion "Bố cục" (PDF) | `updateDoc("margins", v)` | điều chỉnh lề trang in | tối ưu diện tích trang giấy | xuất định dạng PDF |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:380` | `Một trang dài duy nhất` | accordion "Bố cục" (PDF) | `updateDoc("singlePage", e.target.checked)` | xuất toàn bộ nội dung trong một trang liên tục | xem tài liệu cuộn không bị ngắt trang | xuất định dạng PDF |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:385` | Checkbox: `Ghi chú`, `Trích dẫn`, `Đường quan hệ`, `Chú giải màu nhánh`, `Nhãn StudyMap` | check step: "Nội dung kèm theo" | `updateContent` / `updateDocContent` | bật/tắt các lớp thông tin bổ sung | tuỳ biến độ chi tiết của bản xuất | bước Kiểm tra |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:385` | `Tên file` (input) | check step: "Tên file" accordion | `setFilenameOverride(e.target.value)` | đặt tên tệp tải về | thay đổi tên file xuất theo ý muốn | bước Kiểm tra |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:394` | `Tiếp tục` | modal footer secondary | `continueBenchSection()` | chuyển sang bước thiết lập kế tiếp | hoàn tất tuần tự các bước cấu hình | footer; disabled khi phạm vi không hợp lệ hoặc đang xuất |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:394` | `Hủy` / `Đóng` | modal footer secondary | `close()` | đóng modal | hủy phiên xuất hoặc đóng sau khi xong | footer; "Hủy" khi đang chọn, "Đóng" khi đã xong |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:394` | `Hủy xuất` | modal footer secondary | `cancel()` | gọi `cancelMindmapExport` | hủy tiến trình tạo file tài liệu đang chạy | chỉ hiện khi job đang queued/running |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:394` | `Xuất lại` | modal footer secondary | `runExport()` | tạo lại file xuất với cấu hình hiện tại | xuất lại tệp khi cần | chỉ hiện sau khi đã xuất thành công |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:394` | `Tạo bản xuất mới` | modal footer primary | `startNewExport()` | đặt lại các lựa chọn và quay về bước Nội dung | tạo một bản xuất khác với thiết lập mới | chỉ hiện sau khi đã xuất thành công |
| Export Studio (Dialog) | `components/mindmap/ExportStudioDialog.jsx:394` | `Xuất PNG` / `Tạo PDF` / `Đang xuất…` / `Thử lại` | modal footer primary CTA | `runExport()` | gọi `exportMindmapImage` (ảnh) hoặc API `createMindmapExport` (tài liệu) | bắt đầu xuất file và kích hoạt tải xuống trình duyệt | footer; disabled khi cấu hình không hợp lệ hoặc đang xuất |
| Appearance Drawer | `components/mindmap/AppearanceEditorDrawer.jsx:93` | Icon X / đóng | drawer header | `requestClose()` | hoàn tác preview tạm thời và đóng drawer | thoát chỉnh sửa giao diện không lưu | drawer mở |
| Appearance Drawer | `components/mindmap/AppearanceEditorDrawer.jsx:96` | `Hoàn tác` | drawer footer secondary | `handleUndo()` | khôi phục trạng thái bản nháp trước đó trong lịch sử | quay lại bước chỉnh sửa vừa thực hiện | có lịch sử thay đổi (`history.length > 0`) |
| Appearance Drawer | `components/mindmap/AppearanceEditorDrawer.jsx:97` | `Đặt lại` | drawer footer secondary | `handleReset()` | đưa cấu hình về bộ mặc định `defaultAppearanceV2()` | khôi phục toàn bộ giao diện gốc của hệ thống | drawer mở; disabled khi đang lưu |
| Appearance Drawer | `components/mindmap/AppearanceEditorDrawer.jsx:99` | `Hủy` | drawer footer secondary | `requestClose()` | hoàn tác preview trên canvas và đóng drawer | hủy các thay đổi chưa lưu | drawer mở; disabled khi đang lưu |
| Appearance Drawer | `components/mindmap/AppearanceEditorDrawer.jsx:100` | `Áp dụng` / `Đang lưu…` | drawer footer primary CTA | `handleApply()` | API `PATCH /mindmaps/:id/appearance` | lưu vĩnh viễn cấu hình giao diện mới cho sơ đồ | drawer mở; disabled khi đang lưu |
| Appearance Drawer | `components/mindmap/AppearanceEditorDrawer.jsx:106` | `Mặc định`, `Tối giản`, `Học tập`, `Pastel`, `Tương phản cao` | accordion "Mẫu dựng sẵn" | `handlePreset(preset)` | áp dụng bảng màu và phong cách mẫu tức thì lên canvas | đổi nhanh toàn bộ giao diện sơ đồ | accordion "Mẫu dựng sẵn" mở |
| Appearance Drawer | `components/mindmap/AppearanceEditorDrawer.jsx:109` | `Gốc`, `Nhánh`, `Lá` (RoleTabs) | accordion "Màu & kiểu node" | `setActiveRole(role)` | chọn vai trò phân tầng của node để chỉnh sửa | cấu hình giao diện chuyên biệt cho từng tầng node | accordion "Màu & kiểu node" mở |
| Appearance Drawer | `components/mindmap/AppearanceControls.jsx:62` | `Chữ nhật tròn góc`, `Viên thuốc`, `Thẻ`, `Gạch chân` | accordion "Màu & kiểu node": hình dạng | `set({ shape })` | cập nhật hình dạng khung viền node | đổi phong cách hiển thị hình học của node | accordion "Màu & kiểu node" mở |
| Appearance Drawer | `components/mindmap/AppearanceControls.jsx:64-66` | `Màu nền`, `Màu chữ`, `Màu viền` (input color) | accordion "Màu & kiểu node": màu sắc | cập nhật màu HEX (kèm nút "Giữ nguyên") | phối màu trực tiếp cho node | cá nhân hoá màu sắc nhận diện | accordion "Màu & kiểu node" mở |
| Appearance Drawer | `components/mindmap/AppearanceControls.jsx:68` | `Độ cong góc` (range slider 0–24px) | accordion "Màu & kiểu node" | `set({ radius: Number(e.target.value) })` | điều chỉnh bo tròn góc của node | tạo dáng góc vuông hoặc bo tròn mềm mại | accordion "Màu & kiểu node" mở |
| Appearance Drawer | `components/mindmap/AppearanceControls.jsx:72` | `Đổ bóng` (checkbox) | accordion "Màu & kiểu node" | `set({ shadow: e.target.checked })` | bật/tắt hiệu ứng đổ bóng dưới chân node | tạo chiều sâu không gian cho sơ đồ | accordion "Màu & kiểu node" mở |
| Appearance Drawer | `components/mindmap/AppearanceControls.jsx:83` | `Màu đường nối` (`Giữ nguyên`, `Đơn sắc`, `Màu cố định`) | accordion "Đường nối" | `set({ colorMode })` | điều chỉnh chế độ tô màu đường nối nhánh | giữ màu theo nhánh hoặc đồng bộ một màu | accordion "Đường nối" mở |
| Appearance Drawer | `components/mindmap/AppearanceControls.jsx:85` | `Độ dày đường nối` (`Mảnh`, `Vừa`, `Đậm`) | accordion "Đường nối" | `set({ thickness })` | cập nhật nét vẽ đường liên kết | làm nổi bật hay thu nhỏ đường nối | accordion "Đường nối" mở |
| Appearance Drawer | `components/mindmap/AppearanceControls.jsx:86` | `Kiểu nét` (`Liền`, `Đứt nét`) | accordion "Đường nối" | `set({ style })` | cập nhật kiểu vẽ đường nối (solid / dashed) | phân biệt phong cách liên kết | accordion "Đường nối" mở |
| Appearance Drawer | `components/mindmap/AppearanceControls.jsx:95` | `Màu nền sơ đồ` (input color) | accordion "Nền" | `set({ background })` | cập nhật màu nền canvas sơ đồ | thay đổi màu nền không gian làm việc | accordion "Nền" mở |
| Appearance Drawer | `components/mindmap/AppearanceControls.jsx:96` | `Lưới nền` (`Không`, `Chấm`, `Lưới`) | accordion "Nền" | `set({ grid })` | cập nhật hoa văn lưới nền (none/dot/line) | tạo điểm tựa thị giác khi điều hướng sơ đồ | accordion "Nền" mở |
| Knowledge Inspector | `components/mindmap/KnowledgeInspector.jsx:207` | `Quay lại` | inspector nav bar (Row 1) | `nav.onBack()` | điều hướng lịch sử node | quay lại node đã xem trước đó | thanh điều hướng; disabled khi không có lịch sử quay lại |
| Knowledge Inspector | `components/mindmap/KnowledgeInspector.jsx:211` | `Đi tiếp` | inspector nav bar (Row 1) | `nav.onForward()` | điều hướng lịch sử node | đi tới node kế tiếp trong lịch sử | thanh điều hướng; disabled khi không có lịch sử đi tiếp |
| Knowledge Inspector | `components/mindmap/KnowledgeInspector.jsx:220` | `Đóng bảng kiểm tra` (title: `Đóng`) | inspector nav bar (Row 1) | `onClose()` | local `setRightOpen(false)` | đóng bảng chi tiết node trên màn hình nhỏ/drawer | chỉ hiện khi có prop `onClose` |
| Knowledge Inspector | `components/mindmap/KnowledgeInspector.jsx:225` | `Ghim nhánh này` / `Bỏ ghim nhánh này` | inspector nav bar (Row 1) | `nav.onTogglePin()` | lưu id vào danh sách ghim của controller | ghim nhánh quan trọng lên thanh truy cập nhanh | khi đang chọn một node |
| Knowledge Inspector | `components/mindmap/KnowledgeInspector.jsx:241,247` | Tên nhánh đã ghim / đã xem gần đây (RelatedPills) | inspector recent/pinned strip (Row 2) | `onNavigate(item.id)` | nhảy camera và chọn node tương ứng trên canvas | mở nhanh các nhánh đã ghim hoặc vừa xem | có ít nhất 1 node ghim hoặc xem gần đây |
| Knowledge Inspector | `components/mindmap/KnowledgeInspector.jsx:347,353` | `Mở nguồn: {stem}` / `Mở nguồn` | inspector evidence header | `onOpenSource(stem)` | chuyển Workspace về tab `chat`, nạp document stem | mở tài liệu gốc để đọc toàn bộ ngữ cảnh | phần Bằng chứng; chỉ khi node có thông tin nguồn |
| Knowledge Inspector | `components/mindmap/KnowledgeInspector.jsx:88` | `Sao chép trích đoạn` | citation card action | `copyQuote()` | ghi text vào Clipboard | chép nội dung đoạn văn nguồn để chia sẻ hoặc ghi chú | thẻ trích dẫn đã tải xong nội dung |
| Knowledge Inspector | `components/mindmap/KnowledgeInspector.jsx:91` | `Sao chép trích dẫn` | citation card action | `copyCitation()` | ghi `"text" — nguồn · mục` vào Clipboard | chép trích dẫn kèm xuất xứ học thuật | thẻ trích dẫn đã tải xong nội dung |
| Knowledge Inspector | `components/mindmap/KnowledgeInspector.jsx:96` | `Đánh dấu trích đoạn này` | citation card action | `onToggleHighlight()` | toggle id trong `highlightedIds` | đánh dấu viền nổi bật cho trích dẫn quan trọng | trên mỗi thẻ trích dẫn |
| Knowledge Inspector | `components/mindmap/knowledgeParts.jsx:163` | `Xem thêm` / `Thu gọn` | citation card / enrichment clamp | `setOpen((v) => !v)` | mở rộng/thu hẹp khung văn bản | đọc trọn vẹn đoạn văn bản dài mà không vỡ bố cục | nội dung văn bản vượt quá số dòng quy định |
| Knowledge Inspector | `components/mindmap/knowledgeParts.jsx:81` | Nút mở/đóng từng mục tri thức (`title`) | collapsible section headers | `toggle()` | localStorage `COLLAPSE_KEY`; đóng/mở nội dung | thu gọn hoặc mở các khối thông tin theo nhu cầu | các mục: Định nghĩa, Ý chính, Ví dụ, Ghi chú, Lưu ý, Bằng chứng, Liên hệ |
| Knowledge Inspector | `components/mindmap/KnowledgeInspector.jsx:388,395,403,412` | Tên nhánh cha, con, liền kề, cùng cấp (RelatedPills) | inspector related concepts section | `onNavigate(item.id)` | nhảy camera tới node và cập nhật Inspector | khám phá mạng lưới quan hệ tri thức xung quanh node | mục "Liên hệ"; khi node có quan hệ cây hoặc quan hệ ngang |
| Knowledge Inspector | `components/mindmap/KnowledgeInspector.jsx:434` | `Hỏi về nhánh này` | sticky footer primary CTA (Row 5) | `onAskAI("Về \"...\": ")` | điền prompt vào ô chat và chuyển sang tab Chat | bắt đầu cuộc trò chuyện đào sâu về khái niệm này | khi đang chọn một node |
| Knowledge Inspector | `components/mindmap/KnowledgeInspector.jsx:444` | `Giải thích đơn giản hơn` | sticky footer action grid | `onAskAI` prompt giải thích đơn giản | gửi prompt tạo giải thích dễ hiểu vào Chat | hiểu khái niệm trừu tượng bằng lời giải thích bình dân | khi đang chọn một node |
| Knowledge Inspector | `components/mindmap/KnowledgeInspector.jsx:444` | `Giải thích sâu hơn` | sticky footer action grid | `onAskAI` prompt giải thích chi tiết | gửi prompt yêu cầu giải thích chuyên sâu | mở rộng kiến thức học thuật | khi đang chọn một node |
| Knowledge Inspector | `components/mindmap/KnowledgeInspector.jsx:444` | `Tạo flashcard` | sticky footer action grid | `onAskAI` prompt tạo câu hỏi - đáp án | tạo thẻ ghi nhớ ôn tập | tự học và ghi nhớ kiến thức | khi đang chọn một node |
| Knowledge Inspector | `components/mindmap/KnowledgeInspector.jsx:444` | `Kiểm tra tôi` | sticky footer action grid | `onAskAI` prompt đặt câu hỏi kiểm tra | tạo bộ câu hỏi tự đánh giá | kiểm tra mức độ nắm bắt bài học | khi đang chọn một node |
| Knowledge Inspector | `components/mindmap/KnowledgeInspector.jsx:444` | `Thêm ví dụ` | sticky footer action grid | `onAskAI` prompt cho thêm ví dụ | yêu cầu AI bổ sung tình huống thực tế | hình dung khái niệm qua ví dụ cụ thể | khi đang chọn một node |
| Knowledge Inspector | `components/mindmap/KnowledgeInspector.jsx:444` | `Hỏi AI về khái niệm này` | sticky footer action grid | `onAskAI("Về \"...\": ")` | điền tiền tố vào ô chat | tự soạn câu hỏi riêng về khái niệm | khi đang chọn một node |

---

## Trùng lặp tiềm ẩn (Possible duplicates)

1. **`StudyMapView.jsx:547` ("Dựng lại") vs `StudyMapView.jsx:612` ("Dựng sơ đồ kiến thức")**:
   - *Bằng chứng:* Cả hai đều gọi hàm nội bộ `build()` → API `POST /api/study/map`.
   - *Bản chất hành vi:* **KHÁC BIỆT THAM SỐ (Parameter difference)**. "Dựng lại" truyền `{ force: true }` để vượt qua bộ nhớ đệm và ép máy chủ tính toán lại; "Dựng sơ đồ kiến thức" chỉ gọi khi chưa có sơ đồ và truyền `{ force: false }`.
   - *Xử lý khuyến nghị:* Giữ nguyên; ngữ cảnh khởi tạo lần đầu khác với tạo lại khi đã có kết quả.

2. **`SidebarRight.jsx:872` ("+ Tạo sơ đồ") vs `WorkspaceEmptyState.jsx:95` ("Tạo sơ đồ tư duy") vs `MindElixirView.jsx:1155` ("Tạo sơ đồ mới")**:
   - *Bằng chứng:* Cả ba đều dẫn tới `handleGenerateMindMap()` tại `SidebarRight.jsx:827`, kiểm tra năng lực máy chủ và mở `GuidedMindmapDialog` (nếu bật) hoặc gọi luồng tạo cũ.
   - *Bản chất hành vi:* **CÙNG HÀNH VI (SAME behavior)**. Đây là ba lối vào theo ngữ cảnh: thanh bên công cụ, màn hình rỗng trung tâm khi chưa có sơ đồ, và danh sách thả xuống chọn sơ đồ trên thanh công cụ canvas.
   - *Xử lý khuyến nghị:* Giữ nguyên cả ba để bảo đảm tính tiện dụng, nhưng nên chuẩn hoá nhãn thống nhất thành "Tạo sơ đồ tư duy".

3. **`SidebarRight.jsx:807` ("Tạo lại" khi mở sơ đồ) vs `MindElixirView.jsx:1169` ("Tạo lại" trên toolbar) vs `MindElixirView.jsx:1260` ("Tạo lại" trên degraded banner)**:
   - *Bằng chứng:* Đều gọi prop `onRegenerate` do `SidebarRight.jsx:836` (`handleRegenerateMindMap`) cung cấp, kiểm tra trạng thái sửa đổi chưa lưu trước khi gọi `runMindmapGeneration(sources, { force: true })`.
   - *Bản chất hành vi:* **CÙNG HÀNH VI (SAME behavior)**.
   - *Xử lý khuyến nghị:* Giữ nguyên vì một nút nằm trên thanh công cụ chính của canvas và một nút gắn cảnh báo suy giảm chất lượng dữ liệu.

4. **`MindElixirView.jsx:1112` ("Lưu") vs `MindElixirView.jsx:1209` ("Lưu sơ đồ")**:
   - *Bằng chứng:* Cả hai đều kích hoạt hàm `handleSave()` tại `MindElixirView.jsx:324` → API `PUT /mindmaps/:id`.
   - *Bản chất hành vi:* **CÙNG HÀNH VI (SAME behavior)**. Nút tại dòng 1112 nằm trên dải nhận diện trang (đang bị ẩn bởi class `hidden`), trong khi nút tại dòng 1209 nằm trong menu tràn "Thêm tùy chọn".
   - *Xử lý khuyến nghị:* Loại bỏ nút bị ẩn dư thừa ở dòng 1112 hoặc bỏ class `hidden` nếu muốn ưu tiên nút lưu nổi bật.

5. **`MindElixirView.jsx:1322` ("Vừa khung") vs `MindElixirView.jsx:1194` ("Đặt lại khung nhìn") vs `MindElixirView.jsx:1195` ("Căn giữa")**:
   - *Bằng chứng:*
     - `fitView()`: gọi `mind.scaleFit()` (co giãn toàn bộ sơ đồ vừa khít kích thước vùng chứa canvas).
     - `resetView()`: gọi `mind.scale(1.0)` và `mind.toCenter()` (đưa tỷ lệ phóng về đúng 100% và căn giữa node gốc).
     - `toCenter()`: chỉ gọi `mind.toCenter()` (giữ nguyên tỷ lệ phóng hiện tại, chỉ dịch chuyển tọa độ).
   - *Bản chất hành vi:* **KHÁC BIỆT RÕ RÀNG VỀ TOÁN HỌC KHUNG NHÌN (Behavioral difference)**.
   - *Xử lý khuyến nghị:* Giữ cả ba nhưng cần bổ sung tooltip giải thích rõ: "Vừa khung (F)" co giãn toàn bộ; "Đặt lại 100%" đưa về tỷ lệ thật; "Căn giữa" dịch chuyển vị trí.

6. **`ExportStudioDialog.jsx:373` (Nút chọn nhanh "Ảnh PNG") vs `ExportStudioDialog.jsx:375` (Radio định dạng "PNG")**:
   - *Bằng chứng:*
     - `applyQuick("png")`: đặt định dạng `png`, nền `canvas`, scale `2`, và giao diện `canvas`.
     - `changeFormat("png")`: chỉ chuyển format thành `png`, giữ nguyên toàn bộ các tuỳ chọn nền/độ phân giải/giao diện người dùng đã chỉnh.
   - *Bản chất hành vi:* **KHÁC BIỆT NGỮ CẢNH (Quick preset vs granular format switch)**.
   - *Xử lý khuyến nghị:* Giữ nguyên; thêm nhãn chú thích "Đặt lại các tuỳ chọn về mặc định của ảnh" cho nút chọn nhanh.

7. **`StudyMapView.jsx:716` ("PNG") vs `ExportStudioDialog.jsx:394` ("Xuất PNG")**:
   - *Bằng chứng:*
     - `StudyMapView`: xuất DOM SVG cây D3 trực tiếp qua client-side `exportImage` (snapdom) với nền mặc định của theme.
     - `ExportStudioDialog`: xử lý qua pipeline phức tạp `exportMindmapImage` trên canvas Mind-Elixir, lọc phạm vi 4 cấp (toàn bộ, nhánh, tick node, hiển thị), tính toán kích thước xấp xỉ, xử lý node cha tự động và áp dụng theme xuất riêng.
   - *Bản chất hành vi:* **KHÁC BIỆT HOÀN TOÀN VỀ CÔNG NGHỆ VÀ KHẢ NĂNG (Different engines, similar label)**.
   - *Xử lý khuyến nghị:* Giữ nguyên vì nằm ở hai màn hình độc lập (`/app/study/map/:id` và `/app?tab=mindmap`).

8. **`KnowledgeInspector.jsx:434` ("Hỏi về nhánh này") vs `KnowledgeInspector.jsx:444` ("Hỏi AI về khái niệm này")**:
   - *Bằng chứng:*
     - "Hỏi về nhánh này": gọi `onAskAI('Về "' + node.title + '": ')`.
     - "Hỏi AI về khái niệm này": mục thứ 6 trong lưới `ACTIONS`, gọi cùng hàm tạo chuỗi `(t) => 'Về "' + t + '": '`.
   - *Bản chất hành vi:* **CÙNG HÀNH VI VÀ NỘI DUNG PROMPT (100% DUPLICATE)**.
   - *Xử lý khuyến nghị:* Loại bỏ mục "Hỏi AI về khái niệm này" trong lưới hành động học tập vì nút bấm chính phía trên đã đảm nhiệm đúng hành động này.

---

## Trạng thái rỗng (Empty states)

1. **StudyMap chưa dựng sơ đồ (`StudyMapView.jsx:602-617`)**:
   - *Tiêu đề:* `Chưa dựng sơ đồ cho tài liệu này`
   - *Mô tả:* `Sơ đồ tách tài liệu thành cây khái niệm, mỗi khái niệm neo về đúng đoạn văn sinh ra nó.`
   - *Hành động kế tiếp (CTA):* Nút `Dựng sơ đồ kiến thức` (bắt đầu gọi API sinh cây D3).

2. **StudyMap đang được dựng từ tiến trình khác (`StudyMapView.jsx:591-601`)**:
   - *Tiêu đề:* `Sơ đồ đang được dựng`
   - *Mô tả:* `Một tiến trình dựng sơ đồ cho tài liệu này đang chạy (có thể từ tab khác). Bấm dựng thêm sẽ tạo job thứ hai tranh cùng một chỗ xử lý.`
   - *Hành động kế tiếp (CTA):* Nút `Kiểm tra lại` (tải lại dữ liệu kiểm tra kết quả job).

3. **StudyMap chưa chọn node xem chi tiết (`StudyMapView.jsx:801-808`)**:
   - *Biểu tượng:* Spline
   - *Mô tả:* `Bấm một khái niệm trên sơ đồ để đọc tóm tắt và đoạn tài liệu sinh ra nó. Bấm vào node có nhánh con để bung, kéo nền để di chuyển.`
   - *Hành động kế tiếp (CTA):* Không có nút bấm riêng (hướng dẫn bấm vào nút gốc có hiệu ứng nhấp nháy Spark Effect).

4. **Workspace chưa có sơ đồ tư duy (`WorkspaceEmptyState.jsx:13-18, 85-100`)**:
   - *Tiêu đề:* `Chưa có sơ đồ tư duy`
   - *Mô tả:* `Sơ đồ tư duy tổng hợp cấu trúc và mối quan hệ giữa các ý chính trong tài liệu đã chọn.`
   - *Chỉ báo nguồn:* `N tài liệu đã chọn` hoặc `Chưa chọn tài liệu nào` (kèm dòng nhắc `Chọn tài liệu bên trái trước.`).
   - *Hành động kế tiếp (CTA):* Nút `Tạo sơ đồ tư duy` (kích hoạt mở Guided Dialog hoặc tạo trực tiếp; disabled khi chưa chọn tài liệu).

5. **Workspace đang tải sơ đồ lần đầu (`WorkspaceEmptyState.jsx:41-48`)**:
   - *Biểu tượng:* Network (nhấp nháy động)
   - *Mô tả:* `Đang tải…`
   - *Hành động kế tiếp (CTA):* Không có.

6. **Workspace tải sơ đồ bị lỗi (`WorkspaceEmptyState.jsx:49-56`)**:
   - *Biểu tượng:* TriangleAlert
   - *Mô tả:* Nội dung lỗi cụ thể từ máy chủ.
   - *Hành động kế tiếp (CTA):* Không có nút trực tiếp (người dùng chuyển tab hoặc chọn lại nguồn).

7. **Workspace tiến trình tạo sơ đồ gặp lỗi (`WorkspaceEmptyState.jsx:67-83`)**:
   - *Biểu tượng:* TriangleAlert
   - *Mô tả:* Thông điệp lỗi tiến trình từ máy chủ.
   - *Hành động kế tiếp (CTA):* Nút `Thử lại` (gọi lại `onRetryMindmap`) hoặc `Tạo sơ đồ tư duy`.

8. **Danh sách sơ đồ đã lưu bị trống (`SidebarRight.jsx:931-935`)**:
   - *Mô tả:* `Chưa có sơ đồ nào được lưu.`
   - *Hành động kế tiếp (CTA):* Nút `+ Tạo sơ đồ` ở phía trên.

9. **Danh sách sơ đồ đã lưu tải lỗi (`SidebarRight.jsx:926-930`)**:
   - *Mô tả:* Nội dung lỗi tải danh sách.
   - *Hành động kế tiếp (CTA):* Nút gạch chân `Thử lại`.

10. **Knowledge Inspector chưa chọn nhánh (`KnowledgeInspector.jsx:289-298`)**:
    - *Biểu tượng:* Network
    - *Tiêu đề:* `Chi tiết sơ đồ`
    - *Mô tả:* `Chọn một nhánh để xem giải thích và bằng chứng.`
    - *Thông tin kèm theo:* `{sources} nguồn · {nodes} node · {created}`
    - *Hành động kế tiếp (CTA):* Không có.

11. **Nhánh không có trích dẫn bằng chứng (`KnowledgeInspector.jsx:328-332`)**:
    - *Mô tả:* `Chưa có bằng chứng — đang làm giàu` (nếu đang sinh ngầm) hoặc `Nhánh này chưa gắn trích đoạn`.
    - *Hành động kế tiếp (CTA):* Không có.

12. **Nhánh không có quan hệ liên kết (`KnowledgeInspector.jsx:381-383`)**:
    - *Mô tả:* `Nhánh này không có liên hệ nào khác.`
    - *Hành động kế tiếp (CTA):* Không có.

13. **Export Studio phạm vi chưa hợp lệ (`ExportStudioDialog.jsx:101,373`)**:
    - *Biểu tượng:* AlertCircle
    - *Mô tả:* `Chọn ít nhất một node để tiếp tục.` (với phạm vi tick chọn) hoặc `Chọn một node trên canvas để tiếp tục.` (với phạm vi nhánh hiện tại).
    - *Hành động kế tiếp (CTA):* Nút `Chọn trên canvas` (đối với phạm vi các node được chọn).

14. **Export Studio chưa lưu sơ đồ khi xuất tài liệu PDF (`ExportStudioDialog.jsx:375`)**:
    - *Mô tả trợ giúp:* `Lưu sơ đồ trước khi xuất định dạng tài liệu.`
    - *Hành động kế tiếp (CTA):* Định dạng PDF bị mờ (`is-disabled`); người dùng cần đóng modal và bấm "Lưu" trên thanh công cụ trước.

---

## Nhãn gây bối rối (Confusing labels)

1. **"Sơ đồ" vs "Sơ đồ tư duy" vs "Bản đồ học tập" vs "Sơ đồ kiến thức"**:
   - *Vị trí xuất hiện:*
     - `StudyCard.jsx`: Dùng nhãn `Sơ đồ` với icon `Network` dẫn tới `/app/study/map/:id`.
     - `DocumentToolsSheet.jsx`: Dùng `Sơ đồ tư duy` dẫn tới `/app?tab=mindmap`, nhưng dùng `Bản đồ học tập` (icon `GitBranch`) dẫn tới `/app/study/map/:id`.
     - `StudyMapView.jsx`: Tiêu đề và eyebrow hiển thị `Sơ đồ kiến thức`, nút trống ghi `Dựng sơ đồ kiến thức`.
     - `MainLayout.jsx` & `WorkspaceEmptyState.jsx`: Dùng `Sơ đồ tư duy` với icon `Network`.
     - `SidebarRight.jsx`: Thẻ tab ghi `Sơ đồ tư duy`, nhưng nút hành động lại ghi `Tạo sơ đồ`.
   - *Sự nhập nhằng:* Hệ thống có hai mặt hiển thị sơ đồ hoàn toàn khác biệt (D3-tree tĩnh định hướng cấu trúc văn bản vs Mind-Elixir động tương tác ý tưởng), nhưng các nhãn "Sơ đồ", "Sơ đồ tư duy", "Bản đồ học tập", "Sơ đồ kiến thức" bị hoán đổi lộn xộn khiến người dùng không phân biệt được đâu là sơ đồ tư duy chỉnh sửa được và đâu là bản đồ học tập cố định.
   - *Đề xuất làm rõ:* Thống nhất gọi `/app/study/map/:id` là **"Bản đồ kiến thức"** (hoặc "Cây cấu trúc tài liệu") và gọi `/app?tab=mindmap` là **"Sơ đồ tư duy"**.

2. **"Lưu" vs "Xuất" vs "Tải xuống" (Save vs Export vs Download)**:
   - *Vị trí xuất hiện:*
     - `MindElixirView.jsx:1112`: Nút `Lưu` thực chất là lưu dữ liệu JSON vào máy chủ (`PUT /mindmaps/:id`).
     - `MindElixirView.jsx:1183`: Nút `Xuất` mở hộp thoại Export Studio.
     - `ExportStudioDialog.jsx:382`: Nút `Áp dụng cho sơ đồ` thực chất là lưu cấu hình giao diện vào máy chủ (`PATCH /mindmaps/:id/appearance`).
     - `ExportStudioDialog.jsx:394`: Nút chính ghi `Xuất PNG` hoặc `Tạo PDF`, nhưng thông báo hoàn tất lại ghi `File đã tải xuống trình duyệt.`
     - `StudyMapView.jsx:720-731`: Nút ghi nhãn `PNG`, `PNG trong suốt`, `SVG` với icon `Download` tải file ngay lập tức không qua hộp thoại.
   - *Sự nhập nhằng:* Người dùng dễ nhầm giữa việc "Lưu" (lưu thay đổi trên cloud của StudyMap) với "Xuất / Tải xuống" (lấy tệp về máy tính).
   - *Đề xuất làm rõ:* Dùng nhãn "Lưu lên đám mây" hoặc "Lưu thay đổi" cho thao tác PUT/PATCH; dùng "Xuất tệp" cho Export Studio; dùng icon Download và nhãn "Tải ảnh PNG" trên StudyMapView.

3. **"Chỉ chủ đề chính" vs "Hiện 1 tầng nhánh"**:
   - *Vị trí xuất hiện:* Trong menu tràn `MindElixirView.jsx:1200-1201`.
   - *Sự nhập nhằng:* Nhãn "Chỉ chủ đề chính" tương ứng với độ sâu 0 (`setRootOnly`), thực chất chỉ hiển thị duy nhất **Node gốc (Root)** và ẩn toàn bộ các chủ đề lớn cấp 1. Người dùng đọc nhãn sẽ hiểu lầm là hiển thị các chủ đề chính (tầng 1).
   - *Đề xuất làm rõ:* Đổi thành **"Chỉ hiển thị node gốc"** cho mức 0, và **"Chủ đề chính (1 tầng)"** cho mức 1.

4. **"Phần đang hiển thị" vs "Chỉ giữ node đang hiển thị trong phạm vi đã chọn"**:
   - *Vị trí xuất hiện:* `ExportStudioDialog.jsx:22,373`.
   - *Sự nhập nhằng:* Trong danh sách phạm vi có mục "Phần đang hiển thị" (`visible`), nhưng trong phần Nâng cao lại có checkbox "Chỉ giữ node đang hiển thị trong phạm vi đã chọn" (`visibleOnly` - chỉ có hiệu lực với phạm vi "Toàn bộ sơ đồ"). Hai khái niệm này gây trùng lặp và làm người dùng bối rối về việc nhánh đang gập có được xuất hay không.
   - *Đề xuất làm rõ:* Ẩn checkbox nâng cao khi người dùng đã chọn phạm vi "Phần đang hiển thị", hoặc giải thích rõ: checkbox này loại trừ các nhánh đang thu gọn ra khỏi cây đầy đủ.

---

## Thành phần không gắn kết / Mã thử nghiệm (Not Mounted)

1. `FE/src/components/mindmap/EvidenceDrawer.jsx`:
   - *Trạng thái:* **NOT MOUNTED**.
   - *Dấu vết:* Không có bất kỳ import trực tiếp nào từ các tuyến đường hoặc thành phần LIVE. Đây là ngăn kéo bằng chứng độc lập từ Phase 4, đã được thay thế hoàn toàn bởi `KnowledgeInspector.jsx` gắn cố định tại thanh bên phải trong Phase 5.
2. `FE/src/components/mindmap/knowledgeParts.jsx` component `EvidenceCard`:
   - *Trạng thái:* **NOT MOUNTED**.
   - *Dấu vết:* Chỉ được gọi bởi thành phần `EvidenceDrawer.jsx` đã ngừng sử dụng. `KnowledgeInspector.jsx` sử dụng phiên bản mới `CitationCard`.
3. `FE/src/dev/FixtureHarnessApp.jsx` & `FE/src/dev/mindmapFixtures.js`:
   - *Trạng thái:* **NOT MOUNTED**.
   - *Dấu vết:* Nằm trong thư mục `dev/`, phục vụ kiểm thử đơn vị và môi trường giả lập cô lập (harness), không nằm trong chuỗi route của `App.jsx`.
