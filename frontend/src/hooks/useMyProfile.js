import { useState, useEffect } from 'react';
import { useAuth } from './useAuth';

/**
 * Lightweight hook to read the current user's cached profile image and URN
 * from localStorage. Avoids prop drilling for pages that need the profile header.
 */
export function useMyProfile(network) {
  const { user, isConnected } = useAuth();
  const [image, setImage] = useState(null);
  const [urn, setUrn] = useState(null);

  useEffect(() => {
    if (!user?.urn || !isConnected) {
      setImage(null);
      setUrn(null);
      return;
    }
    const imgKey = `cthulhu_profile_img_${user.urn}_${network}`;
    setImage(localStorage.getItem(imgKey));
    const cachedUrn = localStorage.getItem(`cthulhu_profile_urn_${network}`);
    setUrn(cachedUrn || user.urn);
  }, [user?.urn, user?.address, isConnected, network]);

  // Listen for storage changes (e.g. when Layout updates the cache)
  useEffect(() => {
    const handler = () => {
      if (!user?.urn) return;
      setImage(localStorage.getItem(`cthulhu_profile_img_${user.urn}_${network}`));
      setUrn(localStorage.getItem(`cthulhu_profile_urn_${network}`) || user.urn);
    };
    window.addEventListener('storage', handler);
    window.addEventListener('profile-updated', handler);
    return () => {
      window.removeEventListener('storage', handler);
      window.removeEventListener('profile-updated', handler);
    };
  }, [user?.urn, network]);

  return { image, urn, user, isConnected };
}
