import React from 'react';
import { FiCheck, FiExternalLink } from 'react-icons/fi';
import { CTHULHU_SVG } from '@/components/CthulhuLogo';

export default function MintSuccess({ user, mintResult, onGoToFeed, isUpdate }) {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-4">
          <img
            src={CTHULHU_SVG}
            alt="Cthulhu"
            className="h-10 w-auto mx-auto"
          />
        </div>
        <div className="bg-gray-900 border border-emerald-500/30 rounded-2xl p-8 text-center">
          <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <FiCheck size={32} className="text-emerald-400" />
          </div>
          <h2 className="text-2xl font-bold text-gray-100 mb-2">{isUpdate ? 'Profile Updated!' : 'Profile Minted!'}</h2>
          <p className="text-sm text-gray-400 mb-4">
            Your profile <strong className="text-emerald-400">@{user.urn}</strong> {isUpdate ? 'has been updated on' : 'is now on'} the blockchain.
            It will be discoverable after 1 confirmation.
          </p>
          <div className="bg-gray-950 border border-gray-800 rounded-lg p-3 mb-4 text-left">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Transaction ID</span>
              <span>{mintResult.encoded_addresses_count} outputs</span>
            </div>
            <code className="text-xs text-blue-400 break-all">{mintResult.txid}</code>
          </div>
          {mintResult.addresses?.length > 0 && (
            <details className="mb-4 text-left">
              <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-300 transition-colors" data-testid="mint-addresses-toggle">
                View output addresses ({mintResult.addresses.length})
              </summary>
              <div className="mt-2 bg-gray-950 border border-gray-800 rounded-lg p-2 max-h-40 overflow-y-auto space-y-0.5">
                {mintResult.addresses.map((addr, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <span className="text-[10px] text-gray-600 w-4 text-right flex-shrink-0">{i}</span>
                    <code className="text-[10px] text-gray-400 font-mono truncate">{addr}</code>
                  </div>
                ))}
              </div>
            </details>
          )}
          <div className="flex gap-3">
            <a
              href={`https://mempool.space/testnet/tx/${mintResult.txid}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm flex items-center justify-center gap-1.5 transition-colors"
              data-testid="view-tx-link"
            >
              <FiExternalLink size={14} /> View TX
            </a>
            <button
              onClick={onGoToFeed}
              className="flex-1 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors"
              data-testid="go-to-feed-btn"
            >
              Go to Feed
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
