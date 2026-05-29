(function () {
  const SESSION_KEY = 'secure-system-session-id';
  const passwordInput = document.getElementById('host-password');
  const yourIdEl = document.getElementById('your-id');
  const statusEl = document.getElementById('status');
  const statusDotEl = document.getElementById('status-dot');
  const remoteIdInput = document.getElementById('remote-id');
  const remotePassInput = document.getElementById('remote-pass');
  const connectBtn = document.getElementById('connect-btn');
  const disconnectBtn = document.getElementById('disconnect-btn');
  const toolbarDisconnectBtn = document.getElementById('toolbar-disconnect');
  const toolbarFilesBtn = document.getElementById('toolbar-files');
  const toolbarFullscreenBtn = document.getElementById('toolbar-fullscreen');
  const toolbarCadBtn = document.getElementById('toolbar-cad');
  const copyIdBtn = document.getElementById('copy-id-btn');
  const pickFilesBtn = document.getElementById('pick-files-btn');
  const dropZone = document.getElementById('drop-zone');
  const transferList = document.getElementById('transfer-list');
  const welcomeScreen = document.getElementById('welcome-screen');
  const remoteScreen = document.getElementById('remote-screen');
  const remoteVideo = document.getElementById('remote-video');
  const titlebarButtons = document.querySelectorAll('.titlebar-controls button');
  const fileTransferSection = document.querySelector('.file-transfer-section');

  let sessionId = getOrCreateSessionId();
  let socket;
  let activeRole = null;
  let connected = false;
  let activeRemoteId = null;

  function rawSessionId(value) {
    return String(value || '').replace(/\D/g, '').slice(0, 9);
  }

  function formatSessionId(raw) {
    const digits = rawSessionId(raw);
    return digits.replace(/(\d{3})(?=\d)/g, '$1 ').trim();
  }

  function generateSessionId() {
    return Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join('');
  }

  function getOrCreateSessionId() {
    const saved = localStorage.getItem(SESSION_KEY);
    if (/^\d{9}$/.test(saved || '')) return saved;
    const created = generateSessionId();
    localStorage.setItem(SESSION_KEY, created);
    return created;
  }

  function setStatus(message, state = 'idle') {
    statusEl.textContent = message;
    statusDotEl.classList.remove('connected', 'error');
    if (state === 'connected') statusDotEl.classList.add('connected');
    if (state === 'error') statusDotEl.classList.add('error');
  }

  function showRemoteView(visible) {
    welcomeScreen.classList.toggle('active', !visible);
    remoteScreen.classList.toggle('active', visible);
  }

  function sendData(payload) {
    if (activeRole === 'host') host.send(payload);
    if (activeRole === 'viewer') viewer.send(payload);
  }

  const fileTransfer = new window.SecureSystemFileTransfer(
    (payload) => sendData(payload),
    transferList,
    (message) => setStatus(message, connected ? 'connected' : 'idle')
  );

  const host = new window.SecureSystemHost(null, {
    getPassword: () => passwordInput.value.trim(),
    getSessionId: () => sessionId,
    setStatus,
    onConnected: (remoteId) => {
      activeRole = 'host';
      connected = true;
      activeRemoteId = remoteId;
      showRemoteView(true);
      fileTransfer.setSender((payload) => sendData(payload));
    },
    onDisconnected: () => cleanupSession('Host session ended.'),
    onData: (payload) => fileTransfer.receiveData(payload)
  });

  const viewer = new window.SecureSystemViewer(null, {
    video: remoteVideo,
    setStatus,
    onConnected: (remoteId) => {
      activeRole = 'viewer';
      connected = true;
      activeRemoteId = remoteId;
      showRemoteView(true);
      fileTransfer.setSender((payload) => sendData(payload));
    },
    onDisconnected: () => cleanupSession('Viewer session ended.'),
    onData: (payload) => fileTransfer.receiveData(payload)
  });

  async function connectSignaling() {
    const signalingUrl = (await window.electronAPI.getSignalingUrl()) || 'http://localhost:3478';
    socket = window.io(signalingUrl, { transports: ['websocket', 'polling'] });
    host.socket = socket;
    viewer.socket = socket;

    socket.on('connect', () => {
      socket.emit('register', { sessionId });
      setStatus(`Connected to signaling server ${signalingUrl}`);
    });

    socket.on('registered', ({ sessionId: registeredId }) => {
      if (registeredId) {
        sessionId = registeredId;
        localStorage.setItem(SESSION_KEY, registeredId);
        yourIdEl.textContent = formatSessionId(registeredId);
      }
      setStatus('Ready');
    });

    socket.on('offer', async ({ from, offer, password }) => {
      try {
        activeRole = 'host';
        activeRemoteId = from;
        setStatus(`Incoming connection from ${formatSessionId(from)}`);
        const accepted = await host.acceptConnection(from, offer, password || '');
        if (!accepted) {
          activeRole = null;
          activeRemoteId = null;
        }
      } catch (error) {
        setStatus(`Connection failed: ${error.message}`, 'error');
        socket.emit('reject', { targetId: from, from: sessionId, reason: error.message });
        cleanupSession('Incoming connection failed.', true);
      }
    });

    socket.on('answer', ({ answer, from }) => {
      activeRole = 'viewer';
      activeRemoteId = from || activeRemoteId;
      viewer.handleSignal(answer);
    });

    socket.on('ice', ({ candidate, from }) => {
      if (from && activeRemoteId && from !== activeRemoteId) return;
      if (activeRole === 'host') host.handleSignal(candidate);
      if (activeRole === 'viewer') viewer.handleSignal(candidate);
    });

    socket.on('rejected', ({ reason }) => {
      setStatus(reason || 'Connection rejected.', 'error');
      cleanupSession('Connection rejected.', true);
    });

    socket.on('error', ({ message }) => setStatus(message || 'Signaling error.', 'error'));
    socket.on('disconnect', () => setStatus('Disconnected from signaling server.', 'error'));
    window.setInterval(() => { if (socket?.connected) socket.emit('heartbeat'); }, 20000);
  }

  async function startViewerConnection() {
    const remoteId = rawSessionId(remoteIdInput.value);
    if (!/^\d{9}$/.test(remoteId)) {
      setStatus('Enter a valid 9-digit remote ID.', 'error');
      return;
    }
    if (!socket?.connected) {
      setStatus('Signaling server is offline.', 'error');
      return;
    }

    activeRole = 'viewer';
    connected = false;
    activeRemoteId = remoteId;
    showRemoteView(true);
    setStatus(`Connecting to ${formatSessionId(remoteId)}...`);

    try {
      await viewer.connect(remoteId, remotePassInput.value.trim(), sessionId);
    } catch (error) {
      cleanupSession(error.message, true);
    }
  }

  function cleanupSession(message = 'Disconnected.', preserveError = false) {
    connected = false;
    activeRemoteId = null;
    const role = activeRole;
    activeRole = null;
    if (role === 'host') host.stop(false);
    if (role === 'viewer') viewer.disconnect(false);
    showRemoteView(false);
    setStatus(message, preserveError ? 'error' : 'idle');
  }

  async function handleFilePick() {
    try {
      const files = await window.electronAPI.openFileDialog();
      for (const file of files) {
        await fileTransfer.sendFile(file);
      }
    } catch (error) {
      setStatus(`File transfer error: ${error.message}`, 'error');
    }
  }

  yourIdEl.textContent = formatSessionId(sessionId);
  connectSignaling();

  copyIdBtn.addEventListener('click', async () => {
    await navigator.clipboard.writeText(formatSessionId(sessionId));
    setStatus('Session ID copied to clipboard.');
  });

  connectBtn.addEventListener('click', startViewerConnection);
  disconnectBtn.addEventListener('click', () => cleanupSession());
  toolbarDisconnectBtn.addEventListener('click', () => cleanupSession());
  toolbarFilesBtn.addEventListener('click', () => fileTransferSection.scrollIntoView({ behavior: 'smooth' }));
  toolbarFullscreenBtn.addEventListener('click', async () => {
    if (!document.fullscreenElement) await remoteVideo.requestFullscreen?.();
    else await document.exitFullscreen?.();
  });
  toolbarCadBtn.addEventListener('click', () => sendData({ type: 'keyboard-shortcut', key: 'delete', modifiers: ['control', 'alt'] }));
  pickFilesBtn.addEventListener('click', handleFilePick);

  ['dragenter', 'dragover'].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove('drag-over');
    });
  });

  dropZone.addEventListener('drop', async (event) => {
    const files = Array.from(event.dataTransfer.files || []).map((file) => ({ name: file.name, size: file.size, path: file.path }));
    for (const file of files) await fileTransfer.sendFile(file);
  });

  remoteIdInput.addEventListener('input', (event) => {
    const digits = rawSessionId(event.target.value);
    event.target.value = formatSessionId(digits);
  });

  remoteIdInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') startViewerConnection();
  });

  titlebarButtons.forEach((button) => {
    button.addEventListener('click', () => window.electronAPI.windowControl(button.dataset.action));
  });

  window.electronAPI.onTrayAction((action) => {
    if (action === 'disconnect') cleanupSession('Disconnected from tray.');
  });
})();
