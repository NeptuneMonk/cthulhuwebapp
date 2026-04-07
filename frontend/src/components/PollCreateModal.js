/**
 * PollCreateModal — Create on-chain INQ polls with full token gating support.
 * Mirrors SUP's INQMint.cs functionality.
 */
import React, { useState, useCallback } from 'react';
import {
  FiX, FiPlus, FiTrash2, FiBarChart2, FiLock, FiClock,
  FiSend, FiAlertTriangle
} from 'react-icons/fi';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import FeePicker from '@/components/FeePicker';
import { addPendingPost } from '@/utils/pendingPosts';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const TIME_OPTIONS = [
  { label: 'No limit', value: 0 },
  { label: '1 hour', value: 6 },
  { label: '3 hours', value: 18 },
  { label: '12 hours', value: 72 },
  { label: '1 day', value: 144 },
  { label: '3 days', value: 432 },
  { label: '1 week', value: 1008 },
  { label: '2 weeks', value: 2016 },
];

export default function PollCreateModal({ onClose, network, onCreated }) {
  const { user, wif: authWif, isConnected } = useAuth();
  const { wallet } = useWallet();
  const activeWif = authWif || wallet?.wif;

  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState(['', '']);
  const [ownGates, setOwnGates] = useState([]); // object addresses
  const [creGates, setCreGates] = useState([]); // creator addresses
  const [endBlocks, setEndBlocks] = useState(0);
  const [requireSig, setRequireSig] = useState(true);
  const [gateInput, setGateInput] = useState('');
  const [gateType, setGateType] = useState('own');
  const [showGates, setShowGates] = useState(false);
  const [sending, setSending] = useState(false);

  const addAnswer = () => {
    if (answers.length >= 10) return;
    setAnswers([...answers, '']);
  };

  const removeAnswer = (idx) => {
    if (answers.length <= 2) return;
    setAnswers(answers.filter((_, i) => i !== idx));
  };

  const updateAnswer = (idx, val) => {
    const next = [...answers];
    next[idx] = val;
    setAnswers(next);
  };

  const addGate = () => {
    const addr = gateInput.trim();
    if (!addr) return;
    if (gateType === 'own' && !ownGates.includes(addr)) {
      setOwnGates([...ownGates, addr]);
    } else if (gateType === 'cre' && !creGates.includes(addr)) {
      setCreGates([...creGates, addr]);
    }
    setGateInput('');
  };

  const removeGate = (type, idx) => {
    if (type === 'own') setOwnGates(ownGates.filter((_, i) => i !== idx));
    else setCreGates(creGates.filter((_, i) => i !== idx));
  };

  const isValid = question.trim() && answers.filter(a => a.trim()).length >= 2;

  const handleCreate = useCallback(async () => {
    if (!isValid || !activeWif || sending) return;
    setSending(true);
    try {
      const cleanAnswers = answers.filter(a => a.trim()).map(a => a.trim());
      const gates = {};
      if (ownGates.length > 0) gates.own = ownGates;
      if (creGates.length > 0) gates.cre = creGates;

      const [{ buildInquiryTransaction }, { buildAndBroadcast }] = await Promise.all([
        import('@/utils/p2fk'), import('@/utils/txBuilder'),
      ]);

      const { addresses, questionAddress, answerAddresses, taxInsertIndex } = buildInquiryTransaction(
        activeWif, question.trim(), cleanAnswers, gates, endBlocks, requireSig, network
      );

      const result = await buildAndBroadcast(activeWif, addresses, network, [], 0, 546, [], taxInsertIndex);

      // Register the poll so it appears in the feed
      // answerAddresses is {address: text} map from buildInquiryTransaction
      const registeredAnswers = Object.entries(answerAddresses).map(([addr, text]) => ({
        address: addr,
        answer: text,
        total_votes: 0,
        total_value: 0,
        gated_votes: 0,
      }));
      try {
        await fetch(`${API}/polls/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            txid: result.txid,
            question: question.trim(),
            answers: registeredAnswers,
            creator_address: user?.address || user?.public_address || '',
            network,
            own_gate: ownGates,
            cre_gate: creGates,
          }),
        });
      } catch { /* non-critical */ }

      // Add to pending posts so it appears instantly in the feed
      const cleanAnswers2 = answers.filter(a => a.trim()).map(a => a.trim());
      const pendingAnswers = Object.entries(answerAddresses).map(([addr, text]) => ({
        address: addr, answer: text, total_votes: 0, total_value: 0, gated_votes: 0,
      }));
      addPendingPost({
        txid: result.txid,
        network,
        content: `INQ|${question.trim()}`,
        from_address: user?.address || user?.public_address || '',
        sender_urn: user?.urn || user?.address?.slice(0, 12) || 'You',
        sender_image: null,
        is_poll: true,
        poll_data: {
          txid: result.txid,
          question: question.trim(),
          answers: pendingAnswers,
          own_gate: ownGates,
          cre_gate: creGates,
          total_votes: 0,
          total_gated_votes: 0,
          votes: {},
          status: 'mempool',
        },
      });

      toast.success('Poll created on-chain!');
      console.log('INQ created:', { txid: result.txid, questionAddress, answerAddresses });
      onCreated?.();
      onClose?.();
    } catch (err) {
      toast.error(`Poll creation failed: ${err.message}`);
    } finally {
      setSending(false);
    }
  }, [question, answers, ownGates, creGates, endBlocks, requireSig, activeWif, network, sending, isValid, onClose, onCreated, user]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()} data-testid="poll-create-modal">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800/50">
          <div className="flex items-center gap-2">
            <FiBarChart2 size={16} className="text-teal-400" />
            <h2 className="text-base font-semibold text-gray-100">Create Poll</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:text-white hover:bg-gray-800 transition-colors" data-testid="poll-close-btn">
            <FiX size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Question */}
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Question</label>
            <input
              value={question}
              onChange={e => setQuestion(e.target.value)}
              placeholder="What should we build next?"
              maxLength={200}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-teal-600/50"
              data-testid="poll-question-input"
            />
          </div>

          {/* Answers */}
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Options (2-10)</label>
            <div className="space-y-2">
              {answers.map((ans, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full border border-gray-700 flex items-center justify-center text-[9px] text-gray-600 flex-shrink-0">{i + 1}</div>
                  <input
                    value={ans}
                    onChange={e => updateAnswer(i, e.target.value)}
                    placeholder={`Option ${i + 1}`}
                    maxLength={100}
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-teal-600/50"
                    data-testid={`poll-answer-input-${i}`}
                  />
                  {answers.length > 2 && (
                    <button onClick={() => removeAnswer(i)} className="w-7 h-7 rounded-full flex items-center justify-center text-gray-600 hover:text-red-400 hover:bg-red-400/10 transition-colors" data-testid={`poll-answer-remove-${i}`}>
                      <FiTrash2 size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {answers.length < 10 && (
              <button onClick={addAnswer} className="mt-2 flex items-center gap-1 text-xs text-teal-500 hover:text-teal-400 transition-colors" data-testid="poll-add-answer">
                <FiPlus size={12} /> Add option
              </button>
            )}
          </div>

          {/* Time Gate */}
          <div>
            <label className="flex items-center gap-1.5 text-xs text-gray-500 mb-1.5">
              <FiClock size={11} /> Duration
            </label>
            <select
              value={endBlocks}
              onChange={e => setEndBlocks(parseInt(e.target.value))}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-teal-600/50"
              data-testid="poll-duration-select"
            >
              {TIME_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Require Signature */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={requireSig}
              onChange={e => setRequireSig(e.target.checked)}
              className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-teal-500 focus:ring-teal-500 focus:ring-offset-0"
              data-testid="poll-require-sig"
            />
            <span className="text-xs text-gray-400">Require signed votes (prevents anonymous voting)</span>
          </label>

          {/* Token Gates (collapsible) */}
          <div>
            <button onClick={() => setShowGates(!showGates)} className="flex items-center gap-1.5 text-xs text-amber-500 hover:text-amber-400 transition-colors" data-testid="poll-toggle-gates">
              <FiLock size={11} />
              Token Gate {showGates ? '(hide)' : '(optional)'}
              {(ownGates.length + creGates.length > 0) && (
                <span className="ml-1 px-1.5 py-0.5 bg-amber-500/15 rounded text-[9px]">{ownGates.length + creGates.length}</span>
              )}
            </button>

            {showGates && (
              <div className="mt-2 space-y-3 bg-gray-950/50 border border-gray-800 rounded-xl p-3">
                <p className="text-[10px] text-gray-500">
                  Restrict voting to users who own specific objects or objects created by specific addresses.
                </p>

                <div className="flex gap-2">
                  <select value={gateType} onChange={e => setGateType(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none" data-testid="poll-gate-type">
                    <option value="own">Must own object</option>
                    <option value="cre">Must own by creator</option>
                  </select>
                  <input
                    value={gateInput}
                    onChange={e => setGateInput(e.target.value)}
                    placeholder={gateType === 'own' ? 'Object address...' : 'Creator address...'}
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none"
                    data-testid="poll-gate-input"
                  />
                  <button onClick={addGate} disabled={!gateInput.trim()} className="px-2 py-1.5 bg-amber-600/20 text-amber-400 rounded-lg text-xs hover:bg-amber-600/30 disabled:opacity-30" data-testid="poll-gate-add">
                    Add
                  </button>
                </div>

                {/* Current gates */}
                {ownGates.length > 0 && (
                  <div>
                    <span className="text-[9px] text-amber-500 uppercase tracking-wider">Object Gates</span>
                    {ownGates.map((addr, i) => (
                      <div key={`own-${i}`} className="flex items-center justify-between mt-1 px-2 py-1 bg-gray-800/50 rounded">
                        <code className="text-[10px] text-gray-400 truncate flex-1">{addr}</code>
                        <button onClick={() => removeGate('own', i)} className="text-gray-600 hover:text-red-400 ml-2"><FiX size={10} /></button>
                      </div>
                    ))}
                  </div>
                )}
                {creGates.length > 0 && (
                  <div>
                    <span className="text-[9px] text-amber-500 uppercase tracking-wider">Creator Gates</span>
                    {creGates.map((addr, i) => (
                      <div key={`cre-${i}`} className="flex items-center justify-between mt-1 px-2 py-1 bg-gray-800/50 rounded">
                        <code className="text-[10px] text-gray-400 truncate flex-1">{addr}</code>
                        <button onClick={() => removeGate('cre', i)} className="text-gray-600 hover:text-red-400 ml-2"><FiX size={10} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Warning */}
          {!isConnected && (
            <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
              <FiAlertTriangle size={12} /> Sign in to create polls
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-800/50 space-y-3">
          <FeePicker network={network} />
          <div className="flex items-center justify-between">
            <div className="text-[10px] text-gray-600">
              {answers.filter(a => a.trim()).length} options
              {endBlocks > 0 && ` | ${TIME_OPTIONS.find(o => o.value === endBlocks)?.label || endBlocks + ' blocks'}`}
              {(ownGates.length + creGates.length > 0) && ' | Token-gated'}
            </div>
            <button
              onClick={handleCreate}
              disabled={!isValid || !activeWif || sending}
              className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-30"
              data-testid="poll-create-btn"
            >
              <FiSend size={13} className={sending ? 'animate-pulse' : ''} />
              {sending ? 'Broadcasting...' : 'Create Poll'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
