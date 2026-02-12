/**
 * Her Voice UI - Main Application
 * "Her" style voice interface with Gemini Live integration
 * Push-to-talk: Hold SPACE to talk
 */

import { AudioVisualizer } from './audio-visualizer.js';
import { VoiceConnection } from './websocket-client.js';
import { ThinkingAnimation } from './thinking-animation.js';

class HerVoiceApp {
    constructor() {
        this.visualizer = null;
        this.connection = null;
        this.mediaStream = null;
        this.audioContext = null;
        this.mediaRecorder = null;
        this.isListening = false;
        this.isMicActive = false;

        // Push-to-talk state
        this.isPushToTalk = false;
        this.pttKey = ' ';  // Spacebar

        // Audio playback queue
        this.audioQueue = [];
        this.isPlaying = false;

        // Store last audio for replay
        this.lastAudioData = null;
        this.allAudioChunks = [];

        // Configuration
        this.config = {
            wsUrl: 'ws://localhost:8765/ws',
            sampleRate: 16000
        };

        this.init();
    }

    async init() {
        console.log('🚀 Her Voice UI initializing...');

        // Get DOM elements
        this.canvas = document.getElementById('waveform-canvas');
        this.transcriptOverlay = document.getElementById('transcript-overlay');
        this.statusIndicator = document.getElementById('status-indicator');
        this.transcriptLog = document.getElementById('transcript-log');
        this.pttIndicator = document.getElementById('ptt-indicator');

        // Drawer elements
        this.debugDrawer = document.getElementById('debug-drawer');
        this.drawerToggle = document.getElementById('drawer-toggle');
        this.disconnectBtn = document.getElementById('disconnect-btn');
        this.serverStatusDot = document.getElementById('server-status-dot');
        this.serverStatusText = document.getElementById('server-status-text');

        this.isManuallyDisconnected = false;

        if (!this.canvas) {
            console.error('❌ Canvas element not found');
            return;
        }

        // Initialize visualizer
        this.visualizer = new AudioVisualizer(this.canvas);

        // Initialize thinking animation
        this.thinkingContainer = document.getElementById('thinking-container');
        this.thinkingAnimation = new ThinkingAnimation(this.thinkingContainer);

        // Initialize WebSocket connection
        this.initConnection();

        // Set up click-to-start (browser autoplay policy)
        this.setupUserInteraction();

        // Set up push-to-talk
        this.setupPushToTalk();

        // Set up drawer toggle
        if (this.drawerToggle) {
            this.drawerToggle.addEventListener('click', () => this.toggleDrawer());
        }

        // Set up disconnect button
        if (this.disconnectBtn) {
            this.disconnectBtn.addEventListener('click', () => this.toggleConnection());
        }

        // Set up share input
        this.shareInput = document.getElementById('share-input');
        this.shareBtn = document.getElementById('share-btn');

        if (this.shareBtn && this.shareInput) {
            this.shareBtn.addEventListener('click', () => this.shareContent());
            this.shareInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.shareContent();
                }
            });
        }

        console.log('✅ Her Voice UI ready');
    }

    toggleDrawer() {
        if (this.debugDrawer) {
            this.debugDrawer.classList.toggle('collapsed');
            if (this.drawerToggle) {
                this.drawerToggle.textContent = this.debugDrawer.classList.contains('collapsed') ? '▶' : '◀';
            }
        }
    }

    async toggleConnection() {
        const isConnected = this.connection?.isConnected();

        if (!isConnected) {
            this.audioContext = this.visualizer.getAudioContext();
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            this.isManuallyDisconnected = false;
            if (this.connection) {
                this.connection.enableAutoReconnect();
            }
            this.updateDisconnectButton();
            this.logTranscript('system', 'Connecting...');
            await this.restartConnection();
        } else {
            this.isManuallyDisconnected = true;
            this.stopMicrophone();
            if (this.connection) {
                this.connection.disconnect();
            }
            this.setStatus('disconnected');
            this.setServerStatus('disconnected');
            this.updateDisconnectButton();
            this.logTranscript('system', 'Disconnected');
        }
    }

    updateDisconnectButton() {
        if (!this.disconnectBtn) return;

        const isConnected = this.connection?.isConnected();

        if (isConnected) {
            this.disconnectBtn.textContent = 'Disconnect';
            this.disconnectBtn.classList.remove('disconnected');
        } else {
            this.disconnectBtn.textContent = 'Connect';
            this.disconnectBtn.classList.add('disconnected');
        }
    }

    async restartConnection() {
        this.logTranscript('system', 'Restarting connection...');
        this.setServerStatus('connecting');

        this.stopMicrophone();
        if (this.connection) {
            this.connection.disconnect();
        }

        this.audioQueue = [];
        this.allAudioChunks = [];
        this.isPlaying = false;

        await new Promise(resolve => setTimeout(resolve, 500));

        this.initConnection();

        try {
            await this.connection.connect();
        } catch (error) {
            console.error('Failed to reconnect:', error);
            this.setStatus('error');
            this.setServerStatus('error');
        }
    }

    setServerStatus(status) {
        if (this.serverStatusDot) {
            this.serverStatusDot.classList.remove('connected', 'error');
            if (status === 'connected') {
                this.serverStatusDot.classList.add('connected');
            } else if (status === 'error') {
                this.serverStatusDot.classList.add('error');
            }
        }
        if (this.serverStatusText) {
            const statusMap = {
                'connected': 'Connected',
                'connecting': 'Connecting...',
                'disconnected': 'Disconnected',
                'error': 'Error'
            };
            this.serverStatusText.textContent = statusMap[status] || status;
        }
    }

    setupPushToTalk() {
        window.addEventListener('keydown', (e) => {
            if (e.key === this.pttKey && !e.repeat) {
                e.preventDefault();
                this.startTalking();
            }
            if (e.key === 'Escape') {
                this.toggleDrawer();
            }
        });

        window.addEventListener('keyup', (e) => {
            if (e.key === this.pttKey) {
                e.preventDefault();
                this.stopTalking();
            }
        });

        window.addEventListener('blur', () => {
            if (this.isPushToTalk) {
                this.stopTalking();
            }
        });

        console.log('🎤 Push-to-talk: Hold SPACE to talk');
    }

    startTalking() {
        if (!this.isMicActive || !this.connection?.isConnected()) return;

        // Interrupt if speaking
        if (this.isPlaying || this.audioQueue.length > 0) {
            this.interruptPlayback();
        }

        this.isPushToTalk = true;
        this.setStatus('recording');
        this.logTranscript('system', '🎤 Recording...');

        if (this.pttIndicator) {
            this.pttIndicator.classList.add('active');
        }

        console.log('🎤 Push-to-talk: ON');
    }

    interruptPlayback() {
        console.log('⚡ Interrupting...');

        this.audioQueue = [];
        this.isPlaying = false;

        this.visualizer.setActive(false);
        this.visualizer.setThinking(false);

        if (this.visualizer.analyser) {
            try {
                this.visualizer.analyser.disconnect();
            } catch (e) {
                // Already disconnected
            }
        }

        this.logTranscript('system', '⚡ Interrupted');
    }

    stopTalking() {
        if (!this.isPushToTalk) return;

        this.isPushToTalk = false;
        this.setStatus('listening');

        if (this.pttIndicator) {
            this.pttIndicator.classList.remove('active');
        }

        this.sendSilence();

        console.log('🎤 Push-to-talk: OFF');
    }

    sendSilence() {
        if (!this.connection?.isConnected()) return;

        const silenceSamples = 8000;
        const silenceBuffer = new Int16Array(silenceSamples);

        this.connection.sendAudio(silenceBuffer.buffer);
        console.log('🔇 Sent silence buffer');
    }

    initConnection() {
        this.connection = new VoiceConnection({
            url: this.config.wsUrl,

            onConnected: () => {
                this.setStatus('connected');
                this.setServerStatus('connected');
                this.updateDisconnectButton();
                this.logTranscript('system', 'Connected — Hold SPACE to talk');
                this.startMicrophone();
            },

            onDisconnected: () => {
                this.setStatus('disconnected');
                this.setServerStatus('disconnected');
                this.updateDisconnectButton();
                this.logTranscript('system', 'Disconnected');
                this.stopMicrophone();
            },

            onAudio: (audioData) => {
                this.queueAudio(audioData);
            },

            onTranscript: (transcript) => {
                this.showTranscript(transcript);
                this.logTranscript(transcript.speaker, transcript.text);
            },

            onAssistantSpeaking: () => {
                this.setStatus('speaking');
                this.visualizer.setActive(true);
            },

            onAssistantSilent: () => {
                const waitForAudioFinish = () => {
                    const ctx = this.visualizer?.audioContext;
                    const scheduledEnd = this.visualizer?.nextChunkTime || 0;
                    const now = ctx?.currentTime || 0;

                    if (this.isPlaying || this.audioQueue.length > 0 || (scheduledEnd > now + 0.5)) {
                        setTimeout(waitForAudioFinish, 200);
                    } else {
                        setTimeout(() => {
                            this.setStatus('listening');
                            this.visualizer.setActive(false);
                            if (this.allAudioChunks.length > 0) {
                                this.combineAudioChunks();
                            }
                        }, 500);
                    }
                };
                waitForAudioFinish();
            },

            onThinking: (isThinking) => {
                if (isThinking) {
                    this.setStatus('thinking');
                    this.thinkingAnimation.start();
                    this.logTranscript('system', '🧠 Thinking...');
                } else {
                    this.thinkingAnimation.triggerTransition();
                    setTimeout(() => {
                        this.thinkingAnimation.stop();
                    }, 1500);
                }
            },

            onError: (error) => {
                console.error('Connection error:', error);
                this.setStatus('error');
                this.setServerStatus('error');
                this.logTranscript('error', error.message || 'Connection error');
            },

            onServerLog: (message, level) => {
                this.logTranscript('server', message, level);
            }
        });
    }

    setupUserInteraction() {
        const startOnInteraction = async () => {
            document.removeEventListener('click', startOnInteraction);
            document.removeEventListener('touchstart', startOnInteraction);

            this.audioContext = this.visualizer.getAudioContext();
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            try {
                await this.connection.connect();
            } catch (error) {
                console.error('Failed to connect:', error);
                this.setStatus('error');
            }
        };

        document.addEventListener('click', startOnInteraction);
        document.addEventListener('touchstart', startOnInteraction);

        this.setStatus('disconnected');
        this.logTranscript('system', 'Click anywhere to start');
    }

    async startMicrophone() {
        if (this.isMicActive) return;

        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: this.config.sampleRate
                }
            });

            const audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: this.config.sampleRate
            });

            const source = audioContext.createMediaStreamSource(this.mediaStream);

            const bufferSize = 4096;
            const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);

            processor.onaudioprocess = (e) => {
                if (!this.connection.isConnected() || !this.isPushToTalk) return;

                const inputData = e.inputBuffer.getChannelData(0);

                const pcmData = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    const s = Math.max(-1, Math.min(1, inputData[i]));
                    pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }

                this.connection.sendAudio(pcmData.buffer);
            };

            source.connect(processor);
            processor.connect(audioContext.destination);

            this.isMicActive = true;
            this.setStatus('listening');

            console.log('🎙️ Microphone ready (push-to-talk mode)');

        } catch (error) {
            console.error('❌ Microphone access denied:', error);
            this.setStatus('error');
            this.logTranscript('error', 'Microphone access denied');
        }
    }

    stopMicrophone() {
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }
        this.isMicActive = false;
    }

    queueAudio(audioData) {
        this.allAudioChunks.push(audioData);
        this.audioQueue.push(audioData);
        this.processAudioQueue();
    }

    combineAudioChunks() {
        if (this.allAudioChunks.length === 0) return;

        let totalLength = 0;
        for (const chunk of this.allAudioChunks) {
            totalLength += chunk.byteLength;
        }

        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of this.allAudioChunks) {
            combined.set(new Uint8Array(chunk), offset);
            offset += chunk.byteLength;
        }

        const chunkCount = this.allAudioChunks.length;
        this.lastAudioData = combined.buffer;
        this.allAudioChunks = [];

        console.log(`🔄 Combined ${chunkCount} chunks into ${totalLength} bytes`);
    }

    async replayLastAudio() {
        if (!this.lastAudioData) {
            console.log('No audio to replay');
            return;
        }

        console.log('🔄 Replaying last audio...');
        this.logTranscript('system', 'Replaying...');

        try {
            this.visualizer.setActive(true);
            await this.visualizer.playAudio(this.lastAudioData);
            this.visualizer.setActive(false);
        } catch (error) {
            console.error('Error replaying audio:', error);
            this.logTranscript('error', 'Replay failed: ' + error.message);
        }
    }

    async processAudioQueue() {
        if (this.isPlaying || this.audioQueue.length === 0) return;

        this.isPlaying = true;

        while (this.audioQueue.length > 0) {
            const audioData = this.audioQueue.shift();

            try {
                await this.visualizer.playAudio(audioData);
            } catch (error) {
                console.error('Error playing audio:', error);
            }
        }

        this.isPlaying = false;
    }

    showTranscript(transcript) {
        if (!this.transcriptOverlay) return;

        const { text, speaker } = transcript;

        if (speaker === 'user') {
            this.transcriptOverlay.innerHTML = `<em>${text}</em>`;
        } else {
            this.transcriptOverlay.textContent = text;
        }

        this.transcriptOverlay.classList.add('visible');

        clearTimeout(this.transcriptTimeout);
        this.transcriptTimeout = setTimeout(() => {
            this.transcriptOverlay.classList.remove('visible');
        }, 5000);
    }

    logTranscript(speaker, text, level = 'info') {
        if (!this.transcriptLog) return;

        const entry = document.createElement('div');
        entry.className = 'entry';

        let speakerClass, prefix;
        switch (speaker) {
            case 'assistant':
                speakerClass = 'assistant';
                prefix = '🤖 ';
                break;
            case 'user':
                speakerClass = 'user';
                prefix = 'You: ';
                break;
            case 'server':
                speakerClass = level === 'error' ? 'server-error' : level === 'warn' ? 'server-warn' : 'server';
                prefix = '';
                break;
            case 'error':
                speakerClass = 'server-error';
                prefix = '❌ ';
                break;
            default:
                speakerClass = 'system';
                prefix = '• ';
        }

        entry.innerHTML = `<span class="${speakerClass}">${prefix}${text}</span>`;
        this.transcriptLog.appendChild(entry);

        this.transcriptLog.scrollTop = this.transcriptLog.scrollHeight;
    }

    setStatus(status) {
        if (!this.statusIndicator) return;

        this.statusIndicator.classList.remove('connected', 'speaking', 'listening', 'error', 'recording', 'thinking');

        switch (status) {
            case 'connected':
            case 'listening':
                this.statusIndicator.classList.add('listening');
                break;
            case 'speaking':
                this.statusIndicator.classList.add('speaking');
                break;
            case 'recording':
                this.statusIndicator.classList.add('recording');
                break;
            case 'thinking':
                this.statusIndicator.classList.add('thinking');
                break;
            case 'error':
                this.statusIndicator.classList.add('error');
                break;
        }
    }

    shareContent() {
        if (!this.shareInput) return;

        const content = this.shareInput.value.trim();
        if (!content) return;

        if (!this.connection?.isConnected()) {
            this.logTranscript('error', 'Not connected - cannot share');
            return;
        }

        this.connection.sendMessage({
            type: 'share_content',
            content: content
        });

        this.logTranscript('user', `Shared: ${content}`);
        this.shareInput.value = '';

        this.visualizer.setThinking(true);
        this.setStatus('thinking');
    }

    destroy() {
        this.stopMicrophone();
        if (this.connection) {
            this.connection.disconnect();
        }
        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close();
        }
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new HerVoiceApp();
});

// Handle page unload
window.addEventListener('beforeunload', () => {
    if (window.app) {
        window.app.destroy();
    }
});
