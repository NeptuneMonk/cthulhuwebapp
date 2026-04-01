import { useState, useEffect } from 'react';
import axios from 'axios';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Shared in-memory cache across all hook instances
const cache = {};
const pending = {};

// Batch queue
let batchQueue = [];
let batchTimer = null;

function flushBatch(network) {
  if (batchQueue.length === 0) return;
  const addresses = [...new Set(batchQueue)];
  batchQueue = [];

  const uncached = addresses.filter((a) => !cache[a] && !pending[a]);
  if (uncached.length === 0) return;

  // Mark all as pending with a shared promise
  const promise = axios
    .post(`${API}/resolve/batch`, { addresses: uncached, network })
    .then((res) => {
      const data = res.data || {};
      for (const addr of uncached) {
        cache[addr] = data[addr] || {
          address: addr,
          urn: addr.substring(0, 8) + '...',
          image: null,
          found: false,
        };
        delete pending[addr];
      }
      return data;
    })
    .catch(() => {
      for (const addr of uncached) {
        cache[addr] = { address: addr, urn: addr.substring(0, 8) + '...', image: null, found: false };
        delete pending[addr];
      }
    });

  for (const addr of uncached) {
    pending[addr] = promise;
  }
}

function enqueue(address, network) {
  if (cache[address] || pending[address]) return;
  batchQueue.push(address);
  if (batchTimer) clearTimeout(batchTimer);
  batchTimer = setTimeout(() => flushBatch(network), 50);
}

/**
 * Resolve a blockchain address to { urn, image, display_name, found }.
 * Batches requests in 50ms windows to reduce API calls.
 */
export function useResolveAddress(address, network = 'btc-testnet') {
  const [resolved, setResolved] = useState(() => cache[address] || null);

  useEffect(() => {
    if (!address) return;

    // Already cached
    if (cache[address]) {
      setResolved(cache[address]);
      return;
    }

    // Enqueue for batch resolution
    enqueue(address, network);

    // Wait for the batch to complete
    const check = () => {
      if (cache[address]) {
        setResolved(cache[address]);
        return;
      }
      if (pending[address]) {
        pending[address].then(() => {
          setResolved(cache[address] || null);
        });
      }
    };

    // Small delay to allow batch to fire
    const timer = setTimeout(check, 80);
    return () => clearTimeout(timer);
  }, [address, network]);

  return resolved;
}
