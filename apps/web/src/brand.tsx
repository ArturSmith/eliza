/** Shared brand lockup; the same SVG mark is used by the public landing page. */
export function BrandLogo() {
  return (
    <span className="eliza-logo" aria-label="Eliza">
      <img className="eliza-logo-mark" src="/brand-mark.svg" alt="" aria-hidden="true" width="34" height="34" />
      <span className="eliza-wordmark">eliza<span className="eliza-logo-dot">.</span></span>
    </span>
  );
}
