// Startup-wedge fixture for the napi-vm runtime: `onLoad` burns CPU for a
// bounded window so the host's startup handshake deadline is what fails the
// start instead of the manager freezing. The bound keeps the leaked thread
// short-lived: once the window passes, the host already timed out the
// handshake, the ready send fails, and the owner thread exits on its own.
const LOAD_BLOCK_MS = 1500;
const plugin = {
    onLoad() {
        const deadline = Date.now() + LOAD_BLOCK_MS;
        while (Date.now() < deadline) {
            // Busy-wait: napi-vm drives onLoad synchronously, so a pending
            // promise would settle instead of blocking.
        }
    },
    async call() {
        return { summary: "hang", logs: [], intents: [], events: [] };
    },
    onUnload() {
        return { unloaded: true };
    },
};
export default plugin;
