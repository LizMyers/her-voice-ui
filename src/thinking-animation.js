/**
 * Thinking animation - embeds the Her OS1 CodePen
 *
 * Original animation by Siyoung Park (@psyonline)
 * https://codepen.io/psyonline/pen/yayYWg
 * Used with appreciation for this beautiful recreation of the Her OS1 interface.
 */

export class ThinkingAnimation {
    constructor(container) {
        this.container = container;
        this.active = false;
        this.iframe = null;
        this.iframeReady = false;
        this.init();
    }

    init() {
        // Create iframe for CodePen embed (loads in background)
        this.iframe = document.createElement('iframe');
        this.iframe.src = 'https://codepen.io/psyonline/embed/yayYWg?default-tab=result&theme-id=dark';
        this.iframe.style.cssText = `
            width: 200%;
            height: 200%;
            border: none;
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) scale(2);
            background: #d1684e;
        `;
        this.iframe.setAttribute('allowfullscreen', 'true');
        this.iframe.setAttribute('allowtransparency', 'true');

        // Mark ready after iframe loads + delay for CodePen canvas
        this.iframe.addEventListener('load', () => {
            setTimeout(() => {
                this.iframeReady = true;
                console.log('✅ Thinking animation loaded');
            }, 1500);
        });

        this.container.appendChild(this.iframe);
    }

    start() {
        if (this.active) return;
        this.active = true;
        // Show immediately - iframe should be preloaded by now
        this.container.classList.add('active');
    }

    stop() {
        this.active = false;
        this.container.classList.remove('active');
    }

    // Placeholder - can't trigger click in cross-origin iframe
    triggerTransition() {
        // Would need local implementation to support this
    }

    releaseTransition() {
        // Would need local implementation to support this
    }

    destroy() {
        this.stop();
        if (this.iframe && this.iframe.parentNode) {
            this.iframe.parentNode.removeChild(this.iframe);
        }
    }
}
