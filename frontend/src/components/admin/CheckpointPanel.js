import { useState, useEffect, useCallback } from 'react';
import { FiRefreshCw, FiSend, FiCheck, FiX, FiClock, FiActivity, FiDatabase, FiExternalLink } from 'react-icons/fi';

const API = process.env.REACT_APP_BACKEND_URL + '/api/admin';

function getToken() { return sessionStorage.getItem('admin_token'); }

async function cpFetch(path, opts = {}) {
  const token = getToken();
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...(opts.headers || {}) },
  });
  return res;
}

export default function CheckpointPanel({ network = 'btc-testnet' }) {
  const [status, setStatus] = useState(null);
  const [pending, setPending] = useState(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [result, setResult] = useState(null);

  const fetchStatus = useCallback(async () => {
    try {
      const [sRes, pRes] = await Promise.all([
        cpFetch('/checkpoint/status'),
        cpFetch('/checkpoint/pending'),
      ]);
      if (sRes.ok) setStatus(await sRes.json());
      if (pRes.ok) setPending(await pRes.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus, network]);

  const handleToggle = async () => {
    const newEnabled = !status?.enabled;
    await cpFetch('/checkpoint/config', {
      method: 'POST',
      body: JSON.stringify({ enabled: newEnabled, network }),
    });
    fetchStatus();
  };

  const handleConfigUpdate = async (field, value) => {
    await cpFetch('/checkpoint/config', {
      method: 'POST',
      body: JSON.stringify({ [field]: value }),
    });
    fetchStatus();
  };

  const handleTrigger = async () => {
    setTriggering(true);
    setResult(null);
    try {
      const res = await cpFetch('/checkpoint/trigger', { method: 'POST' });
      const data = await res.json();
      setResult(data);
      fetchStatus();
    } catch (e) {
      setResult({ success: false, detail: e.message });
    }
    setTriggering(false);
  };

  if (loading) return <div className="text-gray-500 text-sm">Loading checkpoint status...</div>;

  return (
    <div className="space-y-6" data-testid="checkpoint-panel">
      {/* Status Card */}
      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2">
            <FiActivity size={16} className="text-amber-400" />
            Auto-Checkpoint
          </h3>
          <button
            onClick={handleToggle}
            className={`relative w-11 h-6 rounded-full transition-colors ${status?.enabled ? 'bg-emerald-500' : 'bg-gray-700'}`}
            data-testid="checkpoint-toggle"
          >
            <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${status?.enabled ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatBox label="Total Checkpoints" value={status?.total_checkpoints || 0} />
          <StatBox label="Messages Archived" value={status?.total_messages_checkpointed || 0} />
          <StatBox label="Pending Messages" value={pending?.total_pending || 0} accent />
          <StatBox label="Rooms with Pending" value={Object.keys(pending?.room_breakdown || {}).length} />
        </div>

        {status?.last_checkpoint_at && (
          <p className="text-xs text-gray-500 mt-3 flex items-center gap-1">
            <FiClock size={12} />
            Last checkpoint: {new Date(status.last_checkpoint_at).toLocaleString()}
            {status.last_checkpoint_txid && (
              <a
                href={`https://mempool.space/testnet/tx/${status.last_checkpoint_txid}`}
                target="_blank" rel="noreferrer"
                className="text-amber-400 hover:underline ml-1"
              >
                {status.last_checkpoint_txid.slice(0, 12)}...
              </a>
            )}
          </p>
        )}
      </div>

      {/* Configuration */}
      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-bold text-gray-200 mb-4">Configuration</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ConfigField
            label="Interval (minutes)"
            value={status?.interval_minutes || 60}
            type="number"
            onChange={(v) => handleConfigUpdate('interval_minutes', parseInt(v))}
          />
          <ConfigField
            label="Min messages to trigger"
            value={status?.min_messages || 10}
            type="number"
            onChange={(v) => handleConfigUpdate('min_messages', parseInt(v))}
          />
        </div>
      </div>

      {/* Manual Trigger */}
      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-gray-200">Manual Checkpoint</h3>
            <p className="text-xs text-gray-500 mt-1">
              Bundle {pending?.total_pending || 0} pending messages → IPFS → P2FK on-chain transaction
            </p>
          </div>
          <button
            onClick={handleTrigger}
            disabled={triggering || (pending?.total_pending || 0) === 0}
            className="px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-amber-600 hover:bg-amber-500 text-white"
            data-testid="checkpoint-trigger-btn"
          >
            {triggering ? (
              <><FiRefreshCw size={14} className="animate-spin" /> Broadcasting...</>
            ) : (
              <><FiSend size={14} /> Checkpoint Now</>
            )}
          </button>
        </div>

        {result && (
          <div className={`mt-3 p-3 rounded-lg border text-xs ${result.success && !result.skipped ? 'bg-emerald-900/20 border-emerald-800 text-emerald-300' : result.skipped ? 'bg-gray-800 border-gray-700 text-gray-400' : 'bg-red-900/20 border-red-800 text-red-300'}`}
               data-testid="checkpoint-result">
            {result.success && !result.skipped ? (
              <div className="space-y-1">
                <p className="flex items-center gap-1"><FiCheck size={14} /> Checkpoint broadcast successfully!</p>
                <p>Messages: {result.message_count} | Rooms: {result.room_count} | Cost: {result.dust_cost_sats} sats</p>
                <p className="flex items-center gap-1">
                  TXID: <a href={result.mempool_url} target="_blank" rel="noreferrer" className="text-amber-400 hover:underline">{result.txid?.slice(0, 16)}...</a>
                  <FiExternalLink size={10} />
                </p>
                <p className="flex items-center gap-1">
                  IPFS: <a href={result.ipfs_url} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">{result.cid?.slice(0, 20)}...</a>
                </p>
              </div>
            ) : result.skipped ? (
              <p>No messages to checkpoint.</p>
            ) : (
              <p className="flex items-center gap-1"><FiX size={14} /> {result.detail || 'Checkpoint failed'}</p>
            )}
          </div>
        )}
      </div>

      {/* Room Breakdown */}
      {pending?.room_breakdown && Object.keys(pending.room_breakdown).length > 0 && (
        <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-bold text-gray-200 mb-3 flex items-center gap-2">
            <FiDatabase size={14} /> Pending by Room
          </h3>
          <div className="space-y-2">
            {Object.entries(pending.room_breakdown).map(([room, count]) => (
              <div key={room} className="flex items-center justify-between py-1.5 px-2 bg-gray-800/40 rounded-lg">
                <span className="text-xs text-gray-400 font-mono truncate max-w-[200px]">{room}</span>
                <span className="text-xs text-amber-400 font-medium">{count} msgs</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Checkpoints */}
      {status?.recent_checkpoints?.length > 0 && (
        <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-bold text-gray-200 mb-3">Recent Checkpoints</h3>
          <div className="space-y-2">
            {status.recent_checkpoints.map((cp, i) => (
              <div key={i} className="flex items-center justify-between py-2 px-3 bg-gray-800/30 rounded-lg">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-300 font-mono truncate">
                    <a href={`https://mempool.space/testnet/tx/${cp.txid}`} target="_blank" rel="noreferrer" className="hover:text-amber-400">
                      {cp.txid?.slice(0, 16)}...
                    </a>
                  </p>
                  <p className="text-[10px] text-gray-500">
                    {cp.message_count} msgs | {cp.room_count} rooms | {cp.dust_cost_sats} sats
                  </p>
                </div>
                <span className="text-[10px] text-gray-600 whitespace-nowrap ml-2">
                  {new Date(cp.created_at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value, accent }) {
  return (
    <div className="bg-gray-800/40 rounded-lg p-3">
      <p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${accent ? 'text-amber-400' : 'text-white'}`}>{value}</p>
    </div>
  );
}

function ConfigField({ label, value, type, onChange }) {
  const [val, setVal] = useState(value);
  const [saved, setSaved] = useState(false);

  const save = () => {
    onChange(val);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div>
      <label className="text-xs text-gray-400 block mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type={type}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
          data-testid={`config-${label.toLowerCase().replace(/\s+/g, '-')}`}
        />
        <button
          onClick={save}
          className="px-3 py-2 rounded-lg text-xs bg-gray-700 hover:bg-gray-600 text-white transition-colors"
        >
          {saved ? <FiCheck size={14} className="text-emerald-400" /> : 'Save'}
        </button>
      </div>
    </div>
  );
}
