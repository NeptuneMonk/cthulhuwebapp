/**
 * EtchToChain — Tool for encoding and broadcasting files to the blockchain.
 *
 * Uses the P2FK protocol to store arbitrary data on-chain in chunks,
 * similar to how the Potcoin Pac-Man game was etched.
 *
 * Each file is split into chunks that fit within P2FK transaction outputs,
 * then each chunk is broadcast as a separate transaction. The resulting
 * txids form a manifest that can be used to reconstruct the data.
 */
import React, { useState, useCallback, useRef } from 'react';
import { FiUpload, FiPlay, FiFile, FiCheck, FiAlertCircle, FiTrash2, FiLink, FiCopy, FiZap, FiChevronDown, FiChevronUp } from 'react-icons/fi';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

const API = process.env.REACT_APP_BACKEND_URL;

// P2FK encoding constraints
const BYTES_PER_ADDRESS = 20; // usable bytes per output address (hash160)
const ADDRESSES_PER_TX = 80; // conservative: leave room for change + protocol overhead
const CHUNK_SIZE = BYTES_PER_ADDRESS * ADDRESSES_PER_TX; // ~1600 bytes per tx

/** Split a file into chunks suitable for P2FK transactions */
function chunkFile(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunks = [];
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    chunks.push(bytes.slice(i, i + CHUNK_SIZE));
  }
  return chunks;
}

/** Estimate transaction cost in satoshis for a given number of chunks */
function estimateCost(numChunks, feePerTx = 5000) {
  return numChunks * feePerTx;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}

export default function EtchToChain({ network, isWalletUnlocked: walletUnlocked, wif: walletWif, user: passedUser }) {
  const authFallback = useAuth();
  const user = passedUser || authFallback.user;
  const wif = walletWif !== undefined ? walletWif : authFallback.wif;
  const isWalletUnlocked = walletUnlocked !== undefined ? walletUnlocked : authFallback.isWalletUnlocked;
  const [files, setFiles] = useState([]);
  const [etching, setEtching] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, phase: '' });
  const [manifest, setManifest] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const inputRef = useRef(null);

  const handleFileAdd = useCallback((e) => {
    const newFiles = Array.from(e.target.files).map(f => ({
      file: f,
      name: f.name,
      size: f.size,
      chunks: Math.ceil(f.size / CHUNK_SIZE),
      status: 'pending',
      txids: [],
    }));
    setFiles(prev => [...prev, ...newFiles]);
  }, []);

  const removeFile = (idx) => setFiles(prev => prev.filter((_, i) => i !== idx));

  const totalChunks = files.reduce((sum, f) => sum + f.chunks, 0);
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  const estimatedSats = estimateCost(totalChunks);

  const handleEtch = useCallback(async () => {
    if (!wif || !user?.address || files.length === 0) return;
    setEtching(true);
    const allTxids = {};

    try {
      let globalChunk = 0;
      const totalC = totalChunks;
      setProgress({ current: 0, total: totalC, phase: 'Preparing...' });

      for (let fi = 0; fi < files.length; fi++) {
        const f = files[fi];
        const buffer = await f.file.arrayBuffer();
        const chunks = chunkFile(buffer);
        const txids = [];

        setFiles(prev => prev.map((pf, i) => i === fi ? { ...pf, status: 'etching' } : pf));

        for (let ci = 0; ci < chunks.length; ci++) {
          globalChunk++;
          setProgress({ current: globalChunk, total: totalC, phase: `Etching ${f.name} (chunk ${ci + 1}/${chunks.length})` });

          // Encode chunk as hex and send to backend for broadcast
          const chunkHex = Array.from(chunks[ci]).map(b => b.toString(16).padStart(2, '0')).join('');

          const res = await fetch(`${API}/api/etch/chunk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              address: user.address,
              network,
              chunk_hex: chunkHex,
              filename: f.name,
              chunk_index: ci,
              total_chunks: chunks.length,
            }),
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `Failed to etch chunk ${ci + 1}`);
          }

          const { txid } = await res.json();
          txids.push(txid);

          // Small delay to avoid rate limits
          if (ci < chunks.length - 1) await new Promise(r => setTimeout(r, 1000));
        }

        allTxids[f.name] = txids;
        setFiles(prev => prev.map((pf, i) => i === fi ? { ...pf, status: 'done', txids } : pf));
      }

      // Build manifest
      const manifestObj = {
        version: 1,
        files: Object.entries(allTxids).map(([name, txids]) => ({ name, txids, chunks: txids.length })),
        etched_by: user.address,
        network,
        timestamp: new Date().toISOString(),
      };

      // Upload manifest to IPFS as well for easy sharing
      const manifestRes = await fetch(`${API}/api/chat/checkpoint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bundle_json: JSON.stringify(manifestObj),
          address: user.address,
          network,
        }),
      });

      let manifestCid = null;
      if (manifestRes.ok) {
        const { cid } = await manifestRes.json();
        manifestCid = cid;
        manifestObj.manifest_cid = cid;
      }

      setManifest(manifestObj);
      setProgress({ current: totalC, total: totalC, phase: 'Complete!' });
      toast.success(`Etched ${files.length} file(s) to the blockchain!`);

    } catch (e) {
      toast.error(`Etching failed: ${e.message}`);
      setProgress(prev => ({ ...prev, phase: `Error: ${e.message}` }));
    } finally {
      setEtching(false);
    }
  }, [wif, user, files, network, totalChunks]);

  const copyManifest = () => {
    navigator.clipboard?.writeText(JSON.stringify(manifest, null, 2));
    toast.success('Manifest copied to clipboard');
  };

  return (
    <div className="bg-gray-800/40 rounded-xl p-4" data-testid="etch-to-chain">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h4 className="text-sm font-bold text-gray-100">Etch to Chain</h4>
          <p className="text-xs text-gray-500 mt-0.5">Store files permanently on the blockchain</p>
        </div>
        <FiZap size={16} className="text-amber-400" />
      </div>

      {!isWalletUnlocked ? (
        <div className="text-center py-4">
          <FiAlertCircle size={20} className="mx-auto text-amber-400 mb-2" />
          <p className="text-xs text-gray-500">Unlock your wallet to etch files</p>
        </div>
      ) : (
        <>
          {/* File picker */}
          <input
            ref={inputRef}
            type="file"
            multiple
            onChange={handleFileAdd}
            className="hidden"
            data-testid="etch-file-input"
          />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={etching}
            className="w-full border-2 border-dashed border-gray-700 rounded-lg py-4 px-3 text-center hover:border-amber-500/40 transition-colors group disabled:opacity-40"
            data-testid="etch-add-files-btn"
          >
            <FiUpload size={18} className="mx-auto text-gray-600 group-hover:text-amber-400 transition-colors mb-1" />
            <p className="text-xs text-gray-500 group-hover:text-gray-400">Click to add files</p>
          </button>

          {/* File list */}
          {files.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {files.map((f, i) => (
                <div key={i} className="flex items-center gap-2 bg-gray-900/60 rounded-lg px-3 py-2">
                  <FiFile size={12} className={`flex-shrink-0 ${f.status === 'done' ? 'text-emerald-400' : f.status === 'etching' ? 'text-amber-400 animate-pulse' : 'text-gray-500'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-300 truncate">{f.name}</p>
                    <p className="text-[9px] text-gray-600">{formatBytes(f.size)} / {f.chunks} chunk{f.chunks !== 1 ? 's' : ''}</p>
                  </div>
                  {f.status === 'done' && <FiCheck size={12} className="text-emerald-400 flex-shrink-0" />}
                  {f.status === 'pending' && (
                    <button onClick={() => removeFile(i)} className="text-gray-600 hover:text-red-400" data-testid={`etch-remove-file-${i}`}>
                      <FiTrash2 size={12} />
                    </button>
                  )}
                </div>
              ))}

              {/* Cost estimate */}
              <div className="bg-gray-900/40 rounded-lg p-3 mt-2">
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-500">Total size</span>
                  <span className="text-gray-300">{formatBytes(totalSize)}</span>
                </div>
                <div className="flex justify-between text-[10px] mt-1">
                  <span className="text-gray-500">Transactions needed</span>
                  <span className="text-gray-300">{totalChunks}</span>
                </div>
                <div className="flex justify-between text-[10px] mt-1">
                  <span className="text-gray-500">Estimated cost</span>
                  <span className="text-amber-400 font-medium">~{(estimatedSats / 100_000_000).toFixed(6)} coins</span>
                </div>
              </div>

              {/* Advanced toggle */}
              <button onClick={() => setShowAdvanced(!showAdvanced)} className="flex items-center gap-1 text-[10px] text-gray-600 hover:text-gray-400 transition-colors mt-1">
                {showAdvanced ? <FiChevronUp size={10} /> : <FiChevronDown size={10} />}
                Advanced
              </button>
              {showAdvanced && (
                <div className="text-[10px] text-gray-600 bg-gray-900/30 rounded p-2 space-y-0.5">
                  <p>Encoding: P2FK (pay-to-future-key) — {BYTES_PER_ADDRESS} bytes/address, {ADDRESSES_PER_TX} addresses/tx</p>
                  <p>Chunk size: {formatBytes(CHUNK_SIZE)}</p>
                  <p>Each chunk becomes one blockchain transaction</p>
                  <p>Files are reconstructed via bitfossil.com or Cthulhu's on-chain resolver</p>
                </div>
              )}

              {/* Etch button */}
              {!etching && !manifest && (
                <button
                  onClick={handleEtch}
                  className="w-full mt-2 py-2.5 rounded-lg bg-amber-500/20 text-amber-400 font-medium text-sm hover:bg-amber-500/30 transition-colors active:scale-[0.98]"
                  data-testid="etch-start-btn"
                >
                  <FiZap size={14} className="inline mr-1.5" />
                  Etch {files.length} file{files.length !== 1 ? 's' : ''} to Chain
                </button>
              )}
            </div>
          )}

          {/* Progress */}
          {etching && (
            <div className="mt-3">
              <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                <span>{progress.phase}</span>
                <span>{progress.current}/{progress.total}</span>
              </div>
              <div className="h-2 bg-gray-900 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-emerald-500 rounded-full transition-all"
                  style={{ width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}

          {/* Manifest result */}
          {manifest && (
            <div className="mt-3 bg-gray-900/60 rounded-lg p-3" data-testid="etch-manifest">
              <div className="flex items-center gap-2 mb-2">
                <FiCheck size={14} className="text-emerald-400" />
                <span className="text-sm font-bold text-emerald-400">Etched!</span>
              </div>
              {manifest.manifest_cid && (
                <div className="flex items-center gap-2 mb-2">
                  <FiLink size={10} className="text-gray-500" />
                  <span className="text-[10px] text-gray-500">IPFS Manifest:</span>
                  <span className="text-[10px] font-mono text-cyan-400 truncate">{manifest.manifest_cid}</span>
                </div>
              )}
              {manifest.files.map((f, i) => (
                <div key={i} className="mb-1">
                  <p className="text-[10px] text-gray-400">{f.name} ({f.chunks} tx{f.chunks !== 1 ? 's' : ''})</p>
                  <p className="text-[9px] font-mono text-gray-600 truncate">{f.txids[0]}...</p>
                </div>
              ))}
              <button onClick={copyManifest} className="mt-2 text-[10px] text-gray-500 hover:text-gray-300 flex items-center gap-1" data-testid="etch-copy-manifest">
                <FiCopy size={10} /> Copy manifest
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
