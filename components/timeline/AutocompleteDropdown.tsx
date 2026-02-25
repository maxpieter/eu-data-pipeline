"use client";

import React from "react";

interface AutocompleteDropdownProps<T> {
  items: T[];
  isOpen: boolean;
  onSelect: (item: T) => void;
  renderItem: (item: T) => React.ReactNode;
}

/**
 * Generic autocomplete dropdown that renders an absolutely-positioned list of
 * selectable items beneath its parent container.
 *
 * The parent element must have `position: relative` set.
 */
export default function AutocompleteDropdown<T>({
  items,
  isOpen,
  onSelect,
  renderItem,
}: AutocompleteDropdownProps<T>) {
  if (!isOpen || items.length === 0) return null;

  return (
    <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-[8px] border border-[#e2e8f0] shadow-[0_10px_25px_-5px_rgba(0,0,0,0.1)] max-h-[240px] overflow-y-auto z-50">
      {items.map((item, i) => (
        <div
          key={i}
          onClick={() => onSelect(item)}
          className="px-3 py-2 cursor-pointer text-sm border-b border-[#f1f5f9] hover:bg-[#f1f5f9]"
        >
          {renderItem(item)}
        </div>
      ))}
    </div>
  );
}
