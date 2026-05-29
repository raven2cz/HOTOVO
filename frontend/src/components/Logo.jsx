import React from 'react';

/**
 * HOTOVO brand mark: a checkmark in a rounded tile — the universal "done".
 * Scales cleanly from a 16px favicon to a large header logo.
 */
export default function Logo({ size = 32, className = '' }) {
  const gradientId = `hotovo-grad-${size}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="HOTOVO"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="32" x2="32" y2="0" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6366f1" />
          <stop offset="1" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="9" fill={`url(#${gradientId})`} />
      <path
        d="M9.5 16.5 L14 21 L22.5 11"
        stroke="#ffffff"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
