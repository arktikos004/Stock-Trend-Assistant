"""state 分支私有資料的加密封包：來回一致、金鑰錯或遭竄改一律失敗、不會解出越界路徑。

這些檔案依資料來源條款不得公開；加密若默默降級成明文、或解密失敗卻被當成「沒有資料」，
都會在公開 repo 上留下不該有的東西或悄悄丟資料，所以失敗路徑全部釘死。
"""

import base64
import importlib.util
import io
import tarfile
from pathlib import Path

import pytest

_SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "state_crypt.py"
_spec = importlib.util.spec_from_file_location("state_crypt", _SCRIPT)
state_crypt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(state_crypt)

KEY = base64.b64encode(bytes(range(32))).decode("ascii")
OTHER_KEY = base64.b64encode(bytes(range(1, 33))).decode("ascii")


@pytest.fixture
def private_files(tmp_path):
    src = tmp_path / "src"
    (src / "data_cache").mkdir(parents=True)
    (src / "data_cache" / "2330.TW.parquet").write_bytes(b"parquet-bytes-2330")
    (src / "data_cache" / "TWII.parquet").write_bytes(b"parquet-bytes-twii")
    (src / "predictions.db").write_bytes(b"public-db")  # 不在 pattern 裡：不得被打包
    return src


def test_round_trip_restores_exact_bytes(private_files, tmp_path, monkeypatch):
    monkeypatch.setenv("STATE_KEY", KEY)
    bundle = tmp_path / "state" / "private.tar.gz.enc"
    packed = state_crypt.pack(private_files, ["data_cache/*.parquet"], bundle)
    assert packed == ["data_cache/2330.TW.parquet", "data_cache/TWII.parquet"]
    assert b"parquet-bytes" not in bundle.read_bytes()  # 封包內容不可見

    dest = tmp_path / "dest"
    state_crypt.unpack(bundle, dest)
    assert (dest / "data_cache" / "2330.TW.parquet").read_bytes() == b"parquet-bytes-2330"
    assert (dest / "data_cache" / "TWII.parquet").read_bytes() == b"parquet-bytes-twii"
    assert not (dest / "predictions.db").exists()


def test_wrong_key_fails_loudly(private_files, tmp_path, monkeypatch):
    monkeypatch.setenv("STATE_KEY", KEY)
    bundle = tmp_path / "private.tar.gz.enc"
    state_crypt.pack(private_files, ["data_cache/*.parquet"], bundle)
    monkeypatch.setenv("STATE_KEY", OTHER_KEY)
    with pytest.raises(state_crypt.StateCryptError, match="解密失敗"):
        state_crypt.unpack(bundle, tmp_path / "dest")


def test_tampered_bundle_fails_loudly(private_files, tmp_path, monkeypatch):
    monkeypatch.setenv("STATE_KEY", KEY)
    bundle = tmp_path / "private.tar.gz.enc"
    state_crypt.pack(private_files, ["data_cache/*.parquet"], bundle)
    blob = bytearray(bundle.read_bytes())
    blob[-1] ^= 0x01
    bundle.write_bytes(bytes(blob))
    with pytest.raises(state_crypt.StateCryptError, match="竄改"):
        state_crypt.unpack(bundle, tmp_path / "dest")


def test_missing_or_bad_key_is_an_error_not_a_plaintext_fallback(private_files, tmp_path, monkeypatch):
    monkeypatch.delenv("STATE_KEY", raising=False)
    with pytest.raises(state_crypt.StateCryptError, match="STATE_KEY"):
        state_crypt.pack(private_files, ["data_cache/*.parquet"], tmp_path / "x.enc")
    monkeypatch.setenv("STATE_KEY", base64.b64encode(b"short").decode())
    with pytest.raises(state_crypt.StateCryptError, match="32 bytes"):
        state_crypt.pack(private_files, ["data_cache/*.parquet"], tmp_path / "x.enc")


def test_empty_selection_is_an_error(private_files, tmp_path, monkeypatch):
    monkeypatch.setenv("STATE_KEY", KEY)
    with pytest.raises(state_crypt.StateCryptError, match="找不到"):
        state_crypt.pack(private_files, ["*.nothing"], tmp_path / "x.enc")


def test_unpack_refuses_path_traversal(tmp_path, monkeypatch):
    monkeypatch.setenv("STATE_KEY", KEY)
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        data = b"evil"
        info = tarfile.TarInfo("../escaped.txt")
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))
    nonce = b"\x00" * state_crypt.NONCE_BYTES
    sealed = AESGCM(base64.b64decode(KEY)).encrypt(nonce, buffer.getvalue(), state_crypt.MAGIC)
    bundle = tmp_path / "evil.enc"
    bundle.write_bytes(state_crypt.MAGIC + nonce + sealed)

    with pytest.raises(tarfile.TarError):
        state_crypt.unpack(bundle, tmp_path / "dest")
    assert not (tmp_path / "escaped.txt").exists()


def test_cli_migrates_from_legacy_plaintext_only_when_bundle_is_missing(private_files, tmp_path, monkeypatch):
    monkeypatch.setenv("STATE_KEY", KEY)
    dest = tmp_path / "dest"
    missing = tmp_path / "state" / "private.tar.gz.enc"
    code = state_crypt.main(
        ["unpack", "--bundle", str(missing), "--dest", str(dest), "--legacy-from", str(private_files), "data_cache/*.parquet"]
    )
    assert code == 0
    assert (dest / "data_cache" / "TWII.parquet").read_bytes() == b"parquet-bytes-twii"

    # 封包存在時以封包為準，就算舊明文還在也不讀
    state_crypt.pack(private_files, ["data_cache/2330.TW.parquet"], missing)
    dest2 = tmp_path / "dest2"
    assert state_crypt.main(["unpack", "--bundle", str(missing), "--dest", str(dest2), "--legacy-from", str(private_files), "data_cache/*.parquet"]) == 0
    assert (dest2 / "data_cache" / "2330.TW.parquet").exists()
    assert not (dest2 / "data_cache" / "TWII.parquet").exists()
