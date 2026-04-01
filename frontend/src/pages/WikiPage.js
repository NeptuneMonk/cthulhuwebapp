/**
 * WikiPage — Internal knowledge base for Cthulhu.
 * Covers: What is Cthulhu, SUP, P2FK, tutorials, disclaimers, ancient artifacts lore.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiArrowLeft, FiBook, FiShield, FiAlertTriangle, FiExternalLink, FiHash, FiLayers, FiBox, FiUsers, FiLock, FiZap, FiGlobe, FiMic, FiKey, FiDatabase, FiTrash2, FiVideo, FiMessageCircle, FiSend, FiDollarSign, FiAward, FiUploadCloud } from 'react-icons/fi';

const SECTIONS = [
  { id: 'cthulhu', title: 'What is Cthulhu?', icon: FiZap },
  { id: 'sup', title: 'What is SUP?', icon: FiUsers },
  { id: 'p2fk', title: 'What is P2FK?', icon: FiHash },
  { id: 'objects', title: 'Objects & NFTs', icon: FiBox },
  { id: 'artifacts', title: 'Ancient Artifacts', icon: FiGlobe },
  { id: 'on-chain-age-titles', title: 'On-Chain Age Titles', icon: FiAward },
  { id: 'profile-mint', title: 'How to: Mint Profile', icon: FiLayers },
  { id: 'object-mint', title: 'How to: Create Objects', icon: FiBox },
  { id: 'create-room', title: 'How to: Create a Room', icon: FiUsers },
  { id: 'create-venue', title: 'How to: Speaking Venue', icon: FiMic },
  { id: 'video-calls', title: 'Video & Audio Calls', icon: FiVideo },
  { id: 'wallet-keys', title: 'Wallet & Key Management', icon: FiKey },
  { id: 'chain-backups', title: 'Chain Backups', icon: FiUploadCloud },
  { id: 'coin-control', title: 'Coin Control', icon: FiDollarSign },
  { id: 'encrypted-pm', title: 'Encrypted Messaging', icon: FiLock },
  { id: 'message-requests', title: 'Message Requests', icon: FiMessageCircle },
  { id: 'data-storage', title: 'Data & IPFS Cache', icon: FiDatabase },
  { id: 'burning', title: 'Burning Objects', icon: FiTrash2 },
  { id: 'mainnet', title: 'Mainnet Warning', icon: FiAlertTriangle },
  { id: 'disclaimers', title: 'Disclaimers & Legal', icon: FiShield },
  { id: 'resources', title: 'Resources & Links', icon: FiExternalLink },
];

function SectionBlock({ id, children }) {
  return <section id={id} className="scroll-mt-20 mb-12">{children}</section>;
}

function H2({ children }) {
  return <h2 className="text-lg font-bold text-gray-100 mb-4 flex items-center gap-2 border-b border-gray-800/50 pb-2">{children}</h2>;
}

function H3({ children }) {
  return <h3 className="text-sm font-bold text-purple-400 mb-2 mt-6">{children}</h3>;
}

function P({ children }) {
  return <p className="text-sm text-gray-400 leading-relaxed mb-3">{children}</p>;
}

function Step({ num, title, children }) {
  return (
    <div className="flex gap-3 mb-4">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-purple-900/40 border border-purple-700/30 flex items-center justify-center">
        <span className="text-xs font-bold text-purple-400">{num}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-200 mb-1">{title}</p>
        <div className="text-sm text-gray-400 leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

function Warning({ children }) {
  return (
    <div className="flex items-start gap-2.5 p-3.5 bg-amber-900/10 border border-amber-800/20 rounded-lg mb-4">
      <FiAlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
      <div className="text-xs text-amber-500/90 leading-relaxed">{children}</div>
    </div>
  );
}

function InfoBox({ children }) {
  return (
    <div className="p-3.5 bg-purple-900/10 border border-purple-800/20 rounded-lg mb-4">
      <div className="text-xs text-purple-300/80 leading-relaxed">{children}</div>
    </div>
  );
}

function ScreenRef({ label }) {
  return (
    <div className="my-3 p-3 bg-gray-800/40 border border-gray-700/30 rounded-lg flex items-center gap-2">
      <div className="w-1 h-8 rounded-full bg-purple-500/60 flex-shrink-0" />
      <span className="text-xs text-gray-500 italic">{label}</span>
    </div>
  );
}

function ExtLink({ href, children }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-purple-400 hover:text-purple-300 underline underline-offset-2">
      {children} <FiExternalLink size={10} />
    </a>
  );
}

export default function WikiPage() {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState('cthulhu');

  const handleNavClick = (id) => {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="flex h-full bg-[#0a0e14] text-gray-100" data-testid="wiki-page">
      {/* Sidebar navigation */}
      <div className="hidden lg:flex flex-col w-56 flex-shrink-0 border-r border-gray-800/50 bg-gray-950/50 p-4 overflow-y-auto">
        <div className="flex items-center gap-2 mb-6">
          <FiBook size={18} className="text-purple-400" />
          <h1 className="text-sm font-bold text-gray-200">Knowledge Base</h1>
        </div>
        <nav className="space-y-0.5">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => handleNavClick(s.id)}
              className={`w-full text-left flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-colors ${
                activeSection === s.id
                  ? 'bg-purple-900/20 text-purple-400 font-medium'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
              }`}
              data-testid={`wiki-nav-${s.id}`}
            >
              <s.icon size={12} />
              {s.title}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Mobile header */}
        <div className="sticky top-0 z-10 bg-gray-950/95 backdrop-blur-sm border-b border-gray-800/50 px-4 py-3 flex items-center gap-3 lg:hidden">
          <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-gray-200">
            <FiArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-2">
            <FiBook size={16} className="text-purple-400" />
            <h1 className="text-sm font-bold text-gray-200">Knowledge Base</h1>
          </div>
        </div>

        {/* Mobile section tabs */}
        <div className="lg:hidden overflow-x-auto border-b border-gray-800/50 px-4 py-2 flex gap-1.5 no-scrollbar">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => handleNavClick(s.id)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[10px] font-medium transition-colors ${
                activeSection === s.id
                  ? 'bg-purple-900/30 text-purple-400 border border-purple-700/30'
                  : 'text-gray-500 bg-gray-800/30'
              }`}
            >
              {s.title}
            </button>
          ))}
        </div>

        <div className="p-6 max-w-3xl mx-auto">
          {/* ===== WHAT IS CTHULHU ===== */}
          <SectionBlock id="cthulhu">
            <H2><FiZap size={18} className="text-purple-400" /> What is Cthulhu?</H2>
            <P>
              Cthulhu is a decentralized social media platform built on the blockchain. Unlike traditional social networks controlled by corporations, Cthulhu stores your posts, profiles, and digital objects directly on-chain &mdash; making them permanent, uncensorable, and truly owned by you.
            </P>
            <P>
              Named after the legendary Cthulhu creature of the deep, the platform's logo is itself an ancient on-chain artifact: the 2013 fully embedded emoji, one of a number of ancient artifacts preserved on the Bitcoin blockchain. These digital relics can be discovered, claimed, and traded within Cthulhu or the SUP desktop client.
            </P>
            <P>
              Cthulhu is a web-based client for the SUP (Satoshi Universal Protocol), meaning everything you do here is fully compatible with the SUP Windows desktop application. Your data isn't locked into Cthulhu &mdash; it lives on the blockchain, accessible from any compatible client.
            </P>
            <H3>Key Capabilities</H3>
            <ul className="text-sm text-gray-400 space-y-2 mb-4 ml-4 list-disc list-outside">
              <li><strong>On-Chain Social Networking:</strong> Profiles, posts, and encrypted DMs stored permanently on the blockchain</li>
              <li><strong>Digital Object Marketplace:</strong> Create, buy, sell, and trade tokenized objects (similar to NFTs)</li>
              <li><strong>Blockchain Video Conferencing:</strong> Peer-to-peer audio and video calls signaled through the Bitcoin mempool &mdash; no centralized servers</li>
              <li><strong>Token-Gated Rooms:</strong> Object-tethered chat rooms and Speaking Venues with paid seating</li>
              <li><strong>Bitcoin Core-Style Wallet:</strong> Full UTXO management with Coin Control, multi-address aggregation, and an integrated address book</li>
              <li><strong>Non-Custodial Security:</strong> Your private keys are encrypted in your browser and never leave your device</li>
            </ul>
            <InfoBox>
              <strong>Multi-Chain Support:</strong> Cthulhu operates across Bitcoin (BTC), Litecoin (LTC), and Dogecoin (DOGE), both on mainnet and testnet. Each chain has its own independent ecosystem of profiles, objects, and messages.
            </InfoBox>
          </SectionBlock>

          {/* ===== WHAT IS SUP ===== */}
          <SectionBlock id="sup">
            <H2><FiUsers size={18} className="text-purple-400" /> What is SUP?</H2>
            <P>
              SUP (Satoshi Universal Protocol) is the underlying protocol that powers Cthulhu. Created by <strong>embii4u</strong>, SUP enables fully decentralized social networking, digital object ownership, and encrypted communication &mdash; all built on top of existing blockchain infrastructure with zero centralized servers required for data storage.
            </P>
            <H3>Core Features of SUP</H3>
            <ul className="text-sm text-gray-400 space-y-2 mb-4 ml-4 list-disc list-outside">
              <li><strong>Profile Minting:</strong> Create a unique on-chain identity (URN) associated with your wallet address</li>
              <li><strong>Tokenized Objects:</strong> Create, buy, sell, give, and burn digital objects (similar to NFTs) that live entirely on the blockchain</li>
              <li><strong>On-Chain Posts:</strong> Write permanent messages stored as blockchain transactions</li>
              <li><strong>Encrypted Private Messages:</strong> End-to-end encrypted communication using ECIES (Elliptic Curve Integrated Encryption Scheme)</li>
              <li><strong>Object-Based Chat Rooms:</strong> Group conversations tied to specific digital objects (Tethers)</li>
              <li><strong>Speaking Venues:</strong> Token-gated live rooms where audience members can purchase speaking seats</li>
              <li><strong>Blockchain Video Conferencing:</strong> Peer-to-peer audio and video calls with WebRTC, signaled through the Bitcoin mempool</li>
              <li><strong>INQ Polls:</strong> Create on-chain polls with optional token gating and time limits</li>
              <li><strong>Royalties:</strong> Object creators earn royalties on secondary sales automatically</li>
              <li><strong>On-Chain File Embedding:</strong> Attach files directly to the blockchain using BitFossil/Apertus</li>
              <li><strong>Walkie-Talkie:</strong> Encrypted voice broadcasts over the blockchain</li>
            </ul>
            <P>
              The SUP desktop client (C# Windows application) is the reference implementation of the protocol. Cthulhu is a fully compatible web client &mdash; everything created in Cthulhu appears in SUP and vice versa.
            </P>
            <InfoBox>
              Watch embii4u's {' '}
              <ExtLink href="https://youtube.com/playlist?list=PLDNMoJ2rHmfoxt1AX417-lWt2zvWUnKUH">
                SUP Tutorial Playlist on YouTube
              </ExtLink>
              {' '} for detailed walkthroughs of every feature.
            </InfoBox>
          </SectionBlock>

          {/* ===== WHAT IS P2FK ===== */}
          <SectionBlock id="p2fk">
            <H2><FiHash size={18} className="text-purple-400" /> What is P2FK?</H2>
            <P>
              P2FK (Pay-to-Future-Key) is the revolutionary encoding mechanism that makes SUP possible. It allows arbitrary data to be embedded into standard cryptocurrency transactions by encoding information into the "addresses" field of a transaction output.
            </P>
            <H3>Why "Future Key"?</H3>
            <P>
              The addresses used in P2FK transactions are not currently active wallet addresses &mdash; they are specially crafted public key hashes that encode data. While nobody can spend coins sent to them today, these keys <em>could</em> theoretically correspond to real keys discovered far in the future. They are not "fake" &mdash; they exist in the future possibility space. The name "Pay-to-Future-Key" reflects this distinction, as coined by <strong>embii4u</strong>, the inventor of P2FK.
            </P>
            <H3>How It Works</H3>
            <P>
              In a normal transaction, you send coins TO a real wallet address. P2FK instead sends dust amounts (546 satoshis) to these future-key addresses that encode data. The data is permanently recorded on the blockchain &mdash; profile information, object metadata, post content, encryption keys, and more.
            </P>
            <P>
              The data is permanent, uncensorable, and fully public (except for encrypted messages). The <ExtLink href="https://p2fk.io">p2fk.io</ExtLink> API reads and indexes this data, presenting it in a structured format that clients like Cthulhu and SUP can use.
            </P>
            <H3>P2FK Transaction Types</H3>
            <ul className="text-sm text-gray-400 space-y-2 mb-4 ml-4 list-disc list-outside">
              <li><strong>PRO</strong> &mdash; Profile creation and updates (username, bio, image, private messaging keys)</li>
              <li><strong>OBJ</strong> &mdash; Object creation with Name, URN (content/media), optional Image (thumbnail), pricing, and royalties</li>
              <li><strong>BUY</strong> &mdash; Purchase an object at its listed price</li>
              <li><strong>GIV</strong> &mdash; Transfer an object to another address for free</li>
              <li><strong>BRN</strong> &mdash; Permanently destroy (burn) an object on-chain</li>
              <li><strong>LST</strong> &mdash; List/delist an object for sale</li>
              <li><strong>SEC</strong> &mdash; Encrypted private message data</li>
              <li><strong>INQ</strong> &mdash; On-chain polls and inquiries</li>
            </ul>
            <Warning>
              P2FK transactions are standard blockchain transactions. They cost real transaction fees. On testnet, this is free (faucet coins). On mainnet, each action costs a small amount of real cryptocurrency.
            </Warning>
          </SectionBlock>

          {/* ===== OBJECTS & NFTs ===== */}
          <SectionBlock id="objects">
            <H2><FiBox size={18} className="text-purple-400" /> Objects &amp; Digital Ownership</H2>
            <P>
              Objects in Cthulhu/SUP are similar to NFTs but built on the P2FK protocol rather than smart contracts. Each object has a <strong>Name</strong> (title), a <strong>URN</strong> (the actual content/media being claimed — an IPFS file, on-chain data, text, etc.), an optional <strong>Image</strong> (thumbnail for listings), an owner, a creator, and optional metadata like descriptions and royalty settings.
            </P>
            <H3>Object Types</H3>
            <ul className="text-sm text-gray-400 space-y-2 mb-4 ml-4 list-disc list-outside">
              <li><strong>Standard Objects:</strong> Single-edition unique items with a creator and owner</li>
              <li><strong>Collections:</strong> Multi-edition objects. The creator holds the "mint" and can produce multiple copies</li>
              <li><strong>Self-Owned Objects:</strong> Objects where the creator and owner are the same address. These often serve as chat rooms (Tethers)</li>
              <li><strong>Free Objects:</strong> Objects priced at 0 that can be claimed by anyone</li>
            </ul>
            <H3>What You Can Do</H3>
            <ul className="text-sm text-gray-400 space-y-2 mb-4 ml-4 list-disc list-outside">
              <li><strong>Buy:</strong> Purchase an object at its listed price. Royalties are automatically distributed to the creator</li>
              <li><strong>Give:</strong> Transfer an object to another address for free</li>
              <li><strong>Burn:</strong> Permanently destroy an object using a BRN protocol transaction (see "Burning Objects" section)</li>
              <li><strong>Create:</strong> Mint new objects with images, descriptions, pricing, and royalty settings</li>
            </ul>
            <H3>Key Pool &mdash; Pre-Generated Object Addresses</H3>
            <P>
              When you create an account on Cthulhu, a pool of 50 independent keypairs is silently generated and encrypted with your password. When you mint a new object, an address is pulled from this reserve pool rather than being created on-the-fly. This improves security by preventing key generation at the point of transaction. Used keys automatically appear in your wallet's Address Book; unused keys remain hidden. The pool auto-replenishes when it runs low.
            </P>
            <H3>On-Chain Embedding vs. IPFS</H3>
            <P>
              Most objects in Cthulhu use IPFS (InterPlanetary File System) for their media files. The IPFS hash is stored on-chain, and the actual file is hosted on the distributed IPFS network. Cthulhu runs its own IPFS node for all uploads.
            </P>
            <P>
              However, truly brave creators can embed files <strong>directly on the blockchain</strong> using tools like <ExtLink href="https://apertus.io">Apertus.io</ExtLink>. These fully on-chain artifacts are the most permanent form of digital content possible &mdash; they will exist as long as the blockchain exists.
            </P>
          </SectionBlock>

          {/* ===== ANCIENT ARTIFACTS ===== */}
          <SectionBlock id="artifacts">
            <H2><FiGlobe size={18} className="text-purple-400" /> Ancient Artifacts</H2>
            <P>
              Long before the term "NFT" existed, early adopters were embedding data on the Bitcoin blockchain. These pioneering experiments left behind <strong>ancient artifacts</strong> &mdash; fully on-chain content from as early as 2013.
            </P>
            <P>
              The Cthulhu logo itself is one such artifact: a <strong>2013 fully embedded emoji</strong>, part of a collection of on-chain relics from the earliest days of blockchain data embedding. These aren't just historical curiosities &mdash; they are tradeable digital objects that can be bought, sold, and given within Cthulhu or SUP.
            </P>
            <P>
              Many more ancient artifacts still exist on Bitcoin, Litecoin, and Dogecoin blockchains, waiting to be discovered. Anyone with a valid cryptographic signature can claim ownership of unclaimed artifacts. This is digital archaeology &mdash; exploring the blockchain's history to uncover forgotten treasures.
            </P>
          </SectionBlock>

          {/* ===== ON-CHAIN AGE TITLES ===== */}
          <SectionBlock id="on-chain-age-titles">
            <H2><FiAward size={18} className="text-purple-400" /> On-Chain Age Titles</H2>
            <P>
              A classification system for understanding the historical age and cultural significance of early on-chain artifacts.
              Every object in Cthulhu is automatically assigned an age title based on the year it was first inscribed on the blockchain.
              These titles appear as badges on object detail pages.
            </P>

            <H3>The Primordial Era (2009&ndash;2014)</H3>
            <div className="mb-4 p-3 rounded-lg bg-gradient-to-r from-amber-900/30 to-stone-900/30 border border-amber-700/30">
              <p className="text-xs font-bold text-amber-300 tracking-wide uppercase mb-1">Title: Genesis Relic</p>
              <P>
                These are the "before language had rules" objects &mdash; raw, scarce, accidental art. This era includes the earliest
                inscriptions, experiments, and proto-artifacts on the blockchain. Perfect examples include early emoji fossils and other
                pre-NFT cultural imprints. Artifacts from this era are extraordinarily rare.
              </P>
            </div>

            <H3>The Forging Era (2015&ndash;2020)</H3>
            <div className="mb-4 p-3 rounded-lg bg-gradient-to-r from-orange-900/25 to-red-950/25 border border-orange-700/25">
              <p className="text-xs font-bold text-orange-300 tracking-wide uppercase mb-1">Title: Mid-Epoch Relic</p>
              <P>
                This era represents the time when creators understood what they were doing, but the culture had not yet solidified.
                It was a period of experimentation, transition, and proto-NFT development. These artifacts show intention but still
                carry the wild-frontier energy of early blockchain creativity.
              </P>
            </div>

            <H3>The Expansion Era (2021&ndash;2023)</H3>
            <div className="mb-4 p-3 rounded-lg bg-gradient-to-r from-cyan-900/20 to-blue-950/20 border border-cyan-700/20">
              <p className="text-xs font-bold text-cyan-300 tracking-wide uppercase mb-1">Title: Network Renaissance Piece</p>
              <P>
                This is when NFTs and on-chain culture became a global phenomenon. Artifacts from this era are not ancient, but they are
                historically important. They reflect the moment when blockchain creativity entered mainstream awareness and the network
                experienced a cultural renaissance.
              </P>
            </div>

            <H3>Contemporary Era (2024+)</H3>
            <div className="mb-4 p-3 rounded-lg bg-gray-800/30 border border-gray-700/30">
              <p className="text-xs font-bold text-gray-400 tracking-wide uppercase mb-1">No special title assigned</p>
              <P>
                Artifacts created after 2024 do not receive a special age-based label. They are considered contemporary on-chain objects.
                Over time, new eras may be defined as the culture evolves.
              </P>
            </div>

            <InfoBox>
              Age titles are determined by the object's <strong>CreatedDate</strong> &mdash; the timestamp of the original on-chain inscription.
              These labels are permanent and reflect the artifact's place in blockchain history.
            </InfoBox>
          </SectionBlock>

          {/* ===== PROFILE MINT ===== */}
          <SectionBlock id="profile-mint">
            <H2><FiLayers size={18} className="text-purple-400" /> How to: Mint Your Profile</H2>
            <P>
              Minting a profile creates your permanent on-chain identity. This associates your chosen username (URN) with your wallet address on the blockchain via a PRO transaction.
            </P>
            <ScreenRef label="Navigate to: Profile tab (bottom nav) > Login or Create Account" />
            <Step num="1" title="Create an Account">
              Click <strong>"Create Account"</strong> on the login screen. Choose a profile name (URN) and a strong password. This generates a new wallet and encrypts your private key in the browser. <strong>Your private key never leaves your device.</strong> A reserve pool of 50 object keypairs is also silently generated and encrypted at this point.
            </Step>
            <Step num="2" title="Set Up Your Profile">
              After signup, you'll see the profile setup wizard. Fill in your <strong>URN</strong> (your permanent on-chain username), an optional <strong>bio</strong>, and a <strong>profile image</strong> (uploaded to IPFS). This data will be encoded into your profile mint transaction.
            </Step>
            <ScreenRef label="Screen: Profile Setup Wizard &mdash; URN, Bio, and Image fields" />
            <Step num="3" title="Fund Your Wallet">
              Your wallet needs a small amount of cryptocurrency to pay for the minting transaction. On testnet, use a <strong>faucet</strong> to get free test coins. The wizard shows your wallet address and provides faucet links. Wait for the balance to appear (the app polls automatically).
            </Step>
            <InfoBox>
              <strong>Testnet faucets:</strong> For BTC testnet, visit <ExtLink href="https://buytestnet.com">buytestnet.com</ExtLink> or use the mempool.space testnet faucet. You only need a few thousand satoshis.
            </InfoBox>
            <Step num="4" title="Mint Your Profile">
              Once funded, click <strong>"Mint Profile."</strong> The app constructs a PRO transaction entirely in your browser, signs it with your key, and broadcasts it. Your profile appears on-chain once confirmed (usually a few minutes on testnet).
            </Step>
            <Warning>
              Your URN is permanent once minted. Choose carefully! You can update your bio and image later with a new PRO transaction, but the URN itself cannot be changed.
            </Warning>
            <Warning>
              <strong>Back up your private key (WIF).</strong> It is the ONLY way to prove ownership of your profile and objects. Open your <strong>Wallet</strong> and navigate to the <strong>Addresses</strong> tab to view and export your WIF securely.
            </Warning>
          </SectionBlock>

          {/* ===== OBJECT MINT ===== */}
          <SectionBlock id="object-mint">
            <H2><FiBox size={18} className="text-purple-400" /> How to: Create Objects</H2>
            <P>
              Creating an object mints a new digital item on the blockchain via an OBJ transaction. You become the creator, and you can set a price, royalties, and attach media. Each new object uses a pre-generated address from your key pool.
            </P>
            <ScreenRef label="Desktop: Header > 'Ink' > 'Forge Artifact' | Mobile: Storefront > create button" />
            <Step num="1" title="Open the Create Modal">
              <strong>On desktop:</strong> Click <strong>"Ink"</strong> in the top header bar and select <strong>"Forge Artifact"</strong> from the dropdown. <strong>On mobile:</strong> Navigate to the <strong>Storefront</strong> tab and tap the create (<strong>+</strong>) button.
            </Step>
            <Step num="2" title="Fill in Object Details">
              <ul className="list-disc list-inside space-y-1 mt-1">
                <li><strong>Name:</strong> Give your object a title. This is what people see in search and browse.</li>
                <li><strong>URN:</strong> The content being claimed — an IPFS file, on-chain data, text string, or any media reference. This is what the object actually IS.</li>
                <li><strong>Description:</strong> Describe what makes it special</li>
                <li><strong>Image:</strong> Optional thumbnail/cover art shown in listings. If your URN is already an image, you can skip this.</li>
                <li><strong>Price:</strong> Set a sale price in satoshis (or 0 for a free/claimable object)</li>
                <li><strong>Royalty %:</strong> Percentage you earn on every secondary sale (0&ndash;100%)</li>
                <li><strong>Collection?:</strong> Toggle if this is a multi-edition object (you retain the mint and can produce copies)</li>
              </ul>
            </Step>
            <Step num="3" title="Review & Mint">
              Review all details carefully. The OBJ transaction is constructed and signed entirely in your browser using a key from your pre-generated key pool. You need enough wallet balance to cover the transaction fee.
            </Step>
            <Step num="4" title="Secure Your Object Key">
              After minting, a <strong>"Copy the Keys"</strong> dialog appears showing the object's address and encrypted private key. The key is automatically stored in your wallet, but you should also save a backup. This key proves ownership and is required for certain operations on the object.
            </Step>
            <Warning>
              Object creation is permanent. Once minted, the object's core properties (name, creator address) cannot be changed. Make sure everything is correct before minting.
            </Warning>
          </SectionBlock>

          {/* ===== CREATE A ROOM ===== */}
          <SectionBlock id="create-room">
            <H2><FiUsers size={18} className="text-purple-400" /> How to: Create a Room (Tether)</H2>
            <P>
              Rooms in Cthulhu are called <strong>Tethers</strong>. A tether is a self-owned object that serves as a group chat room. Anyone who "tethers" to it (follows it) will see it in their sidebar and can post messages in its feed.
            </P>
            <ScreenRef label="Desktop: Header > 'Ink' > 'Summon Tether' | Mobile: Chats > FAB (+) > 'Craft Chat'" />
            <Step num="1" title="Open Tether Creation">
              <strong>On desktop:</strong> Click <strong>"Ink"</strong> in the top header bar and select <strong>"Summon Tether"</strong> from the dropdown. <strong>On mobile:</strong> Go to the <strong>Chats</strong> tab and tap the floating <strong>+</strong> button, then select <strong>"Craft Chat."</strong> Both paths take you to the <strong>Create Tether</strong> page.
            </Step>
            <Step num="2" title="Choose Room Type">
              You'll see two options:
              <ul className="list-disc list-inside space-y-1 mt-1">
                <li><strong>Public Room:</strong> An open chat room anyone can join and post in. This creates a standard self-owned object</li>
                <li><strong>Speaking Venue:</strong> A token-gated room with limited speaking seats (see "Speaking Venue" section)</li>
              </ul>
            </Step>
            <Step num="3" title="Fill in Room Details">
              <ul className="list-disc list-inside space-y-1 mt-1">
                <li><strong>Room Name:</strong> The name that appears in the sidebar and search results</li>
                <li><strong>Description:</strong> What this room is about</li>
                <li><strong>Room Image:</strong> An optional icon/image uploaded to IPFS</li>
                <li><strong>Sub-Topic:</strong> Optionally make this a sub-room of an existing tether (provide the parent address)</li>
              </ul>
            </Step>
            <Step num="4" title="Create">
              Click create. A self-owned OBJ transaction is constructed and broadcast. Once confirmed, your room will appear and others can find it via search or direct link.
            </Step>
            <InfoBox>
              <strong>Public vs. Gated:</strong> Public rooms are regular self-owned objects &mdash; anyone can post. Speaking Venues are multi-edition objects where seats must be purchased, creating a token-gated experience.
            </InfoBox>
          </SectionBlock>

          {/* ===== SPEAKING VENUE ===== */}
          <SectionBlock id="create-venue">
            <H2><FiMic size={18} className="text-purple-400" /> How to: Create a Speaking Venue</H2>
            <P>
              Speaking Venues are a special type of Tether where only seat-holders can post ("speak"). The creator controls the number of available seats, and audience members purchase seats using cryptocurrency. This creates a token-gated live discussion environment.
            </P>
            <ScreenRef label="Desktop: 'Ink' > 'Summon Tether' > Speaking Venue | Mobile: Chats > (+) > 'Craft Chat' > Speaking Venue" />
            <Step num="1" title="Select 'Speaking Venue' Type">
              Open the <strong>Create Tether</strong> page (via <strong>"Summon Tether"</strong> on desktop or <strong>"Craft Chat"</strong> on mobile &mdash; see above). Then click the <strong>"Speaking Venue"</strong> option (the microphone icon). This changes the object type to a multi-edition collection.
            </Step>
            <Step num="2" title="Set Total Speaking Slots">
              Choose how many total speaking seats your venue will have (minimum 2). This becomes the object's edition count. The creator automatically holds seat #1.
            </Step>
            <Step num="3" title="Fill Details & Create">
              Add a venue name, description, and optional image, then create. The OBJ transaction mints a collection with your specified seat count.
            </Step>
            <Step num="4" title="List Seats for Sale">
              After creation, go to the venue's object page and <strong>list seats for sale</strong>. Set a price per seat. Audience members can then buy seats to gain speaking access.
            </Step>
            <H3>How It Works for the Audience</H3>
            <P>
              When someone visits a Speaking Venue they don't hold a seat in, they see the conversation as read-only. They can <strong>purchase a seat</strong> at the listed price to gain speaking access. Audience members can also send ephemeral "Super Chat" messages (tip-based messages that appear temporarily) without holding a seat.
            </P>
          </SectionBlock>

          {/* ===== VIDEO & AUDIO CALLS ===== */}
          <SectionBlock id="video-calls">
            <H2><FiVideo size={18} className="text-purple-400" /> Blockchain Video &amp; Audio Calls</H2>
            <P>
              Cthulhu features fully decentralized peer-to-peer audio and video calling. Unlike conventional calling apps that route through centralized servers, Cthulhu's calls are signaled directly through the <strong>Bitcoin mempool</strong> &mdash; making them truly serverless.
            </P>
            <H3>How It Works</H3>
            <P>
              The calling system uses <strong>WebRTC</strong> for the actual media stream (audio/video) but replaces the traditional signaling server with the blockchain mempool:
            </P>
            <Step num="1" title="Caller Initiates">
              When you place a call, Cthulhu creates a WebRTC offer (SDP), encrypts it with the recipient's public encryption keys (ECIES), and embeds it into a P2FK transaction broadcast to the mempool. The transaction uses a special <strong>RING</strong> dust value (547 sats) to identify it as a call.
            </Step>
            <Step num="2" title="Recipient Detects the Ring">
              The recipient's app monitors the mempool via a WebSocket connection. When a RING transaction is detected (typically within 2 seconds), the app decrypts the SDP offer, displays an incoming call alert with ringtone, and presents Accept/Decline options.
            </Step>
            <Step num="3" title="Connection Established">
              If accepted, the recipient creates a WebRTC answer, encrypts it, and sends it back via another P2FK transaction with an <strong>ANSW</strong> dust value (548 sats). The caller detects this answer, and both peers establish a direct WebRTC connection. From this point, audio and video flow directly peer-to-peer with no intermediary.
            </Step>
            <H3>Features</H3>
            <ul className="text-sm text-gray-400 space-y-2 mb-4 ml-4 list-disc list-outside">
              <li><strong>Audio Calls:</strong> Voice-only calls with low latency</li>
              <li><strong>Video Calls:</strong> HD video at 720p resolution, face-to-face blockchain conferencing</li>
              <li><strong>Voicemail:</strong> If the recipient doesn't answer, you can leave a voice message that's stored as an encrypted DM</li>
              <li><strong>Custom Ringtones:</strong> Record and set a personal ringtone in Call Settings</li>
              <li><strong>Call Tones:</strong> Record a greeting tone that plays for the caller while they wait for you to pick up</li>
              <li><strong>In-Call Controls:</strong> Mute, toggle video, switch camera, and speaker controls during active calls</li>
            </ul>
            <H3>Phone Dialer</H3>
            <P>
              Open the phone dialer from any user's DM page or profile. You can make audio-only or video calls. The dialer shows a classic phone interface with the recipient's profile info.
            </P>
            <InfoBox>
              <strong>Cost:</strong> Each call attempt costs a small transaction fee (the RING and ANSW transactions). On testnet this is free. On mainnet, calls cost a few hundred satoshis each way. Both parties need a minted profile with published encryption keys (pkx/pky) for the encrypted signaling to work.
            </InfoBox>
            <Warning>
              Call quality depends on both parties' internet connection. The blockchain is only used for signaling (connecting the call) &mdash; the actual audio/video streams directly between peers via WebRTC.
            </Warning>
          </SectionBlock>

          {/* ===== WALLET & KEY MANAGEMENT ===== */}
          <SectionBlock id="wallet-keys">
            <H2><FiKey size={18} className="text-purple-400" /> Wallet &amp; Key Management</H2>
            <P>
              Cthulhu is a <strong>non-custodial</strong> platform. Your private key (WIF) is encrypted with your password and stored in your browser's local storage. The server never sees or stores your key. The wallet is designed in the style of <strong>Bitcoin Core</strong>, giving you full control over your funds.
            </P>
            <H3>Wallet Tabs</H3>
            <P>
              The wallet is organized into five tabs, accessible from the Wallet button in the header or bottom navigation:
            </P>
            <ul className="text-sm text-gray-400 space-y-2 mb-4 ml-4 list-disc list-outside">
              <li><strong>Overview:</strong> Shows your aggregated balance across all addresses (main wallet, change addresses, and all object addresses). Displays recent transactions and quick-action buttons for Send and Receive</li>
              <li><strong>Send:</strong> Compose transactions with a pay-to address, amount, and fee selection. Includes <strong>Coin Control</strong> for manual UTXO selection (see next section)</li>
              <li><strong>Receive:</strong> Displays your wallet address with a QR code. Lists all your system addresses (main, change) and object addresses for receiving funds</li>
              <li><strong>Transactions:</strong> Full transaction history with filters by type, searchable and sortable</li>
              <li><strong>Addresses:</strong> A comprehensive address book showing all addresses you control &mdash; main wallet, change addresses, and object addresses. Each entry shows the address type, label, and current balance. Object addresses include a "Decrypt WIF" option to reveal the private key for that specific object</li>
            </ul>
            <H3>Balance Aggregation</H3>
            <P>
              Your wallet overview shows the <strong>total balance</strong> across all addresses you control. This includes your main wallet address, any change addresses from previous transactions, and all object addresses whose encrypted keys are stored in your browser. This gives you a complete picture of your on-chain wealth.
            </P>
            <H3>Exporting Your Private Key (WIF)</H3>
            <Step num="1" title="Open Your Wallet">
              Click the wallet icon in the header or bottom navigation to open the wallet panel.
            </Step>
            <Step num="2" title="Navigate to Addresses Tab">
              Go to the <strong>Addresses</strong> tab to see all your addresses. Click on your main address and use the <strong>"Decrypt WIF"</strong> button to reveal your private key after entering your password.
            </Step>
            <Warning>
              <strong>Your WIF is your identity.</strong> Anyone with your WIF can spend your coins and control your profile. Never share it. Never paste it into unknown websites. If you lose your password AND your WIF, your wallet and everything in it is permanently lost.
            </Warning>
            <H3>Importing an Existing Key</H3>
            <P>
              When creating an account, you can choose to <strong>import an existing WIF key</strong> instead of generating a new one. This lets you use the same wallet across Cthulhu and the SUP desktop client.
            </P>
            <H3>Multi-Wallet Support</H3>
            <P>
              Cthulhu supports up to 5 wallets per network. You can switch between them in Settings. Each wallet has its own address, balance, and associated profile.
            </P>
            <H3>State Persistence</H3>
            <P>
              Your follows list, pinned friends, tethered rooms, favorites, and playlists can be backed up directly to the blockchain using <strong>Chain Backups</strong>. See the <button onClick={() => handleNavClick('chain-backups')} className="text-purple-400 hover:underline font-medium">Chain Backups</button> section for details.
            </P>
          </SectionBlock>

          {/* ===== CHAIN BACKUPS ===== */}
          <SectionBlock id="chain-backups">
            <H2><FiUploadCloud size={18} className="text-purple-400" /> Chain Backups</H2>
            <P>
              SEC Etch Backups allow you to encrypt and inject your entire application state &mdash; follows, rooms, pins, favorites, playlists, collection WIFs, notification state, and preferences &mdash; directly onto the blockchain as raw data. This creates a permanent, self-sovereign backup that is invisible to all indexers and can be restored on any device using just your WIF and the transaction ID.
            </P>
            <H3>How It Works</H3>
            <P>
              When you save a SEC backup, Cthulhu collects your state from <strong>all networks</strong> (both mainnet and testnet), encrypts it with AES-256-GCM using a key derived from your private key, and injects the encrypted bytes as raw address-encoded data onto the <strong>Bitcoin testnet</strong>. No P2FK SIG header is used &mdash; the data is invisible to all P2FK indexers, SUP clients, and Cthulhu feeds.
            </P>
            <P>
              Only you can decrypt this data, using your WIF. The backup always etches to testnet regardless of your current network, keeping costs minimal. You receive a pointer in the format <code className="text-purple-400 bg-gray-800 px-1 rounded text-xs">tBTC:TransactionID</code> to find and restore your data.
            </P>
            <H3>What Gets Backed Up</H3>
            <ul className="text-sm text-gray-400 space-y-2 mb-4 ml-4 list-disc list-outside">
              <li><strong>Follows &amp; Pinned Friends:</strong> Your entire social graph across all networks</li>
              <li><strong>Tethered Rooms:</strong> All rooms you've joined</li>
              <li><strong>Favorites &amp; Playlists:</strong> Your curated content lists</li>
              <li><strong>Collection WIFs:</strong> Private keys for your collections (critical for recovery)</li>
              <li><strong>Object Derivation Index:</strong> Ensures future objects use the correct index</li>
              <li><strong>Profile URN:</strong> Your login identity mapping</li>
              <li><strong>Object Addresses:</strong> Addresses of objects you own</li>
              <li><strong>Transaction History:</strong> Your local tx log</li>
              <li><strong>Notification State:</strong> Read/unread markers, DM timestamps</li>
              <li><strong>Preferences:</strong> Wallpaper, auto-pin, network selection</li>
            </ul>
            <H3>How to: Save a SEC Backup</H3>
            <ScreenRef label="Navigate to: Settings > Data and Storage > SEC Etch Backup" />
            <Step num="1" title="Unlock Your Wallet">
              Your wallet must be unlocked (password entered) to derive the encryption key and sign the transaction.
            </Step>
            <Step num="2" title="Estimate Cost">
              Click <strong>"Estimate Etch Cost"</strong>. Cthulhu calculates the data size, encrypted size, number of output addresses, dust cost, and transaction fee.
            </Step>
            <Step num="3" title="Confirm &amp; Etch">
              Click <strong>"Etch to Chain"</strong> to broadcast. The backup is encrypted, encoded into raw addresses, and permanently injected onto the Bitcoin testnet. You'll receive a pointer like <code className="text-purple-400 bg-gray-800 px-1 rounded text-xs">tBTC:abc123...</code>.
            </Step>
            <InfoBox>
              You can also save a SEC backup during sign-out. Cthulhu will show you the backup pointer (TXID) before logging out &mdash; make sure to copy it for recovery.
            </InfoBox>
            <H3>How to: Restore from TXID</H3>
            <Step num="1" title="Sign In">
              Log in with your WIF or password on a new device or fresh browser.
            </Step>
            <Step num="2" title="Open Data and Storage">
              Go to <strong>Settings &rarr; Data and Storage</strong> and find the <strong>"Restore from TXID"</strong> section.
            </Step>
            <Step num="3" title="Enter TXID">
              Paste your backup pointer (<code className="text-purple-400 bg-gray-800 px-1 rounded text-xs">tBTC:txid</code> or just the 64-character TXID). Cthulhu fetches the transaction, decodes the output addresses, decrypts with your WIF, and merges the data into your local state.
            </Step>
            <Step num="4" title="Refresh">
              Refresh the page to see your restored follows, rooms, favorites, and settings in the UI.
            </Step>
            <InfoBox>
              SEC backups are <strong>additive</strong> &mdash; restoring merges with your existing local data rather than overwriting it.
            </InfoBox>
            <H3>Backup History</H3>
            <P>
              Your SEC backup history is stored locally. Each entry shows the date, pointer (network + TXID), address count, and cost. You can copy any pointer or click to pre-fill the restore input directly.
            </P>
            <Warning>
              Chain Backups require a small testnet balance to cover the transaction fee. If you see "No UTXOs" when trying to save, fund your testnet wallet using a faucet first.
            </Warning>
          </SectionBlock>

          {/* ===== COIN CONTROL ===== */}
          <SectionBlock id="coin-control">
            <H2><FiDollarSign size={18} className="text-purple-400" /> Coin Control</H2>
            <P>
              Coin Control is an advanced wallet feature that gives you fine-grained control over which specific <strong>UTXOs</strong> (Unspent Transaction Outputs) are used as inputs in a transaction. This is critical for privacy, fee optimization, and P2FK protocol compatibility.
            </P>
            <H3>What Are UTXOs?</H3>
            <P>
              Unlike a bank account that stores a single balance, Bitcoin (and similar chains) tracks ownership through UTXOs &mdash; individual "coins" of various sizes. When you receive 0.005 BTC in one transaction and 0.003 BTC in another, your wallet holds two separate UTXOs. When you send a transaction, you choose which of these coins to spend.
            </P>
            <H3>How to Use Coin Control</H3>
            <ScreenRef label="Navigate to: Wallet > Send tab > 'Coin Control' toggle" />
            <Step num="1" title="Open the Send Tab">
              Open your wallet and navigate to the <strong>Send</strong> tab.
            </Step>
            <Step num="2" title="Expand Coin Control">
              Toggle the <strong>"Coin Control"</strong> panel to reveal all available UTXOs across your addresses.
            </Step>
            <Step num="3" title="Select UTXOs">
              Manually check the UTXOs you want to use. Each entry shows the transaction ID, amount, address, and confirmation status. Use "Select All" or "Clear" for bulk operations.
            </Step>
            <Step num="4" title="Compose & Send">
              Fill in the recipient address and amount as usual. The transaction will only use your manually selected UTXOs as inputs.
            </Step>
            <InfoBox>
              <strong>P2FK Compatibility:</strong> Coin Control preserves the address ordering required by the P2FK protocol's <code>sendmany</code> feature. When using Coin Control, the transaction builder ensures addresses are not reordered, maintaining full interoperability with the SUP protocol.
            </InfoBox>
            <H3>Why Use Coin Control?</H3>
            <ul className="text-sm text-gray-400 space-y-2 mb-4 ml-4 list-disc list-outside">
              <li><strong>Privacy:</strong> Avoid linking UTXOs from different sources in a single transaction</li>
              <li><strong>Fee Optimization:</strong> Select fewer, larger UTXOs to minimize transaction size and fees</li>
              <li><strong>Dust Management:</strong> Consolidate small UTXOs or avoid spending dust outputs</li>
              <li><strong>P2FK Operations:</strong> Ensure the correct UTXOs and address ordering for protocol-specific transactions</li>
            </ul>
          </SectionBlock>

          {/* ===== ENCRYPTED MESSAGING ===== */}
          <SectionBlock id="encrypted-pm">
            <H2><FiLock size={18} className="text-purple-400" /> Encrypted Private Messages</H2>
            <P>
              Cthulhu supports end-to-end encrypted private messaging using ECIES (Elliptic Curve Integrated Encryption Scheme). Messages are encrypted on your device before being broadcast to the blockchain &mdash; only the intended recipient can decrypt them.
            </P>
            <H3>How It Works</H3>
            <P>
              When you mint your profile, your public encryption keys (pkx, pky) are published on-chain as part of the PRO transaction. Anyone can use these keys to encrypt a message that only you can read. The encrypted message is stored on the blockchain as a SEC (encrypted) P2FK transaction.
            </P>
            <H3>Sending & Receiving</H3>
            <Step num="1" title="Navigate to a User's Profile">
              Find the user you want to message and tap the encrypted message icon.
            </Step>
            <Step num="2" title="Unlock Your Wallet">
              Enter your wallet password to decrypt your private key. This is required to read and send encrypted messages.
            </Step>
            <Step num="3" title="Type & Send">
              Compose your message. It's encrypted client-side using the recipient's public keys and broadcast as a SEC transaction. Only the recipient's private key can decrypt it.
            </Step>
            <H3>Important Notes</H3>
            <ul className="text-sm text-gray-400 space-y-2 mb-4 ml-4 list-disc list-outside">
              <li>Both sender and recipient must have minted profiles with published encryption keys</li>
              <li>Your wallet must be unlocked (password entered) to read or send encrypted messages</li>
              <li>Messages you send are encrypted for the recipient &mdash; your own outbound messages may show as "Sent (encrypted for recipient)" unless locally cached</li>
              <li>Decrypted messages are cached locally for instant loading on return visits</li>
              <li>The <strong>self-destruct timer</strong> feature lets you auto-delete local copies after a set period</li>
              <li>You can <strong>clear chat</strong> to remove both local caches and server-side history</li>
            </ul>
          </SectionBlock>

          {/* ===== MESSAGE REQUESTS ===== */}
          <SectionBlock id="message-requests">
            <H2><FiMessageCircle size={18} className="text-purple-400" /> Message Requests</H2>
            <P>
              When someone you don't follow sends you a direct message, it appears in the <strong>Message Requests</strong> section of your Tether panel &mdash; not in your main chat list. This keeps your main conversation list clean and prevents unsolicited messages from cluttering your inbox.
            </P>
            <H3>How It Works</H3>
            <P>
              Your Tether panel (Chats) has two zones: your <strong>followed contacts and rooms</strong> (which count toward the Chats badge) and the <strong>Message Requests</strong> section (which does not). Only messages from people you actively follow contribute to the notification badge on the bottom navigation bar.
            </P>
            <H3>Managing Requests</H3>
            <ul className="text-sm text-gray-400 space-y-2 mb-4 ml-4 list-disc list-outside">
              <li><strong>View:</strong> Open the message to read it, without adding the sender to your follows</li>
              <li><strong>Accept:</strong> Adds the sender to your follow list, promoting their messages to your main chat list</li>
              <li><strong>Ignore:</strong> Leave the request in the section without acting on it</li>
            </ul>
            <InfoBox>
              <strong>Notification Privacy:</strong> Message Requests are designed to protect your attention. Even if you have 50 unsolicited messages, your bottom nav badge will only show counts from followed contacts and tethered rooms.
            </InfoBox>
          </SectionBlock>

          {/* ===== DATA & IPFS CACHE ===== */}
          <SectionBlock id="data-storage">
            <H2><FiDatabase size={18} className="text-purple-400" /> Data &amp; IPFS Cache</H2>
            <P>
              Cthulhu stores cached data locally in your browser to improve performance. This includes decrypted message caches, conversation history, and IPFS media files you've viewed.
            </P>
            <ScreenRef label="Navigate to: Settings > Data and Storage" />
            <H3>What's Cached</H3>
            <ul className="text-sm text-gray-400 space-y-2 mb-4 ml-4 list-disc list-outside">
              <li><strong>Decrypt Cache:</strong> Previously decrypted DM messages, so they render instantly without re-decryption</li>
              <li><strong>Conversation Cache:</strong> Full DM conversation state for instant two-phase loading</li>
              <li><strong>IPFS Media:</strong> Images and media viewed from IPFS are cached locally</li>
              <li><strong>Sent Messages:</strong> Locally saved copies of your outbound messages</li>
              <li><strong>Key Pool:</strong> Your 50 pre-generated encrypted keypairs for object creation</li>
              <li><strong>Follows &amp; Settings:</strong> Your follow list, pinned friends, and notification state</li>
            </ul>
            <H3>Clearing Data</H3>
            <P>
              In <strong>Settings &rarr; Data and Storage</strong>, you can view your cache size and clear stored data. Clearing the cache won't delete any on-chain data &mdash; it only removes local copies.
            </P>
            <InfoBox>
              <strong>Persistence:</strong> Your follows, pinned friends, and tethered rooms are automatically backed up to the server. Even after clearing your browser cache, these will be restored when you log back in.
            </InfoBox>
            <H3>IPFS Architecture</H3>
            <P>
              Cthulhu runs a local IPFS (Kubo) node on the backend for all file uploads. When you upload an image for a profile, object, or post, it's pinned to this local node and made available to the IPFS network. Viewed IPFS content is cached in your browser &mdash; making you an effective "pinning node" for content you consume, improving availability for the network.
            </P>
          </SectionBlock>

          {/* ===== BURNING OBJECTS ===== */}
          <SectionBlock id="burning">
            <H2><FiTrash2 size={18} className="text-purple-400" /> Burning Objects</H2>
            <P>
              Burning permanently destroys an object. Unlike other blockchains that "burn" by sending to a dead wallet address, the SUP protocol uses a <strong>dedicated BRN (burn) transaction type</strong>. This is a first-class protocol operation, not a transfer.
            </P>
            <H3>How Burning Works</H3>
            <P>
              When you burn an object, Cthulhu constructs a <strong>BRN</strong> P2FK transaction that references the object's address. The P2FK indexer recognizes this transaction as a semantic destruction event &mdash; the object is permanently marked as burned on-chain. No coins are "sent" to a dead address; instead, the protocol records the burn action directly.
            </P>
            <Step num="1" title="Navigate to the Object">
              Go to the object's detail page (from the Storefront, your profile, or a direct link).
            </Step>
            <Step num="2" title="Open Burn Modal">
              Click the <strong>"Burn"</strong> button (trash icon). Only the current owner can burn their held units.
            </Step>
            <Step num="3" title="Confirm & Burn">
              Enter the quantity to burn (for multi-edition objects), check the confirmation box acknowledging the action is permanent, and click <strong>"Burn."</strong> The BRN transaction is signed in your browser and broadcast.
            </Step>
            <Warning>
              <strong>Burning is irreversible.</strong> Burned objects are permanently destroyed and cannot be recovered. There is no undo. The BRN transaction is recorded on the blockchain forever.
            </Warning>
          </SectionBlock>

          {/* ===== MAINNET WARNING ===== */}
          <SectionBlock id="mainnet">
            <H2><FiAlertTriangle size={18} className="text-amber-400" /> Mainnet Warning</H2>
            <div className="p-4 bg-red-900/10 border border-red-800/30 rounded-xl mb-4">
              <h3 className="text-sm font-bold text-red-400 mb-2">Proceed With Extreme Caution</h3>
              <P>
                Mainnet operations use <strong>real cryptocurrency with real monetary value</strong>. Every transaction costs real money and is permanent and irreversible.
              </P>
            </div>
            <P>
              <strong>We strongly recommend starting on testnet.</strong> Testnet coins are free (available from faucets) and have no monetary value. Use testnet to:
            </P>
            <ul className="text-sm text-gray-400 space-y-2 mb-4 ml-4 list-disc list-outside">
              <li>Learn how profile minting works</li>
              <li>Practice creating, buying, and trading objects</li>
              <li>Understand transaction fees and timing</li>
              <li>Test encrypted messaging</li>
              <li>Experiment with rooms and venues</li>
              <li>Try out video and audio calls</li>
              <li>Test the wallet system, Coin Control, and key backup</li>
            </ul>
            <Warning>
              Only switch to mainnet when you fully understand how the platform works. On mainnet, mistakes cannot be undone, lost coins cannot be recovered, and burned objects are gone forever.
            </Warning>
            <Warning>
              <strong>Never use more than you can afford to lose.</strong> Blockchain technology and cryptocurrency markets carry inherent risks. The Cthulhu platform is experimental software.
            </Warning>
          </SectionBlock>

          {/* ===== DISCLAIMERS ===== */}
          <SectionBlock id="disclaimers">
            <H2><FiShield size={18} className="text-purple-400" /> Disclaimers &amp; Legal</H2>
            <div className="space-y-4">
              <div className="p-4 bg-gray-900/80 border border-gray-700/50 rounded-xl">
                <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider mb-2">Key Management</h3>
                <P>
                  Cthulhu is a non-custodial platform. Your private keys are encrypted and stored locally in your browser. <strong>We do not have access to your private keys and cannot recover them if lost.</strong> You are solely responsible for backing up your wallet credentials (WIF key and password).
                </P>
              </div>

              <div className="p-4 bg-gray-900/80 border border-gray-700/50 rounded-xl">
                <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider mb-2">Transaction Irreversibility</h3>
                <P>
                  All blockchain transactions are permanent and irreversible. Once a transaction is broadcast and confirmed, it cannot be undone. This includes profile mints, object creation, purchases, transfers, burns, and call signaling. We cannot reverse, cancel, or modify any blockchain transaction.
                </P>
              </div>

              <div className="p-4 bg-gray-900/80 border border-gray-700/50 rounded-xl">
                <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider mb-2">Financial Risk</h3>
                <P>
                  Cryptocurrency values fluctuate. Objects and tokens may lose value. Transaction fees vary based on network conditions. We make no guarantees about the value, liquidity, or tradability of any digital object created or traded on this platform.
                </P>
              </div>

              <div className="p-4 bg-gray-900/80 border border-gray-700/50 rounded-xl">
                <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider mb-2">Software Disclaimer</h3>
                <P>
                  Cthulhu is provided "as is" without warranty of any kind. While we strive to ensure the platform functions correctly and securely, we cannot guarantee uninterrupted service, error-free operation, or protection against all potential vulnerabilities. Use at your own risk.
                </P>
              </div>

              <div className="p-4 bg-gray-900/80 border border-gray-700/50 rounded-xl">
                <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider mb-2">Best Efforts Recovery</h3>
                <P>
                  While we are not responsible for lost keys, coins, or objects, we will make our best efforts to assist users with account recovery where technically possible. Nothing guarantees successful recovery of lost credentials. <strong>Prevention through proper backup is always better than recovery.</strong>
                </P>
              </div>
            </div>
          </SectionBlock>

          {/* ===== RESOURCES ===== */}
          <SectionBlock id="resources">
            <H2><FiExternalLink size={18} className="text-purple-400" /> Resources &amp; Links</H2>
            <div className="grid gap-3">
              {[
                { title: 'SUP Video Tutorials', desc: 'Complete walkthrough playlist by embii4u', url: 'https://youtube.com/playlist?list=PLDNMoJ2rHmfoxt1AX417-lWt2zvWUnKUH' },
                { title: 'P2FK Explorer', desc: 'Browse on-chain P2FK data', url: 'https://p2fk.io' },
                { title: 'Apertus.io', desc: 'Embed files directly on the blockchain', url: 'https://apertus.io' },
                { title: 'BitFossil', desc: 'On-chain file explorer', url: 'https://bitfossil.com' },
                { title: 'Buy Testnet BTC', desc: 'Purchase tBTC instantly at buytestnet.com', url: 'https://buytestnet.com' },
                { title: 'Mempool Explorer (Testnet)', desc: 'Track Bitcoin testnet transactions', url: 'https://mempool.space/testnet' },
              ].map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 p-3 bg-gray-900/60 border border-gray-800/50 rounded-lg hover:border-purple-700/30 hover:bg-gray-800/50 transition-colors group"
                  data-testid={`wiki-link-${link.title.toLowerCase().replace(/\s+/g,'-')}`}
                >
                  <FiExternalLink size={14} className="text-gray-600 group-hover:text-purple-400 transition-colors flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-gray-300 group-hover:text-gray-100 transition-colors">{link.title}</p>
                    <p className="text-xs text-gray-600">{link.desc}</p>
                  </div>
                </a>
              ))}
            </div>
          </SectionBlock>

          {/* Footer */}
          <div className="border-t border-gray-800/50 pt-6 pb-12 text-center">
            <p className="text-xs text-gray-700">
              Cthulhu &mdash; Where Ancient Artifacts Meet the Blockchain
            </p>
            <p className="text-[10px] text-gray-800 mt-1">
              Built on SUP (Satoshi Universal Protocol) by embii4u
            </p>
            {!process.env.REACT_APP_STANDALONE && (
              <a href="https://app.emergent.sh/register?ref=nbob052323" target="_blank" rel="noopener noreferrer"
                className="text-[10px] text-gray-800 hover:text-gray-500 transition-colors mt-1 inline-block"
                data-testid="wiki-emergent-link"
              >
                Crafted with Emergent
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
