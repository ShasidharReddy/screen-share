(function () {
  const CHUNK_SIZE = 256 * 1024;

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let index = 0;
    let value = Number(bytes);
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index += 1;
    }
    return `${value.toFixed(index ? 1 : 0)} ${units[index]}`;
  }

  function uid() {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  function bufToB64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const step = 0x8000;
    for (let index = 0; index < bytes.length; index += step) {
      binary += String.fromCharCode(...bytes.subarray(index, index + step));
    }
    return btoa(binary);
  }

  function b64ToBuf(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function baseName(name) {
    const parts = String(name || '').split('/').filter(Boolean);
    return parts[parts.length - 1] || String(name || 'file');
  }

  class FileTransfer {
    constructor(sendPayload, container, setStatus) {
      this.send = sendPayload;
      this.container = container;
      this.setStatus = setStatus;
      this.incoming = new Map();
    }

    setSender(fn) {
      this.send = fn;
    }

    createItem(id, name, size, direction) {
      let element = this.container.querySelector(`[data-tid="${id}"]`);
      if (element) return element;

      const shortName = name.length > 38 ? `...${name.slice(-35)}` : name;
      element = document.createElement('div');
      element.className = 'transfer-item';
      element.dataset.tid = id;
      element.innerHTML = `
        <div class="ti-header">
          <span class="ti-name" title="${escapeHtml(name)}">${escapeHtml(shortName)}</span>
          <span class="ti-badge ${direction}">${direction === 'send' ? '↑' : '↓'}</span>
        </div>
        <div class="ti-size">${formatBytes(size)}</div>
        <div class="ti-bar"><div class="ti-fill ${direction}"></div></div>
        <div class="ti-footer">
          <span class="ti-pct">0%</span>
          <span class="ti-status">Queued</span>
        </div>
      `;
      this.container.prepend(element);
      return element;
    }

    updateItem(id, percent, status) {
      const element = this.container.querySelector(`[data-tid="${id}"]`);
      if (!element) return;
      element.querySelector('.ti-fill').style.width = `${Math.max(0, Math.min(percent, 100))}%`;
      element.querySelector('.ti-pct').textContent = `${Math.floor(percent)}%`;
      element.querySelector('.ti-status').textContent = status;
    }

    async sendFile(fileDescriptor) {
      if (!this.send) throw new Error('No active session.');
      const id = uid();
      const filePath = fileDescriptor.path;
      if (!filePath) throw new Error('File path is unavailable.');

      let { name, size } = fileDescriptor;
      if (!name || typeof size !== 'number') {
        const info = await window.electronAPI.getFileInfo(filePath);
        name = name || info.name;
        size = typeof size === 'number' ? size : info.size;
      }

      this.createItem(id, name, size, 'send');
      this.updateItem(id, 0, 'Reading...');

      try {
        const totalChunks = Math.max(1, Math.ceil(size / CHUNK_SIZE));
        this.send({ type: 'file-meta', id, name, size, totalChunks });

        let offset = 0;
        let chunkIndex = 0;
        while (offset < size) {
          const length = Math.min(CHUNK_SIZE, size - offset);
          const chunk = await window.electronAPI.readFileChunk(filePath, offset, length);
          this.send({
            type: 'file-chunk',
            id,
            index: chunkIndex,
            total: totalChunks,
            offset,
            data: bufToB64(chunk)
          });
          offset += length;
          chunkIndex += 1;
          this.updateItem(id, (offset / Math.max(size, 1)) * 100, `${formatBytes(offset)} / ${formatBytes(size)}`);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }

        this.send({ type: 'file-complete', id });
        this.updateItem(id, 100, 'Sent ✓');
        this.setStatus(`Sent: ${baseName(name)}`);
      } catch (error) {
        this.updateItem(id, 0, `Error: ${error.message}`);
        this.setStatus(`Transfer failed: ${error.message}`, 'error');
        throw error;
      }
    }

    async sendFolder(dirPath) {
      const folderName = String(dirPath || '').split(/[\\/]/).filter(Boolean).pop() || 'Folder';
      const files = await window.electronAPI.readDirRecursive(dirPath);
      if (!files.length) {
        this.setStatus('Selected folder is empty.', 'error');
        return;
      }

      this.setStatus(`Sending folder: ${folderName} (${files.length} file${files.length === 1 ? '' : 's'})`);
      const queue = files.map((file) => ({
        ...file,
        name: `${folderName}/${file.name}`
      }));

      const runNext = async () => {
        const next = queue.shift();
        if (!next) return;
        await this.sendFile(next);
        await runNext();
      };

      await Promise.all([runNext(), runNext(), runNext()]);
    }

    async receiveData(payload) {
      if (payload.type === 'file-meta') {
        this.incoming.set(payload.id, {
          id: payload.id,
          name: payload.name,
          size: payload.size,
          totalChunks: payload.totalChunks,
          receivedBytes: 0,
          receivedChunks: 0,
          lastWrite: window.electronAPI.prepareSaveFile(payload.name)
        });
        this.createItem(payload.id, payload.name, payload.size, 'recv');
        this.updateItem(payload.id, 0, 'Receiving...');
        return true;
      }

      if (payload.type === 'file-chunk') {
        const transfer = this.incoming.get(payload.id);
        if (!transfer) return true;

        const bytes = b64ToBuf(payload.data);
        transfer.receivedBytes += bytes.byteLength;
        transfer.receivedChunks += 1;
        transfer.lastWrite = transfer.lastWrite.then(() => window.electronAPI.writeFileChunk(transfer.name, bytes.buffer, payload.offset));

        try {
          await transfer.lastWrite;
          const percent = transfer.size ? (transfer.receivedBytes / transfer.size) * 100 : 100;
          this.updateItem(
            payload.id,
            Math.min(percent, 99),
            `${formatBytes(transfer.receivedBytes)} / ${formatBytes(transfer.size)}`
          );
        } catch (error) {
          this.updateItem(payload.id, 0, `Error: ${error.message}`);
          this.setStatus(`Receive failed: ${error.message}`, 'error');
          throw error;
        }

        return true;
      }

      if (payload.type === 'file-complete') {
        const transfer = this.incoming.get(payload.id);
        if (!transfer) return true;

        try {
          this.updateItem(transfer.id, 99, 'Finalizing...');
          await transfer.lastWrite;
          await window.electronAPI.completeSaveFile(transfer.name);
          this.updateItem(transfer.id, 100, 'Saved ✓');
          this.setStatus(`Received: ${baseName(transfer.name)}`);
          this.incoming.delete(payload.id);
          return true;
        } catch (error) {
          this.updateItem(payload.id, 0, `Error: ${error.message}`);
          this.setStatus(`Receive failed: ${error.message}`, 'error');
          throw error;
        }
      }

      return false;
    }
  }

  window.SecureSystemFileTransfer = FileTransfer;
})();
