"""
Gemini Live API Client for Her Voice UI
Real-time voice conversation with Gemini's native audio model

Architecture:
  User speaks → Gemini (STT + thinking + TTS) → Audio response
"""

import asyncio
from dataclasses import dataclass
from enum import Enum

try:
    from google import genai
    from google.genai import types
except ImportError:
    print("Please install google-genai: pip install google-genai")
    raise


class AudioFormat(Enum):
    PCM_16KHZ = "pcm_16000"
    PCM_24KHZ = "pcm_24000"


@dataclass
class GeminiConfig:
    """Configuration for Gemini Live session"""
    api_key: str
    model: str = "gemini-2.5-flash-preview-native-audio-dialog"
    voice: str = "Puck"  # Aoede, Charon, Fenrir, Kore, Puck
    system_instruction: str = ""
    input_sample_rate: int = 16000
    output_sample_rate: int = 24000  # Native audio outputs at 24kHz


# Default system prompt - customize for your assistant's personality
DEFAULT_SYSTEM_PROMPT = """You are a helpful, friendly AI assistant with a warm conversational style.

Voice characteristics:
- Warm, direct, and natural
- Use contractions naturally (I'm, you're, let's)
- Be conversational, not robotic
- Keep responses concise for voice - no one wants to listen to paragraphs

You can help with:
- Answering questions
- Having conversations
- Brainstorming ideas
- Explaining concepts

Keep it natural - you're having a conversation, not reading a script.
"""


async def run_gemini_session(
    config: GeminiConfig,
    audio_queue: asyncio.Queue,
    response_callback,
    shutdown_event: asyncio.Event = None,
    log_callback=None
):
    """
    Run a Gemini Live session.

    Args:
        config: GeminiConfig with API key and settings
        audio_queue: Queue to receive audio data to send to Gemini
        response_callback: Async callback for responses (type, data)
        shutdown_event: Event to signal session shutdown
        log_callback: Optional async callback for log messages (message, level)
    """
    async def log(msg: str, level: str = "info"):
        print(msg)
        if log_callback:
            await log_callback(msg, level)

    client = genai.Client(api_key=config.api_key)

    live_config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                    voice_name=config.voice
                )
            )
        ),
        system_instruction=types.Content(
            parts=[types.Part(text=config.system_instruction or DEFAULT_SYSTEM_PROMPT)]
        ),
    )

    await log(f"🔌 Connecting to Gemini Live ({config.model})...")

    if shutdown_event is None:
        shutdown_event = asyncio.Event()

    async with client.aio.live.connect(model=config.model, config=live_config) as session:
        await log("✅ Connected to Gemini Live")

        async def send_audio_task():
            """Task to send audio from queue to Gemini"""
            chunks_sent = 0
            print("🎤 Starting audio send task...")
            while not shutdown_event.is_set():
                try:
                    try:
                        audio_data = await asyncio.wait_for(audio_queue.get(), timeout=0.5)
                    except asyncio.TimeoutError:
                        continue

                    if audio_data is None:
                        print("🎤 Received shutdown signal")
                        break

                    await session.send(
                        input=types.LiveClientRealtimeInput(
                            media_chunks=[
                                types.Blob(
                                    mime_type=f"audio/pcm;rate={config.input_sample_rate}",
                                    data=audio_data
                                )
                            ]
                        )
                    )
                    chunks_sent += 1
                    if chunks_sent % 100 == 0:
                        print(f"🎤 Sent {chunks_sent} audio chunks")
                except asyncio.CancelledError:
                    print("🎤 Send task cancelled")
                    break
                except Exception as e:
                    error_str = str(e)
                    if "1008" in error_str or "ConnectionClosed" in error_str:
                        await log("❌ Gemini connection closed", "error")
                        shutdown_event.set()
                        break
                    await log(f"❌ Error sending audio: {e}", "error")

        async def receive_responses_task():
            """Task to receive responses from Gemini"""
            turn_count = 0
            try:
                print("📡 Starting to receive responses from Gemini...")
                while not shutdown_event.is_set():
                    try:
                        async for response in session.receive():
                            if shutdown_event.is_set():
                                break

                            if response.server_content:
                                content = response.server_content

                                if getattr(content, 'interrupted', False):
                                    print("   ⚡ Interrupted")
                                    await response_callback("interrupted", None)
                                    continue

                                if content.model_turn and content.model_turn.parts:
                                    for part in content.model_turn.parts:
                                        if part.inline_data:
                                            audio_bytes = part.inline_data.data
                                            if turn_count == 0:
                                                print(f"   🔊 Audio chunk: {len(audio_bytes)} bytes")
                                            await response_callback("audio", audio_bytes)

                                        if part.text:
                                            print(f"   💬 Text: {part.text[:100]}...")
                                            await response_callback("text", part.text)

                                if content.turn_complete:
                                    turn_count += 1
                                    print(f"   ✅ Turn {turn_count} complete")
                                    await response_callback("turn_complete", None)

                        print("📡 Receive iterator ended...")
                        if shutdown_event.is_set():
                            break
                        await asyncio.sleep(0.1)

                    except Exception as e:
                        error_str = str(e)
                        if "cancelled" in error_str.lower():
                            break
                        if "1008" in error_str or "ConnectionClosed" in error_str:
                            await log("❌ Gemini connection lost", "error")
                            shutdown_event.set()
                            break
                        await log(f"⚠️ Receive error: {e}", "warn")
                        await asyncio.sleep(0.5)

                print("📡 Receive task ending")
            except asyncio.CancelledError:
                print("📡 Receive task cancelled")
            except Exception as e:
                print(f"❌ Fatal error: {e}")
                import traceback
                traceback.print_exc()
                await response_callback("error", str(e))

        send_task = asyncio.create_task(send_audio_task())
        receive_task = asyncio.create_task(receive_responses_task())

        try:
            while not shutdown_event.is_set():
                done, pending = await asyncio.wait(
                    [send_task, receive_task],
                    timeout=1.0,
                    return_when=asyncio.FIRST_COMPLETED
                )

                for task in done:
                    if task.exception():
                        print(f"Task failed: {task.exception()}")
                        shutdown_event.set()
                        break

                if done and not pending:
                    break

        except asyncio.CancelledError:
            pass
        finally:
            shutdown_event.set()
            send_task.cancel()
            receive_task.cancel()

            for task in [send_task, receive_task]:
                try:
                    await task
                except asyncio.CancelledError:
                    pass

    print("🔌 Disconnected from Gemini")


def pcm_to_wav(pcm_data: bytes, sample_rate: int = 24000, channels: int = 1, sample_width: int = 2) -> bytes:
    """Convert raw PCM data to WAV format"""
    import struct
    import io

    byte_rate = sample_rate * channels * sample_width
    block_align = channels * sample_width
    data_size = len(pcm_data)
    file_size = 36 + data_size

    wav_buffer = io.BytesIO()

    wav_buffer.write(b'RIFF')
    wav_buffer.write(struct.pack('<I', file_size))
    wav_buffer.write(b'WAVE')

    wav_buffer.write(b'fmt ')
    wav_buffer.write(struct.pack('<I', 16))
    wav_buffer.write(struct.pack('<H', 1))
    wav_buffer.write(struct.pack('<H', channels))
    wav_buffer.write(struct.pack('<I', sample_rate))
    wav_buffer.write(struct.pack('<I', byte_rate))
    wav_buffer.write(struct.pack('<H', block_align))
    wav_buffer.write(struct.pack('<H', sample_width * 8))

    wav_buffer.write(b'data')
    wav_buffer.write(struct.pack('<I', data_size))
    wav_buffer.write(pcm_data)

    return wav_buffer.getvalue()
