/**
 * UploadQueueContext — Global background upload queue.
 * Allows users to continue browsing while large files upload to IPFS.
 * Shows a persistent notification bar with progress for active uploads.
 */
import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

const UploadQueueContext = createContext(null);
const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export function UploadQueueProvider({ children }) {
  // Each upload: { id, filename, size, progress, status: 'uploading'|'done'|'error', cid, error, onComplete }
  const [uploads, setUploads] = useState([]);
  const idCounter = useRef(0);

  const addUpload = useCallback((file, onComplete) => {
    const id = ++idCounter.current;
    const entry = {
      id,
      filename: file.name,
      size: file.size,
      progress: 0,
      status: 'uploading',
      cid: null,
      error: null,
    };

    setUploads(prev => [...prev, entry]);

    // Start upload in background
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API}/ipfs/upload`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        setUploads(prev => prev.map(u => u.id === id ? { ...u, progress: pct } : u));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          if (data.cid) {
            setUploads(prev => prev.map(u => u.id === id ? { ...u, status: 'done', progress: 100, cid: data.cid, preview_cid: data.preview_cid || null } : u));
            if (onComplete) onComplete({ cid: data.cid, preview_cid: data.preview_cid || null, filename: file.name, ipfsRef: data.ipfs_ref });
          } else {
            setUploads(prev => prev.map(u => u.id === id ? { ...u, status: 'error', error: 'No CID returned' } : u));
          }
        } catch {
          setUploads(prev => prev.map(u => u.id === id ? { ...u, status: 'error', error: 'Invalid response' } : u));
        }
      } else {
        let detail = 'Upload failed';
        try { detail = JSON.parse(xhr.responseText).detail || detail; } catch {}
        setUploads(prev => prev.map(u => u.id === id ? { ...u, status: 'error', error: detail } : u));
      }
    };

    xhr.onerror = () => {
      setUploads(prev => prev.map(u => u.id === id ? { ...u, status: 'error', error: 'Network error' } : u));
    };

    xhr.timeout = 600000; // 10 min
    xhr.ontimeout = () => {
      setUploads(prev => prev.map(u => u.id === id ? { ...u, status: 'error', error: 'Upload timed out' } : u));
    };

    const formData = new FormData();
    formData.append('file', file, file.name);
    xhr.send(formData);

    return id;
  }, []);

  const dismissUpload = useCallback((id) => {
    setUploads(prev => prev.filter(u => u.id !== id));
  }, []);

  const clearCompleted = useCallback(() => {
    setUploads(prev => prev.filter(u => u.status === 'uploading'));
  }, []);

  return (
    <UploadQueueContext.Provider value={{ uploads, addUpload, dismissUpload, clearCompleted }}>
      {children}
    </UploadQueueContext.Provider>
  );
}

export function useUploadQueue() {
  return useContext(UploadQueueContext);
}
