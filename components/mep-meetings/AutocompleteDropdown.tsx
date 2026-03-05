import React from "react";

interface AutocompleteDropdownProps<T> {
  items: T[];
  isOpen: boolean;
  onSelect: (item: T) => void;
  renderItem: (item: T) => React.ReactNode;
}

export default function AutocompleteDropdown<T>({
  items,
  isOpen,
  onSelect,
  renderItem,
}: AutocompleteDropdownProps<T>): React.ReactNode {
  if (!isOpen || items.length === 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        right: 0,
        marginTop: "4px",
        background: "white",
        borderRadius: "8px",
        border: "1px solid #e2e8f0",
        boxShadow: "0 10px 25px -5px rgba(0,0,0,0.1)",
        maxHeight: "240px",
        overflowY: "auto",
        zIndex: 50,
      }}
    >
      {items.map((item, i) => (
        <div
          key={i}
          onClick={() => onSelect(item)}
          style={{
            padding: "0.5rem 0.75rem",
            cursor: "pointer",
            fontSize: "0.875rem",
            borderBottom: "1px solid #f1f5f9",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
        >
          {renderItem(item)}
        </div>
      ))}
    </div>
  );
}
