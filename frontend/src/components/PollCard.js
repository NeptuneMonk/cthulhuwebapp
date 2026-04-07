/**
 * PollCard — Renders an on-chain INQ poll with vote bars, gating info, and vote button.
 * Persists votes via backend registry so they survive page reloads.
 */
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { FiBarChart2, FiLock, FiCheck, FiClock, FiUsers, FiZap } from 'react-icons/fi';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import FeePicker from '@/components/FeePicker';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function PollCard({ poll, network, onVoted }) {
  const { user, isConnected, wif: authWif } = useAuth();
  const { wallet } = useWallet();
  const activeWif = authWif || wallet?.wif;
  const myAddress = user?.public_address || wallet?.address || '';

  const [voting, setVoting] = useState(null);
  const [votedFor, setVotedFor] = useState(null);
  const [livePoll, setLivePoll] = useState(null);

  // Use livePoll (from p2fk.io) if available, otherwise use prop data
  const activePoll = livePoll || poll;

  const isGated = (activePoll.own_gate?.length > 0 || activePoll.cre_gate?.length > 0);
  const isClosed = activePoll.status === 'closed';
  const isPending = activePoll.status === 'mempool';

  // Fetch fresh on-chain vote data from p2fk.io
  useEffect(() => {
    if (!poll.txid || isPending) return;
    let cancelled = false;
    const fetchPoll = (fresh = false) => {
      const freshParam = fresh ? '&fresh=true' : '';
      fetch(`${API}/polls/by-txid/${poll.txid}?network=${network}${freshParam}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (!cancelled && d && d.question && !d.error) {
            setLivePoll(d);
          }
        })
        .catch(() => {});
    };
    fetchPoll();
    // Auto-refresh every 30s for active polls
    const interval = setInterval(() => fetchPoll(true), 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [poll.txid, network, isPending]);

  // On mount, check if user already voted (from poll_data.votes or API)
  useEffect(() => {
    if (!myAddress || !poll.txid) return;
    // Check votes map embedded in poll data first
    const existingVote = (activePoll.votes || {})[myAddress];
    if (existingVote) {
      setVotedFor(existingVote);
      return;
    }
    // Fallback: ask the API
    fetch(`${API}/polls/my-vote/${poll.txid}?voter=${myAddress}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.voted_for) setVotedFor(d.voted_for); })
      .catch(() => {});
  }, [myAddress, poll.txid, activePoll.votes]);

  // Compute display data — use on-chain counts when available
  const { answers, totalVotes } = useMemo(() => {
    let rawAnswers = activePoll.answers || [];
    if (!Array.isArray(rawAnswers)) {
      rawAnswers = Object.entries(rawAnswers).map(([addr, text]) => ({
        address: addr,
        answer: typeof text === 'string' ? text : text?.answer || text?.Answer || '',
        total_votes: typeof text === 'object' ? (text?.total_votes || text?.TotalVotes || 0) : 0,
        total_value: typeof text === 'object' ? (text?.total_value || text?.TotalValue || 0) : 0,
      }));
    }
    const base = rawAnswers.map(a => ({ ...a }));
    let total = activePoll.total_votes || base.reduce((s, a) => s + (a.total_votes || 0), 0);

    // If we just voted locally but the data hasn't refreshed yet, apply optimistic +1
    if (votedFor && !(activePoll.votes || {})[myAddress]) {
      const voted = base.find(a => a.address === votedFor);
      if (voted) {
        voted.total_votes = (voted.total_votes || 0) + 1;
        total += 1;
      }
    }
    return { answers: base, totalVotes: total };
  }, [activePoll.answers, activePoll.total_votes, activePoll.votes, votedFor, myAddress]);

  const handleVote = useCallback(async (answerAddress) => {
    if (!activeWif || voting || votedFor || isClosed || isPending) return;
    setVoting(answerAddress);
    try {
      const [{ buildVoteTransaction }, { buildAndBroadcast }] = await Promise.all([
        import('@/utils/p2fk'), import('@/utils/txBuilder'),
      ]);
      const { addresses, taxInsertIndex } = buildVoteTransaction(activeWif, answerAddress, network, poll.txid);
      await buildAndBroadcast(activeWif, addresses, network, [], 0, 546, [], taxInsertIndex);

      // Record the vote in the backend registry
      try {
        await fetch(`${API}/polls/vote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            txid: poll.txid,
            answer_address: answerAddress,
            voter_address: myAddress,
          }),
        });
      } catch { /* non-critical, on-chain vote is what matters */ }

      setVotedFor(answerAddress);
      toast.success('Vote cast!');
      onVoted?.();

      // Re-fetch fresh on-chain data after a short delay (indexer needs time to register)
      setTimeout(async () => {
        try {
          const resp = await fetch(`${API}/polls/by-txid/${poll.txid}?network=${network}&fresh=true`);
          if (resp.ok) {
            const d = await resp.json();
            if (d && d.question && !d.error) setLivePoll(d);
          }
        } catch {}
      }, 3000);
    } catch (err) {
      toast.error(`Vote failed: ${err.message}`);
    } finally {
      setVoting(null);
    }
  }, [activeWif, voting, votedFor, isClosed, isPending, network, onVoted, poll.txid, myAddress]);

  return (
    <div className="bg-gray-900/60 border border-gray-800/50 rounded-xl p-4 space-y-3" data-testid="poll-card">
      {/* Header */}
      <div className="flex items-center gap-2">
        <FiBarChart2 size={14} className="text-teal-400" />
        <span className="text-[10px] uppercase tracking-wider text-teal-400 font-semibold">Poll</span>
        {isPending && (
          <span className="flex items-center gap-1 text-[9px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded" data-testid="poll-pending-badge">
            <FiClock size={8} /> In mempool
          </span>
        )}
        {isGated && (
          <span className="flex items-center gap-1 text-[9px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded" data-testid="poll-gated-badge">
            <FiLock size={8} /> Token-gated
          </span>
        )}
        {isClosed && (
          <span className="flex items-center gap-1 text-[9px] text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded" data-testid="poll-closed-badge">
            <FiClock size={8} /> Closed
          </span>
        )}
      </div>

      {/* Question */}
      <h3 className="text-sm font-medium text-gray-100" data-testid="poll-question">{poll.question}</h3>

      {/* Fee picker for voting */}
      {isConnected && activeWif && !votedFor && !isClosed && !isPending && (
        <FeePicker network={network} compact />
      )}

      {/* Answers */}
      <div className="space-y-2" data-testid="poll-answers">
        {answers.map((ans, i) => {
          const pct = totalVotes > 0 ? Math.round((ans.total_votes / totalVotes) * 100) : 0;
          const isWinner = totalVotes > 0 && ans.total_votes === Math.max(...answers.map(a => a.total_votes));
          const isMyVote = votedFor === ans.address;
          const canVote = isConnected && activeWif && !votedFor && !isClosed && !isPending;

          return (
            <button
              key={ans.address}
              onClick={() => canVote && handleVote(ans.address)}
              disabled={!canVote || !!voting}
              className={`w-full relative overflow-hidden rounded-lg border text-left transition-all ${
                isMyVote ? 'border-teal-500/50 bg-teal-900/20'
                : voting === ans.address ? 'border-gray-600 bg-gray-800/80 animate-pulse'
                : canVote ? 'border-gray-700/50 bg-gray-800/30 hover:border-gray-600 hover:bg-gray-800/60 cursor-pointer'
                : 'border-gray-800/30 bg-gray-800/20'
              }`}
              data-testid={`poll-answer-${i}`}
            >
              {/* Progress bar */}
              <div
                className={`absolute inset-y-0 left-0 transition-all duration-500 ${
                  isWinner ? 'bg-teal-600/15' : 'bg-gray-700/15'
                }`}
                style={{ width: `${pct}%` }}
              />
              <div className="relative flex items-center justify-between px-3 py-2.5">
                <div className="flex items-center gap-2">
                  {isMyVote && <FiCheck size={12} className="text-teal-400" />}
                  <span className={`text-sm ${isWinner ? 'text-gray-100 font-medium' : 'text-gray-300'}`}>
                    {ans.answer}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs tabular-nums ${isWinner ? 'text-teal-400 font-semibold' : 'text-gray-500'}`}>
                    {pct}%
                  </span>
                  <span className="text-[10px] text-gray-600 tabular-nums">{ans.total_votes}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] text-gray-600 pt-1">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <FiUsers size={10} /> {totalVotes} vote{totalVotes !== 1 ? 's' : ''}
          </span>
          {isGated && (
            <span className="flex items-center gap-1 text-amber-500/70">
              <FiZap size={10} /> {poll.total_gated_votes || 0} gated
            </span>
          )}
        </div>
        {isPending && <span className="text-amber-400">Awaiting confirmation</span>}
        {!isPending && !isConnected && <span className="text-gray-600">Sign in to vote</span>}
        {!isPending && isConnected && !activeWif && <span className="text-gray-600">Unlock wallet to vote</span>}
        {votedFor && <span className="text-teal-500">Voted</span>}
      </div>
    </div>
  );
}
