"""Compare production frontend chunks to a local build, ignoring chunk-hash
references and Windows CRLF (which Vite emits as a literal backslash-r inside
template literals)."""
import os, re, sys

prod_dir, local_dir, names_file = sys.argv[1:4]


def norm(path):
    s = open(path, encoding="utf-8").read()
    s = re.sub(r"-[A-Za-z0-9_-]{8}\.(js|css)", r"-HASH.\1", s)
    return s.replace("\\r\n", "\n").replace("\r", "")


local = os.listdir(local_dir)
ok = bad = 0
for name in open(names_file).read().split():
    base, ext = re.match(r"(.*)-[A-Za-z0-9_-]{8}\.(js|css)$", name).groups()
    cand = [f for f in local if re.fullmatch(re.escape(base) + r"-[A-Za-z0-9_-]{8}\." + ext, f)]
    same = bool(cand) and norm(os.path.join(prod_dir, name)) == norm(os.path.join(local_dir, cand[0]))
    ok += same
    bad += not same
    print(("MATCH" if same else "DIFF"), "prod=" + name, "local=" + (cand[0] if cand else "-"))
print(f"# total={ok + bad} match={ok} diff={bad}")
