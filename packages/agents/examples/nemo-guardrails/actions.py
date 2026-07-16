"""NeMo Guardrails action that escalates an uncertain rail to RateLoop.

Copy this file to a Guardrails configuration as ``actions.py``. The action
accepts a commitment-only ``rateloop.automated-eval-receipt.v1`` dictionary;
never pass prompts, messages, model output, rationale, or reviewer data.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from nemoguardrails.actions import action


_ALLOWED_RECEIPT_KEYS = {
    "schemaVersion",
    "provider",
    "externalReceiptId",
    "agentId",
    "agentVersionId",
    "evaluator",
    "evaluation",
    "contentCommitment",
    "observedAt",
    "reviewContext",
}
_FORBIDDEN_CONTENT_KEYS = {
    "input",
    "messages",
    "output",
    "prompt",
    "rationale",
    "rawInput",
    "rawOutput",
    "response",
}
_MAX_RECEIPT_BYTES = 65_536


def _contains_forbidden_content(value: Any) -> bool:
    if isinstance(value, dict):
        if any(key in _FORBIDDEN_CONTENT_KEYS for key in value):
            return True
        return any(_contains_forbidden_content(entry) for entry in value.values())
    if isinstance(value, list):
        return any(_contains_forbidden_content(entry) for entry in value)
    return False


def _validate_origin(value: str) -> str:
    parsed = urllib.parse.urlsplit(value)
    local = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    insecure_local = os.environ.get("RATELOOP_ALLOW_INSECURE_LOCALHOST") == "1"
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("RATELOOP_BASE_URL must be an origin without credentials, query, or fragment")
    if parsed.path not in {"", "/"}:
        raise ValueError("RATELOOP_BASE_URL must not include a path")
    if parsed.scheme != "https" and not (local and insecure_local and parsed.scheme == "http"):
        raise ValueError("RATELOOP_BASE_URL must use HTTPS")
    return f"{parsed.scheme}://{parsed.netloc}"


def _validate_receipt(receipt: dict[str, Any]) -> bytes:
    if set(receipt) - _ALLOWED_RECEIPT_KEYS:
        raise ValueError("RateLoop receipt contains unsupported fields")
    if receipt.get("schemaVersion") != "rateloop.automated-eval-receipt.v1":
        raise ValueError("RateLoop receipt schema is unsupported")
    if receipt.get("provider") != "nemo_guardrails":
        raise ValueError("NeMo action requires provider=nemo_guardrails")
    evaluation = receipt.get("evaluation")
    if not isinstance(evaluation, dict) or evaluation.get("outcome") != "uncertain":
        raise ValueError("NeMo action escalates only uncertain rail results")
    if not isinstance(receipt.get("reviewContext"), dict):
        raise ValueError("Uncertain rail result requires reviewContext")
    if _contains_forbidden_content(receipt):
        raise ValueError("RateLoop receipt must contain commitments, not raw model or reviewer content")
    encoded = json.dumps(receipt, separators=(",", ":"), sort_keys=True).encode("utf-8")
    if len(encoded) > _MAX_RECEIPT_BYTES:
        raise ValueError("RateLoop receipt exceeds 64 KiB")
    return encoded


def _post_receipt(receipt: dict[str, Any]) -> dict[str, Any]:
    body = _validate_receipt(receipt)
    api_key = os.environ.get("RATELOOP_API_KEY", "").strip()
    if not api_key or any(character.isspace() for character in api_key):
        raise RuntimeError("RATELOOP_API_KEY is required")
    origin = _validate_origin(
        os.environ.get("RATELOOP_BASE_URL", "https://rateloop-tokenless.vercel.app")
    )
    external_id = str(receipt.get("externalReceiptId", ""))
    check_name = str(receipt.get("evaluation", {}).get("checkName", ""))
    idempotency_digest = hashlib.sha256(
        f"nemo-guardrails\0{external_id}\0{check_name}".encode("utf-8")
    ).hexdigest()
    request = urllib.request.Request(
        f"{origin}/api/assurance/v1/evaluations/receipts",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Idempotency-Key": f"nemo:{idempotency_digest}",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            result = json.loads(response.read(_MAX_RECEIPT_BYTES).decode("utf-8"))
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"RateLoop receipt ingest failed with HTTP {error.code}") from error
    human_review = result.get("humanReview") if isinstance(result, dict) else None
    if not isinstance(human_review, dict) or human_review.get("required") is not True:
        raise RuntimeError("RateLoop did not create required human review for an uncertain rail")
    return {
        "receiptId": result.get("receiptId"),
        "opportunityId": human_review.get("opportunityId"),
        "required": True,
        "humanVerdict": None,
    }


@action(name="rateloop_escalate_uncertain_guardrail")
async def rateloop_escalate_uncertain_guardrail(receipt: dict[str, Any]) -> dict[str, Any]:
    """Create a RateLoop human-review opportunity for an uncertain rail."""

    return await asyncio.to_thread(_post_receipt, receipt)
