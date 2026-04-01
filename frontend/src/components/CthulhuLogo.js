/**
 * CthulhuLogo — SVG vector logo for the Cthulhu platform.
 * Vectorized from the original 2013 on-chain 15x16 pixel emoji.
 * Supports className for sizing and an optional animated IPFS glow.
 */
export const CTHULHU_SVG = '/cthulhu-logo.svg';

export function CthulhuLogo({ className = 'w-10 h-10', animate = false, alt = 'Cthulhu' }) {
  return (
    <img
      src={CTHULHU_SVG}
      alt={alt}
      className={`${className} ${animate ? 'cthulhu-materialize' : ''}`}
      draggable={false}
    />
  );
}
