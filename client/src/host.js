(function () {
  class Host {
    constructor(signalingSocket, options = {}) {
      this.socket = signalingSocket;
      this.getPassword = options.getPassword || (() => '');
      this.getSessionId = options.getSessionId || (() => '');
      this.setStatus = options.setStatus || (() => {});
      this.onConnected = options.onConnected || (() => {});
      this.onDisconnected = options.onDisconnected || (() => {});
      this.onData = options.onData || (() => {});
      this.peer = null;
      this.stream = null;
      this.remoteId = null;
    }

    async startScreenCapture() {
      const sources = await window.electronAPI.getScreenSources();
      if (!sources.length) throw new Error('No screen sources available.');
      const primarySource = sources.find((source) => source.primary) || sources[0];
      const captureConfig = await window.electronAPI.startCapture(primarySource.id);
      this.stream = await navigator.mediaDevices.getUserMedia(captureConfig.constraints);
      return this.stream;
    }

    async acceptConnection(remoteId, offer, password) {
      const expectedPassword = this.getPassword();
      if (expectedPassword && expectedPassword !== password) {
        this.socket.emit('reject', { targetId: remoteId, from: this.getSessionId(), reason: 'Invalid password.' });
        this.setStatus('Rejected connection: invalid password.', 'error');
        return false;
      }

      this.remoteId = remoteId;
      const stream = await this.startScreenCapture();
      this.peer = new window.SimplePeer({ initiator: false, trickle: true, stream });

      this.peer.on('signal', (data) => {
        if (data.type === 'answer' || data.sdp) {
          this.socket.emit('answer', { targetId: remoteId, answer: data, from: this.getSessionId() });
        } else {
          this.socket.emit('ice', { targetId: remoteId, candidate: data, from: this.getSessionId() });
        }
      });

      this.peer.on('connect', () => {
        this.setStatus(`Connected to ${remoteId}`, 'connected');
        window.electronAPI.notify('Secure System', `Connected with viewer ${remoteId}`);
        this.onConnected(remoteId);
      });

      this.peer.on('data', async (buffer) => {
        try {
          const payload = JSON.parse(buffer.toString());
          const handled = await this.onData(payload);
          if (!handled) this.handleInput(payload);
        } catch (error) {
          this.setStatus(`Data error: ${error.message}`, 'error');
        }
      });

      this.peer.on('close', () => this.stop());
      this.peer.on('error', (error) => {
        this.setStatus(`Host error: ${error.message}`, 'error');
        this.stop();
      });

      this.peer.signal(offer);
      return true;
    }

    handleSignal(signal) {
      if (this.peer) this.peer.signal(signal);
    }

    send(payload) {
      if (this.peer?.connected) this.peer.send(JSON.stringify(payload));
    }

    handleInput(payload) {
      if (payload.type === 'mousemove') {
        window.electronAPI.injectMouse({ type: 'move', x: payload.x, y: payload.y });
        return;
      }
      if (payload.type === 'mouseclick') {
        window.electronAPI.injectMouse({ type: 'click', x: payload.x, y: payload.y, button: payload.button || 'left', double: Boolean(payload.double) });
        return;
      }
      if (payload.type === 'mouse-toggle') {
        window.electronAPI.injectMouse({ type: 'toggle', x: payload.x, y: payload.y, button: payload.button || 'left', state: payload.state || 'down' });
        return;
      }
      if (payload.type === 'scroll') {
        window.electronAPI.injectMouse({ type: 'scroll', deltaX: payload.deltaX || 0, deltaY: payload.deltaY || 0 });
        return;
      }
      if (payload.type === 'keyboard-shortcut') {
        window.electronAPI.injectKeyboard({ type: 'keyTap', key: payload.key, modifiers: payload.modifiers || [] });
        return;
      }
      if (payload.type === 'keydown' || payload.type === 'keyup') {
        const key = this.mapKey(payload.key, payload.code);
        if (key) {
          window.electronAPI.injectKeyboard({ type: 'keyToggle', key, state: payload.type === 'keydown' ? 'down' : 'up', modifiers: [] });
        }
      }
    }

    mapKey(key, code) {
      const mapping = {
        Control: 'control', Alt: 'alt', Shift: 'shift', Meta: 'command', Enter: 'enter', Escape: 'escape', Backspace: 'backspace', Tab: 'tab',
        ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Delete: 'delete', ' ': 'space'
      };
      if (mapping[key]) return mapping[key];
      if (/^Key[A-Z]$/.test(code || '')) return code.slice(3).toLowerCase();
      if (/^Digit\d$/.test(code || '')) return code.slice(5);
      return key && key.length === 1 ? key.toLowerCase() : null;
    }

    stop(notify = true) {
      const peer = this.peer;
      this.peer = null;
      if (peer) peer.destroy();
      if (this.stream) {
        this.stream.getTracks().forEach((track) => track.stop());
        this.stream = null;
      }
      this.remoteId = null;
      if (notify) this.onDisconnected();
    }
  }

  window.SecureSystemHost = Host;
})();
