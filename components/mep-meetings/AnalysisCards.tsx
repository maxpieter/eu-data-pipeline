import React from "react";
import type { AnalysisCard } from "./types";

interface AnalysisCardsProps {
  analysisCards: AnalysisCard[];
  expandedCardId: string | null;
  onToggleExpanded: (cardId: string) => void;
  onDismiss: (cardId: string) => void;
  onCloseDialog: () => void;
}

function CardStack({
  analysisCards,
  onToggleExpanded,
  onDismiss,
}: Pick<
  AnalysisCardsProps,
  "analysisCards" | "onToggleExpanded" | "onDismiss"
>): React.ReactNode {
  if (analysisCards.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: "20px",
        right: "20px",
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        maxHeight: "60vh",
        overflowY: "auto",
      }}
    >
      {analysisCards.map((card) => (
        <div
          key={card.id}
          onClick={() =>
            !card.loading &&
            card.result &&
            !card.result.error &&
            onToggleExpanded(card.id)
          }
          style={{
            background: "white",
            borderRadius: "10px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
            padding: "12px 16px",
            minWidth: "280px",
            maxWidth: "340px",
            cursor:
              card.loading || !card.result || card.result.error
                ? "default"
                : "pointer",
            border: `2px solid ${card.loading ? "#3b82f6" : card.result?.error ? "#ef4444" : "#10b981"}`,
            transition: "transform 0.2s, box-shadow 0.2s",
            outline: "none",
          }}
          onMouseEnter={(e) => {
            if (!card.loading && card.result && !card.result.error) {
              e.currentTarget.style.transform = "translateY(-2px)";
              e.currentTarget.style.boxShadow =
                "0 6px 24px rgba(0,0,0,0.2), 0 0 0 2px #10b981";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "translateY(0)";
            e.currentTarget.style.boxShadow =
              "0 4px 20px rgba(0,0,0,0.15)";
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "6px",
            }}
          >
            <div
              style={{ display: "flex", alignItems: "center", gap: "8px" }}
            >
              {card.loading ? (
                <div
                  style={{
                    width: "16px",
                    height: "16px",
                    border: "2px solid #3b82f6",
                    borderTopColor: "transparent",
                    borderRadius: "50%",
                    animation: "spin 1s linear infinite",
                  }}
                />
              ) : card.result?.error ? (
                <span style={{ color: "#ef4444", fontSize: "16px" }}>
                  !
                </span>
              ) : (
                <span style={{ color: "#10b981", fontSize: "16px" }}>
                  &#10003;
                </span>
              )}
              <span
                style={{
                  fontWeight: 600,
                  fontSize: "0.8rem",
                  color: "#1e293b",
                }}
              >
                {card.loading
                  ? "Analyzing..."
                  : card.result?.error
                    ? "Error"
                    : "Analysis Ready"}
              </span>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDismiss(card.id);
              }}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "#94a3b8",
                fontSize: "18px",
                lineHeight: 1,
                padding: "0 4px",
              }}
            >
              &times;
            </button>
          </div>
          <div
            style={{
              fontSize: "0.7rem",
              color: "#64748b",
              lineHeight: 1.4,
            }}
          >
            <div style={{ fontWeight: 500 }}>
              {card.documentRef || "Document"}
            </div>
            {card.mepName && <div>MEP: {card.mepName}</div>}
            {card.result?.doc_type_label && (
              <div>Type: {card.result.doc_type_label}</div>
            )}
            {card.result?.error && (
              <div style={{ color: "#ef4444", marginTop: "4px" }}>
                {card.result.error}
              </div>
            )}
            {!card.loading && card.result && !card.result.error && (
              <div
                style={{
                  color: "#3b82f6",
                  marginTop: "4px",
                  fontStyle: "italic",
                }}
              >
                Click to view full analysis
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function parseInlineMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    if (boldMatch && boldMatch.index !== undefined) {
      if (boldMatch.index > 0) {
        parts.push(remaining.slice(0, boldMatch.index));
      }
      parts.push(
        <strong key={key++} style={{ fontWeight: 600 }}>
          {boldMatch[1]}
        </strong>,
      );
      remaining = remaining.slice(boldMatch.index + boldMatch[0].length);
    } else {
      parts.push(remaining);
      break;
    }
  }

  return parts;
}

function renderAnalysisLine(line: string, i: number): React.ReactNode {
  if (line.startsWith("# "))
    return (
      <h2
        key={i}
        style={{
          fontSize: "1.1rem",
          marginTop: i > 0 ? "1.2rem" : 0,
          color: "#1e293b",
        }}
      >
        {parseInlineMarkdown(line.slice(2))}
      </h2>
    );
  if (line.startsWith("## "))
    return (
      <h3
        key={i}
        style={{
          fontSize: "0.95rem",
          marginTop: "1rem",
          color: "#1e293b",
        }}
      >
        {parseInlineMarkdown(line.slice(3))}
      </h3>
    );
  if (line.startsWith("### "))
    return (
      <h4
        key={i}
        style={{
          fontSize: "0.85rem",
          marginTop: "0.8rem",
          color: "#475569",
        }}
      >
        {parseInlineMarkdown(line.slice(4))}
      </h4>
    );
  if (line.startsWith("- "))
    return (
      <div
        key={i}
        style={{ paddingLeft: "16px", position: "relative" }}
      >
        <span style={{ position: "absolute", left: "4px" }}>
          &bull;
        </span>
        {parseInlineMarkdown(line.slice(2))}
      </div>
    );
  if (line.startsWith("•"))
    return (
      <div
        key={i}
        style={{ paddingLeft: "16px", position: "relative" }}
      >
        <span style={{ position: "absolute", left: "4px" }}>
          &bull;
        </span>
        {parseInlineMarkdown(line.slice(1).trimStart())}
      </div>
    );
  if (line.trim() === "")
    return <div key={i} style={{ height: "8px" }} />;
  return (
    <p key={i} style={{ margin: "4px 0" }}>
      {parseInlineMarkdown(line)}
    </p>
  );
}

function AnalysisDialog({
  card,
  onClose,
}: {
  card: AnalysisCard;
  onClose: () => void;
}): React.ReactNode {
  if (!card.result || card.result.error) return null;
  const r = card.result;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 2000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "white",
          borderRadius: "16px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          maxWidth: "700px",
          width: "100%",
          maxHeight: "80vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Dialog Header */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "linear-gradient(135deg, #f8fafc, #f1f5f9)",
          }}
        >
          <div>
            <h3
              style={{
                margin: 0,
                fontSize: "1rem",
                color: "#1e293b",
              }}
            >
              Document Analysis
            </h3>
            <p
              style={{
                margin: "4px 0 0",
                fontSize: "0.75rem",
                color: "#64748b",
              }}
            >
              {r.document_ref || card.documentRef}{" "}
              {r.doc_type_label ? `(${r.doc_type_label})` : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#64748b",
              fontSize: "24px",
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>

        {/* Stats Bar */}
        <div
          style={{
            padding: "10px 24px",
            background: "#f8fafc",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            gap: "16px",
            flexWrap: "wrap",
            fontSize: "0.7rem",
            color: "#64748b",
          }}
        >
          {card.mepName && (
            <span>
              MEP: <strong>{card.mepName}</strong>
            </span>
          )}
          {r.amendments_found != null && (
            <span>
              Amendments: <strong>{r.amendments_found}</strong>
            </span>
          )}
          {r.llm_provider && (
            <span>
              LLM: <strong>{r.llm_provider}</strong>
            </span>
          )}
          {r.analyzed_at && (
            <span>
              Analyzed:{" "}
              <strong>
                {new Date(r.analyzed_at).toLocaleString()}
              </strong>
            </span>
          )}
        </div>

        {/* Analysis Content */}
        <div
          style={{
            padding: "24px",
            overflowY: "auto",
            flex: 1,
            fontSize: "0.82rem",
            lineHeight: 1.7,
            color: "#334155",
          }}
        >
          {r.analysis ? (
            r.analysis.split("\n").map(renderAnalysisLine)
          ) : (
            <p style={{ color: "#94a3b8" }}>
              No analysis content available.
            </p>
          )}
        </div>

        {/* Dialog Footer */}
        <div
          style={{
            padding: "12px 24px",
            borderTop: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "#f8fafc",
          }}
        >
          <a
            href={r.document_url || card.documentUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: "0.75rem",
              color: "#3b82f6",
              textDecoration: "none",
            }}
          >
            View Original Document
          </a>
          <button
            onClick={onClose}
            style={{
              background: "#3b82f6",
              color: "white",
              border: "none",
              borderRadius: "8px",
              padding: "8px 20px",
              cursor: "pointer",
              fontSize: "0.8rem",
              fontWeight: 500,
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AnalysisCards({
  analysisCards,
  expandedCardId,
  onToggleExpanded,
  onDismiss,
  onCloseDialog,
}: AnalysisCardsProps): React.ReactNode {
  const expandedCard = expandedCardId
    ? analysisCards.find((c) => c.id === expandedCardId)
    : null;

  return (
    <>
      <CardStack
        analysisCards={analysisCards}
        onToggleExpanded={onToggleExpanded}
        onDismiss={onDismiss}
      />

      {expandedCard && expandedCard.result && !expandedCard.result.error && (
        <AnalysisDialog card={expandedCard} onClose={onCloseDialog} />
      )}

      {/* Spinner animation for analysis cards */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
}
