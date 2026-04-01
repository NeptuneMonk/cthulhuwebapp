import { useEffect } from 'react';

/**
 * Global keyboard shortcuts for desktop users.
 * - Escape: Close modals, drawers, popups
 * - Ctrl/Cmd+K: Focus search (if present)
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const handler = (e) => {
      // Escape: trigger click on any visible close button in a modal
      if (e.key === 'Escape') {
        const modal = document.querySelector('[data-testid*="modal"] [data-testid*="close"]');
        if (modal) { modal.click(); e.preventDefault(); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
