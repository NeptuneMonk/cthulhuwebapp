import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiUser, FiDollarSign, FiCheck, FiCopy } from 'react-icons/fi';
import { useAuth } from '@/hooks/useAuth';
import { usePendingMint } from '@/hooks/usePendingMint';
import { addTransaction } from '@/utils/txHistory';
import { getChangeAddress, getCachedChangeAddress } from '@/utils/txBuilder';
import ProfileFormStep from '@/components/profile/ProfileFormStep';
import { CTHULHU_SVG } from '@/components/CthulhuLogo';
import FundWalletStep from '@/components/profile/FundWalletStep';
import MintStep from '@/components/profile/MintStep';
import MintSuccess from '@/components/profile/MintSuccess';
import { useMyProfile } from '@/hooks/useMyProfile';
import { ProfileThumb } from '@/components/ProfileThumb';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const STEPS = [
  { id: 'profile', label: 'Profile Info', icon: FiUser },
  { id: 'fund', label: 'Fund Wallet', icon: FiDollarSign },
  { id: 'mint', label: 'Mint Profile', icon: FiCheck },
];

/** Keep IPFS refs in SUP format (forward slash): IPFS:CID/filename */
function preserveIpfsRef(ref) {
  return ref || '';
}

export default function ProfileSetupPage() {
  const navigate = useNavigate();
  const { user, wif, isConnected, token, isMinted, updateUser } = useAuth();
  const { addPendingMint } = usePendingMint();
  const { image: myImage, urn: myUrn } = useMyProfile(user?.network || 'btc-testnet');
  const [step, setStep] = useState(0);
  const [profileLoaded, setProfileLoaded] = useState(false);

  // Unified profile form state
  const [form, setForm] = useState({
    urn: '',
    displayName: '',
    firstName: '',
    middleName: '',
    lastName: '',
    suffix: '',
    bio: '',
    imageRef: sessionStorage.getItem('cthulhu_setup_imageRef') || '',
    imagePreview: sessionStorage.getItem('cthulhu_setup_imagePreview') || '',
    urls: [],        // [{ key: 'website', value: 'https://...' }, ...]
    locEntries: [],  // [{ key: 'city', value: 'NYC' }, ...]
  });

  // Fund state
  const [balance, setBalance] = useState(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  // Mint state
  const [minting, setMinting] = useState(false);
  const [mintResult, setMintResult] = useState(null);
  const [mintError, setMintError] = useState('');

  // URN check status (passed up from ProfileFormStep)
  const [urnCheckStatus, setUrnCheckStatus] = useState(null);
  const balanceInterval = useRef(null);

  // Persist IPFS ref across refreshes
  useEffect(() => {
    if (form.imageRef) sessionStorage.setItem('cthulhu_setup_imageRef', form.imageRef);
  }, [form.imageRef]);
  useEffect(() => {
    if (form.imagePreview) sessionStorage.setItem('cthulhu_setup_imagePreview', form.imagePreview);
  }, [form.imagePreview]);

  // Redirect if not logged in
  useEffect(() => {
    if (!isConnected) navigate('/auth');
  }, [isConnected, navigate]);

  // Pre-fill display name from URN (only for existing minted profiles)
  useEffect(() => {
    if (isMinted && user?.urn && user.urn !== user?.address && !form.displayName) {
      setForm(f => ({ ...f, displayName: user.urn }));
    }
  }, [user?.urn]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch and pre-fill existing profile when updating
  useEffect(() => {
    if (!isMinted || !user?.address || profileLoaded) return;
    (async () => {
      try {
        const res = await fetch(`${API}/profile/${user.address}?network=${user.network || 'btc-testnet'}`);
        if (!res.ok) return;
        const p = await res.json();
        if (!p?.urn) return;
        const imgRef = preserveIpfsRef(p.image || '');
        setForm(f => ({
          ...f,
          displayName: p.display_name || p.urn || '',
          firstName: p.first_name || '',
          middleName: p.middle_name || '',
          lastName: p.last_name || '',
          suffix: p.suffix || '',
          bio: p.bio || '',
          imageRef: imgRef || f.imageRef,
          imagePreview: imgRef ? (() => {
            const raw = imgRef.replace(/^IPFS:/i, '').replace(/\\/g, '/');
            const parts = raw.split('/');
            return parts.length > 1
              ? `https://ipfs.io/ipfs/${parts[0]}/${encodeURIComponent(parts.slice(1).join('/'))}`
              : `https://ipfs.io/ipfs/${parts[0]}`;
          })() : f.imagePreview,
          urls: p.url ? Object.entries(p.url).map(([k, v]) => ({ key: k, value: v })) : [],
          locEntries: p.location ? Object.entries(p.location).map(([k, v]) => ({ key: k, value: v })) : [],
        }));
      } catch { /* silent */ }
      finally { setProfileLoaded(true); }
    })();
  }, [isMinted, user?.address, user?.network, profileLoaded]);

  // Balance polling on fund step
  const fetchBalance = useCallback(async () => {
    if (!user?.address) return;
    setBalanceLoading(true);
    try {
      const { getBalance } = await import('@/utils/chainExplorer');
      const net = user.network || 'btc-testnet';
      const mainBal = await getBalance(user.address, net);
      const data = {
        balance_sats: mainBal.total,
        balance_btc: mainBal.total / 1e8,
        confirmed_sats: mainBal.confirmed,
        unconfirmed_sats: mainBal.unconfirmed,
      };
      const changeAddr = wif
        ? getChangeAddress(wif, net)
        : getCachedChangeAddress(user.address);
      if (changeAddr) {
        try {
          const changeBal = await getBalance(changeAddr, net);
          if (changeBal.total) {
            data.balance_sats = (data.balance_sats || 0) + changeBal.total;
            data.balance_btc = data.balance_sats / 1e8;
          }
        } catch { /* change address may not exist yet */ }
      }
      setBalance(data);
    } catch {} finally { setBalanceLoading(false); }
  }, [user?.address, user?.network, wif]);

  useEffect(() => {
    if (step === 1) {
      fetchBalance();
      balanceInterval.current = setInterval(fetchBalance, 10000);
    }
    return () => { if (balanceInterval.current) clearInterval(balanceInterval.current); };
  }, [step, fetchBalance]);

  // Convert form URL/loc arrays to dictionaries for the protocol
  const formToProfileData = () => {
    const urlDict = {};
    for (const e of (form.urls || [])) { if (e.key && e.value) urlDict[e.key] = e.value; }
    const locDict = {};
    for (const e of (form.locEntries || [])) { if (e.key && e.value) locDict[e.key] = e.value; }

    return {
      urn: isMinted ? user.urn : (form.urn || '').trim(),
      displayName: form.displayName || undefined,
      firstName: form.firstName || undefined,
      middleName: form.middleName || undefined,
      lastName: form.lastName || undefined,
      suffix: form.suffix || undefined,
      bio: form.bio || undefined,
      image: form.imageRef || undefined,
      url: Object.keys(urlDict).length > 0 ? urlDict : undefined,
      loc: Object.keys(locDict).length > 0 ? locDict : undefined,
    };
  };

  // Mint profile — fully client-side signing
  const handleMint = async () => {
    const urnToMint = isMinted ? user.urn : (form.urn || '').trim();
    if (!wif || !urnToMint) return;
    setMinting(true);
    setMintError('');
    try {
      const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
      const cleanWif = wif.split('').filter(c => BASE58.includes(c)).join('');

      const [{ buildProfileTransaction }, { buildAndBroadcast }] = await Promise.all([
        import('@/utils/p2fk'),
        import('@/utils/txBuilder'),
      ]);

      const profileData = formToProfileData();

      let addresses, senderAddress;
      try {
        const result = buildProfileTransaction(cleanWif, profileData, user.network || 'btc-testnet');
        addresses = result.addresses;
        senderAddress = result.senderAddress;
        var taxInsertIndex = result.taxInsertIndex;
      } catch (buildErr) {
        throw new Error(`Build failed: ${buildErr.message}`);
      }

      let txResult;
      try {
        txResult = await buildAndBroadcast(cleanWif, addresses, user.network || 'btc-testnet', [], 0, 546, [], taxInsertIndex);
      } catch (broadcastErr) {
        throw new Error(`Broadcast failed: ${broadcastErr.message}`);
      }

      if (!txResult.success) throw new Error(txResult.error || 'Broadcast returned failure');

      setMintResult({
        txid: txResult.txid,
        encoded_addresses_count: addresses.length,
        address: senderAddress,
        addresses,
      });

      addTransaction(senderAddress, {
        txid: txResult.txid, type: 'PRO', network: user.network || 'btc-testnet',
        addresses, label: `Profile ${isMinted ? 'update' : 'mint'}: @${urnToMint}`,
      });

      addPendingMint(txResult.txid, user.network || 'btc-testnet', 'profile');

      sessionStorage.removeItem('cthulhu_setup_imageRef');
      sessionStorage.removeItem('cthulhu_setup_imagePreview');

      // Update user's URN in auth state if this is a new mint
      if (!isMinted && urnToMint !== user.urn) {
        updateUser({ urn: urnToMint, is_minted: true });
      }

      // Register on backend (no key material)
      fetch(`${API}/wallet/register-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: senderAddress,
          network: user.network || 'btc-testnet',
          urn: urnToMint,
          image: form.imageRef || null,
          display_name: form.displayName || null,
        }),
      }).catch(() => {});

      if (token) {
        fetch(`${API}/auth/update-minted`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
      }
    } catch (err) {
      setMintError(err.message);
    } finally { setMinting(false); }
  };

  const balanceSats = balance?.balance_sats || 0;
  const hasFunds = balanceSats >= 10000;

  if (!user) return null;

  if (mintResult) {
    return <MintSuccess user={user} mintResult={mintResult} onGoToFeed={() => navigate('/feed')} isUpdate={isMinted} />;
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-950 pb-24">
      <div className="w-full max-w-lg mx-auto p-4 pt-4">
        {/* Back to feed */}
        <button onClick={() => navigate('/feed')} className="mb-4 text-sm text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1" data-testid="setup-back-btn">
          &larr; Back to feed
        </button>
        {/* Profile header */}
        {isConnected && (
          <div className="flex items-center gap-3 mb-6">
            <ProfileThumb name={(!isMinted ? form.urn : myUrn) || '?'} image={myImage || form.imagePreview} size="lg" />
            <div className="flex-1 min-w-0">
              <p className="text-base font-bold text-gray-100 truncate">
                {(!isMinted ? form.urn : myUrn) || 'New Profile'}
              </p>
              <p className="text-xs text-gray-500 truncate font-mono cursor-pointer hover:text-gray-300 transition-colors inline-flex items-center gap-1"
                onClick={() => navigator.clipboard?.writeText(user?.address)}
                title="Copy address"
                data-testid="copy-setup-address"
              >{user?.address?.slice(0, 16)}...{user?.address?.slice(-6)} <FiCopy size={9} className="flex-shrink-0" /></p>
            </div>
          </div>
        )}
        {/* Branding */}
        <div className="text-center mb-6">
          <img
            src={CTHULHU_SVG}
            alt="Cthulhu" className="h-10 w-auto mx-auto mb-1"
          />
          <span className="text-xs text-gray-600">v0.1.0</span>
        </div>

        {/* Stepper */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const active = i === step;
            const done = i < step;
            return (
              <React.Fragment key={s.id}>
                {i > 0 && <div className={`w-8 h-px ${done ? 'bg-purple-500' : 'bg-gray-700'}`} />}
                <div className="flex flex-col items-center gap-1" data-testid={`step-${s.id}`}>
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    done ? 'bg-purple-600' : active ? 'bg-purple-600/30 border border-purple-500' : 'bg-gray-800'
                  }`}>
                    {done ? <FiCheck size={18} className="text-white" /> : <Icon size={18} className={active ? 'text-purple-400' : 'text-gray-500'} />}
                  </div>
                  <span className={`text-xs ${active ? 'text-purple-400' : done ? 'text-gray-400' : 'text-gray-600'}`}>{s.label}</span>
                </div>
              </React.Fragment>
            );
          })}
        </div>

        {step === 0 && (
          <>
            {mintError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                <p className="text-sm text-red-400" data-testid="urn-validation-error">{mintError}</p>
              </div>
            )}
            <ProfileFormStep
            user={user}
            form={form}
            setForm={setForm}
            onUrnStatusChange={setUrnCheckStatus}
            onNext={() => {
              if (!isMinted && !(form.urn || '').trim()) {
                setMintError('Please choose a Profile Name (URN) before proceeding.');
                return;
              }
              if (!isMinted && urnCheckStatus === 'taken') {
                setMintError('This URN is already claimed. Choose a different name.');
                return;
              }
              if (!isMinted && urnCheckStatus === 'checking') {
                setMintError('Still checking URN availability. Please wait.');
                return;
              }
              setMintError('');
              setStep(1);
            }}
            onSkip={() => navigate('/feed')}
            isUpdate={isMinted}
          />
          </>
        )}

        {step === 1 && (
          <FundWalletStep
            user={user}
            balance={balance}
            balanceLoading={balanceLoading}
            fetchBalance={fetchBalance}
            hasFunds={hasFunds}
            onNext={() => setStep(2)}
            onBack={() => setStep(0)}
            network={user?.network || 'btc-testnet'}
          />
        )}

        {step === 2 && (
          <MintStep
            user={user}
            form={form}
            onMint={handleMint}
            minting={minting}
            mintError={mintError}
            onBack={() => setStep(1)}
            isUpdate={isMinted}
            network={network}
          />
        )}
      </div>
    </div>
  );
}
