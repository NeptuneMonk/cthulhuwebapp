/**
 * useMentions — Tracks @mentions of the current user in the feed.
 * Returns unseen mention count, a scroll-to-next function, and a mark-seen callback.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './useAuth';
import { getSeenMentions, markMentionSeen } from '@/utils/dmDb';

export function useMentions(feed) {
  const { user } = useAuth();
  const [seenSet, setSeenSet] = useState(new Set());
  const [unseenMentions, setUnseenMentions] = useState([]);
  const mentionRefs = useRef({});

  const myUrn = user?.urn;

  // Load seen mentions from IndexedDB on mount
  useEffect(() => {
    getSeenMentions().then(setSeenSet);
  }, []);

  // Detect mentions whenever feed or seenSet changes
  useEffect(() => {
    if (!myUrn || !feed?.length) { setUnseenMentions([]); return; }

    const pattern = `@${myUrn}`;
    const mentions = feed.filter(item => {
      const content = item.content || '';
      // Check if content mentions my URN and it's from someone else
      return content.includes(pattern) && item.from_address !== user?.address;
    });

    const unseen = mentions.filter(m => !seenSet.has(m.transaction_id));
    setUnseenMentions(unseen);
  }, [feed, seenSet, myUrn, user?.address]);

  // Register a ref for a FeedCard that contains a mention
  const registerMentionRef = useCallback((txid, element) => {
    if (element) {
      mentionRefs.current[txid] = element;
    }
  }, []);

  // Mark a specific mention as seen
  const markSeen = useCallback(async (txid) => {
    await markMentionSeen(txid);
    setSeenSet(prev => new Set([...prev, txid]));
  }, []);

  // Scroll to the next unseen mention
  const scrollToNext = useCallback(() => {
    if (unseenMentions.length === 0) return null;
    const nextMention = unseenMentions[0];
    const txid = nextMention.transaction_id;
    const el = mentionRefs.current[txid];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Flash highlight effect
      el.classList.add('mention-highlight');
      setTimeout(() => el.classList.remove('mention-highlight'), 2000);
      // Mark as seen after a brief delay
      setTimeout(() => markSeen(txid), 1500);
    }
    return txid;
  }, [unseenMentions, markSeen]);

  // Check if a feed item is a mention of the current user
  const isMention = useCallback((item) => {
    if (!myUrn) return false;
    const content = item.content || '';
    return content.includes(`@${myUrn}`) && item.from_address !== user?.address;
  }, [myUrn, user?.address]);

  // Check if a mention is unseen
  const isUnseen = useCallback((txid) => {
    return !seenSet.has(txid);
  }, [seenSet]);

  return {
    unseenCount: unseenMentions.length,
    scrollToNext,
    registerMentionRef,
    markSeen,
    isMention,
    isUnseen,
  };
}
