/**
 * WebSocket Client for Her Voice UI
 * Handles bidirectional audio streaming with the backend
 */

export class VoiceConnection {
    constructor(options = {}) {
        this.url = options.url || 'ws://localhost:8765';
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = options.maxReconnectAttempts || 5;
        this.reconnectDelay = options.reconnectDelay || 1000;
        this.autoReconnect = options.autoReconnect !== false;

        // Callbacks
        this.onConnected = options.onConnected || (() => {});
        this.onDisconnected = options.onDisconnected || (() => {});
        this.onAudio = options.onAudio || (() => {});
        this.onTranscript = options.onTranscript || (() => {});
        this.onError = options.onError || (() => {});
        this.onAssistantSpeaking = options.onAssistantSpeaking || (() => {});
        this.onAssistantSilent = options.onAssistantSilent || (() => {});
        this.onThinking = options.onThinking || (() => {});
        this.onServerLog = options.onServerLog || null;
    }

    connect(url = null) {
        if (url) this.url = url;

        return new Promise((resolve, reject) => {
            try {
                console.log(`🔌 Connecting to ${this.url}...`);
                this.ws = new WebSocket(this.url);
                this.ws.binaryType = 'arraybuffer';

                this.ws.onopen = () => {
                    console.log('✅ WebSocket connected');
                    this.reconnectAttempts = 0;
                    this.onConnected();
                    resolve();
                };

                this.ws.onclose = (event) => {
                    console.log('🔌 WebSocket disconnected', event.code, event.reason);
                    this.onDisconnected();

                    if (this.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
                        this.scheduleReconnect();
                    }
                };

                this.ws.onerror = (error) => {
                    console.error('❌ WebSocket error:', error);
                    this.onError(error);
                    reject(error);
                };

                this.ws.onmessage = (event) => {
                    this.handleMessage(event);
                };

            } catch (error) {
                console.error('❌ Failed to create WebSocket:', error);
                reject(error);
            }
        });
    }

    handleMessage(event) {
        // Binary data = audio from assistant
        if (event.data instanceof ArrayBuffer) {
            this.onAudio(event.data);
            return;
        }

        // Text data = JSON control messages
        try {
            const message = JSON.parse(event.data);

            switch (message.type) {
                case 'audio':
                    if (message.data) {
                        const binaryString = atob(message.data);
                        const bytes = new Uint8Array(binaryString.length);
                        for (let i = 0; i < binaryString.length; i++) {
                            bytes[i] = binaryString.charCodeAt(i);
                        }
                        this.onAudio(bytes.buffer);
                    }
                    break;

                case 'transcript':
                    this.onTranscript(message);
                    break;

                case 'assistant_speaking':
                    this.onAssistantSpeaking();
                    break;

                case 'assistant_silent':
                    this.onAssistantSilent();
                    break;

                case 'thinking':
                    this.onThinking(message.thinking);
                    break;

                case 'error':
                    console.error('Server error:', message.message);
                    this.onError(new Error(message.message));
                    break;

                case 'server_log':
                    if (this.onServerLog) {
                        this.onServerLog(message.message, message.level);
                    }
                    break;

                default:
                    console.log('Unknown message type:', message.type, message);
            }
        } catch (e) {
            console.log('Received text:', event.data);
        }
    }

    sendAudio(audioData) {
        if (!this.isConnected()) {
            console.warn('Cannot send audio: not connected');
            return;
        }

        let buffer;
        if (audioData instanceof ArrayBuffer) {
            buffer = audioData;
        } else if (audioData.buffer) {
            buffer = audioData.buffer;
        } else {
            console.error('Invalid audio data format');
            return;
        }

        this.ws.send(buffer);
    }

    sendMessage(message) {
        if (!this.isConnected()) {
            console.warn('Cannot send message: not connected');
            return;
        }

        this.ws.send(JSON.stringify(message));
    }

    startSession() {
        this.sendMessage({ type: 'start_session' });
    }

    endSession() {
        this.sendMessage({ type: 'end_session' });
    }

    isConnected() {
        return this.ws && this.ws.readyState === WebSocket.OPEN;
    }

    scheduleReconnect() {
        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

        console.log(`🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

        setTimeout(() => {
            this.connect().catch(() => {});
        }, delay);
    }

    disconnect() {
        this.autoReconnect = false;
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    enableAutoReconnect() {
        this.autoReconnect = true;
        this.reconnectAttempts = 0;
    }
}
