import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiCopy, FiCheck } from 'react-icons/fi';
import { useResolveAddress } from '@/hooks/useResolveAddress';

/**
 * Renders a blockchain address as a resolved URN (text-only by default).
 * Shows URN if found, clean short address otherwise.
 * Clickable — navigates to the profile page.
 * Copy icon on hover copies the full address.
 */
export const AddressLabel = ({ address, network, className = '' }) => {
  const resolved = useResolveAddress(address, network);
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  if (!address) return null;

  const displayName = resolved?.found
    ? (resolved.urn || resolved.display_name)
    : `${address.substring(0, 6)}...`;

  const handleClick = (e) => {
    e.stopPropagation();
    navigate(`/profile/${address}`);
  };

  const handleCopy = (e) => {
    e.stopPropagation();
    e.preventDefault();
    navigator.clipboard?.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <span
      className={`inline-flex items-center gap-1 group ${className}`}
      data-testid="address-label"
      title={address}
    >
      <span
        onClick={handleClick}
        className={`cursor-pointer hover:text-blue-400 transition-colors ${
          resolved?.found ? 'text-blue-400' : ''
        }`}
      >
        {displayName}
      </span>
      <button
        onClick={handleCopy}
        className={`inline-flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity ${
          copied ? 'text-emerald-400' : 'text-gray-500 hover:text-gray-300'
        }`}
        title="Copy address"
        data-testid="copy-address-btn"
      >
        {copied ? <FiCheck size={11} /> : <FiCopy size={11} />}
      </button>
    </span>
  );
};
