/**
 * MeshVisualizer — Canvas-based real-time visualization of the P2P mesh network.
 * Shows nodes as circles, connections as animated lines, data flow pulses.
 */
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { FiMaximize2, FiMinimize2, FiRefreshCw } from 'react-icons/fi';

const API = process.env.REACT_APP_BACKEND_URL;

// Color palette
const C = {
  bg: '#0a0e17',
  grid: 'rgba(34,197,94,0.04)',
  nodeOnline: '#22c55e',
  nodeOffline: '#4b5563',
  nodeSelf: '#f59e0b',
  edge: 'rgba(34,197,94,0.15)',
  edgeActive: 'rgba(34,197,94,0.5)',
  pulse: '#22c55e',
  text: '#9ca3af',
  textBright: '#e5e7eb',
  glow: 'rgba(34,197,94,0.3)',
};

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

/** Assign stable positions to nodes using address hash + force-directed nudge */
function layoutNodes(nodes, w, h, selfAddr) {
  const cx = w / 2, cy = h / 2;
  const radius = Math.min(w, h) * 0.36;
  return nodes.map((n, i) => {
    const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2 + hashCode(n.address) * 0.001;
    const isSelf = n.address === selfAddr;
    const r = isSelf ? 0 : radius * (0.6 + 0.4 * Math.abs(Math.sin(hashCode(n.address))));
    return {
      ...n,
      x: isSelf ? cx : cx + Math.cos(angle) * r,
      y: isSelf ? cy : cy + Math.sin(angle) * r,
      isSelf,
      nodeRadius: Math.max(6, Math.min(18, 6 + (n.capacity_remaining || 0) * 2)),
      score: n.composite_score || 0,
    };
  });
}

export default function MeshVisualizer({ myAddress, network, expanded, onToggleExpand }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const [nodes, setNodes] = useState([]);
  const [pulses, setPulses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hovered, setHovered] = useState(null);
  const layoutRef = useRef([]);

  const fetchNodes = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API}/api/mesh/node-quality?network=${network}`);
      if (!res.ok) return;
      const { nodes: raw } = await res.json();
      setNodes(raw);
    } catch {} finally { setLoading(false); }
  }, [network]);

  useEffect(() => { fetchNodes(); const t = setInterval(fetchNodes, 15000); return () => clearInterval(t); }, [fetchNodes]);

  // Layout when nodes or canvas size change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    layoutRef.current = layoutNodes(nodes, canvas.width, canvas.height, myAddress);
  }, [nodes, myAddress]);

  // Randomly spawn data-flow pulses
  useEffect(() => {
    const spawn = () => {
      const laid = layoutRef.current;
      if (laid.length < 2) return;
      const online = laid.filter(n => n.online);
      if (online.length < 2) return;
      const a = online[Math.floor(Math.random() * online.length)];
      let b = a;
      while (b === a) b = online[Math.floor(Math.random() * online.length)];
      setPulses(prev => [...prev.slice(-12), { id: Date.now(), x1: a.x, y1: a.y, x2: b.x, y2: b.y, t: 0 }]);
    };
    const t = setInterval(spawn, 1200);
    return () => clearInterval(t);
  }, []);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let running = true;

    const draw = () => {
      if (!running) return;
      const w = canvas.width, h = canvas.height;
      const laid = layoutRef.current;

      // Background
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, w, h);

      // Grid
      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 0.5;
      for (let x = 0; x < w; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 0; y < h; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

      // Edges (connect online nodes to nearest neighbors)
      const online = laid.filter(n => n.online);
      ctx.strokeStyle = C.edge;
      ctx.lineWidth = 1;
      online.forEach((a, i) => {
        online.forEach((b, j) => {
          if (j <= i) return;
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (dist < 250) {
            ctx.globalAlpha = Math.max(0.08, 1 - dist / 250);
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        });
      });
      ctx.globalAlpha = 1;

      // Data flow pulses
      setPulses(prev => {
        const next = [];
        for (const p of prev) {
          p.t += 0.02;
          if (p.t > 1) continue;
          next.push(p);
          const px = p.x1 + (p.x2 - p.x1) * p.t;
          const py = p.y1 + (p.y2 - p.y1) * p.t;
          const alpha = Math.sin(p.t * Math.PI);
          ctx.beginPath();
          ctx.arc(px, py, 3, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(34,197,94,${alpha * 0.9})`;
          ctx.fill();
          // Glow
          ctx.beginPath();
          ctx.arc(px, py, 8, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(34,197,94,${alpha * 0.2})`;
          ctx.fill();
        }
        return next;
      });

      // Nodes
      laid.forEach(n => {
        const isHov = hovered === n.address;
        // Glow ring for online
        if (n.online) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.nodeRadius + 6, 0, Math.PI * 2);
          ctx.fillStyle = n.isSelf ? 'rgba(245,158,11,0.1)' : C.glow.replace('0.3', '0.08');
          ctx.fill();
        }
        // Node circle
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.nodeRadius + (isHov ? 2 : 0), 0, Math.PI * 2);
        ctx.fillStyle = n.isSelf ? C.nodeSelf : n.online ? C.nodeOnline : C.nodeOffline;
        ctx.globalAlpha = n.online ? 1 : 0.4;
        ctx.fill();
        ctx.globalAlpha = 1;
        // URN label
        const label = n.urn || n.address?.slice(0, 8);
        ctx.fillStyle = isHov ? C.textBright : C.text;
        ctx.font = isHov ? 'bold 11px monospace' : '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(label, n.x, n.y + n.nodeRadius + 14);
        // Score badge (on hover)
        if (isHov) {
          ctx.fillStyle = 'rgba(0,0,0,0.8)';
          const tw = ctx.measureText(`Score: ${n.score.toFixed(0)}`).width + 12;
          ctx.fillRect(n.x - tw / 2, n.y - n.nodeRadius - 26, tw, 18);
          ctx.fillStyle = C.nodeOnline;
          ctx.font = '10px monospace';
          ctx.fillText(`Score: ${n.score.toFixed(0)}`, n.x, n.y - n.nodeRadius - 13);
        }
      });

      // Legend
      ctx.font = '10px monospace';
      ctx.textAlign = 'left';
      const ly = h - 12;
      [
        { color: C.nodeSelf, label: 'You' },
        { color: C.nodeOnline, label: 'Online' },
        { color: C.nodeOffline, label: 'Offline' },
      ].forEach((item, i) => {
        const lx = 10 + i * 80;
        ctx.beginPath(); ctx.arc(lx, ly - 3, 4, 0, Math.PI * 2);
        ctx.fillStyle = item.color; ctx.fill();
        ctx.fillStyle = C.text;
        ctx.fillText(item.label, lx + 8, ly);
      });

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => { running = false; cancelAnimationFrame(animRef.current); };
  }, [hovered]);

  // Handle hover detection
  const handleMouseMove = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);
    const laid = layoutRef.current;
    let found = null;
    for (const n of laid) {
      if (Math.hypot(n.x - mx, n.y - my) < n.nodeRadius + 6) { found = n.address; break; }
    }
    setHovered(found);
  }, []);

  // Resize canvas to container
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const parent = canvas.parentElement;
      canvas.width = parent.clientWidth;
      canvas.height = expanded ? Math.min(window.innerHeight - 120, 600) : 260;
      layoutRef.current = layoutNodes(nodes, canvas.width, canvas.height, myAddress);
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [nodes, myAddress, expanded]);

  const onlineCount = nodes.filter(n => n.online).length;

  return (
    <div className="bg-gray-800/40 rounded-xl overflow-hidden" data-testid="mesh-visualizer">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700/30">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${onlineCount > 0 ? 'bg-emerald-400 animate-pulse' : 'bg-gray-600'}`} />
          <span className="text-xs font-medium text-gray-300">
            {loading ? 'Scanning...' : `${onlineCount} node${onlineCount !== 1 ? 's' : ''} online`}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={fetchNodes} className="p-1.5 rounded hover:bg-gray-700/50 text-gray-500 hover:text-gray-300 transition-colors" data-testid="mesh-viz-refresh">
            <FiRefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
          {onToggleExpand && (
            <button onClick={onToggleExpand} className="p-1.5 rounded hover:bg-gray-700/50 text-gray-500 hover:text-gray-300 transition-colors" data-testid="mesh-viz-expand">
              {expanded ? <FiMinimize2 size={12} /> : <FiMaximize2 size={12} />}
            </button>
          )}
        </div>
      </div>
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHovered(null)}
        className="w-full cursor-crosshair"
        style={{ display: 'block' }}
      />
    </div>
  );
}
