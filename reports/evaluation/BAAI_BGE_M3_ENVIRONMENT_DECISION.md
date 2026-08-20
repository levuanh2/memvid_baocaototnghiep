# BAAI/bge-m3 environment decision audit

**Decision requested:** approve Option A as a bundled change to `torch==2.10.0+cpu`, immutable checkpoint governance, and loader locking. Do not approve Option B in its current form.

This report is a read-only environment audit for P0.0. No package or checkpoint was changed or downloaded. No benchmark or metric was run. `study_manifest.final_benchmark_authorized` remains `false`.

## Recommended environment decision

Choose **Option A** after explicit approval. Pin `torch==2.10.0+cpu`, the minimum release patched for the current `weights_only=True` deserialization advisory. Keep the current Python, Transformers, sentence-transformers, and safetensors versions, subject to the pre-build compatibility gates in this report.

Option A can preserve the audited model commit and weight file. Option B cannot: the available `model.safetensors` belongs to an unmerged conversion PR commit, not the audited main commit. Its conversion provenance is credible, but tensor-by-tensor equality was not independently verified in a safe environment.

Approval of Option A also requires a loader correction. The R2 loader currently forces `use_safetensors=True`. Because the exact main snapshot has no safetensors file, upgrading PyTorch alone would still leave R2 unable to load it.

After approval, every R0/R1/R2 path must pass the same immutable revision. Each path must load the trusted `.bin` with `weights_only=True`, without automatic conversion or resolving a different revision.

## Current environment is CPU-only and passes declared dependency checks

The active environment is the repository virtual environment at `.venv`. Package metadata reports no broken requirements, but that check does not exercise the Transformers runtime security gate.

| Component | Current value | Audit interpretation |
| --- | --- | --- |
| OS / architecture | Windows 10 build 26200, AMD64 | Host platform used by the active environment |
| Python | CPython 3.11.9 | Matches `reports/evaluation/baseline_manifest.json` |
| PyTorch | `2.5.1+cpu` | CPU-only build; blocked for `.bin` loading by Transformers 5.9.0 |
| CUDA visible to PyTorch | `torch.version.cuda=None`; `torch.cuda.is_available() == False`; device count `0` | The active runtime is CPU-only, regardless of host GPU hardware |
| Transformers | `5.9.0` | Accepts PyTorch 2.4+ in dependency metadata, but requires 2.6+ at runtime for `torch.load` |
| sentence-transformers | `5.5.1` | Declares Transformers `>=4.41,<6` and PyTorch `>=1.11` |
| safetensors | `0.7.0` | Installed and usable, but the exact main checkpoint has no safetensors weights |
| huggingface-hub | `1.16.1` | Cache and revision resolution layer |
| tokenizers | `0.22.1` | Tokenizer runtime |
| accelerate | `1.13.0` | Related model-loading runtime |
| NumPy / SciPy / scikit-learn | `2.2.6` / `1.16.3` / `1.8.0` | Numerical embedding dependencies |
| FAISS CPU | `1.13.1` | Evaluation index backend |
| LangChain | `0.3.30` | Current orchestration package |
| langchain-core / community / huggingface | `0.3.86` / `0.3.31` / `0.3.1` | Embedding and FAISS integration path |
| rank-bm25 / sentencepiece | `0.2.2` / `0.2.1` | Sparse retrieval and tokenizer dependency |
| torchvision / torchaudio | Not installed | No installed companion-wheel conflict to resolve |

The repository hard-pins `torch==2.5.1+cpu` in `requirements.txt:24-26` and `BE/requirements.txt:51-55`. It does not pin Transformers, sentence-transformers, or safetensors there. That mix allowed the resolver to retain old PyTorch while installing a newer Transformers runtime.

## Exact checkpoint resolved by this audit

### Repository names the model but does not pin its revision

The model ID is consistently `BAAI/bge-m3`:

- `reports/evaluation/configs/R0_recursive.yaml:8`
- `reports/evaluation/configs/R1_structure.yaml:8`
- `reports/evaluation/configs/R2_late.yaml:8`
- `reports/evaluation/baseline_manifest.json:14`
- `BE/app/domains/ingest/late_chunk.py:123-130`
- `docker-compose.yml:53,137,180,228`

The repository does **not** currently pin a Hugging Face revision. Both runtime loading paths omit `revision`, although the baseline manifest says `checkpoint_frozen_by_name: true`. Therefore, `5617...` is the exact revision resolved by the audited local `main` cache. Repository source does not yet enforce that revision, so governance must approve it as the frozen P0.0 checkpoint before any environment change or build.

### The audited cache resolves main to one immutable commit

| Field | Exact value |
| --- | --- |
| Model ID | `BAAI/bge-m3` |
| Resolved ref | `main` |
| Commit / revision | `5617a9f61b028005a4858fdac845db406aefb181` |
| Weight file | `pytorch_model.bin` |
| Weight size | `2,271,145,830` bytes |
| Weight SHA-256 / Hugging Face LFS object ID | `b5e0ce3470abf5ef3831aa1bd5553b486803e83251590ab7ff35a117cf6aad38` |
| Safetensors at this revision | None; local negative cache records both `model.safetensors` and its index as absent |
| Architecture | `XLMRobertaModel`, 24 layers, hidden size 1024, float32 |
| Context configuration | `max_position_embeddings=8194`; sentence-transformers `max_seq_length=8192` |
| Sentence-transformers modules | Transformer, Pooling, Normalize |
| Upstream pooling config | CLS pooling enabled; mean pooling disabled |

The project's custom late-chunk path deliberately uses mean pooling. Reproducibility therefore depends on the exact weights, tokenizer/config files, and project pooling implementation. The model name alone does not provide a sufficient checkpoint lock.

### Checkpoint files that must be locked

The following hashes were computed from the cached dense-runtime inputs at `5617...`. They do not claim to inventory every optional sparse or ColBERT artifact in the full upstream repository.

| File | SHA-256 |
| --- | --- |
| `pytorch_model.bin` | `b5e0ce3470abf5ef3831aa1bd5553b486803e83251590ab7ff35a117cf6aad38` |
| `config.json` | `26159e7ad065073448460117eb24b7a4572f6f4e78eadff65dc0a11c052449fa` |
| `config_sentence_transformers.json` | `1eef72430e7194a1e59680e635aed81ffa083f05668dbc5bb1c56c04c0999c38` |
| `modules.json` | `84e40c8e006c9b1d6c122e02cba9b02458120b5fb0c87b746c41e0207cf642cf` |
| `sentencepiece.bpe.model` | `cfc8146abe2a0488e9e2a0c56de7952f7c11ab059eca145a0a727afce0db2865` |
| `sentence_bert_config.json` | `eb9b44b13c0f52a3b3685c3b1cbdea1ba8b04bea123b98f61610048940776eb1` |
| `special_tokens_map.json` | `8c785abebea9ae3257b61681b4e6fd8365ceafde980c21970d001e834cf10835` |
| `tokenizer.json` | `21106b6d7dab2952c1d496fb21d5dc9db75c28ed361a05f5020bbba27810dd08` |
| `tokenizer_config.json` | `a62b2b6784f990259fddef5f16388693a8043be4f69179e6a5257eeb3f9abac4` |
| `1_Pooling/config.json` | `e54c164a07274f2eb45bb724f54a79d1efcc90c41573887cd9a29aeee0597352` |

`README.md` is not runtime input, but its audited SHA-256 is `0b81ccf9134e5874d620a86e6905062ea999e779c34eb1a7e65eaeb7fe00e450`.

## Why `pytorch_model.bin` is rejected

The rejection is a runtime security decision, not a normal dependency-resolution conflict. `pip check` succeeds because declared version ranges are broad enough. Transformers applies a stricter condition only when it is about to deserialize a non-safetensors file.

### R0 and R1 reach the Transformers torch.load security guard

1. `BE/evaluation/index_builder.py:12-16,42-55` reads the representation config, sets `EMBEDDING_MODEL_NAME` and `LATE_CHUNKING`, then calls `get_embeddings()`.
2. With `late_chunking: false`, `BE/app/clients/llm_factory.py:383-393` creates `langchain_huggingface.HuggingFaceEmbeddings` on CPU. It passes neither `revision` nor `use_safetensors`.
3. LangChain creates `sentence_transformers.SentenceTransformer`, which reaches Transformers `AutoModel.from_pretrained`.
4. Transformers 5.9.0 first looks for safetensors. The exact `5617...` snapshot has none, so it selects `pytorch_model.bin`.
5. `transformers.modeling_utils.load_state_dict()` sees the non-safetensors suffix and calls `check_torch_load_is_safe()` before `torch.load`.
6. The guard raises because `2.5.1+cpu < 2.6`. The checkpoint is never deserialized.

The local diagnostic trace was:

```text
AutoModel.from_pretrained
  -> PreTrainedModel.from_pretrained
  -> _load_pretrained_model
  -> load_state_dict
  -> check_torch_load_is_safe
  -> ValueError: require torch at least v2.6 for torch.load
```

Transformers 5.9.0 implements this exact guard in `utils/import_utils.py`. That guard addresses CVE-2025-32434 and allows PyTorch 2.6.0. A newer PyTorch advisory, CVE-2026-24747, affects `weights_only=True` through 2.9.1 and is patched in 2.10.0. Therefore, the Transformers guard explains the current error but is not the current security floor. See the [Transformers 5.9.0 guard](https://raw.githubusercontent.com/huggingface/transformers/v5.9.0/src/transformers/utils/import_utils.py), the [older advisory](https://github.com/advisories/GHSA-53q9-r3pm-6pq6), the [current PyTorch advisory](https://github.com/pytorch/pytorch/security/advisories/GHSA-63cw-57p8-fm3p), and the [Transformers security policy](https://github.com/huggingface/transformers/security/policy).

### R2 forces unavailable safetensors and can resolve a different revision

R2 follows a different loading path that creates an additional provenance risk:

1. `BE/app/clients/llm_factory.py:369-381` returns the custom `LateChunkEncoder`.
2. `BE/app/domains/ingest/late_chunk.py:170-185` calls `AutoModel.from_pretrained(..., use_safetensors=True)` without a revision.
3. The exact main revision has no safetensors file. Offline loading fails with a missing-file error.
4. Transformers may start its automatic conversion path when online and resolve a conversion PR ref. That is how a safetensors file from `refs/pr/130` can enter the cache without belonging to `main`.
5. `BE/evaluation/index_builder.py:103-118` records a late-chunk failure and attempts independent embedding fallback. That fallback still uses the same custom encoder when late chunking is globally enabled, so it does not make the exact main snapshot loadable.

Therefore, Option A requires a post-approval loader correction. Leaving `use_safetensors=True` in R2 would either fail or allow revision drift; neither result is valid for P0.0.

## Option A: upgrade PyTorch to the patched 2.10.0 CPU build

### Lock the official torch 2.10.0 CPU wheel

Use `torch==2.10.0+cpu`, not an open-ended range. This is the smallest release outside the affected range in CVE-2026-24747.

For the audited CPython 3.11 Windows AMD64 environment, lock this exact wheel:

```text
torch-2.10.0+cpu-cp311-cp311-win_amd64.whl
sha256:17a09465bab2aab8f0f273410297133d8d8fb6dd84dccbd252ca4a4f3a111847
```

The wheel and hash are published in the official PyTorch CPU index. See the [official wheel index](https://download.pytorch.org/whl/cpu/torch/) and [PyTorch security advisory](https://github.com/pytorch/pytorch/security/advisories/GHSA-63cw-57p8-fm3p).

### Current package ranges accept torch 2.10.0

- Transformers 5.9.0 declares PyTorch `>=2.4` for its torch extra. Its local runtime guard accepts 2.10.0 because 2.10.0 exceeds the guard's 2.6 floor.
- sentence-transformers 5.5.1 accepts Transformers `>=4.41,<6` and PyTorch `>=1.11`. Its [official package metadata](https://raw.githubusercontent.com/UKPLab/sentence-transformers/v5.5.1/pyproject.toml) includes both ranges.
- safetensors 0.7.0 remains compatible and unchanged.
- The CPU-only wheel preserves the current compute backend. It does not activate CUDA or introduce CUDA toolkit packages.
- torchvision and torchaudio are absent, so no companion package needs a synchronized upgrade in this environment.
- `pip check` is expected to remain clean, but this must be re-run after installation in a fresh environment.

### A single-package upgrade still requires a clean rebuild

The dependency risk is moderate. This proposal moves from PyTorch 2.5.1 to 2.10.0 because releases through 2.9.1 remain affected by the newer advisory. PyTorch controls tensor deserialization and CPU numerical kernels, so low-order floating-point differences are possible.

Build every R0/R1/R2 index from scratch under the same new locked environment. Do not mix existing indices or embeddings made with PyTorch 2.5.1 with new artifacts. Record the new environment identity in each evaluation index manifest before any benchmark authorization.

### Required loader behavior after approval

All model and tokenizer loads must use:

```text
model_id = BAAI/bge-m3
revision = 5617a9f61b028005a4858fdac845db406aefb181
weight = pytorch_model.bin
weight_sha256 = b5e0ce3470abf5ef3831aa1bd5553b486803e83251590ab7ff35a117cf6aad38
local_files_only = true during controlled build
weights_only = true
use_safetensors = false for this exact revision
```

This does not change the model revision. It turns the currently mutable name into the immutable commit already resolved by the audited cache.

## Option B: use a safetensors revision

### The only safetensors candidate is an unmerged conversion PR

The local cache contains this separate ref:

| Field | Value |
| --- | --- |
| Ref | `refs/pr/130` |
| Commit | `9a0624b896d81da7492a910ffa53731274b6cf3d` |
| Parent | `5617a9f61b028005a4858fdac845db406aefb181` |
| Added file | `model.safetensors` |
| File size | `2,271,064,456` bytes |
| SHA-256 / LFS object ID | `993b2248881724788dcab8c644a91dfd63584b6e5604ff2037cb5541e1e38e7e` |
| Status on audit date | Automated PR, ready to merge, not merged into the required main revision |

Hugging Face's SFconvertbot states that the safetensors conversion service produced this file and that it is equivalent to `pytorch_model.bin`. The conversion commit has the required main commit as its direct parent. It adds only the safetensors file. See [discussion #130](https://huggingface.co/BAAI/bge-m3/discussions/130) and [conversion commit `9a0624b`](https://huggingface.co/BAAI/bge-m3/commit/9a0624b896d81da7492a910ffa53731274b6cf3d).

### Why Option B is not acceptable now

Option B fails the audit acceptance criteria for three reasons:

- It changes the revision from the audited main commit to an unmerged PR commit.
- The provenance is an automated third-party conversion PR, not an owner-merged artifact at the required revision.
- Tensor names, dtypes, shapes, and values were not compared tensor by tensor in a safe environment. Matching parentage, tensor counts, and conversion-service claims are supporting evidence, not an independent equality proof.

Option B may be reconsidered only if the model owner merges the safetensors file into an accepted immutable revision, or if governance explicitly permits the PR revision after safe tensor-by-tensor equivalence verification. Either event requires a new checkpoint decision; it cannot be treated as the current exact checkpoint.

## Option A preserves the checkpoint; Option B changes it

| Criterion | Option A: PyTorch 2.10.0 CPU | Option B: safetensors PR revision |
| --- | --- | --- |
| Correctness | High, provided loader is corrected to read the exact trusted `.bin` | Unproven tensor equality under the present audit constraints |
| Reproducibility | High after commit, file, wheel, and full environment hashes are locked | Medium to low while PR remains unmerged and differs from main |
| Benchmark validity | Acceptable if all R0/R1/R2 artifacts are rebuilt under one locked environment | Not acceptable without a new checkpoint decision and equality proof |
| Dependency risk | Moderate; a multi-release PyTorch change, gated by fresh-environment validation | Low runtime dependency risk, but requires model revision/config changes |
| Provenance risk | Low; uses the BAAI main checkpoint already resolved locally | Medium to high; automated conversion PR, not owner-merged |
| Security posture | Uses the patched `torch.load(weights_only=True)` boundary | Safetensors avoids pickle loading, but provenance criteria are not met |
| Current decision | **Recommended** | **Rejected for P0.0** |

## Exact versions and hashes to lock after approval

Lock the complete embedding/index environment, not only PyTorch:

```text
Python==3.11.9
torch==2.10.0+cpu
transformers==5.9.0
sentence-transformers==5.5.1
safetensors==0.7.0
huggingface-hub==1.16.1
tokenizers==0.22.1
accelerate==1.13.0
numpy==2.2.6
scipy==1.16.3
scikit-learn==1.8.0
faiss-cpu==1.13.1
langchain==0.3.30
langchain-core==0.3.86
langchain-community==0.3.31
langchain-huggingface==0.3.1
langchain-text-splitters==0.3.11
rank-bm25==0.2.2
sentencepiece==0.2.1
pandas==2.3.3
pydantic==2.10.6
```

The mandatory new package artifact lock is:

```text
torch-2.10.0+cpu-cp311-cp311-win_amd64.whl
sha256:17a09465bab2aab8f0f273410297133d8d8fb6dd84dccbd252ca4a4f3a111847
```

The mandatory checkpoint locks are the commit and checkpoint-file hashes listed above. Before installation, generate a platform-specific lock with hashes for every transitive wheel.

Installed package metadata does not preserve every original wheel hash. Obtain those hashes from official indexes and verify them in the fresh environment. Do not invent or omit a hash under `--require-hashes`.

## Commands to run only after approval

These commands are a proposed controlled sequence. They were not run during this audit.

### 1. Prepare a fresh environment and a hash-locked package file

Update both repository pins from `torch==2.5.1+cpu` to `torch==2.10.0+cpu`. Pin the versions listed above. Create a Windows CPython 3.11 lock file whose torch entry uses this direct artifact URL:

```text
torch @ https://download.pytorch.org/whl/cpu/torch-2.10.0%2Bcpu-cp311-cp311-win_amd64.whl \
    --hash=sha256:17a09465bab2aab8f0f273410297133d8d8fb6dd84dccbd252ca4a4f3a111847
```

This wheel lock is specific to CPython 3.11 on Windows AMD64. A Linux Docker build requires its own official wheel URL and SHA-256; do not reuse the Windows artifact hash across platforms.

Then create a fresh virtual environment instead of mutating the audited one:

```powershell
py -3.11 -m venv .venv-bge-m3-p0
& .\.venv-bge-m3-p0\Scripts\python.exe -m pip install --require-hashes -r <approved-full-lock-file>
& .\.venv-bge-m3-p0\Scripts\python.exe -m pip check
```

### 2. Verify environment identity

```powershell
& .\.venv-bge-m3-p0\Scripts\python.exe -c "import torch, transformers, sentence_transformers, safetensors; print(torch.__version__, torch.version.cuda, torch.cuda.is_available()); print(transformers.__version__, sentence_transformers.__version__, safetensors.__version__)"
& .\.venv-bge-m3-p0\Scripts\python.exe -m pip freeze --all
```

Expected result: PyTorch reports `2.10.0+cpu`, CUDA reports `None` and `False`, and the other three packages exactly match the approved versions.

### 3. Pin and verify the checkpoint before model loading

Apply the approved loader change so every `AutoTokenizer`, `AutoModel`, SentenceTransformer, and LangChain entry point receives the same immutable revision. Disable automatic safetensors conversion for this checkpoint and use local-only resolution during the controlled build.

```powershell
$snapshot = 'C:\Users\Vu Anh\.cache\huggingface\hub\models--BAAI--bge-m3\snapshots\5617a9f61b028005a4858fdac845db406aefb181'
Get-FileHash -Algorithm SHA256 -LiteralPath "$snapshot\pytorch_model.bin"
Get-FileHash -Algorithm SHA256 -LiteralPath "$snapshot\config.json","$snapshot\tokenizer.json","$snapshot\sentencepiece.bpe.model"
```

Expected weight hash: `b5e0ce3470abf5ef3831aa1bd5553b486803e83251590ab7ff35a117cf6aad38`.

### 4. Run a load-only preflight

Run a dedicated smoke command that loads tokenizer and model from the exact local revision on CPU, asserts the model architecture and hidden size, and exits without encoding the study corpus. It must set:

```text
revision=5617a9f61b028005a4858fdac845db406aefb181
local_files_only=True
use_safetensors=False
```

This is a loader validation, not a benchmark. Do not run the index-builder commands until every gate below passes.

## Validation criteria before R0/R1/R2 build

R0/R1/R2 build is permitted only when all criteria pass:

- The approved environment is fresh and fully hash-locked. `pip check` reports no broken requirements.
- Python and all listed package versions exactly match the approved lock. The PyTorch wheel hash matches `17a0...1847`.
- PyTorch remains CPU-only: `torch.version.cuda is None` and `torch.cuda.is_available()` is false.
- Every model-loading path uses model ID `BAAI/bge-m3` and revision `5617...b181`; no call relies on mutable `main`.
- The checkpoint weight and all runtime config/tokenizer hashes match this report.
- The load-only preflight succeeds with `weights_only=True` and `use_safetensors=False`.
- Network access is disabled for the controlled load/build, or logs prove no automatic conversion, fallback revision, or checkpoint download occurred.
- R0, R1, and R2 resolve the same encoder weights and tokenizer. Their representation differences remain limited to the approved chunking and pooling design.
- R2 reports real late-chunk application or an explicit document-level structural fallback. A model-load failure must abort the build, not become a silent representation fallback.
- No pre-existing R0/R1/R2 index is reused. All three namespaces are built from scratch under the same approved environment.
- Each `evaluation_index_manifest.json` records the Python version, complete package lock hash, model ID, commit, checkpoint hashes, device/backend, pooling mode, and build code commit.
- `study_manifest.final_benchmark_authorized` remains `false` until index manifests and qrels gates pass under the separate authorization process.

## Root-cause and Option A findings have high confidence

The codebase and local cache are the primary evidence for the current state. Official PyTorch, Transformers, sentence-transformers, Hugging Face model history, and the security advisory support the compatibility and provenance conclusions.

Confidence is **high** for the root cause and Option A compatibility. Confidence is **medium** for any claim of Option B weight equivalence. The available assertion comes from the conversion service, and no safe independent tensor comparison was performed.

One implementation risk remains: every loading entry point must receive the immutable revision. The R2 safetensors override must also be removed for this exact checkpoint. Validation must prove that no path silently reaches `refs/pr/130`.

## Final status

**ENVIRONMENT DECISION REQUIRED**

- **Option A — recommended as one approval bundle:** approve `torch==2.10.0+cpu`; approve revision `5617...b181` as the frozen checkpoint; lock wheel and checkpoint hashes; patch every loader; then pass a network-off load preflight.
- **Option B — not approved:** the safetensors candidate is an unmerged PR revision. Its provenance is documented, but it changes revision and lacks an independent tensor-equality proof.
