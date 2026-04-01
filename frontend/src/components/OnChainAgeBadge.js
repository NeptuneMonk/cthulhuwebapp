import React from 'react';
import { FiExternalLink } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';

/**
 * On-Chain Age classification system.
 * Returns era info based on the object's creation year.
 */
function getEraInfo(createdDate) {
  if (!createdDate || createdDate === '0001-01-01T00:00:00') return null;
  const year = new Date(createdDate).getFullYear();
  if (isNaN(year) || year < 2009) return null;

  if (year <= 2014) {
    return {
      title: 'Genesis Relic',
      era: 'The Primordial Era',
      years: '2009\u20132014',
      color: 'from-amber-900/60 to-stone-900/60',
      border: 'border-amber-700/50',
      text: 'text-amber-300',
      glow: 'shadow-amber-900/30',
      icon: '\u25C6',
    };
  }
  if (year <= 2020) {
    return {
      title: 'Mid-Epoch Relic',
      era: 'The Forging Era',
      years: '2015\u20132020',
      color: 'from-orange-900/50 to-red-950/50',
      border: 'border-orange-700/40',
      text: 'text-orange-300',
      glow: 'shadow-orange-900/20',
      icon: '\u25C8',
    };
  }
  if (year <= 2023) {
    return {
      title: 'Network Renaissance Piece',
      era: 'The Expansion Era',
      years: '2021\u20132023',
      color: 'from-cyan-900/40 to-blue-950/40',
      border: 'border-cyan-700/30',
      text: 'text-cyan-300',
      glow: 'shadow-cyan-900/20',
      icon: '\u25CE',
    };
  }
  return null; // 2024+ — no special title
}

export { getEraInfo };

export default function OnChainAgeBadge({ createdDate }) {
  const navigate = useNavigate();
  const era = getEraInfo(createdDate);
  if (!era) return null;

  return (
    <div
      className={`bg-gradient-to-r ${era.color} border ${era.border} rounded-lg p-3 shadow-lg ${era.glow}`}
      data-testid="onchain-age-badge"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`${era.text} text-lg flex-shrink-0`} style={{ fontFamily: 'serif' }}>
            {era.icon}
          </span>
          <div className="min-w-0">
            <p className={`text-xs font-bold ${era.text} tracking-wide uppercase`}
               data-testid="age-badge-title">
              {era.title}
            </p>
            <p className="text-[10px] text-gray-500 mt-0.5">
              {era.era} <span className="text-gray-600">{era.years}</span>
            </p>
          </div>
        </div>
        <button
          onClick={() => navigate('/wiki#on-chain-age-titles')}
          className="text-gray-600 hover:text-gray-400 transition-colors flex-shrink-0"
          title="Learn about On-Chain Age Titles"
          data-testid="age-badge-wiki-link"
        >
          <FiExternalLink size={12} />
        </button>
      </div>
    </div>
  );
}
