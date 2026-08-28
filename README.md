# StudyMap AI — Hệ thống RAG hỗ trợ học từ tài liệu

## Mục lục

1. [Tổng quan](#tổng-quan)
2. [Kiến trúc hệ thống](#kiến-trúc-hệ-thống)
3. [Cấu trúc dự án](#cấu-trúc-dự-án)
4. [Hướng dẫn cài đặt](#hướng-dẫn-cài-đặt)
5. [API Endpoints](#api-endpoints)
6. [Các tính năng chính](#các-tính-năng-chính)
7. [Mô hình AI/ML](#mô-hình-aiml)
8. [Lưu trữ dữ liệu](#lưu-trữ-dữ-liệu)
9. [Docker Deployment](#docker-deployment)
10. [Development](#development)

---

## Tổng quan

**StudyMap AI** là hệ thống RAG (Retrieval-Augmented Generation) cho người học: nạp tài
liệu vào, rồi hỏi đáp, tóm tắt, dựng sơ đồ và tự kiểm tra trên chính tài liệu đó.

- **Nạp tài liệu** (PDF, DOCX, PPTX, XLSX, EPUB, HTML, MD, TXT, ảnh) rồi chunk + index
- **Tìm kiếm lai** BM25 + FAISS, hợp nhất bằng RRF, rerank bằng cross-encoder
- **Memory Tree** — cấu trúc phân cấp document/section/topic cho câu hỏi tổng hợp
- **Sơ đồ tư duy** và **tóm tắt** sinh tự động, chạy dạng job nền có tiến trình + huỷ
- **Study Map** — đồ thị khái niệm kèm liên kết ngược về chunk nguồn
- **Quiz, chấm bài, phân tích lỗ hổng, kế hoạch ôn tập, theo dõi tiến độ**

> **Ghi chú lịch sử.** Dự án khởi đầu tên **MemVid**, mã hoá bộ nhớ thành video QR. Hướng
> đó đã bỏ: không còn `videos/`, `core_modules/`, `chunk_processor.py`, `video_utils.py`.
> Tài liệu này từng mô tả kiến trúc cũ đó tới **75%** đường dẫn sai — viết lại 2026-08-28.

---

## Kiến trúc hệ thống

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (FE)                                    │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────────────────┐  │
│  │  SidebarLeft │  │    ChatArea      │  │       SidebarRight          │  │
│  │  - Upload    │  │  - Hỏi đáp      │  │  - Mind Map Viewer          │  │
│  │  - File List│  │  - Streaming     │  │  - Summary Viewer           │  │
│  │  - Selection │  │  - Progress      │  │  - History                 │  │
│  └──────────────┘  └──────────────────┘  └──────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ HTTP/REST API
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BACKEND (BE) - Flask                               │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                        LangGraph Pipelines                            │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────────┐   │  │
│  │  │ IngestGraph │  │ QueryGraph   │  │    MindmapGraph          │   │  │
│  │  │ - Extract   │  │ - Retrieve   │  │    - Generate MindMap    │   │  │
│  │  │ - Chunk     │  │ - Memory     │  │    - CMGN Strategy       │   │  │
│  │  │ - Embed     │  │ - Generate   │  │    - Iterative Expand   │   │  │
│  │  └─────────────┘  └─────────────┘  └──────────────────────────┘   │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                      Core Services                                    │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐   │  │
│  │  │ vector_store │  │ memory_tree   │  │  mindmap_utils        │   │  │
│  │  │ - FAISS      │  │ - Nodes      │  │  - CMGN Algorithm     │   │  │
│  │  │ - Embeddings │  │ - Intent     │  │  - Critics (3-phase)   │   │  │
│  │  └──────────────┘  └──────────────┘  └────────────────────────┘   │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐   │  │
│  │  │ llm_factory  │  │ chunk_proc   │  │  summarize_advanced    │   │  │
│  │  │ - Ollama     │  │ - QR Gen     │  │  - DANCER             │   │  │
│  │  │ - Gemini     │  │ - Video      │  │  - Chain of Density   │   │  │
│  │  │ - Groq       │  │ - Metadata   │  │  - Entity Chain       │   │  │
│  │  └──────────────┘  └──────────────┘  └────────────────────────┘   │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DATA STORAGE                                       │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐   │
│  │   BE/index/     │  │   BE/memory/    │  │   BE/videos/              │   │
│  │  - index.faiss  │  │  - memory_index │  │  - *.mp4 (QR videos)      │   │
│  │  - index.json   │  │  - memory_trees │  │                           │   │
│  │  - source_reg   │  │  - summaries    │  │                           │   │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────┘   │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐   │
│  │   BE/input_docs│  │   BE/jobs.sqlite │  │   BE/sessions.sqlite       │   │
│  │  - *.pdf/docx  │  │  - Job tracking  │  │  - Chat history           │   │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Cấu trúc dự án

> Cây dưới đây **sinh từ `git ls-files`**, dừng ở 2 tầng. Bản cũ liệt kê tới từng file ở
> 4 tầng và gõ tay — kết quả là 54/72 mục trỏ vào chỗ không tồn tại. Muốn dựng lại:
>
> ```bash
> git ls-files | awk -F/ 'NF>2{print $1"/"$2"/"} NF==2{print $1"/"$2} NF==1{print $1}' | sort -u
> ```

```
MemVid_BaoCaoTotNghiep/
├── BE/                     # Backend: Flask + LangGraph
│   ├── app/
│   │   ├── main.py         # Flask app — 80 endpoint (bảng bên dưới)
│   │   ├── domains/        # 20 domain: documents, retrieval, quiz, studymap,
│   │   │                   #   progress, review, memory, mindmap, summary, auth…
│   │   ├── graphs/         # Pipeline LangGraph: ingest / query / mindmap / summary
│   │   ├── clients/        # llm_factory, mindmap_factory, summary_factory
│   │   ├── db/             # SQLAlchemy models + session
│   │   ├── jobs/           # Hàng đợi job nền (RQ, bật bằng QUEUE_ENABLED)
│   │   └── wiring.py       # Ghép graph với dependency
│   ├── services/           # Microservice tách được: mindmap (gRPC), summary, llm_gateway
│   ├── shared/             # config.py, env_loader.py, paths.py, source_id.py
│   ├── evaluation/         # Bộ chấm chất lượng cho luận văn
│   ├── alembic/            # Migration Postgres
│   ├── scripts/            # Tiện ích chạy tay (build_proto, perf…)
│   ├── tests/              # pytest — 894 passed / 4 skipped
│   ├── .env.example        # 128 biến, có comment lý do cho từng khoá
│   └── ENV_SETUP.md        # Hướng dẫn thao tác env / rebuild index
│
├── FE/                     # Frontend: React + Vite + Tailwind
│   └── src/
│       ├── pages/          # Landing, Login, Register, Workspace, study/
│       ├── components/     # Layout/, mindmap/, study/, ui/
│       ├── auth/           # AuthContext, tokenStore, ProtectedRoute
│       ├── hooks/          # useStudyJob, panelLayout…
│       └── utils/          # api client, job poller, SSE stream (test đặt cạnh mã)
│
├── docs/                   # ARCHITECTURE, SPEC, playbooks/, decisions/, skills/,
│                           #   superpowers/plans/, tailieu/ (tài liệu luận văn)
├── .playbook/              # known-issues.md + lessons-learned.md — BỘ NHỚ của dự án,
│                           #   đọc TRƯỚC khi sửa mã (xem .claude/rules/AGENTS.md)
├── docker-compose.yml      # backend, llm-gateway, mindmap-service, rq-worker, redis, frontend
├── .env.example            # Hồ sơ DOCKER/PROD (BE/.env.example là hồ sơ DEV và THẮNG)
└── requirements.txt        # Con trỏ tới BE/requirements.txt (nơi pin thật)
```

**Thư mục runtime không nằm trong git** (`.gitignore` che): `BE/index/`, `BE/memory/`,
`BE/data/`, `BE/input_docs/`, `BE/cleaned_md/`, `BE/reports/`, `BE/_backup-*/`.

## Hướng dẫn cài đặt

### Yêu cầu hệ thống

- **Python 3.10+**
- **Node.js 18+** (cho Frontend)
- **Ollama** (chạy local) hoặc **API Key** (Gemini/Groq)
- **Docker & Docker Compose** (optional)

### 1. Cài đặt Backend

```bash
# Di chuyển vào thư mục Backend
cd BE

# Tạo virtual environment
python -m venv venv
source venv/bin/activate  # Linux/Mac
# Hoặc: venv\Scripts\activate  # Windows

# Cài đặt dependencies
pip install -r requirements.txt

# Cài đặt Ollama models (cần thiết nếu dùng local)
ollama pull qwen3.5:9b
ollama pull qwen2.5:14b
ollama pull gemma2:2b
```

### 2. Cài đặt Frontend

```bash
# Di chuyển vào thư mục Frontend
cd FE

# Cài đặt dependencies
npm install

# Copy environment file
cp .env.example .env  # Chỉnh sửa VITE_API_URL nếu cần
```

### 3. Cấu hình Environment

Tạo file `.env` trong thư mục `BE/`:

```env
# AI Provider Configuration
OLLAMA_HOST=http://localhost:11434

# LLM Models
SLM_MODEL_CHAT=qwen3.5:9b
SLM_MODEL_SUMMARY=qwen2.5:14b
MINDMAP_MODEL=qwen2.5:14b
SLM_MODEL_INTENT=gemma2:2b

# Alternative: Gemini
# GEMINI_API_KEY=your_gemini_api_key

# Alternative: Groq
# GROQ_API_KEY=your_groq_api_key

# Storage Paths
DATA_DIR=./BE
VIDEO_DIR=./BE/videos
INPUT_DOCS_DIR=./BE/input_docs
INDEX_DIR=./BE/index
MEMORY_DIR=./BE/memory

# Embedding Model
EMBEDDING_MODEL_NAME=sentence-transformers/all-MiniLM-L6-v2

# Optional: Skip model loading for CI testing
# SKIP_MODEL_LOAD=1
```

### 4. Chạy Ứng dụng

**Development Mode:**

```bash
# Terminal 1: Backend
cd BE
python main.py

# Terminal 2: Frontend
cd FE
npm run dev
```

**Docker Mode:**

```bash
docker-compose up --build
```

---

## API Endpoints

> Bảng **sinh từ `BE/app/main.py`**, không chép tay. Bản cũ liệt kê 27 endpoint, trong đó
> 5 cái không tồn tại và thiếu 56 route có thật. Dựng lại bằng:
>
> ```bash
> grep -oE "@app\.(route|get|post|put|delete)\(\s*['\"][^'\"]+" BE/app/main.py
> ```

### Sức khoẻ hệ thống

| Method | Endpoint |
|---|---|
| GET | `/` |
| GET | `/health` |
| GET | `/ready` |
| GET | `/stats` |

### Job nền

| Method | Endpoint |
|---|---|
| GET | `/api/jobs/<job_id>` |
| POST | `/api/jobs/<job_id>/cancel` |
| GET | `/jobs/<job_id>/timeline` |

### Đọc ảnh

| Method | Endpoint |
|---|---|
| GET | `/api/vision/status` |
| POST | `/api/vision/transcribe` |

### Xác thực

| Method | Endpoint |
|---|---|
| POST | `/auth/login` |
| POST | `/auth/logout` |
| GET | `/auth/me` |
| POST | `/auth/refresh` |
| POST | `/auth/register` |

### Tài liệu & ingest

| Method | Endpoint |
|---|---|
| GET | `/api/documents` |
| DELETE | `/api/documents/<document_id>` |
| GET | `/api/documents/<document_id>` |
| GET | `/api/documents/<document_id>/chunks` |
| GET | `/api/documents/<document_id>/file` |
| GET | `/api/documents/<document_id>/quizzes` |
| POST | `/api/documents/<document_id>/search` |
| GET | `/api/documents/<document_id>/sections` |
| GET | `/api/documents/<document_id>/study-maps` |
| POST | `/api/documents/upload` |
| GET | `/chunk-text/<int:chunk_id>` |
| POST | `/delete-source` |
| GET | `/list-indexed` |
| GET | `/memory-tree-status` |
| GET | `/memory-tree/<source_stem>` |
| DELETE | `/sources/<source_id>` |
| GET | `/sources/<source_id>/status` |
| POST | `/upload` |
| POST | `/upload-file` |
| POST | `/upload-multiple` |

### Hỏi đáp

| Method | Endpoint |
|---|---|
| POST | `/api/search` |
| DELETE | `/conversations/<conversation_id>` |
| POST | `/conversations/<conversation_id>/clear-context` |
| GET | `/conversations/<conversation_id>/messages` |
| POST | `/query` |
| POST | `/query-resume/<job_id>` |
| GET | `/query-status/<job_id>` |
| GET | `/query-stream/<job_id>` |

### Sơ đồ tư duy

| Method | Endpoint |
|---|---|
| POST | `/generate-mindmap` |
| POST | `/mindmap-cancel/<job_id>` |
| GET | `/mindmap-status/<job_id>` |
| GET | `/mindmaps` |
| PUT | `/mindmaps/<mindmap_id>` |
| DELETE | `/mindmaps/<string:mindmap_id>` |

### Tóm tắt

| Method | Endpoint |
|---|---|
| POST | `/generate-summary` |
| GET | `/summaries` |
| DELETE | `/summaries/<string:summary_id>` |
| POST | `/summary-cancel/<job_id>` |
| GET | `/summary-status/<job_id>` |

### Study Map

| Method | Endpoint |
|---|---|
| GET | `/api/study-maps/<map_id>` |
| POST | `/api/study-maps/generate` |
| GET | `/api/study-maps/jobs/<job_id>` |
| POST | `/api/study-maps/jobs/<job_id>/cancel` |

### Quiz & bài làm

| Method | Endpoint |
|---|---|
| GET | `/api/attempts/<attempt_id>` |
| PATCH | `/api/attempts/<attempt_id>/answers` |
| GET | `/api/attempts/<attempt_id>/concept-masteries` |
| POST | `/api/attempts/<attempt_id>/submit` |
| GET | `/api/attempts/jobs/<job_id>` |
| GET | `/api/practice/<practice_quiz_id>` |
| GET | `/api/practice/<practice_quiz_id>/comparison` |
| POST | `/api/practice/<practice_quiz_id>/submit` |
| POST | `/api/practice/generate` |
| GET | `/api/quizzes/<quiz_id>` |
| GET | `/api/quizzes/<quiz_id>/attempts` |
| POST | `/api/quizzes/<quiz_id>/attempts` |
| POST | `/api/quizzes/generate` |
| GET | `/api/quizzes/jobs/<job_id>` |
| POST | `/api/quizzes/jobs/<job_id>/cancel` |
| GET | `/api/quizzes/jobs/<job_id>/validation-logs` |
| GET | `/api/quizzes/results/<attempt_id>` |

### Tiến độ & ôn tập

| Method | Endpoint |
|---|---|
| GET | `/api/progress/attempts` |
| GET | `/api/progress/concepts` |
| GET | `/api/progress/overview` |
| GET | `/api/review-plans/<attempt_id>` |
| GET | `/api/review-plans/<review_plan_id>/items` |
| POST | `/api/review-plans/generate` |

**Huỷ job:** `/api/jobs/<job_id>/cancel` chỉ nhận `mindmap`, `summary`, `quiz_generation`,
`study_map_generation` — những loại mà executor thật sự đọc cờ huỷ. Loại khác trả **409**
thay vì hứa suông (xem `.playbook/known-issues.md`).

## Các tính năng chính

### 1. Document Ingestion Pipeline

```
Document Upload → Text Extraction → Semantic Chunking → Embedding → FAISS Index
                                        ↓
                               QR Code Generation → Video Encoding
                                        ↓
                               Memory Tree Construction
```

**Chi tiết:**
- **Text Extraction**: Hỗ trợ PDF (PyMuPDF), DOCX (python-docx), TXT, Images (OCR via Tesseract)
- **Semantic Chunking**: Sử dụng `SemanticChunker` từ LangChain với embedding model
- **QR Encoding**: Mỗi chunk được mã hoá thành QR code frame, ghép thành video MP4
- **Metadata**: Parent-child relationships, order, checksum cho data integrity

### 2. Memory Tree Architecture

```
MemoryTree
├── Document Node (root)
│   ├── Summary (LLM-generated)
│   ├── Intent Type (definition/procedure/argument/comparison/reference)
│   └── Embedding (384-dim vector)
│
└── Section Nodes (children)
    ├── Title
    ├── Summary
    ├── Chunk References
    ├── Intent Type
    └── Embedding
```

**Query Routing:**
- **Overview**: Ưu tiên document-level nodes
- **Main Points**: Lấy cả document + section summaries
- **Detail/How**: Ưu tiên section nodes, nhiều chunks
- **Compare**: Nhiều section nodes để so sánh
- **Locate**: Fallback sang chunk-level search

### 3. Mind Map Generation (CMGN Algorithm)

**Coreference-Guided Mind-Map Network** sử dụng 3-phase pipeline:

```
1. Sentence Extraction
   └── Parse document → list of sentences with IDs

2. Coreference Graph Building
   ├── Identify entities
   ├── Cluster co-referential mentions
   └── Build semantic edges

3. Mind Map Generation
   └── Tree structure with:
       - Root (topic)
       - Branch 1 (coreference cluster)
       ├── Sub-branch 1.1
       └── Sub-branch 1.2
       - Branch 2
       └── ...
```

**Critics (3-phase refinement):**
1. **Factuality Critic**: Kiểm tra độ chính xác vs source
2. **Local Structure Critic**: Đảm bảo specificity của nodes
3. **Global Structure Critic**: Cân bằng bố cục toàn cục

### 4. Advanced Summarization

Hệ thống tóm tắt đa phương pháp:

| Method | Description |
|--------|-------------|
| **DANCER** | Divide-and-Conquer: Chia tài liệu → tóm tắt từng phần → tổng hợp |
| **Entity Chain** | Trích xuất entities → tạo summary dựa trên chain |
| **Chain of Density** | Iterative enrichment với increasing entity density |
| **Structured Extraction** | Chuyển đổi sang JSON có cấu trúc |
| **FactCC** | Kiểm chứng tính nhất quán vs source |

### 5. Hybrid Retrieval

```python
# Retrieval strategy
Final_Results = α × Semantic_Scores + β × BM25_Scores + γ × MemoryTree_Scores
```

- **Semantic Search**: FAISS vector similarity
- **Keyword Search**: BM25 sparse retrieval
- **Memory Tree**: Summary-level retrieval với query routing

---

## Mô hình AI/ML

### Embedding Models

| Model | Dimension | Use Case |
|-------|-----------|----------|
| `sentence-transformers/all-MiniLM-L6-v2` | 384 | Default, fast |
| `sentence-transformers/all-mpnet-base-v2` | 768 | High quality |

### LLM Models

| Model | Provider | Use Case |
|-------|----------|----------|
| `qwen3.5:9b` | Ollama | Chat & general Q&A |
| `qwen2.5:14b` | Ollama | Summary & Mind Map |
| `gemma2:2b` | Ollama | Intent classification |
| `gemini-2.5-flash` | Google | Cloud alternative |
| `llama-3.3-70b-versatile` | Groq | Cloud alternative |

### Query Routing (No-LLM Heuristics)

```python
def classify_query_type(query: str) -> str:
    # Fast keyword-based classification (~1ms)
    if "tóm tắt" in query: return "overview"
    if "ý chính" in query: return "main_points"
    if "chi tiết" in query: return "detail"
    if "so sánh" in query: return "compare"
    # ... more patterns
```

---

## Lưu trữ dữ liệu

### Directory Structure

```
BE/
├── index/                      # Vector index
│   ├── index.faiss             # FAISS index file
│   ├── index.json              # Metadata (chunk_id → text, video, etc.)
│   └── source_registry.json    # Upload status tracking
│
├── memory/                     # High-level memory artifacts
│   ├── memory_index.faiss      # Memory vectors
│   ├── memory_index.json       # Memory metadata
│   ├── memory_trees.json       # Tree nodes (document + sections)
│   ├── mindmaps.json           # Generated mind maps
│   └── summaries.json          # Saved summaries
│
├── videos/                     # QR-encoded videos
│   └── *.mp4                   # One video per upload
│
└── input_docs/                # Original uploads
    └── *.pdf, *.docx, *.txt
```

### SQLite Databases

| Database | Tables | Purpose |
|----------|--------|---------|
| `jobs.sqlite` | jobs | Job tracking (ingest, query, mindmap) |
| `sessions.sqlite` | sessions, messages | Chat history |
| `checkpoints.sqlite` | checkpoints | LangGraph state persistence |

### Index JSON Schema

```json
{
  "123": {
    "text": "Chunk content...",
    "video": "source_filename_timestamp.mp4",
    "timestamp": "2025-05-23T12:00:00",
    "parent_id": null,
    "sub_order": 1,
    "total_parts": 1,
    "is_subchunk": false,
    "embedding": [0.123, ...]
  },
  "__meta__": {
    "version": "1.0",
    "created_at": "2025-05-23T12:00:00",
    "num_chunks": 150,
    "vector_backend": "langchain_faiss"
  }
}
```

### Memory Tree Node Schema

```json
{
  "tree_id": "memtree_source1",
  "source_stem": "report_20250523",
  "built_at": "2025-05-23T12:00:00Z",
  "version": "1.0",
  "status": "completed",
  "nodes": [
    {
      "memory_id": "mem_doc_source1",
      "type": "document",
      "title": "Tài liệu: report_20250523",
      "summary": "Generated document summary...",
      "embedding": [0.456, ...],
      "chunk_refs": ["0", "1", "2"],
      "children": ["mem_sec_source1_0", "mem_sec_source1_1"],
      "metadata": {"source_stem": "report_20250523", "num_chunks": 45},
      "intent_type": "argument"
    }
  ]
}
```

---

## Docker Deployment

### docker-compose.yml

```yaml
services:
  backend:
    build: ./BE
    ports:
      - "8080:8080"
    volumes:
      - ./data/videos:/app/videos
      - ./data/index:/app/index
      - ./data/memory:/app/memory
      - ./data/input_docs:/app/input_docs
    environment:
      DATA_DIR: /app
      PORT: "8080"
      OLLAMA_HOST: http://host.docker.internal:11434
      SLM_MODEL_CHAT: qwen3.5:9b
      USE_LC_VECTOR_STORE: "1"
      USE_LC_QA_CHAIN: "1"
    extra_hosts:
      - "host.docker.internal:host-gateway"

  frontend:
    build: .
    ports:
      - "3000:3000"
    depends_on:
      - backend
```

### Docker Commands

```bash
# Build and start
docker-compose up --build

# Start in background
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down

# Rebuild after code changes
docker-compose up --build --force-recreate
```

### Production Considerations

1. **Volume Mounts**: Data persists in `./data/` on host
2. **OLLAMA_HOST**: Use `host.docker.internal` on Windows/Mac
3. **CORS**: Set `CORS_ORIGINS` for production domains
4. **Health Check**: Backend health endpoint at `/health`

---

## Development

### Project Structure Guidelines

```
BE/
├── core_modules/     # Pure business logic, no Flask imports
├── services/         # External integrations (LLM, embedding)
├── storage/          # Data persistence
├── graphs/          # LangGraph pipelines
└── main.py          # Flask app + routes only
```

### Adding New Features

1. **New API Endpoint**: Add to `main.py`
2. **New Service**: Add to appropriate directory under `BE/`
3. **New Frontend Component**: Add to `FE/src/components/Layout/`

### Testing

```bash
# Run all tests
cd BE
pytest tests/

# Run specific test
pytest tests/test_query.py -v

# With coverage
pytest tests/ --cov=. --cov-report=html
```

### Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `DATA_DIR` | `./BE` | Root data directory |
| `VIDEO_DIR` | `$DATA_DIR/videos` | QR video storage |
| `INDEX_DIR` | `$DATA_DIR/index` | Vector index |
| `MEMORY_DIR` | `$DATA_DIR/memory` | Memory artifacts |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama server |
| `SLM_MODEL_CHAT` | `qwen3.5:9b` | Chat model |
| `SLM_MODEL_SUMMARY` | `qwen2.5:14b` | Summary model |
| `EMBEDDING_MODEL_NAME` | `all-MiniLM-L6-v2` | Embedding model |
| `QUERY_CACHE_TTL_SEC` | `1800` | Query cache TTL |
| `USE_LC_VECTOR_STORE` | `0` | Use LangChain FAISS |

---

## License & Credits

Dự án được phát triển cho mục đích nghiên cứu khoa học.

**Authors**: Lê Vũ Anh

**Tech Stack**:
- Backend: Python, Flask, LangChain, LangGraph, FAISS
- Frontend: React, TailwindCSS, Vite
- AI: Ollama, Gemini, Groq, HuggingFace
