"""Offline verifier: pip install cryptography rfc8785

python verify_evidence.py lumen-evidence.json [--fingerprint trusted_sha256]
"""
import argparse
import base64
import hashlib
import json
import rfc8785
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature


def digest(value):
    return hashlib.sha256(rfc8785.dumps(value)).hexdigest()


def verify(bundle, fingerprint=None):
    if bundle.get("schema") != "lumen.evidence.v1" or bundle.get("algorithm") != "ECDSA-P256-SHA256":
        raise ValueError("Unsupported evidence format")
    head = ""
    for sequence, row in enumerate(bundle["ledger"], 1):
        entry = row["entry"]
        if entry["sequence"] != sequence or entry["previousHash"] != head or digest(entry) != row["hash"]:
            raise ValueError("Audit chain is incomplete or has been altered")
        head = row["hash"]
    checkpoint = bundle["checkpoint"]
    if digest({key: bundle[key] for key in ("schema", "scope", "limitations")}) != checkpoint["metadataDigest"]:
        raise ValueError("Evidence scope or trust notes have been altered")
    if checkpoint["revision"] != len(bundle["ledger"]) or checkpoint["head"] != head:
        raise ValueError("Checkpoint does not match the audit chain")
    if checkpoint["recordsDigest"] != digest(bundle["records"]) or checkpoint["exportedAt"] != bundle["createdAt"]:
        raise ValueError("Evidence records have been altered")
    key = bundle["publicKey"]
    actual = digest(key)
    if actual != bundle["keyFingerprint"] or fingerprint and actual != fingerprint:
        raise ValueError("Signing key fingerprint mismatch")
    decode = lambda value: int.from_bytes(base64.urlsafe_b64decode(value + "=" * (-len(value) % 4)), "big")
    public = ec.EllipticCurvePublicNumbers(decode(key["x"]), decode(key["y"]), ec.SECP256R1()).public_key()
    raw = bytes.fromhex(bundle["signature"])
    if len(raw) != 64:
        raise ValueError("Invalid P-256 signature size")
    signature = encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big"))
    public.verify(signature, rfc8785.dumps(checkpoint), ec.ECDSA(hashes.SHA256()))
    return actual


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("file")
    parser.add_argument("--fingerprint")
    args = parser.parse_args()
    with open(args.file, encoding="utf-8") as stream:
        value = verify(json.load(stream), args.fingerprint)
    print("PASS: signature, records digest, and complete audit chain verified")
    print("Signing key SHA-256:", value)
    if not args.fingerprint:
        print("Trust check: no independently pinned fingerprint was supplied")
