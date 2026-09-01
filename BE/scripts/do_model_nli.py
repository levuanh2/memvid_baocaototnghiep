"""So thời gian một lượt forward NLI giữa model hiện tại và ứng viên nhẹ hơn.

Bối cảnh: known-issues "(CHƯA SỬA) NLI mDeBERTa chậm gấp ~250 lần dự toán FLOP". Đo cũ:
mDeBERTa-v3-base batch 2 x 512 token = 94 GIÂY. Nút thắt KHÔNG phải tính toán (matmul
thuần trên máy này đạt 400 GFLOPS) mà là các phép gather/index tuần tự của attention
tách rời trong DeBERTa-v3 — nên thêm luồng hay gom lô đều không cứu được (16 luồng chỉ
nhanh hơn 10%).

Suy ra: model có kiến trúc attention THƯỜNG sẽ không dính bệnh đó, kể cả khi cùng cỡ.
Script này kiểm đúng suy luận ấy bằng số, thay vì tin nó.

`NLI_ENABLED=0` hiện tại chỉ tắt cho chạy thường; ablation E4_nli của luận văn vẫn cần
bật, nên vẫn cần một model chạy được.

    ./.venv/Scripts/python.exe -m scripts.do_model_nli
    ./.venv/Scripts/python.exe -m scripts.do_model_nli --chi-ung-vien
"""

from __future__ import annotations

import argparse
import statistics
import sys
import time

HIEN_TAI = "MoritzLaurer/mDeBERTa-v3-base-mnli-xnli"
UNG_VIEN = "MoritzLaurer/multilingual-MiniLMv2-L6-mnli-xnli"

CAU_A = ("Retrieval-Augmented Generation lấy đoạn văn liên quan từ kho tài liệu rồi đưa "
         "vào ngữ cảnh của mô hình ngôn ngữ trước khi sinh câu trả lời, nhờ vậy câu trả "
         "lời bám vào nguồn thay vì bịa ra.")
CAU_B = ("RAG không dùng bất kỳ tài liệu ngoài nào; mô hình chỉ trả lời bằng kiến thức "
         "đã học sẵn trong trọng số.")


def do_mot_model(ten: str, lap: int) -> dict | None:
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    print(f"\n=== {ten}")
    t0 = time.perf_counter()
    try:
        tok = AutoTokenizer.from_pretrained(ten)
        model = AutoModelForSequenceClassification.from_pretrained(ten)
    except Exception as exc:
        print(f"  NAP THAT BAI: {str(exc)[:160]}")
        return None
    model.eval()
    nap = time.perf_counter() - t0
    so_tham_so = sum(p.numel() for p in model.parameters())
    print(f"  nap        : {nap:.1f}s | {so_tham_so / 1e6:.0f}M tham so | "
          f"{model.config.num_hidden_layers} lop")

    ket = {"ten": ten, "nap": nap, "tham_so": so_tham_so}
    for do_dai in (128, 256, 512):
        batch = tok([CAU_A, CAU_B], [CAU_B, CAU_A], return_tensors="pt",
                    truncation=True, padding="max_length", max_length=do_dai)
        with torch.no_grad():
            model(**batch)                      # warm, khong tinh
        lan = []
        for _ in range(max(1, lap)):
            t = time.perf_counter()
            with torch.no_grad():
                model(**batch)
            lan.append(time.perf_counter() - t)
        p50 = statistics.median(lan)
        ket[do_dai] = p50
        print(f"  {do_dai:>3} token : {p50:>7.2f}s  (batch 2)")
    return ket


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lap", type=int, default=3)
    ap.add_argument("--chi-ung-vien", action="store_true",
                    help="bo qua model hien tai (da co so trong playbook)")
    args = ap.parse_args()

    from shared.env_loader import load_project_env
    load_project_env()

    ds = []
    if not args.chi_ung_vien:
        ds.append(do_mot_model(HIEN_TAI, args.lap))
    ds.append(do_mot_model(UNG_VIEN, args.lap))
    ds = [d for d in ds if d]

    print("\n" + "=" * 62)
    print("So do cu trong playbook (mDeBERTa): 128t 28.2s | 256t 47.7s | 512t 94s")
    print("Han hien tai NLI_TIMEOUT_SEC=90, NLI_MAX_PAIRS=3 -> 3 cap moi truy van.")
    for d in ds:
        t512 = d.get(512)
        if t512 is None:
            continue
        ca_luot = t512 * 3
        print(f"\n{d['ten']}")
        print(f"  512 token x 3 cap = {ca_luot:.1f}s cho MOT truy van")
        if ca_luot < 10:
            print("  -> DUNG DUOC cho ablation, va co the ca cho chay thuong.")
        elif ca_luot < 90:
            print("  -> Dung duoc cho ABLATION (lot han 90s), con cham cho chay thuong.")
        else:
            print("  -> VAN VUOT HAN 90s. Khong dung duoc.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
