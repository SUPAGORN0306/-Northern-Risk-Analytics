"""Deterministic RAG grounding verifier enforcing similarity thresholds and real citations."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence


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
    """Outcome of groundedness and citation verification."""

    is_valid: bool
    should_refuse: bool
    reason: str
    verified_citations: tuple[CitedSource, ...]


def verify_rag_grounding(
    retrieved_chunks: Sequence[RetrievedChunk],
    claimed_citations: Sequence[CitedSource],
    min_similarity: float = 0.50,
    allow_empty_citations: bool = False,
) -> VerificationResult:
    """Enforce retrieval threshold refusal and O(1) verification of every claimed citation."""
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

    return VerificationResult(
        is_valid=True,
        should_refuse=False,
        reason="All citations verified against retrieved policy chunks",
        verified_citations=tuple(verified),
    )