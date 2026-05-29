(function () {
  class Viewer {
    constructor(signalingSocket, options = {}) {
      this.socket = signalingSocket;
      this.video = options.video;
      this.setStatus = options.setStatus || (() => {});
      this.onConnected = options.onConnected || (() => {});
      this.onDisconnected = options.onDisconnected || (() => {});
      this.onData = options.onData || (() => {});
      this.peer = null;
      this.remoteId = null;
      this.boundHandlers = [];
    }

    async connect(remoteId, password, localSessionId) {
      this.remoteId = remoteId;
      this.peer = new window.SimplePeer({ initiator: true, trickle: true });

      this.peer.on('signal', (data) => {
        if (data.type === 'offer' || data.sdp) {
          this.socket.emit('offer', { targetId: remoteId, offer: data, from: localSessionId, password: password || '' });
        } else {
          this.socket.emit('ice', { targetId: remoteId, candidate: data, from: localSessionId });
        }
      });

      this.peer.on('stream', (stream) => {
        if (this.video) {
          this.video.srcObject = stream;
          this.video.play().catch(() => {});
          this.video.focus();
          this.captureInput();
        }
        this.setStatus(`Connected to ${remoteId}`, 'connected');
        this.onConnected(remoteId);
      });

      this.peer.on('connect', () => {
        this.setStatus(`Secure channel ready for ${remoteId}`, 'connected');
      });

      this.peer.on('data', async (buffer) => {
        try {
          const payload = JSON.parse(buffer.toString());
          await this.onData(payload);
        } catch (error) {
          this.setStatus(`Viewer data error: ${error.message}`, 'error');
        }
      });

      this.peer.on('close', () => this.disconnect());
      this.peer.on('error', (error) => {
        this.setStatus(`Viewer error: ${error.message}`, 'error');
        this.disconnect();
      });
    }

    handleSignal(signal) {
      if (this.peer) this.peer.signal(signal);
    }

    send(payload) {
      if (this.peer?.connected) this.peer.send(JSON.stringify(payload));
    }

    captureInput() {
      if (!this.video || this.boundHandlers.length) return;
      this.video.tabIndex = 0;

      const toRelative = (event) => {
        const rect = this.video.getBoundingClientRect();
        return {
          x: Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1),
          y: Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1)
        };
      };

      const addHandler = (element, eventName, handler) => {
        element.addEventListener(eventName, handler);
        this.boundHandlers.push(() => element.removeEventListener(eventName, handler));
      };

      addHandler(this.video, 'click', () => this.video.focus());
      addHandler(this.video, 'contextmenu', (event) => event.preventDefault());
      addHandler(this.video, 'mousemove', (event) => this.send({ type: 'mousemove', ...toRelative(event) }));
      addHandler(this.video, 'mousedown', (event) => {
        event.preventDefault();
        this.video.focus();
        this.send({ type: 'mouse-toggle', ...toRelative(event), button: this.buttonFromEvent(event), state: 'down' });
      });
      addHandler(this.video, 'mouseup', (event) => {
        event.preventDefault();
        const pos = toRelative(event);
        const button = this.buttonFromEvent(event);
        this.send({ type: 'mouse-toggle', ...pos, button, state: 'up' });
      });
      addHandler(this.video, 'dblclick', (event) => {
        event.preventDefault();
        this.send({ type: 'mouseclick', ...toRelative(event), button: this.buttonFromEvent(event), double: true });
      });
      addHandler(this.video, 'wheel', (event) => {
        event.preventDefault();
        this.send({ type: 'scroll', deltaX: Math.round(event.deltaX), deltaY: Math.round(event.deltaY) });
      });
      addHandler(window, 'keydown', (event) => {
        if (document.activeElement !== this.video) return;
        event.preventDefault();
        this.send({ type: 'keydown', key: event.key, code: event.code });
      });
      addHandler(window, 'keyup', (event) => {
        if (document.activeElement !== this.video) return;
        event.preventDefault();
        this.send({ type: 'keyup', key: event.key, code: event.code });
      });
    }

    buttonFromEvent(event) {
      if (event.button === 1) return 'middle';
      if (event.button === 2) return 'right';
      return 'left';
    }

    disconnect(notify = true) {
      this.boundHandlers.forEach((unbind) => unbind());
      this.boundHandlers = [];
      if (this.video?.srcObject) {
        this.video.srcObject.getTracks().forEach((track) => track.stop?.());
        this.video.srcObject = null;
      }
      const peer = this.peer;
      this.peer = null;
      if (peer) peer.destroy();
      this.remoteId = null;
      if (notify) this.onDisconnected();
    }
  }

  window.SecureSystemViewer = Viewer;
})();
