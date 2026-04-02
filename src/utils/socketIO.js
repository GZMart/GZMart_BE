let ioInstance = null;

export const setSocketIO = (io) => {
  ioInstance = io;
};

export const getSocketIO = () => {
  if (!ioInstance) {
    console.warn("Socket.io has not been initialized yet!");
  }
  return ioInstance;
};
