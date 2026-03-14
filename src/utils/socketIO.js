let ioInstance = null;

export function setSocketIO(io) {
  ioInstance = io;
}

export function getSocketIO() {
  if (!ioInstance) {
    console.warn('Socket.IO instance not initialized yet');
  }
  return ioInstance;
}