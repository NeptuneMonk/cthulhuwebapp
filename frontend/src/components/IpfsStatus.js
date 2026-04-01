import { useIpfsStatus } from '@/hooks/useIpfsStatus';

/**
 * Compact IPFS daemon status indicator.
 * Uses the singleton useIpfsStatus hook (no duplicate polling).
 */
export const IpfsStatus = ({ compact = false }) => {
  const { online } = useIpfsStatus();

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs ${online ? 'text-emerald-400' : 'text-red-400'}`}
      title={online ? 'IPFS daemon online — uploads will be pinned' : 'IPFS daemon offline — uploads unavailable'}
      data-testid={online ? 'ipfs-status-online' : 'ipfs-status-offline'}
    >
      <span className={`w-2 h-2 rounded-full ${online ? 'bg-emerald-400' : 'bg-red-400'}`} />
      {!compact && (online ? 'IPFS Online' : 'IPFS Offline')}
    </span>
  );
};
