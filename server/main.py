"""
Her Voice UI - WebSocket Server
Real-time voice conversations with Gemini's native audio model

Architecture:
  Browser <-> WebSocket <-> Gemini Live (voice I/O)
"""

import asyncio
import base64
import json
import os
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from gemini_client import GeminiConfig, run_gemini_session, pcm_to_wav, DEFAULT_SYSTEM_PROMPT

# Output sample rate for native audio model
OUTPUT_SAMPLE_RATE = 24000

# Load environment variables
load_dotenv()

# Configuration
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8765"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler"""
    print(f"🚀 Her Voice Server starting on {HOST}:{PORT}")
    if not GEMINI_API_KEY:
        print("⚠️  Warning: GEMINI_API_KEY not set. Set it in .env or environment.")
    yield
    print("👋 Her Voice Server shutting down")


app = FastAPI(
    title="Her Voice Server",
    description="Real-time voice conversations with Gemini Live",
    lifespan=lifespan
)

# CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "status": "ok",
        "service": "Her Voice Server",
        "gemini_configured": bool(GEMINI_API_KEY)
    }


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    Main WebSocket endpoint for voice communication
    Handles bidirectional audio streaming with Gemini Live
    """
    await websocket.accept()

    print(f"🔌 Client connected")

    if not GEMINI_API_KEY:
        await websocket.send_text(json.dumps({
            "type": "error",
            "message": "GEMINI_API_KEY not configured on server"
        }))
        await websocket.close(code=1011, reason="API key not configured")
        return

    # Queue for sending audio to Gemini
    audio_queue: asyncio.Queue = asyncio.Queue()

    # Shutdown event for clean termination
    shutdown_event = asyncio.Event()

    # Track if we're still connected
    is_connected = True
    gemini_task: Optional[asyncio.Task] = None
    audio_chunk_count = 0

    # Buffer to accumulate audio chunks for smoother playback
    audio_buffer = bytearray()
    BUFFER_TARGET_SIZE = 48000  # ~1 second of audio at 24kHz 16-bit mono

    async def send_log(message: str, level: str = "info"):
        """Send a log message to the client"""
        if not is_connected:
            return
        try:
            await websocket.send_text(json.dumps({
                "type": "server_log",
                "message": message,
                "level": level
            }))
        except:
            pass

    async def handle_gemini_response(response_type: str, data):
        """Handle responses from Gemini and forward to client"""
        nonlocal is_connected, audio_chunk_count, audio_buffer

        if not is_connected:
            return

        try:
            if response_type == "audio":
                audio_chunk_count += 1
                # Log first chunk to debug format
                if audio_chunk_count == 1:
                    print(f"🔊 First audio chunk: {len(data)} bytes")

                # Accumulate audio in buffer
                audio_buffer.extend(data)

                # Send when buffer is large enough
                if len(audio_buffer) >= BUFFER_TARGET_SIZE:
                    wav_data = pcm_to_wav(bytes(audio_buffer), sample_rate=OUTPUT_SAMPLE_RATE)
                    await websocket.send_text(json.dumps({
                        "type": "audio",
                        "data": base64.b64encode(wav_data).decode("utf-8")
                    }))
                    audio_buffer = bytearray()

            elif response_type == "text":
                await websocket.send_text(json.dumps({
                    "type": "transcript",
                    "text": data,
                    "speaker": "assistant"
                }))

            elif response_type == "turn_complete":
                # Flush any remaining audio in buffer
                if len(audio_buffer) > 0:
                    wav_data = pcm_to_wav(bytes(audio_buffer), sample_rate=OUTPUT_SAMPLE_RATE)
                    await websocket.send_text(json.dumps({
                        "type": "audio",
                        "data": base64.b64encode(wav_data).decode("utf-8")
                    }))
                    audio_buffer = bytearray()
                await websocket.send_text(json.dumps({"type": "assistant_silent"}))

            elif response_type == "interrupted":
                await websocket.send_text(json.dumps({"type": "interrupted"}))

            elif response_type == "error":
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "message": data
                }))

        except Exception as e:
            print(f"Error sending to client: {e}")
            is_connected = False

    async def run_gemini():
        """Run the Gemini session"""
        try:
            await send_log("Connecting to Gemini Live...")
            config = GeminiConfig(
                api_key=GEMINI_API_KEY,
                system_instruction=DEFAULT_SYSTEM_PROMPT
            )
            await run_gemini_session(config, audio_queue, handle_gemini_response, shutdown_event, send_log)
            await send_log("Gemini session ended", "warn")
        except Exception as e:
            error_msg = str(e)
            print(f"Gemini session error: {e}")
            await send_log(f"Gemini error: {error_msg}", "error")
            await handle_gemini_response("error", error_msg)

    # Start Gemini session
    gemini_task = asyncio.create_task(run_gemini())

    # Notify client
    await websocket.send_text(json.dumps({
        "type": "session_started"
    }))

    try:
        # Handle incoming messages from client
        while is_connected:
            message = await websocket.receive()

            if message["type"] == "websocket.disconnect":
                break

            # Binary data = audio from microphone
            if "bytes" in message:
                await audio_queue.put(message["bytes"])

            # Text data = control messages
            elif "text" in message:
                try:
                    data = json.loads(message["text"])
                    msg_type = data.get("type")

                    if msg_type == "end_session":
                        break

                except json.JSONDecodeError:
                    print(f"Invalid JSON: {message['text']}")

    except WebSocketDisconnect:
        print("🔌 Client disconnected")
    except Exception as e:
        print(f"❌ WebSocket error: {e}")
    finally:
        is_connected = False

        # Signal Gemini task to stop
        shutdown_event.set()
        await audio_queue.put(None)

        # Cancel Gemini task if still running
        if gemini_task and not gemini_task.done():
            gemini_task.cancel()
            try:
                await gemini_task
            except asyncio.CancelledError:
                pass

        print("🔌 Session ended")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT)
