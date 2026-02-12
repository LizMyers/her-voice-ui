/**
 * Audio Visualizer
 * "Her" style waveform animation driven by voice output
 * White waveform on coral/salmon background
 */

export class AudioVisualizer {
    constructor(canvasElement) {
        this.canvas = canvasElement;
        this.ctx = this.canvas.getContext('2d');
        this.active = false;
        this.thinking = false;
        this.transitioning = false;
        this.transitionProgress = 0;
        this.analyser = null;
        this.dataArray = null;
        this.animationId = null;
        this.points = [];
        this.audioContext = null;
        this.thinkingPhase = 0;
        this.nextChunkTime = 0;

        this.logicalWidth = 0;
        this.logicalHeight = 0;

        // Visual parameters ("Her" aesthetic)
        this.config = {
            lineWidth: 3,
            lineColor: '#FFFFFF',
            backgroundColor: '#d1684e',      // Her OS1 coral/salmon
            idleAlpha: 0.4,
            activeAlpha: 1.0,
            pointsCount: 24,
            lerpFactor: 0.25,
            amplitudeScale: 8.0,
            idleAmplitude: 0.02,
            idleSpeed: 0.001
        };

        this.idlePhase = 0;
        this.points = new Array(this.config.pointsCount).fill(0);

        this.resize();
        window.addEventListener('resize', () => this.resize());

        this.startIdleAnimation();
    }

    getAudioContext() {
        if (!this.audioContext) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContextClass();
        }
        return this.audioContext;
    }

    createAnalyser() {
        const ctx = this.getAudioContext();
        this.analyser = ctx.createAnalyser();
        this.analyser.fftSize = 2048;
        this.analyser.smoothingTimeConstant = 0.8;
        this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        return this.analyser;
    }

    /**
     * Play audio with crossfade for smooth chunk transitions
     */
    async playAudio(audioData) {
        try {
            const ctx = this.getAudioContext();

            if (ctx.state === 'suspended') {
                await ctx.resume();
            }

            const audioBuffer = await ctx.decodeAudioData(audioData.slice(0));

            const source = ctx.createBufferSource();
            source.buffer = audioBuffer;

            const gainNode = ctx.createGain();

            if (!this.analyser) {
                this.createAnalyser();
            }

            // Low-pass filter to reduce high-end artifacts
            if (!this.lowPassFilter) {
                this.lowPassFilter = ctx.createBiquadFilter();
                this.lowPassFilter.type = 'lowpass';
                this.lowPassFilter.frequency.value = 8000;
                this.lowPassFilter.Q.value = 0.5;
            }

            source.connect(gainNode);
            gainNode.connect(this.lowPassFilter);
            this.lowPassFilter.connect(this.analyser);
            this.analyser.connect(ctx.destination);

            // Crossfade parameters
            const fadeTime = 0.05;
            const now = ctx.currentTime;

            let startTime = now;
            if (this.nextChunkTime && this.nextChunkTime > now) {
                startTime = this.nextChunkTime - fadeTime;
            }

            // Fade in
            gainNode.gain.setValueAtTime(0, startTime);
            gainNode.gain.linearRampToValueAtTime(1, startTime + fadeTime);

            // Fade out
            const endTime = startTime + audioBuffer.duration;
            gainNode.gain.setValueAtTime(1, endTime - fadeTime);
            gainNode.gain.linearRampToValueAtTime(0, endTime);

            this.nextChunkTime = endTime;

            this.active = true;

            source.start(startTime);

            return new Promise((resolve) => {
                source.onended = () => {
                    this.active = false;
                    resolve();
                };
            });
        } catch (err) {
            console.error('Error playing audio:', err);
            throw err;
        }
    }

    connectToStream() {
        const ctx = this.getAudioContext();

        if (!this.analyser) {
            this.createAnalyser();
        }

        this.streamDestination = ctx.createMediaStreamDestination();
        this.analyser.connect(ctx.destination);

        this.active = true;

        return {
            context: ctx,
            analyser: this.analyser,
            destination: this.streamDestination
        };
    }

    connectSource(sourceNode) {
        if (!this.analyser) {
            this.createAnalyser();
        }

        sourceNode.connect(this.analyser);
        this.analyser.connect(this.getAudioContext().destination);
        this.active = true;
    }

    disconnect() {
        this.active = false;
        if (this.analyser) {
            try {
                this.analyser.disconnect();
            } catch (e) {}
        }
    }

    startIdleAnimation() {
        const animate = () => {
            this.animationId = requestAnimationFrame(animate);
            this.draw();
        };
        animate();
    }

    draw() {
        const width = this.logicalWidth;
        const height = this.logicalHeight;
        const ctx = this.ctx;

        if (width === 0 || height === 0) return;

        ctx.fillStyle = this.config.backgroundColor;
        ctx.fillRect(0, 0, width, height);

        if (this.transitioning) {
            this.drawTransition(width, height);
            return;
        }

        if (this.thinking) {
            this.drawInfinityLoop(width, height);
            return;
        }

        let audioLevel = 0;
        if (this.active && this.analyser && this.dataArray) {
            this.analyser.getByteTimeDomainData(this.dataArray);

            let sum = 0;
            for (let i = 0; i < this.dataArray.length; i++) {
                const val = (this.dataArray[i] - 128) / 128;
                sum += val * val;
            }
            audioLevel = Math.sqrt(sum / this.dataArray.length);
        }

        this.updatePoints(audioLevel, height);
        this.drawWaveform(width, height);
    }

    /**
     * Her OS1-style infinity loop animation
     */
    drawInfinityLoop(width, height) {
        const ctx = this.ctx;
        const centerX = width / 2;
        const centerY = height / 2;

        this.thinkingPhase += 0.065;

        const loopLength = Math.min(width, height) * 0.2;
        const loopRadius = loopLength * 0.2;
        const tubeWidth = 6;

        ctx.lineCap = 'round';
        ctx.strokeStyle = this.config.lineColor;
        ctx.shadowColor = 'rgba(255, 255, 255, 0.6)';
        ctx.shadowBlur = 12;

        const numPoints = 120;
        const points = [];
        const pi2 = Math.PI * 2;

        for (let i = 0; i <= numPoints; i++) {
            const t = i / numPoints;
            let x = loopLength * Math.sin(pi2 * t);
            let y = loopRadius * Math.cos(pi2 * 3 * t);

            let tMod = t % 0.25 / 0.25;
            let tAdj = (t % 0.25) - (2 * (1 - tMod) * tMod * -0.0185 + tMod * tMod * 0.25);
            if (Math.floor(t / 0.25) === 0 || Math.floor(t / 0.25) === 2) tAdj *= -1;
            let z = loopRadius * Math.sin(pi2 * 2 * (t - tAdj));

            const cosR = Math.cos(this.thinkingPhase);
            const sinR = Math.sin(this.thinkingPhase);
            points.push({
                x: centerX + x,
                y: centerY + (y * cosR - z * sinR),
                z: y * sinR + z * cosR
            });
        }

        const segments = [];
        for (let i = 0; i < numPoints; i++) {
            segments.push({ i, z: (points[i].z + points[i + 1].z) / 2 });
        }
        segments.sort((a, b) => a.z - b.z);

        for (const seg of segments) {
            const p1 = points[seg.i];
            const p2 = points[seg.i + 1];
            const depth = (seg.z + loopRadius) / (loopRadius * 2);

            ctx.globalAlpha = 0.4 + depth * 0.5;
            ctx.lineWidth = tubeWidth * (0.5 + depth * 0.5);

            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
        }

        ctx.globalAlpha = 1.0;
        ctx.shadowBlur = 0;
    }

    updatePoints(audioLevel, height) {
        const { pointsCount, lerpFactor, amplitudeScale, idleAmplitude, idleSpeed } = this.config;

        this.idlePhase += idleSpeed;

        for (let i = 0; i < pointsCount; i++) {
            const normPos = i / (pointsCount - 1);
            const window = Math.sin(normPos * Math.PI);

            let targetY = 0;

            if (this.active && this.dataArray && audioLevel > 0.01) {
                const bufferStep = Math.floor(this.dataArray.length / pointsCount);
                const audioIndex = Math.min(i * bufferStep, this.dataArray.length - 1);
                const audioVal = (this.dataArray[audioIndex] / 128.0) - 1.0;

                targetY = audioVal * (height * 0.35) * amplitudeScale * window;
            } else {
                const breathPhase = this.idlePhase + normPos * Math.PI * 2;
                const breath = Math.sin(breathPhase) * Math.sin(breathPhase * 0.7);
                targetY = breath * (height * 0.1) * idleAmplitude * window;
            }

            this.points[i] += (targetY - this.points[i]) * lerpFactor;
        }
    }

    drawWaveform(width, height) {
        const ctx = this.ctx;
        const { pointsCount, activeAlpha, idleAlpha } = this.config;

        const sliceWidth = width / (pointsCount - 1);
        const centerY = height / 2;

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.globalAlpha = this.active ? activeAlpha : idleAlpha;

        ctx.beginPath();
        for (let i = 0; i < pointsCount; i++) {
            const x = i * sliceWidth;
            const y = centerY + this.points[i];

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                const prevX = (i - 1) * sliceWidth;
                const prevY = centerY + this.points[i - 1];
                const cpX = (prevX + x) / 2;
                const cpY = (prevY + y) / 2;
                ctx.quadraticCurveTo(prevX, prevY, cpX, cpY);
            }
        }
        const lastX = (pointsCount - 1) * sliceWidth;
        const lastY = centerY + this.points[pointsCount - 1];
        ctx.lineTo(lastX, lastY);
        ctx.stroke();

        ctx.globalAlpha = 1.0;
        ctx.shadowBlur = 0;
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();

        this.logicalWidth = rect.width;
        this.logicalHeight = rect.height;

        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;

        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    setActive(active) {
        if (active && this.thinking) {
            this.startTransition();
        } else {
            this.active = active;
            if (active) {
                this.thinking = false;
                this.transitioning = false;
            }
        }
    }

    setThinking(thinking) {
        if (!thinking && this.thinking) {
            this.thinking = false;
        } else {
            this.thinking = thinking;
            if (thinking) {
                this.active = false;
                this.transitioning = false;
                this.thinkingPhase = 0;
            }
        }
    }

    startTransition() {
        this.transitioning = true;
        this.thinking = false;
        this.transitionProgress = 0;
    }

    drawTransition(width, height) {
        const ctx = this.ctx;
        const centerX = width / 2;
        const centerY = height / 2;

        this.transitionProgress += 0.04;

        const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        const progress = ease(Math.min(1, this.transitionProgress));

        if (this.transitionProgress >= 1) {
            this.transitioning = false;
            this.active = true;
            return;
        }

        const loopLength = Math.min(width, height) * 0.18;
        const loopRadius = loopLength * 0.19;
        const tubeRadius = 3.5;

        const tiltAngle = progress * Math.PI / 2;
        const zoom = 1 + progress * 0.8;
        const fadeOut = 1 - Math.pow(progress, 2);

        ctx.strokeStyle = this.config.lineColor;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        this.thinkingPhase += 0.035 * (1 - progress * 0.5);

        if (fadeOut > 0.05) {
            const numPoints = 200;
            const points = [];

            for (let i = 0; i <= numPoints; i++) {
                const t = i / numPoints;
                const pi2 = Math.PI * 2;

                let x = loopLength * Math.sin(pi2 * t);
                let y = loopRadius * Math.cos(pi2 * 3 * t);

                let tMod = t % 0.25 / 0.25;
                let tAdj = (t % 0.25) - (2 * (1 - tMod) * tMod * -0.0185 + tMod * tMod * 0.25);
                if (Math.floor(t / 0.25) === 0 || Math.floor(t / 0.25) === 2) {
                    tAdj *= -1;
                }
                let z = loopRadius * Math.sin(pi2 * 2 * (t - tAdj));

                const rotX = this.thinkingPhase;
                const cosR = Math.cos(rotX);
                const sinR = Math.sin(rotX);
                let newY = y * cosR - z * sinR;
                let newZ = y * sinR + z * cosR;

                const cosTilt = Math.cos(tiltAngle);
                const sinTilt = Math.sin(tiltAngle);
                const tiltedX = x * cosTilt + newZ * sinTilt;
                const tiltedZ = -x * sinTilt + newZ * cosTilt;

                points.push({
                    x: centerX + tiltedX * zoom,
                    y: centerY + newY * zoom,
                    z: tiltedZ
                });
            }

            const segments = [];
            for (let i = 0; i < numPoints; i++) {
                segments.push({ index: i, z: (points[i].z + points[i + 1].z) / 2 });
            }
            segments.sort((a, b) => a.z - b.z);

            for (const seg of segments) {
                const i = seg.index;
                const p1 = points[i];
                const p2 = points[i + 1];

                const depth = (seg.z + loopRadius * zoom) / (loopRadius * 2 * zoom);
                const opacity = (0.4 + depth * 0.6) * fadeOut;
                const thickness = tubeRadius * (0.6 + depth * 0.4) * zoom;

                ctx.globalAlpha = opacity;
                ctx.lineWidth = thickness;

                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.stroke();
            }
        }

        const ringOpacity = Math.pow(progress, 3);
        const ringScale = 0.9 + 0.1 * progress;
        const ringRadius = 25 * zoom * ringScale;

        if (ringOpacity > 0.05) {
            ctx.globalAlpha = ringOpacity;
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.globalAlpha = 1.0;
    }

    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
    }
}
