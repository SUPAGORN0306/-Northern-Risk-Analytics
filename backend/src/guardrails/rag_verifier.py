"""Deterministic RAG grounding verifier enforcing similarity thresholds and real citations."""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Sequence

_PCT_CLAIM_RE = re.compile(r"(?:ร้อยละ\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:%|เปอร์เซ็นต์))")


def _find_ungrounded_percentage_claims(answer_text: str, evidence_text: str) -> list[str]:
    """Return any percentage numbers claimed in answer_text that do not appear in evidence_text."""
    if not answer_text or not evidence_text:
        return []
    clean_evidence = evidence_text.replace(",", "")
    ungrounded: list[str] = []
    for m in _PCT_CLAIM_RE.finditer(answer_text.replace(",", "")):
        raw_num = (m.group(1) or m.group(2) or "").strip()
        if not raw_num:
            continue
        candidates = {raw_num}
        try:
            fval = float(raw_num)
            if fval.is_integer():
                candidates.add(str(int(fval)))
                candidates.add(f"{int(fval)}.0")
            else:
                candidates.add(f"{fval:g}")
        except ValueError:
            pass
        if not any(re.search(rf"(?<!\d){re.escape(cand)}(?!\d)", clean_evidence) for cand in candidates):
            ungrounded.append(raw_num)
    return ungrounded


@dataclass(frozen=True)
class RetrievedChunk:
    """Single retrieved policy document chunk with similarity score and page provenance."""

    doc_title: str
    page_num: int
    chunk_text: str
    score: float


@dataclass(frozen=True)
class CitedSource:
    """Citation reference claimed by the LLM in its generated answer."""

    doc_title: str
    page_num: int


@dataclass(frozen=True)
class VerificationResult:
    """Outcome of citation provenance, retrieval threshold, and lexical number checks."""

    is_valid: bool
    should_refuse: bool
    reason: str
    verified_citations: tuple[CitedSource, ...]
    citation_provenance_verified: bool = False
    numeric_claims_lexically_grounded: bool = False
    # Kept for API compatibility. This verifier does not establish semantic entailment.
    claim_factual_entailment_verified: bool = False
    verification_scope: str = "retrieval_similarity_citation_provenance_and_lexical_percentage_check_only"


def verify_rag_grounding(
    retrieved_chunks: Sequence[RetrievedChunk],
    claimed_citations: Sequence[CitedSource],
    min_similarity: float = 0.50,
    allow_empty_citations: bool = False,
    answer_text: str | None = None,
    evidence_context: str | None = None,
) -> VerificationResult:
    """Enforce retrieval threshold refusal, O(1) citation provenance, and numeric percentage claim grounding."""
    if allow_empty_citations and not claimed_citations:
        return VerificationResult(
            is_valid=True,
            should_refuse=False,
            reason="Answered from deterministic or app context without policy citations",
            verified_citations=(),
        )
    if not retrieved_chunks:
        return VerificationResult(
            is_valid=False,
            should_refuse=True,
            reason="No policy chunks retrieved",
            verified_citations=(),
        )

    top_score = max(chunk.score for chunk in retrieved_chunks)
    if top_score < min_similarity:
        return VerificationResult(
            is_valid=False,
            should_refuse=True,
            reason=f"Top retrieval score ({top_score:.3f}) below threshold ({min_similarity:.3f})",
            verified_citations=(),
        )

    # Build O(1) lookup set of valid document title and page pairs
    valid_provenance = frozenset(
        (chunk.doc_title.strip(), int(chunk.page_num)) for chunk in retrieved_chunks
    )

    if not claimed_citations:
        if allow_empty_citations:
            return VerificationResult(
                is_valid=True,
                should_refuse=False,
                reason="Answered with app feature guidance without policy citations",
                verified_citations=(),
            )
        return VerificationResult(
            is_valid=False,
            should_refuse=True,
            reason="Generated answer contained no citations",
            verified_citations=(),
        )

    verified: list[CitedSource] = []
    for cite in claimed_citations:
        key = (cite.doc_title.strip(), int(cite.page_num))
        if key not in valid_provenance:
            return VerificationResult(
                is_valid=False,
                should_refuse=True,
                reason=f"Fabricated citation detected ({cite.doc_title}, page {cite.page_num})",
                verified_citations=(),
            )
        verified.append(cite)

    if answer_text is not None:
        evidence_blob = "\n".join(
            [*(chunk.chunk_text for chunk in retrieved_chunks), str(evidence_context or "")]
        )
        normalized_answer = answer_text.replace(",", "")
        has_percentage_claim = bool(_PCT_CLAIM_RE.search(normalized_answer))
        ungrounded_pcts = _find_ungrounded_percentage_claims(answer_text, evidence_blob)
        if ungrounded_pcts:
            return VerificationResult(
                is_valid=False,
                should_refuse=True,
                reason=f"Ungrounded percentage claim detected ({ungrounded_pcts[0]}%)",
                verified_citations=(),
            )
        return VerificationResult(
            is_valid=True,
            should_refuse=False,
            reason="Citation provenance verified; any percentage claims were lexically checked against retrieved context",
            verified_citations=tuple(verified),
            citation_provenance_verified=True,
            numeric_claims_lexically_grounded=has_percentage_claim,
            claim_factual_entailment_verified=False,
            verification_scope="retrieval_similarity_citation_provenance_and_lexical_percentage_check_only",
        )

    return VerificationResult(
        is_valid=True,
        should_refuse=False,
        reason="Citation source existence verified against retrieved policy chunks (claim semantic entailment not evaluated)",
        verified_citations=tuple(verified),
        citation_provenance_verified=True,
        numeric_claims_lexically_grounded=False,
        claim_factual_entailment_verified=False,
        verification_scope="retrieval_similarity_and_citation_provenance_only",
    )
