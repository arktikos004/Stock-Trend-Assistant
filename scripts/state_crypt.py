"""state 分支私有資料的加密封包（AES-256-GCM）。

公開 repo 的 state 分支只能放可公開的東西。依資料來源條款不得再散布的檔案——yfinance 價格
（Yahoo 條款限個人使用）、新聞標題資料庫（FinMind／Yahoo 條款不含再散布）——改以加密封包
`private.tar.gz.enc` 存放，金鑰只在 GitHub Secret `STATE_KEY`（base64 編碼的 32 bytes）。

用法：
  python scripts/state_crypt.py keygen
  python scripts/state_crypt.py pack   --src backend --out _state/private.tar.gz.enc "data_cache/*.parquet"
  python scripts/state_crypt.py unpack --bundle _state/private.tar.gz.enc --dest backend \\
         [--legacy-from _state "data_cache/*.parquet"]

`--legacy-from`：遷移用。封包還不存在時（第一次切換前的 state 只有明文），改從舊位置複製明文；
封包存在時一律以封包為準。解密失敗（金鑰錯、檔案被竄改）一律非零結束，絕不默默降級。
"""

from __future__ import annotations

import argparse
import base64
import io
import os
import secrets
import shutil
import sys
import tarfile
from pathlib import Path

MAGIC = b"STC1"
NONCE_BYTES = 12


class StateCryptError(RuntimeError):
    """金鑰缺漏／格式錯誤、封包損毀或遭竄改。"""


def _key() -> bytes:
    raw = os.environ.get("STATE_KEY", "").strip()
    if not raw:
        raise StateCryptError("缺少環境變數 STATE_KEY（GitHub Secret）")
    try:
        key = base64.b64decode(raw, validate=True)
    except ValueError as exc:
        raise StateCryptError("STATE_KEY 不是合法的 base64") from exc
    if len(key) != 32:
        raise StateCryptError(f"STATE_KEY 應為 32 bytes，實際 {len(key)} bytes")
    return key


def _collect(src: Path, patterns: list[str]) -> list[Path]:
    files = sorted({p for pattern in patterns for p in src.glob(pattern) if p.is_file()})
    if not files:
        raise StateCryptError(f"{src} 底下找不到符合 {patterns} 的檔案")
    return files


def pack(src: Path, patterns: list[str], out: Path) -> list[str]:
    """把 src 底下符合 patterns 的檔案打包加密到 out；回傳打包的相對路徑。"""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    files = _collect(src, patterns)
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        for path in files:
            tar.add(path, arcname=path.relative_to(src).as_posix())
    nonce = secrets.token_bytes(NONCE_BYTES)
    sealed = AESGCM(_key()).encrypt(nonce, buffer.getvalue(), MAGIC)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(MAGIC + nonce + sealed)
    return [p.relative_to(src).as_posix() for p in files]


def unpack(bundle: Path, dest: Path) -> list[str]:
    """解密並解開封包到 dest；回傳解出的相對路徑。"""
    from cryptography.exceptions import InvalidTag
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    blob = bundle.read_bytes()
    if not blob.startswith(MAGIC):
        raise StateCryptError(f"{bundle} 不是 state_crypt 封包")
    nonce, sealed = blob[len(MAGIC) : len(MAGIC) + NONCE_BYTES], blob[len(MAGIC) + NONCE_BYTES :]
    try:
        plain = AESGCM(_key()).decrypt(nonce, sealed, MAGIC)
    except InvalidTag as exc:
        raise StateCryptError(f"{bundle} 解密失敗：金鑰不符或檔案遭竄改") from exc
    dest.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(plain), mode="r:gz") as tar:
        names = tar.getnames()
        tar.extractall(dest, filter="data")  # 擋下絕對路徑、..、連結
    return names


def copy_legacy(legacy: Path, patterns: list[str], dest: Path) -> list[str]:
    """遷移：從舊的明文位置複製到 dest（保留相對路徑）。"""
    copied = []
    for path in _collect(legacy, patterns):
        rel = path.relative_to(legacy)
        (dest / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, dest / rel)
        copied.append(rel.as_posix())
    return copied


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="state 分支私有資料的加密封包")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("keygen", help="產生新的 STATE_KEY（貼到 GitHub Secret）")
    p_pack = sub.add_parser("pack")
    p_pack.add_argument("--src", required=True, type=Path)
    p_pack.add_argument("--out", required=True, type=Path)
    p_pack.add_argument("patterns", nargs="+")
    p_unpack = sub.add_parser("unpack")
    p_unpack.add_argument("--bundle", required=True, type=Path)
    p_unpack.add_argument("--dest", required=True, type=Path)
    p_unpack.add_argument("--legacy-from", nargs="+", metavar=("DIR", "PATTERN"))
    args = parser.parse_args(argv)

    try:
        if args.command == "keygen":
            print(base64.b64encode(secrets.token_bytes(32)).decode("ascii"))
        elif args.command == "pack":
            names = pack(args.src, args.patterns, args.out)
            print(f"已加密 {len(names)} 個檔案 → {args.out}")
        elif args.bundle.exists():
            names = unpack(args.bundle, args.dest)
            print(f"已解密 {len(names)} 個檔案 → {args.dest}")
        elif args.legacy_from and len(args.legacy_from) >= 2:
            names = copy_legacy(Path(args.legacy_from[0]), args.legacy_from[1:], args.dest)
            print(f"警告：{args.bundle} 不存在，改從明文舊位置複製 {len(names)} 個檔案（僅限遷移）")
        else:
            raise StateCryptError(f"{args.bundle} 不存在")
    except StateCryptError as exc:
        print(f"錯誤：{exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
