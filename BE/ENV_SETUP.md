# Backend Environment Setup

Đây là tài liệu **thao tác** (đổi embedding model, rebuild index, troubleshooting). Danh
sách đầy đủ 128 biến nằm ở **`BE/.env.example`** — file đó có comment cho từng khoá kèm lý
do. Đừng chép khoá sang đây: hai bản danh sách thì một bản sẽ lệch.

## Quick Start

```bash
cd BE

# 1. Sao chép file mẫu thành .env
cp .env.example .env

# 2. Chỉnh sửa .env (điền API key nếu cần)
# GEMINI_API_KEY=your_key_here
# GROQ_API_KEY=your_key_here
```

## Dependencies cần cài

```bash
pip install -U python-dotenv
```

Các package liên quan đến embedding model (đã có trong `requirements.txt`):

```bash
pip install -U sentence-transformers transformers accelerate langchain-huggingface
```

## Đổi Embedding Model

Mặc định: `BAAI/bge-m3` (dimension 1024, đa ngôn ngữ)

```bash
# Trong .env
EMBEDDING_MODEL_NAME=BAAI/bge-m3
```

Model cũ (dimension 384, chỉ tiếng Anh tốt):

```bash
# EMBEDDING_MODEL_NAME=sentence-transformers/all-MiniLM-L6-v2
```

## Quan trọng: Rebuild FAISS Index khi đổi Embedding Model

Khi đổi `EMBEDDING_MODEL_NAME`, dimension vector thay đổi -> FAISS index cũ **KHÔNG tương thích**.

> **Sửa 2026-08-28 — khối lệnh cũ ở đây XOÁ NHẦM DỰ ÁN.** Nó hard-code
> `$base = "e:/memvid_NCKH/MemVid_New/BE"`. `MemVid_New` là **dự án KHÁC và có thật trên
> máy này**, nên chạy nguyên văn là xoá `index/` cùng toàn bộ memory artifact của nó.
> Cùng cái bẫy `DATA_DIR` từng trỏ nhầm sang `MemVid_New/BE` suốt nhiều tháng (xem comment
> trong `BE/.env`). Tên artifact cũng đã đổi: `mindmaps.json` -> `mindmaps.sqlite`,
> `summaries.json` -> `summaries.sqlite`, `mindmap_content_cache.json` không còn.
>
> Khối dưới đây chạy **tương đối theo thư mục `BE/`** — không có đường dẫn tuyệt đối nào
> để gõ nhầm.

### PowerShell

```powershell
# Đứng ở thư mục BE/ rồi chạy. KHÔNG dùng đường dẫn tuyệt đối.
Remove-Item -Recurse -Force "./index" -ErrorAction SilentlyContinue
Remove-Item -Force "./memory/memory_index.faiss" -ErrorAction SilentlyContinue
Remove-Item -Force "./memory/memory_index.json" -ErrorAction SilentlyContinue
Remove-Item -Force "./memory/memory_trees.json" -ErrorAction SilentlyContinue
Remove-Item -Force "./memory/mindmaps.sqlite" -ErrorAction SilentlyContinue

Write-Host "Đã xoá embedding artifacts. Restart backend và upload lại document."
```

### Bash (Linux/Mac/WSL)

```bash
cd BE
rm -rf index/
rm -f memory/memory_index.faiss memory/memory_index.json memory/memory_trees.json
rm -f memory/mindmaps.sqlite
```

### Quên rebuild thì sao?

Từ 2026-08-28 không còn im lặng: `hybrid._load_faiss_index()` so số chiều của vector truy
vấn với `index.d` và ném câu báo nêu CẢ HAI số chiều + tên model + cách dựng lại. Trước đó
faiss ném `AssertionError` **rỗng**, log ra một dòng cụt, và truy hồi âm thầm tụt về
BM25-only. Xem `.playbook/known-issues.md`.

### File KHÔNG cần xóa (an toàn)

- `BE/.env` - cấu hình (chỉ đổi EMBEDDING_MODEL_NAME)
- `input_docs/` - tài liệu gốc
- `jobs.sqlite` - job status
- `sessions.sqlite` - lịch sử chat
- `logs.sqlite` - logs
- `summaries.sqlite` - không chứa embeddings

### File CÓ THỂ giữ (không bắt buộc xóa)

- `source_registry.json` - có thể giữ, source status sẽ được update khi upload lại

## Env Loading Priority

```
BE/.env           (ưu tiên cao nhất - file cùng thư mục BE/)
../.env           (root project - dùng cho docker-compose)
os.environ        (Docker/K8s environment variables - ghi đè tất cả khi override=True)
```

## Biến quan trọng nhất

| Biến | Mô tả | Mặc định |
|---|---|---|
| `OLLAMA_HOST` | Ollama server | `http://localhost:11434` |
| `SLM_MODEL_CHAT` | Model chat + memory tree | `shared.config.DEFAULT_LOCAL_MODEL` |
| `SLM_MODEL_SUMMARY` | Model summarize | `shared.config.DEFAULT_LOCAL_MODEL` |
| `EMBEDDING_MODEL_NAME` | Model embedding | `BAAI/bge-m3` |
| `SKIP_MODEL_LOAD` | CI/testing mode | `0` |
| `DATA_DIR` | Thư mục data | `BE/` |

## Troubleshooting

**Ollama không kết nối:**
```bash
# Kiểm tra Ollama đang chạy
ollama list

# Pull model nếu chưa có. Mặc định của mã là qwen2.5:7b-instruct
# (shared/config.py::DEFAULT_LOCAL_MODEL) — 4.68 GB, vừa card 6 GiB.
# qwen3.5:9b nặng 6.59 GB, KHÔNG vừa; chỉ pull khi máy có VRAM lớn hơn.
ollama pull qwen2.5:7b-instruct
```

**Embedding model lỗi:**
```bash
# Bật CI mode (dùng FakeEmbeddings)
SKIP_MODEL_LOAD=1 python -c "from llm_factory import get_embeddings; print(get_embeddings())"
```

**Dotenv không load:**
```bash
# Bỏ qua dotenv hoàn toàn
SKIP_DOTENV=1 python main.py
```
