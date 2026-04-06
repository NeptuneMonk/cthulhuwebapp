import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';

/** Profile page skeleton — avatar, name, bio, action buttons */
export function ProfileSkeleton() {
  return (
    <div className="h-full overflow-y-auto" data-testid="profile-skeleton">
      {/* Back header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-900/80 border-b border-gray-800/60">
        <Skeleton className="h-8 w-8 rounded-lg bg-gray-800" />
        <Skeleton className="h-4 w-32 bg-gray-800" />
      </div>
      {/* Profile header */}
      <div className="bg-gray-900 border-b border-gray-800">
        <div className="max-w-lg mx-auto px-6 pt-8 pb-6 flex flex-col items-center">
          <Skeleton className="h-24 w-24 rounded-full bg-gray-800 mb-4" />
          <Skeleton className="h-5 w-36 bg-gray-800 mb-2" />
          <Skeleton className="h-3 w-24 bg-gray-800/60 mb-4" />
          {/* Bio lines */}
          <div className="w-full max-w-xs space-y-2 mb-5">
            <Skeleton className="h-3 w-full bg-gray-800/50" />
            <Skeleton className="h-3 w-4/5 bg-gray-800/50 mx-auto" />
          </div>
          {/* Action buttons */}
          <div className="flex items-center gap-5">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="flex flex-col items-center gap-1.5">
                <Skeleton className="h-11 w-11 rounded-full bg-gray-800" />
                <Skeleton className="h-2.5 w-10 bg-gray-800/40" />
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Post skeletons */}
      <div className="space-y-px">
        {[1,2,3].map(i => <PostCardSkeleton key={i} />)}
      </div>
    </div>
  );
}

/** Single post/feed card skeleton */
export function PostCardSkeleton() {
  return (
    <div className="px-5 py-4 bg-gray-900/40 border-b border-gray-800/30" data-testid="post-skeleton">
      <div className="flex gap-3">
        <Skeleton className="h-10 w-10 rounded-full bg-gray-800 shrink-0" />
        <div className="flex-1 min-w-0 space-y-2.5">
          <div className="flex items-center gap-2">
            <Skeleton className="h-3.5 w-24 bg-gray-800" />
            <Skeleton className="h-2.5 w-16 bg-gray-800/40" />
          </div>
          <Skeleton className="h-3 w-full bg-gray-800/50" />
          <Skeleton className="h-3 w-3/4 bg-gray-800/50" />
        </div>
      </div>
    </div>
  );
}

/** Feed page skeleton — multiple post cards */
export function FeedSkeleton() {
  return (
    <div className="space-y-px" data-testid="feed-skeleton">
      {[1,2,3,4,5].map(i => <PostCardSkeleton key={i} />)}
    </div>
  );
}

/** Single object card skeleton */
export function ObjectCardSkeleton() {
  return (
    <div className="bg-gray-900/80 rounded-xl border border-gray-800/50 overflow-hidden" data-testid="object-card-skeleton">
      <Skeleton className="w-full aspect-square bg-gray-800" />
      <div className="p-3 space-y-2">
        <Skeleton className="h-4 w-3/4 bg-gray-800" />
        <Skeleton className="h-2.5 w-full bg-gray-800/40" />
        <div className="flex items-center justify-between pt-1">
          <Skeleton className="h-2.5 w-16 bg-gray-800/40" />
          <Skeleton className="h-2.5 w-12 bg-gray-800/40" />
        </div>
      </div>
    </div>
  );
}

/** Object grid skeleton — for storefront and user objects pages */
export function ObjectGridSkeleton({ count = 8 }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4" data-testid="object-grid-skeleton">
      {Array.from({ length: count }, (_, i) => <ObjectCardSkeleton key={i} />)}
    </div>
  );
}

/** User objects page skeleton — nav tabs + grid */
export function UserObjectsSkeleton() {
  return (
    <div className="h-full overflow-y-auto" data-testid="user-objects-skeleton">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-900/80 border-b border-gray-800/60">
        <Skeleton className="h-8 w-8 rounded-lg bg-gray-800" />
        <Skeleton className="h-4 w-28 bg-gray-800" />
      </div>
      {/* Nav tabs */}
      <div className="bg-gray-900 border-b border-gray-800">
        <div className="max-w-lg mx-auto px-6 py-5 flex items-center justify-center gap-5">
          {[1,2,3,4].map(i => (
            <div key={i} className="flex flex-col items-center gap-1.5">
              <Skeleton className="h-11 w-11 rounded-full bg-gray-800" />
              <Skeleton className="h-2.5 w-14 bg-gray-800/40" />
            </div>
          ))}
        </div>
      </div>
      {/* Grid */}
      <div className="p-4 max-w-4xl mx-auto">
        <ObjectGridSkeleton count={8} />
      </div>
    </div>
  );
}

/** Storefront page skeleton — search bar + filters + grid */
export function StorefrontSkeleton() {
  return (
    <div data-testid="storefront-skeleton">
      {/* Search */}
      <Skeleton className="h-10 w-full rounded-lg bg-gray-800 mb-4" />
      {/* Chain filters */}
      <div className="flex gap-2 mb-6">
        {['All','BTC','LTC','DOG','MZC','IPFS'].map(c => (
          <Skeleton key={c} className="h-8 w-14 rounded-full bg-gray-800/60" />
        ))}
      </div>
      {/* Grid */}
      <ObjectGridSkeleton count={8} />
    </div>
  );
}

/** Inline count shimmer — for object count badges that load lazily */
export function CountShimmer({ className = '' }) {
  return <Skeleton className={`h-4 w-6 rounded-full bg-gray-700/60 inline-block ${className}`} data-testid="count-shimmer" />;
}
