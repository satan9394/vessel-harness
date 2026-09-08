/** Inline Vessel text/hex logo — no external asset, keeps to theme colors. */
export function VesselLogo() {
  return (
    <svg className="logo" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 5h16v14H4z"
        stroke="var(--accent)"
        strokeWidth="2"
        fill="none"
        strokeLinejoin="round"
      />
      <path d="M8 15l2.5-4 2 2.5L15 9l3 5" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" fill="none" />
    </svg>
  );
}