import React from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Renders text with #hashtags as clickable search links
 * and URLs as clickable external links.
 */
export const HashtagText = ({ text }) => {
  const navigate = useNavigate();

  if (!text) return null;

  // Split on hashtags and URLs
  const parts = text.split(/(#\w+|https?:\/\/[^\s<>]+)/g);

  return (
    <span>
      {parts.map((part, i) => {
        if (part.match(/^#\w+$/)) {
          return (
            <span
              key={i}
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/search?q=${encodeURIComponent(part)}`);
              }}
              className="text-blue-400 hover:text-blue-300 cursor-pointer transition-colors"
              data-testid="hashtag-link"
            >
              {part}
            </span>
          );
        }
        if (part.match(/^https?:\/\//)) {
          return (
            <a
              key={i}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 underline"
              onClick={(e) => e.stopPropagation()}
            >
              {part.length > 50 ? part.substring(0, 47) + '...' : part}
            </a>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
};
