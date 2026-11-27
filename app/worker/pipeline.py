#!/usr/bin/env python3
"""
Opus2Short AI Studio — Real Media & AI Processing Worker
Handles:
  1. ingest_youtube  - yt-dlp download + ffprobe + audio extract + thumbnail
  2. ingest_upload   - ffprobe + audio extract + thumbnail
  3. transcribe      - faster-whisper word-level timestamps (or API fallback)
  4. detect_faces    - OpenCV face detection -> normalized 9:16 crop keyframes
  5. render_clip     - Full FFmpeg render with .ass karaoke subtitles, 9:16/4:5/1:1/16:9,
                       Auto/Fill/Fit/Split/Three/Four layouts, transitions, motion zoom,
                       autoColor (denoise/sharpen/eq), watermark logo, text & progress bar.
"""

import sys
import os
import json
import subprocess
import math
import urllib.request
from pathlib import Path


def run_cmd(cmd, check=True):
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if check and proc.returncode != 0:
        raise RuntimeError(f"Command failed ({proc.returncode}): {' '.join(cmd)}\n{proc.stderr[-1000:]}")
    return proc


def ffprobe_info(video_path):
    cmd = [
        "ffprobe", "-v", "quiet", "-print_format", "json",
        "-show_format", "-show_streams", str(video_path)
    ]
    proc = run_cmd(cmd)
    data = json.loads(proc.stdout)
    duration = float(data.get("format", {}).get("duration", 0))
    width, height, fps = 1280, 720, 30.0
    for s in data.get("streams", []):
        if s.get("codec_type") == "video":
            width = int(s.get("width", 1280))
            height = int(s.get("height", 720))
            r_fps = s.get("r_frame_rate", "30/1")
            if "/" in r_fps:
                num, den = r_fps.split("/")
                if float(den) > 0:
                    fps = round(float(num) / float(den), 2)
            break
    return {"duration": duration, "width": width, "height": height, "fps": fps}


def extract_audio_and_thumb(video_path, out_dir):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    audio_path = out_dir / "audio.wav"
    thumb_path = out_dir / "thumb.jpg"

    run_cmd([
        "ffmpeg", "-y", "-i", str(video_path),
        "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
        str(audio_path)
    ])

    run_cmd([
        "ffmpeg", "-y", "-i", str(video_path),
        "-ss", "00:00:01.000", "-vframes", "1", "-vf", "scale=640:-1",
        str(thumb_path)
    ], check=False)

    return str(audio_path), str(thumb_path) if thumb_path.exists() else None


def _find_youtube_cookies(custom_path=None):
    """Find any available Netscape cookies.txt file for YouTube authentication."""
    candidates = []
    if custom_path and os.path.exists(custom_path):
        candidates.append(Path(custom_path))
    env_c = os.environ.get("YOUTUBE_COOKIES_FILE") or os.environ.get("COOKIES_FILE")
    if env_c and os.path.exists(env_c):
        candidates.append(Path(env_c))
    
    # Check default data / storage locations
    base = Path(__file__).resolve().parent.parent
    for check_dir in [base / "data", base.parent / "data", Path("/studio/app/data")]:
        if check_dir.exists():
            for f in check_dir.glob("*cookie*.txt"):
                candidates.append(f)
            if (check_dir / "cookies.txt").exists():
                candidates.append(check_dir / "cookies.txt")

    for c in candidates:
        if c.exists() and c.is_file() and c.stat().st_size > 32:
            return str(c)
    return None


def cmd_ingest_youtube(args):
    url = args["url"]
    out_dir = Path(args["out_dir"])
    out_dir.mkdir(parents=True, exist_ok=True)
    video_path = out_dir / "source.mp4"
    cookies_path = _find_youtube_cookies(args.get("cookies_path"))

    # Strategies to bypass YouTube "Sign in to confirm you're not a bot" challenge:
    # 1. Android player client (does not trigger bot wall for most public videos/streams)
    # 2. Web client with cookies (if cookies.txt is provided)
    # 3. Standard fallback
    client_combos = [
        "android,web",
        "web,android",
        "tv_embedded,web",
        "android_embedded,web"
    ]

    meta = None
    meta_err = ""
    for client in client_combos:
        cmd = ["yt-dlp", "--dump-json", "--no-playlist", "--no-warnings",
               "--extractor-args", f"youtube:player_client={client}"]
        if cookies_path:
            cmd += ["--cookies", cookies_path]
        cmd.append(url)
        proc = run_cmd(cmd, check=False)
        if proc.returncode == 0 and proc.stdout.strip():
            try:
                meta = json.loads(proc.stdout.splitlines()[0])
                break
            except Exception:
                pass
        else:
            meta_err = proc.stderr.strip()

    # Fallback to plain oEmbed for title/author if yt-dlp dump-json failed
    if not meta:
        title = "YouTube Video"
        channel = "YouTube"
        try:
            oembed_url = f"https://www.youtube.com/oembed?url={urllib.request.quote(url)}&format=json"
            req = urllib.request.Request(oembed_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=10) as r:
                o_data = json.loads(r.read().decode())
                title = o_data.get("title", title)
                channel = o_data.get("author_name", channel)
        except Exception:
            pass
    else:
        title = meta.get("title", "YouTube Video")
        channel = meta.get("uploader", meta.get("channel", "YouTube"))

    # Download mp4 (max 720p for fast CPU processing on 2 vCPU VM, fallback best)
    download_success = False
    last_dl_err = ""
    for client in client_combos:
        dl_cmd = [
            "yt-dlp", "--no-playlist", "--no-warnings",
            "--extractor-args", f"youtube:player_client={client}",
            "-f", "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[ext=mp4]/best",
            "--merge-output-format", "mp4",
            "-o", str(video_path),
        ]
        if cookies_path:
            dl_cmd += ["--cookies", cookies_path]
        dl_cmd.append(url)

        dl_proc = run_cmd(dl_cmd, check=False)
        if dl_proc.returncode == 0 and video_path.exists() and video_path.stat().st_size > 1024:
            download_success = True
            break
        last_dl_err = dl_proc.stderr.strip() or meta_err

    if not download_success:
        if "Sign in to confirm you’re not a bot" in last_dl_err or "Sign in to confirm" in last_dl_err:
            raise RuntimeError(
                "O YouTube solicitou verificação contra bots para este vídeo. "
                "Para resolver:\n"
                "1. Envie o arquivo cookies.txt na aba Configurações (ou coloque em app/data/cookies.txt).\n"
                "2. Ou faça o upload direto do arquivo de vídeo (MP4/MOV) na tela inicial!"
            )
        raise RuntimeError(f"Falha ao baixar vídeo do YouTube ({last_dl_err[-300:] or 'erro desconhecido'}).")

    info = ffprobe_info(video_path)
    audio_path, thumb_path = extract_audio_and_thumb(video_path, out_dir)
    return {
        "title": title,
        "channel": channel,
        "videoPath": str(video_path),
        "audioPath": audio_path,
        "thumbPath": thumb_path,
        **info
    }


def cmd_ingest_upload(args):
    video_path = Path(args["video_path"])
    out_dir = Path(args["out_dir"])
    out_dir.mkdir(parents=True, exist_ok=True)
    info = ffprobe_info(video_path)
    audio_path, thumb_path = extract_audio_and_thumb(video_path, out_dir)
    return {
        "videoPath": str(video_path),
        "audioPath": audio_path,
        "thumbPath": thumb_path,
        **info
    }


def cmd_transcribe(args):
    audio_path = args["audio_path"]
    model_size = args.get("model_size", "tiny")
    language = args.get("language") or None

    import wave
    import numpy as np
    from faster_whisper import WhisperModel

    # Read 16kHz mono PCM WAV directly via stdlib wave + numpy (avoids PyAV metadata_errors bug)
    with wave.open(audio_path, "rb") as wf:
        frames = wf.readframes(wf.getnframes())
        audio_np = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0

    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segments_gen, info = model.transcribe(
        audio_np,
        language=language,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=400)
    )

    segments = []
    words = []
    full_text_parts = []

    for seg in segments_gen:
        seg_words = []
        if seg.words:
            for w in seg.words:
                txt = w.word.strip()
                if not txt:
                    continue
                word_obj = {
                    "text": txt,
                    "start": round(float(w.start), 3),
                    "end": round(float(w.end), 3),
                    "prob": round(float(w.probability), 3)
                }
                seg_words.append(word_obj)
                words.append(word_obj)
        text_clean = seg.text.strip()
        if text_clean:
            full_text_parts.append(text_clean)
            segments.append({
                "id": seg.id,
                "start": round(float(seg.start), 3),
                "end": round(float(seg.end), 3),
                "text": text_clean,
                "words": seg_words
            })

    return {
        "language": info.language,
        "languageProbability": round(float(info.language_probability), 3),
        "text": " ".join(full_text_parts),
        "segments": segments,
        "words": words
    }


def cmd_detect_faces(args):
    video_path = args["video_path"]
    sample_interval = float(args.get("interval_sec", 2.0))

    try:
        import cv2
        CascadeCls = getattr(cv2, "CascadeClassifier", None)
        if CascadeCls is None or not hasattr(cv2, "data"):
            return {"keyframes": [{"t": 0.0, "xPct": 0.5, "yPct": 0.45, "faces": 0}], "facecamBox": None}
    except Exception:
        return {"keyframes": [{"t": 0.0, "xPct": 0.5, "yPct": 0.45, "faces": 0}], "facecamBox": None}

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return {"keyframes": [{"t": 0.0, "xPct": 0.5, "yPct": 0.5, "faces": 0}], "facecamBox": None}

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    w = cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1280
    h = cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 720

    c_default = CascadeCls(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    c_alt2 = CascadeCls(cv2.data.haarcascades + "haarcascade_frontalface_alt2.xml")
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))

    step = max(1, int(fps * sample_interval))
    keyframes = []
    detected_boxes = []
    frame_idx = 0
    last_x, last_y = 0.5, 0.42

    while frame_idx < total_frames and len(keyframes) < 120:
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()
        if not ret:
            break
        gray = clahe.apply(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY))
        faces = c_alt2.detectMultiScale(gray, scaleFactor=1.12, minNeighbors=3, minSize=(24, 24))
        if len(faces) == 0:
            faces = c_default.detectMultiScale(gray, scaleFactor=1.12, minNeighbors=3, minSize=(24, 24))
        t_sec = round(frame_idx / fps, 2)
        if len(faces) > 0:
            fx, fy, fw, fh = max(faces, key=lambda b: b[2] * b[3])
            cx = (fx + fw / 2.0) / w
            cy = (fy + fh / 2.0) / h
            last_x = round(0.7 * cx + 0.3 * last_x, 4)
            last_y = round(0.7 * cy + 0.3 * last_y, 4)
            detected_boxes.append((cx, cy, fw / w, fh / h))
            keyframes.append({
                "t": t_sec,
                "xPct": last_x,
                "yPct": last_y,
                "wPct": round(fw / w, 4),
                "hPct": round(fh / h, 4),
                "faces": int(len(faces))
            })
        else:
            keyframes.append({"t": t_sec, "xPct": last_x, "yPct": last_y, "faces": 0})
        frame_idx += step

    cap.release()
    if not keyframes:
        keyframes = [{"t": 0.0, "xPct": 0.5, "yPct": 0.45, "faces": 0}]

    # Compute median facecam bounding box (expanded around face for shoulders/headset)
    facecam_box = None
    if detected_boxes:
        xs = sorted(b[0] for b in detected_boxes)
        ys = sorted(b[1] for b in detected_boxes)
        ws = sorted(b[2] for b in detected_boxes)
        hs = sorted(b[3] for b in detected_boxes)
        mid = len(detected_boxes) // 2
        mx, my, mw, mh = xs[mid], ys[mid], ws[mid], hs[mid]
        box_w = max(0.24, min(0.45, mw * 2.8))
        box_h = max(0.26, min(0.48, mh * 2.6))
        facecam_box = {
            "camX": round(max(0.0, min(1.0, mx)), 3),
            "camY": round(max(0.0, min(1.0, my)), 3),
            "camW": round(box_w, 3),
            "camH": round(box_h, 3)
        }

    return {"keyframes": keyframes, "facecamBox": facecam_box}


def hex_to_ass_color(hex_color, alpha=0):
    """Convert #RRGGBB to &HAABBGGRR for ASS subtitles."""
    h = (hex_color or "#FFFFFF").lstrip("#")
    if len(h) != 6:
        h = "FFFFFF"
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H{alpha:02X}{b}{g}{r}".upper()


def format_ass_time(sec):
    sec = max(0.0, float(sec))
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = int(sec % 60)
    cs = int(round((sec - int(sec)) * 100))
    if cs >= 100:
        cs = 99
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


PRESET_STYLES = {
    "karaoke":         {"primary": "#FFFFFF", "highlight": "#04F827", "outline": "#000000", "back": "#000000", "borderStyle": 1, "outlinePx": 5, "shadow": 3, "fontSize": 68, "upper": True, "wordsPerLine": 3},
    "think-media":     {"primary": "#FFFFFF", "highlight": "#FFE600", "outline": "#000000", "back": "#000000", "borderStyle": 1, "outlinePx": 6, "shadow": 4, "fontSize": 70, "upper": True, "wordsPerLine": 3},
    "highlighter-box": {"primary": "#FFFFFF", "highlight": "#FFE600", "outline": "#1C4EBF", "back": "#1C4EBF", "borderStyle": 3, "outlinePx": 8, "shadow": 0, "fontSize": 64, "upper": True, "wordsPerLine": 4},
    "spotlight":       {"primary": "#FFFFFF", "highlight": "#FFD600", "outline": "#000000", "back": "#000000", "borderStyle": 1, "outlinePx": 5, "shadow": 2, "fontSize": 66, "upper": True, "wordsPerLine": 3},
    "marker":          {"primary": "#FFFFFF", "highlight": "#00F5D4", "outline": "#000000", "back": "#000000", "borderStyle": 1, "outlinePx": 5, "shadow": 2, "fontSize": 66, "upper": True, "wordsPerLine": 3},
    "one-beat":        {"primary": "#FFFFFF", "highlight": "#FF37B9", "outline": "#000000", "back": "#000000", "borderStyle": 1, "outlinePx": 6, "shadow": 4, "fontSize": 84, "upper": True, "wordsPerLine": 1},
    "comic":           {"primary": "#FFE600", "highlight": "#FF0055", "outline": "#000000", "back": "#000000", "borderStyle": 1, "outlinePx": 7, "shadow": 5, "fontSize": 72, "upper": True, "wordsPerLine": 3},
    "punch":           {"primary": "#FFFFFF", "highlight": "#FFE600", "outline": "#000000", "back": "#000000", "borderStyle": 1, "outlinePx": 6, "shadow": 3, "fontSize": 74, "upper": True, "wordsPerLine": 2},
    "seamless-bounce": {"primary": "#FFFFFF", "highlight": "#D7FF37", "outline": "#000000", "back": "#000000", "borderStyle": 1, "outlinePx": 5, "shadow": 3, "fontSize": 68, "upper": True, "wordsPerLine": 3},
    "glitch":          {"primary": "#FFFFFF", "highlight": "#5DFBFF", "outline": "#FF0055", "back": "#000000", "borderStyle": 1, "outlinePx": 5, "shadow": 4, "fontSize": 68, "upper": True, "wordsPerLine": 3},
    "sunset":          {"primary": "#FFFFFF", "highlight": "#FF37B9", "outline": "#2B0033", "back": "#000000", "borderStyle": 1, "outlinePx": 5, "shadow": 3, "fontSize": 68, "upper": True, "wordsPerLine": 3},
    "editorial":       {"primary": "#F8FAFC", "highlight": "#E2E8F0", "outline": "#0F172A", "back": "#0F172A", "borderStyle": 1, "outlinePx": 3, "shadow": 2, "fontSize": 56, "upper": False, "wordsPerLine": 5},
    "typewriter":      {"primary": "#38BDF8", "highlight": "#FFFFFF", "outline": "#000000", "back": "#000000", "borderStyle": 1, "outlinePx": 4, "shadow": 2, "fontSize": 58, "upper": False, "wordsPerLine": 4},
    "classic":         {"primary": "#FFFFFF", "highlight": "#FFFFFF", "outline": "#000000", "back": "#000000", "borderStyle": 1, "outlinePx": 3, "shadow": 2, "fontSize": 54, "upper": False, "wordsPerLine": 6},
}


def build_ass_subtitles(words, start_sec, end_sec, preset_name, caption_cfg, out_w, out_h, ass_path, brand_kit=None):
    bk = brand_kit or {}
    cfg = caption_cfg or {}
    effective_preset = preset_name or bk.get("defaultPreset") or "karaoke"
    style = dict(PRESET_STYLES.get(effective_preset, PRESET_STYLES["karaoke"]))

    highlight_color = cfg.get("highlightColor") or bk.get("highlightColor")
    primary_color = cfg.get("primaryColor") or bk.get("primaryColor")
    secondary_color = cfg.get("secondaryColor") or bk.get("secondaryColor")
    if highlight_color:
        style["highlight"] = highlight_color
    if primary_color:
        style["primary"] = primary_color
    if secondary_color:
        style["outline"] = secondary_color
    if cfg.get("fontSize"):
        style["fontSize"] = int(cfg["fontSize"])
    if "uppercase" in cfg:
        style["upper"] = bool(cfg["uppercase"])

    font_name = cfg.get("fontFamily") or bk.get("fontFamily") or "DejaVu Sans"
    pos_y_pct = float(cfg.get("positionY", 0.72))
    margin_v = int(out_h * (1.0 - pos_y_pct))

    primary_ass = hex_to_ass_color(style["primary"], 0)
    highlight_ass = hex_to_ass_color(style["highlight"], 0)
    outline_ass = hex_to_ass_color(style["outline"], 0)
    back_ass = hex_to_ass_color(style["back"], 120)

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {out_w}
PlayResY: {out_h}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font_name},{style['fontSize']},{primary_ass},{highlight_ass},{outline_ass},{back_ass},-1,0,0,0,100,100,0,0,{style['borderStyle']},{style['outlinePx']},{style['shadow']},2,40,40,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    # Filter words inside clip window and shift relative to start_sec
    clip_words = []
    for w in (words or []):
        ws = float(w.get("start", 0))
        we = float(w.get("end", ws + 0.25))
        if we >= start_sec and ws <= end_sec:
            txt = str(w.get("text", "")).strip()
            if not txt:
                continue
            if style["upper"]:
                txt = txt.upper()
            # Escape ASS special chars
            txt = txt.replace("{", "").replace("}", "").replace("\\", "")
            clip_words.append({
                "text": txt,
                "start": max(0.0, ws - start_sec),
                "end": max(0.05, min(end_sec - start_sec, we - start_sec)),
                "emoji": w.get("emoji", "")
            })

    events = []
    wpl = style["wordsPerLine"]
    for i in range(0, len(clip_words), wpl):
        chunk = clip_words[i:i + wpl]
        if not chunk:
            continue
        # Word-by-word active highlight line for crisp karaoke effect
        for active_idx, active_w in enumerate(chunk):
            ev_start = active_w["start"]
            ev_end = chunk[active_idx + 1]["start"] if active_idx + 1 < len(chunk) else active_w["end"]
            if ev_end <= ev_start:
                ev_end = ev_start + 0.12
            parts = []
            for j, cw in enumerate(chunk):
                emoji_str = str(cw.get("emoji") or "").strip()
                display_txt = f"{cw['text']} {emoji_str}" if emoji_str else cw["text"]
                if j == active_idx:
                    parts.append(f"{{\\c{highlight_ass}\\fscx110\\fscy110}}{display_txt}{{\\c{primary_ass}\\fscx100\\fscy100}}")
                else:
                    parts.append(display_txt)
            line_text = " ".join(parts)
            events.append(f"Dialogue: 0,{format_ass_time(ev_start)},{format_ass_time(ev_end)},Default,,0,0,0,,{line_text}")

    Path(ass_path).parent.mkdir(parents=True, exist_ok=True)
    with open(ass_path, "w", encoding="utf-8") as f:
        f.write(header + "\n".join(events) + "\n")
    return str(ass_path)


def build_dynamic_x_expr(keyframes, start_sec, end_sec, src_w, crop_w, fallback_pan_x):
    """Build a smooth piecewise-linear FFmpeg crop X expression following detected face keyframes."""
    pts = []
    for kf in (keyframes or []):
        t = float(kf.get("t", 0))
        if kf.get("faces", 0) > 0 and start_sec - 1.0 <= t <= end_sec + 1.0:
            rel_t = max(0.0, t - start_sec)
            px = int(max(0, min(src_w - crop_w, src_w * float(kf["xPct"]) - crop_w / 2.0)))
            pts.append((round(rel_t, 2), px))
    if len(pts) < 2:
        return str(int(max(0, min(src_w - crop_w, src_w * fallback_pan_x - crop_w / 2.0))))
    # Keep at most 12 evenly spaced points across the full range
    if len(pts) > 12:
        indices = [int(round(i * (len(pts) - 1) / 11)) for i in range(12)]
        pts = [pts[idx] for idx in indices]
    # Build nested if(lt(t, t1), lerp, ...)
    expr = str(pts[-1][1])
    for i in range(len(pts) - 2, -1, -1):
        t0, x0 = pts[i]
        t1, x1 = pts[i + 1]
        dt = max(0.05, t1 - t0)
        lerp = f"({x0}+({x1}-{x0})*clip((t-{t0:.2f})/{dt:.2f},0,1))"
        expr = f"if(lt(t,{t1:.2f}),{lerp},{expr})"
    return expr


def detect_kept_intervals(video_path, start_sec, duration):
    """Run silencedetect on [start_sec, start_sec+duration] and return non-silent [(s, e), ...] relative to 0."""
    import re
    proc = run_cmd([
        "ffmpeg", "-y", "-ss", f"{start_sec:.3f}", "-t", f"{duration:.3f}",
        "-i", str(video_path), "-vn",
        "-af", "silencedetect=noise=-34dB:d=0.65",
        "-f", "null", "-"
    ], check=False)
    silences = []
    cur_start = None
    for line in (proc.stderr or "").splitlines():
        m_start = re.search(r"silence_start:\s*([0-9.]+)", line)
        if m_start:
            cur_start = float(m_start.group(1))
            continue
        m_end = re.search(r"silence_end:\s*([0-9.]+)", line)
        if m_end and cur_start is not None:
            s_end = min(duration, float(m_end.group(1)))
            s_start = max(0.0, cur_start)
            if s_end > s_start:
                silences.append((s_start, s_end))
            cur_start = None
    if cur_start is not None and duration > cur_start:
        silences.append((max(0.0, cur_start), duration))

    if not silences:
        return None

    kept = []
    cursor = 0.0
    for s_start, s_end in silences:
        if s_start > cursor + 0.05:
            kept.append((round(cursor, 3), round(min(duration, s_start), 3)))
        cursor = max(cursor, s_end)
    if duration > cursor + 0.05:
        kept.append((round(cursor, 3), round(duration, 3)))

    if not kept:
        return None
    if len(kept) == 1 and kept[0][0] <= 0.05 and kept[0][1] >= duration - 0.05:
        return None
    return kept


def remap_words_to_kept_intervals(words, start_sec, end_sec, kept_intervals):
    """Remap word timestamps from original clip [start_sec, end_sec] into concatenated kept_intervals."""
    def map_t(t_rel):
        acc = 0.0
        for ks, ke in kept_intervals:
            if t_rel <= ks:
                return acc
            if t_rel <= ke:
                return acc + (t_rel - ks)
            acc += (ke - ks)
        return acc

    remapped = []
    for w in (words or []):
        ws = float(w.get("start", 0)) - start_sec
        we = float(w.get("end", ws + 0.25 + start_sec)) - start_sec
        if we < 0 or ws > (end_sec - start_sec):
            continue
        # Only keep words that overlap at least one kept interval
        if not any(we > ks and ws < ke for ks, ke in kept_intervals):
            continue
        new_s = map_t(max(0.0, ws))
        new_e = map_t(max(0.0, we))
        if new_e <= new_s:
            new_e = new_s + 0.08
        nw = dict(w)
        nw["start"] = round(new_s, 3)
        nw["end"] = round(new_e, 3)
        remapped.append(nw)
    return remapped


def cmd_render_clip(args):
    video_path = args["video_path"]
    out_path = args["out_path"]
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    start_sec = float(args.get("start_sec", 0))
    end_sec = float(args.get("end_sec", start_sec + 30))
    duration = max(1.0, end_sec - start_sec)

    aspect = args.get("aspect_ratio", "9:16")
    resolution = args.get("resolution", "1080p")
    fps = int(args.get("fps", 30))
    layout = args.get("layout_mode", "auto")
    framing = args.get("framing") or {}
    auto_color = args.get("auto_color") or {}
    caption_enabled = args.get("caption_enabled", True)
    brand_kit = args.get("brand_kit") or {}
    caption_preset = args.get("caption_preset") or brand_kit.get("defaultPreset") or "karaoke"
    caption_cfg = args.get("caption_config") or {}
    words = args.get("words") or []
    watermark_path = args.get("watermark_path")
    watermark_position = args.get("watermark_position") or brand_kit.get("watermarkPosition") or "top-right"
    wm_opacity_raw = args.get("watermark_opacity")
    if wm_opacity_raw is None:
        wm_opacity_raw = brand_kit.get("watermarkOpacity", 1.0)
    watermark_opacity = max(0.0, min(1.0, float(wm_opacity_raw)))
    headline_text = args.get("headline_text", "")
    progress_bar = bool(args.get("progress_bar", False))
    transition_type = args.get("transition_type", "hard-cut")
    motion_type = args.get("motion_type", "none")
    face_keyframes = args.get("face_keyframes") or []
    bgm_path = args.get("bgm_path")
    bgm_volume = float(args.get("bgm_volume", 0.22))
    bgm_ducking = bool(args.get("bgm_ducking", True))
    remove_silences = bool(args.get("remove_silences", False))
    broll_overlays = args.get("broll_overlays") or []
    dub_audio_path = args.get("dub_audio_path")
    dub_mix_original = float(args.get("dub_mix_original", 0.0))

    # Target dimensions
    scale_base = 1080 if resolution == "1080p" else 720
    if aspect == "9:16":
        out_w, out_h = (scale_base, int(scale_base * 16 / 9))
    elif aspect == "4:5":
        out_w, out_h = (scale_base, int(scale_base * 5 / 4))
    elif aspect == "1:1":
        out_w, out_h = (scale_base, scale_base)
    else:  # 16:9
        out_w, out_h = (int(scale_base * 16 / 9), scale_base)
    out_w -= out_w % 2
    out_h -= out_h % 2

    src_info = ffprobe_info(video_path)
    src_w, src_h = src_info["width"], src_info["height"]

    has_audio = any(s.get("codec_type") == "audio" for s in json.loads(
        run_cmd(["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", str(video_path)]).stdout
    ).get("streams", []))

    kept_intervals = None
    eff_duration = duration
    if remove_silences and has_audio:
        kept_intervals = detect_kept_intervals(video_path, start_sec, duration)
        if kept_intervals:
            eff_duration = max(0.5, sum(e - s for s, e in kept_intervals))

    pan_x = float(framing.get("panX", 0.5))
    pan_y = float(framing.get("panY", 0.5))
    zoom = max(1.0, min(3.0, float(framing.get("zoom", 1.0))))

    filter_parts = []
    v_src_label = "[0:v]"
    a_src_label = "[0:a]"

    if kept_intervals:
        seg_refs = []
        for idx, (ks, ke) in enumerate(kept_intervals):
            filter_parts.append(f"[0:v]trim=start={ks:.3f}:end={ke:.3f},setpts=PTS-STARTPTS[vs{idx}]")
            filter_parts.append(f"[0:a]atrim=start={ks:.3f}:end={ke:.3f},asetpts=PTS-STARTPTS[as{idx}]")
            seg_refs.append(f"[vs{idx}][as{idx}]")
        filter_parts.append(f"{''.join(seg_refs)}concat=n={len(kept_intervals)}:v=1:a=1[vcut][acut]")
        v_src_label = "[vcut]"
        a_src_label = "[acut]"

    if layout == "fit":
        filter_parts.append(
            f"{v_src_label}split=2[bg][fg];"
            f"[bg]scale={out_w}:{out_h}:force_original_aspect_ratio=increase,crop={out_w}:{out_h},boxblur=24:4[bgb];"
            f"[fg]scale={out_w}:{out_h}:force_original_aspect_ratio=decrease[fgf];"
            f"[bgb][fgf]overlay=(W-w)/2:(H-h)/2[vbase]"
        )
    elif layout == "split":
        top_h = int(out_h * 0.40)
        top_h -= top_h % 2
        bot_h = out_h - top_h
        cam_x_pct = float(framing.get("camX", pan_x if pan_x != 0.5 else 0.15))
        cam_y_pct = float(framing.get("camY", pan_y if pan_y != 0.45 else 0.80))
        cam_w_pct = max(0.15, min(0.65, float(framing.get("camW", 0.28))))
        cam_h_pct = max(0.15, min(0.65, float(framing.get("camH", 0.32))))

        cw = max(64, int(src_w * cam_w_pct))
        ch = max(64, int(src_h * cam_h_pct))
        cw -= cw % 2
        ch -= ch % 2
        cx = int(max(0, min(src_w - cw, src_w * cam_x_pct - cw / 2.0)))
        cy = int(max(0, min(src_h - ch, src_h * cam_y_pct - ch / 2.0)))

        filter_parts.append(
            f"{v_src_label}split=2[vtop][vbot];"
            f"[vtop]crop={cw}:{ch}:{cx}:{cy},scale={out_w}:{top_h}:force_original_aspect_ratio=increase,crop={out_w}:{top_h}[top];"
            f"[vbot]scale={out_w}:{bot_h}:force_original_aspect_ratio=increase,crop={out_w}:{bot_h}[bot];"
            f"[top][bot]vstack=inputs=2[vbase]"
        )
    elif layout in ("three", "four"):
        custom_panels = framing.get("panels") if isinstance(framing.get("panels"), list) else []
        if layout == "three":
            default_regions = [
                (0.50, 0.35, 0.55, 0.55),
                (0.25, 0.55, 0.45, 0.55),
                (0.75, 0.55, 0.45, 0.55),
            ]
            if aspect in ("9:16", "4:5"):
                h1 = (out_h // 3) - ((out_h // 3) % 2)
                h2 = h1
                h3 = out_h - h1 - h2
                panel_dims = [(out_w, h1), (out_w, h2), (out_w, h3)]
                combine_expr = "[p0][p1][p2]vstack=inputs=3[vbase]"
            elif aspect == "16:9":
                w1 = (out_w // 3) - ((out_w // 3) % 2)
                w2 = w1
                w3 = out_w - w1 - w2
                panel_dims = [(w1, out_h), (w2, out_h), (w3, out_h)]
                combine_expr = "[p0][p1][p2]hstack=inputs=3[vbase]"
            else:  # 1:1
                top_h = (out_h // 2) - ((out_h // 2) % 2)
                bot_h = out_h - top_h
                left_w = (out_w // 2) - ((out_w // 2) % 2)
                right_w = out_w - left_w
                panel_dims = [(out_w, top_h), (left_w, bot_h), (right_w, bot_h)]
                combine_expr = "[p1][p2]hstack=inputs=2[pbot];[p0][pbot]vstack=inputs=2[vbase]"
            n_panels = 3
        else:  # four (2x2 grid for all aspect ratios)
            default_regions = [
                (0.28, 0.30, 0.48, 0.48),
                (0.72, 0.30, 0.48, 0.48),
                (0.28, 0.70, 0.48, 0.48),
                (0.72, 0.70, 0.48, 0.48),
            ]
            left_w = (out_w // 2) - ((out_w // 2) % 2)
            right_w = out_w - left_w
            top_h = (out_h // 2) - ((out_h // 2) % 2)
            bot_h = out_h - top_h
            panel_dims = [(left_w, top_h), (right_w, top_h), (left_w, bot_h), (right_w, bot_h)]
            combine_expr = "[p0][p1]hstack=inputs=2[ptop];[p2][p3]hstack=inputs=2[pbot];[ptop][pbot]vstack=inputs=2[vbase]"
            n_panels = 4

        split_labels = "".join(f"[vp{i}]" for i in range(n_panels))
        panel_chains = [f"{v_src_label}split={n_panels}{split_labels}"]
        for i in range(n_panels):
            pw, ph = panel_dims[i]
            reg = custom_panels[i] if i < len(custom_panels) and isinstance(custom_panels[i], dict) else {}
            dx, dy, dw, dh = default_regions[i]
            rx = float(reg.get("xPct", reg.get("x", dx)))
            ry = float(reg.get("yPct", reg.get("y", dy)))
            rw = max(0.15, min(1.0, float(reg.get("wPct", reg.get("w", dw)))))
            rh = max(0.15, min(1.0, float(reg.get("hPct", reg.get("h", dh)))))
            cw = max(64, min(src_w, int(src_w * rw)))
            ch = max(64, min(src_h, int(src_h * rh)))
            cw -= cw % 2
            ch -= ch % 2
            cx = int(max(0, min(src_w - cw, src_w * rx - cw / 2.0)))
            cy = int(max(0, min(src_h - ch, src_h * ry - ch / 2.0)))
            panel_chains.append(
                f"[vp{i}]crop={cw}:{ch}:{cx}:{cy},scale={pw}:{ph}:force_original_aspect_ratio=increase,crop={pw}:{ph}[p{i}]"
            )
        panel_chains.append(combine_expr)
        filter_parts.append(";".join(panel_chains))
    else:
        target_ar = out_w / out_h
        src_ar = src_w / src_h
        if src_ar > target_ar:
            crop_h = int(src_h / zoom)
            crop_w = int(crop_h * target_ar)
        else:
            crop_w = int(src_w / zoom)
            crop_h = int(crop_w / target_ar)
        crop_w = max(64, min(src_w, crop_w - (crop_w % 2)))
        crop_h = max(64, min(src_h, crop_h - (crop_h % 2)))
        crop_y = int(max(0, min(src_h - crop_h, src_h * pan_y - crop_h / 2.0)))
        if layout == "auto" and face_keyframes and not kept_intervals:
            x_expr = build_dynamic_x_expr(face_keyframes, start_sec, end_sec, src_w, crop_w, pan_x)
            filter_parts.append(f"{v_src_label}crop={crop_w}:{crop_h}:'{x_expr}':{crop_y},scale={out_w}:{out_h}[vbase]")
        else:
            crop_x = int(max(0, min(src_w - crop_w, src_w * pan_x - crop_w / 2.0)))
            filter_parts.append(f"{v_src_label}crop={crop_w}:{crop_h}:{crop_x}:{crop_y},scale={out_w}:{out_h}[vbase]")

    current_v = "[vbase]"
    post_filters = []

    # Real Motion Effects (slow-push, punch-in, auto-zoom)
    if motion_type == "slow-push":
        post_filters.append(
            f"scale=w='trunc(iw*(1+0.12*t/{eff_duration:.2f})/2)*2':h='trunc(ih*(1+0.12*t/{eff_duration:.2f})/2)*2':eval=frame,"
            f"crop={out_w}:{out_h}:(iw-{out_w})/2:(ih-{out_h})/2"
        )
    elif motion_type == "punch-in":
        post_filters.append(
            f"scale=w='trunc(iw*if(lt(mod(t,6),1.8),1.12,1.0)/2)*2':h='trunc(ih*if(lt(mod(t,6),1.8),1.12,1.0)/2)*2':eval=frame,"
            f"crop={out_w}:{out_h}:(iw-{out_w})/2:(ih-{out_h})/2"
        )
    elif motion_type == "auto-zoom":
        post_filters.append(
            f"scale=w='trunc(iw*(1.06+0.05*sin(t*1.4))/2)*2':h='trunc(ih*(1.06+0.05*sin(t*1.4))/2)*2':eval=frame,"
            f"crop={out_w}:{out_h}:(iw-{out_w})/2:(ih-{out_h})/2"
        )

    # Real Transitions
    if transition_type == "dip-to-black":
        out_st = max(0.0, eff_duration - 0.45)
        post_filters.append(f"fade=t=in:st=0:d=0.45,fade=t=out:st={out_st:.2f}:d=0.45")
    elif transition_type in ("white-flash", "light-leak"):
        post_filters.append("fade=t=in:st=0:d=0.35:color=white")
    elif transition_type == "defocus":
        post_filters.append("boxblur=luma_radius=12:luma_power=2:enable='lt(t,0.45)'")
    elif transition_type == "signal-glitch":
        post_filters.append("rgbashift=rh=10:bh=-10:enable='lt(t,0.4)'")
    elif transition_type in ("shutter", "iris"):
        post_filters.append("fade=t=in:st=0:d=0.25")

    # AutoColor filters
    glow_enabled = False
    glow_opacity = 0.22
    if auto_color.get("enabled"):
        deblock_val = auto_color.get("deblock")
        if deblock_val and (isinstance(deblock_val, bool) or float(deblock_val) > 0):
            post_filters.append("deblock=filter=weak:block=8:alpha=0.08:beta=0.04")
        if float(auto_color.get("denoise", 0)) > 0:
            post_filters.append("hqdn3d=2:2:4:4")
        if float(auto_color.get("sharpen", 0)) > 0:
            amt = min(1.5, float(auto_color.get("sharpen", 0.5)) * 1.2)
            post_filters.append(f"unsharp=5:5:{amt:.2f}:5:5:0.0")
        post_filters.append("eq=contrast=1.06:saturation=1.12")
        glow_val = auto_color.get("glow")
        if glow_val and (isinstance(glow_val, bool) or float(glow_val) > 0):
            glow_enabled = True
            if not isinstance(glow_val, bool):
                glow_opacity = max(0.05, min(0.5, float(glow_val) * 0.35))

    if post_filters:
        filter_parts.append(f"{current_v}{','.join(post_filters)}[vpost]")
        current_v = "[vpost]"

    if glow_enabled:
        filter_parts.append(
            f"{current_v}split=2[gl_base][gl_blur];"
            f"[gl_blur]gblur=sigma=12[gl_b];"
            f"[gl_base][gl_b]blend=all_mode=screen:all_opacity={glow_opacity:.2f}[vglow]"
        )
        current_v = "[vglow]"

    inputs = ["-ss", f"{start_sec:.3f}", "-t", f"{duration:.3f}", "-i", str(video_path)]
    next_idx = 1

    # B-roll overlays (media file or procedural keyword callout card)
    callout_filters = []
    for b_idx, br in enumerate(broll_overlays):
        if not isinstance(br, dict):
            continue
        try:
            b_start = max(0.0, float(br.get("start", 0.0)))
            b_end = min(eff_duration, float(br.get("end", b_start + 2.5)))
        except (TypeError, ValueError):
            continue
        if b_end <= b_start:
            continue
        media_path = br.get("mediaPath") or br.get("path") or br.get("imagePath") or br.get("videoPath")
        if media_path and os.path.exists(media_path):
            ext = Path(media_path).suffix.lower()
            is_img = ext in (".png", ".jpg", ".jpeg", ".webp", ".bmp")
            if is_img:
                inputs += ["-loop", "1", "-t", f"{eff_duration + 0.5:.3f}", "-i", str(media_path)]
            else:
                inputs += ["-stream_loop", "-1", "-t", f"{eff_duration + 0.5:.3f}", "-i", str(media_path)]
            br_label = f"[vbr{b_idx}]"
            filter_parts.append(
                f"[{next_idx}:v]scale={out_w}:{out_h}:force_original_aspect_ratio=increase,"
                f"crop={out_w}:{out_h}[brm{b_idx}];"
                f"{current_v}[brm{b_idx}]overlay=0:0:shortest=1:enable='between(t,{b_start:.3f},{b_end:.3f})'{br_label}"
            )
            current_v = br_label
            next_idx += 1
        else:
            kw = str(br.get("keyword") or br.get("text") or br.get("label") or "").strip()
            if kw:
                safe_kw = kw.replace("'", "").replace(":", " ").replace("\\", "")[:42]
                box_h = 84
                box_y = int(out_h * 0.22)
                en_expr = f"between(t,{b_start:.3f},{b_end:.3f})"
                callout_filters.append(
                    f"drawbox=x=60:y={box_y}:w={out_w - 120}:h={box_h}:color=#0F172A@0.82:t=fill:enable='{en_expr}'"
                )
                callout_filters.append(
                    f"drawtext=text='{safe_kw}':expansion=none:fontcolor=#38BDF8:fontsize=40:"
                    f"x=(w-text_w)/2:y={box_y + 22}:enable='{en_expr}'"
                )

    # Progress bar overlay (animated via color source + overlay)
    if progress_bar:
        filter_parts.append(
            f"color=c=#22c55e@0.9:s={out_w}x12:r={fps}:d={eff_duration + 0.5:.3f},format=rgba[pbar];"
            f"{current_v}[pbar]overlay=x='-w+(W*min(t,{eff_duration:.3f})/{eff_duration:.3f})':y=0:shortest=1[vpbar]"
        )
        current_v = "[vpbar]"

    # Headline, callouts, and ASS subtitles burn-in
    overlay_text_filters = list(callout_filters)
    if headline_text:
        safe_hl = headline_text.replace("'", "").replace(":", " ").replace("\\", "")[:60]
        overlay_text_filters.append(
            f"drawtext=text='{safe_hl}':expansion=none:fontcolor=white:fontsize=46:box=1:boxcolor=black@0.72:boxborderw=18:x=(w-text_w)/2:y=90"
        )

    if caption_enabled and words:
        ass_file = str(Path(out_path).with_suffix(".ass"))
        if kept_intervals:
            ass_words = remap_words_to_kept_intervals(words, start_sec, end_sec, kept_intervals)
            build_ass_subtitles(ass_words, 0.0, eff_duration, caption_preset, caption_cfg, out_w, out_h, ass_file, brand_kit=brand_kit)
        else:
            build_ass_subtitles(words, start_sec, end_sec, caption_preset, caption_cfg, out_w, out_h, ass_file, brand_kit=brand_kit)
        escaped_ass = ass_file.replace("\\", "/").replace(":", "\\:")
        overlay_text_filters.append(f"ass='{escaped_ass}'")

    if overlay_text_filters:
        filter_parts.append(f"{current_v}{','.join(overlay_text_filters)}[vtxt]")
        current_v = "[vtxt]"

    if watermark_path and os.path.exists(watermark_path):
        pos_map = {
            "top-left": "30:30",
            "top-right": "W-w-30:30",
            "bottom-left": "30:H-h-30",
            "bottom-right": "W-w-30:H-h-30",
            "center": "(W-w)/2:(H-h)/2",
        }
        wm_xy = pos_map.get(watermark_position, "W-w-30:30")
        inputs += ["-i", str(watermark_path)]
        filter_parts.append(
            f"[{next_idx}:v]scale=140:-1,format=rgba,colorchannelmixer=aa={watermark_opacity:.2f}[wm];"
            f"{current_v}[wm]overlay={wm_xy}[vout]"
        )
        current_v = "[vout]"
        next_idx += 1

    # Audio handling: optional silence jump-cut + optional dub_audio_path + optional BGM with sidechaincompress ducking
    audio_map = "0:a?"
    has_dub = bool(dub_audio_path and os.path.exists(dub_audio_path))
    has_bgm = bool(bgm_path and os.path.exists(bgm_path))

    voice_label = None
    if has_dub:
        inputs += ["-t", f"{eff_duration:.3f}", "-i", str(dub_audio_path)]
        dub_idx = next_idx
        next_idx += 1
        if has_audio and dub_mix_original > 0.0:
            filter_parts.append(
                f"{a_src_label}volume={dub_mix_original:.2f}[orig_low];"
                f"[{dub_idx}:a]apad,atrim=0:{eff_duration:.3f},asetpts=PTS-STARTPTS[dub_a];"
                f"[orig_low][dub_a]amix=inputs=2:duration=longest[vvoice]"
            )
            voice_label = "[vvoice]"
        else:
            filter_parts.append(f"[{dub_idx}:a]apad,atrim=0:{eff_duration:.3f},asetpts=PTS-STARTPTS[vvoice]")
            voice_label = "[vvoice]"
    elif has_audio:
        voice_label = a_src_label

    if voice_label and has_bgm:
        inputs += ["-stream_loop", "-1", "-t", f"{eff_duration:.3f}", "-i", str(bgm_path)]
        bgm_idx = next_idx
        next_idx += 1
        if bgm_ducking:
            filter_parts.append(
                f"{voice_label}asplit=2[voice][sc];"
                f"[{bgm_idx}:a]volume={bgm_volume:.2f}[bgmv];"
                f"[bgmv][sc]sidechaincompress=threshold=0.04:ratio=6:attack=25:release=350[ducked];"
                f"[voice][ducked]amix=inputs=2:duration=first:dropout_transition=2[aout]"
            )
        else:
            filter_parts.append(
                f"[{bgm_idx}:a]volume={bgm_volume:.2f}[bgmv];"
                f"{voice_label}[bgmv]amix=inputs=2:duration=first[aout]"
            )
        audio_map = "[aout]"
    elif voice_label and voice_label != "[0:a]":
        audio_map = voice_label

    filter_complex = ";".join(filter_parts)
    cmd = [
        "ffmpeg", "-y", *inputs,
        "-filter_complex", filter_complex,
        "-map", current_v, "-map", audio_map,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-r", str(fps), "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        str(out_path)
    ]
    run_cmd(cmd)
    out_size = os.path.getsize(out_path)
    return {"exportPath": str(out_path), "sizeBytes": out_size, "width": out_w, "height": out_h, "fps": fps}


# Neural voices (Microsoft Edge TTS, free / no API key) per language code
EDGE_VOICES = {
    "pt": "pt-BR-AntonioNeural", "en": "en-US-GuyNeural", "es": "es-MX-JorgeNeural",
    "fr": "fr-FR-HenriNeural", "de": "de-DE-ConradNeural", "it": "it-IT-DiegoNeural",
    "ja": "ja-JP-KeitaNeural", "ko": "ko-KR-InJoonNeural", "zh": "zh-CN-YunxiNeural",
    "ru": "ru-RU-DmitryNeural", "hi": "hi-IN-MadhurNeural", "ar": "ar-SA-HamedNeural",
    "tr": "tr-TR-AhmetNeural", "nl": "nl-NL-MaartenNeural", "pl": "pl-PL-MarekNeural",
    "id": "id-ID-ArdiNeural", "vi": "vi-VN-NamMinhNeural", "uk": "uk-UA-OstapNeural",
    "sv": "sv-SE-MattiasNeural", "th": "th-TH-NiwatNeural",
}


def _audio_duration(path):
    proc = run_cmd(["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", str(path)], check=False)
    try:
        return float(json.loads(proc.stdout).get("format", {}).get("duration", 0.0))
    except Exception:
        return 0.0


def _tts_segment(text, lang, voice, out_base):
    """Synthesize one segment. Returns path to audio file or raises."""
    errors = []
    try:
        import edge_tts  # noqa: F401
        import asyncio
        mp3 = f"{out_base}.mp3"

        async def _run():
            comm = edge_tts.Communicate(text, voice or EDGE_VOICES.get(lang, EDGE_VOICES["en"]))
            await comm.save(mp3)

        asyncio.run(asyncio.wait_for(_run(), timeout=45))
        if os.path.exists(mp3) and os.path.getsize(mp3) > 0:
            return mp3
        errors.append("edge-tts: empty output")
    except Exception as e:
        errors.append(f"edge-tts: {e}")

    for binary in ("espeak-ng", "espeak"):
        wav = f"{out_base}.wav"
        try:
            proc = subprocess.run([binary, "-v", lang or "en", "-s", "165", "-w", wav, text],
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=60)
            if proc.returncode == 0 and os.path.exists(wav) and os.path.getsize(wav) > 44:
                return wav
            errors.append(f"{binary}: {proc.stderr.strip()[:120]}")
        except FileNotFoundError:
            errors.append(f"{binary}: not installed")
        except Exception as e:
            errors.append(f"{binary}: {e}")
    raise RuntimeError("Nenhum motor TTS disponível (instale edge-tts ou espeak-ng). " + " | ".join(errors))


def cmd_synthesize_dub(args):
    """
    Build a dubbed voice track aligned with the clip timeline.
    segments: [{start, end, text}] relative to clip start (seconds)
    """
    segments = [s for s in (args.get("segments") or []) if str(s.get("text", "")).strip()]
    duration = max(0.5, float(args.get("duration", 30)))
    lang = (args.get("language") or "en").split("-")[0].lower()
    voice = args.get("voice") or EDGE_VOICES.get(lang, EDGE_VOICES["en"])
    out_path = Path(args["out_path"])
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if not segments:
        raise RuntimeError("Nenhum texto para dublar neste clipe.")

    work_dir = out_path.parent / f"{out_path.stem}_parts"
    work_dir.mkdir(parents=True, exist_ok=True)

    inputs, filters, labels = [], [], []
    engine_used = None
    for i, seg in enumerate(segments[:80]):
        start = max(0.0, float(seg.get("start", 0)))
        if start >= duration:
            continue
        next_start = float(segments[i + 1]["start"]) if i + 1 < len(segments) else duration
        slot = max(0.4, min(duration, next_start) - start)
        part = _tts_segment(str(seg["text"]).strip(), lang, voice, str(work_dir / f"seg{i:03d}"))
        engine_used = engine_used or ("edge-tts" if part.endswith(".mp3") else "espeak-ng")
        dur = _audio_duration(part) or slot
        tempo = max(1.0, min(2.0, dur / slot))
        idx = len(inputs) // 2
        inputs += ["-i", part]
        tempo_f = f"atempo={tempo:.3f}," if tempo > 1.01 else ""
        delay_ms = int(start * 1000)
        filters.append(
            f"[{idx}:a]aresample=44100,aformat=channel_layouts=mono,{tempo_f}"
            f"atrim=0:{slot + 0.15:.3f},adelay={delay_ms}|{delay_ms}[s{idx}]"
        )
        labels.append(f"[s{idx}]")

    if not labels:
        raise RuntimeError("Nenhum segmento dentro da duração do clipe.")

    filters.append(
        f"{''.join(labels)}amix=inputs={len(labels)}:duration=longest:normalize=0,"
        f"apad,atrim=0:{duration:.3f}[dub]"
    )
    run_cmd([
        "ffmpeg", "-y", *inputs,
        "-filter_complex", ";".join(filters),
        "-map", "[dub]", "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", str(out_path)
    ])
    try:
        import shutil
        shutil.rmtree(work_dir, ignore_errors=True)
    except Exception:
        pass
    return {"dubPath": str(out_path), "segments": len(labels), "voice": voice,
            "engine": engine_used, "duration": round(_audio_duration(out_path), 3)}


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "Missing command"}))
        sys.exit(1)

    cmd = sys.argv[1]
    payload = json.loads(sys.stdin.read() or "{}")

    handlers = {
        "ingest_youtube": cmd_ingest_youtube,
        "ingest_upload": cmd_ingest_upload,
        "transcribe": cmd_transcribe,
        "detect_faces": cmd_detect_faces,
        "render_clip": cmd_render_clip,
        "synthesize_dub": cmd_synthesize_dub,
    }

    if cmd not in handlers:
        print(json.dumps({"ok": False, "error": f"Unknown command: {cmd}"}))
        sys.exit(1)

    try:
        result = handlers[cmd](payload)
        print(json.dumps({"ok": True, "data": result}))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
