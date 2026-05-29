(function () {
  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index += 1;
    }
    return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  }

  function createId() {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function bytesToBase64(uint8Array) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < uint8Array.length; index += chunkSize) {
      const chunk = uint8Array.subarray(index, index + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }

  function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  class FileTransfer {
    constructor(sendPayload, container, setStatus) {
      this.sendPayload = sendPayload;
      this.container = container;
      this.setStatus = setStatus;
      this.CHUNK_SIZE = 64 * 1024;
      this.incoming = new Map();
    }

    setSender(sendPayload) {
      this.sendPayload = sendPayload;
    }

    createTransferItem(id, name, size, direction) {
      let entry = this.container.querySelector(`[data-transfer-id="${id}"]`);
      if (entry) return entry;

      entry = document.createElement('div');
      entry.className = 'transfer-item';
      entry.dataset.transferId = id;
      entry.innerHTML = `
        <div class="transfer-meta">
          <strong>${name}</strong>
          <span>${direction} • ${formatBytes(size)}</span>
        </div>
        <div class="progress-bar"><div class="progress-fill"></div></div>
        <div class="transfer-meta"><span class="transfer-status">Queued</span><span class="transfer-progress">0%</span></div>
      `;
      this.container.prepend(entry);
      return entry;
    }

    updateTransfer(id, percent, status) {
      const entry = this.container.querySelector(`[data-transfer-id="${id}"]`);
      if (!entry) return;
      entry.querySelector('.progress-fill').style.width = `${Math.max(0, Math.min(percent, 100))}%`;
      entry.querySelector('.transfer-progress').textContent = `${Math.floor(percent)}%`;
      entry.querySelector('.transfer-status').textContent = status;
    }

    async sendFile(fileDescriptor) {
      if (!this.sendPayload) throw new Error('No active session for file transfer.');

      const transferId = createId();
      const buffer = await window.electronAPI.readFile(fileDescriptor.path);
      const totalChunks = Math.ceil(buffer.byteLength / this.CHUNK_SIZE) || 1;
      this.createTransferItem(transferId, fileDescriptor.name, fileDescriptor.size, 'Sending');
      this.updateTransfer(transferId, 0, 'Preparing');

      this.sendPayload({
        type: 'file-meta',
        id: transferId,
        name: fileDescriptor.name,
        size: buffer.byteLength,
        totalChunks
      });

      let offset = 0;
      let index = 0;
      while (offset < buffer.byteLength) {
        const chunk = buffer.slice(offset, offset + this.CHUNK_SIZE);
        this.sendPayload({
          type: 'file-chunk',
          id: transferId,
          index,
          total: totalChunks,
          data: bytesToBase64(new Uint8Array(chunk))
        });
        offset += this.CHUNK_SIZE;
        index += 1;
        this.updateTransfer(transferId, (index / totalChunks) * 100, 'Sending');
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      this.sendPayload({ type: 'file-complete', id: transferId });
      this.updateTransfer(transferId, 100, 'Sent');
      this.setStatus(`Sent ${fileDescriptor.name}`);
    }

    async receiveData(payload) {
      if (payload.type === 'file-meta') {
        this.incoming.set(payload.id, {
          id: payload.id,
          name: payload.name,
          size: payload.size,
          totalChunks: payload.totalChunks,
          chunks: new Array(payload.totalChunks),
          received: 0
        });
        this.createTransferItem(payload.id, payload.name, payload.size, 'Receiving');
        this.updateTransfer(payload.id, 0, 'Receiving');
        return true;
      }

      if (payload.type === 'file-chunk') {
        const transfer = this.incoming.get(payload.id);
        if (!transfer) return true;
        transfer.chunks[payload.index] = base64ToBytes(payload.data);
        transfer.received += 1;
        this.updateTransfer(payload.id, (transfer.received / transfer.totalChunks) * 100, 'Receiving');
        return true;
      }

      if (payload.type === 'file-complete') {
        const transfer = this.incoming.get(payload.id);
        if (!transfer) return true;

        const merged = new Uint8Array(transfer.size);
        let offset = 0;
        for (const chunk of transfer.chunks) {
          if (!chunk) continue;
          merged.set(chunk, offset);
          offset += chunk.byteLength;
        }

        const savedPath = await window.electronAPI.saveFile(transfer.name, merged.buffer);
        this.updateTransfer(payload.id, 100, `Saved to ${savedPath}`);
        this.setStatus(`Received ${transfer.name}`);
        this.incoming.delete(payload.id);
        return true;
      }

      return false;
    }
  }

  window.SecureSystemFileTransfer = FileTransfer;
})();
